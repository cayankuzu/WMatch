import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const testSecrets = {
  ORIGIN_ANON_JWT: "test-anon-jwt-value-that-is-longer-than-thirty-two-bytes",
  ORIGIN_API_KEY: "test-origin-api-key-that-is-longer-than-thirty-two-bytes",
  ORIGIN_HMAC_SECRET: "test-origin-hmac-secret-with-at-least-thirty-two-bytes",
  RATE_LIMIT_HASH_SECRET: "test-rate-hash-secret-with-at-least-thirty-two-bytes",
};

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
        environment: "development",
      },
      miniflare: {
        bindings: {
          ...testSecrets,
          ALLOWED_ORIGINS: "https://app.example.test",
          ALLOWED_REDIRECT_ORIGINS: "https://auth.example.test",
          CACHE_VERSION: "test-v1",
          ENVIRONMENT: "development",
          JWT_AUDIENCE: "authenticated",
          JWT_ISSUER: "https://auth.example.test/auth/v1",
          JWT_JWKS_URL: "https://auth.example.test/auth/v1/.well-known/jwks.json",
          ORIGIN_BASE_URL:
            "https://origin.example.test/functions/v1/make-server-d962235e",
          ORIGIN_HMAC_KEY_ID: "development-test-v1",
          ORIGIN_HMAC_MAX_SKEW_SECONDS: "60",
          ORIGIN_MAX_RESPONSE_BYTES: "2097152",
          ORIGIN_TIMEOUT_MS: "8000",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
