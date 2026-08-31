import type { RuntimeConfig } from "./config";
import { HttpError } from "./errors";

export type AuthPolicy = "none" | "optional" | "required";
export type RateLimitBindingName =
  | "AUTH_RATE_LIMITER"
  | "MUTATION_RATE_LIMITER"
  | "PUBLIC_RATE_LIMITER";

export interface RouteDefinition {
  readonly auth: AuthPolicy;
  readonly bodyLimit: number;
  readonly id: string;
  readonly method: "GET" | "POST";
  readonly rateLimit?: RateLimitBindingName;
  readonly validateBody?: (body: unknown, config: RuntimeConfig) => void;
}

export interface MatchedRoute {
  readonly cacheTtlSeconds: number | null;
  readonly canonicalPath: string;
  readonly definition: RouteDefinition;
  readonly normalizedQuery: URLSearchParams;
  readonly responseContract: "generic" | "tmdb-detail" | "tmdb-list" | "tmdb-translations";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const UNSAFE_TEXT_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new HttpError(400, "invalid_body", "The JSON body must be an object.");
  }

  return value;
}

function rejectUnknownKeys(object: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(object).some((key) => !allowed.has(key))) {
    throw new HttpError(400, "invalid_body", "The JSON body contains an unsupported field.");
  }
}

function boundedJson(value: unknown, depth = 0, counter = { nodes: 0 }): boolean {
  counter.nodes += 1;
  if (counter.nodes > 128 || depth > 5) {
    return false;
  }

  if (value === null || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "string") {
    return value.length <= 1_024 && !CONTROL_CHARACTERS.test(value);
  }

  if (Array.isArray(value)) {
    return value.length <= 32 && value.every((item) => boundedJson(item, depth + 1, counter));
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    return (
      entries.length <= 32 &&
      entries.every(
        ([key, item]) =>
          key.length <= 64 && !CONTROL_CHARACTERS.test(key) && boundedJson(item, depth + 1, counter),
      )
    );
  }

  return false;
}

function validateAvailabilityBody(value: unknown): void {
  const body = requireObject(value);
  rejectUnknownKeys(body, ["currentUserId", "email", "username"]);

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!email && !username) {
    throw new HttpError(400, "invalid_body", "Email or username is required.");
  }

  if (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new HttpError(400, "invalid_body", "Email is invalid.");
  }

  if (username && (username.length > 32 || CONTROL_CHARACTERS.test(username))) {
    throw new HttpError(400, "invalid_body", "Username is invalid.");
  }

  if (
    body.currentUserId !== undefined &&
    (typeof body.currentUserId !== "string" || !UUID_PATTERN.test(body.currentUserId))
  ) {
    throw new HttpError(400, "invalid_body", "Current user identifier is invalid.");
  }
}

function validatePasswordResetBody(value: unknown, config: RuntimeConfig): void {
  const body = requireObject(value);
  rejectUnknownKeys(body, ["email", "redirectTo"]);

  if (
    typeof body.email !== "string" ||
    body.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
  ) {
    throw new HttpError(400, "invalid_body", "Email is invalid.");
  }

  let redirect: URL;
  try {
    redirect = new URL(typeof body.redirectTo === "string" ? body.redirectTo : "");
  } catch {
    throw new HttpError(400, "invalid_body", "Password reset redirect is invalid.");
  }

  if (
    !config.allowedRedirectOrigins.has(redirect.origin) ||
    redirect.username ||
    redirect.password ||
    redirect.href.length > 1_024
  ) {
    throw new HttpError(400, "invalid_body", "Password reset redirect is not allowed.");
  }
}

function validateDisabledSignupBody(value: unknown): void {
  if (!boundedJson(value)) {
    throw new HttpError(400, "invalid_body", "Signup payload is invalid.");
  }
}

