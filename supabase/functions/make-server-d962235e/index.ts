import { Hono } from "npm:hono@4.12.30";
import { cors } from "npm:hono@4.12.30/cors";
import { createClient } from "jsr:@supabase/supabase-js@2.107.0";
import nodemailer from "npm:nodemailer@9.0.3";
import {
  DAILY_DISLIKE_SWIPE_LIMIT,
  DAILY_LIKE_SWIPE_LIMIT,
  DAILY_UNDO_LIMIT,
  MATCH_LIKE_REWARD_BONUS,
  CHAT_THREAD_INITIAL_PAGE_SIZE,
  LIVE_NOW_PAGE_SIZE,
  MAX_AGE,
  MAX_BIO_LENGTH,
  MAX_COMPATIBILITY_FILTER,
  MAX_DISTANCE_FILTER_KM,
  MAX_FAVORITES_COUNT,
  MAX_LETTERBOXD_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PROFILE_PHOTOS,
  MAX_WATCHED_COUNT,
  MIN_AGE,
  MIN_COMPATIBILITY_FILTER,
  MIN_DISTANCE_FILTER_KM,
  SWIPE_QUOTA_WINDOW_HOURS,
} from "../../../src/shared/constants/index.ts";
import { getUsernameValidationMessage, normalizeUsername } from "../../../src/shared/utils/username.ts";
import { getCompatibilityBreakdown } from "../../../src/shared/utils/compatibility.ts";
import {
  DEFAULT_DISCOVERY_PREFERENCES,
  getDistanceKm,
  hasActiveDistanceFilter,
  isUserGender,
  normalizeDiscoveryPreferences,
  validateDiscoveryPreferences,
  type DiscoveryPreferences,
  type UserGender,
} from "../../../src/shared/utils/discovery.ts";
import {
  normalizeBio,
  normalizeWhitespace,
  validateAge,
  validateBio,
  validateCoordinate,
  validateDisplayName,
  validateGender,
  validateLetterboxd,
  validateMessageText,
} from "../../../src/shared/utils/validation.ts";

type AppVariables = {
  userId: string;
  requestId: string;
  requestStartedAt: number;
};

const app = new Hono<{ Variables: AppVariables }>();

const getSupabase = (): any =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SECRET_KEY") ??
      "",
  );

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const PROFILE_PHOTOS_BUCKET = "profile-photos";
const PROFILE_PHOTOS_PUBLIC_PREFIX = `${Deno.env.get("SUPABASE_URL")!}/storage/v1/object/public/${PROFILE_PHOTOS_BUCKET}/`;
const PROFILE_PHOTOS_SIGNED_PREFIX = `${Deno.env.get("SUPABASE_URL")!}/storage/v1/object/sign/${PROFILE_PHOTOS_BUCKET}/`;
const PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;
const MAX_SIGNUP_ATTEMPTS_PER_HOUR = 6;
const MAX_PASSWORD_RESET_REQUESTS_PER_HOUR = 6;
const MAX_PASSWORD_RESET_LOOKUPS_PER_HOUR = 20;
const MAX_AVAILABILITY_CHECKS_PER_MINUTE = 20;
const MAX_PROFILE_UPDATES_PER_MINUTE = 20;
const MAX_LIKES_PER_MINUTE = 60;
const MAX_MESSAGES_PER_MINUTE = 600;
const MAX_CHAT_MUTATIONS_PER_MINUTE = 20;
const MAX_BLOCK_MUTATIONS_PER_MINUTE = 20;
const MAX_CURRENTLY_WATCHING_MUTATIONS_PER_MINUTE = 30;
const MAX_PUSH_TOKEN_REGISTRATIONS_PER_MINUTE = 12;
const MAX_TMDB_PROXY_REQUESTS_PER_MINUTE = 120;
const MAX_REPORTS_PER_HOUR = 12;
const MIN_REPORT_DETAILS_LENGTH = 20;
const MAX_REPORT_DETAILS_LENGTH = 1500;
const MAX_GROUPED_MESSAGE_NOTIFICATIONS = 5;
const DEFAULT_CHAT_THREAD_PAGE_SIZE = CHAT_THREAD_INITIAL_PAGE_SIZE;
const MAX_CHAT_THREAD_PAGE_SIZE = 80;
const DEFAULT_CHAT_DIRECTORY_PAGE_SIZE = 40;
const MAX_CHAT_DIRECTORY_PAGE_SIZE = 80;
const DEFAULT_COMPATIBILITY_PAGE_SIZE = 40;
const MAX_COMPATIBILITY_PAGE_SIZE = 80;
const DEFAULT_WATCH_DISCOVERY_PAGE_SIZE = 40;
const MAX_WATCH_DISCOVERY_PAGE_SIZE = 80;
const MAX_WATCH_EVENT_RECIPIENTS = 80;
const MAX_CHAT_MESSAGE_PEER_ROWS = 500;
const MAX_RELATIONSHIP_ROWS = 2_000;
const DEFAULT_DIRECTORY_PAGE_SIZE = 80;
const MAX_DIRECTORY_PAGE_SIZE = 120;
const MONETIZATION_ENABLED = Deno.env.get("MONETIZATION_ENABLED") === "true";
const WATCH_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const API_VERSION = "2026-07-19";
const RELEASE_VERSION = "1.0.45";
const REQUIRED_SCHEMA_VERSION = "20260720012500";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_PROXY_CACHE_TTL_MS = 30 * 60 * 1000;
const TMDB_PROXY_MAX_CACHE_ENTRIES = 300;
const ANDROID_NOTIFICATION_CHANNEL_ID = "wmatch-alerts-v2";
const EXPO_PUSH_MAX_HTTP_ATTEMPTS = 3;
const EXPO_PUSH_RETRY_BASE_DELAY_MS = 400;
const DEFAULT_CHAT_SETTINGS = {
  readReceipts: true,
  onlineStatus: true,
  typingIndicator: true,
  notifications: true,
} as const;
type ChatSettingsState = {
  readReceipts: boolean;
  onlineStatus: boolean;
  typingIndicator: boolean;
  notifications: boolean;
};
type MediaType = "movie" | "tv";
type MediaRef = { id: number; mediaType: MediaType };

const normalizeMediaType = (value: unknown): MediaType =>
  value === "tv" ? "tv" : "movie";

const isMediaType = (value: unknown): value is MediaType =>
  value === "movie" || value === "tv";

const getMediaRefKey = (ref: MediaRef) => `${ref.mediaType}:${ref.id}`;

const encodeMessageCursor = (message: { created_at?: string | null; id?: string | null }) => {
  if (!message.created_at || !message.id) {
    return null;
  }

  return btoa(JSON.stringify({
    createdAt: message.created_at,
    id: message.id,
  }));
};

const decodeMessageCursor = (cursor: string | null | undefined) => {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(atob(cursor)) as { createdAt?: unknown; id?: unknown };

    if (
      typeof parsed.createdAt === "string" &&
      Number.isFinite(new Date(parsed.createdAt).getTime()) &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0
    ) {
      return {
        createdAt: parsed.createdAt,
        id: parsed.id,
      };
    }
  } catch {
    return null;
  }

  return null;
};

const encodeLiveNowCursor = (row: { updated_at?: string | null; user_id?: string | null }) => {
  if (!row.updated_at || !row.user_id) {
    return null;
  }

  return btoa(JSON.stringify({
    updatedAt: row.updated_at,
    userId: row.user_id,
  }));
};

const decodeLiveNowCursor = (cursor: string | null | undefined) => {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(atob(cursor)) as { updatedAt?: unknown; userId?: unknown };

    if (
      typeof parsed.updatedAt === "string" &&
      Number.isFinite(new Date(parsed.updatedAt).getTime()) &&
      typeof parsed.userId === "string" &&
      parsed.userId.length > 0
    ) {
      return {
        updatedAt: parsed.updatedAt,
        userId: parsed.userId,
      };
    }
  } catch {
    return null;
  }

  return null;
};

const encodeChatDirectoryCursor = (row: { activity_at?: string | null; other_user_id?: string | null }) => {
  if (!row.activity_at || !row.other_user_id) {
    return null;
  }

  return btoa(JSON.stringify({
    activityAt: row.activity_at,
    userId: row.other_user_id,
  }));
};

const decodeChatDirectoryCursor = (cursor: string | null | undefined) => {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(atob(cursor)) as { activityAt?: unknown; userId?: unknown };

    if (
      typeof parsed.activityAt === "string" &&
      Number.isFinite(new Date(parsed.activityAt).getTime()) &&
      typeof parsed.userId === "string" &&
      /^[0-9a-f-]{36}$/i.test(parsed.userId)
    ) {
      return { activityAt: parsed.activityAt, userId: parsed.userId };
    }
  } catch {
    return null;
  }

  return null;
};

const encodeCompatibilityCursor = (row: { overlap_count?: number | string | null; user_id?: string | null }) => {
  const overlapCount = Number(row.overlap_count);

  if (!Number.isSafeInteger(overlapCount) || overlapCount < 1 || !row.user_id) {
    return null;
  }

  return btoa(JSON.stringify({ overlapCount, userId: row.user_id }));
};

const decodeCompatibilityCursor = (cursor: string | null | undefined) => {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(atob(cursor)) as { overlapCount?: unknown; userId?: unknown };

    if (
      typeof parsed.overlapCount === "number" &&
      Number.isSafeInteger(parsed.overlapCount) &&
      parsed.overlapCount > 0 &&
      typeof parsed.userId === "string" &&
      /^[0-9a-f-]{36}$/i.test(parsed.userId)
    ) {
      return { overlapCount: parsed.overlapCount, userId: parsed.userId };
    }
  } catch {
    return null;
  }

  return null;
};

const userHasIncomingLikesEntitlement = async (supabase: any, userId: string) => {
  if (!MONETIZATION_ENABLED) {
    return true;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("user_entitlements")
    .select("status, valid_from, valid_until")
    .eq("user_id", userId)
    .eq("feature_key", "incoming_likes_identity")
    .eq("status", "active")
    .lte("valid_from", now)
    .or(`valid_until.is.null,valid_until.gt.${now}`)
    .limit(1);

  if (error) {
    throw error;
  }

  return (data ?? []).length > 0;
};
const PUBLIC_PROFILE_SELECT = [
  "id",
  "name",
  "age",
  "show_age_on_profile",
  "gender",
  "show_gender_on_profile",
  "username",
  "bio",
  "letterboxd",
  "photos",
  "email_confirmed",
].join(", ");
const SERVER_PROFILE_SELECT = `${PUBLIC_PROFILE_SELECT}, latitude, longitude, location_updated_at`;
const MATCH_SELECT = [
  "user1_id",
  "user2_id",
  "status",
  "created_at",
  "updated_at",
  "ended_at",
  "ended_by_user_id",
  "match_source_type",
  "match_source_score",
  "match_source_movie_id",
  "common_favorite_movie_ids",
  "common_watched_movie_ids",
  "first_like_by_user_id",
  "accepted_by_user_id",
  "user1_chat_deleted_at",
  "user2_chat_deleted_at",
  "user1_chat_cleared_at",
  "user2_chat_cleared_at",
].join(", ");
const MESSAGE_SELECT = [
  "id",
  "sender_id",
  "receiver_id",
  "text",
  "read",
  "created_at",
  "client_request_id",
  "client_message_id",
].join(", ");
const SWIPE_QUOTA_WINDOW_MS = SWIPE_QUOTA_WINDOW_HOURS * 60 * 60 * 1000;
const REPORT_REASON_CODES = new Set([
  "fake_profile",
  "harassment",
  "spam",
  "nudity",
  "underage",
  "hate_speech",
  "other",
] as const);
const REPORT_TARGET_TYPES = new Set(["profile", "chat_message", "match", "other"] as const);
const MODERATION_REPORT_TO_EMAIL =
  normalizeEmail(Deno.env.get("MODERATION_REPORT_TO_EMAIL") ?? "");
const MODERATION_REPORT_FROM_EMAIL =
  normalizeEmail(Deno.env.get("MODERATION_REPORT_FROM_EMAIL") ?? "");
const MODERATION_REPORT_FROM_NAME =
  (Deno.env.get("MODERATION_REPORT_FROM_NAME") ?? "WMatch Moderation").trim() || "WMatch Moderation";
const MODERATION_SMTP_HOST =
  (Deno.env.get("MODERATION_SMTP_HOST") ?? "").trim();
const MODERATION_SMTP_PORT = Number(Deno.env.get("MODERATION_SMTP_PORT") ?? "587");
const MODERATION_SMTP_USERNAME = (Deno.env.get("MODERATION_SMTP_USERNAME") ?? "").trim();
const MODERATION_SMTP_PASSWORD = Deno.env.get("MODERATION_SMTP_PASSWORD") ?? "";

let moderationTransporter: nodemailer.Transporter | null = null;
const tmdbProxyCache = new Map<string, { payload: unknown; expiresAt: number }>();
const tmdbProxyInflight = new Map<string, Promise<unknown>>();

type SwipeQuotaKind = "like" | "dislike" | "undo";

interface SwipeQuotaRow {
  user_id: string;
  window_started_at: string;
  used_like_swipes: number;
  used_dislike_swipes: number;
  used_undos: number;
}

const getClientIp = (c: any) => {
  const forwardedFor = c.req.header("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown-ip";
  }

  return c.req.header("x-real-ip") ?? "unknown-ip";
};

const getManagedStoragePath = (photoUrl: string) => {
  const prefix = photoUrl.startsWith(PROFILE_PHOTOS_PUBLIC_PREFIX)
    ? PROFILE_PHOTOS_PUBLIC_PREFIX
    : photoUrl.startsWith(PROFILE_PHOTOS_SIGNED_PREFIX)
      ? PROFILE_PHOTOS_SIGNED_PREFIX
      : null;

  if (!prefix) {
    return null;
  }

  const encodedPath = photoUrl.slice(prefix.length).split("?")[0];
  return decodeURIComponent(encodedPath);
};

const buildCanonicalManagedPhotoUrl = (path: string) =>
  `${PROFILE_PHOTOS_PUBLIC_PREFIX}${path.split("/").map(encodeURIComponent).join("/")}`;

const sanitizePhotoList = (photos: unknown) =>
  Array.isArray(photos)
    ? photos
        .filter((photo): photo is string => typeof photo === "string" && photo.trim().length > 0)
        .map((photo) => {
          const normalizedPhoto = photo.trim();
          const managedPath = getManagedStoragePath(normalizedPhoto);
          return managedPath ? buildCanonicalManagedPhotoUrl(managedPath) : normalizedPhoto;
        })
        .slice(0, MAX_PROFILE_PHOTOS)
    : [];

const signProfilePhotosForPayloads = async (
  supabase: any,
  payloads: Record<string, any>[],
): Promise<Record<string, any>[]> => {
  const managedPaths = [...new Set(
    payloads.flatMap((payload) =>
      sanitizePhotoList(payload.photos)
        .map(getManagedStoragePath)
        .filter((path): path is string => Boolean(path)),
    ),
  )];

  if (managedPaths.length === 0) {
    return payloads;
  }

  const { data, error } = await supabase.storage
    .from(PROFILE_PHOTOS_BUCKET)
    .createSignedUrls(managedPaths, PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS);

  if (error) {
    throw error;
  }

  const signedUrlByPath = new Map<string, string>();
  (data ?? []).forEach((item: { path?: string | null; signedUrl?: string | null }) => {
    if (item.path && item.signedUrl) {
      signedUrlByPath.set(item.path, item.signedUrl);
    }
  });

  if (signedUrlByPath.size !== managedPaths.length) {
    throw new Error("One or more profile photos could not be signed.");
  }

  return payloads.map((payload) => ({
    ...payload,
    photos: sanitizePhotoList(payload.photos).map((photo) => {
      const path = getManagedStoragePath(photo);
      return path ? signedUrlByPath.get(path) ?? photo : photo;
    }),
  }));
};

const extractManagedProfilePhotoPaths = (photos: unknown) =>
  sanitizePhotoList(photos)
    .map(getManagedStoragePath)
    .filter((path): path is string => Boolean(path));

const cleanupRemovedManagedProfilePhotos = async (
  supabase: any,
  previousPhotos: unknown,
  nextPhotos: unknown,
) => {
  const previousPaths = extractManagedProfilePhotoPaths(previousPhotos);
  const nextPathSet = new Set(extractManagedProfilePhotoPaths(nextPhotos));
  const removedPaths = previousPaths.filter((path) => !nextPathSet.has(path));

  if (removedPaths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove(removedPaths);

  if (error) {
    console.error("Cleanup removed profile photos error:", error);
  }
};

const sanitizeMovieIdList = (value: unknown, maxCount: number) =>
  Array.isArray(value)
    ? value
        .filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0)
        .slice(0, maxCount)
    : [];

const sanitizeMediaRefList = (value: unknown, legacyMovieIds: number[], maxCount: number): MediaRef[] => {
  const rawRefs = Array.isArray(value)
    ? value
    : legacyMovieIds.map((id) => ({ id, mediaType: "movie" }));
  const seen = new Set<string>();
  const refs: MediaRef[] = [];

  rawRefs.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const id = (item as { id?: unknown }).id;
    const mediaType = (item as { mediaType?: unknown }).mediaType;

    if (!Number.isInteger(id) || (id as number) <= 0 || !isMediaType(mediaType)) {
      return;
    }

    const ref = { id: id as number, mediaType };
    const key = getMediaRefKey(ref);

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    refs.push(ref);
  });

  return refs.slice(0, maxCount);
};

const buildAbuseKey = (parts: Array<string | null | undefined>) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(":");

const normalizeIdempotencyKey = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9:._-]{8,180}$/.test(normalized) ? normalized : null;
};

const hashIdempotencyPayload = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const enforceRateLimit = async (
  supabase: any,
  config: {
    action: string;
    key: string;
    limit: number;
    windowSeconds: number;
  },
) => {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_action: config.action,
    p_key: config.key,
    p_limit: config.limit,
    p_window_seconds: config.windowSeconds,
  });

  if (error) {
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result?.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: Number(result?.retry_after_seconds ?? config.windowSeconds),
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
};

const isAllowedTmdbProxyPath = (path: string, query: URLSearchParams) => {
  if (path === "/trending/all/week" || path === "/movie/popular" || path === "/tv/popular") {
    return true;
  }

  if (/^\/search\/(multi|movie|tv)$/.test(path)) {
    const searchQuery = query.get("query")?.trim() ?? "";
    return searchQuery.length > 0 && searchQuery.length <= 80;
  }

  return /^\/(movie|tv)\/\d+$/.test(path) || /^\/(movie|tv)\/\d+\/translations$/.test(path);
};

const normalizeTmdbProxyPath = (requestUrl: string) => {
  const parsedUrl = new URL(requestUrl);
  const proxyPrefix = "/make-server-d962235e/tmdb";
  const path = parsedUrl.pathname.startsWith(proxyPrefix)
    ? parsedUrl.pathname.slice(proxyPrefix.length) || "/"
    : "/";

  parsedUrl.searchParams.delete("api_key");
  parsedUrl.searchParams.delete("append_to_response");

  return {
    path,
    query: parsedUrl.searchParams,
  };
};

const pruneTmdbProxyCache = () => {
  while (tmdbProxyCache.size > TMDB_PROXY_MAX_CACHE_ENTRIES) {
    const oldestKey = tmdbProxyCache.keys().next().value;

    if (!oldestKey) {
      break;
    }

    tmdbProxyCache.delete(oldestKey);
  }
};

const fetchTmdbProxyPayload = async (cacheKey: string, path: string, query: URLSearchParams) => {
  const cached = tmdbProxyCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    tmdbProxyCache.delete(cacheKey);
    tmdbProxyCache.set(cacheKey, cached);
    return cached.payload;
  }

  if (cached) {
    tmdbProxyCache.delete(cacheKey);
  }

  const inflight = tmdbProxyInflight.get(cacheKey);

  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const apiKey = Deno.env.get("TMDB_API_KEY")?.trim();

    if (!apiKey) {
      throw new Error("TMDB_API_KEY is not configured.");
    }

    const upstreamQuery = new URLSearchParams(query);
    upstreamQuery.set("api_key", apiKey);

    const response = await fetch(`${TMDB_BASE_URL}${path}?${upstreamQuery.toString()}`, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`TMDB upstream request failed with status ${response.status}`);
    }

    const payload = await response.json();
    tmdbProxyCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + TMDB_PROXY_CACHE_TTL_MS,
    });
    pruneTmdbProxyCache();

    return payload;
  })().finally(() => {
    tmdbProxyInflight.delete(cacheKey);
  });

  tmdbProxyInflight.set(cacheKey, request);
  return request;
};

const getTmdbProxyErrorCode = (error: unknown) => {
  const message = getErrorMessage(error, "unknown");

  if (message.includes("TMDB_API_KEY is not configured")) {
    return "TMDB_KEY_MISSING";
  }

  const statusMatch = message.match(/status\s+(\d{3})/i);

  if (statusMatch) {
    return `TMDB_UPSTREAM_${statusMatch[1]}`;
  }

  return "TMDB_PROXY_FAILED";
};

const validateMovieCollectionPayload = (
  favoriteMovies: number[],
  watchedMovies: number[],
) => {
  if (favoriteMovies.length > MAX_FAVORITES_COUNT) {
    return `Favori listesi en fazla ${MAX_FAVORITES_COUNT} içerik içerebilir.`;
  }

  if (watchedMovies.length > MAX_WATCHED_COUNT) {
    return `İzlenen listesi en fazla ${MAX_WATCHED_COUNT} içerik içerebilir.`;
  }

  return null;
};

const isMissingProfileColumnError = (error: unknown, columnName: string) => {
  const message = [
    typeof error === "object" && error !== null && "message" in error ? (error as { message?: string }).message : "",
    typeof error === "object" && error !== null && "details" in error ? (error as { details?: string }).details : "",
    typeof error === "object" && error !== null && "hint" in error ? (error as { hint?: string }).hint : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    message.includes(columnName.toLowerCase()) &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("unknown column"))
  );
};

const getErrorMessage = (error: unknown, fallback = "Beklenmeyen bir hata oluştu.") => {
  const visited = new Set<unknown>();

  const extract = (value: unknown): string | null => {
    if (typeof value === "string") {
      const trimmed = value.trim();

      if (!trimmed || trimmed === "[object Object]") {
        return null;
      }

      return trimmed;
    }

    if (!value || typeof value !== "object") {
      return null;
    }

    if (visited.has(value)) {
      return null;
    }

    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const nestedMessage = extract(item);

        if (nestedMessage) {
          return nestedMessage;
        }
      }

      return null;
    }

    const record = value as Record<string, unknown>;

    for (const key of [
      "error",
      "message",
      "details",
      "hint",
      "description",
      "reason",
      "code",
    ]) {
      const nestedMessage = extract(record[key]);

      if (nestedMessage) {
        return nestedMessage;
      }
    }

    for (const nestedValue of Object.values(record)) {
      const nestedMessage = extract(nestedValue);

      if (nestedMessage) {
        return nestedMessage;
      }
    }

    return null;
  };

  return extract(error) ?? fallback;
};

const isMissingColumnError = (error: unknown, columnName: string) => {
  const message = getErrorMessage(error, "").toLowerCase();

  return (
    message.includes(columnName.toLowerCase()) &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find") ||
      message.includes("unknown column"))
  );
};

const findMissingColumnName = (error: unknown, columnNames: string[]) =>
  columnNames.find((columnName) => isMissingColumnError(error, columnName)) ?? null;

const isMissingRelationError = (error: unknown, relationName?: string) => {
  const message = getErrorMessage(error, "").toLowerCase();
  const matchesRelationName = relationName
    ? message.includes(relationName.toLowerCase())
    : true;

  return (
    matchesRelationName &&
    (
      (message.includes("relation") && message.includes("does not exist")) ||
      (message.includes("table") && message.includes("does not exist")) ||
      message.includes("could not find the table") ||
      message.includes("schema cache")
    )
  );
};

const isMissingFunctionError = (error: unknown, functionName: string) => {
  const message = getErrorMessage(error, "").toLowerCase();
  const normalizedFunctionName = functionName.toLowerCase();

  return (
    message.includes(normalizedFunctionName) &&
    (message.includes("could not find the function") ||
      message.includes("schema cache") ||
      message.includes("does not exist"))
  );
};

const getPairUserIds = (leftUserId: string, rightUserId: string) =>
  leftUserId < rightUserId
    ? [leftUserId, rightUserId] as const
    : [rightUserId, leftUserId] as const;

const getPairKey = (leftUserId: string, rightUserId: string) => getPairUserIds(leftUserId, rightUserId).join(":");

const serializeProfile = (
  profile: Record<string, any>,
  extras: Record<string, unknown> = {},
) => ({
  id: typeof profile.id === "string" ? profile.id : "",
  name: typeof profile.name === "string" ? profile.name : "User",
  age: typeof profile.age === "number" ? profile.age : 18,
  showAgeOnProfile:
    typeof profile.show_age_on_profile === "boolean" ? profile.show_age_on_profile : true,
  gender: isUserGender(profile.gender) ? profile.gender : "other",
  showGenderOnProfile:
    typeof profile.show_gender_on_profile === "boolean" ? profile.show_gender_on_profile : true,
  username: typeof profile.username === "string" ? profile.username : "",
  bio: typeof profile.bio === "string" ? profile.bio : "",
  letterboxd: typeof profile.letterboxd === "string" ? profile.letterboxd : "",
  photos: sanitizePhotoList(profile.photos),
  favoriteMovies: [],
  favoriteMedia: [],
  watchedMovies: [],
  watchedMedia: [],
  currentlyWatching: null,
  currentlyWatchingMediaType: null,
  currentlyWatchingState: null,
  currentlyWatchingRemainingMs: null,
  currentlyWatchingExpiresAt: null,
  currentlyWatchingVersion: null,
  currentlyWatchingUpdatedAt: null,
  locationUpdatedAt: null,
  discoveryPreferences: DEFAULT_DISCOVERY_PREFERENCES,
  ...extras,
});

