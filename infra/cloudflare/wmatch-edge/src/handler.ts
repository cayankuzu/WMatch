import { getRuntimeConfig, type RuntimeConfig } from "./config";
import {
  createOriginSignature,
  hashRateLimitIdentity,
  sha256Hex,
  verifyAccessToken,
  type Fetcher,
  type VerifiedIdentity,
} from "./crypto";
import { asSafeHttpError, HttpError } from "./errors";
import {
  matchRoute,
  validateMethod,
  validateResponseContract,
  type MatchedRoute,
  type RateLimitBindingName,
} from "./routes";

const EMPTY_BYTES = new Uint8Array();
const RETRYABLE_GET_STATUSES = new Set([502, 503, 504]);
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
const CF_RAY_PATTERN = /^[a-zA-Z0-9-]{1,64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9._:/-]{8,128}$/;
const ALLOWED_PREFLIGHT_HEADERS = new Set([
  "authorization",
  "content-type",
  "idempotency-key",
  "x-request-id",
  "x-wmatch-install-id",
]);

type CacheOutcome = "BYPASS" | "HIT" | "MISS" | "NOT_ELIGIBLE";
type RateLimitOutcome = "allowed" | "binding_error" | "denied" | "not_applied";
type AuthOutcome = "anonymous" | "invalid" | "not_applied" | "verified";

export interface HandlerDependencies {
  readonly cache?: Cache;
  readonly fetcher?: Fetcher;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
}

interface OriginResult {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly headers: Headers;
  readonly latencyMs: number;
  readonly originRequestId: string | null;
  readonly status: number;
}

interface RequestTelemetry {
  auth: AuthOutcome;
  cache: CacheOutcome;
  cfRay: string | null;
  code: string;
  environment: string;
  method: string;
  originLatencyMs: number | null;
  originRequestId: string | null;
  rateLimit: RateLimitOutcome;
  requestId: string;
  route: string;
  status: number;
  workerVersion: string;
}

