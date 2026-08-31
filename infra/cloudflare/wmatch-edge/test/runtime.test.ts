import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Worker runtime integration", () => {
  it("never exposes the internal push outbox drain route", async () => {
    const response = await exports.default.fetch(
      new Request("https://edge.example.test/notifications/push-outbox/drain", {
        headers: { "content-type": "application/json" },
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "route_not_found" },
    });
  });

  it("keeps the retired signup endpoint closed at the edge", async () => {
    const response = await exports.default.fetch(
      new Request("https://edge.example.test/auth/signup", {
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          "content-type": "application/json",
        },
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("answers only exact CORS preflights", async () => {
    const allowed = await exports.default.fetch(
      new Request("https://edge.example.test/reports", {
        headers: {
          "access-control-request-headers": "authorization, content-type",
          "access-control-request-method": "POST",
          origin: "https://app.example.test",
        },
        method: "OPTIONS",
      }),
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.test",
    );

    const denied = await exports.default.fetch(
      new Request("https://edge.example.test/reports", {
        headers: {
          "access-control-request-method": "POST",
          origin: "https://evil.example.test",
        },
        method: "OPTIONS",
      }),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });
});