const buildAuthUserMetadata = (profile: Record<string, any>) => ({
  name: typeof profile.name === "string" ? profile.name : "User",
  age: typeof profile.age === "number" ? profile.age : 18,
  gender: isUserGender(profile.gender) ? profile.gender : "other",
  username: typeof profile.username === "string" ? profile.username : "",
  bio: typeof profile.bio === "string" ? profile.bio : "",
  letterboxd: typeof profile.letterboxd === "string" ? profile.letterboxd : "",
  photos: sanitizePhotoList(profile.photos),
  show_age_on_profile:
    typeof profile.show_age_on_profile === "boolean" ? profile.show_age_on_profile : true,
  showAgeOnProfile:
    typeof profile.show_age_on_profile === "boolean" ? profile.show_age_on_profile : true,
  show_gender_on_profile:
    typeof profile.show_gender_on_profile === "boolean" ? profile.show_gender_on_profile : true,
  showGenderOnProfile:
    typeof profile.show_gender_on_profile === "boolean" ? profile.show_gender_on_profile : true,
});

const buildUserPayload = (
  profile: Record<string, any>,
  movies: Array<{ movie_id: number; media_type?: MediaType | string | null; type: string }> = [],
  currentlyWatching: {
    movie_id: number;
    media_type?: MediaType | string | null;
    updated_at?: string | null;
    state?: string | null;
    remaining_ms?: number | null;
    expires_at?: string | null;
    version?: number | null;
  } | null = null,
  discoveryPreferences: DiscoveryPreferences = DEFAULT_DISCOVERY_PREFERENCES,
) =>
  serializeProfile(profile, {
    favoriteMovies: movies.filter((item) => item.type === "favorite").map((item) => item.movie_id),
    favoriteMedia: movies
      .filter((item) => item.type === "favorite" && item.media_type != null)
      .map((item) => ({
        id: item.movie_id,
        mediaType: normalizeMediaType(item.media_type),
      })),
    watchedMovies: movies.filter((item) => item.type === "watched").map((item) => item.movie_id),
    watchedMedia: movies
      .filter((item) => item.type === "watched" && item.media_type != null)
      .map((item) => ({
        id: item.movie_id,
        mediaType: normalizeMediaType(item.media_type),
      })),
    currentlyWatching: currentlyWatching?.movie_id ?? null,
    currentlyWatchingMediaType:
      currentlyWatching
        ? normalizeMediaType(currentlyWatching.media_type)
        : null,
    currentlyWatchingUpdatedAt:
      currentlyWatching?.state === "paused" ? null : currentlyWatching?.updated_at ?? null,
    currentlyWatchingState: currentlyWatching?.state ?? null,
    currentlyWatchingRemainingMs: currentlyWatching?.remaining_ms ?? null,
    currentlyWatchingExpiresAt: currentlyWatching?.expires_at ?? null,
    currentlyWatchingVersion:
      typeof currentlyWatching?.version === "number" ? currentlyWatching.version : null,
    locationUpdatedAt: null,
    discoveryPreferences,
  });

const buildFallbackUserPayload = (userId: string) =>
  buildUserPayload({
    id: userId,
    name: "Kullanici",
    age: 18,
    gender: "other",
    email_confirmed: true,
  });

const isEmailConfirmedProfile = (profile: Record<string, any> | null | undefined) =>
  profile?.email_confirmed === true;

const sanitizeReportReasonCode = (value: unknown) => {
  if (typeof value !== "string") {
    return "other";
  }

  const normalized = value.trim().toLowerCase();
  return REPORT_REASON_CODES.has(normalized as any)
    ? normalized
    : "other";
};

const sanitizeReportTargetType = (value: unknown) => {
  if (typeof value !== "string") {
    return "profile";
  }

  const normalized = value.trim().toLowerCase();
  return REPORT_TARGET_TYPES.has(normalized as any)
    ? normalized
    : "profile";
};

const sanitizeReportDetails = (value: unknown) =>
  typeof value === "string" ? normalizeWhitespace(value).trim().slice(0, MAX_REPORT_DETAILS_LENGTH) : "";

const buildReportUserSnapshot = (user: Record<string, any> | null | undefined) => {
  if (!user) {
    return null;
  }

  return {
    id: user.id ?? null,
    name: user.name ?? null,
    username: user.username ?? null,
    age: typeof user.age === "number" ? user.age : null,
    gender: user.gender ?? null,
    letterboxd: user.letterboxd ?? null,
    photos: sanitizePhotoList(user.photos),
    currentlyWatching: user.currentlyWatching ?? null,
    currentlyWatchingUpdatedAt: user.currentlyWatchingUpdatedAt ?? null,
    favoriteMovies:
      Array.isArray(user.favoriteMovies) ? user.favoriteMovies.filter((movieId: unknown) => typeof movieId === "number") : [],
    watchedMovies:
      Array.isArray(user.watchedMovies) ? user.watchedMovies.filter((movieId: unknown) => typeof movieId === "number") : [],
    locationUpdatedAt: user.locationUpdatedAt ?? null,
    isPublicAccount: true,
    emailConfirmed: user.email_confirmed === true,
  };
};

const formatPrettyJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getModerationTransporter = () => {
  if (
    !MODERATION_REPORT_TO_EMAIL ||
    !MODERATION_REPORT_FROM_EMAIL ||
    !MODERATION_SMTP_HOST ||
    !MODERATION_SMTP_USERNAME ||
    !MODERATION_SMTP_PASSWORD
  ) {
    return null;
  }

  if (!moderationTransporter) {
    moderationTransporter = nodemailer.createTransport({
      host: MODERATION_SMTP_HOST,
      port: Number.isFinite(MODERATION_SMTP_PORT) ? MODERATION_SMTP_PORT : 587,
      secure: false,
      auth: {
        user: MODERATION_SMTP_USERNAME,
        pass: MODERATION_SMTP_PASSWORD,
      },
    });
  }

  return moderationTransporter;
};

const sendModerationReportEmail = async (report: {
  id: string;
  targetType: string;
  reasonCode: string;
  details: string;
  reporterSnapshot: Record<string, unknown> | null;
  targetSnapshot: Record<string, unknown> | null;
  contextSnapshot: Record<string, unknown>;
  createdAt: string;
}) => {
  const transporter = getModerationTransporter();

  if (!transporter) {
    return false;
  }

  const subject = `[WMatch] Yeni ${report.targetType} sikayeti | ${report.reasonCode} | ${report.id}`;
  const text = [
    "WMatch moderation report",
    `Report ID: ${report.id}`,
    `Target Type: ${report.targetType}`,
    `Reason Code: ${report.reasonCode}`,
    `Created At: ${report.createdAt}`,
    "",
    "Reporter snapshot:",
    formatPrettyJson(report.reporterSnapshot),
    "",
    "Target snapshot:",
    formatPrettyJson(report.targetSnapshot),
    "",
    "Context snapshot:",
    formatPrettyJson(report.contextSnapshot),
    "",
    "User supplied details:",
    report.details,
  ].join("\n");

  await transporter.sendMail({
    from: {
      address: MODERATION_REPORT_FROM_EMAIL,
      name: MODERATION_REPORT_FROM_NAME,
    },
    to: MODERATION_REPORT_TO_EMAIL,
    subject,
    text,
  });

  return true;
};

const serializeChatSettings = (row: Record<string, any> | null | undefined) => ({
  readReceipts:
    typeof row?.read_receipts_enabled === "boolean"
      ? row.read_receipts_enabled
      : DEFAULT_CHAT_SETTINGS.readReceipts,
  onlineStatus:
    typeof row?.online_status_enabled === "boolean"
      ? row.online_status_enabled
      : DEFAULT_CHAT_SETTINGS.onlineStatus,
  typingIndicator:
    typeof row?.typing_indicator_enabled === "boolean"
      ? row.typing_indicator_enabled
      : DEFAULT_CHAT_SETTINGS.typingIndicator,
  notifications:
    typeof row?.notifications_enabled === "boolean"
      ? row.notifications_enabled
      : DEFAULT_CHAT_SETTINGS.notifications,
});

const serializeDiscoveryPreferences = (row: Record<string, any> | null | undefined) =>
  normalizeDiscoveryPreferences({
    genderPreference: row?.gender_preference,
    ageMin: row?.age_min,
    ageMax: row?.age_max,
    distanceMinKm: row?.distance_min_km,
    distanceMaxKm: row?.distance_max_km,
    compatibilityMin: row?.compatibility_min,
    compatibilityMax: row?.compatibility_max,
  });

const buildFreshSwipeQuotaRow = (userId: string, now = Date.now()): SwipeQuotaRow => ({
  user_id: userId,
  window_started_at: new Date(now).toISOString(),
  used_like_swipes: 0,
  used_dislike_swipes: 0,
  used_undos: 0,
});

const normalizeSwipeQuotaRow = (
  userId: string,
  row: Partial<SwipeQuotaRow> | null | undefined,
  now = Date.now(),
): SwipeQuotaRow => {
  const base = {
    ...buildFreshSwipeQuotaRow(userId, now),
    ...row,
  };
  const resetsAtMs = new Date(base.window_started_at ?? "").getTime() + SWIPE_QUOTA_WINDOW_MS;

  if (!Number.isFinite(resetsAtMs) || resetsAtMs <= now) {
    return buildFreshSwipeQuotaRow(userId, now);
  }

  return {
    user_id: userId,
    window_started_at: base.window_started_at ?? new Date(now).toISOString(),
    used_like_swipes: Math.max(0, Math.min(Number(base.used_like_swipes ?? 0), DAILY_LIKE_SWIPE_LIMIT)),
    used_dislike_swipes: Math.max(0, Math.min(Number(base.used_dislike_swipes ?? 0), DAILY_DISLIKE_SWIPE_LIMIT)),
    used_undos: Math.max(0, Math.min(Number(base.used_undos ?? 0), DAILY_UNDO_LIMIT)),
  };
};

const serializeSwipeQuota = (row: SwipeQuotaRow, now = Date.now()) => {
  const resetsAtMs = new Date(row.window_started_at).getTime() + SWIPE_QUOTA_WINDOW_MS;

  return {
    windowStartedAt: row.window_started_at,
    likeLimit: DAILY_LIKE_SWIPE_LIMIT,
    dislikeLimit: DAILY_DISLIKE_SWIPE_LIMIT,
    undoLimit: DAILY_UNDO_LIMIT,
    usedLikes: row.used_like_swipes,
    usedDislikes: row.used_dislike_swipes,
    usedUndos: row.used_undos,
    remainingLikes: Math.max(0, DAILY_LIKE_SWIPE_LIMIT - row.used_like_swipes),
    remainingDislikes: Math.max(0, DAILY_DISLIKE_SWIPE_LIMIT - row.used_dislike_swipes),
    remainingUndos: Math.max(0, DAILY_UNDO_LIMIT - row.used_undos),
    resetsAt: new Date(resetsAtMs).toISOString(),
    remainingMs: Math.max(0, resetsAtMs - now),
  };
};

const persistSwipeQuotaRow = async (supabase: any, row: SwipeQuotaRow) => {
  const normalized = normalizeSwipeQuotaRow(row.user_id, row);
  const { data, error } = await supabase
    .from("swipe_quotas")
    .upsert({
      user_id: normalized.user_id,
      window_started_at: normalized.window_started_at,
      used_like_swipes: normalized.used_like_swipes,
      used_dislike_swipes: normalized.used_dislike_swipes,
      used_undos: normalized.used_undos,
      updated_at: new Date().toISOString(),
    })
    .select("user_id, window_started_at, used_like_swipes, used_dislike_swipes, used_undos")
    .single();

  if (error) {
    throw error;
  }

  return normalizeSwipeQuotaRow(normalized.user_id, data);
};

const loadSwipeQuotaRow = async (supabase: any, userId: string) => {
  const { data, error } = await supabase
    .from("swipe_quotas")
    .select("user_id, window_started_at, used_like_swipes, used_dislike_swipes, used_undos")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const normalized = normalizeSwipeQuotaRow(userId, data);
  const needsPersist =
    !data ||
    normalized.window_started_at !== data.window_started_at ||
    normalized.used_like_swipes !== Number(data.used_like_swipes ?? 0) ||
    normalized.used_dislike_swipes !== Number(data.used_dislike_swipes ?? 0) ||
    normalized.used_undos !== Number(data.used_undos ?? 0);

  return needsPersist ? persistSwipeQuotaRow(supabase, normalized) : normalized;
};

