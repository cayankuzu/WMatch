import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type JWTPayload,
} from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Fetcher } from "../src/crypto";
import {
  TEST_HMAC_SECRET,
  invoke,
  jsonResponse,
  makeEnv,
  requestUrl,
} from "./helpers";

const SUBJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPORT_BODY = JSON.stringify({
  details: "This report contains enough detail.",
  reasonCode: "fake_profile",
  targetUserId: TARGET_USER,
});

interface Authority {
  readonly issuer: string;
  readonly jwksUrl: string;
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
}

async function createAuthority(label: string): Promise<Authority> {
  const kid = `${label}-kid`;
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.alg = "ES256";
  publicJwk.kid = kid;
  publicJwk.use = "sig";
  const issuer = `https://${label}.example.test/auth/v1`;

  return {
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    kid,
    privateKey,
    publicJwk,
  };
}

async function signAccessToken(
  authority: Authority,
  nowSeconds: number,
  overrides: JWTPayload = {},
): Promise<string> {
  return new SignJWT({ role: "authenticated", ...overrides })
    .setProtectedHeader({ alg: "ES256", kid: authority.kid, typ: "JWT" })
    .setIssuer(typeof overrides.iss === "string" ? overrides.iss : authority.issuer)
    .setAudience(
      typeof overrides.aud === "string" || Array.isArray(overrides.aud)
        ? overrides.aud
        : "authenticated",
    )
    .setSubject(typeof overrides.sub === "string" ? overrides.sub : SUBJECT_A)
    .setIssuedAt(typeof overrides.iat === "number" ? overrides.iat : nowSeconds)
    .setExpirationTime(typeof overrides.exp === "number" ? overrides.exp : nowSeconds + 3_600)
    .sign(authority.privateKey);
}

function envForAuthority(authority: Authority): CloudflareBindings {
  return makeEnv({
    JWT_ISSUER: authority.issuer,
    JWT_JWKS_URL: authority.jwksUrl,
  });
}

