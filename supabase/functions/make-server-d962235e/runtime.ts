import {
  CHAT_THREAD_INITIAL_PAGE_SIZE,
  DAILY_DISLIKE_SWIPE_LIMIT,
  DAILY_LIKE_SWIPE_LIMIT,
  DAILY_UNDO_LIMIT,
  LIVE_NOW_PAGE_SIZE,
  MATCH_LIKE_REWARD_BONUS,
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
import {
  getUsernameValidationMessage,
  normalizeUsername,
} from "../../../src/shared/utils/username.ts";
import { getPasswordResetRedirectUrl } from "../../../src/shared/config/publicWeb.ts";
import { getCompatibilityBreakdown } from "../../../src/shared/utils/compatibility.ts";
import {
  DEFAULT_DISCOVERY_PREFERENCES,
  type DiscoveryPreferences,
  hasActiveDistanceFilter,
  isDiscoveryGenderFilter,
  isUserGender,
  normalizeDiscoveryPreferences,
  validateDiscoveryPreferences,
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
import {
  decodeChatDirectoryCursor,
  decodeCompatibilityCursor,
  decodeLiveNowCursor,
  decodeMessageCursor,
  encodeChatDirectoryCursor,
  encodeCompatibilityCursor,
  encodeLiveNowCursor,
  encodeMessageCursor,
} from "./cursors.ts";
import {
  buildAbuseKey,
  getRequestRateLimitIdentity as resolveRequestRateLimitIdentity,
  hashIdempotencyPayload,
  isTrustedPasswordResetRedirect as validatePasswordResetRedirect,
  normalizeIdempotencyKey,
  normalizeRequestId,
} from "./httpSecurity.ts";
import {
  AccountDeletionResumeError,
  resumeAccountDeletionJob,
} from "./accountDeletion.ts";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "../../types/database.generated.ts";
import {
  app,
  type AppContext,
  type AppVariables,
  authMiddleware,
  enforceRateLimit,
  getPathParam,
  getRequestRateLimitIdentity,
  getSupabase,
  registerSharedMiddleware,
  type SupabaseAdminClient,
} from "./sharedMiddleware.ts";
import {
  cleanupRemovedManagedProfilePhotos,
  cleanupStaleProfilePhotoQuarantine,
  extractManagedProfilePhotoPaths,
  finalizeValidatedProfilePhotos,
  ProfilePhotoValidationError,
  sanitizePhotoList,
  signProfilePhotosForPayloads,
  validateAndStageOwnedProfilePhotos,
  validateOwnedProfilePhotos,
} from "./domains/storage.ts";
import { canViewProfileIdentityField } from "./domains/privacy.ts";
import { normalizeExpoPushToken } from "./domains/pushTokens.ts";
import {
  authorizeClaimedPushDelivery,
  prunePushTokenRegistry,
} from "./domains/pushDeliveryPolicy.ts";
import {
  persistNotificationEvents,
  type NotificationEventDraft,
  type NotificationEventKind,
  type NotificationRouteKind,
} from "./domains/notificationOutbox.ts";

type DatabaseRow = Record<string, unknown>;
type ChatSettingsRow = Tables<"chat_settings">;
type DiscoveryPreferencesRow = Tables<"discovery_preferences">;
type JsonObject = { [key: string]: Json | undefined };

const isDatabaseRow = (value: unknown): value is DatabaseRow =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const SCHEMA_READINESS_CACHE_TTL_MS = 5 * 60 * 1000;
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
const API_VERSION = "2026-08-19";
const RELEASE_VERSION = "1.0.51";
const REQUIRED_SCHEMA_VERSION = "20260831153000";
const ANDROID_NOTIFICATION_CHANNEL_ID = "wmatch-alerts-v2";
const EXPO_PUSH_MAX_HTTP_ATTEMPTS = 3;
const EXPO_PUSH_RETRY_BASE_DELAY_MS = 400;
const MAX_PUSH_TOKENS_PER_USER = 8;
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

const userHasIncomingLikesEntitlement = async (
  supabase: SupabaseAdminClient,
  userId: string,
) => {
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
const PUBLIC_PROFILE_SELECT =
  "id,name,age,show_age_on_profile,gender,show_gender_on_profile,username,bio,letterboxd,photos,email_confirmed" as const;
const SERVER_PROFILE_SELECT =
  `${PUBLIC_PROFILE_SELECT},latitude,longitude,location_updated_at` as const;
const MATCH_SELECT =
  "user1_id,user2_id,status,created_at,updated_at,ended_at,ended_by_user_id,match_source_type,match_source_score,match_source_movie_id,common_favorite_movie_ids,common_watched_movie_ids,first_like_by_user_id,accepted_by_user_id,user1_chat_deleted_at,user2_chat_deleted_at,user1_chat_cleared_at,user2_chat_cleared_at" as const;
const MESSAGE_SELECT =
  "id,sender_id,receiver_id,text,read,created_at,client_request_id,client_message_id" as const;
const SWIPE_QUOTA_WINDOW_MS = SWIPE_QUOTA_WINDOW_HOURS * 60 * 60 * 1000;

let schemaReadinessCache: { ready: boolean; expiresAt: number } | null = null;
let schemaReadinessFlight: Promise<boolean> | null = null;

type SwipeQuotaKind = "like" | "dislike" | "undo";

interface SwipeQuotaRow {
  user_id: string;
  window_started_at: string;
  used_like_swipes: number;
  used_dislike_swipes: number;
  used_undos: number;
}

const isTrustedPasswordResetRedirect = (value: unknown): value is string =>
  validatePasswordResetRedirect(value, getPasswordResetRedirectUrl());

const sanitizeMovieIdList = (value: unknown, maxCount: number) =>
  Array.isArray(value)
    ? value
      .filter((item): item is number =>
        typeof item === "number" && Number.isInteger(item) && item > 0
      )
      .slice(0, maxCount)
    : [];

const sanitizeMediaRefList = (
  value: unknown,
  legacyMovieIds: number[],
  maxCount: number,
): MediaRef[] => {
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

    if (
      !Number.isInteger(id) || (id as number) <= 0 || !isMediaType(mediaType)
    ) {
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
    typeof error === "object" && error !== null && "message" in error
      ? (error as { message?: string }).message
      : "",
    typeof error === "object" && error !== null && "details" in error
      ? (error as { details?: string }).details
      : "",
    typeof error === "object" && error !== null && "hint" in error
      ? (error as { hint?: string }).hint
      : "",
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

const getErrorMessage = (
  error: unknown,
  fallback = "Beklenmeyen bir hata oluştu.",
) => {
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

    for (
      const key of [
        "error",
        "message",
        "details",
        "hint",
        "description",
        "reason",
        "code",
      ]
    ) {
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
  columnNames.find((columnName) => isMissingColumnError(error, columnName)) ??
    null;

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

const getPairKey = (leftUserId: string, rightUserId: string) =>
  getPairUserIds(leftUserId, rightUserId).join(":");

const serializeProfile = (
  profile: DatabaseRow,
  extras: Record<string, unknown> = {},
  viewerUserId: string | null = null,
) => ({
  id: typeof profile.id === "string" ? profile.id : "",
  name: typeof profile.name === "string" ? profile.name : "User",
  age: canViewProfileIdentityField({
      fieldEnabled: typeof profile.show_age_on_profile === "boolean"
        ? profile.show_age_on_profile
        : true,
      profileUserId: typeof profile.id === "string" ? profile.id : "",
      viewerUserId,
    })
    ? typeof profile.age === "number" ? profile.age : 18
    : null,
  showAgeOnProfile: typeof profile.show_age_on_profile === "boolean"
    ? profile.show_age_on_profile
    : true,
  gender: canViewProfileIdentityField({
      fieldEnabled: typeof profile.show_gender_on_profile === "boolean"
        ? profile.show_gender_on_profile
        : true,
      profileUserId: typeof profile.id === "string" ? profile.id : "",
      viewerUserId,
    })
    ? isUserGender(profile.gender) ? profile.gender : "other"
    : null,
  showGenderOnProfile: typeof profile.show_gender_on_profile === "boolean"
    ? profile.show_gender_on_profile
    : true,
  username: typeof profile.username === "string" ? profile.username : "",
  bio: typeof profile.bio === "string" ? profile.bio : "",
  letterboxd: typeof profile.letterboxd === "string" ? profile.letterboxd : "",
  photos: sanitizePhotoList(
    profile.photos,
    typeof profile.id === "string" ? profile.id : undefined,
  ),
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

const buildAuthUserMetadata = (profile: DatabaseRow) => ({
  name: typeof profile.name === "string" ? profile.name : "User",
  age: typeof profile.age === "number" ? profile.age : 18,
  gender: isUserGender(profile.gender) ? profile.gender : "other",
  username: typeof profile.username === "string" ? profile.username : "",
  bio: typeof profile.bio === "string" ? profile.bio : "",
  letterboxd: typeof profile.letterboxd === "string" ? profile.letterboxd : "",
  photos: sanitizePhotoList(
    profile.photos,
    typeof profile.id === "string" ? profile.id : undefined,
  ),
  show_age_on_profile: typeof profile.show_age_on_profile === "boolean"
    ? profile.show_age_on_profile
    : true,
  showAgeOnProfile: typeof profile.show_age_on_profile === "boolean"
    ? profile.show_age_on_profile
    : true,
  show_gender_on_profile: typeof profile.show_gender_on_profile === "boolean"
    ? profile.show_gender_on_profile
    : true,
  showGenderOnProfile: typeof profile.show_gender_on_profile === "boolean"
    ? profile.show_gender_on_profile
    : true,
});

const buildUserPayload = (
  profile: DatabaseRow,
  movies: Array<
    { movie_id: number; media_type?: MediaType | string | null; type: string }
  > = [],
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
  viewerUserId: string | null = null,
) =>
  serializeProfile(profile, {
    favoriteMovies: movies.filter((item) => item.type === "favorite").map((
      item,
    ) => item.movie_id),
    favoriteMedia: movies
      .filter((item) => item.type === "favorite" && item.media_type != null)
      .map((item) => ({
        id: item.movie_id,
        mediaType: normalizeMediaType(item.media_type),
      })),
    watchedMovies: movies.filter((item) => item.type === "watched").map((
      item,
    ) => item.movie_id),
    watchedMedia: movies
      .filter((item) => item.type === "watched" && item.media_type != null)
      .map((item) => ({
        id: item.movie_id,
        mediaType: normalizeMediaType(item.media_type),
      })),
    currentlyWatching: currentlyWatching?.movie_id ?? null,
    currentlyWatchingMediaType: currentlyWatching
      ? normalizeMediaType(currentlyWatching.media_type)
      : null,
    currentlyWatchingUpdatedAt: currentlyWatching?.state === "paused"
      ? null
      : currentlyWatching?.updated_at ?? null,
    currentlyWatchingState: currentlyWatching?.state ?? null,
    currentlyWatchingRemainingMs: currentlyWatching?.remaining_ms ?? null,
    currentlyWatchingExpiresAt: currentlyWatching?.expires_at ?? null,
    currentlyWatchingVersion: typeof currentlyWatching?.version === "number"
      ? currentlyWatching.version
      : null,
    locationUpdatedAt: null,
    discoveryPreferences,
  }, viewerUserId);

const buildFallbackUserPayload = (userId: string) =>
  buildUserPayload({
    id: userId,
    name: "Kullanıcı",
    age: 18,
    gender: "other",
    email_confirmed: true,
  });

const isEmailConfirmedProfile = (profile: DatabaseRow | null | undefined) =>
  profile?.email_confirmed === true;

const serializeChatSettings = (
  row: Partial<ChatSettingsRow> | null | undefined,
) => ({
  readReceipts: typeof row?.read_receipts_enabled === "boolean"
    ? row.read_receipts_enabled
    : DEFAULT_CHAT_SETTINGS.readReceipts,
  onlineStatus: typeof row?.online_status_enabled === "boolean"
    ? row.online_status_enabled
    : DEFAULT_CHAT_SETTINGS.onlineStatus,
  typingIndicator: typeof row?.typing_indicator_enabled === "boolean"
    ? row.typing_indicator_enabled
    : DEFAULT_CHAT_SETTINGS.typingIndicator,
  notifications: typeof row?.notifications_enabled === "boolean"
    ? row.notifications_enabled
    : DEFAULT_CHAT_SETTINGS.notifications,
});

const serializeDiscoveryPreferences = (
  row: Partial<DiscoveryPreferencesRow> | null | undefined,
) =>
  normalizeDiscoveryPreferences({
    genderPreference: isDiscoveryGenderFilter(row?.gender_preference)
      ? row.gender_preference
      : undefined,
    ageMin: row?.age_min,
    ageMax: row?.age_max,
    distanceMinKm: row?.distance_min_km,
    distanceMaxKm: row?.distance_max_km,
    compatibilityMin: row?.compatibility_min,
    compatibilityMax: row?.compatibility_max,
  });

const buildFreshSwipeQuotaRow = (
  userId: string,
  now = Date.now(),
): SwipeQuotaRow => ({
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
  const resetsAtMs = new Date(base.window_started_at ?? "").getTime() +
    SWIPE_QUOTA_WINDOW_MS;

  if (!Number.isFinite(resetsAtMs) || resetsAtMs <= now) {
    return buildFreshSwipeQuotaRow(userId, now);
  }

  return {
    user_id: userId,
    window_started_at: base.window_started_at ?? new Date(now).toISOString(),
    used_like_swipes: Math.max(
      0,
      Math.min(Number(base.used_like_swipes ?? 0), DAILY_LIKE_SWIPE_LIMIT),
    ),
    used_dislike_swipes: Math.max(
      0,
      Math.min(
        Number(base.used_dislike_swipes ?? 0),
        DAILY_DISLIKE_SWIPE_LIMIT,
      ),
    ),
    used_undos: Math.max(
      0,
      Math.min(Number(base.used_undos ?? 0), DAILY_UNDO_LIMIT),
    ),
  };
};

const serializeSwipeQuota = (row: SwipeQuotaRow, now = Date.now()) => {
  const resetsAtMs = new Date(row.window_started_at).getTime() +
    SWIPE_QUOTA_WINDOW_MS;

  return {
    windowStartedAt: row.window_started_at,
    likeLimit: DAILY_LIKE_SWIPE_LIMIT,
    dislikeLimit: DAILY_DISLIKE_SWIPE_LIMIT,
    undoLimit: DAILY_UNDO_LIMIT,
    usedLikes: row.used_like_swipes,
    usedDislikes: row.used_dislike_swipes,
    usedUndos: row.used_undos,
    remainingLikes: Math.max(0, DAILY_LIKE_SWIPE_LIMIT - row.used_like_swipes),
    remainingDislikes: Math.max(
      0,
      DAILY_DISLIKE_SWIPE_LIMIT - row.used_dislike_swipes,
    ),
    remainingUndos: Math.max(0, DAILY_UNDO_LIMIT - row.used_undos),
    resetsAt: new Date(resetsAtMs).toISOString(),
    remainingMs: Math.max(0, resetsAtMs - now),
  };
};

const persistSwipeQuotaRow = async (
  supabase: SupabaseAdminClient,
  row: SwipeQuotaRow,
) => {
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
    .select(
      "user_id, window_started_at, used_like_swipes, used_dislike_swipes, used_undos",
    )
    .single();

  if (error) {
    throw error;
  }

  return normalizeSwipeQuotaRow(normalized.user_id, data);
};

const loadSwipeQuotaRow = async (
  supabase: SupabaseAdminClient,
  userId: string,
) => {
  const { data, error } = await supabase
    .from("swipe_quotas")
    .select(
      "user_id, window_started_at, used_like_swipes, used_dislike_swipes, used_undos",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const normalized = normalizeSwipeQuotaRow(userId, data);
  const needsPersist = !data ||
    normalized.window_started_at !== data.window_started_at ||
    normalized.used_like_swipes !== Number(data.used_like_swipes ?? 0) ||
    normalized.used_dislike_swipes !== Number(data.used_dislike_swipes ?? 0) ||
    normalized.used_undos !== Number(data.used_undos ?? 0);

  return needsPersist ? persistSwipeQuotaRow(supabase, normalized) : normalized;
};

const consumeSwipeQuota = async (
  supabase: SupabaseAdminClient,
  userId: string,
  kind: SwipeQuotaKind,
) => {
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

const rewardSwipeQuota = async (
  supabase: SupabaseAdminClient,
  userId: string,
  kind: Extract<SwipeQuotaKind, "like" | "dislike">,
) => {
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
  supabase: SupabaseAdminClient,
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
    (data ?? []).map((
      row,
    ) => [row.user_id, serializeDiscoveryPreferences(row)]),
  );
};

const loadPrivateProfileLocationMap = async (
  supabase: SupabaseAdminClient,
  userIds: string[],
): Promise<
  Map<
    string,
    {
      latitude: number | null;
      longitude: number | null;
      location_updated_at: string | null;
    }
  >
> => {
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
      return new Map<
        string,
        {
          latitude: number | null;
          longitude: number | null;
          location_updated_at: string | null;
        }
      >();
    }

    throw error;
  }

  return new Map<
    string,
    {
      latitude: number | null;
      longitude: number | null;
      location_updated_at: string | null;
    }
  >(
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
  supabase: SupabaseAdminClient,
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

const getProfileCoordinates = (profile: DatabaseRow) => {
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

type MatchSourceType = "watch" | "compatibility" | "like";

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

const getMatchNotificationBody = (
  sourceType: MatchSourceType,
  otherUserName: string,
) => {
  if (sourceType === "watch") {
    return `${otherUserName} ile Watch Match oldun. +${MATCH_LIKE_REWARD_BONUS} beğeni hakkı kazandın. Hemen mesajlaşmak için dokun.`;
  }

  if (sourceType === "compatibility") {
    return `${otherUserName} ile uyum eşleşmesi oldun. +${MATCH_LIKE_REWARD_BONUS} beğeni hakkı kazandın. Hemen mesajlaşmak için dokun.`;
  }

  return `${otherUserName} ile eşleştin. +${MATCH_LIKE_REWARD_BONUS} beğeni hakkı kazandın. Hemen mesajlaşmak için dokun.`;
};

const buildLikeNotificationBody = () =>
  "1 kullanıcı seni beğendi. Ayrıntıları görmek için dokun.";

const runAfterResponse = (task: PromiseLike<unknown>) => {
  const edgeRuntime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil: (pendingTask: Promise<unknown>) => void };
  }).EdgeRuntime;

  if (typeof edgeRuntime?.waitUntil === "function") {
    edgeRuntime.waitUntil(Promise.resolve(task));
    return true;
  }

  return false;
};

const publishUserEvents = async (
  supabase: SupabaseAdminClient,
  userIds: string[],
  event:
    | "discovery_changed"
    | "chat_changed"
    | "profile_changed"
    | "notification_changed",
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
  supabase: SupabaseAdminClient,
  userIds: string[],
  event:
    | "discovery_changed"
    | "chat_changed"
    | "profile_changed"
    | "notification_changed",
  payload: Record<string, unknown> = {},
) => {
  const task = publishUserEvents(supabase, userIds, event, payload).catch(
    (error) => {
      console.error("User event broadcast error:", error);
    },
  );

  if (!runAfterResponse(task)) {
    void task;
  }
};

const queuePairStateEvents = (
  supabase: SupabaseAdminClient,
  leftUserId: string,
  rightUserId: string,
  reason: string,
) => {
  queueUserEvents(supabase, [leftUserId, rightUserId], "discovery_changed", {
    reason,
  });
  queueUserEvents(supabase, [leftUserId, rightUserId], "chat_changed", {
    reason,
  });
};

const queueWatchSessionDiscoveryEvents = (
  supabase: SupabaseAdminClient,
  currentUserId: string,
  refs: Array<{ movieId?: number | null; mediaType?: unknown }>,
) => {
  const uniqueRefs = new Map<
    string,
    { movieId: number; mediaType: MediaType }
  >();

  refs.forEach((ref) => {
    if (!ref.movieId || ref.movieId <= 0) {
      return;
    }

    const mediaType = normalizeMediaType(ref.mediaType);
    uniqueRefs.set(`${mediaType}:${ref.movieId}`, {
      movieId: ref.movieId,
      mediaType,
    });
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

const buildChatNotificationTag = (
  _recipientUserId: string,
  senderUserId: string,
) => `chat_${buildCompactNotificationIdentifier(senderUserId)}`;

const buildGroupedMessageNotificationBody = (
  lines: string[],
  totalCount?: number,
) => {
  const normalizedLines = lines
    .map((line) =>
      normalizeWhitespace(typeof line === "string" ? line : "").trim()
    )
    .filter((line) => line.length > 0);

  if (normalizedLines.length === 0) {
    return "Yeni mesaj";
  }

  const visibleLines = normalizedLines.slice(
    -MAX_GROUPED_MESSAGE_NOTIFICATIONS,
  );
  const safeTotalCount = typeof totalCount === "number" && totalCount > 0
    ? Math.max(totalCount, normalizedLines.length)
    : normalizedLines.length;
  const hiddenCount = Math.max(0, safeTotalCount - visibleLines.length);

  if (hiddenCount <= 0) {
    return visibleLines.join("\n");
  }

  return [`+${hiddenCount} mesaj`, ...visibleLines].join("\n");
};

const getChatStatusNotificationBody = (
  kind: Extract<
    NotificationEventKind,
    "chat_ended" | "chat_blocked" | "chat_unblocked"
  >,
  otherUserName: string,
) => {
  if (kind === "chat_blocked") {
    return `${otherUserName} ile sohbetin engellendi. Ayrıntıları görmek için dokun.`;
  }

  if (kind === "chat_unblocked") {
    return `${otherUserName} ile sohbet engeli kaldırıldı. Ayrıntıları görmek için dokun.`;
  }

  return `${otherUserName} ile sohbet sona erdi. Ayrıntıları görmek için dokun.`;
};

const buildMatchContextSnapshot = (
  match: DatabaseRow | null,
  fallbackLikeTimeline: {
    firstLikeByUserId: string | null;
    acceptedByUserId: string | null;
  } | null = null,
  viewerUserId?: string | null,
) => {
  if (!match) {
    return null;
  }

  const visibleCreatedAt = viewerUserId != null
    ? getChatVisibleSince(match, viewerUserId) ?? String(match.created_at ?? "")
    : String(match.created_at ?? "");

  return {
    type: normalizeMatchSourceType(match.match_source_type),
    compatibilityScore: typeof match.match_source_score === "number"
      ? match.match_source_score
      : null,
    matchedMovieId: typeof match.match_source_movie_id === "number"
      ? match.match_source_movie_id
      : null,
    commonFavoriteMovieIds: Array.isArray(match.common_favorite_movie_ids)
      ? match.common_favorite_movie_ids.filter((item: unknown) =>
        typeof item === "number"
      )
      : [],
    commonWatchedMovieIds: Array.isArray(match.common_watched_movie_ids)
      ? match.common_watched_movie_ids.filter((item: unknown) =>
        typeof item === "number"
      )
      : [],
    firstLikeByUserId: typeof match.first_like_by_user_id === "string"
      ? match.first_like_by_user_id
      : fallbackLikeTimeline?.firstLikeByUserId ?? null,
    acceptedByUserId: typeof match.accepted_by_user_id === "string"
      ? match.accepted_by_user_id
      : fallbackLikeTimeline?.acceptedByUserId ?? null,
    createdAt: String(visibleCreatedAt ?? ""),
  };
};

const loadLikeTimelineMap = async (
  supabase: SupabaseAdminClient,
  pairs: Array<{ user1Id: string; user2Id: string }>,
) => {
  if (pairs.length === 0) {
    return new Map<
      string,
      { firstLikeByUserId: string | null; acceptedByUserId: string | null }
    >();
  }

  const userIds = [
    ...new Set(pairs.flatMap((pair) => [pair.user1Id, pair.user2Id])),
  ];
  const pairKeys = new Set(
    pairs.map((pair) => getPairKey(pair.user1Id, pair.user2Id)),
  );
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
    Array<{ user_id: string; liked_user_id: string; created_at: string | null }>
  >();

  (data ?? []).forEach((row) => {
    const pairKey = getPairKey(row.user_id, row.liked_user_id);

    if (!pairKeys.has(pairKey)) {
      return;
    }

    const current = rowsByPair.get(pairKey) ?? [];
    rowsByPair.set(pairKey, [...current, row]);
  });

  const timelineMap = new Map<
    string,
    { firstLikeByUserId: string | null; acceptedByUserId: string | null }
  >();

  rowsByPair.forEach((rows, pairKey) => {
    const orderedRows = [...rows].sort(
      (left, right) =>
        new Date(left.created_at ?? "").getTime() -
        new Date(right.created_at ?? "").getTime(),
    );
    const firstLikeByUserId = orderedRows[0]?.user_id ?? null;
    const acceptedByUserId = orderedRows.length > 1
      ? orderedRows[orderedRows.length - 1]?.user_id ?? null
      : null;

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
  supabase: SupabaseAdminClient,
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
    .limit(
      Math.min(
        MAX_RELATIONSHIP_ROWS,
        Math.max(1, userIds.length * (MAX_FAVORITES_COUNT + MAX_WATCHED_COUNT)),
      ),
    );

  if (error) {
    throw error;
  }

  const collections = new Map<string, UserMovieCollections>();

  emptyCollections.forEach((value, key) => collections.set(key, value));

  (data ?? []).forEach(
    (
      row: {
        user_id: string;
        movie_id: number;
        media_type?: string | null;
        type: string;
      },
    ) => {
      const current = collections.get(row.user_id) ??
        createEmptyMovieCollections();
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
    },
  );

  return collections;
};

const getSharedCurrentlyWatchingMovieId = async (
  supabase: SupabaseAdminClient,
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

  const leftRow =
    (data ?? []).find((row: { user_id: string }) =>
      row.user_id === leftUserId
    ) ?? null;
  const rightRow =
    (data ?? []).find((row: { user_id: string }) =>
      row.user_id === rightUserId
    ) ?? null;
  const leftMovieId = leftRow?.movie_id ?? null;
  const rightMovieId = rightRow?.movie_id ?? null;

  return leftMovieId &&
      leftMovieId === rightMovieId &&
      normalizeMediaType(leftRow?.media_type) ===
        normalizeMediaType(rightRow?.media_type)
    ? leftMovieId
    : null;
};

const buildMatchSnapshot = async (
  supabase: SupabaseAdminClient,
  currentUserId: string,
  otherUserId: string,
  sourceType: MatchSourceType,
) => {
  const collections = await loadMovieCollectionsForUsers(supabase, [
    currentUserId,
    otherUserId,
  ]);
  const currentUserCollections = collections.get(currentUserId) ??
    createEmptyMovieCollections();
  const otherUserCollections = collections.get(otherUserId) ??
    createEmptyMovieCollections();
  const compatibility = getCompatibilityBreakdown(
    currentUserCollections.favoriteMedia,
    currentUserCollections.watchedMedia,
    otherUserCollections.favoriteMedia,
    otherUserCollections.watchedMedia,
  );
  const sharedMovieId = sourceType === "watch"
    ? await getSharedCurrentlyWatchingMovieId(
      supabase,
      currentUserId,
      otherUserId,
    )
    : null;
  const normalizedSourceType = sourceType === "watch" && sharedMovieId == null
    ? "like"
    : sourceType;

  return {
    match_source_type: normalizedSourceType,
    match_source_score: compatibility.score,
    match_source_movie_id: sharedMovieId,
    common_favorite_movie_ids: compatibility.commonFavoriteIds,
    common_watched_movie_ids: compatibility.commonWatchedIds,
  };
};

const loadChatSettingsMap = async (
  supabase: SupabaseAdminClient,
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
    (data ?? []).map((row) => [row.other_user_id, serializeChatSettings(row)]),
  );
};

const loadPeerChatSettingsMap = async (
  supabase: SupabaseAdminClient,
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
    (data ?? []).map((row) => [row.owner_user_id, serializeChatSettings(row)]),
  );
};

const loadPushTokenMap = async (
  supabase: SupabaseAdminClient,
  userIds: string[],
) => {
  if (userIds.length === 0) {
    return new Map<string, string[]>();
  }

  const { data, error } = await supabase
    .from("device_push_tokens")
    .select("user_id, token, last_seen_at")
    .in("user_id", userIds)
    .order("last_seen_at", { ascending: false })
    .limit(
      Math.min(
        MAX_RELATIONSHIP_ROWS,
        Math.max(1, userIds.length * MAX_PUSH_TOKENS_PER_USER),
      ),
    );

  if (error) {
    if (isMissingRelationError(error, "device_push_tokens")) {
      return new Map<string, string[]>();
    }

    throw error;
  }

  const tokenMap = new Map<string, string[]>();

  (data ?? []).forEach((row) => {
    if (!row.user_id) {
      return;
    }
    const normalizedToken = normalizeExpoPushToken(row.token);

    if (!normalizedToken) {
      return;
    }

    const currentTokens = tokenMap.get(row.user_id) ?? [];
    if (
      currentTokens.length < MAX_PUSH_TOKENS_PER_USER &&
      !currentTokens.includes(normalizedToken)
    ) {
      tokenMap.set(row.user_id, [...currentTokens, normalizedToken]);
    }
  });

  return tokenMap;
};

const loadUnreadMessageNotificationLines = async (
  supabase: SupabaseAdminClient,
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
    totalCount: typeof data?.length === "number"
      ? Math.max(data.length, count ?? data.length)
      : count ?? 0,
  };
};

const chunkArray = <T>(items: T[], chunkSize: number) => {
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
      const retryDelayMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
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

type ExpoReceiptJob = {
  ticketId: string;
  eventId: string;
  token: string;
  attemptCount: number;
};

type ExpoReceiptResolution = ExpoReceiptJob & {
  status: "delivered" | "retry" | "error";
  error: string | null;
};

const resolveExpoPushReceipts = async (
  receiptJobs: ExpoReceiptJob[],
): Promise<ExpoReceiptResolution[]> => {
  const resolutions: ExpoReceiptResolution[] = [];

  for (const receiptChunk of chunkArray(receiptJobs, 300)) {
    try {
      const response = await fetchExpoPushWithRetry(
        "https://exp.host/--/api/v2/push/getReceipts",
        {
          method: "POST",
          headers: getExpoPushHeaders(),
          body: JSON.stringify({
            ids: receiptChunk.map((item) => item.ticketId),
          }),
        },
      );

      if (!response.ok) {
        console.error("Push receipt request failed:", {
          status: response.status,
        });
        receiptChunk.forEach((job) =>
          resolutions.push({
            ...job,
            status: "retry",
            error: `expo_receipt_http_${response.status}`,
          })
        );
        continue;
      }

      const payload = await response.json().catch(() => null);
      const receipts = isDatabaseRow(payload) && isDatabaseRow(payload.data)
        ? payload.data
        : {};

      receiptChunk.forEach((job) => {
        const receiptValue = receipts[job.ticketId];
        const receipt = isDatabaseRow(receiptValue) ? receiptValue : null;

        if (!receipt) {
          resolutions.push({
            ...job,
            status: "retry",
            error: "expo_receipt_pending",
          });
          return;
        }

        if (receipt.status === "ok") {
          resolutions.push({ ...job, status: "delivered", error: null });
          return;
        }

        const details = isDatabaseRow(receipt.details) ? receipt.details : null;
        const errorCode = typeof details?.error === "string"
          ? details.error
          : "unknown";
        resolutions.push({
          ...job,
          status: "error",
          error: `expo_receipt_${errorCode}`,
        });
      });
    } catch (error) {
      const errorMessage = getErrorMessage(
        error,
        "expo_receipt_request_failed",
      );
      receiptChunk.forEach((job) =>
        resolutions.push({
          ...job,
          status: "retry",
          error: errorMessage,
        })
      );
    }
  }

  return resolutions;
};

const sendPushNotifications = async (
  supabase: SupabaseAdminClient,
  notifications: Array<{
    eventId: string;
    userId: string;
    title: string;
    body: string;
    data?: JsonObject;
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
        eventId: notification.eventId,
        token,
        payload: {
          to: token,
          sound: "default",
          priority: notification.priority ?? "high",
          channelId: notification.channelId ?? ANDROID_NOTIFICATION_CHANNEL_ID,
          title: notification.title,
          body: notification.body,
          ...(notification.collapseId
            ? { collapseId: notification.collapseId }
            : {}),
          ...(notification.tag ? { tag: notification.tag } : {}),
          data: notification.data ?? {},
        },
      }))
    );

    if (messages.length === 0) {
      return { status: "no_tokens" as const, error: null };
    }

    const invalidTokens = new Set<string>();
    const receiptCandidates: Array<
      { ticketId: string; token: string; eventId: string }
    > = [];
    const retryableErrors: string[] = [];
    const permanentErrors: string[] = [];
    let acceptedCount = 0;

    // A single stale token from an older Expo project can make an otherwise
    // valid mixed-project batch fail with HTTP 400. Send one device per request
    // and keep at most five event jobs concurrent in the caller.
    for (const message of messages) {
      const response = await fetchExpoPushWithRetry(
        "https://exp.host/--/api/v2/push/send",
        {
          method: "POST",
          headers: getExpoPushHeaders(),
          body: JSON.stringify(message.payload),
        },
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const responseErrors =
          isDatabaseRow(payload) && Array.isArray(payload.errors)
            ? payload.errors
            : [];
        const responseError = responseErrors.find(isDatabaseRow);
        const responseErrorCode = typeof responseError?.code === "string"
          ? responseError.code
          : null;
        const errorCode = `expo_http_${response.status}${
          responseErrorCode ? `_${responseErrorCode}` : ""
        }`;

        if (response.status === 429 || response.status >= 500) {
          retryableErrors.push(errorCode);
        } else {
          permanentErrors.push(errorCode);
        }

        console.error("Push notification request failed:", {
          status: response.status,
          error: responseErrorCode ?? "unknown",
        });
        continue;
      }

      const payloadData = isDatabaseRow(payload) ? payload.data : null;
      const tickets = Array.isArray(payloadData)
        ? payloadData
        : isDatabaseRow(payloadData)
        ? [payloadData]
        : [];

      if (tickets.length === 0) {
        retryableErrors.push("expo_ticket_missing");
        continue;
      }

      tickets.forEach((ticketValue) => {
        const ticket = isDatabaseRow(ticketValue) ? ticketValue : null;
        const failedToken = message.token;

        if (
          ticket?.status === "ok" && ticket.id && typeof ticket.id === "string"
        ) {
          receiptCandidates.push({
            ticketId: ticket.id,
            token: failedToken,
            eventId: message.eventId,
          });
          acceptedCount += 1;
          return;
        }

        const details = isDatabaseRow(ticket?.details) ? ticket.details : null;
        const errorCode = typeof details?.error === "string"
          ? details.error
          : null;

        if (errorCode === "DeviceNotRegistered") {
          invalidTokens.add(failedToken);
          return;
        }

        if (errorCode === "MessageRateExceeded") {
          retryableErrors.push(`expo_ticket_${errorCode}`);
        } else {
          permanentErrors.push(`expo_ticket_${errorCode ?? "unknown"}`);
        }

        console.error("Expo push ticket error:", {
          error: errorCode ?? "unknown",
        });
      });
    }

    if (invalidTokens.size > 0) {
      await supabase.from("device_push_tokens").delete().in("token", [
        ...invalidTokens,
      ]);
    }

    let receiptPersistenceError: string | null = null;

    if (receiptCandidates.length > 0) {
      const { error: receiptError } = await supabase
        .from("push_delivery_receipts")
        .upsert(
          receiptCandidates.map((receipt) => ({
            ticket_id: receipt.ticketId,
            event_id: receipt.eventId,
            token: receipt.token,
          })),
          { onConflict: "ticket_id", ignoreDuplicates: true },
        );

      if (receiptError) {
        receiptPersistenceError = "expo_receipt_persistence_failed";
        console.error("Persist Expo push receipts error:", receiptError);
      }
    }

    const partialErrors = [
      ...new Set([
        ...retryableErrors,
        ...permanentErrors,
        ...(receiptPersistenceError ? [receiptPersistenceError] : []),
      ]),
    ];

    // Once at least one device was accepted by Expo, retrying the entire event
    // would duplicate the notification on healthy devices. Record the partial
    // failure and let future events retry only their own device submissions.
    if (acceptedCount > 0) {
      return {
        status: "submitted" as const,
        error: partialErrors.length > 0 ? partialErrors.join(",") : null,
      };
    }

    if (retryableErrors.length > 0) {
      return {
        status: "retry" as const,
        error: [...new Set(retryableErrors)].join(","),
      };
    }

    if (permanentErrors.length > 0) {
      return {
        status: "dead" as const,
        error: [...new Set(permanentErrors)].join(","),
      };
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

const drainPushDeliveryOutbox = async (
  supabase: SupabaseAdminClient,
  eventIds: string[] | null = null,
) => {
  const uniqueEventIds = eventIds
    ? [...new Set(eventIds.filter(Boolean))]
    : null;

  if (eventIds && uniqueEventIds?.length === 0) {
    return 0;
  }

  await prunePushTokenRegistry(supabase);

  const { data, error } = await supabase.rpc("claim_push_delivery_jobs", {
    p_event_ids: uniqueEventIds ?? undefined,
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
    if (!await authorizeClaimedPushDelivery(supabase, job.id)) {
      return;
    }

    const payload = job.payload && typeof job.payload === "object"
      ? job.payload
      : {};
    const result = await sendPushNotifications(supabase, [{
      eventId: job.id,
      userId: job.user_id,
      title: job.title,
      body: job.body,
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
      priority: "high",
      collapseId: typeof payload.collapseId === "string"
        ? payload.collapseId
        : undefined,
      tag: typeof payload.notificationTag === "string"
        ? payload.notificationTag
        : undefined,
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
        p_error: result.error ?? undefined,
        p_retry_after_seconds: retryAfterSeconds ?? undefined,
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

const drainPushDeliveryReceipts = async (supabase: SupabaseAdminClient) => {
  const { data, error } = await supabase.rpc("claim_push_receipt_jobs", {
    p_limit: 300,
  });

  if (error) {
    throw error;
  }

  const jobs: ExpoReceiptJob[] = (data ?? []).map((job) => ({
    ticketId: job.ticket_id,
    eventId: job.event_id,
    token: job.token,
    attemptCount: job.attempt_count,
  }));

  if (jobs.length === 0) {
    return 0;
  }

  const resolutions = await resolveExpoPushReceipts(jobs);
  const invalidTokens = resolutions
    .filter((resolution) =>
      resolution.error === "expo_receipt_DeviceNotRegistered"
    )
    .map((resolution) => resolution.token);

  if (invalidTokens.length > 0) {
    const { error: deleteError } = await supabase
      .from("device_push_tokens")
      .delete()
      .in("token", [...new Set(invalidTokens)]);

    if (deleteError) {
      console.error("Delete invalid push tokens error:", deleteError);
    }
  }

  const completeReceipt = async (resolution: ExpoReceiptResolution) => {
    const retryAfterSeconds = resolution.status === "retry"
      ? Math.min(3600, 300 * (2 ** Math.max(0, resolution.attemptCount - 1)))
      : null;
    const { data: completed, error: completionError } = await supabase.rpc(
      "complete_push_receipt_job",
      {
        p_ticket_id: resolution.ticketId,
        p_status: resolution.status,
        p_error: resolution.error ?? undefined,
        p_retry_after_seconds: retryAfterSeconds ?? undefined,
      },
    );

    if (completionError) {
      throw completionError;
    }

    if (completed !== true) {
      throw new Error("Push receipt job lost its processing lease.");
    }

    if (resolution.status === "error" && resolution.error) {
      const { error: eventUpdateError } = await supabase
        .from("notification_events")
        .update({ push_last_error: resolution.error })
        .eq("id", resolution.eventId);

      if (eventUpdateError) {
        console.error(
          "Record push receipt error on event failed:",
          eventUpdateError,
        );
      }
    }
  };

  for (const resolutionChunk of chunkArray(resolutions, 25)) {
    await Promise.all(resolutionChunk.map(completeReceipt));
  }

  return resolutions.length;
};

const getPushDeliveryHealth = async (supabase: SupabaseAdminClient) => {
  const { data, error } = await supabase.rpc("get_push_delivery_health");

  if (error) {
    throw error;
  }

  const health = data?.[0];

  if (!health) {
    throw new Error("Push delivery health read model returned no row.");
  }

  return {
    pending: Number(health.pending_count ?? 0),
    retry: Number(health.retry_count ?? 0),
    processing: Number(health.processing_count ?? 0),
    dead: Number(health.dead_count ?? 0),
    stalled: Number(health.stalled_count ?? 0),
    oldestDueAt: health.oldest_due_at,
    oldestDueAgeSeconds: Number(health.oldest_due_age_seconds ?? 0),
    receiptPending: Number(health.receipt_pending_count ?? 0),
    receiptRetry: Number(health.receipt_retry_count ?? 0),
    receiptProcessing: Number(health.receipt_processing_count ?? 0),
    receiptFailed: Number(health.receipt_failed_count ?? 0),
    receiptStalled: Number(health.receipt_stalled_count ?? 0),
  };
};

const dispatchNotificationEvents = async (
  supabase: SupabaseAdminClient,
  notifications: NotificationEventDraft[],
  options: NotificationDispatchOptions = {},
) => {
  if (notifications.length === 0) {
    return;
  }

  const storedNotifications = await persistNotificationEvents(
    supabase,
    notifications,
  );

  await Promise.all(
    storedNotifications.map((notification) =>
      publishUserEvents(
        supabase,
        [notification.userId],
        "notification_changed",
        {
          notification: {
            id: notification.eventId,
            kind: notification.kind,
            routeKind: notification.routeKind,
            routeUserId: notification.routeUserId ?? null,
            title: notification.title,
            body: notification.body,
            payload: notification.payload ?? {},
          },
        },
      ).catch((error) => {
        console.error("Notification event broadcast error:", error);
      })
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
    await drainPushDeliveryReceipts(supabase);
  })();

  if (options.deferPush && runAfterResponse(pushTask)) {
    return;
  }

  await pushTask;
};

const notifyChatStatusChange = async (
  supabase: SupabaseAdminClient,
  config: {
    recipientUserId: string;
    actorUserId: string;
    otherUserName: string;
    kind: Extract<
      NotificationEventKind,
      "chat_ended" | "chat_blocked" | "chat_unblocked"
    >;
  },
  options: NotificationDispatchOptions = {},
) => {
  const match = await fetchMatchBetweenUsers(
    supabase,
    config.recipientUserId,
    config.actorUserId,
  );

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
      title: "Sohbet güncellendi",
      body: getChatStatusNotificationBody(config.kind, config.otherUserName),
    },
  ], options);
};

const queueChatStatusNotification = (
  supabase: SupabaseAdminClient,
  config: {
    recipientUserId: string;
    actorUserId: string;
    kind: Extract<
      NotificationEventKind,
      "chat_ended" | "chat_blocked" | "chat_unblocked"
    >;
  },
) => {
  const task = (async () => {
    const nameMap = await loadProfileNameMap(supabase, [config.actorUserId]);
    await notifyChatStatusChange(
      supabase,
      {
        ...config,
        otherUserName: nameMap.get(config.actorUserId) ?? "Bir kullanıcı",
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
  supabase: SupabaseAdminClient,
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
  match: DatabaseRow | null,
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
  match: DatabaseRow | null,
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

const getMatchChatDeletedAt = (match: DatabaseRow | null, userId: string) =>
  getMatchChatTimestamp(match, userId, "deleted_at");

const getMatchChatClearedAt = (match: DatabaseRow | null, userId: string) =>
  getMatchChatTimestamp(match, userId, "cleared_at");

const getChatVisibleSince = (match: DatabaseRow | null, userId: string) => {
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
  match: DatabaseRow | null,
  currentUserId: string,
  otherUserId: string,
  blockRows: Array<{ blocker_id: string; blocked_id: string }>,
) => {
  const { blockedByMe, blockedByOther } = getBlockState(
    blockRows,
    currentUserId,
    otherUserId,
  );
  const ended = Boolean(
    match && (match.ended_at != null || match.status === "ended"),
  );

  if (blockedByMe) {
    return (match && currentUserId === match.user1_id
      ? "blocked_by_user1"
      : "blocked_by_user2") as
        | "active"
        | "ended"
        | "blocked_by_user1"
        | "blocked_by_user2";
  }

  if (blockedByOther) {
    return (match && otherUserId === match.user1_id
      ? "blocked_by_user1"
      : "blocked_by_user2") as
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
  match: DatabaseRow | null,
  currentUserId: string,
  otherUserId: string,
  blockRows: Array<{ blocker_id: string; blocked_id: string }> = [],
) => {
  const { blockedByMe, blockedByOther, isBlocked } = getBlockState(
    blockRows,
    currentUserId,
    otherUserId,
  );
  const ended = Boolean(
    match && (match.ended_at != null || match.status === "ended"),
  );
  const deletedByCurrentUser = Boolean(
    getMatchChatDeletedAt(match, currentUserId),
  );

  let lockedReason: string | null = null;
  if (!match) {
    lockedReason = "Bu kullanıcı ile aktif bir eşleşme bulunamadı.";
  } else if (blockedByMe && blockedByOther) {
    lockedReason =
      "Bu kullanıcı ile karşılıklı engel var. Mesaj gönderemezsin.";
  } else if (blockedByMe) {
    lockedReason =
      "Bu kullanıcıyı engelledin. Engeli kaldırmadan mesaj gönderemezsin.";
  } else if (blockedByOther) {
    lockedReason = "Bu kullanıcı seni engelledi. Mesaj gönderemezsin.";
  } else if (deletedByCurrentUser) {
    lockedReason = "Bu sohbeti sildin. Yeniden eşleşmeden mesaj gönderemezsin.";
  } else if (ended) {
    lockedReason =
      "Bu eşleşme bitirildi. Yeniden eşleşmeden mesaj gönderemezsin.";
  }

  return {
    status: deletedByCurrentUser
      ? "ended"
      : getStoredMatchStatus(match, currentUserId, otherUserId, blockRows),
    ended: ended || deletedByCurrentUser,
    blockedByMe,
    blockedByOther,
    isBlocked,
    canSend: Boolean(match) && !ended && !isBlocked && !deletedByCurrentUser,
    lockedReason,
  };
};

const loadUserPayloadMap = async (
  supabase: SupabaseAdminClient,
  userIds: string[],
  viewerUserId: string | null = null,
): Promise<Map<string, DatabaseRow>> => {
  if (userIds.length === 0) {
    return new Map<string, DatabaseRow>();
  }

  const [
    { data: profiles, error: profilesError },
    moviesResult,
    currentlyWatchingResult,
    discoveryPreferencesMap,
  ] = await Promise.all([
    supabase.from("profiles").select(PUBLIC_PROFILE_SELECT).in("id", userIds)
      .limit(userIds.length),
    supabase
      .from("user_movies")
      .select("user_id, movie_id, media_type, type")
      .in("user_id", userIds)
      .order("created_at", { ascending: false })
      .limit(
        Math.min(
          MAX_RELATIONSHIP_ROWS,
          Math.max(
            1,
            userIds.length * (MAX_FAVORITES_COUNT + MAX_WATCHED_COUNT),
          ),
        ),
      ),
    supabase
      .from("currently_watching")
      .select(
        "user_id, movie_id, media_type, state, remaining_ms, expires_at, version, updated_at",
      )
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

  const moviesByUserId = new Map<
    string,
    Array<{ movie_id: number; media_type?: string | null; type: string }>
  >();
  (allMovies ?? []).forEach(
    (
      movie: {
        user_id: string;
        movie_id: number;
        media_type?: string | null;
        type: string;
      },
    ) => {
      const current = moviesByUserId.get(movie.user_id);
      const normalizedMovie = {
        movie_id: movie.movie_id,
        media_type: movie.media_type ?? "movie",
        type: movie.type,
      };

      if (current) {
        current.push(normalizedMovie);
      } else {
        moviesByUserId.set(movie.user_id, [normalizedMovie]);
      }
    },
  );

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
        remaining_ms: typeof item.remaining_ms === "number"
          ? item.remaining_ms
          : null,
        expires_at: item.expires_at ?? null,
        version: typeof item.version === "number" ? item.version : null,
        updated_at: item.updated_at ?? null,
      });
    },
  );

  const userPayloads = (profiles ?? [])
    .filter((profile) => isEmailConfirmedProfile(profile))
    .map((profile) =>
      buildUserPayload(
        profile,
        moviesByUserId.get(profile.id) ?? [],
        watchingByUserId.get(profile.id) ?? null,
        discoveryPreferencesMap.get(profile.id) ??
          DEFAULT_DISCOVERY_PREFERENCES,
        viewerUserId,
      )
    );
  const signedPayloads = await signProfilePhotosForPayloads(
    supabase,
    userPayloads,
  );

  return new Map<string, DatabaseRow>(
    signedPayloads.map((payload) =>
      [String(payload.id ?? ""), payload] as const
    ),
  );
};

const loadRawProfileMap = async (
  supabase: SupabaseAdminClient,
  userIds: string[],
): Promise<Map<string, DatabaseRow>> => {
  if (userIds.length === 0) {
    return new Map<string, DatabaseRow>();
  }

  const [
    { data, error },
    privateLocationMap,
  ] = await Promise.all([
    supabase.from("profiles").select(SERVER_PROFILE_SELECT).in("id", userIds)
      .limit(userIds.length),
    loadPrivateProfileLocationMap(supabase, userIds),
  ]);

  if (error) {
    throw error;
  }

  return new Map<string, DatabaseRow>(
    (data ?? []).map((profile) =>
      [
        profile.id,
        {
          ...profile,
          ...(privateLocationMap.get(profile.id) ?? {}),
        },
      ] as const
    ),
  );
};

const loadProfileNameMap = async (
  supabase: SupabaseAdminClient,
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
      typeof profile.name === "string" && profile.name.trim()
        ? profile.name.trim()
        : "bir kullanıcı",
    ]),
  );
};

const loadChatMessageStats = async (
  supabase: SupabaseAdminClient,
  currentUserId: string,
  otherUserIds: string[],
  visibleSinceMap: Map<string, string | null> = new Map(),
) => {
  if (otherUserIds.length === 0) {
    return new Map<
      string,
      {
        lastMessage: string;
        lastMessageTime: string | null;
        unreadCount: number;
      }
    >();
  }

  const boundedOtherUserIds = [...new Set(otherUserIds)].slice(
    0,
    MAX_CHAT_MESSAGE_PEER_ROWS,
  );
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

  const statsMap = new Map<
    string,
    { lastMessage: string; lastMessageTime: string | null; unreadCount: number }
  >();

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
      (!lastMessageAt ||
        new Date(lastMessageAt).getTime() < new Date(visibleSinceAt).getTime())
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

const fetchMatchBetweenUsers = async (
  supabase: SupabaseAdminClient,
  leftUserId: string,
  rightUserId: string,
) => {
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

const upsertMatchWithFallback = async (
  supabase: SupabaseAdminClient,
  payload: TablesInsert<"matches">,
) => {
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
  ] satisfies Array<keyof TablesInsert<"matches">>;
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

    if (
      !optionalColumns.includes(
        missingColumnName as (typeof optionalColumns)[number],
      )
    ) {
      throw error;
    }

    delete nextPayload[missingColumnName as keyof TablesInsert<"matches">];
  }
};

const ensureActiveMatchBetweenUsers = async (
  supabase: SupabaseAdminClient,
  currentUserId: string,
  otherUserId: string,
  sourceType: MatchSourceType,
  options: {
    hasReverseLike?: boolean;
    existingMatch?: Tables<"matches"> | null;
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
    return options.existingMatch ??
      fetchMatchBetweenUsers(supabase, currentUserId, otherUserId);
  }

  const [user1Id, user2Id] = getPairUserIds(currentUserId, otherUserId);
  const pairKey = getPairKey(currentUserId, otherUserId);
  const existingMatch = options.existingMatch === undefined
    ? await fetchMatchBetweenUsers(supabase, currentUserId, otherUserId)
    : options.existingMatch;
  let likeTimelineMap = new Map<
    string,
    { firstLikeByUserId: string | null; acceptedByUserId: string | null }
  >();
  let snapshot: Partial<TablesInsert<"matches">> = {
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
  const currentUserWasDeleted = Boolean(
    getMatchChatDeletedAt(existingMatch, currentUserId),
  );
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
    first_like_by_user_id: likeTimeline?.firstLikeByUserId ??
      existingMatch?.first_like_by_user_id ??
      otherUserId,
    accepted_by_user_id: likeTimeline?.acceptedByUserId ??
      existingMatch?.accepted_by_user_id ??
      currentUserId,
  });
};

const fetchBlockRows = async (
  supabase: SupabaseAdminClient,
  leftUserId: string,
  rightUserId: string,
) => {
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

const fetchBlockedUserIdsForUser = async (
  supabase: SupabaseAdminClient,
  currentUserId: string,
) => {
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

const fetchActiveMatchedUserIdsForUser = async (
  supabase: SupabaseAdminClient,
  currentUserId: string,
) => {
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

  (data ?? []).forEach(
    (row: { user1_id: string; user2_id: string } & Record<string, unknown>) => {
      if (getMatchChatDeletedAt(row, currentUserId)) {
        return;
      }

      matchedUserIds.add(
        row.user1_id === currentUserId ? row.user2_id : row.user1_id,
      );
    },
  );

  return matchedUserIds;
};

const fetchLikeSets = async (
  supabase: SupabaseAdminClient,
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

  const [{ data: likedRows, error: likedError }, likedByRows] = await Promise
    .all([
      supabase.from("likes").select("liked_user_id").eq(
        "user_id",
        currentUserId,
      ).limit(MAX_RELATIONSHIP_ROWS),
      loadIncomingLikes(),
    ]);

  if (likedError) {
    throw likedError;
  }

  return {
    likedIds: new Set<string>(
      (likedRows ?? []).map((row: { liked_user_id: string }) =>
        row.liked_user_id
      ),
    ),
    likedByIds: new Set<string>(
      (likedByRows ?? []).map((row: { user_id: string }) => row.user_id),
    ),
  };
};

const reconcileMutualLikesForUser = async (
  supabase: SupabaseAdminClient,
  currentUserId: string,
  likeSets: { likedIds: Set<string>; likedByIds: Set<string> },
  sourceType: MatchSourceType,
) => {
  const mutualUserIds = [...likeSets.likedIds].filter((userId) =>
    likeSets.likedByIds.has(userId)
  );
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

const fetchActiveRelationshipUserIdsForUser = async (
  supabase: SupabaseAdminClient,
  currentUserId: string,
) => {
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

const loadChatDirectoryPageFallback = async (
  supabase: SupabaseAdminClient,
  currentUserId: string,
  cursor: ReturnType<typeof decodeChatDirectoryCursor>,
  pageSize: number,
) => {
  const [messagePeersResult, matchesResult, hiddenChatsResult] = await Promise
    .all([
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

  const fallbackError = messagePeersResult.error ?? matchesResult.error ??
    hiddenChatsResult.error;

  if (fallbackError) {
    throw fallbackError;
  }

  const hiddenUserIds = new Set<string>(
    (hiddenChatsResult.data ?? []).map((row: { other_user_id: string }) =>
      row.other_user_id
    ),
  );
  const matchByUserId = new Map<string, Tables<"matches">>();

  (matchesResult.data ?? []).forEach((match) => {
    const otherUserId = match.user1_id === currentUserId
      ? match.user2_id
      : match.user1_id;

    if (otherUserId) {
      matchByUserId.set(otherUserId, match);
    }
  });

  const messageByUserId = new Map<
    string,
    { other_user_id: string; last_message_time?: string | null }
  >();

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
  const directoryRows: Array<{ other_user_id: string; activity_at: string }> =
    [];

  peerIds.forEach((otherUserId) => {
    if (otherUserId === currentUserId || hiddenUserIds.has(otherUserId)) {
      return;
    }

    const match = matchByUserId.get(otherUserId) ?? null;

    if (match && getMatchChatDeletedAt(match, currentUserId)) {
      return;
    }

    const visibleSince = getChatVisibleSince(match, currentUserId);
    const visibleSinceMs = visibleSince
      ? new Date(visibleSince).getTime()
      : Number.NEGATIVE_INFINITY;
    const messageTime = messageByUserId.get(otherUserId)?.last_message_time ??
      null;
    const messageTimeMs = messageTime
      ? new Date(messageTime).getTime()
      : Number.NEGATIVE_INFINITY;
    const activityAt = messageTime && messageTimeMs >= visibleSinceMs
      ? messageTime
      : visibleSince;

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
      const timeDelta = new Date(right.activity_at).getTime() -
        new Date(left.activity_at).getTime();
      return timeDelta || right.other_user_id.localeCompare(left.other_user_id);
    })
    .slice(0, pageSize + 1);
};

const findProfileByUsername = async (
  supabase: SupabaseAdminClient,
  username: string,
) => {
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

const checkSchemaReady = async (supabase: SupabaseAdminClient) => {
  const emptyUserId = "00000000-0000-0000-0000-000000000000";
  const checks = await Promise.allSettled([
    supabase.from("profiles").select("email_confirmed").limit(1),
    supabase.from("schema_contracts").select(
      "required_version,compatible_min_version,current_version",
    ).eq("name", "wmatch_api").limit(1),
    supabase
      .from("matches")
      .select(
        "user1_chat_deleted_at,user2_chat_deleted_at,user1_chat_cleared_at,user2_chat_cleared_at",
      )
      .limit(1),
    supabase.from("currently_watching").select(
      "media_type,state,remaining_ms,expires_at,started_at,paused_at,version",
    ).limit(1),
    supabase.from("user_movies").select("media_type").limit(1),
    supabase.rpc("replace_user_media_collections", {
      p_user_id: emptyUserId,
      p_favorites: null,
      p_watched: null,
    }),
    supabase.rpc("get_live_now_users", {
      p_current_user_id: emptyUserId,
      p_cursor_updated_at: undefined,
      p_cursor_user_id: undefined,
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
      p_cursor_time: undefined,
      p_cursor_user_id: undefined,
      p_limit: 1,
    }),
    supabase.rpc("get_compatibility_candidate_page", {
      p_current_user_id: emptyUserId,
      p_cursor_score: undefined,
      p_cursor_user_id: undefined,
      p_limit: 1,
    }),
    supabase.rpc("get_watch_discovery_candidate_page", {
      p_current_user_id: emptyUserId,
      p_movie_id: 0,
      p_media_type: "movie",
      p_cursor_updated_at: undefined,
      p_cursor_user_id: undefined,
      p_limit: 1,
    }),
    supabase.rpc("get_chat_list_stats", {
      p_current_user_id: emptyUserId,
      p_other_user_ids: [],
      p_visible_since: {},
    }),
    supabase.rpc("get_push_delivery_health"),
    supabase.rpc("apply_watch_session_transition", {
      p_user_id: emptyUserId,
      p_action: "stop",
      p_movie_id: undefined,
      p_media_type: undefined,
      p_expected_version: undefined,
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

const getSchemaReady = (supabase: SupabaseAdminClient) => {
  if (schemaReadinessCache && schemaReadinessCache.expiresAt > Date.now()) {
    return Promise.resolve(schemaReadinessCache.ready);
  }

  if (schemaReadinessFlight) {
    return schemaReadinessFlight;
  }

  schemaReadinessFlight = checkSchemaReady(supabase)
    .then((ready) => {
      schemaReadinessCache = {
        ready,
        expiresAt: Date.now() + SCHEMA_READINESS_CACHE_TTL_MS,
      };
      return ready;
    })
    .finally(() => {
      schemaReadinessFlight = null;
    });

  return schemaReadinessFlight;
};

// Internal domain dependency surface. Public HTTP contracts live in routeRegistry.ts.
export {
  AccountDeletionResumeError,
  ANDROID_NOTIFICATION_CHANNEL_ID,
  API_VERSION,
  app,
  authMiddleware,
  buildAbuseKey,
  buildAuthUserMetadata,
  buildChatNotificationTag,
  buildCompactNotificationIdentifier,
  buildFallbackUserPayload,
  buildFreshSwipeQuotaRow,
  buildGroupedMessageNotificationBody,
  buildLikeNotificationBody,
  buildMatchChatVisibilityPatch,
  buildMatchContextSnapshot,
  buildMatchSnapshot,
  buildMessageNotificationBody,
  buildUserPayload,
  CHAT_THREAD_INITIAL_PAGE_SIZE,
  checkSchemaReady,
  chunkArray,
  cleanupRemovedManagedProfilePhotos,
  cleanupStaleProfilePhotoQuarantine,
  consumeSwipeQuota,
  createEmptyMovieCollections,
  persistNotificationEvents,
  DAILY_DISLIKE_SWIPE_LIMIT,
  DAILY_LIKE_SWIPE_LIMIT,
  DAILY_UNDO_LIMIT,
  decodeChatDirectoryCursor,
  decodeCompatibilityCursor,
  decodeLiveNowCursor,
  decodeMessageCursor,
  DEFAULT_CHAT_DIRECTORY_PAGE_SIZE,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_CHAT_THREAD_PAGE_SIZE,
  DEFAULT_COMPATIBILITY_PAGE_SIZE,
  DEFAULT_DIRECTORY_PAGE_SIZE,
  DEFAULT_DISCOVERY_PREFERENCES,
  DEFAULT_WATCH_DISCOVERY_PAGE_SIZE,
  dispatchNotificationEvents,
  drainPushDeliveryOutbox,
  drainPushDeliveryReceipts,
  encodeChatDirectoryCursor,
  encodeCompatibilityCursor,
  encodeLiveNowCursor,
  encodeMessageCursor,
  enforceRateLimit,
  ensureActiveMatchBetweenUsers,
  EXPO_PUSH_MAX_HTTP_ATTEMPTS,
  EXPO_PUSH_RETRY_BASE_DELAY_MS,
  extractManagedProfilePhotoPaths,
  fetchActiveMatchedUserIdsForUser,
  fetchActiveRelationshipUserIdsForUser,
  fetchBlockedUserIdsForUser,
  fetchBlockRows,
  fetchExpoPushWithRetry,
  fetchLikeSets,
  fetchMatchBetweenUsers,
  finalizeValidatedProfilePhotos,
  findMissingColumnName,
  findProfileByUsername,
  getBlockState,
  getChatState,
  getChatStatusNotificationBody,
  getChatVisibleSince,
  getCompatibilityBreakdown,
  getErrorMessage,
  getExpoPushHeaders,
  getMatchChatClearedAt,
  getMatchChatDeletedAt,
  getMatchChatTimestamp,
  getMatchNotificationBody,
  getMatchUserRolePrefix,
  getMediaRefKey,
  getPairKey,
  getPairUserIds,
  getPasswordResetRedirectUrl,
  getPathParam,
  getProfileCoordinates,
  getPushDeliveryHealth,
  getRequestRateLimitIdentity,
  getSchemaReady,
  getSharedCurrentlyWatchingMovieId,
  getStoredMatchStatus,
  getSupabase,
  getUsernameValidationMessage,
  hasActiveDistanceFilter,
  hashIdempotencyPayload,
  isDatabaseRow,
  isDiscoveryGenderFilter,
  isEmailConfirmedProfile,
  isMediaType,
  isMissingColumnError,
  isMissingFunctionError,
  isMissingProfileColumnError,
  isMissingRelationError,
  isTimestampBefore,
  isTrustedPasswordResetRedirect,
  isUserGender,
  LIVE_NOW_PAGE_SIZE,
  loadChatDirectoryPageFallback,
  loadChatMessageStats,
  loadChatSettingsMap,
  loadDiscoveryPreferencesMap,
  loadLikeTimelineMap,
  loadMovieCollectionsForUsers,
  loadPeerChatSettingsMap,
  loadPrivateProfileLocationMap,
  loadProfileNameMap,
  loadPushTokenMap,
  loadRawProfileMap,
  loadSwipeQuotaRow,
  loadUnreadMessageNotificationLines,
  loadUserPayloadMap,
  markChatNotificationEventsRead,
  MATCH_LIKE_REWARD_BONUS,
  MATCH_SELECT,
  MAX_AGE,
  MAX_AVAILABILITY_CHECKS_PER_MINUTE,
  MAX_BIO_LENGTH,
  MAX_BLOCK_MUTATIONS_PER_MINUTE,
  MAX_CHAT_DIRECTORY_PAGE_SIZE,
  MAX_CHAT_MESSAGE_PEER_ROWS,
  MAX_CHAT_MUTATIONS_PER_MINUTE,
  MAX_CHAT_THREAD_PAGE_SIZE,
  MAX_COMPATIBILITY_FILTER,
  MAX_COMPATIBILITY_PAGE_SIZE,
  MAX_CURRENTLY_WATCHING_MUTATIONS_PER_MINUTE,
  MAX_DIRECTORY_PAGE_SIZE,
  MAX_DISTANCE_FILTER_KM,
  MAX_FAVORITES_COUNT,
  MAX_GROUPED_MESSAGE_NOTIFICATIONS,
  MAX_LETTERBOXD_LENGTH,
  MAX_LIKES_PER_MINUTE,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES_PER_MINUTE,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_RESET_LOOKUPS_PER_HOUR,
  MAX_PASSWORD_RESET_REQUESTS_PER_HOUR,
  MAX_PROFILE_PHOTOS,
  MAX_PROFILE_UPDATES_PER_MINUTE,
  MAX_PUSH_TOKEN_REGISTRATIONS_PER_MINUTE,
  MAX_PUSH_TOKENS_PER_USER,
  MAX_RELATIONSHIP_ROWS,
  MAX_SIGNUP_ATTEMPTS_PER_HOUR,
  MAX_WATCH_DISCOVERY_PAGE_SIZE,
  MAX_WATCH_EVENT_RECIPIENTS,
  MAX_WATCHED_COUNT,
  MESSAGE_SELECT,
  MIN_AGE,
  MIN_COMPATIBILITY_FILTER,
  MIN_DISTANCE_FILTER_KM,
  MONETIZATION_ENABLED,
  normalizeBio,
  normalizeDiscoveryPreferences,
  normalizeEmail,
  normalizeIdempotencyKey,
  normalizeMatchSourceType,
  normalizeMediaType,
  normalizeRequestId,
  normalizeSwipeQuotaRow,
  normalizeUsername,
  normalizeWhitespace,
  notifyChatStatusChange,
  persistSwipeQuotaRow,
  ProfilePhotoValidationError,
  PUBLIC_PROFILE_SELECT,
  publishUserEvents,
  queueChatStatusNotification,
  queuePairStateEvents,
  queueUserEvents,
  queueWatchSessionDiscoveryEvents,
  reconcileMutualLikesForUser,
  registerSharedMiddleware,
  RELEASE_VERSION,
  REQUIRED_SCHEMA_VERSION,
  resolveExpoPushReceipts,
  resolveRequestRateLimitIdentity,
  resumeAccountDeletionJob,
  rewardSwipeQuota,
  runAfterResponse,
  sanitizeMediaRefList,
  sanitizeMovieIdList,
  sanitizePhotoList,
  SCHEMA_READINESS_CACHE_TTL_MS,
  schemaReadinessCache,
  schemaReadinessFlight,
  sendPushNotifications,
  serializeChatSettings,
  serializeDiscoveryPreferences,
  serializeProfile,
  serializeSwipeQuota,
  SERVER_PROFILE_SELECT,
  signProfilePhotosForPayloads,
  SWIPE_QUOTA_WINDOW_HOURS,
  SWIPE_QUOTA_WINDOW_MS,
  upsertMatchWithFallback,
  upsertPrivateProfileLocation,
  userHasIncomingLikesEntitlement,
  validateAge,
  validateAndStageOwnedProfilePhotos,
  validateBio,
  validateCoordinate,
  validateDiscoveryPreferences,
  validateDisplayName,
  validateGender,
  validateLetterboxd,
  validateMessageText,
  validateMovieCollectionPayload,
  validateOwnedProfilePhotos,
  validatePasswordResetRedirect,
  waitFor,
  WATCH_SESSION_DURATION_MS,
};

export type {
  AppContext,
  AppVariables,
  ChatSettingsRow,
  ChatSettingsState,
  Database,
  DatabaseRow,
  DiscoveryPreferences,
  DiscoveryPreferencesRow,
  ExpoReceiptJob,
  ExpoReceiptResolution,
  Json,
  JsonObject,
  MatchSourceType,
  MediaRef,
  MediaType,
  NotificationDispatchOptions,
  NotificationEventDraft,
  NotificationEventKind,
  NotificationRouteKind,
  SupabaseAdminClient,
  SwipeQuotaKind,
  SwipeQuotaRow,
  Tables,
  TablesInsert,
  TablesUpdate,
  UserMovieCollections,
};