const consumeSwipeQuota = async (supabase: any, userId: string, kind: SwipeQuotaKind) => {
  const { data, error } = await supabase.rpc("consume_swipe_quota_atomic", {
    p_user_id: userId,
    p_kind: kind,
    p_window_hours: SWIPE_QUOTA_WINDOW_HOURS,
    p_like_limit: DAILY_LIKE_SWIPE_LIMIT,
    p_dislike_limit: DAILY_DISLIKE_SWIPE_LIMIT,
    p_undo_limit: DAILY_UNDO_LIMIT,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || row.consumed !== true) {
    return null;
  }

  return normalizeSwipeQuotaRow(userId, row);
};

const rewardSwipeQuota = async (supabase: any, userId: string, kind: Extract<SwipeQuotaKind, "like" | "dislike">) => {
  const { data, error } = await supabase.rpc("reward_swipe_quota_atomic", {
    p_user_id: userId,
    p_kind: kind,
    p_window_hours: SWIPE_QUOTA_WINDOW_HOURS,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return normalizeSwipeQuotaRow(userId, row);
};

const loadDiscoveryPreferencesMap = async (
  supabase: any,
  userIds: string[],
): Promise<Map<string, DiscoveryPreferences>> => {
  if (userIds.length === 0) {
    return new Map<string, DiscoveryPreferences>();
  }

  const { data, error } = await supabase
    .from("discovery_preferences")
    .select(
      "user_id, gender_preference, age_min, age_max, distance_min_km, distance_max_km, compatibility_min, compatibility_max",
    )
    .in("user_id", userIds)
    .limit(userIds.length);

  if (error) {
    if (isMissingRelationError(error, "discovery_preferences")) {
      return new Map<string, DiscoveryPreferences>();
    }

    throw error;
  }

  return new Map<string, DiscoveryPreferences>(
    (data ?? []).map((row: Record<string, any>) => [row.user_id, serializeDiscoveryPreferences(row)]),
  );
};

const loadPrivateProfileLocationMap = async (
  supabase: any,
  userIds: string[],
): Promise<Map<string, { latitude: number | null; longitude: number | null; location_updated_at: string | null }>> => {
  if (userIds.length === 0) {
    return new Map<string, {
      latitude: number | null;
      longitude: number | null;
      location_updated_at: string | null;
    }>();
  }

  const { data, error } = await supabase
    .from("profiles_private")
    .select("user_id, latitude, longitude, location_updated_at")
    .in("user_id", userIds)
    .limit(userIds.length);

  if (error) {
    if (isMissingRelationError(error, "profiles_private")) {
      return new Map<string, { latitude: number | null; longitude: number | null; location_updated_at: string | null }>();
    }

    throw error;
  }

  return new Map<string, { latitude: number | null; longitude: number | null; location_updated_at: string | null }>(
    (data ?? []).map((row: {
      user_id: string;
      latitude?: number | null;
      longitude?: number | null;
      location_updated_at?: string | null;
    }) => [
      row.user_id,
      {
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        location_updated_at: row.location_updated_at ?? null,
      },
    ]),
  );
};

const upsertPrivateProfileLocation = async (
  supabase: any,
  userId: string,
  location: {
    latitude: number | null;
    longitude: number | null;
    location_updated_at: string | null;
  },
) => {
  const { error } = await supabase
    .from("profiles_private")
    .upsert({
      user_id: userId,
      ...location,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (!error) {
    return null;
  }

  if (!isMissingRelationError(error, "profiles_private")) {
    return error;
  }

  const { error: legacyProfileLocationError } = await supabase
    .from("profiles")
    .update(location)
    .eq("id", userId);

  return legacyProfileLocationError ?? null;
};

const matchesGenderPreference = (
  preference: DiscoveryPreferences,
  gender: UserGender,
) => preference.genderPreference === "random" || preference.genderPreference === gender;

const getProfileCoordinates = (profile: Record<string, any>) => {
  if (
    typeof profile.latitude !== "number" ||
    typeof profile.longitude !== "number" ||
    !Number.isFinite(profile.latitude) ||
    !Number.isFinite(profile.longitude)
  ) {
    return null;
  }

  return {
    latitude: profile.latitude,
    longitude: profile.longitude,
  };
};

const passesDiscoveryFilters = (config: {
  currentProfile: Record<string, any>;
  currentPreferences: DiscoveryPreferences;
  candidateProfile: Record<string, any>;
  candidatePreferences: DiscoveryPreferences;
  compatibilityScore: number;
}) => {
  const currentGender = isUserGender(config.currentProfile.gender) ? config.currentProfile.gender : "other";
  const candidateGender = isUserGender(config.candidateProfile.gender) ? config.candidateProfile.gender : "other";

  if (!matchesGenderPreference(config.currentPreferences, candidateGender)) {
    return false;
  }

  if (!matchesGenderPreference(config.candidatePreferences, currentGender)) {
    return false;
  }

  if (
    typeof config.candidateProfile.age !== "number" ||
    config.candidateProfile.age < config.currentPreferences.ageMin ||
    config.candidateProfile.age > config.currentPreferences.ageMax
  ) {
    return false;
  }

  if (
    config.compatibilityScore < config.currentPreferences.compatibilityMin ||
    config.compatibilityScore > config.currentPreferences.compatibilityMax
  ) {
    return false;
  }

  if (
    typeof config.currentProfile.age !== "number" ||
    config.currentProfile.age < config.candidatePreferences.ageMin ||
    config.currentProfile.age > config.candidatePreferences.ageMax
  ) {
    return false;
  }

  if (
    config.compatibilityScore < config.candidatePreferences.compatibilityMin ||
    config.compatibilityScore > config.candidatePreferences.compatibilityMax
  ) {
    return false;
  }

  const currentCoordinates = getProfileCoordinates(config.currentProfile);
  const candidateCoordinates = getProfileCoordinates(config.candidateProfile);
  const currentWantsDistanceFilter = hasActiveDistanceFilter(config.currentPreferences);
  const candidateWantsDistanceFilter = hasActiveDistanceFilter(config.candidatePreferences);

  if (currentWantsDistanceFilter || candidateWantsDistanceFilter) {
    if (!currentCoordinates || !candidateCoordinates) {
      return false;
    }

    const distanceKm = getDistanceKm(currentCoordinates, candidateCoordinates);

    if (currentWantsDistanceFilter) {
      if (
        distanceKm < config.currentPreferences.distanceMinKm ||
        distanceKm > config.currentPreferences.distanceMaxKm
      ) {
        return false;
      }
    }

    if (
      candidateWantsDistanceFilter &&
      (distanceKm < config.candidatePreferences.distanceMinKm ||
        distanceKm > config.candidatePreferences.distanceMaxKm)
    ) {
      return false;
    }
  }

  return true;
};

type MatchSourceType = "watch" | "compatibility" | "like";
type NotificationEventKind =
  | "like"
  | "match"
  | "message"
  | "chat_ended"
  | "chat_blocked"
  | "chat_unblocked";
type NotificationRouteKind = "likes" | "chat";

interface NotificationEventDraft {
  userId: string;
  actorUserId?: string | null;
  kind: NotificationEventKind;
  routeKind: NotificationRouteKind;
  routeUserId?: string | null;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

interface NotificationDispatchOptions {
  deferPush?: boolean;
}

const normalizeMatchSourceType = (value: unknown): MatchSourceType => {
  if (value === "watch" || value === "compatibility" || value === "like") {
    return value;
  }

  if (value === "uyum") {
    return "compatibility";
  }

  return "like";
};

const getMatchNotificationBody = (sourceType: MatchSourceType, otherUserName: string) => {
  if (sourceType === "watch") {
    return `${otherUserName} ile Watch Match oldun. +${MATCH_LIKE_REWARD_BONUS} beğeni hakkı kazandın. Hemen mesajlaşmak için dokun.`;
  }

  if (sourceType === "compatibility") {
    return `${otherUserName} ile uyum eşleşmesi oldun. +${MATCH_LIKE_REWARD_BONUS} beğeni hakkı kazandın. Hemen mesajlaşmak için dokun.`;
  }

  return `${otherUserName} ile eşleştin. +${MATCH_LIKE_REWARD_BONUS} beğeni hakkı kazandın. Hemen mesajlaşmak için dokun.`;
};

const buildLikeNotificationBody = () => "1 kullanici seni begendi. Ayrintilari gormek icin dokun.";

const runAfterResponse = (task: Promise<unknown>) => {
  const edgeRuntime = (globalThis as any).EdgeRuntime;

  if (typeof edgeRuntime?.waitUntil === "function") {
    edgeRuntime.waitUntil(task);
    return true;
  }

  return false;
};

const publishUserEvents = async (
  supabase: any,
  userIds: string[],
  event: "discovery_changed" | "chat_changed" | "profile_changed" | "notification_changed",
  payload: Record<string, unknown> = {},
) => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

  await Promise.all(uniqueUserIds.map(async (userId) => {
    const channel = supabase.channel(`user-events:${userId}`, {
      config: { private: true },
    });

    try {
      const result = await channel.send({
        type: "broadcast",
        event,
        payload: { ...payload, occurredAt: new Date().toISOString() },
      });

      if (result !== "ok") {
        throw new Error(`Realtime broadcast returned ${String(result)}`);
      }
    } finally {
      await supabase.removeChannel(channel);
    }
  }));
};

const queueUserEvents = (
  supabase: any,
  userIds: string[],
  event: "discovery_changed" | "chat_changed" | "profile_changed" | "notification_changed",
  payload: Record<string, unknown> = {},
) => {
  const task = publishUserEvents(supabase, userIds, event, payload).catch((error) => {
    console.error("User event broadcast error:", error);
  });

  if (!runAfterResponse(task)) {
    void task;
  }
};

const queuePairStateEvents = (supabase: any, leftUserId: string, rightUserId: string, reason: string) => {
  queueUserEvents(supabase, [leftUserId, rightUserId], "discovery_changed", { reason });
  queueUserEvents(supabase, [leftUserId, rightUserId], "chat_changed", { reason });
};

const queueWatchSessionDiscoveryEvents = (
  supabase: any,
  currentUserId: string,
  refs: Array<{ movieId?: number | null; mediaType?: unknown }>,
) => {
  const uniqueRefs = new Map<string, { movieId: number; mediaType: MediaType }>();

  refs.forEach((ref) => {
    if (!ref.movieId || ref.movieId <= 0) {
      return;
    }

    const mediaType = normalizeMediaType(ref.mediaType);
    uniqueRefs.set(`${mediaType}:${ref.movieId}`, { movieId: ref.movieId, mediaType });
  });

  if (uniqueRefs.size === 0) {
    return;
  }

  const task = (async () => {
    const recipientIds = new Set<string>();

    await Promise.all([...uniqueRefs.values()].map(async (ref) => {
      const { data, error } = await supabase
        .from("currently_watching")
        .select("user_id")
        .eq("movie_id", ref.movieId)
        .eq("media_type", ref.mediaType)
        .eq("state", "active")
        .gt("expires_at", new Date().toISOString())
        .neq("user_id", currentUserId)
        .limit(MAX_WATCH_EVENT_RECIPIENTS);

      if (error) {
        throw error;
      }

      (data ?? []).forEach((row: { user_id?: string | null }) => {
        if (row.user_id) {
          recipientIds.add(row.user_id);
        }
      });
    }));

    if (recipientIds.size > 0) {
      await publishUserEvents(
        supabase,
        [...recipientIds],
        "discovery_changed",
        { reason: "watch_session" },
      );
    }
  })().catch((error) => {
    console.error("Watch session discovery event error:", error);
  });

  if (!runAfterResponse(task)) {
    void task;
  }
};

const buildMessageNotificationBody = (text: string) => {
  const normalized = normalizeWhitespace(text).trim();

  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137).trimEnd()}...`;
};

const buildCompactNotificationIdentifier = (value: string) => {
  const compact = value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  if (compact.length === 0) {
    return "unknown";
  }

  return compact.slice(-32);
};

const buildChatNotificationTag = (_recipientUserId: string, senderUserId: string) =>
  `chat_${buildCompactNotificationIdentifier(senderUserId)}`;

const buildGroupedMessageNotificationBody = (lines: string[], totalCount?: number) => {
  const normalizedLines = lines
    .map((line) => normalizeWhitespace(typeof line === "string" ? line : "").trim())
    .filter((line) => line.length > 0);

  if (normalizedLines.length === 0) {
    return "Yeni mesaj";
  }

  const visibleLines = normalizedLines.slice(-MAX_GROUPED_MESSAGE_NOTIFICATIONS);
  const safeTotalCount =
    typeof totalCount === "number" && totalCount > 0
      ? Math.max(totalCount, normalizedLines.length)
      : normalizedLines.length;
  const hiddenCount = Math.max(0, safeTotalCount - visibleLines.length);

  if (hiddenCount <= 0) {
    return visibleLines.join("\n");
  }

  return [`+${hiddenCount} mesaj`, ...visibleLines].join("\n");
};

const getChatStatusNotificationBody = (
  kind: Extract<NotificationEventKind, "chat_ended" | "chat_blocked" | "chat_unblocked">,
  otherUserName: string,
) => {
  if (kind === "chat_blocked") {
    return `${otherUserName} ile sohbetin engellendi. Detaylari gormek icin dokun.`;
  }

  if (kind === "chat_unblocked") {
    return `${otherUserName} ile sohbet engeli kaldirildi. Detaylari gormek icin dokun.`;
  }

  return `${otherUserName} ile sohbet sona erdi. Detaylari gormek icin dokun.`;
};

const buildMatchContextSnapshot = (
  match: Record<string, any> | null,
  fallbackLikeTimeline: {
    firstLikeByUserId: string | null;
    acceptedByUserId: string | null;
  } | null = null,
  viewerUserId?: string | null,
) => {
  if (!match) {
    return null;
  }

  const visibleCreatedAt =
    viewerUserId != null
      ? getChatVisibleSince(match, viewerUserId) ?? String(match.created_at ?? "")
      : String(match.created_at ?? "");

  return {
    type: normalizeMatchSourceType(match.match_source_type),
    compatibilityScore:
      typeof match.match_source_score === "number" ? match.match_source_score : null,
    matchedMovieId:
      typeof match.match_source_movie_id === "number" ? match.match_source_movie_id : null,
    commonFavoriteMovieIds: Array.isArray(match.common_favorite_movie_ids)
      ? match.common_favorite_movie_ids.filter((item: unknown) => typeof item === "number")
      : [],
    commonWatchedMovieIds: Array.isArray(match.common_watched_movie_ids)
      ? match.common_watched_movie_ids.filter((item: unknown) => typeof item === "number")
      : [],
    firstLikeByUserId:
      typeof match.first_like_by_user_id === "string"
        ? match.first_like_by_user_id
        : fallbackLikeTimeline?.firstLikeByUserId ?? null,
    acceptedByUserId:
      typeof match.accepted_by_user_id === "string"
        ? match.accepted_by_user_id
        : fallbackLikeTimeline?.acceptedByUserId ?? null,
    createdAt: String(visibleCreatedAt ?? ""),
  };
};

const loadLikeTimelineMap = async (
  supabase: any,
  pairs: Array<{ user1Id: string; user2Id: string }>,
) => {
  if (pairs.length === 0) {
    return new Map<string, { firstLikeByUserId: string | null; acceptedByUserId: string | null }>();
  }

  const userIds = [...new Set(pairs.flatMap((pair) => [pair.user1Id, pair.user2Id]))];
  const pairKeys = new Set(pairs.map((pair) => getPairKey(pair.user1Id, pair.user2Id)));
  const { data, error } = await supabase
    .from("likes")
    .select("user_id, liked_user_id, created_at")
    .in("user_id", userIds)
    .in("liked_user_id", userIds)
    .order("created_at", { ascending: true })
    .limit(Math.min(MAX_RELATIONSHIP_ROWS, Math.max(2, pairs.length * 2)));

  if (error) {
    throw error;
  }

  const rowsByPair = new Map<
    string,
    Array<{ user_id: string; liked_user_id: string; created_at: string }>
  >();

  (data ?? []).forEach((row: { user_id: string; liked_user_id: string; created_at: string }) => {
    const pairKey = getPairKey(row.user_id, row.liked_user_id);

    if (!pairKeys.has(pairKey)) {
      return;
    }

    const current = rowsByPair.get(pairKey) ?? [];
    rowsByPair.set(pairKey, [...current, row]);
  });

  const timelineMap = new Map<string, { firstLikeByUserId: string | null; acceptedByUserId: string | null }>();

  rowsByPair.forEach((rows, pairKey) => {
    const orderedRows = [...rows].sort(
      (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    );
    const firstLikeByUserId = orderedRows[0]?.user_id ?? null;
    const acceptedByUserId = orderedRows.length > 1 ? orderedRows[orderedRows.length - 1]?.user_id ?? null : null;

    timelineMap.set(pairKey, {
      firstLikeByUserId,
      acceptedByUserId,
    });
  });

  return timelineMap;
};

type UserMovieCollections = {
  favoriteIds: number[];
  watchedIds: number[];
  favoriteMedia: MediaRef[];
  watchedMedia: MediaRef[];
};

const createEmptyMovieCollections = (): UserMovieCollections => ({
  favoriteIds: [],
  watchedIds: [],
  favoriteMedia: [],
  watchedMedia: [],
});

const loadMovieCollectionsForUsers = async (
  supabase: any,
  userIds: string[],
): Promise<Map<string, UserMovieCollections>> => {
  const emptyCollections = new Map<string, UserMovieCollections>();

  userIds.forEach((userId) => {
    emptyCollections.set(userId, createEmptyMovieCollections());
  });

  if (userIds.length === 0) {
    return emptyCollections;
  }

  const { data, error } = await supabase
    .from("user_movies")
    .select("user_id, movie_id, media_type, type")
    .in("user_id", userIds)
    .order("created_at", { ascending: false })
    .limit(Math.min(MAX_RELATIONSHIP_ROWS, Math.max(1, userIds.length * (MAX_FAVORITES_COUNT + MAX_WATCHED_COUNT))));

  if (error) {
    throw error;
  }

  const collections = new Map<string, UserMovieCollections>();

  emptyCollections.forEach((value, key) => collections.set(key, value));

  (data ?? []).forEach((row: { user_id: string; movie_id: number; media_type?: string | null; type: string }) => {
    const current = collections.get(row.user_id) ?? createEmptyMovieCollections();
    const mediaRef = {
      id: row.movie_id,
      mediaType: normalizeMediaType(row.media_type),
    };

    if (row.type === "favorite") {
      current.favoriteIds = [...current.favoriteIds, row.movie_id];
      current.favoriteMedia = [...current.favoriteMedia, mediaRef];
    }

    if (row.type === "watched") {
      current.watchedIds = [...current.watchedIds, row.movie_id];
      current.watchedMedia = [...current.watchedMedia, mediaRef];
    }

    collections.set(row.user_id, current);
  });

  return collections;
};

const getSharedCurrentlyWatchingMovieId = async (
  supabase: any,
  leftUserId: string,
  rightUserId: string,
) => {
  const { data, error } = await supabase
    .from("currently_watching")
    .select("user_id, movie_id, media_type")
    .in("user_id", [leftUserId, rightUserId])
    .limit(2);

  if (error) {
    throw error;
  }

  const leftRow = (data ?? []).find((row: { user_id: string }) => row.user_id === leftUserId) ?? null;
  const rightRow = (data ?? []).find((row: { user_id: string }) => row.user_id === rightUserId) ?? null;
  const leftMovieId = leftRow?.movie_id ?? null;
  const rightMovieId = rightRow?.movie_id ?? null;

  return leftMovieId &&
    leftMovieId === rightMovieId &&
    normalizeMediaType(leftRow?.media_type) === normalizeMediaType(rightRow?.media_type)
    ? leftMovieId
    : null;
};

const buildMatchSnapshot = async (
  supabase: any,
  currentUserId: string,
  otherUserId: string,
  sourceType: MatchSourceType,
) => {
  const collections = await loadMovieCollectionsForUsers(supabase, [currentUserId, otherUserId]);
  const currentUserCollections = collections.get(currentUserId) ?? createEmptyMovieCollections();
  const otherUserCollections = collections.get(otherUserId) ?? createEmptyMovieCollections();
  const compatibility = getCompatibilityBreakdown(
    currentUserCollections.favoriteMedia,
    currentUserCollections.watchedMedia,
    otherUserCollections.favoriteMedia,
    otherUserCollections.watchedMedia,
  );
  const sharedMovieId =
    sourceType === "watch"
      ? await getSharedCurrentlyWatchingMovieId(supabase, currentUserId, otherUserId)
      : null;
  const normalizedSourceType =
    sourceType === "watch" && sharedMovieId == null ? "like" : sourceType;

  return {
    match_source_type: normalizedSourceType,
    match_source_score: compatibility.score,
    match_source_movie_id: sharedMovieId,
    common_favorite_movie_ids: compatibility.commonFavoriteIds,
    common_watched_movie_ids: compatibility.commonWatchedIds,
  };
};

const loadChatSettingsMap = async (
  supabase: any,
  ownerUserId: string,
  otherUserIds: string[],
): Promise<Map<string, ChatSettingsState>> => {
  if (otherUserIds.length === 0) {
    return new Map<string, ChatSettingsState>();
  }

  const { data, error } = await supabase
    .from("chat_settings")
    .select(
      "other_user_id, read_receipts_enabled, online_status_enabled, typing_indicator_enabled, notifications_enabled",
    )
    .eq("owner_user_id", ownerUserId)
    .in("other_user_id", otherUserIds)
    .limit(Math.min(otherUserIds.length, MAX_CHAT_MESSAGE_PEER_ROWS));

  if (error) {
    if (isMissingRelationError(error, "chat_settings")) {
      return new Map<string, ChatSettingsState>();
    }

    throw error;
  }

  return new Map<string, ChatSettingsState>(
    (data ?? []).map((row: Record<string, any>) => [row.other_user_id, serializeChatSettings(row)]),
  );
};

const loadPeerChatSettingsMap = async (
  supabase: any,
  currentUserId: string,
  otherUserIds: string[],
): Promise<Map<string, ChatSettingsState>> => {
  if (otherUserIds.length === 0) {
    return new Map<string, ChatSettingsState>();
  }

  const { data, error } = await supabase
    .from("chat_settings")
    .select(
      "owner_user_id, read_receipts_enabled, online_status_enabled, typing_indicator_enabled, notifications_enabled",
    )
    .eq("other_user_id", currentUserId)
    .in("owner_user_id", otherUserIds)
    .limit(Math.min(otherUserIds.length, MAX_CHAT_MESSAGE_PEER_ROWS));

  if (error) {
    if (isMissingRelationError(error, "chat_settings")) {
      return new Map<string, ChatSettingsState>();
    }

    throw error;
  }

  return new Map<string, ChatSettingsState>(
    (data ?? []).map((row: Record<string, any>) => [row.owner_user_id, serializeChatSettings(row)]),
  );
};

const loadPushTokenMap = async (supabase: any, userIds: string[]) => {
  if (userIds.length === 0) {
    return new Map<string, string[]>();
  }

  const { data, error } = await supabase
    .from("device_push_tokens")
    .select("user_id, token")
    .in("user_id", userIds)
    .limit(Math.min(MAX_RELATIONSHIP_ROWS, Math.max(1, userIds.length * 8)));

  if (error) {
    if (isMissingRelationError(error, "device_push_tokens")) {
      return new Map<string, string[]>();
    }

    throw error;
  }

  const tokenMap = new Map<string, string[]>();

  (data ?? []).forEach((row: { user_id: string; token: string }) => {
    const normalizedToken = typeof row.token === "string" ? row.token.trim() : "";

    if (
      !normalizedToken ||
      (!normalizedToken.startsWith("ExpoPushToken[") &&
        !normalizedToken.startsWith("ExponentPushToken["))
    ) {
      return;
    }

    const currentTokens = tokenMap.get(row.user_id) ?? [];
    if (!currentTokens.includes(normalizedToken)) {
      tokenMap.set(row.user_id, [...currentTokens, normalizedToken]);
    }
  });

  return tokenMap;
};

const loadUnreadMessageNotificationLines = async (
  supabase: any,
  recipientUserId: string,
  senderUserId: string,
) => {
  const { data, error, count } = await supabase
    .from("messages")
    .select("text, created_at", { count: "exact" })
    .eq("sender_id", senderUserId)
    .eq("receiver_id", recipientUserId)
    .eq("read", false)
    .order("created_at", { ascending: false })
    .limit(MAX_GROUPED_MESSAGE_NOTIFICATIONS);

  if (error) {
    throw error;
  }

  const lines = [...(data ?? [])]
    .reverse()
    .map((row: { text?: string | null }) => {
      const line = buildMessageNotificationBody(row.text ?? "");

      return line.length > 0 ? line : null;
    })
    .filter((line): line is string => line != null);

  return {
    lines,
    totalCount: typeof data?.length === "number" ? Math.max(data.length, count ?? data.length) : count ?? 0,
  };
};

const chunkArray = <T,>(items: T[], chunkSize: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
};

const getExpoPushHeaders = () => {
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN")?.trim();

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
};

const waitFor = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

const fetchExpoPushWithRetry = async (url: string, init: RequestInit) => {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < EXPO_PUSH_MAX_HTTP_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      lastResponse = response;

      if (response.status !== 429 && response.status < 500) {
        return response;
      }

      if (attempt === EXPO_PUSH_MAX_HTTP_ATTEMPTS - 1) {
        return response;
      }

      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(5_000, retryAfterSeconds * 1_000)
        : EXPO_PUSH_RETRY_BASE_DELAY_MS * (2 ** attempt);
      await waitFor(retryDelayMs);
    } catch (error) {
      lastError = error;

      if (attempt === EXPO_PUSH_MAX_HTTP_ATTEMPTS - 1) {
        throw error;
      }

      await waitFor(EXPO_PUSH_RETRY_BASE_DELAY_MS * (2 ** attempt));
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError ?? new Error("Expo push request failed.");
};

const resolveExpoPushReceipts = async (
  ticketTokenPairs: Array<{ ticketId: string; token: string }>,
) => {
  const invalidTokens = new Set<string>();

  for (const receiptChunk of chunkArray(ticketTokenPairs, 300)) {
    const response = await fetchExpoPushWithRetry("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: getExpoPushHeaders(),
      body: JSON.stringify({
        ids: receiptChunk.map((item) => item.ticketId),
      }),
    });

    if (!response.ok) {
      console.error("Push receipt request failed:", { status: response.status });
      continue;
    }

    const payload = await response.json().catch(() => null);
    const receipts =
      payload?.data && typeof payload.data === "object" ? payload.data as Record<string, any> : {};

    receiptChunk.forEach(({ ticketId, token }) => {
      const receipt = receipts[ticketId];

      if (receipt?.status !== "error") {
        return;
      }

      const errorCode = receipt?.details?.error;

      if (errorCode === "DeviceNotRegistered") {
        invalidTokens.add(token);
        return;
      }

      console.error("Expo push receipt error:", {
        ticketId,
        error: errorCode ?? "unknown",
      });
    });
  }

  return invalidTokens;
};

const sendPushNotifications = async (
  supabase: any,
  notifications: Array<{
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    channelId?: string;
    priority?: "default" | "normal" | "high";
    collapseId?: string;
    tag?: string;
  }>,
) => {
  if (notifications.length === 0) {
    return { status: "no_tokens" as const, error: null };
  }

  try {
    const tokenMap = await loadPushTokenMap(
      supabase,
      [...new Set(notifications.map((notification) => notification.userId))],
    );
    const messages = notifications.flatMap((notification) =>
      (tokenMap.get(notification.userId) ?? []).map((token) => ({
        to: token,
        sound: "default",
        priority: notification.priority ?? "high",
        channelId: notification.channelId ?? ANDROID_NOTIFICATION_CHANNEL_ID,
        title: notification.title,
        body: notification.body,
        ...(notification.collapseId ? { collapseId: notification.collapseId } : {}),
        ...(notification.tag ? { tag: notification.tag } : {}),
        data: notification.data ?? {},
      })),
    );

    if (messages.length === 0) {
      return { status: "no_tokens" as const, error: null };
    }

    const invalidTokens = new Set<string>();
    const receiptCandidates: Array<{ ticketId: string; token: string }> = [];
    const retryableErrors: string[] = [];
    let acceptedCount = 0;

    for (const messageChunk of chunkArray(messages, 100)) {
      const response = await fetchExpoPushWithRetry("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: getExpoPushHeaders(),
        body: JSON.stringify(messageChunk),
      });

      if (!response.ok) {
        retryableErrors.push(`expo_http_${response.status}`);
        console.error("Push notification request failed:", { status: response.status });
        continue;
      }

      const payload = await response.json().catch(() => null);
      const tickets = Array.isArray(payload?.data)
        ? payload.data
        : payload?.data
          ? [payload.data]
          : [];

      tickets.forEach((ticket: any, index: number) => {
        const failedToken = messageChunk[index]?.to;

        if (ticket?.id && typeof ticket.id === "string" && failedToken) {
          receiptCandidates.push({ ticketId: ticket.id, token: failedToken });
        }

        if (ticket?.status === "ok") {
          acceptedCount += 1;
          return;
        }

        const errorCode = ticket?.details?.error;

        if (!failedToken) {
          return;
        }

        if (errorCode === "DeviceNotRegistered") {
          invalidTokens.add(failedToken);
          return;
        }

        retryableErrors.push(`expo_ticket_${errorCode ?? "unknown"}`);

        console.error("Expo push ticket error:", {
          error: errorCode ?? "unknown",
        });
      });
    }

    const receiptInvalidTokens = await resolveExpoPushReceipts(receiptCandidates);
    receiptInvalidTokens.forEach((token) => invalidTokens.add(token));

    if (invalidTokens.size > 0) {
      await supabase.from("device_push_tokens").delete().in("token", [...invalidTokens]);
    }

    if (retryableErrors.length > 0) {
      return {
        status: "retry" as const,
        error: [...new Set(retryableErrors)].join(","),
      };
    }

    if (acceptedCount > 0) {
      return { status: "submitted" as const, error: null };
    }

    return { status: "no_tokens" as const, error: null };
  } catch (error) {
    console.error("Push notification send error:", error);
    return {
      status: "retry" as const,
      error: getErrorMessage(error, "push_delivery_failed"),
    };
  }
};

const createNotificationEvents = async (supabase: any, notifications: NotificationEventDraft[]) => {
  const results = await Promise.all(
    notifications.map(async (notification) => {
      try {
        const { data, error } = await supabase
          .from("notification_events")
          .insert({
            user_id: notification.userId,
            actor_user_id: notification.actorUserId ?? null,
            kind: notification.kind,
            route_kind: notification.routeKind,
            route_user_id: notification.routeUserId ?? null,
            title: notification.title,
            body: notification.body,
            payload: notification.payload ?? {},
          })
          .select("id")
          .single();

        if (error) {
          if (isMissingRelationError(error, "notification_events")) {
            return { ...notification, eventId: null };
          }

          throw error;
        }

        return { ...notification, eventId: data?.id ?? null };
      } catch (error) {
        console.error("Create notification event error:", error);
        return { ...notification, eventId: null };
      }
    }),
  );

  return results;
};

const drainPushDeliveryOutbox = async (
  supabase: any,
  eventIds: string[] | null = null,
) => {
  const uniqueEventIds = eventIds ? [...new Set(eventIds.filter(Boolean))] : null;

  if (eventIds && uniqueEventIds?.length === 0) {
    return 0;
  }

  const { data, error } = await supabase.rpc("claim_push_delivery_jobs", {
    p_event_ids: uniqueEventIds,
    p_limit: uniqueEventIds ? Math.min(uniqueEventIds.length, 100) : 25,
  });

  if (error) {
    throw error;
  }

  const jobs = (data ?? []) as Array<{
    id: string;
    user_id: string;
    actor_user_id?: string | null;
    kind: string;
    route_kind: string;
    route_user_id?: string | null;
    title: string;
    body: string;
    payload?: Record<string, unknown> | null;
    attempt_count: number;
  }>;

  const processJob = async (job: typeof jobs[number]) => {
    const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
    const result = await sendPushNotifications(supabase, [{
      userId: job.user_id,
      title: job.title,
      body: job.body,
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
      priority: "high",
      collapseId: typeof payload.collapseId === "string" ? payload.collapseId : undefined,
      tag: typeof payload.notificationTag === "string" ? payload.notificationTag : undefined,
      data: {
        ...payload,
        type: job.kind,
        eventId: job.id,
        routeKind: job.route_kind,
        userId: job.route_user_id ?? job.actor_user_id ?? null,
      },
    }]);
    const exhausted = result.status === "retry" && job.attempt_count >= 5;
    const completionStatus = exhausted ? "dead" : result.status;
    const retryAfterSeconds = result.status === "retry"
      ? Math.min(3600, 30 * (2 ** Math.max(0, job.attempt_count - 1)))
      : null;
    const { data: completed, error: completionError } = await supabase.rpc(
      "complete_push_delivery_job",
      {
        p_event_id: job.id,
        p_status: completionStatus,
        p_error: result.error,
        p_retry_after_seconds: retryAfterSeconds,
      },
    );

    if (completionError) {
      throw completionError;
    }

    if (completed !== true) {
      throw new Error("Push delivery job lost its processing lease.");
    }
  };

  for (const jobChunk of chunkArray(jobs, 5)) {
    await Promise.all(jobChunk.map(processJob));
  }

  return jobs.length;
};

const dispatchNotificationEvents = async (
  supabase: any,
  notifications: NotificationEventDraft[],
  options: NotificationDispatchOptions = {},
) => {
  if (notifications.length === 0) {
    return;
  }

  const storedNotifications = await createNotificationEvents(supabase, notifications);

  await Promise.all(
    storedNotifications.map((notification) =>
      publishUserEvents(supabase, [notification.userId], "notification_changed", {
        notification: {
          id: notification.eventId,
          kind: notification.kind,
          routeKind: notification.routeKind,
          routeUserId: notification.routeUserId ?? null,
          title: notification.title,
          body: notification.body,
          payload: notification.payload ?? {},
        },
      }).catch((error) => {
        console.error("Notification event broadcast error:", error);
      }),
    ),
  );

  const pushTask = (async () => {
    await drainPushDeliveryOutbox(
      supabase,
      storedNotifications
        .map((notification) => notification.eventId)
        .filter((eventId): eventId is string => typeof eventId === "string"),
    );
    await drainPushDeliveryOutbox(supabase);
  })();

  if (options.deferPush && runAfterResponse(pushTask)) {
    return;
  }

  await pushTask;
};

const notifyChatStatusChange = async (
  supabase: any,
  config: {
    recipientUserId: string;
    actorUserId: string;
    otherUserName: string;
    kind: Extract<NotificationEventKind, "chat_ended" | "chat_blocked" | "chat_unblocked">;
  },
  options: NotificationDispatchOptions = {},
) => {
  const match = await fetchMatchBetweenUsers(supabase, config.recipientUserId, config.actorUserId);

  if (!match || getMatchChatDeletedAt(match, config.recipientUserId)) {
    return;
  }

  await dispatchNotificationEvents(supabase, [
    {
      userId: config.recipientUserId,
      actorUserId: config.actorUserId,
      kind: config.kind,
      routeKind: "chat",
      routeUserId: config.actorUserId,
      title: "Sohbet guncellendi",
      body: getChatStatusNotificationBody(config.kind, config.otherUserName),
    },
  ], options);
};

const queueChatStatusNotification = (
  supabase: any,
  config: {
    recipientUserId: string;
    actorUserId: string;
    kind: Extract<NotificationEventKind, "chat_ended" | "chat_blocked" | "chat_unblocked">;
  },
) => {
  const task = (async () => {
    const nameMap = await loadProfileNameMap(supabase, [config.actorUserId]);
    await notifyChatStatusChange(
      supabase,
      {
        ...config,
        otherUserName: nameMap.get(config.actorUserId) ?? "Bir kullanici",
      },
      { deferPush: true },
    );
  })().catch((error) => {
    console.error("Chat status notification side effect error:", error);
  });

  if (!runAfterResponse(task)) {
    void task;
  }
};

const markChatNotificationEventsRead = async (
  supabase: any,
  recipientUserId: string,
  otherUserId: string,
) => {
  const { error } = await supabase
    .from("notification_events")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", recipientUserId)
    .eq("kind", "message")
    .eq("route_kind", "chat")
    .eq("route_user_id", otherUserId)
    .is("read_at", null);

  if (error && !isMissingRelationError(error, "notification_events")) {
    throw error;
  }
};

const getBlockState = (
  blockRows: Array<{ blocker_id: string; blocked_id: string }>,
  currentUserId: string,
  otherUserId: string,
) => {
  const blockedByMe = blockRows.some(
    (row) => row.blocker_id === currentUserId && row.blocked_id === otherUserId,
  );
  const blockedByOther = blockRows.some(
    (row) => row.blocker_id === otherUserId && row.blocked_id === currentUserId,
  );

  return {
    blockedByMe,
    blockedByOther,
    isBlocked: blockedByMe || blockedByOther,
  };
};

const getMatchUserRolePrefix = (
  match: Record<string, any> | null,
  userId: string,
): "user1" | "user2" | null => {
  if (!match || !userId) {
    return null;
  }

  if (match.user1_id === userId) {
    return "user1";
  }

  if (match.user2_id === userId) {
    return "user2";
  }

  return null;
};

const getMatchChatTimestamp = (
  match: Record<string, any> | null,
  userId: string,
  kind: "deleted_at" | "cleared_at",
) => {
  const rolePrefix = getMatchUserRolePrefix(match, userId);

  if (!rolePrefix) {
    return null;
  }

  const columnName = `${rolePrefix}_chat_${kind}`;
  const value = match?.[columnName];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const getMatchChatDeletedAt = (match: Record<string, any> | null, userId: string) =>
  getMatchChatTimestamp(match, userId, "deleted_at");

const getMatchChatClearedAt = (match: Record<string, any> | null, userId: string) =>
  getMatchChatTimestamp(match, userId, "cleared_at");

const getChatVisibleSince = (match: Record<string, any> | null, userId: string) => {
  const matchCreatedAt =
    typeof match?.created_at === "string" && match.created_at.trim().length > 0
      ? match.created_at
      : null;
  const clearedAt = getMatchChatClearedAt(match, userId);

  if (!matchCreatedAt) {
    return clearedAt;
  }

  if (!clearedAt) {
    return matchCreatedAt;
  }

  return new Date(clearedAt).getTime() > new Date(matchCreatedAt).getTime()
    ? clearedAt
    : matchCreatedAt;
};

const isTimestampBefore = (value: string | null, threshold: string | null) => {
  if (!value || !threshold) {
    return false;
  }

  return new Date(value).getTime() < new Date(threshold).getTime();
};

const buildMatchChatVisibilityPatch = (
  pairUser1Id: string,
  pairUser2Id: string,
  targetUserId: string,
  patch: {
    deletedAt?: string | null;
    clearedAt?: string | null;
  },
) => {
  const rolePrefix = targetUserId === pairUser1Id ? "user1" : "user2";
  const nextPatch: Record<string, unknown> = {};

  if ("deletedAt" in patch) {
    nextPatch[`${rolePrefix}_chat_deleted_at`] = patch.deletedAt ?? null;
  }

  if ("clearedAt" in patch) {
    nextPatch[`${rolePrefix}_chat_cleared_at`] = patch.clearedAt ?? null;
  }

  return nextPatch;
};

const getStoredMatchStatus = (
  match: Record<string, any> | null,
  currentUserId: string,
  otherUserId: string,
  blockRows: Array<{ blocker_id: string; blocked_id: string }>,
) => {
  const { blockedByMe, blockedByOther } = getBlockState(blockRows, currentUserId, otherUserId);
  const ended = Boolean(match && (match.ended_at != null || match.status === "ended"));

  if (blockedByMe) {
    return (match && currentUserId === match.user1_id ? "blocked_by_user1" : "blocked_by_user2") as
      | "active"
      | "ended"
      | "blocked_by_user1"
      | "blocked_by_user2";
  }

  if (blockedByOther) {
    return (match && otherUserId === match.user1_id ? "blocked_by_user1" : "blocked_by_user2") as
      | "active"
      | "ended"
      | "blocked_by_user1"
      | "blocked_by_user2";
  }

  if (ended) {
    return "ended";
  }

  return "active";
};

const getChatState = (
  match: Record<string, any> | null,
  currentUserId: string,
  otherUserId: string,
  blockRows: Array<{ blocker_id: string; blocked_id: string }> = [],
) => {
  const { blockedByMe, blockedByOther, isBlocked } = getBlockState(
    blockRows,
    currentUserId,
    otherUserId,
  );
  const ended = Boolean(match && (match.ended_at != null || match.status === "ended"));
  const deletedByCurrentUser = Boolean(getMatchChatDeletedAt(match, currentUserId));

  let lockedReason: string | null = null;
  if (!match) {
    lockedReason = "Bu kullanıcı ile aktif bir eşleşme bulunamadı.";
  } else if (blockedByMe && blockedByOther) {
    lockedReason = "Bu kullanıcı ile karşılıklı engel var. Mesaj gönderemezsin.";
  } else if (blockedByMe) {
    lockedReason = "Bu kullanıcıyı engelledin. Engeli kaldırmadan mesaj gönderemezsin.";
  } else if (blockedByOther) {
    lockedReason = "Bu kullanıcı seni engelledi. Mesaj gönderemezsin.";
  } else if (deletedByCurrentUser) {
    lockedReason = "Bu sohbeti sildin. Yeniden eslesmeden mesaj gonderemezsin.";
  } else if (ended) {
    lockedReason = "Bu eşleşme bitirildi. Yeniden eşleşmeden mesaj gönderemezsin.";
  }

  return {
    status: deletedByCurrentUser ? "ended" : getStoredMatchStatus(match, currentUserId, otherUserId, blockRows),
    ended: ended || deletedByCurrentUser,
    blockedByMe,
    blockedByOther,
    isBlocked,
    canSend: Boolean(match) && !ended && !isBlocked && !deletedByCurrentUser,
    lockedReason,
  };
};

const loadUserPayloadMap = async (
  supabase: any,
  userIds: string[],
): Promise<Map<string, Record<string, any>>> => {
  if (userIds.length === 0) {
    return new Map<string, Record<string, any>>();
  }

  const [
    { data: profiles, error: profilesError },
    moviesResult,
    currentlyWatchingResult,
    discoveryPreferencesMap,
  ] =
    await Promise.all([
      supabase.from("profiles").select(PUBLIC_PROFILE_SELECT).in("id", userIds).limit(userIds.length),
      supabase
        .from("user_movies")
        .select("user_id, movie_id, media_type, type")
        .in("user_id", userIds)
        .order("created_at", { ascending: false })
        .limit(Math.min(MAX_RELATIONSHIP_ROWS, Math.max(1, userIds.length * (MAX_FAVORITES_COUNT + MAX_WATCHED_COUNT)))),
      supabase
        .from("currently_watching")
        .select("user_id, movie_id, media_type, state, remaining_ms, expires_at, version, updated_at")
        .in("user_id", userIds)
        .limit(userIds.length),
      loadDiscoveryPreferencesMap(supabase, userIds),
    ]);

  if (profilesError) {
    throw profilesError;
  }

  if (moviesResult.error) {
    throw moviesResult.error;
  }

  if (currentlyWatchingResult.error) {
    throw currentlyWatchingResult.error;
  }

  const allMovies = moviesResult.data;
  const allCurrentlyWatching = currentlyWatchingResult.data;

  const moviesByUserId = new Map<string, Array<{ movie_id: number; media_type?: string | null; type: string }>>();
  (allMovies ?? []).forEach((movie: { user_id: string; movie_id: number; media_type?: string | null; type: string }) => {
    const current = moviesByUserId.get(movie.user_id) ?? [];
    moviesByUserId.set(movie.user_id, [
      ...current,
      {
        movie_id: movie.movie_id,
        media_type: movie.media_type ?? "movie",
        type: movie.type,
      },
    ]);
  });

  const watchingByUserId = new Map<
    string,
    {
      movie_id: number;
      media_type?: string | null;
      state?: string | null;
      remaining_ms?: number | null;
      expires_at?: string | null;
      version?: number | null;
      updated_at?: string | null;
    }
  >();
  (allCurrentlyWatching ?? []).forEach(
    (item: {
      user_id: string;
      movie_id: number;
      media_type?: string | null;
      state?: string | null;
      remaining_ms?: number | null;
      expires_at?: string | null;
      version?: number | null;
      updated_at?: string | null;
    }) => {
      watchingByUserId.set(item.user_id, {
        movie_id: item.movie_id,
        media_type: item.media_type ?? "movie",
        state: item.state ?? "active",
        remaining_ms: typeof item.remaining_ms === "number" ? item.remaining_ms : null,
        expires_at: item.expires_at ?? null,
        version: typeof item.version === "number" ? item.version : null,
        updated_at: item.updated_at ?? null,
      });
    },
  );

  const userPayloads = (profiles ?? [])
      .filter((profile: Record<string, any>) => isEmailConfirmedProfile(profile))
      .map((profile: Record<string, any>) =>
        buildUserPayload(
          profile,
          moviesByUserId.get(profile.id) ?? [],
          watchingByUserId.get(profile.id) ?? null,
          discoveryPreferencesMap.get(profile.id) ?? DEFAULT_DISCOVERY_PREFERENCES,
        ));
  const signedPayloads = await signProfilePhotosForPayloads(supabase, userPayloads);

  return new Map<string, Record<string, any>>(
    signedPayloads.map((payload) => [payload.id, payload]),
  );
};

const loadRawProfileMap = async (
  supabase: any,
  userIds: string[],
): Promise<Map<string, Record<string, any>>> => {
  if (userIds.length === 0) {
    return new Map<string, Record<string, any>>();
  }

  const [
    { data, error },
    privateLocationMap,
  ] = await Promise.all([
    supabase.from("profiles").select(SERVER_PROFILE_SELECT).in("id", userIds).limit(userIds.length),
    loadPrivateProfileLocationMap(supabase, userIds),
  ]);

  if (error) {
    throw error;
  }

  return new Map<string, Record<string, any>>(
    (data ?? []).map((profile: Record<string, any>) => [
      profile.id,
      {
        ...profile,
        ...(privateLocationMap.get(profile.id) ?? {}),
      },
    ]),
  );
};

const loadProfileNameMap = async (
  supabase: any,
  userIds: string[],
): Promise<Map<string, string>> => {
  if (userIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", userIds)
    .limit(userIds.length);

  if (error) {
    throw error;
  }

  return new Map<string, string>(
    (data ?? []).map((profile: { id: string; name?: string | null }) => [
      profile.id,
      typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : "bir kullanici",
    ]),
  );
};

const loadChatMessageStats = async (
  supabase: any,
  currentUserId: string,
  otherUserIds: string[],
  visibleSinceMap: Map<string, string | null> = new Map(),
) => {
  if (otherUserIds.length === 0) {
    return new Map<string, { lastMessage: string; lastMessageTime: string | null; unreadCount: number }>();
  }

  const boundedOtherUserIds = [...new Set(otherUserIds)].slice(0, MAX_CHAT_MESSAGE_PEER_ROWS);
  const visibleSince = Object.fromEntries(
    boundedOtherUserIds.flatMap((otherUserId) => {
      const timestamp = visibleSinceMap.get(otherUserId);
      return timestamp ? [[otherUserId, timestamp]] : [];
    }),
  );
  let { data, error } = await supabase.rpc("get_chat_list_stats", {
    p_current_user_id: currentUserId,
    p_other_user_ids: boundedOtherUserIds,
    p_visible_since: visibleSince,
  });

  if (error) {
    if (!isMissingFunctionError(error, "get_chat_list_stats")) {
      throw error;
    }

    const legacyResult = await supabase.rpc("get_chat_message_stats", {
      p_current_user_id: currentUserId,
      p_other_user_ids: boundedOtherUserIds,
    });

    if (legacyResult.error) {
      throw legacyResult.error;
    }

    data = legacyResult.data;
    error = null;
  }

  const statsMap = new Map<string, { lastMessage: string; lastMessageTime: string | null; unreadCount: number }>();

  (data ?? []).forEach((row: {
    other_user_id: string;
    last_message?: string | null;
    last_message_time?: string | null;
    unread_count?: number | null;
  }) => {
    if (!row.other_user_id) {
      return;
    }

    const visibleSinceAt = visibleSinceMap.get(row.other_user_id);
    const lastMessageAt = row.last_message_time ?? null;

    if (
      visibleSinceAt &&
      (!lastMessageAt || new Date(lastMessageAt).getTime() < new Date(visibleSinceAt).getTime())
    ) {
      return;
    }

    statsMap.set(row.other_user_id, {
      lastMessage: row.last_message ?? "",
      lastMessageTime: row.last_message_time ?? null,
      unreadCount: Number(row.unread_count ?? 0),
    });
  });

  return statsMap;
};

const fetchMatchBetweenUsers = async (supabase: any, leftUserId: string, rightUserId: string) => {
  const [user1Id, user2Id] = getPairUserIds(leftUserId, rightUserId);
  const { data, error } = await supabase
    .from("matches")
    .select(MATCH_SELECT)
    .eq("user1_id", user1Id)
    .eq("user2_id", user2Id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
};

const upsertMatchWithFallback = async (supabase: any, payload: Record<string, unknown>) => {
  const optionalColumns = [
    "ended_at",
    "ended_by_user_id",
    "match_source_type",
    "match_source_score",
    "match_source_movie_id",
    "common_favorite_movie_ids",
    "common_watched_movie_ids",
    "first_like_by_user_id",
    "accepted_by_user_id",
    "user1_chat_deleted_at",
    "user2_chat_deleted_at",
    "user1_chat_cleared_at",
    "user2_chat_cleared_at",
  ];
  const nextPayload = { ...payload };

  while (true) {
    const { data, error } = await supabase
      .from("matches")
      .upsert(nextPayload, { onConflict: "user1_id,user2_id" })
      .select(MATCH_SELECT)
      .single();

    if (!error) {
      return data;
    }

    const missingColumnName = findMissingColumnName(
      error,
      optionalColumns.filter((columnName) => columnName in nextPayload),
    );

    if (!missingColumnName) {
      throw error;
    }

    delete nextPayload[missingColumnName];
  }
};

const ensureActiveMatchBetweenUsers = async (
  supabase: any,
  currentUserId: string,
  otherUserId: string,
  sourceType: MatchSourceType,
  options: {
    hasReverseLike?: boolean;
    existingMatch?: Record<string, any> | null;
  } = {},
) => {
  let hasReverseLike = options.hasReverseLike;

  if (hasReverseLike == null) {
    const { data: reverseLike, error: reverseLikeError } = await supabase
      .from("likes")
      .select("user_id")
      .eq("user_id", otherUserId)
      .eq("liked_user_id", currentUserId)
      .maybeSingle();

    if (reverseLikeError) {
      throw reverseLikeError;
    }

    hasReverseLike = Boolean(reverseLike);
  }

  if (!hasReverseLike) {
    return options.existingMatch ?? fetchMatchBetweenUsers(supabase, currentUserId, otherUserId);
  }

  const [user1Id, user2Id] = getPairUserIds(currentUserId, otherUserId);
  const pairKey = getPairKey(currentUserId, otherUserId);
  const existingMatch =
    options.existingMatch === undefined
      ? await fetchMatchBetweenUsers(supabase, currentUserId, otherUserId)
      : options.existingMatch;
  let likeTimelineMap = new Map<string, { firstLikeByUserId: string | null; acceptedByUserId: string | null }>();
  let snapshot: Record<string, unknown> = {
    match_source_type: normalizeMatchSourceType(sourceType),
    match_source_score: null,
    match_source_movie_id: null,
    common_favorite_movie_ids: [],
    common_watched_movie_ids: [],
  };

  try {
    [likeTimelineMap, snapshot] = await Promise.all([
      loadLikeTimelineMap(supabase, [{ user1Id, user2Id }]),
      buildMatchSnapshot(supabase, currentUserId, otherUserId, sourceType),
    ]);
  } catch (error) {
    console.error("Match enrichment fallback error:", error);
  }

  const likeTimeline = likeTimelineMap.get(pairKey);
  const currentUserWasDeleted = Boolean(getMatchChatDeletedAt(existingMatch, currentUserId));
  const visibilityPatch = currentUserWasDeleted
    ? buildMatchChatVisibilityPatch(user1Id, user2Id, currentUserId, {
        deletedAt: null,
        clearedAt: new Date().toISOString(),
      })
    : {};
  return upsertMatchWithFallback(supabase, {
    user1_id: user1Id,
    user2_id: user2Id,
    status: "active",
    ended_at: null,
    ended_by_user_id: null,
    ...visibilityPatch,
    ...snapshot,
    first_like_by_user_id:
      likeTimeline?.firstLikeByUserId ??
      existingMatch?.first_like_by_user_id ??
      otherUserId,
    accepted_by_user_id:
      likeTimeline?.acceptedByUserId ??
      existingMatch?.accepted_by_user_id ??
      currentUserId,
  });
};

const fetchBlockRows = async (supabase: any, leftUserId: string, rightUserId: string) => {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(
      `and(blocker_id.eq.${leftUserId},blocked_id.eq.${rightUserId}),and(blocker_id.eq.${rightUserId},blocked_id.eq.${leftUserId})`,
    )
    .limit(2);

  if (error) {
    if (isMissingRelationError(error, "user_blocks")) {
      return [];
    }

    throw error;
  }

  return data ?? [];
};

const fetchBlockedUserIdsForUser = async (supabase: any, currentUserId: string) => {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${currentUserId},blocked_id.eq.${currentUserId}`)
    .limit(MAX_RELATIONSHIP_ROWS);

  if (error) {
    throw error;
  }

  const blockedUserIds = new Set<string>();

  (data ?? []).forEach((row: { blocker_id: string; blocked_id: string }) => {
    if (row.blocker_id === currentUserId) {
      blockedUserIds.add(row.blocked_id);
    }

    if (row.blocked_id === currentUserId) {
      blockedUserIds.add(row.blocker_id);
    }
  });

  return blockedUserIds;
};

const fetchActiveMatchedUserIdsForUser = async (supabase: any, currentUserId: string) => {
  const { data, error } = await supabase
    .from("matches")
    .select(MATCH_SELECT)
    .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
    .eq("status", "active")
    .limit(MAX_RELATIONSHIP_ROWS);

  if (error) {
    throw error;
  }

  const matchedUserIds = new Set<string>();

  (data ?? []).forEach((row: { user1_id: string; user2_id: string } & Record<string, unknown>) => {
    if (getMatchChatDeletedAt(row, currentUserId)) {
      return;
    }

    matchedUserIds.add(row.user1_id === currentUserId ? row.user2_id : row.user1_id);
  });

  return matchedUserIds;
};

const fetchLikeSets = async (
  supabase: any,
  currentUserId: string,
): Promise<{ likedIds: Set<string>; likedByIds: Set<string> }> => {
  const loadIncomingLikes = async (): Promise<Array<{ user_id: string }>> => {
    const { data, error } = await supabase
      .from("likes")
      .select("user_id")
      .eq("liked_user_id", currentUserId)
      .eq("hidden_by_liked_user", false)
      .limit(MAX_RELATIONSHIP_ROWS);

    if (!error) {
      return data ?? [];
    }

    if (isMissingColumnError(error, "hidden_by_liked_user")) {
      const fallback = await supabase
        .from("likes")
        .select("user_id")
        .eq("liked_user_id", currentUserId)
        .limit(MAX_RELATIONSHIP_ROWS);

      if (fallback.error) {
        throw fallback.error;
      }

      return fallback.data ?? [];
    }

    throw error;
  };

  const [{ data: likedRows, error: likedError }, likedByRows] = await Promise.all([
    supabase.from("likes").select("liked_user_id").eq("user_id", currentUserId).limit(MAX_RELATIONSHIP_ROWS),
    loadIncomingLikes(),
  ]);

  if (likedError) {
    throw likedError;
  }

  return {
    likedIds: new Set<string>((likedRows ?? []).map((row: { liked_user_id: string }) => row.liked_user_id)),
    likedByIds: new Set<string>((likedByRows ?? []).map((row: { user_id: string }) => row.user_id)),
  };
};

const reconcileMutualLikesForUser = async (
  supabase: any,
  currentUserId: string,
  likeSets: { likedIds: Set<string>; likedByIds: Set<string> },
  sourceType: MatchSourceType,
) => {
  const mutualUserIds = [...likeSets.likedIds].filter((userId) => likeSets.likedByIds.has(userId));
  const reconciledUserIds = new Set<string>();

  if (mutualUserIds.length === 0) {
    return reconciledUserIds;
  }

  await Promise.all(
    mutualUserIds.map(async (otherUserId) => {
      try {
        const match = await ensureActiveMatchBetweenUsers(
          supabase,
          currentUserId,
          otherUserId,
          sourceType,
          { hasReverseLike: true },
        );

        if (match?.status === "active") {
          reconciledUserIds.add(otherUserId);
        }
      } catch (error) {
        console.error("Mutual like reconciliation error:", error);
      }
    }),
  );

  return reconciledUserIds;
};

const fetchActiveRelationshipUserIdsForUser = async (supabase: any, currentUserId: string) => {
  const { data, error } = await supabase
    .from("matches")
    .select("user1_id,user2_id")
    .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
    .eq("status", "active")
    .limit(MAX_RELATIONSHIP_ROWS);

  if (error) {
    throw error;
  }

  return new Set<string>(
    (data ?? []).map((match: { user1_id: string; user2_id: string }) =>
      match.user1_id === currentUserId ? match.user2_id : match.user1_id
    ),
  );
};

const loadCompatibilityCandidatePageFallback = async (
  supabase: any,
  currentUserId: string,
  currentCollections: UserMovieCollections,
  cursor: ReturnType<typeof decodeCompatibilityCursor>,
  pageSize: number,
) => {
  const currentMedia = [
    ...currentCollections.favoriteMedia,
    ...currentCollections.watchedMedia,
  ];
  const currentMediaKeys = new Set(currentMedia.map(getMediaRefKey));
  const movieIds = [...new Set(currentMedia.map((item) => item.id))];

  if (movieIds.length === 0) {
    return [];
  }

  const [candidateResult, blockedUserIds, likeSets, activeMatchUserIds] = await Promise.all([
    supabase
      .from("user_movies")
      .select("user_id,movie_id,media_type")
      .in("movie_id", movieIds)
      .neq("user_id", currentUserId)
      .limit(MAX_RELATIONSHIP_ROWS),
    fetchBlockedUserIdsForUser(supabase, currentUserId),
    fetchLikeSets(supabase, currentUserId),
    fetchActiveRelationshipUserIdsForUser(supabase, currentUserId),
  ]);

  if (candidateResult.error) {
    throw candidateResult.error;
  }

  const excludedUserIds = new Set<string>([
    ...blockedUserIds,
    ...likeSets.likedIds,
    ...activeMatchUserIds,
  ]);

  const overlapByUser = new Map<string, Set<string>>();

  (candidateResult.data ?? []).forEach((row: {
    user_id: string;
    movie_id: number;
    media_type?: string | null;
  }) => {
    if (!row.user_id || excludedUserIds.has(row.user_id)) {
      return;
    }

    const mediaKey = getMediaRefKey({
      id: Number(row.movie_id),
      mediaType: normalizeMediaType(row.media_type),
    });

    if (!currentMediaKeys.has(mediaKey)) {
      return;
    }

    const userOverlap = overlapByUser.get(row.user_id) ?? new Set<string>();
    userOverlap.add(mediaKey);
    overlapByUser.set(row.user_id, userOverlap);
  });

  return [...overlapByUser.entries()]
    .map(([userId, overlap]) => ({
      user_id: userId,
      overlap_count: overlap.size,
    }))
    .filter((row) =>
      !cursor ||
      row.overlap_count < cursor.overlapCount ||
      (row.overlap_count === cursor.overlapCount && row.user_id > cursor.userId)
    )
    .sort((left, right) =>
      right.overlap_count - left.overlap_count || left.user_id.localeCompare(right.user_id)
    )
    .slice(0, pageSize + 1);
};

const loadWatchCandidatePageFallback = async (
  supabase: any,
  currentUserId: string,
  movieId: number,
  mediaType: MediaType,
  cursor: ReturnType<typeof decodeLiveNowCursor>,
  pageSize: number,
) => {
  let watchingQuery = supabase
    .from("currently_watching")
    .select("user_id,updated_at")
    .eq("movie_id", movieId)
    .eq("media_type", mediaType)
    .eq("state", "active")
    .gt("expires_at", new Date().toISOString())
    .neq("user_id", currentUserId)
    .order("updated_at", { ascending: false })
    .order("user_id", { ascending: false })
    .limit(Math.min(MAX_RELATIONSHIP_ROWS, (pageSize + 1) * 4));

  if (cursor) {
    watchingQuery = watchingQuery.lte("updated_at", cursor.updatedAt);
  }

  const [watchingResult, blockedUserIds, likeSets, activeMatchUserIds] = await Promise.all([
    watchingQuery,
    fetchBlockedUserIdsForUser(supabase, currentUserId),
    fetchLikeSets(supabase, currentUserId),
    fetchActiveRelationshipUserIdsForUser(supabase, currentUserId),
  ]);

  if (watchingResult.error) {
    throw watchingResult.error;
  }

  const excludedUserIds = new Set<string>([
    ...blockedUserIds,
    ...likeSets.likedIds,
    ...activeMatchUserIds,
  ]);
  const cursorTimeMs = cursor ? new Date(cursor.updatedAt).getTime() : null;

  return (watchingResult.data ?? [])
    .filter((row: { user_id: string; updated_at: string }) => {
      if (!row.user_id || excludedUserIds.has(row.user_id)) {
        return false;
      }

      if (!cursor || cursorTimeMs == null) {
        return true;
      }

      const updatedAtMs = new Date(row.updated_at).getTime();
      return updatedAtMs < cursorTimeMs ||
        (updatedAtMs === cursorTimeMs && row.user_id < cursor.userId);
    })
    .slice(0, pageSize + 1);
};

const loadChatDirectoryPageFallback = async (
  supabase: any,
  currentUserId: string,
  cursor: ReturnType<typeof decodeChatDirectoryCursor>,
  pageSize: number,
) => {
  const [messagePeersResult, matchesResult, hiddenChatsResult] = await Promise.all([
    supabase.rpc("get_chat_message_peers", {
      p_current_user_id: currentUserId,
      p_limit: MAX_CHAT_MESSAGE_PEER_ROWS,
    }),
    supabase
      .from("matches")
      .select(MATCH_SELECT)
      .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
      .limit(MAX_RELATIONSHIP_ROWS),
    supabase
      .from("hidden_chats")
      .select("other_user_id")
      .eq("user_id", currentUserId)
      .limit(MAX_RELATIONSHIP_ROWS),
  ]);

  const fallbackError = messagePeersResult.error ?? matchesResult.error ?? hiddenChatsResult.error;

  if (fallbackError) {
    throw fallbackError;
  }

  const hiddenUserIds = new Set<string>(
    (hiddenChatsResult.data ?? []).map((row: { other_user_id: string }) => row.other_user_id),
  );
  const matchByUserId = new Map<string, Record<string, any>>();

  (matchesResult.data ?? []).forEach((match: Record<string, any>) => {
    const otherUserId = match.user1_id === currentUserId ? match.user2_id : match.user1_id;

    if (otherUserId) {
      matchByUserId.set(otherUserId, match);
    }
  });

  const messageByUserId = new Map<string, { other_user_id: string; last_message_time?: string | null }>();

  (messagePeersResult.data ?? []).forEach((row: {
    other_user_id: string;
    last_message_time?: string | null;
  }) => {
    if (row.other_user_id) {
      messageByUserId.set(row.other_user_id, row);
    }
  });

  const peerIds = new Set<string>([
    ...matchByUserId.keys(),
    ...messageByUserId.keys(),
  ]);
  const directoryRows: Array<{ other_user_id: string; activity_at: string }> = [];

  peerIds.forEach((otherUserId) => {
    if (otherUserId === currentUserId || hiddenUserIds.has(otherUserId)) {
      return;
    }

    const match = matchByUserId.get(otherUserId) ?? null;

    if (match && getMatchChatDeletedAt(match, currentUserId)) {
      return;
    }

    const visibleSince = getChatVisibleSince(match, currentUserId);
    const visibleSinceMs = visibleSince ? new Date(visibleSince).getTime() : Number.NEGATIVE_INFINITY;
    const messageTime = messageByUserId.get(otherUserId)?.last_message_time ?? null;
    const messageTimeMs = messageTime ? new Date(messageTime).getTime() : Number.NEGATIVE_INFINITY;
    const activityAt = messageTime && messageTimeMs >= visibleSinceMs ? messageTime : visibleSince;

    if (!activityAt || !Number.isFinite(new Date(activityAt).getTime())) {
      return;
    }

    directoryRows.push({ other_user_id: otherUserId, activity_at: activityAt });
  });

  const cursorTimeMs = cursor ? new Date(cursor.activityAt).getTime() : null;

  return directoryRows
    .filter((row) => {
      if (!cursor || cursorTimeMs == null) {
        return true;
      }

      const activityMs = new Date(row.activity_at).getTime();
      return activityMs < cursorTimeMs ||
        (activityMs === cursorTimeMs && row.other_user_id < cursor.userId);
    })
    .sort((left, right) => {
      const timeDelta = new Date(right.activity_at).getTime() - new Date(left.activity_at).getTime();
      return timeDelta || right.other_user_id.localeCompare(left.other_user_id);
    })
    .slice(0, pageSize + 1);
};

const findProfileByUsername = async (supabase: any, username: string) => {
  const normalizedUsername = normalizeUsername(username);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("username", normalizedUsername)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
};

const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.split(" ")[1];
  const supabase = getSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return c.json({ error: "Invalid token" }, 401);
  }

  c.set("userId", user.id);
  await next();
};