function validateTmdbBatchBody(value: unknown): void {
  const body = requireObject(value);
  rejectUnknownKeys(body, ["refs"]);

  if (!Array.isArray(body.refs) || body.refs.length < 1 || body.refs.length > 16) {
    throw new HttpError(400, "invalid_body", "TMDB refs must contain 1-16 items.");
  }

  const seen = new Set<string>();
  for (const item of body.refs) {
    const ref = requireObject(item);
    rejectUnknownKeys(ref, ["id", "mediaType"]);
    if (
      !Number.isInteger(ref.id) ||
      Number(ref.id) < 1 ||
      Number(ref.id) > 2_147_483_647 ||
      (ref.mediaType !== "movie" && ref.mediaType !== "tv")
    ) {
      throw new HttpError(400, "invalid_body", "A TMDB reference is invalid.");
    }

    const key = `${String(ref.mediaType)}:${String(ref.id)}`;
    if (seen.has(key)) {
      throw new HttpError(400, "invalid_body", "TMDB refs must be unique.");
    }
    seen.add(key);
  }
}

function validateReportBody(value: unknown): void {
  const body = requireObject(value);
  rejectUnknownKeys(body, [
    "clientContext",
    "details",
    "matchContext",
    "reasonCode",
    "targetRecordId",
    "targetType",
    "targetUserId",
  ]);

  const targetType = body.targetType ?? "profile";
  if (!new Set(["profile", "chat_message", "match", "other"]).has(targetType as string)) {
    throw new HttpError(400, "invalid_body", "Report target type is invalid.");
  }

  if (
    targetType === "profile" &&
    (typeof body.targetUserId !== "string" || !UUID_PATTERN.test(body.targetUserId))
  ) {
    throw new HttpError(400, "invalid_body", "Report target user is invalid.");
  }

  if (
    body.targetUserId !== undefined &&
    (typeof body.targetUserId !== "string" || !UUID_PATTERN.test(body.targetUserId))
  ) {
    throw new HttpError(400, "invalid_body", "Report target user is invalid.");
  }

  if (
    body.targetRecordId !== undefined &&
    (typeof body.targetRecordId !== "string" || body.targetRecordId.length > 160)
  ) {
    throw new HttpError(400, "invalid_body", "Report target record is invalid.");
  }

  if (
    typeof body.reasonCode !== "string" ||
    body.reasonCode.length < 1 ||
    body.reasonCode.length > 64 ||
    !/^[a-z0-9_-]+$/i.test(body.reasonCode)
  ) {
    throw new HttpError(400, "invalid_body", "Report reason is invalid.");
  }

  if (
    typeof body.details !== "string" ||
    body.details.trim().length < 10 ||
    body.details.length > 2_000 ||
    UNSAFE_TEXT_CONTROL_CHARACTERS.test(body.details)
  ) {
    throw new HttpError(400, "invalid_body", "Report details are invalid.");
  }

  if (
    (body.matchContext !== undefined && !boundedJson(body.matchContext)) ||
    (body.clientContext !== undefined && !boundedJson(body.clientContext))
  ) {
    throw new HttpError(400, "invalid_body", "Report context is invalid.");
  }
}

const HEALTH: RouteDefinition = {
  auth: "none",
  bodyLimit: 0,
  id: "health",
  method: "GET",
  rateLimit: "PUBLIC_RATE_LIMITER",
};

const TMDB_GET: RouteDefinition = {
  auth: "optional",
  bodyLimit: 0,
  id: "tmdb_get",
  method: "GET",
  rateLimit: "PUBLIC_RATE_LIMITER",
};

const TMDB_BATCH: RouteDefinition = {
  auth: "optional",
  bodyLimit: 8_192,
  id: "tmdb_media_batch",
  method: "POST",
  rateLimit: "PUBLIC_RATE_LIMITER",
  validateBody: validateTmdbBatchBody,
};

const AUTH_AVAILABILITY: RouteDefinition = {
  auth: "none",
  bodyLimit: 4_096,
  id: "auth_check_availability",
  method: "POST",
  rateLimit: "AUTH_RATE_LIMITER",
  validateBody: validateAvailabilityBody,
};

