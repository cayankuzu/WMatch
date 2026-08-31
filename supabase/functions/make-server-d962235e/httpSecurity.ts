export type HeaderReader = {
  header(name: string): string | undefined;
};

export const normalizeRequestId = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(normalized) ? normalized : null;
};

const isValidIpAddress = (value: string) => {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
  }

  return value.includes(":") && /^[0-9a-f:]+$/i.test(value) && value.length <= 45;
};

export const getRequestRateLimitIdentity = (
  request: HeaderReader,
  trustedClientIpHeader: string,
) => {
  let networkIdentity: string | null = null;

  if (trustedClientIpHeader && trustedClientIpHeader !== "x-forwarded-for") {
    const value = request.header(trustedClientIpHeader)?.trim() ?? "";
    networkIdentity = value && !value.includes(",") && isValidIpAddress(value)
      ? `ip:${value}`
      : null;
  }

  const installationId = request.header("x-wmatch-install-id")?.trim().toLowerCase() ?? "";
  const installationIdentity = /^[a-f0-9]{32}$/.test(installationId)
    ? `install:${installationId}`
    : null;

  return networkIdentity ?? installationIdentity ?? "unidentified-client";
};

export const isTrustedPasswordResetRedirect = (
  value: unknown,
  expectedRedirectUrl: string,
): value is string => {
  if (typeof value !== "string" || value.length > 500) {
    return false;
  }

  try {
    const redirectUrl = new URL(value);
    const expectedUrl = new URL(expectedRedirectUrl);
    const state = redirectUrl.searchParams.get("state");

    return redirectUrl.protocol === "https:"
      && redirectUrl.origin === expectedUrl.origin
      && redirectUrl.pathname.replace(/\/$/, "") === expectedUrl.pathname.replace(/\/$/, "")
      && /^[a-f0-9]{64}$/.test(state ?? "")
      && !redirectUrl.username
      && !redirectUrl.password
      && !redirectUrl.hash;
  } catch {
    return false;
  }
};

export const buildAbuseKey = (parts: Array<string | null | undefined>) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(":");

export const normalizeIdempotencyKey = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9:._-]{8,180}$/.test(normalized) ? normalized : null;
};

export const hashIdempotencyPayload = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