const checkSchemaReady = async (supabase: any) => {
  const emptyUserId = "00000000-0000-0000-0000-000000000000";
  const checks = await Promise.allSettled([
    supabase.from("profiles").select("email_confirmed").limit(1),
    supabase.from("schema_contracts").select("required_version,compatible_min_version,current_version").eq("name", "wmatch_api").limit(1),
    supabase
      .from("matches")
      .select("user1_chat_deleted_at,user2_chat_deleted_at,user1_chat_cleared_at,user2_chat_cleared_at")
      .limit(1),
    supabase.from("currently_watching").select("media_type,state,remaining_ms,expires_at,started_at,paused_at,version").limit(1),
    supabase.from("user_movies").select("media_type").limit(1),
    supabase.rpc("replace_user_media_collections", {
      p_user_id: emptyUserId,
      p_favorites: null,
      p_watched: null,
    }),
    supabase.rpc("get_live_now_users", {
      p_current_user_id: emptyUserId,
      p_cursor_updated_at: null,
      p_cursor_user_id: null,
      p_limit: 1,
    }),
    supabase.rpc("get_chat_message_stats", {
      p_current_user_id: emptyUserId,
      p_other_user_ids: [],
    }),
    supabase.rpc("get_chat_message_peers", {
      p_current_user_id: emptyUserId,
      p_limit: 1,
    }),
    supabase.rpc("get_chat_directory_page", {
      p_current_user_id: emptyUserId,
      p_cursor_time: null,
      p_cursor_user_id: null,
      p_limit: 1,
    }),
    supabase.rpc("get_compatibility_candidate_page", {
      p_current_user_id: emptyUserId,
      p_cursor_overlap: null,
      p_cursor_user_id: null,
      p_limit: 1,
    }),
    supabase.rpc("get_watch_discovery_candidate_page", {
      p_current_user_id: emptyUserId,
      p_movie_id: 0,
      p_media_type: "movie",
      p_cursor_updated_at: null,
      p_cursor_user_id: null,
      p_limit: 1,
    }),
    supabase.rpc("get_chat_list_stats", {
      p_current_user_id: emptyUserId,
      p_other_user_ids: [],
      p_visible_since: {},
    }),
    supabase.rpc("apply_watch_session_transition", {
      p_user_id: emptyUserId,
      p_action: "stop",
      p_movie_id: null,
      p_media_type: null,
      p_expected_version: null,
      p_duration_ms: WATCH_SESSION_DURATION_MS,
    }),
  ]);

  return checks.every((result) => {
    if (result.status === "rejected") {
      console.error("Schema readiness check rejected:", result.reason);
      return false;
    }

    if (result.value?.error) {
      console.error("Schema readiness check failed:", result.value.error);
      return false;
    }

    return true;
  });
};

