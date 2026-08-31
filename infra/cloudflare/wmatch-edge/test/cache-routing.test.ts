import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Fetcher } from "../src/crypto";
import {
  createMemoryCache,
  invoke,
  jsonResponse,
  makeEnv,
  requestUrl,
} from "./helpers";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

afterEach(() => {
  vi.restoreAllMocks();
});

function trendingRequest(query: string, headers?: HeadersInit): Request {
  return new Request(`https://edge.example.test/tmdb/trending/all/week?${query}`, {
    headers: {
      "cf-connecting-ip": "203.0.113.44",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

describe("public TMDB cache boundary", () => {
  it("uses one canonical, versioned key for equivalent public queries", async () => {
    const memory = createMemoryCache();
    let originCalls = 0;
    const fetcher = vi.fn(async () => {
      originCalls += 1;
      return jsonResponse({ page: 1, results: [{ id: 1 }] });
    }) as unknown as Fetcher;
    const env = makeEnv();

    const first = await invoke(
      trendingRequest("page=01&language=tr-tr"),
      env,
      { cache: memory.cache, fetcher },
    );
    const second = await invoke(
      trendingRequest("language=tr-TR&page=1", { "x-request-id": "second-request-2" }),
      env,
      { cache: memory.cache, fetcher },
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("x-wmatch-cache")).toBe("MISS");
    expect(second.status).toBe(200);
    expect(second.headers.get("x-wmatch-cache")).toBe("HIT");
    expect(second.headers.get("x-request-id")).toBe("second-request-2");
    expect(originCalls).toBe(1);
    expect(memory.entries.size).toBe(1);
    expect([...memory.entries.keys()][0]).toContain("__wmatch_cache_version=test-v1");
  });

  it("bypasses shared cache whenever a Cookie is present", async () => {
    const memory = createMemoryCache();
    const fetcher = vi.fn(async () =>
      jsonResponse({ page: 1, results: [{ id: 1 }] }),
    ) as unknown as Fetcher;
    const request = () => trendingRequest("language=tr-TR&page=1", { cookie: "session=user-a" });

    const first = await invoke(request(), makeEnv(), { cache: memory.cache, fetcher });
    const second = await invoke(request(), makeEnv(), { cache: memory.cache, fetcher });

    expect(first.headers.get("x-wmatch-cache")).toBe("BYPASS");
    expect(second.headers.get("x-wmatch-cache")).toBe("BYPASS");
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(memory.put).not.toHaveBeenCalled();
  });

  it("bypasses shared cache for Range requests", async () => {
    const memory = createMemoryCache();
    const fetcher = vi.fn(async () =>
      jsonResponse({ page: 1, results: [{ id: 1 }] }),
    ) as unknown as Fetcher;
    const request = () => trendingRequest("language=tr-TR&page=1", { range: "bytes=0-99" });

    const first = await invoke(request(), makeEnv(), { cache: memory.cache, fetcher });
    const second = await invoke(request(), makeEnv(), { cache: memory.cache, fetcher });

    expect(first.headers.get("x-wmatch-cache")).toBe("BYPASS");
    expect(second.headers.get("x-wmatch-cache")).toBe("BYPASS");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(memory.put).not.toHaveBeenCalled();
  });

  it("does not share authenticated user A and user B responses", async () => {
    const label = `cache-users-${crypto.randomUUID()}`;
    const issuer = `https://${label}.example.test/auth/v1`;
    const jwksUrl = `${issuer}/.well-known/jwks.json`;
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    publicJwk.alg = "ES256";
    publicJwk.kid = "cache-users-kid";
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const sign = (subject: string) =>
      new SignJWT({ role: "authenticated" })
        .setProtectedHeader({ alg: "ES256", kid: "cache-users-kid" })
        .setIssuer(issuer)
        .setAudience("authenticated")
        .setSubject(subject)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + 3_600)
        .sign(privateKey);
    const [tokenA, tokenB] = await Promise.all([sign(USER_A), sign(USER_B)]);
    const memory = createMemoryCache();
    let originCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).toString() === jwksUrl) {
        return jsonResponse({ keys: [publicJwk] });
      }
      originCalls += 1;
      return jsonResponse({ id: 42, marker: new Headers(init?.headers).get("authorization") });
    }) as unknown as Fetcher;
    const env = makeEnv({ JWT_ISSUER: issuer, JWT_JWKS_URL: jwksUrl });
    const detail = (token: string) =>
      new Request("https://edge.example.test/tmdb/movie/42?language=tr-TR", {
        headers: {
          authorization: `Bearer ${token}`,
          "cf-connecting-ip": "203.0.113.44",
        },
      });

    const responseA = await invoke(detail(tokenA), env, { cache: memory.cache, fetcher });
    const responseB = await invoke(detail(tokenB), env, { cache: memory.cache, fetcher });

    expect(responseA.headers.get("x-wmatch-cache")).toBe("BYPASS");
    expect(responseB.headers.get("x-wmatch-cache")).toBe("BYPASS");
    expect(originCalls).toBe(2);
    expect(memory.put).not.toHaveBeenCalled();
    expect(await responseA.text()).not.toBe(await responseB.text());
  });

  it("never caches errors, Set-Cookie responses, or invalid response schemas", async () => {
    const cases: Array<{ response: Response; expectedStatus: number }> = [
      { response: jsonResponse({ error: "failure" }, { status: 500 }), expectedStatus: 500 },
      {
        response: jsonResponse(
          { page: 1, results: [] },
          { headers: { "set-cookie": "session=unexpected" } },
        ),
        expectedStatus: 200,
      },
      { response: jsonResponse({ items: [] }), expectedStatus: 502 },
    ];

    for (const [index, testCase] of cases.entries()) {
      const memory = createMemoryCache();
      const fetcher = vi.fn(async () => testCase.response.clone()) as unknown as Fetcher;
      const response = await invoke(
        trendingRequest(`language=tr-TR&page=${String(index + 1)}`),
        makeEnv({ CACHE_VERSION: `case-${String(index)}` }),
        { cache: memory.cache, fetcher },
      );

      expect(response.status).toBe(testCase.expectedStatus);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(memory.put).not.toHaveBeenCalled();
    }
  });

  it("keeps search responses no-store and does not log the search term or client IP", async () => {
    const memory = createMemoryCache();
    const fetcher = vi.fn(async () => jsonResponse({ page: 1, results: [] })) as unknown as Fetcher;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const request = () =>
      new Request(
        "https://edge.example.test/tmdb/search/multi?query=private-search-term&page=1",
        { headers: { "cf-connecting-ip": "203.0.113.77" } },
      );

    const first = await invoke(request(), makeEnv(), { cache: memory.cache, fetcher });
    const second = await invoke(request(), makeEnv(), { cache: memory.cache, fetcher });

    expect(first.headers.get("x-wmatch-cache")).toBe("NOT_ELIGIBLE");
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(second.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(memory.put).not.toHaveBeenCalled();
    const serializedLogs = log.mock.calls.flat().join(" ");
    expect(serializedLogs).not.toContain("private-search-term");
    expect(serializedLogs).not.toContain("203.0.113.77");
  });
});

