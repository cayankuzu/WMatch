export const MAX_EXPO_PUSH_TOKEN_LENGTH = 220;
export const EXPO_PUSH_TOKEN_PATTERN =
  /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{20,200}\]$/;

export const normalizeExpoPushToken = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const token = value.trim();
  return token.length <= MAX_EXPO_PUSH_TOKEN_LENGTH &&
      EXPO_PUSH_TOKEN_PATTERN.test(token)
    ? token
    : null;
};

export const normalizePushPlatform = (value: unknown) => {
  const platform = typeof value === "string"
    ? value.trim().toLowerCase()
    : "unknown";
  return platform === "ios" || platform === "android" ? platform : "unknown";
};