app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id")?.trim() || crypto.randomUUID();
  const startedAt = Date.now();

  c.set("requestId", requestId);

  try {
    await next();
  } finally {
    let actor = "anonymous";

    try {
      const userId = c.get("userId");
      if (typeof userId === "string" && userId.length > 0) {
        actor = `user:${userId.slice(0, 8)}`;
      }
    } catch {
      actor = "anonymous";
    }

    c.res.headers.set("x-request-id", requestId);
    c.res.headers.set("x-api-version", API_VERSION);
    c.res.headers.set("x-server-time", new Date().toISOString());

    console.log(JSON.stringify({
      requestId,
      route: c.req.path,
      method: c.req.method,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
      actor,
    }));
  }
});

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "x-request-id"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length", "x-server-time", "x-request-id", "x-api-version"],
    maxAge: 600,
  }),
);

app.get("/make-server-d962235e/health", async (c) => {
  const supabase = getSupabase();
  const schemaReady = await checkSchemaReady(supabase);
  const requestId = c.get("requestId") ?? crypto.randomUUID();

  return c.json({
    ok: true,
    apiVersion: API_VERSION,
    release: RELEASE_VERSION,
    requiredSchema: REQUIRED_SCHEMA_VERSION,
    serverTime: new Date().toISOString(),
    requestId,
    schemaReady,
  });
});

app.post("/make-server-d962235e/tmdb/media-batch", async (c) => {
  try {
    const body = await c.req.json().catch(() => null) as {
      refs?: Array<{ id?: unknown; mediaType?: unknown }>;
    } | null;
    const refs = Array.isArray(body?.refs)
      ? body.refs
          .filter((ref) => Number.isInteger(ref.id) && Number(ref.id) > 0 && (ref.mediaType === "movie" || ref.mediaType === "tv"))
          .map((ref) => ({ id: Number(ref.id), mediaType: ref.mediaType as "movie" | "tv" }))
      : [];
    const uniqueRefs = [...new Map(refs.map((ref) => [`${ref.mediaType}:${ref.id}`, ref])).values()].slice(0, 16);

    if (uniqueRefs.length === 0) {
      return c.json({ error: "At least one valid media reference is required." }, 400);
    }

    const supabase = getSupabase();
    const rateLimit = await enforceRateLimit(supabase, {
      action: "tmdb_media_batch",
      key: buildAbuseKey([getClientIp(c), "media-batch"]),
      limit: MAX_TMDB_PROXY_REQUESTS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Too many requests.", retryAfterSeconds: rateLimit.retryAfterSeconds }, 429);
    }

    const items = await Promise.all(uniqueRefs.map(async (ref) => {
      const path = `/${ref.mediaType}/${ref.id}`;
      const query = new URLSearchParams({ language: "tr-TR" });

      try {
        const payload = await fetchTmdbProxyPayload(`${path}?${query.toString()}`, path, query);
        return { ...ref, payload };
      } catch {
        return { ...ref, payload: null };
      }
    }));

    return c.json({ items });
  } catch (error) {
    const code = getTmdbProxyErrorCode(error);
    console.error("TMDB batch error:", { code, message: getErrorMessage(error, "unknown") });
    return c.json({ error: "Film servisi gecici olarak kullanilamiyor.", code }, 502);
  }
});

app.get("/make-server-d962235e/tmdb/*", async (c) => {
  try {
    const { path, query } = normalizeTmdbProxyPath(c.req.url);

    if (!isAllowedTmdbProxyPath(path, query)) {
      return c.json({ error: "TMDB path is not allowed." }, 400);
    }

    const supabase = getSupabase();
    const rateLimit = await enforceRateLimit(supabase, {
      action: "tmdb_proxy",
      key: buildAbuseKey([getClientIp(c), path]),
      limit: MAX_TMDB_PROXY_REQUESTS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json(
        {
          error: "Too many requests.",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        429,
      );
    }

    const cacheKey = `${path}?${query.toString()}`;
    const payload = await fetchTmdbProxyPayload(cacheKey, path, query);

    return c.json(payload);
  } catch (error) {
    const code = getTmdbProxyErrorCode(error);
    console.error("TMDB proxy error:", { code, message: getErrorMessage(error, "unknown") });
    return c.json({ error: "Film servisi gecici olarak kullanilamiyor.", code }, 502);
  }
});

app.post("/make-server-d962235e/auth/check-availability", async (c) => {
  try {
    const { email, username, currentUserId } = await c.req.json();
    const supabase = getSupabase();
    const rateLimit = await enforceRateLimit(supabase, {
      action: "auth_check_availability",
      key: buildAbuseKey([getClientIp(c), typeof email === "string" ? normalizeEmail(email) : "", typeof username === "string" ? username : ""]),
      limit: MAX_AVAILABILITY_CHECKS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok sık kontrol yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    if (!email && !username) {
      return c.json({ error: "E-posta veya kullanıcı adı gerekli." }, 400);
    }

    let emailAvailable = true;
    let usernameAvailable = true;
    let emailMessage: string | undefined;
    let usernameMessage: string | undefined;
    let normalizedUsername: string | undefined;

    if (typeof email === "string" && email.trim().length > 0) {
      const normalizedEmail = normalizeEmail(email);

      if (
        normalizedEmail.length > 320 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      ) {
        emailAvailable = false;
        emailMessage = "Gecerli bir e-posta gir.";
      }
    }

    if (typeof username === "string" && username.trim().length > 0) {
      normalizedUsername = normalizeUsername(username);
      const usernameValidationMessage = getUsernameValidationMessage(normalizedUsername);
      if (usernameValidationMessage) {
        usernameAvailable = false;
        usernameMessage = usernameValidationMessage;
      }

      if (!usernameAvailable) {
        return c.json({
          emailAvailable,
          usernameAvailable,
          normalizedUsername,
          emailMessage,
          usernameMessage,
        });
      }

      const existingProfile = await findProfileByUsername(supabase, normalizedUsername);
      usernameAvailable = !existingProfile || existingProfile.id === currentUserId;
      if (!usernameAvailable) {
        usernameMessage = "Bu kullanıcı adı zaten kullanılıyor.";
      }
    }

    return c.json({
      emailAvailable,
      usernameAvailable,
      normalizedUsername,
      emailMessage,
      usernameMessage,
    });
  } catch (error) {
    console.error("Availability check error:", error);
    return c.json({ error: "Uygunluk kontrolü yapılamadı." }, 500);
  }
});

app.post("/make-server-d962235e/auth/password-reset", async (c) => {
  try {
    const { email, redirectTo } = await c.req.json();
    const supabase = getSupabase();
    const normalizedEmail = typeof email === "string" ? normalizeEmail(email) : "";
    const clientIp = getClientIp(c);
    const [rateLimit, lookupRateLimit] = await Promise.all([
      enforceRateLimit(supabase, {
        action: "auth_password_reset",
        key: buildAbuseKey([clientIp, normalizedEmail]),
        limit: MAX_PASSWORD_RESET_REQUESTS_PER_HOUR,
        windowSeconds: 60 * 60,
      }),
      enforceRateLimit(supabase, {
        action: "auth_password_reset_lookup",
        key: buildAbuseKey([clientIp]),
        limit: MAX_PASSWORD_RESET_LOOKUPS_PER_HOUR,
        windowSeconds: 60 * 60,
      }),
    ]);

    if (!rateLimit.allowed || !lookupRateLimit.allowed) {
      return c.json({ error: "Cok sik sifre sifirlama istegi gonderdin. Lutfen daha sonra tekrar dene." }, 429);
    }

    if (!normalizedEmail) {
      return c.json({ error: "E-posta adresi gerekli." }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return c.json({ error: "Gecerli bir e-posta adresi gir." }, 400);
    }

    const { data: availabilityRows, error: availabilityError } = await supabase.rpc(
      "check_email_availability",
      { p_email: normalizedEmail },
    );

    if (availabilityError) {
      console.error("Password reset account lookup error:", availabilityError);
      return c.json({ error: "Hesap kontrolu su anda yapilamiyor. Lutfen tekrar dene." }, 503);
    }

    const accountExists = Array.isArray(availabilityRows)
      && availabilityRows[0]?.email_available === false;

    if (!accountExists) {
      return c.json(
        {
          error: "Bu e-posta adresiyle kayitli bir hesap bulunamadi.",
          code: "ACCOUNT_NOT_FOUND",
        },
        404,
      );
    }

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: typeof redirectTo === "string" && redirectTo.trim().length > 0
        ? redirectTo.trim()
        : undefined,
    });

    if (error) {
      console.error("Password reset delivery error:", {
        code: (error as { code?: string })?.code,
        status: (error as { status?: number })?.status,
        message: getErrorMessage(error, "delivery failed"),
      });
      return c.json({ error: "Sifre sifirlama maili gonderilemedi. Lutfen tekrar dene." }, 502);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Password reset request error:", error);
    return c.json({ error: "Sifre sifirlama istegi tamamlanamadi." }, 500);
  }
});

app.post("/make-server-d962235e/auth/signup", async (c) => {
  return c.json(
    {
      error:
        "Bu endpoint devre dışı. Kayıt akışı artık mail doğrulamalı Supabase signUp üzerinden istemci tarafında çalışıyor.",
    },
    410,
  );
});

app.get("/make-server-d962235e/profile/:userId", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const userId = c.req.param("userId");
    const supabase = getSupabase();

    if (currentUserId !== userId) {
      const blockRows = await fetchBlockRows(supabase, currentUserId, userId);
      if (blockRows.length > 0) {
        return c.json({ error: "Bu profile erisemiyorsun." }, 403);
      }
    }

    const payloadMap = await loadUserPayloadMap(supabase, [userId]);
    const profile = payloadMap.get(userId);

    if (!profile) {
      console.error("Profile fetch error:", "Profile payload could not be loaded.");
      return c.json({ error: "Profil bulunamadı." }, 404);
    }

    return c.json(profile);
  } catch (error) {
    console.error("Get profile error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.put("/make-server-d962235e/profile", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const {
      name,
      age,
      username,
      bio,
      letterboxd,
      photos,
      favoriteMovies,
      favoriteMedia,
      watchedMovies,
      watchedMedia,
      currentlyWatching,
      currentlyWatchingMediaType,
      currentlyWatchingAction,
      currentlyWatchingVersion,
      showAgeOnProfile,
      gender,
      showGenderOnProfile,
      latitude,
      longitude,
      locationUpdatedAt,
      discoveryPreferences,
    } = await c.req.json();

    const supabase = getSupabase();
    const requestedWatchingMutation = currentlyWatching !== undefined || currentlyWatchingAction !== undefined;
    const rateLimit = await enforceRateLimit(supabase, {
      action: requestedWatchingMutation ? "profile_watch_update" : "profile_update",
      key: buildAbuseKey([userId, getClientIp(c)]),
      limit: requestedWatchingMutation ? MAX_CURRENTLY_WATCHING_MUTATIONS_PER_MINUTE : MAX_PROFILE_UPDATES_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı güncelleme yapıyorsun. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const { data: rawCurrentProfile, error: currentProfileError } = await supabase
      .from("profiles")
      .select(SERVER_PROFILE_SELECT)
      .eq("id", userId)
      .single();

    if (currentProfileError || !rawCurrentProfile) {
      return c.json({ error: currentProfileError?.message ?? "Profil bulunamadı." }, 404);
    }

    const privateLocationMap = await loadPrivateProfileLocationMap(supabase, [userId]);
    const currentProfile = {
      ...rawCurrentProfile,
      ...(privateLocationMap.get(userId) ?? {}),
    };

    const requestedDiscoveryPreferences =
      discoveryPreferences && typeof discoveryPreferences === "object"
        ? normalizeDiscoveryPreferences(discoveryPreferences)
        : null;
    const discoveryValidationMessage = validateDiscoveryPreferences(requestedDiscoveryPreferences);
    const normalizedFavoriteMovies = sanitizeMovieIdList(favoriteMovies, MAX_FAVORITES_COUNT);
    const normalizedWatchedMovies = sanitizeMovieIdList(watchedMovies, MAX_WATCHED_COUNT);
    const normalizedFavoriteMedia = sanitizeMediaRefList(favoriteMedia, normalizedFavoriteMovies, MAX_FAVORITES_COUNT);
    const normalizedWatchedMedia = sanitizeMediaRefList(watchedMedia, normalizedWatchedMovies, MAX_WATCHED_COUNT);
    const normalizedCurrentlyWatchingMediaType = normalizeMediaType(currentlyWatchingMediaType);
    const movieValidationMessage = validateMovieCollectionPayload(
      normalizedFavoriteMedia.map((item) => item.id),
      normalizedWatchedMedia.map((item) => item.id),
    );

    if (discoveryValidationMessage) {
      return c.json({ error: discoveryValidationMessage }, 400);
    }

    if (movieValidationMessage) {
      return c.json({ error: movieValidationMessage }, 400);
    }

    if (
      currentlyWatching !== undefined &&
      currentlyWatching !== null &&
      currentlyWatchingMediaType !== undefined &&
      !isMediaType(currentlyWatchingMediaType)
    ) {
      return c.json({ error: "Geçersiz medya tipi." }, 400);
    }

    if (
      currentlyWatchingAction !== undefined &&
      currentlyWatchingAction !== "start" &&
      currentlyWatchingAction !== "pause" &&
      currentlyWatchingAction !== "resume" &&
      currentlyWatchingAction !== "stop"
    ) {
      return c.json({ error: "Geçersiz izleme aksiyonu." }, 400);
    }

    let previousWatchingForEvents: {
      movie_id: number;
      media_type?: string | null;
      state?: string | null;
      expires_at?: string | null;
    } | null = null;

    if (requestedWatchingMutation) {
      const { data: previousWatching, error: previousWatchingError } = await supabase
        .from("currently_watching")
        .select("movie_id, media_type, state, expires_at")
        .eq("user_id", userId)
        .maybeSingle();

      if (previousWatchingError) {
        console.error("Previous watch state lookup error:", previousWatchingError);
      } else {
        previousWatchingForEvents = previousWatching ?? null;
      }
    }

    const profileUpdates: Record<string, unknown> = {};
    let privateLocationUpdate: {
      latitude: number | null;
      longitude: number | null;
      location_updated_at: string | null;
    } | null = null;

    if (typeof name === "string") {
      const normalizedName = normalizeWhitespace(name);
      const nameValidationMessage = validateDisplayName(normalizedName);
      if (nameValidationMessage) {
        return c.json({ error: nameValidationMessage }, 400);
      }

      profileUpdates.name = normalizedName;
    }

    if (typeof age === "number" && Number.isFinite(age)) {
      const ageValidationMessage = validateAge(age);
      if (ageValidationMessage) {
        return c.json({ error: ageValidationMessage }, 400);
      }

      profileUpdates.age = age;
    }

    if (gender !== undefined) {
      const genderValidationMessage = validateGender(gender);
      if (genderValidationMessage) {
        return c.json({ error: genderValidationMessage }, 400);
      }

      profileUpdates.gender = gender;
    }

    if (typeof username === "string") {
      const normalizedUsername = normalizeUsername(username);
      const usernameValidationMessage = getUsernameValidationMessage(normalizedUsername);
      if (usernameValidationMessage) {
        return c.json({ error: usernameValidationMessage }, 400);
      }

      if (normalizedUsername !== currentProfile.username) {
        const existingProfile = await findProfileByUsername(supabase, normalizedUsername);
        if (existingProfile && existingProfile.id !== userId) {
          return c.json({ error: "Bu kullanıcı adı zaten kullanılıyor." }, 409);
        }
      }
      profileUpdates.username = normalizedUsername;
    }

    if (typeof bio === "string") {
      const normalizedBioValue = normalizeBio(bio);
      const bioValidationMessage = validateBio(normalizedBioValue);
      if (bioValidationMessage) {
        return c.json({ error: bioValidationMessage }, 400);
      }

      profileUpdates.bio = normalizedBioValue;
    }

    if (typeof letterboxd === "string") {
      const normalizedLetterboxd = normalizeWhitespace(letterboxd);
      const letterboxdValidationMessage = validateLetterboxd(normalizedLetterboxd);
      if (letterboxdValidationMessage) {
        return c.json({ error: letterboxdValidationMessage }, 400);
      }

      profileUpdates.letterboxd = normalizedLetterboxd;
    }

    if (Array.isArray(photos)) {
      profileUpdates.photos = sanitizePhotoList(photos);
    }

    if (typeof showAgeOnProfile === "boolean") {
      profileUpdates.show_age_on_profile = showAgeOnProfile;
    }

    if (typeof showGenderOnProfile === "boolean") {
      profileUpdates.show_gender_on_profile = showGenderOnProfile;
    }

    if (latitude !== undefined || longitude !== undefined || locationUpdatedAt !== undefined) {
      const normalizedLatitude =
        latitude === null || latitude === undefined ? null : Number(latitude);
      const normalizedLongitude =
        longitude === null || longitude === undefined ? null : Number(longitude);
      const latitudeValidationMessage = validateCoordinate(normalizedLatitude, "latitude");
      const longitudeValidationMessage = validateCoordinate(normalizedLongitude, "longitude");

      if (latitudeValidationMessage) {
        return c.json({ error: latitudeValidationMessage }, 400);
      }

      if (longitudeValidationMessage) {
        return c.json({ error: longitudeValidationMessage }, 400);
      }

      if ((normalizedLatitude == null) !== (normalizedLongitude == null)) {
        return c.json({ error: "Konum güncellemesinde enlem ve boylam birlikte gönderilmeli." }, 400);
      }

      privateLocationUpdate = {
        latitude: normalizedLatitude,
        longitude: normalizedLongitude,
        location_updated_at:
          normalizedLatitude != null && normalizedLongitude != null
            ? typeof locationUpdatedAt === "string" && locationUpdatedAt.trim()
              ? locationUpdatedAt
              : new Date().toISOString()
            : null,
      };
    }

    let profile = currentProfile;
    const currentAuthUserMetadata = buildAuthUserMetadata(currentProfile);
    let authMetadataSynced = false;

    if (Object.keys(profileUpdates).length > 0) {
      const nextAuthUserMetadata = buildAuthUserMetadata({
        ...currentProfile,
        ...profileUpdates,
      });
      const { error: authMetadataError } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: nextAuthUserMetadata,
      });

      if (authMetadataError) {
        console.error("Auth metadata update error:", authMetadataError);
        return c.json({ error: authMetadataError.message }, 500);
      }

      authMetadataSynced = true;

      const applyProfileUpdates = async (updates: Record<string, unknown>) =>
        supabase.from("profiles").update(updates).eq("id", userId).select(PUBLIC_PROFILE_SELECT).single();

      let { data: updatedProfile, error: profileError } = await applyProfileUpdates(profileUpdates);

      if (
        profileError &&
        (("show_age_on_profile" in profileUpdates &&
          isMissingProfileColumnError(profileError, "show_age_on_profile")) ||
          ("show_gender_on_profile" in profileUpdates &&
            isMissingProfileColumnError(profileError, "show_gender_on_profile")))
      ) {
        const legacyProfileUpdates = { ...profileUpdates };
        delete legacyProfileUpdates.show_age_on_profile;
        delete legacyProfileUpdates.show_gender_on_profile;

        if (Object.keys(legacyProfileUpdates).length === 0) {
          profileError = null;
          updatedProfile = currentProfile;
        } else {
          ({ data: updatedProfile, error: profileError } = await applyProfileUpdates(legacyProfileUpdates));
        }
      }

      if (profileError || !updatedProfile) {
        if (authMetadataSynced) {
          const { error: rollbackMetadataError } = await supabase.auth.admin.updateUserById(userId, {
            user_metadata: currentAuthUserMetadata,
          });

          if (rollbackMetadataError) {
            console.error("Auth metadata rollback error:", rollbackMetadataError);
          }
        }

        console.error("Profile update error:", profileError);
        return c.json({ error: profileError?.message ?? "Profil güncellenemedi." }, 400);
      }

      if (Array.isArray(photos)) {
        await cleanupRemovedManagedProfilePhotos(supabase, currentProfile.photos ?? [], updatedProfile.photos ?? []);
      }

      profile = updatedProfile;
    }

    if (privateLocationUpdate) {
      const privateLocationError = await upsertPrivateProfileLocation(
        supabase,
        userId,
        privateLocationUpdate,
      );

      if (privateLocationError) {
        console.error("Private profile location update error:", privateLocationError);
        return c.json({ error: getErrorMessage(privateLocationError, "Konum guncellenemedi.") }, 500);
      }

      profile = {
        ...profile,
        ...privateLocationUpdate,
      };
    }

    let nextDiscoveryPreferences = DEFAULT_DISCOVERY_PREFERENCES;

    if (requestedDiscoveryPreferences) {
      const currentCoordinates = getProfileCoordinates(profile);
      const wantsDistanceFilter = hasActiveDistanceFilter(requestedDiscoveryPreferences);

      if (wantsDistanceFilter && !currentCoordinates) {
        return c.json({ error: "Mesafe filtresi icin once konumunu paylasmalisin." }, 400);
      }

      const { error: preferenceError } = await supabase.from("discovery_preferences").upsert({
        user_id: userId,
        gender_preference: requestedDiscoveryPreferences.genderPreference,
        age_min: requestedDiscoveryPreferences.ageMin,
        age_max: requestedDiscoveryPreferences.ageMax,
        distance_min_km: requestedDiscoveryPreferences.distanceMinKm,
        distance_max_km: requestedDiscoveryPreferences.distanceMaxKm,
        compatibility_min: requestedDiscoveryPreferences.compatibilityMin,
        compatibility_max: requestedDiscoveryPreferences.compatibilityMax,
      });

      if (preferenceError) {
        console.error("Discovery preferences update error:", preferenceError);
        return c.json({ error: preferenceError.message }, 400);
      }

      nextDiscoveryPreferences = requestedDiscoveryPreferences;
    } else {
      const preferenceMap = await loadDiscoveryPreferencesMap(supabase, [userId]);
      nextDiscoveryPreferences = preferenceMap.get(userId) ?? DEFAULT_DISCOVERY_PREFERENCES;
    }

    if (favoriteMovies !== undefined || watchedMovies !== undefined || favoriteMedia !== undefined || watchedMedia !== undefined) {
      const { error: movieSyncError } = await supabase.rpc("replace_user_media_collections", {
        p_user_id: userId,
        p_favorites: favoriteMovies !== undefined || favoriteMedia !== undefined ? normalizedFavoriteMedia : null,
        p_watched: watchedMovies !== undefined || watchedMedia !== undefined ? normalizedWatchedMedia : null,
      });

      if (movieSyncError) {
        console.error("Sync user movies error:", movieSyncError);
        return c.json({ error: getErrorMessage(movieSyncError, "Film koleksiyonu guncellenemedi.") }, 400);
      }
    }

    if (currentlyWatching !== undefined || currentlyWatchingAction !== undefined) {
      const normalizedWatchAction =
        currentlyWatchingAction ?? (currentlyWatching === null ? "stop" : "start");

      if (
        (normalizedWatchAction === "start" || normalizedWatchAction === "resume") &&
        currentlyWatching !== undefined &&
        currentlyWatching !== null &&
        (typeof currentlyWatching !== "number" || !Number.isInteger(currentlyWatching) || currentlyWatching <= 0)
      ) {
        return c.json({ error: "Invalid active media request." }, 400);
      }

      const { error: watchTransitionError } = await supabase.rpc("apply_watch_session_transition", {
        p_user_id: userId,
        p_action: normalizedWatchAction,
        p_movie_id: typeof currentlyWatching === "number" ? currentlyWatching : null,
        p_media_type:
          currentlyWatchingMediaType !== undefined
            ? normalizedCurrentlyWatchingMediaType
            : null,
        p_expected_version:
          Number.isInteger(currentlyWatchingVersion) && currentlyWatchingVersion > 0
            ? currentlyWatchingVersion
            : null,
        p_duration_ms: WATCH_SESSION_DURATION_MS,
      });

      if (watchTransitionError) {
        const message = getErrorMessage(watchTransitionError, "Izleme durumu guncellenemedi.");
        const isVersionConflict =
          (watchTransitionError as { code?: string }).code === "40001" ||
          message.toLowerCase().includes("watch_version_conflict");

        console.error("Apply watch transition error:", watchTransitionError);

        if (isVersionConflict) {
          const { data: conflictWatching } = await supabase
            .from("currently_watching")
            .select("movie_id, media_type, state, version, updated_at")
            .eq("user_id", userId)
            .maybeSingle();

          return c.json({
            error: "Izleme durumu baska bir cihazda degisti. Lutfen yenileyip tekrar dene.",
            conflict: conflictWatching
              ? {
                  movieId: conflictWatching.movie_id,
                  mediaType: conflictWatching.media_type,
                  state: conflictWatching.state,
                  version: conflictWatching.version,
                  updatedAt: conflictWatching.updated_at,
                }
              : {
                  movieId: null,
                  mediaType: null,
                  state: "idle",
                  version: null,
                  updatedAt: null,
                },
          }, 409);
        }

        return c.json(
          { error: message },
          400,
        );
      }
    }

    const { data: movies, error: moviesError } = await supabase
      .from("user_movies")
      .select("movie_id, media_type, type")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_FAVORITES_COUNT + MAX_WATCHED_COUNT);

    if (moviesError) {
      console.error("Refresh user movies error:", moviesError);
      return c.json({ error: moviesError.message }, 500);
    }

    const { data: refreshedCurrentlyWatching, error: refreshedWatchingError } = await supabase
      .from("currently_watching")
      .select("movie_id, media_type, state, remaining_ms, expires_at, started_at, paused_at, version, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (refreshedWatchingError) {
      console.error("Refresh currently watching error:", refreshedWatchingError);
      return c.json({ error: refreshedWatchingError.message }, 500);
    }

    if (
      Object.keys(profileUpdates).length > 0 ||
      privateLocationUpdate ||
      requestedDiscoveryPreferences ||
      favoriteMovies !== undefined ||
      watchedMovies !== undefined ||
      favoriteMedia !== undefined ||
      watchedMedia !== undefined ||
      requestedWatchingMutation
    ) {
      queueUserEvents(supabase, [userId], "profile_changed", {
        watchChanged: requestedWatchingMutation,
        collectionsChanged:
          favoriteMovies !== undefined ||
          watchedMovies !== undefined ||
          favoriteMedia !== undefined ||
          watchedMedia !== undefined,
      });
      queueUserEvents(supabase, [userId], "discovery_changed", { reason: "profile" });
    }

    if (requestedWatchingMutation) {
      queueWatchSessionDiscoveryEvents(supabase, userId, [
        previousWatchingForEvents?.state === "active"
          ? {
              movieId: previousWatchingForEvents.movie_id,
              mediaType: previousWatchingForEvents.media_type,
            }
          : {},
        refreshedCurrentlyWatching?.state === "active"
          ? {
              movieId: refreshedCurrentlyWatching.movie_id,
              mediaType: refreshedCurrentlyWatching.media_type,
            }
          : {},
      ]);
    }

    const [signedProfile] = await signProfilePhotosForPayloads(supabase, [
      buildUserPayload(
        profile,
        movies ?? [],
        refreshedCurrentlyWatching,
        nextDiscoveryPreferences,
      ),
    ]);

    return c.json({
      success: true,
      profile: signedProfile,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.delete("/make-server-d962235e/account", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const supabase = getSupabase();
    const { data: currentProfile, error: currentProfileError } = await supabase
      .from("profiles")
      .select("photos")
      .eq("id", userId)
      .maybeSingle();

    if (currentProfileError) {
      console.error("Load profile before account delete error:", currentProfileError);
      return c.json({ error: currentProfileError.message }, 500);
    }

    const managedPhotoPaths = extractManagedProfilePhotoPaths(currentProfile?.photos ?? []);
    const updateDeletionJob = async (stage: string, lastError: string | null = null) => {
      const { error: jobError } = await supabase.from("account_deletion_jobs").upsert({
        user_id: userId,
        photo_paths: managedPhotoPaths,
        stage,
        last_error: lastError,
        updated_at: new Date().toISOString(),
        completed_at: stage === "completed" ? new Date().toISOString() : null,
      });

      if (jobError) {
        throw jobError;
      }
    };

    try {
      await updateDeletionJob("requested");
    } catch (jobError) {
      console.error("Create account deletion job error:", jobError);
      return c.json({ error: getErrorMessage(jobError, "Hesap silme kaydi olusturulamadi.") }, 500);
    }

    const [
      notificationEventCleanupResult,
      moderationReportCleanupResult,
    ] = await Promise.all([
      supabase
        .from("notification_events")
        .delete()
        .or(`actor_user_id.eq.${userId},route_user_id.eq.${userId}`),
      supabase
        .from("moderation_reports")
        .delete()
        .eq("target_user_id", userId),
    ]);

    if (notificationEventCleanupResult.error) {
      console.error("Delete account notification cleanup error:", notificationEventCleanupResult.error);
      await updateDeletionJob(
        "requested",
        getErrorMessage(notificationEventCleanupResult.error, "notification cleanup failed"),
      ).catch(() => undefined);
      return c.json({ error: getErrorMessage(notificationEventCleanupResult.error, "Bildirim kayitlari silinemedi.") }, 500);
    }

    if (moderationReportCleanupResult.error) {
      console.error("Delete account moderation cleanup error:", moderationReportCleanupResult.error);
      await updateDeletionJob(
        "requested",
        getErrorMessage(moderationReportCleanupResult.error, "moderation cleanup failed"),
      ).catch(() => undefined);
      return c.json({ error: getErrorMessage(moderationReportCleanupResult.error, "Sikayet kayitlari silinemedi.") }, 500);
    }

    await updateDeletionJob("related_data_deleted");

    if (managedPhotoPaths.length > 0) {
      const { error: storageDeleteError } = await supabase.storage
        .from(PROFILE_PHOTOS_BUCKET)
        .remove(managedPhotoPaths);

      if (storageDeleteError) {
        console.error("Delete profile photos during account delete error:", storageDeleteError);
        await updateDeletionJob(
          "related_data_deleted",
          getErrorMessage(storageDeleteError, "storage cleanup failed"),
        ).catch(() => undefined);
        return c.json({ error: getErrorMessage(storageDeleteError, "Profil fotograflari silinemedi.") }, 500);
      }
    }

    await updateDeletionJob("storage_deleted");

    const { error } = await supabase.auth.admin.deleteUser(userId, false);

    if (error) {
      console.error("Delete account error:", error);
      await updateDeletionJob("storage_deleted", error.message).catch(() => undefined);
      return c.json({ error: error.message }, 500);
    }

    await updateDeletionJob("auth_deleted").catch((jobError) => {
      console.error("Update account deletion job after auth removal error:", jobError);
    });

    const { error: deleteProfileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (deleteProfileError) {
      console.error("Delete public profile fallback error:", deleteProfileError);
      await updateDeletionJob("auth_deleted", deleteProfileError.message).catch(() => undefined);
    }

    const { data: remainingProfile, error: remainingProfileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (remainingProfileError) {
      console.error("Verify profile removal error:", remainingProfileError);
      await updateDeletionJob("auth_deleted", remainingProfileError.message).catch(() => undefined);
    }

    const cleanupPending = Boolean(deleteProfileError || remainingProfileError || remainingProfile);

    if (remainingProfile) {
      console.error("Profile row remained after auth deletion:", userId.slice(0, 8));
      await updateDeletionJob("auth_deleted", "profile row remained after auth deletion").catch(() => undefined);
    } else if (!cleanupPending) {
      await updateDeletionJob("completed").catch((jobError) => {
        console.error("Complete account deletion job error:", jobError);
      });
    }

    // deleteUser succeeded, so the caller's session no longer exists. Report a
    // successful irreversible deletion even when the durable cleanup job still
    // needs an operator retry; returning a retryable error here creates a false
    // failure after the account has already gone.
    return c.json({ success: true, cleanupPending });
  } catch (error) {
    console.error("Delete account error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.get("/make-server-d962235e/watch/live-now", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const requestedLimit = Number(c.req.query("limit") ?? LIVE_NOW_PAGE_SIZE);
    const pageSize = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 120)
      : LIVE_NOW_PAGE_SIZE;
    const cursor = decodeLiveNowCursor(c.req.query("cursor"));
    const { data: watchingRows, error: watchingError } = await supabase.rpc("get_live_now_users", {
      p_current_user_id: currentUserId,
      p_cursor_updated_at: cursor?.updatedAt ?? null,
      p_cursor_user_id: cursor?.userId ?? null,
      p_limit: pageSize + 1,
    });

    if (watchingError) {
      console.error("Live now fetch error:", watchingError);
      return c.json({ error: watchingError.message }, 500);
    }

    const candidateRows = (watchingRows ?? []) as Array<{
      user_id: string;
      movie_id: number;
      media_type: MediaType | string | null;
      updated_at: string;
    }>;
    const visibleRows = candidateRows.slice(0, pageSize);
    const userIds = [...new Set(visibleRows.map((row: { user_id: string }) => row.user_id))];
    const payloadMap = await loadUserPayloadMap(supabase, userIds);

    return c.json({
      users: userIds
        .map((userId) => payloadMap.get(userId))
        .filter((user): user is Record<string, any> => user != null),
      pageInfo: {
        hasMore: candidateRows.length > pageSize,
        nextCursor: encodeLiveNowCursor(visibleRows.at(-1) ?? {}),
      },
    });
  } catch (error) {
    console.error("Live now error:", error);
    return c.json({ error: getErrorMessage(error, "Canli izleme listesi yuklenemedi.") }, 500);
  }
});

app.get("/make-server-d962235e/users", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const activeOnly = c.req.query("activeOnly") === "1";
    const requestedLimit = Number(c.req.query("limit") ?? DEFAULT_DIRECTORY_PAGE_SIZE);
    const pageSize = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_DIRECTORY_PAGE_SIZE)
      : DEFAULT_DIRECTORY_PAGE_SIZE;
    const cursor = c.req.query("cursor")?.trim() || null;
    const blockedUserIds = await fetchBlockedUserIdsForUser(supabase, currentUserId);
    let userIds: string[] = [];
    let directoryHasMore = false;
    let nextDirectoryCursor: string | null = null;

    if (activeOnly) {
      let query = supabase
        .from("currently_watching")
        .select("user_id")
        .eq("state", "active")
        .gt("expires_at", new Date().toISOString())
        .neq("user_id", currentUserId)
        .order("user_id", { ascending: true })
        .limit(pageSize + 1);

      if (cursor) {
        query = query.gt("user_id", cursor);
      }

      const { data: watchingRows, error: watchingError } = await query;

      if (watchingError) {
        console.error("Currently watching fetch error:", watchingError);
        return c.json({ error: watchingError.message }, 500);
      }

      const visiblePageRows = (watchingRows ?? []).slice(0, pageSize);
      directoryHasMore = (watchingRows ?? []).length > pageSize;
      nextDirectoryCursor = visiblePageRows.at(-1)?.user_id ?? null;
      userIds = visiblePageRows
        .map((row: { user_id: string }) => row.user_id)
        .filter((userId: string) => !blockedUserIds.has(userId));
    } else {
      let query = supabase
        .from("profiles")
        .select("id")
        .neq("id", currentUserId)
        .order("id", { ascending: true })
        .limit(pageSize + 1);

      if (cursor) {
        query = query.gt("id", cursor);
      }

      const { data: profiles, error: profilesError } = await query;

      if (profilesError) {
        console.error("Profiles fetch error:", profilesError);
        return c.json({ error: profilesError.message }, 500);
      }

      const visiblePageRows = (profiles ?? []).slice(0, pageSize);
      directoryHasMore = (profiles ?? []).length > pageSize;
      nextDirectoryCursor = visiblePageRows.at(-1)?.id ?? null;
      userIds = visiblePageRows
        .map((profile: { id: string }) => profile.id)
        .filter((userId: string) => !blockedUserIds.has(userId));
    }

    const payloadMap = await loadUserPayloadMap(supabase, userIds);

    return c.json({
      users: userIds
        .map((userId) => payloadMap.get(userId))
        .filter((user): user is Record<string, any> => user != null),
      pageInfo: {
        hasMore: directoryHasMore,
        nextCursor: nextDirectoryCursor,
      },
    });
  } catch (error) {
    console.error("Get users error:", error);
    return c.json({ error: getErrorMessage(error, "Kullanicilar yuklenemedi.") }, 500);
  }
});

app.get("/make-server-d962235e/swipe-quota", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const quota = await loadSwipeQuotaRow(supabase, currentUserId);
    return c.json(serializeSwipeQuota(quota));
  } catch (error) {
    console.error("Get swipe quota error:", error);
    return c.json({ error: getErrorMessage(error, "Swipe kotası yüklenemedi.") }, 500);
  }
});

app.post("/make-server-d962235e/swipe-quota/consume", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const body: { kind?: unknown } = await c.req.json().catch(() => ({}));
    const kind = body?.kind;

    if (kind !== "like" && kind !== "dislike" && kind !== "undo") {
      return c.json({ error: "Geçersiz swipe kota isteği." }, 400);
    }

    const nextQuota = await consumeSwipeQuota(supabase, currentUserId, kind);

    if (!nextQuota) {
      const messages = {
        like: "Günlük beğeni hakkın doldu.",
        dislike: "Günlük beğenmeme hakkın doldu.",
        undo: "Günlük geri alma hakkın doldu.",
      } as const;

      return c.json({ error: `${messages[kind]} Yenilenmeyi beklemelisin.` }, 429);
    }

    return c.json(serializeSwipeQuota(nextQuota));
  } catch (error) {
    console.error("Consume swipe quota error:", error);
    return c.json({ error: getErrorMessage(error, "Swipe kotası güncellenemedi.") }, 500);
  }
});