function validRequestId(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function validCfRay(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return CF_RAY_PATTERN.test(trimmed) ? trimmed : null;
}

function getWorkerVersion(env: CloudflareBindings): string {
  const metadata = env.WORKER_VERSION as
    | { id?: unknown; tag?: unknown; timestamp?: unknown }
    | undefined;
  const candidate =
    typeof metadata?.tag === "string" && metadata.tag
      ? metadata.tag
      : typeof metadata?.id === "string"
        ? metadata.id
        : "local";

  return candidate.slice(0, 80);
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("vary")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const values = new Set(existing ?? []);
  values.add(value);
  headers.set("vary", [...values].join(", "));
}

function finalizeResponse(
  response: Response,
  requestId: string,
  workerVersion: string,
  corsOrigin: string | null,
): Response {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-request-id", requestId);
  headers.set("x-wmatch-edge-version", workerVersion);

  if (!headers.has("cache-control")) {
    headers.set("cache-control", "private, no-store");
  }

  if (corsOrigin) {
    headers.set("access-control-allow-origin", corsOrigin);
    headers.set(
      "access-control-expose-headers",
      "retry-after, x-request-id, x-wmatch-cache, x-wmatch-edge-version, x-wmatch-origin-request-id",
    );
    appendVary(headers, "Origin");
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function errorResponse(error: HttpError, requestId: string): Response {
  const headers = new Headers(error.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(
    JSON.stringify({
      error: { code: error.code, message: error.message },
      requestId,
    }),
    { headers, status: error.status },
  );
}

function logRequest(telemetry: RequestTelemetry, startedAt: number): void {
  const event = {
    auth: telemetry.auth,
    cache: telemetry.cache,
    cfRay: telemetry.cfRay,
    code: telemetry.code,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    environment: telemetry.environment,
    event: "wmatch_edge_request",
    method: telemetry.method,
    originLatencyMs: telemetry.originLatencyMs,
    originRequestId: telemetry.originRequestId,
    rateLimit: telemetry.rateLimit,
    requestId: telemetry.requestId,
    route: telemetry.route,
    status: telemetry.status,
    workerVersion: telemetry.workerVersion,
  };

  const serialized = JSON.stringify(event);
  if (telemetry.status >= 500) {
    console.error(serialized);
  } else if (telemetry.status >= 400) {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

function validateCorsOrigin(request: Request, config: RuntimeConfig): string | null {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) {
    return null;
  }

  if (rawOrigin.length > 256 || !config.allowedOrigins.has(rawOrigin)) {
    throw new HttpError(403, "origin_not_allowed", "The request origin is not allowed.");
  }

  return rawOrigin;
}

function preflightResponse(request: Request, route: MatchedRoute, corsOrigin: string | null): Response {
  if (!corsOrigin) {
    throw new HttpError(400, "invalid_preflight", "CORS preflight requires an Origin header.");
  }

  const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
  if (requestedMethod !== route.definition.method) {
    throw new HttpError(405, "method_not_allowed", "The requested CORS method is not allowed.", {
      Allow: route.definition.method,
    });
  }

  const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !ALLOWED_PREFLIGHT_HEADERS.has(header))) {
    throw new HttpError(403, "header_not_allowed", "A requested CORS header is not allowed.");
  }

  return new Response(null, {
    headers: {
      "access-control-allow-headers": [...ALLOWED_PREFLIGHT_HEADERS].sort().join(", "),
      "access-control-allow-methods": route.definition.method,
      "access-control-max-age": "600",
      "cache-control": "private, no-store",
    },
    status: 204,
  });
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  contentLengthValue: string | null,
  maximumBytes: number,
  errorCode: string,
  errorStatus = 413,
): Promise<Uint8Array> {
  const contentLength = contentLengthValue === null ? null : Number(contentLengthValue);
  if (
    contentLength !== null &&
    (!Number.isInteger(contentLength) || contentLength < 0 || contentLength > maximumBytes)
  ) {
    throw new HttpError(errorStatus, errorCode, "The payload is too large.");
  }

  if (!body) {
    return EMPTY_BYTES;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new HttpError(errorStatus, errorCode, "The payload is too large.");
      }
      chunks.push(chunk.value);
    }
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
}

function parseJson(bytes: Uint8Array, errorCode: string, errorStatus = 400): unknown {
  if (bytes.byteLength === 0) {
    throw new HttpError(errorStatus, errorCode, "A JSON body is required.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new HttpError(errorStatus, errorCode, "The JSON body is not valid UTF-8.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(errorStatus, errorCode, "The JSON body is malformed.");
  }
}

async function readAndValidateRequestBody(
  request: Request,
  route: MatchedRoute,
  config: RuntimeConfig,
): Promise<Uint8Array> {
  if (route.definition.method === "GET") {
    if (request.body || Number(request.headers.get("content-length") ?? "0") > 0) {
      throw new HttpError(400, "unexpected_body", "This route does not accept a body.");
    }
    return EMPTY_BYTES;
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }

  const bytes = await readBoundedBody(
    request.body,
    request.headers.get("content-length"),
    route.definition.bodyLimit,
    "request_too_large",
  );
  const parsed = parseJson(bytes, "invalid_body");
  route.definition.validateBody?.(parsed, config);
  return bytes;
}

function parseBearer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const match = /^Bearer ([^\s,]+)$/.exec(authorization);
  if (!match?.[1]) {
    throw new HttpError(401, "invalid_token", "The Authorization header is invalid.");
  }

  return match[1];
}

async function authenticate(
  request: Request,
  route: MatchedRoute,
  config: RuntimeConfig,
  fetcher: Fetcher,
  now: number,
): Promise<VerifiedIdentity | null> {
  if (route.definition.auth === "none") {
    return null;
  }

  const token = parseBearer(request);
  if (!token) {
    if (route.definition.auth === "required") {
      throw new HttpError(401, "authentication_required", "A valid access token is required.");
    }
    return null;
  }

  return verifyAccessToken(token, config, fetcher, now);
}

function getClientIp(request: Request): string | null {
  const value = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (!value || value.length > 64 || !/^[0-9a-f:.]+$/i.test(value)) {
    return null;
  }

  return value.toLowerCase();
}

function getRateLimiter(
  env: CloudflareBindings,
  bindingName: RateLimitBindingName,
): RateLimit {
  return env[bindingName];
}

async function applyRateLimit(
  request: Request,
  env: CloudflareBindings,
  config: RuntimeConfig,
  route: MatchedRoute,
  identity: VerifiedIdentity | null,
): Promise<{ clientIdentityHash: string; outcome: RateLimitOutcome }> {
  const clientIp = getClientIp(request);
  if (!identity && !clientIp && config.environment !== "development") {
    throw new HttpError(503, "client_identity_unavailable", "Client identity is unavailable.");
  }

  const rawIdentity = identity ? `user:${identity.subject}` : `ip:${clientIp ?? "development"}`;
  const clientIdentityHash = await hashRateLimitIdentity(
    config.rateLimitHashSecret,
    rawIdentity,
  );

  if (!route.definition.rateLimit) {
    return { clientIdentityHash, outcome: "not_applied" };
  }

  const key = await hashRateLimitIdentity(
    config.rateLimitHashSecret,
    `${rawIdentity}:route:${route.definition.id}`,
  );

  let result: { success: boolean };
  try {
    result = await getRateLimiter(env, route.definition.rateLimit).limit({ key });
  } catch {
    throw new HttpError(503, "rate_limit_unavailable", "The abuse check is unavailable.");
  }

  if (!result.success) {
    throw new HttpError(429, "rate_limit_exceeded", "Too many requests.", {
      "Retry-After": "60",
    });
  }

  return { clientIdentityHash, outcome: "allowed" };
}

function canonicalOriginUrl(config: RuntimeConfig, route: MatchedRoute): URL {
  const url = new URL(config.originBaseUrl);
  url.pathname = `${config.originBaseUrl.pathname}${route.canonicalPath}`;
  url.search = route.normalizedQuery.toString();
  return url;
}

function validIdempotencyKey(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!value) {
    return null;
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key is invalid.");
  }

  return value;
}

async function fetchOrigin(
  request: Request,
  route: MatchedRoute,
  requestBody: Uint8Array,
  identity: VerifiedIdentity | null,
  clientIdentityHash: string,
  requestId: string,
  config: RuntimeConfig,
  fetcher: Fetcher,
  now: () => number,
  randomUUID: () => string,
): Promise<OriginResult> {
  const originUrl = canonicalOriginUrl(config, route);
  const canonicalPath = `${originUrl.pathname}${originUrl.search}`;
  const bodyHash = await sha256Hex(requestBody);
  const idempotencyKey = validIdempotencyKey(request);
  const attempts = route.definition.method === "GET" ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timestamp = String(Math.floor(now() / 1_000));
    const nonce = randomUUID();
    const signature = await createOriginSignature(config.originHmacSecret, config.originHmacKeyId, {
      bodyHash,
      canonicalOriginPath: canonicalPath,
      clientIdentityHash,
      method: route.definition.method,
      nonce,
      requestId,
      timestamp,
    });
    const headers = new Headers({
      Accept: "application/json",
      apikey: config.originApiKey,
      Authorization: identity
        ? request.headers.get("authorization") ?? `Bearer ${config.originAnonJwt}`
        : `Bearer ${config.originAnonJwt}`,
      "cache-control": "no-store",
      "x-request-id": requestId,
      "x-wmatch-client-identity": clientIdentityHash,
      "x-wmatch-origin-body-sha256": bodyHash,
      "x-wmatch-origin-key-id": config.originHmacKeyId,
      "x-wmatch-origin-nonce": nonce,
      "x-wmatch-origin-signature": signature,
      "x-wmatch-origin-timestamp": timestamp,
    });

    if (requestBody.byteLength > 0) {
      headers.set("content-type", "application/json; charset=utf-8");
    }
    if (idempotencyKey) {
      headers.set("idempotency-key", idempotencyKey);
    }

    const startedAt = performance.now();
    try {
      const response = await fetcher(originUrl, {
        body:
          requestBody.byteLength > 0
            ? (requestBody.slice().buffer as ArrayBuffer)
            : undefined,
        headers,
        method: route.definition.method,
        redirect: "error",
        signal: AbortSignal.timeout(config.originTimeoutMs),
      });
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

      if (attempt < attempts && RETRYABLE_GET_STATUSES.has(response.status)) {
        await response.body?.cancel();
        continue;
      }

      const contentLength = response.headers.get("content-length");
      const bytes = await readBoundedBody(
        response.body,
        contentLength,
        config.originMaxResponseBytes,
        "origin_response_too_large",
        502,
      );
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (response.status !== 204 && !contentType.includes("application/json")) {
        throw new HttpError(502, "invalid_origin_response", "The origin response is invalid.");
      }

      if (bytes.byteLength > 0) {
        const payload = parseJson(bytes, "invalid_origin_response", 502);
        if (
          response.ok &&
          route.responseContract !== "generic" &&
          !validateResponseContract(route.responseContract, payload)
        ) {
          throw new HttpError(502, "origin_contract_violation", "The origin response is invalid.");
        }
      }

      return {
        bytes,
        contentType: contentType || "application/json; charset=utf-8",
        headers: response.headers,
        latencyMs,
        originRequestId: validRequestId(response.headers.get("x-request-id")),
        status: response.status,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError) {
        throw error;
      }

      if (attempt >= attempts) {
        break;
      }
    }
  }

  const isTimeout =
    lastError instanceof DOMException &&
    (lastError.name === "AbortError" || lastError.name === "TimeoutError");
  throw new HttpError(
    isTimeout ? 504 : 502,
    isTimeout ? "origin_timeout" : "origin_unavailable",
    isTimeout ? "The origin timed out." : "The origin is unavailable.",
  );
}

