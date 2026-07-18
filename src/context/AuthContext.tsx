import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import type { EmailOtpType, Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { API_BASE, fetchWithRetry, getAuthHeaders, supabase } from '../../utils/supabase/client';
import { publicAnonKey } from '../../utils/supabase/info';
import {
  cleanupManagedProfilePhotos,
  cleanupRemovedProfilePhotos,
  hasLocalProfilePhotos,
  persistProfilePhotos,
} from '../services/storage';
import {
  PUBLIC_WEB_BASE_URL,
  getEmailVerificationRedirectUrl,
  getPasswordResetRedirectUrl,
} from '../shared/config/publicWeb';
import { clearPushNotifications, resetPushNotificationSyncState } from '../services/notifications';
import { purgeChatOutbox } from '../services/chatOutbox';
import { clearSignupDraft, readSignupDraft } from '../services/signupDraft';
import { telemetry } from '../services/telemetry';
import type { AppUser, ProfileUpdateInput, SignUpData } from '../shared/types';
import { syncServerTimeFromHeaders } from '../shared/utils/serverTime';
import { validatePassword } from '../shared/utils/validation';
import { clearSessionCaches, purgeUserSessionStorage } from '../shared/utils/sessionCache';

interface AvailabilityPayload {
  email?: string;
  username?: string;
  currentUserId?: string;
}

interface AvailabilityResult {
  emailAvailable: boolean;
  usernameAvailable: boolean;
  normalizedUsername?: string;
  emailMessage?: string;
  usernameMessage?: string;
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  isRecoveringPassword: boolean;
  pendingVerificationEmail: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (userData: SignUpData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  checkAvailability: (payload: AvailabilityPayload) => Promise<AvailabilityResult>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendVerificationEmail: (email: string) => Promise<void>;
  updateProfile: (data: ProfileUpdateInput) => Promise<void>;
  deleteAccount: () => Promise<void>;
  completePasswordRecovery: (newPassword: string) => Promise<void>;
  cancelPasswordRecovery: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type ProfilePayload = Omit<AppUser, 'email' | 'emailVerified'>;
type ProfileLoadResult =
  | { status: 'ok'; profile: ProfilePayload }
  | { status: 'missing' }
  | { status: 'unavailable'; error: unknown };
const AUTH_PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_PROFILE_CACHE_PREFIX = 'wmatch.auth-profile.v1.';
const TRUSTED_CUSTOM_AUTH_SCHEMES = new Set(['wmatch:']);
const TRUSTED_AUTH_PATH_PREFIXES = [
  '/auth/verify',
  '/auth/reset-password',
  '/auth/recovery',
  '/auth/callback',
  '/verify',
  '/reset-password',
];

function createMutationKey(scope: string) {
  return `wmatch:${scope}:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
}

function getCachedProfileKey(userId: string) {
  return `${AUTH_PROFILE_CACHE_PREFIX}${userId}`;
}

async function readCachedProfile(userId: string): Promise<AppUser | null> {
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
      !Number.isFinite(updatedAt) ||
      Date.now() - updatedAt > AUTH_PROFILE_CACHE_TTL_MS ||
      !cachedUser ||
      typeof cachedUser !== 'object' ||
      (cachedUser as { id?: unknown }).id !== userId
    ) {
      await SecureStore.deleteItemAsync(getCachedProfileKey(userId));
      return null;
    }

    return cachedUser as AppUser;
  } catch (error) {
    console.warn('Cached auth profile could not be read:', error);
    return null;
  }
}

async function writeCachedProfile(user: AppUser) {
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

async function deleteCachedProfile(userId: string | null | undefined) {
  if (!userId) {
    return;
  }

  await SecureStore.deleteItemAsync(getCachedProfileKey(userId)).catch(() => undefined);
}

function isRemoteProfilePhotoUri(photo: string) {
  return /^https:\/\//i.test(photo.trim());
}

function normalizeProfilePayload(profile: ProfilePayload): ProfilePayload {
  const normalizeMedia = (value: unknown, legacyIds: number[]) =>
    Array.isArray(value)
      ? value
          .filter((item): item is { id: number; mediaType: 'movie' | 'tv' } =>
            Boolean(
              item &&
                typeof item === 'object' &&
                Number.isInteger((item as { id?: unknown }).id) &&
                ((item as { mediaType?: unknown }).mediaType === 'movie' ||
                  (item as { mediaType?: unknown }).mediaType === 'tv'),
            ),
          )
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

function parseDeepLinkParams(url: string) {
  const [, hash = ''] = url.split('#');
  const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const params = new URLSearchParams([query, hash].filter(Boolean).join('&'));

  return {
    code: params.get('code'),
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type'),
    tokenHash: params.get('token_hash'),
    error: params.get('error'),
    errorCode: params.get('error_code'),
    errorDescription: params.get('error_description'),
  };
}

function normalizeOtpType(value: string | null): EmailOtpType | null {
  if (!value) {
    return null;
  }

  if (
    value === 'signup' ||
    value === 'invite' ||
    value === 'magiclink' ||
    value === 'recovery' ||
    value === 'email_change' ||
    value === 'email'
  ) {
    return value;
  }

  return null;
}

function isTrustedAuthDeepLink(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (TRUSTED_CUSTOM_AUTH_SCHEMES.has(parsedUrl.protocol)) {
      const normalizedPath = parsedUrl.pathname || (parsedUrl.hostname ? `/${parsedUrl.hostname}` : '');

      return (
        parsedUrl.hostname === 'auth' ||
        TRUSTED_AUTH_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
      );
    }

    if (parsedUrl.protocol === 'https:') {
      const publicBaseUrl = new URL(PUBLIC_WEB_BASE_URL);
      const publicBasePath = publicBaseUrl.pathname.replace(/\/$/, '');
      const expectedAuthPrefix = `${publicBasePath}/auth/`;

      return parsedUrl.origin === publicBaseUrl.origin && parsedUrl.pathname.startsWith(expectedAuthPrefix);
    }
  } catch {
    return false;
  }

  return false;
}

async function parseErrorMessage(response: Response, fallback: string) {
  try {
    const rawPayload = await response.text();
    const payload = rawPayload ? JSON.parse(rawPayload) : null;

    const extractErrorMessage = (value: unknown): string | null => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          const nestedMessage = extractErrorMessage(item);

          if (nestedMessage) {
            return nestedMessage;
          }
        }

        return null;
      }

      if (!value || typeof value !== 'object') {
        return null;
      }

      const record = value as Record<string, unknown>;

      for (const key of ['error', 'message', 'details', 'hint']) {
        const nestedMessage = extractErrorMessage(record[key]);

        if (nestedMessage) {
          return nestedMessage;
        }
      }

      return null;
    };

    return extractErrorMessage(payload) ?? (rawPayload.trim().length > 0 ? rawPayload.trim() : fallback);
  } catch {
    return fallback;
  }
}

async function parseAvailabilityError(response: Response) {
  if (response.status === 404) {
    return 'Benzersizlik kontrol servisi bulunamadı. Edge Function deploy edilmemiş olabilir.';
  }

  if (response.status === 401 || response.status === 403) {
    return 'Benzersizlik kontrolü için yetki alınamadı. Supabase ayarlarını kontrol et.';
  }

  if (response.status === 503) {
    return 'Benzersizlik kontrol servisi hazır değil. Migration ve function kurulumunu tamamla.';
  }

  return parseErrorMessage(response, 'Uygunluk kontrolü yapılamadı.');
}

function normalizeAuthErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.toLowerCase();

  if (
    message.includes('email not confirmed') ||
    message.includes('email not verified') ||
    message.includes('confirm your email')
  ) {
    return 'E-postanı doğrulamadan giriş yapamazsın. Lütfen mail kutundaki onay bağlantısına tıkla.';
  }

  if (message.includes('invalid login credentials')) {
    return 'E-posta veya şifre hatalı.';
  }

  if (message.includes('user already registered')) {
    return 'Kayıt işlemi tamamlanamadı. Bilgileri kontrol edip tekrar dene.';
  }

  return error.message || fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const sessionSyncRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);
  const sessionSyncGenerationRef = useRef(0);
  const lastSessionUserIdRef = useRef<string | null>(null);
  const lastForegroundRefreshAtRef = useRef(0);

  const loadUserProfile = async (userId: string): Promise<ProfileLoadResult> => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetchWithRetry(`${API_BASE}/profile/${userId}`, { headers });
      syncServerTimeFromHeaders(response.headers);

      if (!response.ok) {
        if (response.status === 404) {
          return { status: 'missing' };
        }

        return {
          status: 'unavailable',
          error: new Error(`Profile request failed with status ${response.status}`),
        };
      }

      const profile = (await response.json()) as ProfilePayload;
      return { status: 'ok', profile: normalizeProfilePayload(profile) };
    } catch (error) {
      console.error('Failed to load user profile:', error);
      return { status: 'unavailable', error };
    }
  };

  const applyProfileUpdateRequest = async (data: ProfileUpdateInput): Promise<ProfilePayload | null> => {
    const headers = await getAuthHeaders();
    const response = await fetchWithRetry(`${API_BASE}/profile`, {
      method: 'PUT',
      headers: {
        ...headers,
        'Idempotency-Key': createMutationKey('profile-update'),
      },
      body: JSON.stringify(data),
    });
    syncServerTimeFromHeaders(response.headers);

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response, 'Profil güncellenemedi.'));
    }

    const payload = (await response.json()) as { profile?: ProfilePayload };
    return payload.profile ? normalizeProfilePayload(payload.profile) : null;
  };

  const ensureStoredProfilePhotos = async (userId: string, profile: ProfilePayload) => {
    if (!hasLocalProfilePhotos(profile.photos)) {
      return profile;
    }

    try {
      const uploadedPhotos = await persistProfilePhotos({
        userId,
        photos: profile.photos,
        previousPhotos: profile.photos,
        cleanupRemoved: false,
      });
      const newlyUploadedPhotos = uploadedPhotos.filter((photo) => !profile.photos.includes(photo));

      try {
        const updatedProfile = await applyProfileUpdateRequest({ photos: uploadedPhotos });
        await cleanupRemovedProfilePhotos(profile.photos, updatedProfile?.photos ?? uploadedPhotos);
        return updatedProfile ?? { ...profile, photos: uploadedPhotos };
      } catch (error) {
        await cleanupManagedProfilePhotos(newlyUploadedPhotos);
        throw error;
      }

    } catch (error) {
      console.warn('Failed to migrate local profile photos:', error);
      return profile;
    }
  };

  const finalizeSignupDraftPhotos = async (
    userId: string,
    email: string,
    profile: ProfilePayload,
  ): Promise<ProfilePayload> => {
    if (profile.photos.some(isRemoteProfilePhotoUri)) {
      await clearSignupDraft();
      return profile;
    }

    try {
      const draft = await readSignupDraft();
      if (!draft) {
        return profile;
      }

      const draftEmail = typeof draft.email === 'string' ? draft.email.trim().toLowerCase() : '';
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail || draftEmail !== normalizedEmail || !Array.isArray(draft.photos)) {
        return profile;
      }

      const draftPhotos = draft.photos
        .filter((photo): photo is string => typeof photo === 'string' && photo.trim().length > 0);

      if (draftPhotos.length === 0) {
        return profile;
      }

      const uploadedPhotos = await persistProfilePhotos({
        userId,
        photos: draftPhotos,
        previousPhotos: profile.photos,
        cleanupRemoved: false,
      });
      const newlyUploadedPhotos = uploadedPhotos.filter((photo) => !profile.photos.includes(photo));

      try {
        const updatedProfile = await applyProfileUpdateRequest({ photos: uploadedPhotos });
        await clearSignupDraft();
        return updatedProfile ?? { ...profile, photos: uploadedPhotos };
      } catch (error) {
        await cleanupManagedProfilePhotos(newlyUploadedPhotos);
        throw error;
      }
    } catch (error) {
      console.warn('Signup draft photos could not be finalized:', error);
      return profile;
    }
  };

  const runSessionUserSync = async (session: Session | null, generation: number) => {
    if (!session?.user) {
      if (generation !== sessionSyncGenerationRef.current) {
        return;
      }

      telemetry.setUser(null);
      clearSessionCaches();
      const signedOutUserId = lastSessionUserIdRef.current;
      void purgeUserSessionStorage(signedOutUserId);
      void purgeChatOutbox(signedOutUserId);
      void deleteCachedProfile(signedOutUserId);
      void clearSignupDraft();
      lastSessionUserIdRef.current = null;
      setUser(null);
      return;
    }

    lastSessionUserIdRef.current = session.user.id;

    // Restore the last verified profile and refresh it in parallel. A valid local
    // Supabase session is still required, so cached profile data never authenticates
    // a signed-out user. This keeps an offline/cold start off the network critical path.
    const cachedProfilePromise = readCachedProfile(session.user.id);
    const profileRequest = loadUserProfile(session.user.id);
    const cachedUser = await cachedProfilePromise;

    if (generation !== sessionSyncGenerationRef.current) {
      return;
    }

    if (cachedUser) {
      setUser({
        ...cachedUser,
        id: session.user.id,
        email: session.user.email ?? cachedUser.email,
        emailVerified: session.user.email_confirmed_at != null,
      });
      telemetry.setUser(`user:${session.user.id.slice(0, 8)}`);
      setLoading(false);
    }

    const profileResult = await profileRequest;

    if (generation !== sessionSyncGenerationRef.current) {
      return;
    }

    if (profileResult.status === 'unavailable') {
      telemetry.captureException(profileResult.error, {
        scope: 'auth.profile_sync',
        userId: session.user.id,
      });
      return;
    }

    if (profileResult.status === 'missing') {
      clearSessionCaches();
      void deleteCachedProfile(session.user.id);
      setUser(null);
      return;
    }

    const emailVerified = session.user.email_confirmed_at != null;
    const restoredUser: AppUser = {
      ...profileResult.profile,
      id: session.user.id,
      email: session.user.email ?? '',
      emailVerified,
    };
    setUser(restoredUser);
    void writeCachedProfile(restoredUser);
    telemetry.setUser(`user:${session.user.id.slice(0, 8)}`);
    setLoading(false);

    if (emailVerified) {
      setPendingVerificationEmail(null);
    }

    // Local-photo migration and signup-draft finalization are recoverable
    // maintenance. Keep them out of the first usable-screen critical path.
    let normalizedProfile = await ensureStoredProfilePhotos(session.user.id, profileResult.profile);

    if (generation !== sessionSyncGenerationRef.current) {
      return;
    }

    if (emailVerified) {
      normalizedProfile = await finalizeSignupDraftPhotos(
        session.user.id,
        session.user.email ?? '',
        normalizedProfile,
      );
    }

    if (generation !== sessionSyncGenerationRef.current) {
      return;
    }

    const nextUser: AppUser = {
      ...normalizedProfile,
      id: session.user.id,
      email: session.user.email ?? '',
      emailVerified,
    };
    setUser(nextUser);
    void writeCachedProfile(nextUser);
  };

  const syncSessionUser = (session: Session | null): Promise<void> => {
    const userId = session?.user.id ?? 'signed-out';
    const inFlight = sessionSyncRef.current;

    if (inFlight?.userId === userId) {
      return inFlight.promise;
    }

    const generation = sessionSyncGenerationRef.current + 1;
    sessionSyncGenerationRef.current = generation;
    const promise = runSessionUserSync(session, generation).finally(() => {
      if (sessionSyncRef.current?.promise === promise) {
        sessionSyncRef.current = null;
      }
    });
    sessionSyncRef.current = { userId, promise };
    return promise;
  };

  const refreshUser = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    await syncSessionUser(session);
  };

  const handleDeepLink = async (url: string | null) => {
    if (!url) {
      return;
    }

    const {
      code,
      accessToken,
      refreshToken,
      type,
      tokenHash,
      error,
      errorCode,
      errorDescription,
    } = parseDeepLinkParams(url);

    if (!isTrustedAuthDeepLink(url)) {
      console.warn('Ignored untrusted auth deep link.');
      return;
    }

    if (error || errorDescription) {
      console.warn('Deep link auth error:', {
        error,
        errorCode,
        errorDescription,
      });
      return;
    }

    if (accessToken || refreshToken) {
      console.warn('Ignored auth deep link containing raw session tokens.');
      return;
    }

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error('Deep link PKCE exchange error:', error);
        return;
      }

      await syncSessionUser(data.session ?? null);
    }

    const otpType = normalizeOtpType(type);

    if (!code && tokenHash && otpType) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });

      if (error) {
        console.error('Deep link OTP verification error:', error);
        return;
      }

      await syncSessionUser(data.session ?? null);
    }

    if (type === 'recovery') {
      setIsRecoveringPassword(true);
    }
  };

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const [initialUrl, initialSessionResult] = await Promise.all([
          Linking.getInitialURL(),
          supabase.auth.getSession(),
        ]);
        let session = initialSessionResult.data.session;

        if (initialUrl) {
          await handleDeepLink(initialUrl);
          const refreshedSessionResult = await supabase.auth.getSession();
          session = refreshedSessionResult.data.session;
        }

        if (mounted) {
          await syncSessionUser(session);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      void handleDeepLink(url);
    });

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }

      const now = Date.now();
      if (now - lastForegroundRefreshAtRef.current < 5 * 60 * 1000) {
        return;
      }
      lastForegroundRefreshAtRef.current = now;

      void (async () => {
        try {
          const { data } = await supabase.auth.refreshSession();
          await syncSessionUser(data.session ?? null);
        } catch (error) {
          console.warn('Session refresh on foreground failed:', error);
        }
      })();
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveringPassword(true);
      }

      if (event === 'SIGNED_OUT') {
        sessionSyncGenerationRef.current += 1;
        sessionSyncRef.current = null;
        resetPushNotificationSyncState();
        telemetry.setUser(null);
        clearSessionCaches();
        const signedOutUserId = lastSessionUserIdRef.current;
        void purgeUserSessionStorage(signedOutUserId);
        void purgeChatOutbox(signedOutUserId);
        void deleteCachedProfile(signedOutUserId);
        void clearSignupDraft();
        lastSessionUserIdRef.current = null;
        setUser(null);
        setIsRecoveringPassword(false);
        return;
      }

      void syncSessionUser(session);
    });

    return () => {
      mounted = false;
      linkSubscription.remove();
      appStateSubscription.remove();
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {

      throw new Error(normalizeAuthErrorMessage(error, 'Giriş başarısız.'));
    }

    await syncSessionUser(data.session);
  };

  const checkAvailability = async (payload: AvailabilityPayload) => {
    const normalizedPayload: AvailabilityPayload = {};

    if (payload.email?.trim()) {
      normalizedPayload.email = payload.email.trim();
    }

    if (payload.username?.trim()) {
      normalizedPayload.username = payload.username.trim();
    }

    if (payload.currentUserId?.trim()) {
      normalizedPayload.currentUserId = payload.currentUserId.trim();
    }

    try {
      const response = await fetchWithRetry(`${API_BASE}/auth/check-availability`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify(normalizedPayload),
      });
      syncServerTimeFromHeaders(response.headers);

      if (!response.ok) {
        throw new Error(await parseAvailabilityError(response));
      }

      return response.json() as Promise<AvailabilityResult>;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Benzersizlik kontrolü sırasında beklenmeyen bir hata oluştu.');
    }
  };

  const signup = async (userData: SignUpData) => {
    const passwordError = validatePassword(userData.password);

    if (passwordError) {
      throw new Error(passwordError);
    }

    const safeMetadataPhotos = userData.photos.filter(isRemoteProfilePhotoUri);

    const { error } = await supabase.auth.signUp({
      email: userData.email.trim().toLowerCase(),
      password: userData.password,
      options: {
        emailRedirectTo: getEmailVerificationRedirectUrl(),
        data: {
          name: userData.name.trim(),
          age: userData.age,
          gender: userData.gender,
          username: userData.username,
          bio: userData.bio.trim(),
          letterboxd: userData.letterboxd.trim(),
          photos: safeMetadataPhotos,
          show_age_on_profile: true,
          show_gender_on_profile: true,
        },
      },
    });

    if (error) {
      throw new Error(normalizeAuthErrorMessage(error, 'Kayıt başarısız.'));
    }

    setPendingVerificationEmail(userData.email.trim().toLowerCase());
  };

  const logout = async () => {
    const signedOutUserId = user?.id ?? lastSessionUserIdRef.current;
    await clearPushNotifications().catch(() => undefined);
    await supabase.auth.signOut();
    clearSessionCaches();
    await purgeUserSessionStorage(signedOutUserId).catch(() => undefined);
    await purgeChatOutbox(signedOutUserId).catch(() => undefined);
    await deleteCachedProfile(signedOutUserId);
    await clearSignupDraft().catch(() => undefined);
    lastSessionUserIdRef.current = null;
    setUser(null);
    telemetry.setUser(null);
    setIsRecoveringPassword(false);
    setPendingVerificationEmail(null);
  };

  const sendPasswordReset = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const response = await fetchWithRetry(`${API_BASE}/auth/password-reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publicAnonKey}`,
        'Idempotency-Key': createMutationKey('password-reset'),
      },
      body: JSON.stringify({
        email: normalizedEmail,
        redirectTo: getPasswordResetRedirectUrl(),
      }),
    });
    syncServerTimeFromHeaders(response.headers);

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response, 'Şifre sıfırlama maili gönderilemedi.'));
    }
  };
  const sendVerificationEmail = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: normalizedEmail,
      options: {
        emailRedirectTo: getEmailVerificationRedirectUrl(),
      },
    });

    if (error) {
      throw new Error(normalizeAuthErrorMessage(error, 'Doğrulama maili gönderilemedi.'));
    }

    setPendingVerificationEmail(normalizedEmail);
  };

  const updateProfile = async (data: ProfileUpdateInput) => {
    if (!user) {
      return;
    }

    const payload: ProfileUpdateInput = { ...data };
    const previousPhotos = user.photos;
    let uploadedPhotosForRollback: string[] = [];

    if (Array.isArray(payload.photos)) {
      payload.photos = await persistProfilePhotos({
        userId: user.id,
        photos: payload.photos,
        previousPhotos,
        cleanupRemoved: false,
      });
      uploadedPhotosForRollback = payload.photos.filter((photo) => !previousPhotos.includes(photo));
    }

    try {
      const profile = await applyProfileUpdateRequest(payload);

      if (Array.isArray(payload.photos)) {
        await cleanupRemovedProfilePhotos(previousPhotos, profile?.photos ?? payload.photos);
      }

      if (profile && lastSessionUserIdRef.current === user.id) {
        const nextUser = { ...user, ...profile };
        setUser((current) => current?.id === user.id ? nextUser : current);
        void writeCachedProfile(nextUser);
      }
    } catch (error) {
      if (uploadedPhotosForRollback.length > 0) {
        await cleanupManagedProfilePhotos(uploadedPhotosForRollback);
      }

      throw error;
    }
  };

  const deleteAccount = async () => {
    const deletedUserId = user?.id ?? lastSessionUserIdRef.current;
    const headers = await getAuthHeaders();
    const response = await fetchWithRetry(`${API_BASE}/account`, {
      method: 'DELETE',
      headers: {
        ...headers,
        'Idempotency-Key': createMutationKey('account-delete'),
      },
    });
    syncServerTimeFromHeaders(response.headers);

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response, 'Hesap silinemedi.'));
    }

    await supabase.auth.signOut();
    resetPushNotificationSyncState();
    clearSessionCaches();
    await purgeUserSessionStorage(deletedUserId).catch(() => undefined);
    await purgeChatOutbox(deletedUserId).catch(() => undefined);
    await deleteCachedProfile(deletedUserId);
    await clearSignupDraft().catch(() => undefined);
    lastSessionUserIdRef.current = null;
    setUser(null);
    telemetry.setUser(null);
    setIsRecoveringPassword(false);
    setPendingVerificationEmail(null);
  };

  const completePasswordRecovery = async (newPassword: string) => {
    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      throw new Error(passwordError);
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      throw new Error(normalizeAuthErrorMessage(error, 'Şifre güncellenemedi.'));
    }

    setIsRecoveringPassword(false);
  };

  const cancelPasswordRecovery = async () => {
    setIsRecoveringPassword(false);
    await clearPushNotifications().catch(() => undefined);
    await supabase.auth.signOut();
  };

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      isRecoveringPassword,
      pendingVerificationEmail,
      login,
      signup,
      logout,
      refreshUser,
      checkAvailability,
      sendPasswordReset,
      sendVerificationEmail,
      updateProfile,
      deleteAccount,
      completePasswordRecovery,
      cancelPasswordRecovery,
    }),
    [isRecoveringPassword, loading, pendingVerificationEmail, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