app.post("/make-server-d962235e/likes/:userId", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const likedUserId = c.req.param("userId");
    const body = await c.req.json().catch(() => ({}));
    const sourceType = normalizeMatchSourceType(body?.source);
    const supabase = getSupabase();
    const rawIdempotencyKey = c.req.header("Idempotency-Key");
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);

    if (!likedUserId || likedUserId === currentUserId) {
      return c.json({ error: "Geçersiz beğeni isteği." }, 400);
    }

    if (rawIdempotencyKey && !idempotencyKey) {
      return c.json({ error: "Geçersiz idempotency anahtarı." }, 400);
    }

    let rateLimit = {
      allowed: true,
      retryAfterSeconds: 0,
    };

    try {
      rateLimit = await enforceRateLimit(supabase, {
        action: "like_user",
        key: buildAbuseKey([currentUserId, getClientIp(c)]),
        limit: MAX_LIKES_PER_MINUTE,
        windowSeconds: 60,
      });
    } catch (rateLimitError) {
      console.error("Like rate limit error:", rateLimitError);
      return c.json({ error: "Beğeni güvenlik kontrolü şu anda tamamlanamıyor. Lütfen tekrar dene." }, 503);
    }

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı beğeni gönderiyorsun. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const atomicLikeParams = {
      p_actor_user_id: currentUserId,
      p_target_user_id: likedUserId,
      p_source_type: sourceType,
      p_window_hours: SWIPE_QUOTA_WINDOW_HOURS,
      p_like_limit: DAILY_LIKE_SWIPE_LIMIT,
    };
    const { data: atomicRows, error: atomicLikeError } = idempotencyKey
      ? await supabase.rpc("process_like_action_idempotent", {
          ...atomicLikeParams,
          p_idempotency_key: idempotencyKey,
          p_payload_hash: await hashIdempotencyPayload(`${likedUserId}:${sourceType}`),
        })
      : await supabase.rpc("process_like_action_atomic", atomicLikeParams);

    if (atomicLikeError) {
      console.error("Atomic like error:", atomicLikeError);
      return c.json({ error: getErrorMessage(atomicLikeError, "Beğeni kaydedilemedi.") }, 500);
    }

    const atomicLike = Array.isArray(atomicRows) ? atomicRows[0] : atomicRows;

    if (!atomicLike) {
      return c.json({ error: "Beğeni işlemi doğrulanamadı." }, 500);
    }

    if (atomicLike.outcome === "blocked") {
      return c.json({ error: "Bu kullanıcı ile etkileşime geçemezsin." }, 403);
    }

    if (atomicLike.outcome === "quota_exhausted") {
      return c.json({ error: "Günlük beğeni hakkın doldu. Yenilenmeyi beklemelisin." }, 429);
    }

    const matchBecameActive = atomicLike.match_became_active === true;
    const matched = atomicLike.matched === true;
    const createdLike = atomicLike.outcome === "liked" || matchBecameActive;
    const idempotencyReplayed = atomicLike.idempotency_replayed === true;
    const quotaRowForResponse = normalizeSwipeQuotaRow(currentUserId, atomicLike);
    if ((createdLike || matchBecameActive) && !idempotencyReplayed) {
      const discoveryEventTask = publishUserEvents(
        supabase,
        [currentUserId, likedUserId],
        "discovery_changed",
        { reason: matchBecameActive ? "match" : "like" },
      ).catch((eventError) => {
        console.error("Discovery event broadcast error:", eventError);
      });

      if (!runAfterResponse(discoveryEventTask)) {
        void discoveryEventTask;
      }
    }

    if (matchBecameActive && !idempotencyReplayed) {
      const quotaRewardTask = rewardSwipeQuota(supabase, likedUserId, "like").catch((quotaRewardError) => {
        console.error("Peer match quota reward error:", quotaRewardError);
      });

      if (!runAfterResponse(quotaRewardTask)) {
        void quotaRewardTask;
      }

      const matchNotificationTask = (async () => {
        const nameMap = await loadProfileNameMap(supabase, [currentUserId]);
        const currentUserName = nameMap.get(currentUserId) ?? "bir kullanici";
        const currentUser = { name: currentUserName };

        await dispatchNotificationEvents(supabase, [
          {
            userId: likedUserId,
            title: "Yeni eşleşme",
            body: getMatchNotificationBody(
              sourceType,
              currentUser?.name ?? "bir kullanıcı",
            ),
            actorUserId: currentUserId,
            kind: "match",
            routeKind: "chat",
            routeUserId: currentUserId,
            payload: { sourceType },
          },
        ], { deferPush: true });
      })().catch((matchNotificationError) => {
        console.error("Match notification side effect error:", matchNotificationError);
      });

      if (!runAfterResponse(matchNotificationTask)) {
        void matchNotificationTask;
      }
    }

    if (!matched && createdLike && !idempotencyReplayed) {
      const likeNotificationTask = dispatchNotificationEvents(supabase, [
        {
          userId: likedUserId,
          actorUserId: currentUserId,
          kind: "like",
          routeKind: "likes",
          title: "Yeni begeni",
          body: buildLikeNotificationBody(),
          payload: { preferredTab: "likedme", sourceType },
        },
      ], { deferPush: true }).catch((likeNotificationError) => {
        console.error("Like notification side effect error:", likeNotificationError);
      });

      if (!runAfterResponse(likeNotificationTask)) {
        void likeNotificationTask;
      }
    }

    if (matched) {
      const hiddenChatCleanupTask = supabase
        .from("hidden_chats")
        .delete()
        .or(
          `and(user_id.eq.${currentUserId},other_user_id.eq.${likedUserId}),and(user_id.eq.${likedUserId},other_user_id.eq.${currentUserId})`,
        )
        .then(({ error }: { error?: unknown }) => {
          if (error) {
            console.error("Hidden chat cleanup error after like:", error);
          }
        });

      if (!runAfterResponse(hiddenChatCleanupTask)) {
        void hiddenChatCleanupTask;
      }
    }

    const quotaPayload = serializeSwipeQuota(quotaRowForResponse);

    return c.json({
      success: true,
      matched,
      matchedUser: null,
      rewardLikes: atomicLike.reward_granted === true ? MATCH_LIKE_REWARD_BONUS : 0,
      quota: quotaPayload,
    });
  } catch (error) {
    console.error("Like error:", error);
    return c.json({ error: getErrorMessage(error, "Beğeni işlemi tamamlanamadı.") }, 500);
  }
});

app.post("/make-server-d962235e/likes/:userId/undo", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const likedUserId = c.req.param("userId");
    const supabase = getSupabase();

    if (!likedUserId || likedUserId === currentUserId) {
      return c.json({ error: "Geçersiz geri alma isteği." }, 400);
    }

    const rateLimit = await enforceRateLimit(supabase, {
      action: "undo_like",
      key: buildAbuseKey([currentUserId, getClientIp(c)]),
      limit: MAX_CHAT_MUTATIONS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı geri alma isteği gönderiyorsun. Lütfen biraz bekle." }, 429);
    }

    const { data, error } = await supabase.rpc("undo_like_action_atomic", {
      p_actor_user_id: currentUserId,
      p_target_user_id: likedUserId,
      p_window_hours: SWIPE_QUOTA_WINDOW_HOURS,
      p_undo_limit: DAILY_UNDO_LIMIT,
    });

    if (error) {
      console.error("Atomic like undo error:", error);
      return c.json({ error: getErrorMessage(error, "Beğeni geri alınamadı.") }, 500);
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result) {
      return c.json({ error: "Geri alma işlemi doğrulanamadı." }, 500);
    }

    if (result.outcome === "active_match") {
      return c.json({ error: "Aktif bir eşleşme geri alma ile bozulamaz." }, 409);
    }

    if (result.outcome === "quota_exhausted") {
      return c.json({ error: "Günlük geri alma hakkın doldu. Yenilenmeyi beklemelisin." }, 429);
    }

    const discoveryEventTask = publishUserEvents(
      supabase,
      [currentUserId, likedUserId],
      "discovery_changed",
      { reason: "like_undo" },
    ).catch((eventError) => {
      console.error("Like undo discovery event error:", eventError);
    });

    if (!runAfterResponse(discoveryEventTask)) {
      void discoveryEventTask;
    }

    return c.json({
      success: true,
      alreadyUndone: result.outcome === "missing",
      quota: serializeSwipeQuota(normalizeSwipeQuotaRow(currentUserId, result)),
    });
  } catch (error) {
    console.error("Atomic like undo error:", error);
    return c.json({ error: getErrorMessage(error, "Beğeni geri alınamadı.") }, 500);
  }
});

  app.delete("/make-server-d962235e/likes/:userId", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const likedUserId = c.req.param("userId");
      const supabase = getSupabase();

      const existingMatch = await fetchMatchBetweenUsers(supabase, currentUserId, likedUserId);
      if (existingMatch && existingMatch.status === "active") {
        return c.json({ error: "Aktif eşleşme geri alma ile bozulamaz." }, 409);
      }

      const { error } = await supabase
        .from("likes")
        .delete()
        .eq("user_id", currentUserId)
      .eq("liked_user_id", likedUserId);

    if (error) {
      console.error("Unlike error:", error);
      return c.json({ error: getErrorMessage(error, "Beğeni geri alınamadı.") }, 400);
    }

      const remainingMatch = await fetchMatchBetweenUsers(supabase, currentUserId, likedUserId);
    if (remainingMatch && remainingMatch.status === "active") {
      const { data: reverseLike, error: reverseLikeError } = await supabase
        .from("likes")
        .select("user_id")
        .eq("user_id", likedUserId)
        .eq("liked_user_id", currentUserId)
        .maybeSingle();

      if (reverseLikeError) {
        console.error("Unlike reverse like check error:", reverseLikeError);
        return c.json({ error: getErrorMessage(reverseLikeError, "Karşı beğeni kontrolü yapılamadı.") }, 400);
      }

      if (!reverseLike) {
        const { error: matchEndError } = await supabase
          .from("matches")
          .update({
            status: "ended",
            ended_at: new Date().toISOString(),
            ended_by_user_id: currentUserId,
          })
          .eq("user1_id", remainingMatch.user1_id)
          .eq("user2_id", remainingMatch.user2_id);

        if (matchEndError) {
          console.error("Unlike match end error:", matchEndError);
          return c.json({ error: getErrorMessage(matchEndError, "Eşleşme sonlandırılamadı.") }, 400);
        }
      }
    }

    queueUserEvents(supabase, [currentUserId, likedUserId], "discovery_changed", { reason: "unlike" });
    queueUserEvents(supabase, [currentUserId, likedUserId], "chat_changed", { reason: "unlike" });
    return c.json({ success: true });
  } catch (error) {
    console.error("Unlike error:", error);
    return c.json({ error: getErrorMessage(error, "Beğeni geri alma işlemi tamamlanamadı.") }, 500);
  }
});

