import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import { handleRequest, type HandlerDependencies } from "../src/handler";

export const TEST_HMAC_SECRET = "test-origin-hmac-secret-with-at-least-thirty-two-bytes";
export const TEST_RATE_SECRET = "test-rate-hash-secret-with-at-least-thirty-two-bytes";

export function allowRateLimiter(): RateLimit {
  return {
    limit: vi.fn(async () => ({ success: true })),
  } as unknown as RateLimit;
}

export function makeEnv(overrides: Record<string, unknown> = {}): CloudflareBindings {
  return {
    ALLOWED_ORIGINS: "https://app.example.test",
    ALLOWED_REDIRECT_ORIGINS: "https://auth.example.test",
    AUTH_RATE_LIMITER: allowRateLimiter(),
    CACHE_VERSION: "test-v1",
    ENVIRONMENT: "development",
    JWT_AUDIENCE: "authenticated",
    JWT_ISSUER: "https://auth.example.test/auth/v1",
    JWT_JWKS_URL: "https://auth.example.test/auth/v1/.well-known/jwks.json",
    MUTATION_RATE_LIMITER: allowRateLimiter(),
    ORIGIN_ANON_JWT: "test-anon-jwt-value-that-is-longer-than-thirty-two-bytes",
    ORIGIN_API_KEY: "test-origin-api-key-that-is-longer-than-thirty-two-bytes",
    ORIGIN_BASE_URL: "https://origin.example.test/functions/v1/make-server-d962235e",
    ORIGIN_HMAC_KEY_ID: "development-test-v1",
    ORIGIN_HMAC_MAX_SKEW_SECONDS: "60",
    ORIGIN_HMAC_SECRET: TEST_HMAC_SECRET,
    ORIGIN_MAX_RESPONSE_BYTES: "2097152",
    ORIGIN_TIMEOUT_MS: "8000",
    PUBLIC_RATE_LIMITER: allowRateLimiter(),
    RATE_LIMIT_HASH_SECRET: TEST_RATE_SECRET,
    WORKER_VERSION: {
      id: "00000000-0000-4000-8000-000000000001",
      tag: "test-sha",
      timestamp: "2026-08-30T00:00:00.000Z",
    },
    ...overrides,
  } as unknown as CloudflareBindings;
}

export async function invoke(
  request: Request,
  env: CloudflareBindings,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await handleRequest(request, env, ctx, dependencies);
  await waitOnExecutionContext(ctx);
  return response;
}

export function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function createMemoryCache(): {
  cache: Cache;
  entries: Map<string, Response>;
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} {
  const entries = new Map<string, Response>();
  const keyFor = (request: RequestInfo | URL) =>
    request instanceof Request ? request.url : request.toString();
  const match = vi.fn(async (request: RequestInfo | URL) => {
    const response = entries.get(keyFor(request));
    return response?.clone();
  });
  const put = vi.fn(async (request: RequestInfo | URL, response: Response) => {
    entries.set(keyFor(request), response.clone());
  });

  return {
    cache: { match, put } as unknown as Cache,
    entries,
    match,
    put,
  };
}

export function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : input.toString());
}
