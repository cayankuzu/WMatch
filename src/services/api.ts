import { API_BASE, fetchWithRetry, getAuthHeaders } from '../../utils/supabase/client';
import type {
  ApiChat,
  ApiChatThread,
  ApiMatch,
  ApiMessage,
  ApiUser,
  ChatSettings,
  CompatibilityDiscoveryEntry,
  MatchSourceType,
  MatchStatus,
  SwipeQuotaKind,
  SwipeQuotaState,
} from '../shared/types';
import { syncServerTimeFromHeaders } from '../shared/utils/serverTime';
import {
  isApiChat,
  isApiChatThread,
  isApiMatch,
  isApiMessage,
  isApiUser,
  isCompatibilityDiscoveryEntry,
} from '../shared/utils/apiValidation';
import { BoundedMap } from '../shared/utils/boundedMap';
import { registerSessionCache } from '../shared/utils/sessionCache';
import { performanceBudgets } from '../shared/constants/performance';
import { telemetry } from './telemetry';
import { normalizeChat } from './chatState';
import {
  ApiRequestError,
  ContractViolationError,
  NetworkUnavailableError,
  RequestTimeoutError,
  SessionExpiredError,
  type ApiErrorCode,
} from './api/errors';
import type {
  ChatListResponse,
  CompatibilityDiscoveryResponse,
  HealthStatus,
  LikeUserResult,
  LikesDiscoveryResponse,
  LiveNowResponse,
  SubmitUserReportPayload,
  WatchDiscoveryResponse,
} from './api/contracts';
import { assertArrayField, assertObjectPayload, assertValidatedPayload } from './api/validation';

export type { ApiChat, ApiChatThread, ApiMatch, ApiMessage, ApiUser } from '../shared/types';
export {
  ApiRequestError,
  ContractViolationError,
  NetworkUnavailableError,
  RequestTimeoutError,
  SessionExpiredError,
} from './api/errors';
export type { ApiErrorCode, ApiRequestErrorOptions } from './api/errors';
export type {
  ChatListResponse,
  CompatibilityDiscoveryResponse,
  HealthStatus,
  LikeUserResult,
  LikesDiscoveryResponse,
  LiveNowResponse,
  SubmitUserReportPayload,
  WatchDiscoveryResponse,
} from './api/contracts';

const mutationFlightMap = new BoundedMap<string, Promise<unknown>>(128);
const mutationCooldownMap = new BoundedMap<string, number>(256);
const readFlightMap = new BoundedMap<string, Promise<unknown>>(128);
const readCacheMap = new BoundedMap<string, { expiresAt: number; value: unknown }>(128);
registerSessionCache(() => {
  mutationFlightMap.clear();
  mutationCooldownMap.clear();
  readFlightMap.clear();
  readCacheMap.clear();
});
const READ_CACHE_TTL_MS = 3500;
function buildFallbackApiUser(userId: string): ApiUser {
  return {
    id: userId,
    name: 'Kullanıcı',
    age: 18,
    showAgeOnProfile: false,
    gender: 'other',
    showGenderOnProfile: false,
    username: '',
    bio: '',
    letterboxd: '',
    photos: [],
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
    discoveryPreferences: {
      genderPreference: 'random',
      ageMin: 18,
      ageMax: 99,
      distanceMinKm: 0,
      distanceMaxKm: 500,
      compatibilityMin: 0,
      compatibilityMax: 100,
    },
  };
}

function normalizeChatThread(thread: ApiChatThread): ApiChatThread {
  return {
    ...thread,
    chat: normalizeChat(thread.chat),
  };
}

function extractErrorMessage(payload: unknown): string | null {
  const visited = new Set<unknown>();

  const extract = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed || trimmed === '[object Object]') {
        return null;
      }

      return trimmed;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const nestedMessage = extract(item);

        if (nestedMessage) {
          return nestedMessage;
        }
      }

      return null;
    }

    if (!value || typeof value !== 'object') {
      return null;
    }

    if (visited.has(value)) {
      return null;
    }

    visited.add(value);

    const record = value as Record<string, unknown>;

    for (const key of ['error', 'message', 'details', 'hint', 'description', 'reason', 'code']) {
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

  return extract(payload);
}

function normalizeApiErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();

  if (
    !message ||
    message === '[object Object]' ||
    message.includes('[object Object]') ||
    message.startsWith('{') ||
    message.startsWith('API iste')
  ) {
    return fallback;
  }

  return message;
}

function createIdempotencyKey(path: string) {
  return `wmatch:${Date.now()}:${Math.random().toString(36).slice(2, 12)}:${path}`;
}

function createClientRequestId() {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function getMetricPath(path: string) {
  return path
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function recordApiDuration(
  path: string,
  method: string,
  startedAt: number,
  outcome: 'success' | 'http_error' | 'transport_error' | 'contract_error',
  status?: number,
) {
  telemetry.recordDuration(
    'api.request',
    Date.now() - startedAt,
    performanceBudgets.apiRequestMs,
    {
      method,
      outcome,
      path: getMetricPath(path),
      status,
    },
  );
}

function getRequestMethod(init?: RequestInit) {
  return (init?.method ?? 'GET').toUpperCase();
}

function getApiErrorCode(status: number): ApiErrorCode {
  if (status === 401 || status === 403) {
    return 'SESSION_EXPIRED';
  }

  return 'HTTP_ERROR';
}

function isAbortLikeError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.toLocaleLowerCase('en-US').includes('timeout'))
  );
}

function normalizeTransportError(error: unknown, path: string, method: string, requestId: string) {
  const message = error instanceof Error ? error.message : 'Network request failed';
  const normalizedError = isAbortLikeError(error)
    ? new RequestTimeoutError(message, requestId, error)
    : new NetworkUnavailableError(message, requestId, error);

  console.error('API transport failed', {
    path,
    method,
    code: normalizedError.code,
    requestId,
    message,
  });
  telemetry.captureException(normalizedError, {
    path,
    method,
    code: normalizedError.code,
    requestId,
  });

  return normalizedError;
}

function parseJsonPayload<T>(rawPayload: string, requestId: string | null, path: string): T {
  if (!rawPayload.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(rawPayload) as T;
  } catch (error) {
    throw new ContractViolationError(`Invalid JSON response for ${path}`, requestId, error);
  }
}

function redactPayload(payload: string) {
  if (!payload.trim()) {
    return '<empty>';
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    const redact = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(redact);
      }

      if (!value || typeof value !== 'object') {
        return value;
      }

      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => {
          const normalizedKey = key.toLowerCase();
          const isSensitive =
            normalizedKey.includes('token') ||
            normalizedKey.includes('authorization') ||
            normalizedKey.includes('password') ||
            normalizedKey.includes('secret') ||
            normalizedKey.includes('email') ||
            normalizedKey.includes('message') ||
            normalizedKey.includes('text') ||
            normalizedKey.includes('body') ||
            normalizedKey.includes('bio') ||
            normalizedKey.includes('photo') ||
            normalizedKey.includes('url') ||
            normalizedKey.includes('latitude') ||
            normalizedKey.includes('longitude');

          return [key, isSensitive ? '<redacted>' : redact(nestedValue)];
        }),
      );
    };

    return JSON.stringify(redact(parsed));
  } catch {
    return `<non-json response redacted; length=${payload.length}>`;
  }
}

