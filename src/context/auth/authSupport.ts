import * as SecureStore from 'expo-secure-store';
import type { EmailOtpType } from '@supabase/supabase-js';

import { PUBLIC_WEB_BASE_URL } from '../../shared/config/publicWeb';
import type { AppUser } from '../../shared/types';
import { isAppUser } from '../../shared/utils/apiValidation';

export type ProfilePayload = Omit<AppUser, 'email' | 'emailVerified'>;
export type ProfileLoadResult =
  | { status: 'ok'; profile: ProfilePayload }
  | { status: 'missing' }
  | { status: 'unavailable'; error: unknown };

const AUTH_PROFILE_CACHE_PREFIX = 'wmatch.auth-profile.v1.';
const AUTH_FLOW_STATE_PREFIX = 'wmatch.auth-flow-state.v1.';
const AUTH_FLOW_STATE_TTL_MS = 24 * 60 * 60 * 1000;
export type AuthFlowKind = 'signup' | 'recovery';

function createAuthFlowStateValue() {
  const bytes = new Uint8Array(32);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const getAuthFlowStateKey = (kind: AuthFlowKind) => `${AUTH_FLOW_STATE_PREFIX}${kind}`;

export async function beginAuthFlow(kind: AuthFlowKind) {
  const state = createAuthFlowStateValue();
  await SecureStore.setItemAsync(
    getAuthFlowStateKey(kind),
    JSON.stringify({ state, expiresAt: Date.now() + AUTH_FLOW_STATE_TTL_MS }),
    { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
  );
  return state;
}

export async function validateAuthFlowState(kind: AuthFlowKind, state: string | null) {
  if (!state || !/^[a-f0-9]{64}$/.test(state)) {
    return false;
  }

  try {
    const rawValue = await SecureStore.getItemAsync(getAuthFlowStateKey(kind));
    const stored = rawValue ? JSON.parse(rawValue) as { state?: unknown; expiresAt?: unknown } : null;
    return stored?.state === state
      && typeof stored.expiresAt === 'number'
      && stored.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export async function clearAuthFlowState(kind: AuthFlowKind) {
  await SecureStore.deleteItemAsync(getAuthFlowStateKey(kind)).catch(() => undefined);
}

export function createMutationKey(scope: string) {
  return `wmatch:${scope}:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
}

const getCachedProfileKey = (userId: string) => `${AUTH_PROFILE_CACHE_PREFIX}${userId}`;

export function preserveEqualUser(current: AppUser | null, next: AppUser | null) {
  if (current === next) {
    return current;
  }

  return JSON.stringify(current) === JSON.stringify(next) ? current : next;
}

export async function readCachedProfile(userId: string): Promise<AppUser | null> {
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return null;
    }

    const rawValue = await SecureStore.getItemAsync(getCachedProfileKey(userId));
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as { updatedAt?: unknown; user?: unknown };
    const updatedAt = Number(parsed.updatedAt);
    const cachedUser = parsed.user;
    if (
      !Number.isFinite(updatedAt)
      || !isAppUser(cachedUser)
      || cachedUser.id !== userId
    ) {
      await SecureStore.deleteItemAsync(getCachedProfileKey(userId));
      return null;
    }

    return cachedUser;
  } catch (error) {
    console.warn('Cached auth profile could not be read:', error);
    return null;
  }
}

export async function writeCachedProfile(user: AppUser) {
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return;
    }

    await SecureStore.setItemAsync(
      getCachedProfileKey(user.id),
      JSON.stringify({ updatedAt: Date.now(), user }),
      { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
    );
  } catch (error) {
    console.warn('Auth profile cache could not be persisted:', error);
  }
}

export async function deleteCachedProfile(userId: string | null | undefined) {
  if (userId) {
    await SecureStore.deleteItemAsync(getCachedProfileKey(userId)).catch(() => undefined);
  }
}

export function isRemoteProfilePhotoUri(photo: string) {
  return /^https:\/\//i.test(photo.trim());
}

export function normalizeProfilePayload(profile: ProfilePayload): ProfilePayload {
  const normalizeMedia = (value: unknown, legacyIds: number[]) =>
    Array.isArray(value)
      ? value
          .filter((item): item is { id: number; mediaType: 'movie' | 'tv' } => Boolean(
            item
            && typeof item === 'object'
            && Number.isInteger((item as { id?: unknown }).id)
            && ((item as { mediaType?: unknown }).mediaType === 'movie'
              || (item as { mediaType?: unknown }).mediaType === 'tv'),
          ))
          .map((item) => ({ id: item.id, mediaType: item.mediaType }))
      : legacyIds
          .filter((id) => Number.isInteger(id) && id > 0)
          .map((id) => ({ id, mediaType: 'movie' as const }));

  return {
    ...profile,
    favoriteMedia: normalizeMedia(profile.favoriteMedia, profile.favoriteMovies ?? []),
    watchedMedia: normalizeMedia(profile.watchedMedia, profile.watchedMovies ?? []),
    currentlyWatchingMediaType:
      profile.currentlyWatchingMediaType === 'tv' || profile.currentlyWatchingMediaType === 'movie'
        ? profile.currentlyWatchingMediaType
        : null,
    currentlyWatchingState:
      profile.currentlyWatchingState === 'active' || profile.currentlyWatchingState === 'paused'
        ? profile.currentlyWatchingState
        : null,
    currentlyWatchingRemainingMs:
      typeof profile.currentlyWatchingRemainingMs === 'number' && Number.isFinite(profile.currentlyWatchingRemainingMs)
        ? Math.max(0, profile.currentlyWatchingRemainingMs)
        : null,
    currentlyWatchingExpiresAt:
      typeof profile.currentlyWatchingExpiresAt === 'string' ? profile.currentlyWatchingExpiresAt : null,
    currentlyWatchingVersion:
      typeof profile.currentlyWatchingVersion === 'number' && Number.isFinite(profile.currentlyWatchingVersion)
        ? Math.max(1, Math.floor(profile.currentlyWatchingVersion))
        : null,
  };
}

export function parseDeepLinkParams(url: string) {
  const [, hash = ''] = url.split('#');
  const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const params = new URLSearchParams([query, hash].filter(Boolean).join('&'));

  return {
    code: params.get('code'),
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type'),
    tokenHash: params.get('token_hash'),
    state: params.get('state'),
    error: params.get('error'),
    errorCode: params.get('error_code'),
    errorDescription: params.get('error_description'),
  };
}

export function normalizeOtpType(value: string | null): EmailOtpType | null {
  if (
    value === 'signup'
    || value === 'invite'
    || value === 'magiclink'
    || value === 'recovery'
    || value === 'email_change'
    || value === 'email'
  ) {
    return value;
  }

  return null;
}

export function getTrustedAuthDeepLinkKind(url: string): 'verify' | 'recovery' | null {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'https:') {
      const publicBaseUrl = new URL(PUBLIC_WEB_BASE_URL);
      const publicBasePath = publicBaseUrl.pathname.replace(/\/$/, '');

      if (parsedUrl.origin !== publicBaseUrl.origin) {
        return null;
      }

      const normalizedPath = parsedUrl.pathname.replace(/\/$/, '');
      if (normalizedPath === `${publicBasePath}/auth/verify`) {
        return 'verify';
      }

      if (normalizedPath === `${publicBasePath}/auth/reset-password`) {
        return 'recovery';
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function isTrustedAuthDeepLink(url: string) {
  return getTrustedAuthDeepLinkKind(url) !== null;
}

export async function parseErrorMessage(response: Response, fallback: string) {
  try {
    const rawPayload = await response.text();
    const payload = rawPayload ? JSON.parse(rawPayload) : null;
    const extract = (value: unknown): string | null => {
      if (typeof value === 'string') return value.trim() || null;
      if (Array.isArray(value)) {
        for (const item of value) {
          const nested = extract(item);
          if (nested) return nested;
        }
        return null;
      }
      if (!value || typeof value !== 'object') return null;
      const record = value as Record<string, unknown>;
      for (const key of ['error', 'message', 'details', 'hint']) {
        const nested = extract(record[key]);
        if (nested) return nested;
      }
      return null;
    };

    return extract(payload) ?? (rawPayload.trim() || fallback);
  } catch {
    return fallback;
  }
}

export async function parseAvailabilityError(response: Response) {
  if (response.status === 404 || response.status === 503) {
    return 'Uygunluk kontrolü geçici olarak kullanılamıyor. Lütfen biraz sonra tekrar dene.';
  }
  if (response.status === 401 || response.status === 403) {
    return 'Oturum doğrulanamadı. Lütfen yeniden giriş yapıp tekrar dene.';
  }
  return parseErrorMessage(response, 'Uygunluk kontrolü yapılamadı.');
}

export function normalizeAuthErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.toLowerCase();
  if (/email not (confirmed|verified)|confirm your email/.test(message)) {
    return 'E-postanı doğrulamadan giriş yapamazsın. Lütfen mail kutundaki onay bağlantısına tıkla.';
  }
  if (message.includes('invalid login credentials')) return 'E-posta veya şifre hatalı.';
  if (message.includes('user already registered')) {
    return 'Kayıt işlemi tamamlanamadı. Bilgileri kontrol edip tekrar dene.';
  }
  return error.message || fallback;
}
