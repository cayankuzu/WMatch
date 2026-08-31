import type { RuntimeConfig } from "./config";
import { HttpError } from "./errors";

const textEncoder = new TextEncoder();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[a-zA-Z0-9_-]+$/;
const JWKS_MAX_BYTES = 65_536;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1_000;
const JWKS_RELOAD_COOLDOWN_MS = 30_000;
const JWT_CLOCK_TOLERANCE_SECONDS = 5;

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type JsonRecord = Record<string, unknown>;

interface JsonWebKeySet {
  readonly keys: readonly JsonRecord[];
}

interface JwksCacheEntry {
  readonly expiresAt: number;
  readonly fetchedAt: number;
  readonly jwks: JsonWebKeySet;
}

export interface VerifiedIdentity {
  readonly payload: Readonly<JsonRecord>;
  readonly subject: string;
}

export interface OriginSignatureInput {
  readonly bodyHash: string;
  readonly canonicalOriginPath: string;
  readonly clientIdentityHash: string;
  readonly method: string;
  readonly nonce: string;
  readonly requestId: string;
  readonly timestamp: string;
}

class NoMatchingJwkError extends Error {}

const jwksCache = new Map<string, JwksCacheEntry>();

function base64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let decoded: string;
  try {
    decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  } catch {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function parseJwtObject(segment: string, maximumBytes: number): JsonRecord {
  const bytes = decodeBase64Url(segment);
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  return value as JsonRecord;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
}

async function hmac(secret: string, value: string): Promise<ArrayBuffer> {
  const key = await importHmacKey(secret);
  return crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer));
}

export async function hashRateLimitIdentity(secret: string, value: string): Promise<string> {
  return base64Url(await hmac(secret, value));
}

export async function createOriginSignature(
  secret: string,
  keyId: string,
  input: OriginSignatureInput,
): Promise<string> {
  const canonical = [
    "wmatch-origin-v1",
    keyId,
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.canonicalOriginPath,
    input.bodyHash,
    input.requestId,
    input.clientIdentityHash,
  ].join("\n");

  return `v1=${base64Url(await hmac(secret, canonical))}`;
}

function validateJwks(value: unknown): JsonWebKeySet {
  if (!value || typeof value !== "object" || !Array.isArray((value as { keys?: unknown }).keys)) {
    throw new HttpError(503, "jwks_unavailable", "JWT verification keys are unavailable.");
  }

  const rawKeys = (value as { keys: unknown[] }).keys;
  if (rawKeys.length < 1 || rawKeys.length > 10) {
    throw new HttpError(503, "jwks_unavailable", "JWT verification keys are unavailable.");
  }

  const keys: JsonRecord[] = [];
  for (const rawKey of rawKeys) {
    if (!rawKey || typeof rawKey !== "object" || Array.isArray(rawKey)) {
      throw new HttpError(503, "jwks_unavailable", "JWT verification keys are invalid.");
    }

    const key = rawKey as JsonRecord;
    if (
      !new Set(["EC", "OKP", "RSA"]).has(String(key.kty)) ||
      typeof key.kid !== "string" ||
      key.kid.length < 1 ||
      key.kid.length > 128 ||
      key.d !== undefined ||
      key.k !== undefined
    ) {
      throw new HttpError(503, "jwks_unavailable", "JWT verification keys are invalid.");
    }
    keys.push(key);
  }

  return { keys };
}