const AUTH_PASSWORD_RESET: RouteDefinition = {
  auth: "none",
  bodyLimit: 4_096,
  id: "auth_password_reset",
  method: "POST",
  rateLimit: "AUTH_RATE_LIMITER",
  validateBody: validatePasswordResetBody,
};

const AUTH_SIGNUP_DISABLED: RouteDefinition = {
  auth: "none",
  bodyLimit: 32_768,
  id: "auth_signup_disabled",
  method: "POST",
  rateLimit: "AUTH_RATE_LIMITER",
  validateBody: validateDisabledSignupBody,
};

const REPORTS: RouteDefinition = {
  auth: "required",
  bodyLimit: 32_768,
  id: "reports_create",
  method: "POST",
  rateLimit: "MUTATION_RATE_LIMITER",
  validateBody: validateReportBody,
};

function normalizeQuery(
  input: URLSearchParams,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = [],
): URLSearchParams {
  const allowed = new Set(allowedKeys);
  const seen = new Set<string>();
  const normalized = new URLSearchParams();

  for (const [key, rawValue] of input) {
    if (!allowed.has(key) || seen.has(key)) {
      throw new HttpError(400, "invalid_query", "The query contains an unsupported field.");
    }
    seen.add(key);

    let value = rawValue;
    if (key === "language") {
      const match = /^([a-z]{2})-([a-z]{2})$/i.exec(value);
      if (!match?.[1] || !match[2]) {
        throw new HttpError(400, "invalid_query", "TMDB language is invalid.");
      }
      value = `${match[1].toLowerCase()}-${match[2].toUpperCase()}`;
    } else if (key === "region") {
      if (!/^[a-z]{2}$/i.test(value)) {
        throw new HttpError(400, "invalid_query", "TMDB region is invalid.");
      }
      value = value.toUpperCase();
    } else if (key === "page") {
      const page = Number(value);
      if (!Number.isInteger(page) || page < 1 || page > 500) {
        throw new HttpError(400, "invalid_query", "TMDB page is invalid.");
      }
      value = String(page);
    } else if (key === "query") {
      value = value.trim().normalize("NFC");
      if (value.length < 1 || value.length > 80 || CONTROL_CHARACTERS.test(value)) {
        throw new HttpError(400, "invalid_query", "TMDB search query is invalid.");
      }
    }

    normalized.set(key, value);
  }

  if (requiredKeys.some((key) => !seen.has(key))) {
    throw new HttpError(400, "invalid_query", "The query is missing a required field.");
  }

  normalized.sort();
  return normalized;
}

