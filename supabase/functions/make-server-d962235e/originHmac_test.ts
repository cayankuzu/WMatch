import { Hono } from "npm:hono@4.13.3";
import {
  createOriginHmacMiddleware,
  getCanonicalOriginPath,
  verifyOriginHmacRequest,
} from "./originHmac.ts";

const encoder = new TextEncoder();
const ACTIVE_KEY_ID = "test-active-v1";
const ACTIVE_SECRET = "test-origin-secret-with-more-than-thirty-two-bytes";
const CLIENT_IDENTITY = "A".repeat(43);
const NONCE = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "request-test-123";

const base64Url = (bytes: ArrayBuffer) => {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

const sha256Hex = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sign = async (secret: string, canonical: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return `v1=${
    base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)))
  }`;
};

const signedRequest = async ({
  body = '{"details":"bounded report details"}',
  keyId = ACTIVE_KEY_ID,
  method = "POST",
  secret = ACTIVE_SECRET,
  timestamp,
  url = "https://origin.example.test/make-server-d962235e/reports?b=2&a=1",
}: {
  body?: string;
  keyId?: string;
  method?: "GET" | "POST";
  secret?: string;
  timestamp: number;
  url?: string;
}) => {
  const bodyHash = await sha256Hex(body);
  const canonical = [
    "wmatch-origin-v1",
    keyId,
    String(timestamp),
    NONCE,
    method,
    getCanonicalOriginPath(url),
    bodyHash,
    REQUEST_ID,
    CLIENT_IDENTITY,
  ].join("\n");

  return new Request(url, {
    body: method === "GET" ? undefined : body,
    method,
    headers: {
      "content-type": "application/json",
      "x-request-id": REQUEST_ID,
      "x-wmatch-client-identity": CLIENT_IDENTITY,
      "x-wmatch-origin-body-sha256": bodyHash,
      "x-wmatch-origin-key-id": keyId,
      "x-wmatch-origin-nonce": NONCE,
      "x-wmatch-origin-signature": await sign(secret, canonical),
      "x-wmatch-origin-timestamp": String(timestamp),
    },
  });
};

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("origin HMAC accepts the exact nine-line canonical request", async () => {
  const nowMs = 1_800_000_000_000;
  const request = await signedRequest({ timestamp: Math.floor(nowMs / 1_000) });
  const result = await verifyOriginHmacRequest(request, {
    canonicalPathPrefix: "/functions/v1",
    keys: new Map([[ACTIVE_KEY_ID, ACTIVE_SECRET]]),
    maxSkewSeconds: 60,
    nowMs,
  });
  assert(result.ok, "valid signature should pass");
});

Deno.test("origin HMAC canonicalizes query order and verifies an empty GET body", async () => {
  const nowMs = 1_800_000_000_000;
  const url =
    "https://origin.example.test/make-server-d962235e/tmdb/movie/42?region=TR&language=tr-TR";
  assert(
    getCanonicalOriginPath(url) ===
      "/functions/v1/make-server-d962235e/tmdb/movie/42?language=tr-TR&region=TR",
    "canonical query must be sorted",
  );
  const request = await signedRequest({
    body: "",
    method: "GET",
    timestamp: Math.floor(nowMs / 1_000),
    url,
  });
  const result = await verifyOriginHmacRequest(request, {
    canonicalPathPrefix: "/functions/v1",
    keys: new Map([[ACTIVE_KEY_ID, ACTIVE_SECRET]]),
    maxSkewSeconds: 60,
    nowMs,
  });
  assert(result.ok, "signed GET with empty body should pass");
});

Deno.test("origin HMAC rejects body and signature tampering", async () => {
  const nowMs = 1_800_000_000_000;
  const signed = await signedRequest({ timestamp: Math.floor(nowMs / 1_000) });
  const tampered = new Request(signed, {
    body: '{"details":"tampered report"}',
  });
  const result = await verifyOriginHmacRequest(tampered, {
    canonicalPathPrefix: "/functions/v1",
    keys: new Map([[ACTIVE_KEY_ID, ACTIVE_SECRET]]),
    maxSkewSeconds: 60,
    nowMs,
  });
  assert(!result.ok && result.status === 401, "tampered body must fail");
});

Deno.test("origin HMAC rejects a declared oversized body before hashing", async () => {
  const nowMs = 1_800_000_000_000;
  const request = await signedRequest({ timestamp: Math.floor(nowMs / 1_000) });
  request.headers.set("content-length", "32769");
  const result = await verifyOriginHmacRequest(request, {
    canonicalPathPrefix: "/functions/v1",
    keys: new Map([[ACTIVE_KEY_ID, ACTIVE_SECRET]]),
    maxSkewSeconds: 60,
    nowMs,
  });
  assert(
    !result.ok && result.status === 413,
    "declared oversized body must fail",
  );
});

Deno.test("origin HMAC rejects an undeclared chunked oversized body", async () => {
  const nowMs = 1_800_000_000_000;
  const body = "x".repeat(32_769);
  const signed = await signedRequest({
    body,
    timestamp: Math.floor(nowMs / 1_000),
  });
  const first = encoder.encode(body.slice(0, 16_384));
  const second = encoder.encode(body.slice(16_384));
  const request = new Request(signed.url, {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    }),
    headers: signed.headers,
    method: "POST",
  });
  assert(
    request.headers.get("content-length") === null,
    "stream must be undeclared",
  );
  const result = await verifyOriginHmacRequest(request, {
    canonicalPathPrefix: "/functions/v1",
    keys: new Map([[ACTIVE_KEY_ID, ACTIVE_SECRET]]),
    maxSkewSeconds: 60,
    nowMs,
  });
  assert(
    !result.ok && result.status === 413,
    "streamed oversized body must fail",
  );
});