async function request<T>(path: string, init?: RequestInit, authHeaders?: HeadersInit): Promise<T> {
  const startedAt = Date.now();
  const headers = authHeaders ?? await getAuthHeaders();
  const method = getRequestMethod(init);
  const requestHeaders = new Headers(headers);
  const clientRequestId = createClientRequestId();

  if (typeof init?.body === 'string') {
    requestHeaders.set('Content-Type', 'application/json');
  }

  requestHeaders.set('x-request-id', clientRequestId);

  new Headers(init?.headers).forEach((value, key) => {
    requestHeaders.set(key, value);
  });

  let response: Response;

  try {
    response = await fetchWithRetry(`${API_BASE}${path}`, {
      ...init,
      method,
      headers: requestHeaders,
    });
  } catch (error) {
    recordApiDuration(path, method, startedAt, 'transport_error');
    throw normalizeTransportError(error, path, method, clientRequestId);
  }

  syncServerTimeFromHeaders(response.headers);
  const responseRequestId = response.headers.get('x-request-id') ?? clientRequestId;

  if (!response.ok) {
    let rawPayload = '';
    let message = `API isteği başarısız oldu (${response.status})`;

    try {
      rawPayload = await response.text();
      const parsedPayload = rawPayload ? JSON.parse(rawPayload) : null;
      const parsedMessage = extractErrorMessage(parsedPayload);

      if (parsedMessage) {
        message = parsedMessage;
      } else if (rawPayload.trim().length > 0 && !rawPayload.trim().startsWith('{') && rawPayload.trim() !== '[object Object]') {
        message = rawPayload.trim();
      }
    } catch {
      // Some platform/network failures can return non-JSON responses.
    }

    console.error('API request failed', {
      path,
      method,
      status: response.status,
      statusText: response.statusText,
      requestId: responseRequestId,
      body: redactPayload(rawPayload),
    });
    const apiError =
      response.status === 401 || response.status === 403
        ? new SessionExpiredError(message, responseRequestId)
        : new ApiRequestError({
            status: response.status,
            message,
            code: getApiErrorCode(response.status),
            requestId: responseRequestId,
            retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
          });

    telemetry.captureException(apiError, {
      path,
      method,
      status: response.status,
      requestId: responseRequestId,
    });

    recordApiDuration(path, method, startedAt, 'http_error', response.status);

    throw apiError;
  }

  const rawPayload = await response.text();
  let payload: T;
  try {
    payload = parseJsonPayload<T>(rawPayload, responseRequestId, path);
  } catch (error) {
    recordApiDuration(path, method, startedAt, 'contract_error', response.status);
    throw error;
  }
  recordApiDuration(path, method, startedAt, 'success', response.status);
  return payload;
}

function invalidateReadCache(prefixes: string[]) {
  if (prefixes.length === 0) {
    return;
  }

  readCacheMap.forEach((_value, scopedKey) => {
    const path = scopedKey.slice(scopedKey.indexOf(':') + 1);
    if (prefixes.some((prefix) => path.startsWith(prefix))) {
      readCacheMap.delete(scopedKey);
    }
  });
}

function getMutationInvalidationPrefixes(key: string) {
  if (/^(like|unlike|undo-like|reject-like|restore-like):/.test(key)) {
    return ['/discovery', '/likes', '/matches', '/chats', '/swipe-quota', '/watch/live-now'];
  }

  if (/^(match-status|hide-chat|delete-chat|chat-settings|block-user|unblock-user):/.test(key)) {
    return ['/chats', '/messages', '/matches', '/discovery', '/users', '/watch/live-now'];
  }

  if (key.startsWith('mark-thread-read:')) {
    return ['/chats'];
  }

  if (/^(push-token|push-token-delete|report):/.test(key)) {
    return [];
  }

  return ['/'];
}

async function runSingleFlight<T>(key: string, task: () => Promise<T>) {
  const existing = mutationFlightMap.get(key) as Promise<T> | undefined;

  if (existing) {
    return existing;
  }

  const nextPromise = task()
    .then((value) => {
      invalidateReadCache(getMutationInvalidationPrefixes(key));
      return value;
    })
    .finally(() => {
      mutationFlightMap.delete(key);
    });

  mutationFlightMap.set(key, nextPromise);
  return nextPromise;
}

async function runReadSingleFlight<T>(
  key: string,
  task: (authHeaders: HeadersInit) => Promise<T>,
  force = false,
) {
  const scopeHeaders = await getAuthHeaders();
  const authFingerprint = scopeHeaders.Authorization?.slice(-18) ?? 'anonymous';
  const scopedKey = `${authFingerprint}:${key}`;
  const cached = readCacheMap.get(scopedKey);

  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  if (force) {
    readCacheMap.delete(scopedKey);
  }

  const existing = readFlightMap.get(scopedKey) as Promise<T> | undefined;

  if (existing) {
    return existing;
  }

  const nextPromise = task(scopeHeaders)
    .then((value) => {
      readCacheMap.set(scopedKey, {
        expiresAt: Date.now() + READ_CACHE_TTL_MS,
        value,
      });

      return value;
    })
    .finally(() => {
      readFlightMap.delete(scopedKey);
    });

  readFlightMap.set(scopedKey, nextPromise);
  return nextPromise;
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const path = '/health';
  const data = await request<Record<string, unknown>>(path);
  const payload = assertObjectPayload(data, null, path);
  const requiredStringFields = ['apiVersion', 'release', 'requiredSchema', 'serverTime', 'requestId'] as const;

  if (payload.ok !== true || typeof payload.schemaReady !== 'boolean') {
    throw new ContractViolationError(`Invalid health payload for ${path}`, null);
  }

  for (const field of requiredStringFields) {
    if (typeof payload[field] !== 'string' || !payload[field]) {
      throw new ContractViolationError(`Missing health field "${field}"`, null);
    }
  }

  return payload as unknown as HealthStatus;
}