describe("strict request registry and abuse controls", () => {
  it("rejects unknown TMDB query keys before reaching origin", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ page: 1, results: [] })) as unknown as Fetcher;
    const response = await invoke(
      trendingRequest("api_key=attacker&page=1"),
      makeEnv(),
      { fetcher },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_query" } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns 405 with the exact allowed method", async () => {
    const response = await invoke(
      new Request("https://edge.example.test/tmdb/movie/42", {
        headers: { "content-type": "application/json" },
        method: "POST",
        body: "{}",
      }),
      makeEnv(),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it("rejects invalid JSON schemas and oversized bodies before origin", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true })) as unknown as Fetcher;
    const invalidSchema = await invoke(
      new Request("https://edge.example.test/auth/check-availability", {
        body: JSON.stringify({ email: "person@example.test", unexpected: true }),
        headers: {
          "cf-connecting-ip": "203.0.113.44",
          "content-type": "application/json",
        },
        method: "POST",
      }),
      makeEnv(),
      { fetcher },
    );
    const oversized = await invoke(
      new Request("https://edge.example.test/auth/check-availability", {
        body: "{}",
        headers: {
          "cf-connecting-ip": "203.0.113.44",
          "content-length": "9000",
          "content-type": "application/json",
        },
        method: "POST",
      }),
      makeEnv(),
      { fetcher },
    );

    expect(invalidSchema.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed when the rate-limit binding denies or fails", async () => {
    const deniedLimiter = {
      limit: vi.fn(async () => ({ success: false })),
    } as unknown as RateLimit;
    const failedLimiter = {
      limit: vi.fn(async () => {
        throw new Error("binding unavailable");
      }),
    } as unknown as RateLimit;
    const fetcher = vi.fn(async () => jsonResponse({ page: 1, results: [] })) as unknown as Fetcher;
    const denied = await invoke(
      trendingRequest("page=1"),
      makeEnv({ PUBLIC_RATE_LIMITER: deniedLimiter }),
      { fetcher },
    );
    const failed = await invoke(
      trendingRequest("page=1"),
      makeEnv({ PUBLIC_RATE_LIMITER: failedLimiter }),
      { fetcher },
    );

    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("60");
    expect(failed.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("applies the public limiter to health before reaching origin", async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: false })),
    } as unknown as RateLimit;
    const fetcher = vi.fn(async () => jsonResponse({ ok: true })) as unknown as Fetcher;
    const response = await invoke(
      new Request("https://edge.example.test/health", {
        headers: { "cf-connecting-ip": "203.0.113.45" },
      }),
      makeEnv({ PUBLIC_RATE_LIMITER: limiter }),
      { fetcher },
    );

    expect(response.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends only an HMAC-derived rate key to the binding", async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: true })),
    } as unknown as RateLimit;
    const fetcher = vi.fn(async () => jsonResponse({ page: 1, results: [] })) as unknown as Fetcher;
    await invoke(
      trendingRequest("page=1"),
      makeEnv({ PUBLIC_RATE_LIMITER: limiter }),
      { fetcher },
    );

    expect(limiter.limit).toHaveBeenCalledOnce();
    const options = vi.mocked(limiter.limit).mock.calls[0]?.[0];
    expect(options?.key).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(options?.key).not.toContain("203.0.113.44");
  });

  it("fails closed when deployment placeholders remain", async () => {
    const response = await invoke(
      new Request("https://edge.example.test/health"),
      makeEnv({ ORIGIN_BASE_URL: "REQUIRED__PRODUCTION_SUPABASE_FUNCTION_URL" }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "edge_not_configured" },
    });
  });
});