Deno.test("origin HMAC rejects unknown keys and malformed signed identity fields", async () => {
  const nowMs = 1_800_000_000_000;
  const base = await signedRequest({ timestamp: Math.floor(nowMs / 1_000) });
  const variants = [
    ["x-wmatch-origin-key-id", "unknown-v1"],
    ["x-wmatch-origin-body-sha256", "0".repeat(64)],
    ["x-request-id", "bad id"],
    ["x-wmatch-client-identity", "too-short"],
    ["x-wmatch-origin-signature", `v1=${"A".repeat(43)}`],
  ] as const;

  for (const [header, value] of variants) {
    const request = base.clone();
    request.headers.set(header, value);
    const result = await verifyOriginHmacRequest(request, {
      canonicalPathPrefix: "/functions/v1",
      keys: new Map([[ACTIVE_KEY_ID, ACTIVE_SECRET]]),
      maxSkewSeconds: 60,
      nowMs,
    });
    assert(
      !result.ok && result.status === 401,
      `${header} tampering must fail`,
    );
  }
});

Deno.test("origin HMAC rejects past and future timestamps outside the window", async () => {
  const nowMs = 1_800_000_000_000;
  for (
    const timestamp of [
      Math.floor(nowMs / 1_000) - 61,
      Math.floor(nowMs / 1_000) + 61,
    ]
  ) {
    const request = await signedRequest({ timestamp });
    const result = await verifyOriginHmacRequest(request, {
      canonicalPathPrefix: "/functions/v1",
      keys: new Map([[ACTIVE_KEY_ID, ACTIVE_SECRET]]),
      maxSkewSeconds: 60,
      nowMs,
    });
    assert(
      !result.ok && result.status === 401,
      "out-of-window timestamp must fail",
    );
  }
});

Deno.test("origin HMAC supports an explicitly configured previous rotation key", async () => {
  const nowMs = 1_800_000_000_000;
  const previousKeyId = "test-previous-v1";
  const previousSecret =
    "previous-origin-secret-with-more-than-thirty-two-bytes";
  const request = await signedRequest({
    keyId: previousKeyId,
    secret: previousSecret,
    timestamp: Math.floor(nowMs / 1_000),
  });
  const result = await verifyOriginHmacRequest(request, {
    canonicalPathPrefix: "/functions/v1",
    keys: new Map([
      [ACTIVE_KEY_ID, ACTIVE_SECRET],
      [previousKeyId, previousSecret],
    ]),
    maxSkewSeconds: 60,
    nowMs,
  });
  assert(
    result.ok && result.keyId === previousKeyId,
    "previous key should pass during rotation",
  );
});

Deno.test({
  name: "origin HMAC middleware enforces shadow, required, and nonce outcomes",
  permissions: { env: true },
  fn: async () => {
    const names = [
      "REQUIRE_CLOUDFLARE_ORIGIN_HMAC",
      "ORIGIN_HMAC_KEY_ID",
      "ORIGIN_HMAC_SECRET",
      "ORIGIN_HMAC_PREVIOUS_KEY_ID",
      "ORIGIN_HMAC_PREVIOUS_SECRET",
      "ORIGIN_HMAC_MAX_SKEW_SECONDS",
    ];
    const previous = new Map(names.map((name) => [name, Deno.env.get(name)]));

    try {
      Deno.env.set("ORIGIN_HMAC_KEY_ID", ACTIVE_KEY_ID);
      Deno.env.set("ORIGIN_HMAC_SECRET", ACTIVE_SECRET);
      Deno.env.set("ORIGIN_HMAC_MAX_SKEW_SECONDS", "60");
      Deno.env.delete("ORIGIN_HMAC_PREVIOUS_KEY_ID");
      Deno.env.delete("ORIGIN_HMAC_PREVIOUS_SECRET");

      const buildApp = (
        claim: Parameters<typeof createOriginHmacMiddleware>[0],
      ) => {
        const app = new Hono();
        app.use("*", createOriginHmacMiddleware(claim));
        app.all("*", (c) => c.text("ok"));
        return app;
      };

      Deno.env.set("REQUIRE_CLOUDFLARE_ORIGIN_HMAC", "false");
      const passApp = buildApp(() =>
        Promise.resolve({ data: true, error: null })
      );
      const unsigned = await passApp.request(
        "https://origin.example.test/make-server-d962235e/health",
      );
      assert(unsigned.status === 200, "unsigned shadow request should pass");

      const partial = await passApp.request(
        "https://origin.example.test/make-server-d962235e/health",
        { headers: { "x-wmatch-origin-key-id": ACTIVE_KEY_ID } },
      );
      assert(partial.status === 401, "partial signature headers should fail");

      Deno.env.set("REQUIRE_CLOUDFLARE_ORIGIN_HMAC", "true");
      const missing = await passApp.request(
        "https://origin.example.test/make-server-d962235e/health",
      );
      assert(
        missing.status === 401,
        "required mode should reject unsigned requests",
      );

      const signed = await signedRequest({
        timestamp: Math.floor(Date.now() / 1_000),
      });
      const replayApp = buildApp(() =>
        Promise.resolve({ data: false, error: null })
      );
      assert(
        (await replayApp.request(signed.clone())).status === 401,
        "claimed nonce should fail",
      );

      const unavailableApp = buildApp(() =>
        Promise.resolve({ data: null, error: new Error("db") })
      );
      assert(
        (await unavailableApp.request(signed.clone())).status === 503,
        "nonce outage should fail closed",
      );
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  },
});