async function readBoundedJwks(response: Response): Promise<string> {
  const body = response.body;
  if (!body) {
    throw new HttpError(503, "jwks_unavailable", "JWT verification keys are unavailable.");
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      total += chunk.value.byteLength;
      if (total > JWKS_MAX_BYTES) {
        await reader.cancel();
        throw new HttpError(503, "jwks_unavailable", "JWT verification keys are unavailable.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new HttpError(503, "jwks_unavailable", "JWT verification keys are unavailable.");
  }
}

async function loadJwks(
  config: RuntimeConfig,
  fetcher: Fetcher,
  now: number,
  forceReload: boolean,
): Promise<{ entry: JwksCacheEntry; fromCache: boolean }> {
  const cacheKey = config.jwtJwksUrl.toString();
  const cached = jwksCache.get(cacheKey);
  if (!forceReload && cached && cached.expiresAt > now) {
    return { entry: cached, fromCache: true };
  }

  let response: Response;
  try {
    response = await fetcher(config.jwtJwksUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    throw new HttpError(503, "jwks_unavailable", "JWT verification keys are unavailable.");
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    !response.ok ||
    (contentLength > 0 && contentLength > JWKS_MAX_BYTES) ||
    !contentType.includes("application/json")
  ) {
    throw new HttpError(503, "jwks_unavailable", "JWT verification keys are unavailable.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBoundedJwks(response));
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(503, "jwks_unavailable", "JWT verification keys are unavailable.");
  }

  const entry: JwksCacheEntry = {
    expiresAt: now + JWKS_CACHE_TTL_MS,
    fetchedAt: now,
    jwks: validateJwks(parsed),
  };
  jwksCache.set(cacheKey, entry);

  while (jwksCache.size > 8) {
    const oldest = jwksCache.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    jwksCache.delete(oldest);
  }

  return { entry, fromCache: false };
}

function selectJwk(jwks: JsonWebKeySet, kid: string, algorithm: string): JsonRecord {
  const matching = jwks.keys.filter((key) => key.kid === kid);
  if (matching.length === 0) {
    throw new NoMatchingJwkError();
  }
  if (matching.length !== 1) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  const key = matching[0];
  if (!key) {
    throw new NoMatchingJwkError();
  }

  const validKeyOps =
    key.key_ops === undefined ||
    (Array.isArray(key.key_ops) && key.key_ops.every((value) => typeof value === "string") && key.key_ops.includes("verify"));
  if (
    (key.use !== undefined && key.use !== "sig") ||
    (key.alg !== undefined && key.alg !== algorithm) ||
    !validKeyOps ||
    (algorithm === "ES256" && (key.kty !== "EC" || key.crv !== "P-256")) ||
    (algorithm === "RS256" && key.kty !== "RSA")
  ) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  return key;
}

async function verifyJwtSignature(
  algorithm: string,
  keyValue: JsonRecord,
  signingInput: string,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    if (algorithm === "ES256") {
      if (signature.byteLength !== 64) {
        return false;
      }
      const key = await crypto.subtle.importKey(
        "jwk",
        keyValue as unknown as JsonWebKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      return crypto.subtle.verify(
        { hash: "SHA-256", name: "ECDSA" },
        key,
        signature.slice().buffer as ArrayBuffer,
        textEncoder.encode(signingInput),
      );
    }

    const key = await crypto.subtle.importKey(
      "jwk",
      keyValue as unknown as JsonWebKey,
      { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature.slice().buffer as ArrayBuffer,
      textEncoder.encode(signingInput),
    );
  } catch {
    return false;
  }
}

function audienceMatches(value: unknown, allowed: readonly string[]): boolean {
  if (typeof value === "string") {
    return allowed.includes(value);
  }

  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8 &&
    value.every((entry) => typeof entry === "string") &&
    value.some((entry) => allowed.includes(entry as string))
  );
}

function validateClaims(
  payload: JsonRecord,
  config: RuntimeConfig,
  nowMilliseconds: number,
): VerifiedIdentity {
  const now = Math.floor(nowMilliseconds / 1_000);
  if (
    payload.iss !== config.jwtIssuer ||
    !audienceMatches(payload.aud, config.jwtAudiences) ||
    typeof payload.sub !== "string" ||
    !UUID_PATTERN.test(payload.sub) ||
    payload.role !== "authenticated" ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    Number(payload.iat) > now + JWT_CLOCK_TOLERANCE_SECONDS ||
    Number(payload.exp) <= now - JWT_CLOCK_TOLERANCE_SECONDS ||
    Number(payload.exp) <= Number(payload.iat) ||
    (payload.nbf !== undefined &&
      (!Number.isInteger(payload.nbf) ||
        Number(payload.nbf) > now + JWT_CLOCK_TOLERANCE_SECONDS))
  ) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  return { payload, subject: payload.sub };
}

async function verifyWithJwks(
  segments: readonly [string, string, string],
  header: JsonRecord,
  payload: JsonRecord,
  config: RuntimeConfig,
  jwks: JsonWebKeySet,
  now: number,
): Promise<VerifiedIdentity> {
  const algorithm = header.alg;
  const kid = header.kid;
  if (
    (algorithm !== "ES256" && algorithm !== "RS256") ||
    typeof kid !== "string" ||
    kid.length < 1 ||
    kid.length > 128 ||
    (header.typ !== undefined && header.typ !== "JWT") ||
    header.crit !== undefined ||
    header.b64 !== undefined ||
    header.jku !== undefined ||
    header.jwk !== undefined ||
    header.x5u !== undefined
  ) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  const key = selectJwk(jwks, kid, algorithm);
  const verified = await verifyJwtSignature(
    algorithm,
    key,
    `${segments[0]}.${segments[1]}`,
    decodeBase64Url(segments[2]),
  );
  if (!verified) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  return validateClaims(payload, config, now);
}

export async function verifyAccessToken(
  token: string,
  config: RuntimeConfig,
  fetcher: Fetcher,
  now = Date.now(),
): Promise<VerifiedIdentity> {
  if (token.length < 64 || token.length > 8_192) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }

  const rawSegments = token.split(".");
  if (rawSegments.length !== 3 || rawSegments.some((segment) => segment.length === 0)) {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }
  const segments = rawSegments as [string, string, string];
  const header = parseJwtObject(segments[0], 2_048);
  const payload = parseJwtObject(segments[1], 16_384);
  const loaded = await loadJwks(config, fetcher, now, false);

  try {
    return await verifyWithJwks(segments, header, payload, config, loaded.entry.jwks, now);
  } catch (error) {
    if (
      !(error instanceof NoMatchingJwkError) ||
      !loaded.fromCache ||
      now - loaded.entry.fetchedAt < JWKS_RELOAD_COOLDOWN_MS
    ) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(401, "invalid_token", "The access token is invalid.");
    }
  }

  const reloaded = await loadJwks(config, fetcher, now, true);
  try {
    return await verifyWithJwks(segments, header, payload, config, reloaded.entry.jwks, now);
  } catch {
    throw new HttpError(401, "invalid_token", "The access token is invalid.");
  }
}