function tmdbMatch(pathname: string, searchParams: URLSearchParams): MatchedRoute | null {
  if (pathname === "/tmdb/trending/all/week") {
    return {
      cacheTtlSeconds: 120,
      canonicalPath: pathname,
      definition: TMDB_GET,
      normalizedQuery: normalizeQuery(searchParams, ["language", "page", "region"]),
      responseContract: "tmdb-list",
    };
  }

  if (pathname === "/tmdb/movie/popular" || pathname === "/tmdb/tv/popular") {
    return {
      cacheTtlSeconds: 300,
      canonicalPath: pathname,
      definition: TMDB_GET,
      normalizedQuery: normalizeQuery(searchParams, ["language", "page", "region"]),
      responseContract: "tmdb-list",
    };
  }

  const searchMatch = /^\/tmdb\/search\/(multi|movie|tv)$/.exec(pathname);
  if (searchMatch) {
    return {
      cacheTtlSeconds: null,
      canonicalPath: pathname,
      definition: TMDB_GET,
      normalizedQuery: normalizeQuery(
        searchParams,
        ["language", "page", "query", "region"],
        ["query"],
      ),
      responseContract: "tmdb-list",
    };
  }

  const translationsMatch = /^\/tmdb\/(movie|tv)\/([1-9]\d{0,9})\/translations$/.exec(
    pathname,
  );
  if (translationsMatch?.[1] && translationsMatch[2]) {
    const id = Number(translationsMatch[2]);
    if (!Number.isSafeInteger(id) || id > 2_147_483_647) {
      throw new HttpError(400, "invalid_path", "TMDB identifier is invalid.");
    }

    return {
      cacheTtlSeconds: 3_600,
      canonicalPath: `/tmdb/${translationsMatch[1]}/${String(id)}/translations`,
      definition: TMDB_GET,
      normalizedQuery: normalizeQuery(searchParams, []),
      responseContract: "tmdb-translations",
    };
  }

  const detailMatch = /^\/tmdb\/(movie|tv)\/([1-9]\d{0,9})$/.exec(pathname);
  if (detailMatch?.[1] && detailMatch[2]) {
    const id = Number(detailMatch[2]);
    if (!Number.isSafeInteger(id) || id > 2_147_483_647) {
      throw new HttpError(400, "invalid_path", "TMDB identifier is invalid.");
    }

    return {
      cacheTtlSeconds: 900,
      canonicalPath: `/tmdb/${detailMatch[1]}/${String(id)}`,
      definition: TMDB_GET,
      normalizedQuery: normalizeQuery(searchParams, ["language", "region"]),
      responseContract: "tmdb-detail",
    };
  }

  return null;
}

function exactMatch(
  pathname: string,
  searchParams: URLSearchParams,
): Omit<MatchedRoute, "canonicalPath" | "normalizedQuery"> & {
  canonicalPath: string;
  normalizedQuery: URLSearchParams;
} | null {
  const route = new Map<string, RouteDefinition>([
    ["/auth/check-availability", AUTH_AVAILABILITY],
    ["/auth/password-reset", AUTH_PASSWORD_RESET],
    ["/auth/signup", AUTH_SIGNUP_DISABLED],
    ["/health", HEALTH],
    ["/reports", REPORTS],
    ["/tmdb/media-batch", TMDB_BATCH],
  ]).get(pathname);

  if (!route) {
    return null;
  }

  if ([...searchParams].length > 0) {
    throw new HttpError(400, "invalid_query", "This route does not accept query parameters.");
  }

  return {
    cacheTtlSeconds: null,
    canonicalPath: pathname,
    definition: route,
    normalizedQuery: new URLSearchParams(),
    responseContract: "generic",
  };
}

export function matchRoute(url: URL): MatchedRoute {
  if (
    url.pathname.length > 512 ||
    url.search.length > 1_024 ||
    url.pathname.includes("%") ||
    url.pathname.includes("\\") ||
    url.pathname.includes("//")
  ) {
    throw new HttpError(400, "invalid_path", "The request path is invalid.");
  }

  const match = exactMatch(url.pathname, url.searchParams) ?? tmdbMatch(url.pathname, url.searchParams);
  if (!match) {
    throw new HttpError(404, "route_not_found", "The requested route is not exposed.");
  }

  return match;
}

export function validateMethod(request: Request, route: MatchedRoute): void {
  if (request.method !== route.definition.method) {
    throw new HttpError(405, "method_not_allowed", "The method is not allowed for this route.", {
      Allow: route.definition.method,
    });
  }
}

export function validateResponseContract(
  contract: MatchedRoute["responseContract"],
  value: unknown,
): boolean {
  if (contract === "generic") {
    return isPlainObject(value) || Array.isArray(value);
  }

  if (!isPlainObject(value)) {
    return false;
  }

  if (contract === "tmdb-list") {
    return Number.isInteger(value.page) && Array.isArray(value.results);
  }

  if (contract === "tmdb-detail") {
    return Number.isInteger(value.id) && Number(value.id) > 0;
  }

  return Number.isInteger(value.id) && Number(value.id) > 0 && Array.isArray(value.translations);
}
