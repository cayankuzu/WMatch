import { HttpError } from "./errors";

export type WMatchEnvironment = "development" | "preview" | "production";

export interface RuntimeConfig {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly allowedRedirectOrigins: ReadonlySet<string>;
  readonly cacheVersion: string;
  readonly environment: WMatchEnvironment;
  readonly jwtAudiences: readonly string[];
  readonly jwtIssuer: string;
  readonly jwtJwksUrl: URL;
  readonly originAnonJwt: string;
  readonly originApiKey: string;
  readonly originBaseUrl: URL;
  readonly originHmacKeyId: string;
  readonly originHmacMaxSkewSeconds: number;
  readonly originHmacSecret: string;
  readonly originMaxResponseBytes: number;
  readonly originTimeoutMs: number;
  readonly rateLimitHashSecret: string;
}

const configCache = new WeakMap<object, RuntimeConfig>();
const PLACEHOLDER_PREFIX = "REQUIRED__";

function required(name: string, value: unknown, minimumLength = 1): string {
  if (
    typeof value !== "string" ||
    value.trim().length < minimumLength ||
    value.trim().startsWith(PLACEHOLDER_PREFIX)
  ) {
    throw new HttpError(
      503,
      "edge_not_configured",
      `Required edge binding ${name} is not configured.`,
    );
  }

  return value.trim();
}

function parseInteger(
  name: string,
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(required(name, value));

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(503, "edge_not_configured", `${name} is outside its safe range.`);
  }

  return parsed;
}

function parseHttpsUrl(name: string, value: unknown): URL {
  let parsed: URL;

  try {
    parsed = new URL(required(name, value));
  } catch {
    throw new HttpError(503, "edge_not_configured", `${name} must be a valid URL.`);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new HttpError(503, "edge_not_configured", `${name} must be a clean HTTPS URL.`);
  }

  return parsed;
}

function parseExactOrigins(name: string, value: unknown): ReadonlySet<string> {
  const entries = required(name, value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0 || entries.length > 16) {
    throw new HttpError(503, "edge_not_configured", `${name} must contain 1-16 origins.`);
  }

  const origins = new Set<string>();

  for (const entry of entries) {
    let parsed: URL;

    try {
      parsed = new URL(entry);
    } catch {
      throw new HttpError(503, "edge_not_configured", `${name} contains an invalid origin.`);
    }

    if (
      parsed.origin !== entry ||
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password
    ) {
      throw new HttpError(
        503,
        "edge_not_configured",
        `${name} entries must be exact HTTPS origins without paths.`,
      );
    }

    origins.add(entry);
  }

  return origins;
}

export function getRuntimeConfig(env: CloudflareBindings): RuntimeConfig {
  const cached = configCache.get(env);
  if (cached) {
    return cached;
  }

  const environmentValue = required("ENVIRONMENT", env.ENVIRONMENT);
  if (!new Set(["development", "preview", "production"]).has(environmentValue)) {
    throw new HttpError(503, "edge_not_configured", "ENVIRONMENT is invalid.");
  }

  const originBaseUrl = parseHttpsUrl("ORIGIN_BASE_URL", env.ORIGIN_BASE_URL);
  if (
    !originBaseUrl.pathname.startsWith("/functions/v1/") ||
    originBaseUrl.pathname.endsWith("/")
  ) {
    throw new HttpError(
      503,
      "edge_not_configured",
      "ORIGIN_BASE_URL must identify one Supabase Edge Function base path.",
    );
  }

  const jwtIssuerUrl = parseHttpsUrl("JWT_ISSUER", env.JWT_ISSUER);
  const jwtJwksUrl = parseHttpsUrl("JWT_JWKS_URL", env.JWT_JWKS_URL);
  if (jwtIssuerUrl.origin !== jwtJwksUrl.origin) {
    throw new HttpError(
      503,
      "edge_not_configured",
      "JWT issuer and JWKS endpoint must use the same origin.",
    );
  }

  const jwtAudiences = required("JWT_AUDIENCE", env.JWT_AUDIENCE)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (jwtAudiences.length === 0 || jwtAudiences.length > 4) {
    throw new HttpError(503, "edge_not_configured", "JWT_AUDIENCE is invalid.");
  }

  const cacheVersion = required("CACHE_VERSION", env.CACHE_VERSION);
  if (!/^[a-zA-Z0-9._-]{1,32}$/.test(cacheVersion)) {
    throw new HttpError(503, "edge_not_configured", "CACHE_VERSION is invalid.");
  }

  const originHmacKeyId = required("ORIGIN_HMAC_KEY_ID", env.ORIGIN_HMAC_KEY_ID);
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(originHmacKeyId)) {
    throw new HttpError(503, "edge_not_configured", "ORIGIN_HMAC_KEY_ID is invalid.");
  }

  const config: RuntimeConfig = Object.freeze({
    allowedOrigins: parseExactOrigins("ALLOWED_ORIGINS", env.ALLOWED_ORIGINS),
    allowedRedirectOrigins: parseExactOrigins(
      "ALLOWED_REDIRECT_ORIGINS",
      env.ALLOWED_REDIRECT_ORIGINS,
    ),
    cacheVersion,
    environment: environmentValue as WMatchEnvironment,
    jwtAudiences,
    jwtIssuer: jwtIssuerUrl.toString().replace(/\/$/, ""),
    jwtJwksUrl,
    originAnonJwt: required("ORIGIN_ANON_JWT", env.ORIGIN_ANON_JWT, 32),
    originApiKey: required("ORIGIN_API_KEY", env.ORIGIN_API_KEY, 24),
    originBaseUrl,
    originHmacKeyId,
    originHmacMaxSkewSeconds: parseInteger(
      "ORIGIN_HMAC_MAX_SKEW_SECONDS",
      env.ORIGIN_HMAC_MAX_SKEW_SECONDS,
      30,
      300,
    ),
    originHmacSecret: required("ORIGIN_HMAC_SECRET", env.ORIGIN_HMAC_SECRET, 32),
    originMaxResponseBytes: parseInteger(
      "ORIGIN_MAX_RESPONSE_BYTES",
      env.ORIGIN_MAX_RESPONSE_BYTES,
      65_536,
      5_242_880,
    ),
    originTimeoutMs: parseInteger("ORIGIN_TIMEOUT_MS", env.ORIGIN_TIMEOUT_MS, 500, 15_000),
    rateLimitHashSecret: required(
      "RATE_LIMIT_HASH_SECRET",
      env.RATE_LIMIT_HASH_SECRET,
      32,
    ),
  });

  configCache.set(env, config);
  return config;
}