function reportRequest(token?: string): Request {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.41",
    "content-type": "application/json",
    "x-request-id": "client-request-123",
  });
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return new Request("https://edge.example.test/reports", {
    body: REPORT_BODY,
    headers,
    method: "POST",
  });
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function expectedOriginSignature(headers: Headers, originUrl: URL): Promise<string> {
  const canonical = [
    "wmatch-origin-v1",
    headers.get("x-wmatch-origin-key-id"),
    headers.get("x-wmatch-origin-timestamp"),
    headers.get("x-wmatch-origin-nonce"),
    "POST",
    `${originUrl.pathname}${originUrl.search}`,
    headers.get("x-wmatch-origin-body-sha256"),
    headers.get("x-request-id"),
    headers.get("x-wmatch-client-identity"),
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_HMAC_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  return `v1=${toBase64Url(signature)}`;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("JWT and signed origin boundary", () => {
  it("verifies a Supabase access token and replaces all origin identity headers", async () => {
    const authority = await createAuthority("signed-origin");
    const now = Date.now();
    const token = await signAccessToken(authority, Math.floor(now / 1_000));
    let capturedUrl = new URL("https://capture-not-set.invalid");
    let originCaptured = false;
    let capturedInit: RequestInit | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.toString() === authority.jwksUrl) {
        return jsonResponse({ keys: [authority.publicJwk] });
      }

      capturedUrl = url;
      originCaptured = true;
      capturedInit = init;
      return jsonResponse({ reportId: "report-1", success: true }, {
        headers: { "x-request-id": "origin-request-456" },
      });
    }) as unknown as Fetcher;
    const request = reportRequest(token);
    request.headers.set("cookie", "session=must-not-forward");
    request.headers.set("x-wmatch-origin-signature", "attacker-value");

    const response = await invoke(request, envForAuthority(authority), {
      fetcher,
      now: () => now,
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });

    expect(response.status).toBe(200);
    expect(originCaptured).toBe(true);
    expect(response.headers.get("x-wmatch-origin-request-id")).toBe("origin-request-456");
    expect(capturedUrl?.pathname).toBe(
      "/functions/v1/make-server-d962235e/reports",
    );
    const originHeaders = new Headers(capturedInit?.headers);
    expect(originHeaders.get("authorization")).toBe(`Bearer ${token}`);
    expect(originHeaders.has("cookie")).toBe(false);
    expect(originHeaders.has("cf-connecting-ip")).toBe(false);
    expect(originHeaders.get("x-wmatch-origin-signature")).not.toBe("attacker-value");
    expect(originHeaders.get("x-wmatch-origin-nonce")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(originHeaders.get("x-wmatch-origin-signature")).toBe(
      await expectedOriginSignature(originHeaders, capturedUrl),
    );
    expect(new TextDecoder().decode(capturedInit?.body as ArrayBuffer)).toBe(REPORT_BODY);
  });

  it.each([
    ["issuer", { iss: "https://wrong.example.test/auth/v1" }],
    ["audience", { aud: "wrong-audience" }],
    ["expiry", { exp: 1 }],
    ["role", { role: "service_role" }],
  ])("rejects a token with an invalid %s", async (_label, overrides) => {
    const authority = await createAuthority(`invalid-${String(_label)}`);
    const now = Date.now();
    const token = await signAccessToken(authority, Math.floor(now / 1_000), overrides);
    const origin = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ success: true }),
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.toString() === authority.jwksUrl) {
        return jsonResponse({ keys: [authority.publicJwk] });
      }
      return origin(input, init);
    }) as unknown as Fetcher;

    const response = await invoke(reportRequest(token), envForAuthority(authority), {
      fetcher,
      now: () => now,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_token" } });
    expect(origin).not.toHaveBeenCalled();
  });

  it("rejects a tampered signature", async () => {
    const authority = await createAuthority("tampered-token");
    const now = Date.now();
    const token = await signAccessToken(authority, Math.floor(now / 1_000));
    const parts = token.split(".");
    parts[1] = `${parts[1]?.slice(0, -2)}aa`;
    const tampered = parts.join(".");
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).toString() === authority.jwksUrl) {
        return jsonResponse({ keys: [authority.publicJwk] });
      }
      throw new Error("origin must not be reached");
    }) as unknown as Fetcher;

    const response = await invoke(reportRequest(tampered), envForAuthority(authority), {
      fetcher,
      now: () => now,
    });
    expect(response.status).toBe(401);
  });

  it("refreshes JWKS once when a new key id appears", async () => {
    const label = `rotation-${crypto.randomUUID()}`;
    const first = await createAuthority(label);
    const secondGenerated = await createAuthority(`${label}-next`);
    const second: Authority = {
      ...secondGenerated,
      issuer: first.issuer,
      jwksUrl: first.jwksUrl,
    };
    const now = Date.now();
    const firstToken = await signAccessToken(first, Math.floor(now / 1_000));
    const secondToken = await signAccessToken(second, Math.floor(now / 1_000));
    let activeKey = first.publicJwk;
    let jwksRequests = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).toString() === first.jwksUrl) {
        jwksRequests += 1;
        return jsonResponse({ keys: [activeKey] });
      }
      return jsonResponse({ success: true });
    }) as unknown as Fetcher;
    const env = envForAuthority(first);

    expect(
      (await invoke(reportRequest(firstToken), env, { fetcher, now: () => now })).status,
    ).toBe(200);
    activeKey = second.publicJwk;
    expect(
      (await invoke(reportRequest(secondToken), env, { fetcher, now: () => now + 31_000 })).status,
    ).toBe(200);
    expect(jwksRequests).toBe(2);
  });

  it("requires authentication before applying mutation rate limits", async () => {
    const mutationLimiter = { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit;
    const response = await invoke(reportRequest(), makeEnv({ MUTATION_RATE_LIMITER: mutationLimiter }));

    expect(response.status).toBe(401);
    expect(mutationLimiter.limit).not.toHaveBeenCalled();
  });
});

describe("bounded origin retry", () => {
  it("retries a GET once with a fresh nonce", async () => {
    const nonces: string[] = [];
    let nonceCounter = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      nonces.push(new Headers(init?.headers).get("x-wmatch-origin-nonce") ?? "");
      return nonces.length === 1
        ? jsonResponse({ error: "temporary" }, { status: 503 })
        : jsonResponse({ ok: true });
    }) as unknown as Fetcher;

    const response = await invoke(
      new Request("https://edge.example.test/health"),
      makeEnv(),
      {
        fetcher,
        randomUUID: () => `00000000-0000-4000-8000-${String(++nonceCounter).padStart(12, "0")}`,
      },
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  it("does not retry 429 responses", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "provider quota" }, { status: 429 }),
    ) as unknown as Fetcher;
    const response = await invoke(
      new Request("https://edge.example.test/health"),
      makeEnv(),
      { fetcher },
    );

    expect(response.status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("maps a bounded GET timeout to 504", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as Fetcher;
    const response = await invoke(
      new Request("https://edge.example.test/health"),
      makeEnv(),
      { fetcher },
    );

    expect(response.status).toBe(504);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "origin_timeout" } });
  });
});