app.delete("/make-server-d962235e/likes/incoming/:userId", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const senderUserId = c.req.param("userId");
    const supabase = getSupabase();

    if (!senderUserId || senderUserId === currentUserId) {
      return c.json({ error: "Geçersiz beğeni kaldırma isteği." }, 400);
    }

    let rateLimit = {
      allowed: true,
      retryAfterSeconds: 0,
    };

    try {
      rateLimit = await enforceRateLimit(supabase, {
        action: "reject_incoming_like",
        key: buildAbuseKey([currentUserId, getClientIp(c)]),
        limit: MAX_LIKES_PER_MINUTE,
        windowSeconds: 60,
      });
    } catch (rateLimitError) {
      console.error("Reject incoming like rate limit fallback error:", rateLimitError);
    }

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const { error } = await supabase
      .from("likes")
      .update({ hidden_by_liked_user: true })
      .eq("user_id", senderUserId)
      .eq("liked_user_id", currentUserId);

    if (error) {
      if (isMissingColumnError(error, "hidden_by_liked_user")) {
        const fallbackDelete = await supabase
          .from("likes")
          .delete()
          .eq("user_id", senderUserId)
          .eq("liked_user_id", currentUserId);

        if (fallbackDelete.error) {
          console.error("Reject incoming like fallback delete error:", fallbackDelete.error);
          return c.json({ error: getErrorMessage(fallbackDelete.error, "Gelen beğeni kaldırılamadı.") }, 400);
        }

        queueUserEvents(supabase, [currentUserId, senderUserId], "discovery_changed", {
          reason: "incoming_like_hidden",
        });
        return c.json({ success: true });
      }

      console.error("Reject incoming like error:", error);
      return c.json({ error: getErrorMessage(error, "Gelen beğeni kaldırılamadı.") }, 400);
    }

    queueUserEvents(supabase, [currentUserId, senderUserId], "discovery_changed", {
      reason: "incoming_like_hidden",
    });
    return c.json({ success: true });
  } catch (error) {
    console.error("Reject incoming like error:", error);
    return c.json({ error: getErrorMessage(error, "Gelen beğeni kaldırılamadı.") }, 500);
  }
});

app.put("/make-server-d962235e/likes/incoming/:userId/restore", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const senderUserId = c.req.param("userId");
    const supabase = getSupabase();

    if (!senderUserId || senderUserId === currentUserId) {
      return c.json({ error: "Geçersiz beğeni geri alma isteği." }, 400);
    }

    const { error } = await supabase
      .from("likes")
      .update({ hidden_by_liked_user: false })
      .eq("user_id", senderUserId)
      .eq("liked_user_id", currentUserId);

    if (error) {
      if (isMissingColumnError(error, "hidden_by_liked_user")) {
        queueUserEvents(supabase, [currentUserId, senderUserId], "discovery_changed", {
          reason: "incoming_like_restored",
        });
        return c.json({ success: true });
      }

      console.error("Restore incoming like error:", error);
      return c.json({ error: getErrorMessage(error, "Gelen beğeni geri yüklenemedi.") }, 400);
    }

    queueUserEvents(supabase, [currentUserId, senderUserId], "discovery_changed", {
      reason: "incoming_like_restored",
    });
    return c.json({ success: true });
  } catch (error) {
    console.error("Restore incoming like error:", error);
    return c.json({ error: getErrorMessage(error, "Gelen beğeni geri yüklenemedi.") }, 500);
  }
});

