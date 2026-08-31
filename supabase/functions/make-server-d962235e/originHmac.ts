import type { Context, MiddlewareHandler, Next } from "npm:hono@4.13.3";

const encoder = new TextEncoder();
const ORIGIN_HEADER_NAMES = [
  "x-wmatch-origin-key-id",
  "x-wmatch-origin-timestamp",
  "x-wmatch-origin-nonce",
  "x-wmatch-origin-body-sha256",
  "x-wmatch-origin-signature",
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const CLIENT_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FUNCTION_PATH = "/make-server-d962235e";
const MAX_SELECTED_ORIGIN_BODY_BYTES = 32_768;
const verifiedClientIdentities = new WeakMap<Request, string>();

export type OriginHmacNonceClaim = (args: {
  p_key_id: string;
  p_max_skew_seconds: number;
  p_nonce: string;
  p_timestamp: number;
}) => PromiseLike<{ data: boolean | null; error: unknown }>;

interface VerificationConfig {
  canonicalPathPrefix: string;
  keys: ReadonlyMap<string, string>;
  maxBodyBytes?: number;
  maxSkewSeconds: number;
  nowMs?: number;
}

export type OriginHmacVerification =
  | {
    ok: true;
    clientIdentity: string;
    keyId: string;
    nonce: string;
    timestamp: number;
  }
  | { ok: false; status: 401 | 413 | 503 };

const sha256Hex = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.slice().buffer as ArrayBuffer,
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const readBoundedBody = async (request: Request, maximumBytes: number) => {
  const contentLengthText = request.headers.get("content-length");
  if (contentLengthText !== null) {
    if (!/^\d{1,10}$/.test(contentLengthText)) return null;
    const contentLength = Number(contentLengthText);
    if (!Number.isSafeInteger(contentLength) || contentLength > maximumBytes) {
      return null;
    }
  }

  const body = request.clone().body;
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;

      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const decodeSignature = (value: string) => {
  const encoded = value.startsWith("v1=") ? value.slice(3) : "";
  if (!BASE64URL_PATTERN.test(encoded)) return null;

  try {
    const decoded = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "=");
    const bytes = Uint8Array.from(
      decoded,
      (character) => character.charCodeAt(0),
    );
    return bytes.byteLength === 32 ? bytes : null;
  } catch {
    return null;
  }
};

export const getCanonicalOriginPath = (
  requestUrl: string,
  prefix = "/functions/v1",
) => {
  const url = new URL(requestUrl);
  url.searchParams.sort();
  const pathname = url.pathname.startsWith(`${prefix}/`)
    ? url.pathname
    : `${prefix}${url.pathname}`;
  return `${pathname}${url.search}`;
};

export const verifyOriginHmacRequest = async (
  request: Request,
  config: VerificationConfig,
): Promise<OriginHmacVerification> => {
  const keyId = request.headers.get("x-wmatch-origin-key-id")?.trim() ?? "";
  const timestampText =
    request.headers.get("x-wmatch-origin-timestamp")?.trim() ?? "";
  const nonce = request.headers.get("x-wmatch-origin-nonce")?.trim() ?? "";
  const providedBodyHash =
    request.headers.get("x-wmatch-origin-body-sha256")?.trim() ?? "";
  const providedSignature =
    request.headers.get("x-wmatch-origin-signature")?.trim() ?? "";
  const requestId = request.headers.get("x-request-id")?.trim() ?? "";
  const clientIdentity =
    request.headers.get("x-wmatch-client-identity")?.trim() ?? "";
  const secret = config.keys.get(keyId);
  const signatureBytes = decodeSignature(providedSignature);
  const timestamp = Number(timestampText);
  const nowSeconds = Math.floor((config.nowMs ?? Date.now()) / 1_000);
  const maxBodyBytes = config.maxBodyBytes ?? MAX_SELECTED_ORIGIN_BODY_BYTES;

  if (
    !KEY_ID_PATTERN.test(keyId) ||
    !secret ||
    secret.length < 32 ||
    !/^\d{10}$/.test(timestampText) ||
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > config.maxSkewSeconds ||
    !UUID_PATTERN.test(nonce) ||
    !HEX_SHA256_PATTERN.test(providedBodyHash) ||
    !signatureBytes ||
    !REQUEST_ID_PATTERN.test(requestId) ||
    !CLIENT_IDENTITY_PATTERN.test(clientIdentity) ||
    !Number.isInteger(maxBodyBytes) ||
    maxBodyBytes < 0 ||
    maxBodyBytes > MAX_SELECTED_ORIGIN_BODY_BYTES
  ) {
    return { ok: false, status: 401 };
  }

  const bodyBytes = await readBoundedBody(request, maxBodyBytes);
  if (!bodyBytes) {
    return { ok: false, status: 413 };
  }
  if (await sha256Hex(bodyBytes) !== providedBodyHash) {
    return { ok: false, status: 401 };
  }

  const canonical = [
    "wmatch-origin-v1",
    keyId,
    timestampText,
    nonce,
    request.method.toUpperCase(),
    getCanonicalOriginPath(request.url, config.canonicalPathPrefix),
    providedBodyHash,
    requestId,
    clientIdentity,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes.slice().buffer as ArrayBuffer,
    encoder.encode(canonical),
  );
  return valid
    ? { ok: true, clientIdentity, keyId, nonce, timestamp }
    : { ok: false, status: 401 };
};

export const getVerifiedOriginClientIdentity = (request: Request) =>
  verifiedClientIdentities.get(request) ?? null;

const getSelectedOriginBodyLimit = (pathname: string) => {
  const routePath = pathname.startsWith("/functions/v1/")
    ? pathname.slice("/functions/v1".length)
    : pathname;
  if (routePath === `${FUNCTION_PATH}/health`) return 0;
  if (
    routePath === `${FUNCTION_PATH}/auth/check-availability` ||
    routePath === `${FUNCTION_PATH}/auth/password-reset`
  ) return 4_096;
  if (routePath === `${FUNCTION_PATH}/reports`) return 32_768;
  if (routePath === `${FUNCTION_PATH}/tmdb/media-batch`) return 8_192;
  if (routePath.startsWith(`${FUNCTION_PATH}/tmdb/`)) return 0;
  return null;
};

const readConfig = () => {
  const required =
    Deno.env.get("REQUIRE_CLOUDFLARE_ORIGIN_HMAC")?.trim().toLowerCase() ===
      "true";
  const activeKeyId = Deno.env.get("ORIGIN_HMAC_KEY_ID")?.trim() ?? "";
  const activeSecret = Deno.env.get("ORIGIN_HMAC_SECRET") ?? "";
  const previousKeyId = Deno.env.get("ORIGIN_HMAC_PREVIOUS_KEY_ID")?.trim() ??
    "";
  const previousSecret = Deno.env.get("ORIGIN_HMAC_PREVIOUS_SECRET") ?? "";
  const rawSkew = Number(Deno.env.get("ORIGIN_HMAC_MAX_SKEW_SECONDS") ?? "60");
  const maxSkewSeconds =
    Number.isInteger(rawSkew) && rawSkew >= 30 && rawSkew <= 300
      ? rawSkew
      : null;
  const keys = new Map<string, string>();
  if (KEY_ID_PATTERN.test(activeKeyId) && activeSecret.length >= 32) {
    keys.set(activeKeyId, activeSecret);
  }
  if (KEY_ID_PATTERN.test(previousKeyId) && previousSecret.length >= 32) {
    keys.set(previousKeyId, previousSecret);
  }

  return { keys, maxSkewSeconds, required };
};

export const createOriginHmacMiddleware =
  (claimNonce: OriginHmacNonceClaim): MiddlewareHandler =>
  async (c: Context, next: Next) => {
    const maxBodyBytes = getSelectedOriginBodyLimit(
      new URL(c.req.raw.url).pathname,
    );
    if (maxBodyBytes === null) return next();

    const hasSignatureHeaders = ORIGIN_HEADER_NAMES.some((name) =>
      c.req.raw.headers.has(name)
    );
    const config = readConfig();
    if (!hasSignatureHeaders && !config.required) return next();
    if (!config.maxSkewSeconds || config.keys.size === 0) {
      return c.json({
        error: "Trusted gateway signature verification is unavailable.",
      }, 503);
    }

    const verification = await verifyOriginHmacRequest(c.req.raw, {
      canonicalPathPrefix: "/functions/v1",
      keys: config.keys,
      maxBodyBytes,
      maxSkewSeconds: config.maxSkewSeconds,
    });
    if (!verification.ok) {
      return c.json(
        {
          error: verification.status === 413
            ? "Trusted gateway request body is too large."
            : "Trusted gateway signature is invalid.",
        },
        verification.status,
      );
    }

    const { data: claimed, error } = await claimNonce({
      p_key_id: verification.keyId,
      p_max_skew_seconds: config.maxSkewSeconds,
      p_nonce: verification.nonce,
      p_timestamp: verification.timestamp,
    });
    if (error) {
      return c.json({
        error: "Trusted gateway replay protection is unavailable.",
      }, 503);
    }
    if (claimed !== true) {
      return c.json(
        { error: "Trusted gateway request was already used." },
        401,
      );
    }
    verifiedClientIdentities.set(
      c.req.raw,
      `edge:${verification.clientIdentity}`,
    );
    return next();
  };