function buildCacheKey(request: Request, route: MatchedRoute, cacheVersion: string): Request {
  const url = new URL(request.url);
  url.pathname = route.canonicalPath;
  url.search = route.normalizedQuery.toString();
  url.searchParams.set("__wmatch_cache_version", cacheVersion);
  url.searchParams.sort();
  return new Request(url.toString(), { method: "GET" });
}

function cacheEligible(request: Request, route: MatchedRoute): boolean {
  return (
    route.cacheTtlSeconds !== null &&
    request.method === "GET" &&
    !request.headers.has("authorization") &&
    !request.headers.has("cookie") &&
    !request.headers.has("range")
  );
}

function buildOriginResponse(origin: OriginResult): Response {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": origin.contentType,
  });
  const retryAfter = origin.headers.get("retry-after");
  if (retryAfter && /^\d{1,5}$/.test(retryAfter)) {
    headers.set("retry-after", retryAfter);
  }
  if (origin.originRequestId) {
    headers.set("x-wmatch-origin-request-id", origin.originRequestId);
  }

  return new Response(origin.bytes.slice().buffer as ArrayBuffer, {
    headers,
    status: origin.status,
  });
}

async function serveProxyRequest(
  request: Request,
  ctx: ExecutionContext,
  route: MatchedRoute,
  config: RuntimeConfig,
  identity: VerifiedIdentity | null,
  clientIdentityHash: string,
  requestBody: Uint8Array,
  requestId: string,
  dependencies: HandlerDependencies,
  telemetry: RequestTelemetry,
): Promise<Response> {
  const cache = dependencies.cache ?? (await caches.open("wmatch-edge-public"));
  const fetcher = dependencies.fetcher ?? ((input, init) => fetch(input, init));
  const now = dependencies.now ?? Date.now;
  const randomUUID = dependencies.randomUUID ?? crypto.randomUUID.bind(crypto);
  const eligible = cacheEligible(request, route);
  const cacheKey = eligible ? buildCacheKey(request, route, config.cacheVersion) : null;

  if (cacheKey) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      telemetry.cache = "HIT";
      const headers = new Headers(cached.headers);
      headers.set("x-wmatch-cache", "HIT");
      return new Response(cached.body, { headers, status: cached.status });
    }
    telemetry.cache = "MISS";
  } else {
    telemetry.cache = route.cacheTtlSeconds === null ? "NOT_ELIGIBLE" : "BYPASS";
  }

  const origin = await fetchOrigin(
    request,
    route,
    requestBody,
    identity,
    clientIdentityHash,
    requestId,
    config,
    fetcher,
    now,
    randomUUID,
  );
  telemetry.originLatencyMs = origin.latencyMs;
  telemetry.originRequestId = origin.originRequestId;

  const response = buildOriginResponse(origin);
  if (
    !cacheKey ||
    route.cacheTtlSeconds === null ||
    origin.status !== 200 ||
    origin.headers.has("set-cookie")
  ) {
    response.headers.set("x-wmatch-cache", telemetry.cache);
    return response;
  }

  const cacheHeaders = new Headers(response.headers);
  cacheHeaders.delete("x-wmatch-origin-request-id");
  cacheHeaders.set(
    "cache-control",
    `public, max-age=60, s-maxage=${String(route.cacheTtlSeconds)}`,
  );
  cacheHeaders.set("expires", new Date(now() + route.cacheTtlSeconds * 1_000).toUTCString());
  cacheHeaders.delete("x-wmatch-cache");
  const cacheResponse = new Response(origin.bytes.slice().buffer as ArrayBuffer, {
    headers: cacheHeaders,
    status: 200,
  });

  ctx.waitUntil(
    cache.put(cacheKey, cacheResponse.clone()).catch(() => {
      console.error(
        JSON.stringify({
          environment: config.environment,
          event: "wmatch_edge_cache_write_error",
          requestId,
          route: route.definition.id,
        }),
      );
    }),
  );

  const outgoingHeaders = new Headers(cacheResponse.headers);
  outgoingHeaders.set("x-wmatch-cache", "MISS");
  return new Response(cacheResponse.body, { headers: outgoingHeaders, status: 200 });
}

