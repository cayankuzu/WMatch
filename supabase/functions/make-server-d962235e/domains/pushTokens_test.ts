import {
  MAX_EXPO_PUSH_TOKEN_LENGTH,
  normalizeExpoPushToken,
  normalizePushPlatform,
} from "./pushTokens.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("Expo push token validation accepts only a complete bounded envelope", () => {
  const modern = `ExpoPushToken[${"A1_-".repeat(6)}]`;
  const legacy = `ExponentPushToken[${"z9_-".repeat(6)}]`;

  assert(normalizeExpoPushToken(` ${modern} `) === modern, "modern token must normalize");
  assert(normalizeExpoPushToken(legacy) === legacy, "legacy token must normalize");
  assert(normalizeExpoPushToken("ExpoPushToken[short]") === null, "short token must fail");
  assert(
    normalizeExpoPushToken(`ExpoPushToken[${"a".repeat(20)}]trailing`) === null,
    "trailing bytes must fail",
  );
  assert(
    normalizeExpoPushToken(`ExpoPushToken[${"a".repeat(MAX_EXPO_PUSH_TOKEN_LENGTH)}]`) === null,
    "oversized token must fail",
  );
  assert(
    normalizeExpoPushToken(`ExpoPushToken[${"a".repeat(19)}!]`) === null,
    "invalid inner characters must fail",
  );
});

Deno.test("push platforms normalize to the DB allowlist", () => {
  assert(normalizePushPlatform(" Android ") === "android", "Android must normalize");
  assert(normalizePushPlatform("ios") === "ios", "iOS must remain valid");
  assert(normalizePushPlatform("web") === "unknown", "unknown platforms must be bounded");
});