function isWithinCooldown(key: string, cooldownMs: number) {
  const now = Date.now();
  const lastRunAt = mutationCooldownMap.get(key) ?? 0;

  if (now - lastRunAt < cooldownMs) {
    return true;
  }

  mutationCooldownMap.set(key, now);
  return false;
}

export async function getUsers(activeOnly = false): Promise<ApiUser[]> {
  const path = `/users${activeOnly ? '?activeOnly=1' : ''}`;
  const data = await runReadSingleFlight(path, (headers) => request<Record<string, unknown>>(path, undefined, headers));
  return assertArrayField<ApiUser>(assertObjectPayload(data, null, path), 'users', null, path, isApiUser);
}

function buildQueryString(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      searchParams.set(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function getLiveNowUsers(options: { cursor?: string | null; limit?: number; force?: boolean } = {}): Promise<LiveNowResponse> {
  const path = `/watch/live-now${buildQueryString({ cursor: options.cursor, limit: options.limit })}`;
  const data = await runReadSingleFlight(path, (headers) => request<Record<string, unknown>>(path, undefined, headers), options.force);
  const payload = assertObjectPayload(data, null, path);
  const pageInfo = assertObjectPayload(payload.pageInfo, null, path) as LiveNowResponse['pageInfo'];

  return {
    users: assertArrayField<ApiUser>(payload, 'users', null, path, isApiUser),
    pageInfo: {
      hasMore: pageInfo.hasMore === true,
      nextCursor: typeof pageInfo.nextCursor === 'string' ? pageInfo.nextCursor : null,
    },
  };
}

export async function getWatchDiscoveryUsers(
  options: { cursor?: string | null; limit?: number; force?: boolean } = {},
): Promise<WatchDiscoveryResponse> {
  const path = `/discovery/watch${buildQueryString({ cursor: options.cursor, limit: options.limit })}`;
  const data = await runReadSingleFlight(path, (headers) => request<Record<string, unknown>>(path, undefined, headers), options.force);
  const payload = assertObjectPayload(data, null, path);
  const pageInfo = assertObjectPayload(payload.pageInfo, null, path) as WatchDiscoveryResponse['pageInfo'];

  return {
    users: assertArrayField<ApiUser>(payload, 'users', null, path, isApiUser),
    pageInfo: {
      hasMore: pageInfo.hasMore === true,
      nextCursor: typeof pageInfo.nextCursor === 'string' ? pageInfo.nextCursor : null,
    },
  };
}

export async function getCompatibilityDiscoveryEntries(
  options: { cursor?: string | null; limit?: number; force?: boolean } = {},
): Promise<CompatibilityDiscoveryResponse> {
  const path = `/discovery/compatibility${buildQueryString({ cursor: options.cursor, limit: options.limit })}`;
  const data = await runReadSingleFlight(path, (headers) => request<Record<string, unknown>>(path, undefined, headers), options.force);
  const payload = assertObjectPayload(data, null, path);
  const pageInfo = assertObjectPayload(payload.pageInfo, null, path) as CompatibilityDiscoveryResponse['pageInfo'];

  return {
    entries: assertArrayField<CompatibilityDiscoveryEntry>(
      payload,
      'entries',
      null,
      path,
      isCompatibilityDiscoveryEntry,
    ),
    pageInfo: {
      hasMore: pageInfo.hasMore === true,
      nextCursor: typeof pageInfo.nextCursor === 'string' ? pageInfo.nextCursor : null,
    },
  };
}

export async function getLikesDiscovery(force = false): Promise<LikesDiscoveryResponse> {
  const path = '/discovery/likes';
  const data = await runReadSingleFlight(path, (headers) => request<Record<string, unknown>>(path, undefined, headers), force);
  const payload = assertObjectPayload(data, null, path);
  const likedByUsers = assertArrayField<ApiUser>(payload, 'likedByUsers', null, path, isApiUser);
  const rawLikedByUserIds = Array.isArray(payload.likedByUserIds) ? payload.likedByUserIds : [];
  const likedByUserIds = rawLikedByUserIds.filter((item): item is string => typeof item === 'string');
  const likedByCount = typeof payload.likedByCount === 'number'
    ? payload.likedByCount
    : Math.max(likedByUsers.length, likedByUserIds.length);

  return {
    likedUsers: assertArrayField<ApiUser>(payload, 'likedUsers', null, path, isApiUser),
    likedByUsers,
    likedByUserIds: likedByUserIds.length > 0 ? likedByUserIds : likedByUsers.map((user) => user.id),
    likedByCount,
    likedByLocked: payload.likedByLocked === true,
  };
}

export async function likeUser(
  userId: string,
  source: MatchSourceType = 'like',
): Promise<LikeUserResult> {
  try {
    if (isWithinCooldown(`like:${userId}:${source}`, 90)) {
      return { matched: false, success: false };
    }

    const data = await runSingleFlight(`like:${userId}:${source}`, () =>
      request<{ matched?: boolean; rewardLikes?: number; quota?: SwipeQuotaState; matchedUser?: ApiUser | null }>(`/likes/${userId}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey(`like:${userId}:${source}`) },
        body: JSON.stringify({ source }),
      }),
    );

    return {
      matched: Boolean(data.matched),
      success: true,
      rewardLikes: data.rewardLikes,
      quota: data.quota,
      matchedUser: data.matchedUser ?? null,
    };
  } catch (error) {
    console.warn('Like user error:', error);
    return {
      matched: false,
      success: false,
      errorMessage: normalizeApiErrorMessage(error, 'Beğeni işlemi şu anda tamamlanamadı. Lütfen tekrar dene.'),
    };
  }
}

export async function unlikeUser(
  userId: string,
): Promise<{ success: boolean; blockedByActiveMatch?: boolean; errorMessage?: string }> {
  try {
    if (isWithinCooldown(`unlike:${userId}`, 90)) {
      return { success: false };
    }

    await runSingleFlight(`unlike:${userId}`, () =>
      request(`/likes/${userId}`, {
        method: 'DELETE',
      }),
    );

    return { success: true };
  } catch (error) {
    console.warn('Unlike user error:', error);
    const errorMessage = normalizeApiErrorMessage(error, 'Beğeni geri alınamadı.');
    const blockedByActiveMatch =
      error instanceof ApiRequestError &&
      error.status === 409 &&
      errorMessage.toLocaleLowerCase('tr-TR').includes('geri alma ile bozulamaz');

    return {
      success: false,
      blockedByActiveMatch,
      errorMessage: blockedByActiveMatch ? undefined : errorMessage,
    };
  }
}

export async function undoLikeUser(
  userId: string,
): Promise<{ success: boolean; quota?: SwipeQuotaState; blockedByActiveMatch?: boolean; errorMessage?: string }> {
  try {
    const data = await runSingleFlight(`undo-like:${userId}`, () =>
      request<{ success?: boolean; quota?: SwipeQuotaState }>(`/likes/${userId}/undo`, {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey(`undo-like:${userId}`) },
      }),
    );

    return { success: data.success === true, quota: data.quota };
  } catch (error) {
    console.warn('Undo like error:', error);
    const errorMessage = normalizeApiErrorMessage(error, 'Beğeni geri alınamadı.');
    const blockedByActiveMatch =
      error instanceof ApiRequestError &&
      error.status === 409 &&
      errorMessage.toLocaleLowerCase('tr-TR').includes('geri alma ile bozulamaz');

    return {
      success: false,
      blockedByActiveMatch,
      errorMessage: blockedByActiveMatch ? undefined : errorMessage,
    };
  }
}

export async function getLikes(): Promise<{ liked: string[]; likedBy: string[] }> {
  const path = '/likes';
  const data = await runReadSingleFlight(path, (headers) => request<Record<string, unknown>>(path, undefined, headers));
  const payload = assertObjectPayload(data, null, path);

  return {
    liked: assertArrayField<string>(payload, 'liked', null, path),
    likedBy: assertArrayField<string>(payload, 'likedBy', null, path),
  };
}

export async function rejectIncomingLike(userId: string): Promise<boolean> {
  try {
    if (isWithinCooldown(`reject-like:${userId}`, 90)) {
      return false;
    }

    await runSingleFlight(`reject-like:${userId}`, () =>
      request(`/likes/incoming/${userId}`, {
        method: 'DELETE',
      }),
    );

    return true;
  } catch (error) {
    console.error('Reject incoming like error:', error);
    return false;
  }
}

export async function restoreIncomingLike(userId: string): Promise<boolean> {
  try {
    if (isWithinCooldown(`restore-like:${userId}`, 90)) {
      return false;
    }

    await runSingleFlight(`restore-like:${userId}`, () =>
      request(`/likes/incoming/${userId}/restore`, {
        method: 'PUT',
      }),
    );

    return true;
  } catch (error) {
    console.error('Restore incoming like error:', error);
    return false;
  }
}

export async function getMatches(): Promise<ApiMatch[]> {
  const path = '/matches';
  const data = await runReadSingleFlight(path, (headers) => request<Record<string, unknown>>(path, undefined, headers));
  return assertArrayField<ApiMatch>(assertObjectPayload(data, null, path), 'matches', null, path, isApiMatch);
}

export async function updateMatchStatus(
  user1Id: string,
  user2Id: string,
  action: 'end' | 'block' | 'unblock',
): Promise<boolean> {
  try {
    await runSingleFlight(`match-status:${user1Id}:${user2Id}:${action}`, () =>
      request('/matches/status', {
        method: 'PUT',
        body: JSON.stringify({ user1Id, user2Id, action }),
      }),
    );

    return true;
  } catch (error) {
    console.error('Update match status error:', error);
    return false;
  }
}

export async function endChat(user1Id: string, user2Id: string): Promise<void> {
  const success = await updateMatchStatus(user1Id, user2Id, 'end');

  if (!success) {
    throw new Error('Sohbet sonlandırılamadı.');
  }
}

export async function getChatThread(
  userId: string,
  options?: { before?: string; cursor?: string; limit?: number },
): Promise<ApiChatThread | null> {
  const params = new URLSearchParams();

  if (options?.cursor) {
    params.set('cursor', options.cursor);
  }

  if (options?.before) {
    params.set('before', options.before);
  }

  if (options?.limit) {
    params.set('limit', String(options.limit));
  }

  const suffix = params.toString() ? `?${params}` : '';
  const path = `/messages/${userId}${suffix}`;
  const thread = await runReadSingleFlight(path, (headers) => request<unknown>(path, undefined, headers));
  return thread ? normalizeChatThread(assertValidatedPayload(thread, isApiChatThread, null, path)) : null;
}

export async function sendMessage(userId: string, text: string, clientMessageId?: string): Promise<ApiMessage> {
  const path = `/messages/${userId}`;
  const data = await request<Record<string, unknown>>(path, {
    method: 'POST',
    headers: clientMessageId ? { 'Idempotency-Key': `message:${clientMessageId}` } : undefined,
    body: JSON.stringify({ text: text.trim(), clientMessageId }),
  });

  invalidateReadCache(['/chats', `/messages/${userId}`]);
  return assertValidatedPayload(data.message, isApiMessage, null, path);
}

export async function markMessageRead(messageId: string): Promise<void> {
  try {
    await request(`/messages/${messageId}/read`, {
      method: 'PUT',
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return;
    }

    console.error('Mark message read error:', error);
  }
}

export async function markChatThreadRead(userId: string): Promise<void> {
  try {
    await runSingleFlight(`mark-thread-read:${userId}`, () =>
      request(`/messages/thread/${userId}/read`, {
        method: 'PUT',
      }),
    );
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return;
    }

    console.error('Mark chat thread read error:', error);
  }
}

export async function getChats(
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ChatListResponse> {
  const path = `/chats${buildQueryString({ cursor: options.cursor, limit: options.limit })}`;
  const data = await runReadSingleFlight(path, (headers) => request<Record<string, unknown>>(path, undefined, headers));
  const payload = assertObjectPayload(data, null, path);
  const chats = assertArrayField<ApiChat | (Omit<ApiChat, 'user'> & { user: ApiUser | null })>(
    payload,
    'chats',
    null,
    path,
  );

  const pageInfo = payload.pageInfo == null
    ? { hasMore: false, nextCursor: null }
    : assertObjectPayload(payload.pageInfo, null, path);

  return {
    chats: chats.map((chat) => {
      const normalized = normalizeChat({
        ...chat,
        user: chat.user ?? buildFallbackApiUser(chat.userId),
      });
      return assertValidatedPayload(normalized, isApiChat, null, path);
    }),
    pageInfo: {
      hasMore: pageInfo.hasMore === true,
      nextCursor: typeof pageInfo.nextCursor === 'string' ? pageInfo.nextCursor : null,
    },
  };
}

export async function hideChat(userId: string): Promise<void> {
  await runSingleFlight(`hide-chat:${userId}`, () =>
    request(`/chats/${userId}/hide`, {
      method: 'POST',
    }),
  );
}

export async function deleteChat(userId: string, mode: 'end' | 'block'): Promise<void> {
  await runSingleFlight(`delete-chat:${userId}:${mode}`, () =>
    request(`/chats/${userId}/delete`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  );
}

export async function updateChatSettings(userId: string, settings: ChatSettings): Promise<ChatSettings> {
  const data = await runSingleFlight(`chat-settings:${userId}`, () =>
    request<{ settings: ChatSettings }>(`/chats/${userId}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    }),
  );

  return data.settings;
}

export async function blockUser(userId: string): Promise<void> {
  await runSingleFlight(`block-user:${userId}`, () =>
    request(`/blocks/${userId}`, {
      method: 'POST',
    }),
  );
}

export async function unblockUser(userId: string): Promise<void> {
  await runSingleFlight(`unblock-user:${userId}`, () =>
    request(`/blocks/${userId}`, {
      method: 'DELETE',
    }),
  );
}

export async function getBlockedUsers(): Promise<ApiUser[]> {
  const path = '/blocks';
  const data = await request<Record<string, unknown>>(path);
  return assertArrayField<ApiUser>(assertObjectPayload(data, null, path), 'users', null, path, isApiUser);
}

export async function markNotificationEventRead(eventId: string): Promise<void> {
  try {
    await request(`/notifications/events/${eventId}/read`, {
      method: 'PUT',
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return;
    }

    console.error('Mark notification event read error:', error);
  }
}

export async function registerPushToken(token: string, platform: string): Promise<void> {
  await runSingleFlight(`push-token:${token}`, () =>
    request('/notifications/push-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform }),
    }),
  );
}

export async function unregisterPushToken(token?: string): Promise<void> {
  await runSingleFlight(`push-token-delete:${token ?? 'all'}`, () =>
    request('/notifications/push-token', {
      method: 'DELETE',
      body: JSON.stringify(token ? { token } : {}),
    }),
  );
}

export async function submitUserReport(payload: SubmitUserReportPayload): Promise<void> {
  await runSingleFlight(`report:${payload.targetUserId}:${payload.reasonCode}`, () =>
    request('/reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );
}

export function getBlockStatusForCurrentUser(status: MatchStatus, currentUserId: string, user1Id: string, user2Id: string) {
  const blockedByMe =
    (status === 'blocked_by_user1' && user1Id === currentUserId) ||
    (status === 'blocked_by_user2' && user2Id === currentUserId);

  const blockedByOther =
    (status === 'blocked_by_user1' && user1Id !== currentUserId) ||
    (status === 'blocked_by_user2' && user2Id !== currentUserId);

  return {
    blockedByMe,
    blockedByOther,
    isBlocked: blockedByMe || blockedByOther,
  };
}

export async function getSwipeQuota(): Promise<SwipeQuotaState> {
  return runReadSingleFlight('/swipe-quota', (headers) => request<SwipeQuotaState>('/swipe-quota', undefined, headers));
}

export async function consumeSwipeQuota(kind: SwipeQuotaKind): Promise<SwipeQuotaState> {
  const quota = await request<SwipeQuotaState>('/swipe-quota/consume', {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });

  invalidateReadCache(['/swipe-quota']);
  return quota;
}