function disabledSignupResponse(): Response {
  return new Response(
    JSON.stringify({
      error:
        "This endpoint is disabled. Signup uses the existing email-verification Supabase Auth flow.",
    }),
    {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/json; charset=utf-8",
      },
      status: 410,
    },
  );
}

export async function handleRequest(
  request: Request,
  env: CloudflareBindings,
  ctx: ExecutionContext,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const startedAt = performance.now();
  const requestId = validRequestId(request.headers.get("x-request-id")) ?? crypto.randomUUID();
  const telemetry: RequestTelemetry = {
    auth: "not_applied",
    cache: "NOT_ELIGIBLE",
    cfRay: validCfRay(request.headers.get("cf-ray")),
    code: "ok",
    environment: "unconfigured",
    method: request.method,
    originLatencyMs: null,
    originRequestId: null,
    rateLimit: "not_applied",
    requestId,
    route: "unmatched",
    status: 500,
    workerVersion: getWorkerVersion(env),
  };
  let corsOrigin: string | null = null;

  try {
    const config = getRuntimeConfig(env);
    telemetry.environment = config.environment;
    const url = new URL(request.url);
    if (url.protocol !== "https:" && config.environment !== "development") {
      throw new HttpError(400, "https_required", "HTTPS is required.");
    }

    const route = matchRoute(url);
    telemetry.route = route.definition.id;
    corsOrigin = validateCorsOrigin(request, config);

    if (request.method === "OPTIONS") {
      const response = preflightResponse(request, route, corsOrigin);
      telemetry.status = response.status;
      return finalizeResponse(response, requestId, telemetry.workerVersion, corsOrigin);
    }

    validateMethod(request, route);
    const fetcher = dependencies.fetcher ?? ((input, init) => fetch(input, init));
    let identity: VerifiedIdentity | null;
    try {
      identity = await authenticate(
        request,
        route,
        config,
        fetcher,
        (dependencies.now ?? Date.now)(),
      );
      telemetry.auth = identity
        ? "verified"
        : route.definition.auth === "none"
          ? "not_applied"
          : "anonymous";
    } catch (error) {
      telemetry.auth = "invalid";
      throw error;
    }

    const requestBody = await readAndValidateRequestBody(request, route, config);
    let rateLimitResult: { clientIdentityHash: string; outcome: RateLimitOutcome };
    try {
      rateLimitResult = await applyRateLimit(request, env, config, route, identity);
      telemetry.rateLimit = rateLimitResult.outcome;
    } catch (error) {
      telemetry.rateLimit =
        error instanceof HttpError && error.status === 429 ? "denied" : "binding_error";
      throw error;
    }

    const response =
      route.definition.id === "auth_signup_disabled"
        ? disabledSignupResponse()
        : await serveProxyRequest(
            request,
            ctx,
            route,
            config,
            identity,
            rateLimitResult.clientIdentityHash,
            requestBody,
            requestId,
            dependencies,
            telemetry,
          );

    telemetry.status = response.status;
    telemetry.code = response.ok ? "ok" : `origin_${String(response.status)}`;
    return finalizeResponse(response, requestId, telemetry.workerVersion, corsOrigin);
  } catch (error) {
    const safeError = asSafeHttpError(error);
    telemetry.status = safeError.status;
    telemetry.code = safeError.code;
    return finalizeResponse(
      errorResponse(safeError, requestId),
      requestId,
      telemetry.workerVersion,
      corsOrigin,
    );
  } finally {
    logRequest(telemetry, startedAt);
  }
}