app.get("/make-server-d962235e/likes", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();

    const loadLikedByRows = async () => {
      const { data, error } = await supabase
        .from("likes")
        .select("user_id")
        .eq("liked_user_id", currentUserId)
        .eq("hidden_by_liked_user", false)
        .limit(MAX_RELATIONSHIP_ROWS);

      if (!error) {
        return data ?? [];
      }

      if (isMissingColumnError(error, "hidden_by_liked_user")) {
        const fallback = await supabase
          .from("likes")
          .select("user_id")
          .eq("liked_user_id", currentUserId)
          .limit(MAX_RELATIONSHIP_ROWS);

        if (fallback.error) {
          throw fallback.error;
        }

        return fallback.data ?? [];
      }

      throw error;
    };

    const loadBlockRows = async () => {
      const { data, error } = await supabase
        .from("user_blocks")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${currentUserId},blocked_id.eq.${currentUserId}`)
        .limit(MAX_RELATIONSHIP_ROWS);

      if (!error) {
        return data ?? [];
      }

      if (isMissingRelationError(error, "user_blocks")) {
        return [];
      }

      throw error;
    };

    const [{ data: liked, error: likedError }, likedBy, blockRows] = await Promise.all([
      supabase.from("likes").select("liked_user_id").eq("user_id", currentUserId).limit(MAX_RELATIONSHIP_ROWS),
      loadLikedByRows(),
      loadBlockRows(),
    ]);

    if (likedError) {
      throw likedError;
    }

    const blockedUserIds = new Set<string>();
    (blockRows ?? []).forEach((row: { blocker_id: string; blocked_id: string }) => {
      if (row.blocker_id === currentUserId) {
        blockedUserIds.add(row.blocked_id);
      }
      if (row.blocked_id === currentUserId) {
        blockedUserIds.add(row.blocker_id);
      }
    });

    return c.json({
      liked:
        liked
          ?.map((item: { liked_user_id: string }) => item.liked_user_id)
          .filter((userId: string) => !blockedUserIds.has(userId)) ?? [],
      likedBy:
        likedBy
          ?.map((item: { user_id: string }) => item.user_id)
          .filter((userId: string) => !blockedUserIds.has(userId)) ?? [],
    });
  } catch (error) {
    console.error("Get likes error:", error);
    return c.json({ error: getErrorMessage(error, "Beğeni listesi yüklenemedi.") }, 500);
  }
});

app.get("/make-server-d962235e/discovery/watch", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const requestedLimit = Number(c.req.query("limit") ?? DEFAULT_WATCH_DISCOVERY_PAGE_SIZE);
    const pageSize = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_WATCH_DISCOVERY_PAGE_SIZE)
      : DEFAULT_WATCH_DISCOVERY_PAGE_SIZE;
    const rawCursor = c.req.query("cursor");
    const cursor = decodeLiveNowCursor(rawCursor);

    if (rawCursor && !cursor) {
      return c.json({ error: "Invalid watch discovery cursor." }, 400);
    }

    const { data: currentWatching, error: currentWatchingError } = await supabase
      .from("currently_watching")
      .select("movie_id, media_type")
      .eq("user_id", currentUserId)
      .eq("state", "active")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (currentWatchingError) {
      throw currentWatchingError;
    }

    const movieId = currentWatching?.movie_id ?? null;
    const mediaType = normalizeMediaType(currentWatching?.media_type);

    if (!movieId) {
      return c.json({ users: [], pageInfo: { hasMore: false, nextCursor: null } });
    }

    let { data: watchingData, error: watchingError } = await supabase.rpc(
      "get_watch_discovery_candidate_page",
      {
        p_current_user_id: currentUserId,
        p_movie_id: movieId,
        p_media_type: mediaType,
        p_cursor_updated_at: cursor?.updatedAt ?? null,
        p_cursor_user_id: cursor?.userId ?? null,
        p_limit: pageSize + 1,
      },
    );

    if (watchingError) {
      if (!isMissingFunctionError(watchingError, "get_watch_discovery_candidate_page")) {
        throw watchingError;
      }

      watchingData = await loadWatchCandidatePageFallback(
        supabase,
        currentUserId,
        movieId,
        mediaType,
        cursor,
        pageSize,
      );
      watchingError = null;
    }

    const watchingRows = (watchingData ?? []) as Array<{ user_id: string; updated_at: string }>;
    const visibleWatchingRows = watchingRows.slice(0, pageSize);
    const hasMore = watchingRows.length > pageSize;
    const userIds = visibleWatchingRows.map((row) => row.user_id);

    if (userIds.length === 0) {
      return c.json({ users: [], pageInfo: { hasMore: false, nextCursor: null } });
    }

    const allUserIds = [currentUserId, ...userIds];
    const [payloadMap, rawProfileMap, preferenceMap, collections] = await Promise.all([
      loadUserPayloadMap(supabase, userIds),
      loadRawProfileMap(supabase, allUserIds),
      loadDiscoveryPreferencesMap(supabase, allUserIds),
      loadMovieCollectionsForUsers(supabase, allUserIds),
    ]);
    const currentProfile = rawProfileMap.get(currentUserId);
    const currentPreferences = preferenceMap.get(currentUserId) ?? DEFAULT_DISCOVERY_PREFERENCES;
    const currentCollections = collections.get(currentUserId) ?? createEmptyMovieCollections();

    if (!currentProfile) {
      return c.json({ error: "Current profile could not be loaded." }, 409);
    }

    const users = userIds
      .map((userId) => {
        const user = payloadMap.get(userId);
        const candidateProfile = rawProfileMap.get(userId);

        if (!user || !candidateProfile || !isEmailConfirmedProfile(candidateProfile)) {
          return null;
        }

        const candidatePreferences = preferenceMap.get(userId) ?? DEFAULT_DISCOVERY_PREFERENCES;
        const candidateCollections = collections.get(userId) ?? createEmptyMovieCollections();
        const compatibilityScore = getCompatibilityBreakdown(
          currentCollections.favoriteMedia,
          currentCollections.watchedMedia,
          candidateCollections.favoriteMedia,
          candidateCollections.watchedMedia,
        ).score;

        return passesDiscoveryFilters({
          currentProfile,
          currentPreferences,
          candidateProfile,
          candidatePreferences,
          compatibilityScore,
        }) ? user : null;
      })
      .filter((user: Record<string, any> | null): user is Record<string, any> => user != null);

    return c.json({
      users,
      pageInfo: {
        hasMore,
        nextCursor: hasMore ? encodeLiveNowCursor(visibleWatchingRows.at(-1) ?? {}) : null,
      },
    });
  } catch (error) {
    console.error("Watch discovery error:", error);
    return c.json({ error: getErrorMessage(error, "Izleme kesfi yuklenemedi.") }, 500);
  }
});

app.get("/make-server-d962235e/discovery/compatibility", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const requestedLimit = Number(c.req.query("limit") ?? DEFAULT_COMPATIBILITY_PAGE_SIZE);
    const pageSize = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_COMPATIBILITY_PAGE_SIZE)
      : DEFAULT_COMPATIBILITY_PAGE_SIZE;
    const rawCursor = c.req.query("cursor");
    const cursor = decodeCompatibilityCursor(rawCursor);

    if (rawCursor && !cursor) {
      return c.json({ error: "Invalid compatibility cursor." }, 400);
    }

    const collections = await loadMovieCollectionsForUsers(supabase, [currentUserId]);
    const currentCollections = collections.get(currentUserId) ?? createEmptyMovieCollections();

    if (currentCollections.favoriteMedia.length === 0 && currentCollections.watchedMedia.length === 0) {
      return c.json({ entries: [], pageInfo: { hasMore: false, nextCursor: null } });
    }

    let { data: candidateData, error: candidateError } = await supabase.rpc(
      "get_compatibility_candidate_page",
      {
        p_current_user_id: currentUserId,
        p_cursor_overlap: cursor?.overlapCount ?? null,
        p_cursor_user_id: cursor?.userId ?? null,
        p_limit: pageSize + 1,
      },
    );

    if (candidateError) {
      if (!isMissingFunctionError(candidateError, "get_compatibility_candidate_page")) {
        console.error("Compatibility discovery error:", candidateError);
        return c.json({ error: "Compatibility discovery could not be loaded." }, 500);
      }

      candidateData = await loadCompatibilityCandidatePageFallback(
        supabase,
        currentUserId,
        currentCollections,
        cursor,
        pageSize,
      );
      candidateError = null;
    }

    const candidateRows = (candidateData ?? []) as Array<{
      user_id: string;
      overlap_count: number | string;
    }>;
    const visibleCandidateRows = candidateRows.slice(0, pageSize);
    const hasMore = candidateRows.length > pageSize;
    const candidateUserIds = visibleCandidateRows.map((row) => row.user_id);

    if (candidateUserIds.length === 0) {
      return c.json({ entries: [], pageInfo: { hasMore: false, nextCursor: null } });
    }

    const allUserIds = [currentUserId, ...candidateUserIds];
    const [payloadMap, candidateCollections, rawProfileMap, preferenceMap] = await Promise.all([
      loadUserPayloadMap(supabase, candidateUserIds),
      loadMovieCollectionsForUsers(supabase, candidateUserIds),
      loadRawProfileMap(supabase, allUserIds),
      loadDiscoveryPreferencesMap(supabase, allUserIds),
    ]);
    const currentProfile = rawProfileMap.get(currentUserId);
    const currentPreferences = preferenceMap.get(currentUserId) ?? DEFAULT_DISCOVERY_PREFERENCES;

    if (!currentProfile) {
      return c.json({ error: "Current profile could not be loaded." }, 409);
    }

    const entries = candidateUserIds
      .map((userId) => {
        const user = payloadMap.get(userId);
        const candidateProfile = rawProfileMap.get(userId);
        const userCollections = candidateCollections.get(userId) ?? createEmptyMovieCollections();

        if (!user || !candidateProfile || !isEmailConfirmedProfile(candidateProfile)) {
          return null;
        }

        const compatibility = getCompatibilityBreakdown(
          currentCollections.favoriteMedia,
          currentCollections.watchedMedia,
          userCollections.favoriteMedia,
          userCollections.watchedMedia,
        );
        const candidatePreferences = preferenceMap.get(userId) ?? DEFAULT_DISCOVERY_PREFERENCES;

        if (
          compatibility.score <= 0 ||
          !passesDiscoveryFilters({
            currentProfile,
            currentPreferences,
            candidateProfile,
            candidatePreferences,
            compatibilityScore: compatibility.score,
          })
        ) {
          return null;
        }

        return { user, score: compatibility.score };
      })
      .filter((entry): entry is { user: Record<string, any>; score: number } => entry != null)
      .sort((left, right) => right.score - left.score || left.user.id.localeCompare(right.user.id));

    return c.json({
      entries,
      pageInfo: {
        hasMore,
        nextCursor: hasMore
          ? encodeCompatibilityCursor(visibleCandidateRows.at(-1) ?? {})
          : null,
      },
    });
  } catch (error) {
    console.error("Compatibility discovery error:", error);
    return c.json({ error: getErrorMessage(error, "Uyum kesfi yuklenemedi.") }, 500);
  }
});

  app.get("/make-server-d962235e/discovery/likes", authMiddleware, async (c) => {
    try {
      const currentUserId = c.get("userId");
      const supabase = getSupabase();

      const [blockedUserIds, likeSets, matchedUserIds] = await Promise.all([
        fetchBlockedUserIdsForUser(supabase, currentUserId),
        fetchLikeSets(supabase, currentUserId),
        fetchActiveMatchedUserIdsForUser(supabase, currentUserId),
      ]);
      const reconciledMatchedUserIds = await reconcileMutualLikesForUser(
        supabase,
        currentUserId,
        likeSets,
        "like",
      );
      reconciledMatchedUserIds.forEach((userId) => matchedUserIds.add(userId));
      const likedUserIds = [...likeSets.likedIds].filter(
        (userId) => !blockedUserIds.has(userId) && !matchedUserIds.has(userId),
      );
      const likedByUserIds = [...likeSets.likedByIds].filter(
        (userId) => !blockedUserIds.has(userId) && !matchedUserIds.has(userId),
      );
    const incomingLikesUnlocked = await userHasIncomingLikesEntitlement(supabase, currentUserId);
    const payloadMap = await loadUserPayloadMap(
      supabase,
      [...new Set([...likedUserIds, ...(incomingLikesUnlocked ? likedByUserIds : [])])],
    );

    return c.json({
      likedUsers: likedUserIds
        .map((userId) => payloadMap.get(userId))
        .filter((user): user is Record<string, any> => user != null),
      likedByUsers: incomingLikesUnlocked
        ? likedByUserIds
            .map((userId) => payloadMap.get(userId))
            .filter((user): user is Record<string, any> => user != null)
        : [],
      likedByUserIds: incomingLikesUnlocked ? likedByUserIds : [],
      likedByCount: likedByUserIds.length,
      likedByLocked: !incomingLikesUnlocked,
    });
  } catch (error) {
    console.error("Likes discovery error:", error);
    return c.json({ error: getErrorMessage(error, "Begeniler yuklenemedi.") }, 500);
  }
});

app.get("/make-server-d962235e/matches", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();

    const { data: matches, error } = await supabase
      .from("matches")
      .select(MATCH_SELECT)
      .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
      .order("created_at", { ascending: false })
      .limit(MAX_RELATIONSHIP_ROWS);

    if (error) {
      console.error("Get matches error:", error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ matches: matches ?? [] });
  } catch (error) {
    console.error("Get matches error:", error);
    return c.json({ error: getErrorMessage(error, "Eslesmeler yuklenemedi.") }, 500);
  }
});

app.put("/make-server-d962235e/matches/status", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const { user1Id, user2Id, action } = await c.req.json();
    const supabase = getSupabase();

    if (!user1Id || !user2Id || !["end", "block", "unblock"].includes(action)) {
      return c.json({ error: "Invalid match status payload" }, 400);
    }

    if (currentUserId !== user1Id && currentUserId !== user2Id) {
      return c.json({ error: "Bu eşleşmeyi güncelleyemezsin." }, 403);
    }

    const otherUserId = currentUserId === user1Id ? user2Id : user1Id;
    const { data: relationshipRows, error: relationshipError } = await supabase.rpc(
      "update_pair_relationship_atomic",
      {
        p_actor_user_id: currentUserId,
        p_target_user_id: otherUserId,
        p_action: action,
      },
    );

    if (relationshipError) {
      console.error("Atomic match update error:", relationshipError);
      return c.json({ error: getErrorMessage(relationshipError, "Eşleşme güncellenemedi.") }, 500);
    }

    const relationship = Array.isArray(relationshipRows) ? relationshipRows[0] : relationshipRows;
    if (!relationship || relationship.outcome === "missing_match") {
      return c.json({ error: "Eşleşme bulunamadı." }, 404);
    }

    const notificationKind = action === "block"
      ? "chat_blocked"
      : action === "unblock"
        ? "chat_unblocked"
        : "chat_ended";
    const eventReason = action === "block"
      ? "match_blocked"
      : action === "unblock"
        ? "match_unblocked"
        : "match_ended";

    queueChatStatusNotification(supabase, {
      recipientUserId: otherUserId,
      actorUserId: currentUserId,
      kind: notificationKind,
    });

    queuePairStateEvents(supabase, currentUserId, otherUserId, eventReason);
    return c.json({ success: true });
  } catch (error) {
    console.error("Update match error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.get("/make-server-d962235e/blocks", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();

    const { data: blockRows, error } = await supabase
      .from("user_blocks")
      .select("blocked_id, created_at")
      .eq("blocker_id", currentUserId)
      .order("created_at", { ascending: false })
      .limit(MAX_RELATIONSHIP_ROWS);

    if (error) {
      console.error("Get blocks error:", error);
      return c.json({ error: error.message }, 500);
    }

    const blockedUserIds: string[] = (blockRows ?? []).map((row: { blocked_id: string }) => row.blocked_id);
    const userMap = await loadUserPayloadMap(supabase, blockedUserIds);

    return c.json({
      users: blockedUserIds
        .map((userId: string) => userMap.get(userId))
        .filter((user: Record<string, any> | undefined): user is Record<string, any> => user != null),
    });
  } catch (error) {
    console.error("Get blocks error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.post("/make-server-d962235e/blocks/:userId", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const blockedUserId = c.req.param("userId");
    const supabase = getSupabase();

    if (!blockedUserId || blockedUserId === currentUserId) {
      return c.json({ error: "Geçersiz engelleme isteği." }, 400);
    }

    const rateLimit = await enforceRateLimit(supabase, {
      action: "block_user",
      key: buildAbuseKey([currentUserId, getClientIp(c)]),
      limit: MAX_BLOCK_MUTATIONS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const { data: blockRows, error: blockError } = await supabase.rpc(
      "update_pair_relationship_atomic",
      {
        p_actor_user_id: currentUserId,
        p_target_user_id: blockedUserId,
        p_action: "block",
      },
    );

    if (blockError) {
      console.error("Atomic user block error:", blockError);
      return c.json({ error: getErrorMessage(blockError, "Kullanıcı engellenemedi.") }, 500);
    }

    const blockResult = Array.isArray(blockRows) ? blockRows[0] : blockRows;
    if (!blockResult) {
      return c.json({ error: "Engelleme işlemi doğrulanamadı." }, 500);
    }

    if (blockResult.match_status) {
      queueChatStatusNotification(supabase, {
        recipientUserId: blockedUserId,
        actorUserId: currentUserId,
        kind: "chat_blocked",
      });
    }

    queuePairStateEvents(supabase, currentUserId, blockedUserId, "user_blocked");
    return c.json({ success: true });
  } catch (error) {
    console.error("Block user error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.delete("/make-server-d962235e/blocks/:userId", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const blockedUserId = c.req.param("userId");
    const supabase = getSupabase();

    const rateLimit = await enforceRateLimit(supabase, {
      action: "unblock_user",
      key: buildAbuseKey([currentUserId, getClientIp(c)]),
      limit: MAX_BLOCK_MUTATIONS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const { data: unblockRows, error: unblockError } = await supabase.rpc(
      "update_pair_relationship_atomic",
      {
        p_actor_user_id: currentUserId,
        p_target_user_id: blockedUserId,
        p_action: "unblock",
      },
    );

    if (unblockError) {
      console.error("Atomic user unblock error:", unblockError);
      return c.json({ error: getErrorMessage(unblockError, "Kullanıcının engeli kaldırılamadı.") }, 500);
    }

    const unblockResult = Array.isArray(unblockRows) ? unblockRows[0] : unblockRows;
    if (!unblockResult) {
      return c.json({ error: "Engel kaldırma işlemi doğrulanamadı." }, 500);
    }

    if (unblockResult.match_status) {
      queueChatStatusNotification(supabase, {
        recipientUserId: blockedUserId,
        actorUserId: currentUserId,
        kind: "chat_unblocked",
      });
    }

    queuePairStateEvents(supabase, currentUserId, blockedUserId, "user_unblocked");
    return c.json({ success: true });
  } catch (error) {
    console.error("Unblock user error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.post("/make-server-d962235e/chats/:userId/hide", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const otherUserId = c.req.param("userId");
    const supabase = getSupabase();

    if (!otherUserId || otherUserId === currentUserId) {
      return c.json({ error: "Geçersiz sohbet isteği." }, 400);
    }

    const rateLimit = await enforceRateLimit(supabase, {
      action: "hide_chat",
      key: buildAbuseKey([currentUserId, getClientIp(c)]),
      limit: MAX_CHAT_MUTATIONS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const { error } = await supabase
      .from("hidden_chats")
      .upsert({ user_id: currentUserId, other_user_id: otherUserId });

    if (error) {
      console.error("Hide chat error:", error);
      return c.json({ error: error.message }, 400);
    }

    queueUserEvents(supabase, [currentUserId], "chat_changed", { reason: "chat_hidden" });
    return c.json({ success: true });
  } catch (error) {
    console.error("Hide chat error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.post("/make-server-d962235e/chats/:userId/delete", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const otherUserId = c.req.param("userId");
    const supabase = getSupabase();
    const body = await c.req.json().catch(() => ({}));
    const mode =
      body?.mode === "block" || body?.mode === "end"
        ? body.mode
        : "end";

    if (!otherUserId || otherUserId === currentUserId) {
      return c.json({ error: "Geçersiz sohbet silme isteği." }, 400);
    }

    const rateLimit = await enforceRateLimit(supabase, {
      action: "delete_chat",
      key: buildAbuseKey([currentUserId, otherUserId, getClientIp(c), mode]),
      limit: MAX_CHAT_MUTATIONS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const { data: deletionRows, error: deletionError } = await supabase.rpc(
      "delete_chat_for_user_atomic",
      {
        p_actor_user_id: currentUserId,
        p_target_user_id: otherUserId,
        p_mode: mode,
      },
    );

    if (deletionError) {
      console.error("Atomic chat deletion error:", deletionError);
      return c.json({ error: getErrorMessage(deletionError, "Sohbet silinemedi.") }, 400);
    }

    const deletionResult = Array.isArray(deletionRows) ? deletionRows[0] : deletionRows;
    if (!deletionResult) {
      return c.json({ error: "Sohbet silme işlemi doğrulanamadı." }, 500);
    }

    const deletedForEveryone = deletionResult.deleted_for_everyone === true;
    queuePairStateEvents(
      supabase,
      currentUserId,
      otherUserId,
      deletedForEveryone ? "chat_deleted_for_everyone" : "chat_deleted",
    );
    return c.json({
      success: true,
      deletedForSelf: deletionResult.deleted_for_self === true,
      deletedForEveryone,
    });
  } catch (error) {
    console.error("Delete chat error:", error);
    return c.json({ error: getErrorMessage(error, "Sohbet silinemedi.") }, 500);
  }
});

app.put("/make-server-d962235e/chats/:userId/settings", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const otherUserId = c.req.param("userId");
    const supabase = getSupabase();

    if (!otherUserId || otherUserId === currentUserId) {
      return c.json({ error: "Geçersiz sohbet ayarı isteği." }, 400);
    }

    const rateLimit = await enforceRateLimit(supabase, {
      action: "update_chat_settings",
      key: buildAbuseKey([currentUserId, otherUserId, getClientIp(c)]),
      limit: MAX_CHAT_MUTATIONS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const body = await c.req.json().catch(() => ({}));
    const nextSettings = serializeChatSettings({
      read_receipts_enabled: body?.settings?.readReceipts,
      online_status_enabled: body?.settings?.onlineStatus,
      typing_indicator_enabled: body?.settings?.typingIndicator,
      notifications_enabled: body?.settings?.notifications,
    });

    const { error } = await supabase.from("chat_settings").upsert({
      owner_user_id: currentUserId,
      other_user_id: otherUserId,
      read_receipts_enabled: nextSettings.readReceipts,
      online_status_enabled: nextSettings.onlineStatus,
      typing_indicator_enabled: nextSettings.typingIndicator,
      notifications_enabled: nextSettings.notifications,
    });

    if (error) {
      console.error("Update chat settings error:", error);
      return c.json({ error: error.message }, 400);
    }

    queueUserEvents(supabase, [currentUserId, otherUserId], "chat_changed", {
      reason: "chat_settings",
    });
    return c.json({ settings: nextSettings });
  } catch (error) {
    console.error("Update chat settings error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.post("/make-server-d962235e/reports", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const body = await c.req.json().catch(() => ({}));
    const targetType = sanitizeReportTargetType(body?.targetType);
    const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId.trim() : "";
    const targetRecordId =
      typeof body?.targetRecordId === "string" && body.targetRecordId.trim().length > 0
        ? body.targetRecordId.trim().slice(0, 160)
        : null;
    const reasonCode = sanitizeReportReasonCode(body?.reasonCode);
    const details = sanitizeReportDetails(body?.details);
    const matchContext =
      body?.matchContext && typeof body.matchContext === "object" ? body.matchContext : null;
    const clientContext =
      body?.clientContext && typeof body.clientContext === "object" ? body.clientContext : {};

    if (targetType === "profile" && (!targetUserId || targetUserId === currentUserId)) {
      return c.json({ error: "Gecersiz sikayet hedefi." }, 400);
    }

    if (details.length < MIN_REPORT_DETAILS_LENGTH) {
      return c.json({ error: "Sikayet detaylarini daha acik yazmalisin." }, 400);
    }

    const rateLimit = await enforceRateLimit(supabase, {
      action: "report_user",
      key: buildAbuseKey([currentUserId, targetUserId, getClientIp(c)]),
      limit: MAX_REPORTS_PER_HOUR,
      windowSeconds: 60 * 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Cok sik sikayet gonderdin. Lutfen daha sonra tekrar dene." }, 429);
    }

    const userMap = await loadUserPayloadMap(
      supabase,
      [currentUserId, targetUserId].filter(Boolean),
    );
    const reporterSnapshot = buildReportUserSnapshot(userMap.get(currentUserId));
    const targetSnapshot = buildReportUserSnapshot(userMap.get(targetUserId));

    if (targetType === "profile" && !targetSnapshot) {
      return c.json({ error: "Sikayet edilen profil bulunamadi." }, 404);
    }

    const contextSnapshot = {
      matchContext,
      clientContext,
    };

    const { data: insertedReport, error } = await supabase
      .from("moderation_reports")
      .insert({
        reporter_user_id: currentUserId,
        target_user_id: targetUserId || null,
        target_type: targetType,
        target_record_id: targetRecordId,
        reason_code: reasonCode,
        details,
        reporter_snapshot: reporterSnapshot ?? {},
        target_snapshot: targetSnapshot ?? {},
        context_snapshot: contextSnapshot,
      })
      .select("id, target_type, reason_code, details, reporter_snapshot, target_snapshot, context_snapshot, created_at")
      .single();

    if (error) {
      if (isMissingRelationError(error, "moderation_reports")) {
        return c.json({ error: "Sikayet sistemi henuz deploy edilmedi." }, 503);
      }

      console.error("Create moderation report error:", error);
      return c.json({ error: getErrorMessage(error, "Sikayet kaydedilemedi.") }, 400);
    }

    let mailed = false;

    try {
      mailed = await sendModerationReportEmail({
        id: insertedReport.id,
        targetType: insertedReport.target_type,
        reasonCode: insertedReport.reason_code,
        details: insertedReport.details,
        reporterSnapshot: insertedReport.reporter_snapshot,
        targetSnapshot: insertedReport.target_snapshot,
        contextSnapshot: insertedReport.context_snapshot,
        createdAt: insertedReport.created_at,
      });
    } catch (mailError) {
      console.error("Moderation report mail error:", mailError);
    }

    return c.json({
      success: true,
      reportId: insertedReport.id,
      mailed,
    });
  } catch (error) {
    console.error("Create moderation report error:", error);
    return c.json({ error: getErrorMessage(error, "Sikayet gonderilemedi.") }, 500);
  }
});

app.post("/make-server-d962235e/notifications/push-outbox/drain", async (c) => {
  const configuredSecret = Deno.env.get("NOTIFICATION_WORKER_SECRET")?.trim();
  const providedSecret = c.req.header("X-WMatch-Worker-Secret")?.trim();

  if (!configuredSecret) {
    return c.json({ error: "Push delivery worker is not configured." }, 503);
  }

  if (!providedSecret || providedSecret !== configuredSecret) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  try {
    const processed = await drainPushDeliveryOutbox(getSupabase());
    return c.json({ success: true, processed });
  } catch (error) {
    console.error("Push outbox drain error:", error);
    return c.json({ error: "Push delivery retry failed." }, 500);
  }
});

app.post("/make-server-d962235e/notifications/push-token", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const body = await c.req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const platform = typeof body?.platform === "string" ? body.platform.trim().toLowerCase() : "unknown";

    if (!token || (!token.startsWith("ExpoPushToken[") && !token.startsWith("ExponentPushToken["))) {
      return c.json({ error: "Geçersiz push token." }, 400);
    }

    const rateLimit = await enforceRateLimit(supabase, {
      action: "register_push_token",
      key: buildAbuseKey([currentUserId, getClientIp(c)]),
      limit: MAX_PUSH_TOKEN_REGISTRATIONS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı işlem yaptın. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const normalizedPlatform =
      platform === "ios" || platform === "android" ? platform : "unknown";

    const { error } = await supabase.from("device_push_tokens").upsert({
      token,
      user_id: currentUserId,
      platform: normalizedPlatform,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Register push token error:", error);
      return c.json({ error: error.message }, 400);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Register push token error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.delete("/make-server-d962235e/notifications/push-token", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const body = await c.req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";

    const rateLimit = await enforceRateLimit(supabase, {
      action: "delete_push_token",
      key: buildAbuseKey([currentUserId, getClientIp(c), token]),
      limit: MAX_PUSH_TOKEN_REGISTRATIONS_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Cok hizli islem yaptin. Lutfen biraz bekleyip tekrar dene." }, 429);
    }

    let query = supabase.from("device_push_tokens").delete().eq("user_id", currentUserId);

    if (token) {
      query = query.eq("token", token);
    }

    const { error } = await query;

    if (error) {
      console.error("Delete push token error:", error);
      return c.json({ error: error.message }, 400);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Delete push token error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.put("/make-server-d962235e/notifications/events/:eventId/read", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const eventId = c.req.param("eventId");
    const supabase = getSupabase();

    const { error } = await supabase
      .from("notification_events")
      .update({ read_at: new Date().toISOString() })
      .eq("id", eventId)
      .eq("user_id", currentUserId)
      .is("read_at", null);

    if (error) {
      if (isMissingRelationError(error, "notification_events")) {
        return c.json({ success: true, skipped: true });
      }

      console.error("Mark notification event read error:", error);
      return c.json({ error: error.message }, 400);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Mark notification event read error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.get("/make-server-d962235e/messages/:userId", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const otherUserId = c.req.param("userId");
    const supabase = getSupabase();
    const requestedLimit = Number(c.req.query("limit") ?? DEFAULT_CHAT_THREAD_PAGE_SIZE);
    const pageSize = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_CHAT_THREAD_PAGE_SIZE)
      : DEFAULT_CHAT_THREAD_PAGE_SIZE;
    const tupleCursor = decodeMessageCursor(c.req.query("cursor"));
    const legacyBeforeCursor = c.req.query("before");

    const match = await fetchMatchBetweenUsers(supabase, currentUserId, otherUserId);
    const visibleSince = getChatVisibleSince(match, currentUserId);
    const deletedChatAt = getMatchChatDeletedAt(match, currentUserId);
    if (deletedChatAt) {
      return c.json({ error: "Sohbet bulunamadı." }, 404);
    }

    const [
      blockRows,
      userMap,
      likeTimelineMap,
      ownSettingsMap,
      peerSettingsMap,
      { data: messages, error: messagesError },
    ] = await Promise.all([
      fetchBlockRows(supabase, currentUserId, otherUserId),
      loadUserPayloadMap(supabase, [otherUserId]),
      loadLikeTimelineMap(supabase, [{ user1Id: currentUserId, user2Id: otherUserId }]),
      loadChatSettingsMap(supabase, currentUserId, [otherUserId]),
      loadChatSettingsMap(supabase, otherUserId, [currentUserId]),
      (() => {
        let query = supabase
          .from("messages")
          .select(MESSAGE_SELECT)
          .or(
            `and(sender_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUserId})`,
          )
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(pageSize + 1);

        if (visibleSince) {
          query = query.gte("created_at", visibleSince);
        }

        if (tupleCursor) {
          query = query.or(
            `created_at.lt.${tupleCursor.createdAt},and(created_at.eq.${tupleCursor.createdAt},id.lt.${tupleCursor.id})`,
          );
        } else if (legacyBeforeCursor && Number.isFinite(new Date(legacyBeforeCursor).getTime())) {
          query = query.lt("created_at", legacyBeforeCursor);
        }

        return query;
      })(),
    ]);

    if (messagesError) {
      console.error("Get messages error:", messagesError);
      return c.json({ error: messagesError.message }, 500);
    }

    const fetchedMessages = messages ?? [];
    if (!match && fetchedMessages.length === 0) {
      return c.json({ error: "Sohbet bulunamadi." }, 404);
    }

    const hasMoreMessages = fetchedMessages.length > pageSize;
    const visibleMessages = fetchedMessages
      .slice(0, pageSize)
      .filter((message: { created_at?: string | null }) =>
        !isTimestampBefore(message.created_at ?? null, visibleSince),
      )
      .sort((left: { created_at?: string | null; id?: string | null }, right: { created_at?: string | null; id?: string | null }) =>
        new Date(left.created_at ?? "").getTime() - new Date(right.created_at ?? "").getTime() ||
        String(left.id ?? "").localeCompare(String(right.id ?? "")),
      );
    const chatState = getChatState(match, currentUserId, otherUserId, blockRows);
    const user = userMap.get(otherUserId) ?? buildFallbackUserPayload(otherUserId);
    const likeTimeline = likeTimelineMap.get(getPairKey(currentUserId, otherUserId)) ?? null;
    const lastMessageTime =
      visibleMessages.at(-1)?.created_at ?? visibleSince ?? match?.created_at ?? match?.updated_at ?? new Date().toISOString();
    const matchCreatedAtMs = new Date(match?.created_at ?? "").getTime();
    const hasConversationActivity = Boolean(
      visibleMessages.length &&
        (!match ||
          !Number.isFinite(matchCreatedAtMs) ||
          new Date(lastMessageTime).getTime() >= matchCreatedAtMs),
    );

    return c.json({
      messages: visibleMessages,
      pageInfo: {
        hasMore: hasMoreMessages,
        nextCursor: encodeMessageCursor(visibleMessages[0] ?? {}),
      },
      chat: {
        userId: otherUserId,
        user,
        lastMessage: visibleMessages.at(-1)?.text ?? "",
        lastMessageTime,
        hasConversationActivity,
        unread: Boolean(
          visibleMessages.some(
            (message: { sender_id: string; receiver_id: string; read: boolean }) =>
              message.sender_id === otherUserId &&
              message.receiver_id === currentUserId &&
              !message.read,
          ),
        ),
        matchContext: buildMatchContextSnapshot(match, likeTimeline, currentUserId),
        settings: ownSettingsMap.get(otherUserId) ?? { ...DEFAULT_CHAT_SETTINGS },
        peerSettings: peerSettingsMap.get(currentUserId) ?? { ...DEFAULT_CHAT_SETTINGS },
        ...chatState,
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);
    return c.json({ error: getErrorMessage(error, "Mesajlar yuklenemedi.") }, 500);
  }
});

app.post("/make-server-d962235e/messages/:userId", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const receiverId = c.req.param("userId");
    const { text, clientMessageId } = await c.req.json();
    const supabase = getSupabase();

    const normalizedText = typeof text === "string" ? text.trim() : "";
    const normalizedClientMessageId =
      typeof clientMessageId === "string" && /^[\w:.-]{8,120}$/.test(clientMessageId.trim())
        ? clientMessageId.trim()
        : null;
    const messageValidationMessage = validateMessageText(normalizedText);
    if (messageValidationMessage) {
      return c.json({ error: messageValidationMessage }, 400);
    }

    const rateLimit = await enforceRateLimit(supabase, {
      action: "send_message",
      key: buildAbuseKey([currentUserId, receiverId, getClientIp(c)]),
      limit: MAX_MESSAGES_PER_MINUTE,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return c.json({ error: "Çok hızlı mesaj gönderiyorsun. Lütfen biraz bekleyip tekrar dene." }, 429);
    }

    const [match, blockRows] = await Promise.all([
      fetchMatchBetweenUsers(supabase, currentUserId, receiverId),
      fetchBlockRows(supabase, currentUserId, receiverId),
    ]);
    const chatState = getChatState(match, currentUserId, receiverId, blockRows);
    const receiverDeletedChatAt = getMatchChatDeletedAt(match, receiverId);

    if (!chatState.canSend) {
      return c.json({ error: chatState.lockedReason ?? "Mesaj gönderemezsin." }, 403);
    }

    const insertMessage = (includeClientMessageId: boolean) => {
      const payload: Record<string, unknown> = {
        sender_id: currentUserId,
        receiver_id: receiverId,
        text: normalizedText,
      };

      if (includeClientMessageId && normalizedClientMessageId) {
        payload.client_message_id = normalizedClientMessageId;
      }

      return supabase
        .from("messages")
        .insert(payload)
        .select(MESSAGE_SELECT)
        .single();
    };

    let { data: message, error } = await insertMessage(Boolean(normalizedClientMessageId));

    if (
      error &&
      normalizedClientMessageId &&
      (((error as { code?: string }).code === "23505") ||
        getErrorMessage(error, "").toLowerCase().includes("duplicate"))
    ) {
      const existingMessageResult = await supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("sender_id", currentUserId)
        .eq("client_message_id", normalizedClientMessageId)
        .maybeSingle();

      if (!existingMessageResult.error && existingMessageResult.data) {
        message = existingMessageResult.data;
        error = null;
      }
    }

    if (error && normalizedClientMessageId && isMissingColumnError(error, "client_message_id")) {
      ({ data: message, error } = await insertMessage(false));
    }

    if (error) {
      console.error("Send message error:", error);
      return c.json({ error: error.message }, 400);
    }

    await supabase
      .from("hidden_chats")
      .delete()
      .or(
        `and(user_id.eq.${currentUserId},other_user_id.eq.${receiverId}),and(user_id.eq.${receiverId},other_user_id.eq.${currentUserId})`,
      );

    const messageNotificationTask = (async () => {
      if (receiverDeletedChatAt) {
        return;
      }

      const [senderMap, receiverSettingsMap, unreadMessageGroup] = await Promise.all([
        loadUserPayloadMap(supabase, [currentUserId]),
        loadChatSettingsMap(supabase, receiverId, [currentUserId]),
        loadUnreadMessageNotificationLines(supabase, receiverId, currentUserId),
      ]);
      const sender = senderMap.get(currentUserId);
      const receiverSettings = receiverSettingsMap.get(currentUserId) ?? { ...DEFAULT_CHAT_SETTINGS };
      const messagePreview = buildMessageNotificationBody(normalizedText);
      const nextLines = unreadMessageGroup.lines.length > 0 ? unreadMessageGroup.lines : [messagePreview];
      const groupedMessageCount = Math.max(unreadMessageGroup.totalCount, nextLines.length);
      const senderName =
        typeof sender?.name === "string" && sender.name.trim().length > 0
          ? sender.name.trim()
          : "Yeni mesaj";
      const notificationTag = buildChatNotificationTag(receiverId, currentUserId);
      const collapseId = notificationTag;

      if (receiverSettings.notifications) {
        await dispatchNotificationEvents(supabase, [
          {
            userId: receiverId,
            title: senderName,
            body: buildGroupedMessageNotificationBody(nextLines, groupedMessageCount),
            actorUserId: currentUserId,
            kind: "message",
            routeKind: "chat",
            routeUserId: currentUserId,
            payload: {
              messagePreview,
              senderName,
              notificationTag,
              collapseId,
              groupedMessageCount,
            },
          },
        ], { deferPush: true });
      }
    })().catch((notificationError) => {
      console.error("Send push notification error:", notificationError);
    });

    if (!runAfterResponse(messageNotificationTask)) {
      void messageNotificationTask;
    }

    queueUserEvents(supabase, [currentUserId, receiverId], "chat_changed", {
      reason: "message_sent",
      message,
    });
    return c.json({ message });
  } catch (error) {
    console.error("Send message error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.put("/make-server-d962235e/messages/thread/:userId/read", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const otherUserId = c.req.param("userId");
    const supabase = getSupabase();

    const { error } = await supabase
      .from("messages")
      .update({ read: true })
      .eq("sender_id", otherUserId)
      .eq("receiver_id", currentUserId)
      .eq("read", false);

    if (error) {
      console.error("Mark thread read error:", error);
      return c.json({ error: error.message }, 400);
    }

    await markChatNotificationEventsRead(supabase, currentUserId, otherUserId);

    queueUserEvents(supabase, [currentUserId, otherUserId], "chat_changed", { reason: "thread_read" });
    return c.json({ success: true });
  } catch (error) {
    console.error("Mark thread read error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.put("/make-server-d962235e/messages/:messageId/read", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const messageId = c.req.param("messageId");
    const supabase = getSupabase();

    const { data: readMessage, error } = await supabase
      .from("messages")
      .update({ read: true })
      .eq("id", messageId)
      .eq("receiver_id", currentUserId)
      .select("sender_id")
      .maybeSingle();

    if (error) {
      console.error("Mark read error:", error);
      return c.json({ error: error.message }, 400);
    }

    if (readMessage?.sender_id) {
      queueUserEvents(supabase, [currentUserId, readMessage.sender_id], "chat_changed", {
        reason: "message_read",
      });
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Mark read error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

app.get("/make-server-d962235e/chats", authMiddleware, async (c) => {
  try {
    const currentUserId = c.get("userId");
    const supabase = getSupabase();
    const requestedLimit = Number(c.req.query("limit") ?? DEFAULT_CHAT_DIRECTORY_PAGE_SIZE);
    const pageSize = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_CHAT_DIRECTORY_PAGE_SIZE)
      : DEFAULT_CHAT_DIRECTORY_PAGE_SIZE;
    const rawCursor = c.req.query("cursor");
    const cursor = decodeChatDirectoryCursor(rawCursor);

    if (rawCursor && !cursor) {
      return c.json({ error: "Invalid chat directory cursor." }, 400);
    }

    let { data: directoryData, error: directoryError } = await supabase.rpc("get_chat_directory_page", {
      p_current_user_id: currentUserId,
      p_cursor_time: cursor?.activityAt ?? null,
      p_cursor_user_id: cursor?.userId ?? null,
      p_limit: pageSize + 1,
    });

    if (directoryError) {
      if (!isMissingFunctionError(directoryError, "get_chat_directory_page")) {
        console.error("Get chat directory error:", directoryError);
        return c.json({ error: getErrorMessage(directoryError, "Sohbetler yuklenemedi.") }, 500);
      }

      directoryData = await loadChatDirectoryPageFallback(
        supabase,
        currentUserId,
        cursor,
        pageSize,
      );
      directoryError = null;
    }

    const directoryRows = (directoryData ?? []) as Array<{
      other_user_id: string;
      activity_at: string;
    }>;
    const visibleDirectoryRows = directoryRows.slice(0, pageSize);
    const hasMore = directoryRows.length > pageSize;

    if (visibleDirectoryRows.length === 0) {
      return c.json({
        chats: [],
        pageInfo: { hasMore: false, nextCursor: null },
      });
    }

    const otherUserIds = visibleDirectoryRows.map((row) => row.other_user_id);
    const [user1MatchesResult, user2MatchesResult, blockedByMeResult, blockedByOtherResult] = await Promise.all([
      supabase
        .from("matches")
        .select(MATCH_SELECT)
        .eq("user1_id", currentUserId)
        .in("user2_id", otherUserIds)
        .limit(otherUserIds.length),
      supabase
        .from("matches")
        .select(MATCH_SELECT)
        .eq("user2_id", currentUserId)
        .in("user1_id", otherUserIds)
        .limit(otherUserIds.length),
      supabase
        .from("user_blocks")
        .select("blocker_id, blocked_id")
        .eq("blocker_id", currentUserId)
        .in("blocked_id", otherUserIds)
        .limit(otherUserIds.length),
      supabase
        .from("user_blocks")
        .select("blocker_id, blocked_id")
        .eq("blocked_id", currentUserId)
        .in("blocker_id", otherUserIds)
        .limit(otherUserIds.length),
    ]);

    const relatedError =
      user1MatchesResult.error ??
      user2MatchesResult.error ??
      blockedByMeResult.error ??
      blockedByOtherResult.error;

    if (relatedError) {
      console.error("Get chat relationships error:", relatedError);
      return c.json({ error: getErrorMessage(relatedError, "Sohbetler yuklenemedi.") }, 500);
    }

    const visibleMatches = [
      ...(user1MatchesResult.data ?? []),
      ...(user2MatchesResult.data ?? []),
    ] as Array<Record<string, any>>;
    const matchMap = new Map(
      visibleMatches.map((match) => [
        match.user1_id === currentUserId ? match.user2_id : match.user1_id,
        match,
      ]),
    );
    const safeBlockRows = [
      ...(blockedByMeResult.data ?? []),
      ...(blockedByOtherResult.data ?? []),
    ] as Array<{ blocker_id: string; blocked_id: string }>;
    const chatPairs = visibleDirectoryRows.map((row) => ({
      otherUserId: row.other_user_id,
      activityAt: row.activity_at,
      match: matchMap.get(row.other_user_id) ?? null,
    }));
    const visibleSinceMap = new Map(
      chatPairs.map((pair) => [
        pair.otherUserId,
        getChatVisibleSince(pair.match, currentUserId),
      ]),
    );

    const [userMap, likeTimelineMap, messageStatsMap, ownSettingsMap, peerSettingsMap] = await Promise.all([
      loadUserPayloadMap(supabase, otherUserIds),
      loadLikeTimelineMap(
        supabase,
        visibleMatches.map((match: Record<string, any>) => ({
          user1Id: match.user1_id,
          user2Id: match.user2_id,
        })),
      ),
      loadChatMessageStats(supabase, currentUserId, otherUserIds, visibleSinceMap),
      loadChatSettingsMap(supabase, currentUserId, otherUserIds),
      loadPeerChatSettingsMap(supabase, currentUserId, otherUserIds),
    ]);

    const chats = chatPairs.map(({ otherUserId, activityAt, match }) => {
      const likeTimeline = match
        ? likeTimelineMap.get(getPairKey(match.user1_id, match.user2_id)) ?? null
        : null;
      const pairBlockRows = safeBlockRows.filter(
        (row: { blocker_id: string; blocked_id: string }) =>
          (row.blocker_id === currentUserId && row.blocked_id === otherUserId) ||
          (row.blocker_id === otherUserId && row.blocked_id === currentUserId),
      );
      const messageStats = messageStatsMap.get(otherUserId);
      const matchCreatedAtMs = new Date(match?.created_at ?? "").getTime();
      const hasConversationActivity = Boolean(
        messageStats?.lastMessageTime &&
          (!match ||
            !Number.isFinite(matchCreatedAtMs) ||
            new Date(messageStats.lastMessageTime).getTime() >= matchCreatedAtMs),
      );

      return {
        userId: otherUserId,
        user: userMap.get(otherUserId) ?? buildFallbackUserPayload(otherUserId),
        lastMessage: messageStats?.lastMessage ?? "",
        lastMessageTime:
          messageStats?.lastMessageTime ??
          visibleSinceMap.get(otherUserId) ??
          match?.created_at ??
          match?.updated_at ??
          activityAt,
        hasConversationActivity,
        unread: (messageStats?.unreadCount ?? 0) > 0,
        matchContext: buildMatchContextSnapshot(match, likeTimeline, currentUserId),
        settings: ownSettingsMap.get(otherUserId) ?? { ...DEFAULT_CHAT_SETTINGS },
        peerSettings: peerSettingsMap.get(otherUserId) ?? { ...DEFAULT_CHAT_SETTINGS },
        ...getChatState(match, currentUserId, otherUserId, pairBlockRows),
      };
    });

    chats.sort(
      (left, right) =>
        new Date(right.lastMessageTime).getTime() - new Date(left.lastMessageTime).getTime(),
    );

    return c.json({
      chats,
      pageInfo: {
        hasMore,
        nextCursor: hasMore
          ? encodeChatDirectoryCursor(visibleDirectoryRows.at(-1) ?? {})
          : null,
      },
    });
  } catch (error) {
    console.error("Get chats error:", error);
    return c.json({ error: getErrorMessage(error, "Sohbetler yuklenemedi.") }, 500);
  }
});

Deno.serve(app.fetch);
