import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';

import { API_BASE, fetchWithRetry, getAuthHeaders, getPublicApiHeaders, resolveApiUrl, supabase } from '../../utils/supabase/client';
import {
  cleanupManagedProfilePhotos,
  cleanupRemovedProfilePhotos,
  hasLocalProfilePhotos,
  ProfilePhotoUploadCancelledError,
  persistProfilePhotos,
  type ProfilePhotoUploadProgress,
} from '../services/storage';
import {
  getEmailVerificationRedirectUrl,
  getPasswordResetRedirectUrl,
} from '../shared/config/publicWeb';
import { clearPushNotifications, resetPushNotificationSyncState } from '../services/notifications';
import { clearPrivateImageMemoryCache } from '../services/imageCache';
import { purgeChatOutbox } from '../services/chatOutbox';
import { clearSignupDraft, readSignupDraft } from '../services/signupDraft';
import { telemetry } from '../services/telemetry';
import type { AppUser, ProfileUpdateInput, SignUpData } from '../shared/types';
import { syncServerTimeFromHeaders } from '../shared/utils/serverTime';
import { isApiUser, isRecord } from '../shared/utils/apiValidation';
import { validatePassword } from '../shared/utils/validation';
import { clearSessionCaches, purgeUserSessionStorage } from '../shared/utils/sessionCache';
import { subscribeToForeground } from '../shared/utils/appLifecycle';
import {
  beginAuthFlow,
  clearAuthFlowState,
  createMutationKey,
  deleteCachedProfile,
  isRemoteProfilePhotoUri,
  normalizeAuthErrorMessage,
  normalizeProfilePayload,
  parseAvailabilityError,
  parseErrorMessage,
  preserveEqualUser,
  readCachedProfile,
  writeCachedProfile,
  type ProfileLoadResult,
  type ProfilePayload,
} from './auth/authSupport';
import { processAuthDeepLink } from './auth/authDeepLink';

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
  updateProfile: (
    data: ProfileUpdateInput,
    options?: {
      onUploadProgress?: (progress: ProfilePhotoUploadProgress) => void;
      signal?: AbortSignal;
    },
  ) => Promise<void>;
  deleteAccount: () => Promise<void>;
  completePasswordRecovery: (newPassword: string) => Promise<void>;
  cancelPasswordRecovery: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function purgeLocalAuthSession(userId: string | null) {
  clearSessionCaches();
  await Promise.allSettled([
    purgeUserSessionStorage(userId),
    purgeChatOutbox(userId),
    deleteCachedProfile(userId),
    clearSignupDraft(),
    clearPrivateImageMemoryCache(),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const commitUser = (nextUser: AppUser | null) => {
    setUser((currentUser) => preserveEqualUser(currentUser, nextUser));
  };
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

      const profile = await response.json() as unknown;

      if (!isApiUser(profile)) {
        return {
          status: 'unavailable',
          error: new Error('Profile response contract is invalid.'),
        };
      }

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

    const payload = await response.json() as unknown;

    if (!isRecord(payload) || (payload.profile != null && !isApiUser(payload.profile))) {
      throw new Error('Profile update response contract is invalid.');
    }

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
      const signedOutUserId = lastSessionUserIdRef.current;
      void purgeLocalAuthSession(signedOutUserId);
      lastSessionUserIdRef.current = null;
      commitUser(null);
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
      commitUser({
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
      commitUser(null);
      return;
    }

    const emailVerified = session.user.email_confirmed_at != null;
    const restoredUser: AppUser = {
      ...profileResult.profile,
      id: session.user.id,
      email: session.user.email ?? '',
      emailVerified,
    };
    commitUser(restoredUser);
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
    commitUser(nextUser);
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
    await processAuthDeepLink({
      url,
      onSession: syncSessionUser,
      onRecovery: () => setIsRecoveringPassword(true),
    });
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

    const unsubscribeForeground = subscribeToForeground(() => {
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
        const signedOutUserId = lastSessionUserIdRef.current;
        void purgeLocalAuthSession(signedOutUserId);
        lastSessionUserIdRef.current = null;
        commitUser(null);
        setIsRecoveringPassword(false);
        return;
      }

      void syncSessionUser(session);
    });

    return () => {
      mounted = false;
      linkSubscription.remove();
      unsubscribeForeground();
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
      const apiPath = '/auth/check-availability';
      const response = await fetchWithRetry(resolveApiUrl(apiPath), {
        method: 'POST',
        headers: await getPublicApiHeaders(apiPath),
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

    // Signup metadata is untrusted and processed before the user owns a storage
    // namespace. Photos are finalized only through the authenticated profile API.
    const safeMetadataPhotos: string[] = [];

    const authFlowState = await beginAuthFlow('signup');
    const { error } = await supabase.auth.signUp({
      email: userData.email.trim().toLowerCase(),
      password: userData.password,
      options: {
        emailRedirectTo: getEmailVerificationRedirectUrl(authFlowState),
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
      await clearAuthFlowState('signup');
      throw new Error(normalizeAuthErrorMessage(error, 'Kayıt başarısız.'));
    }

    setPendingVerificationEmail(userData.email.trim().toLowerCase());
  };

  const logout = async () => {
    const signedOutUserId = user?.id ?? lastSessionUserIdRef.current;
    await clearPushNotifications().catch(() => undefined);
    await supabase.auth.signOut();
    await purgeLocalAuthSession(signedOutUserId);
    lastSessionUserIdRef.current = null;
    commitUser(null);
    telemetry.setUser(null);
    setIsRecoveringPassword(false);
    setPendingVerificationEmail(null);
  };

  const sendPasswordReset = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const authFlowState = await beginAuthFlow('recovery');

    try {
      const apiPath = '/auth/password-reset';
      const response = await fetchWithRetry(resolveApiUrl(apiPath), {
        method: 'POST',
        headers: {
          ...(await getPublicApiHeaders(apiPath)),
          'Idempotency-Key': createMutationKey('password-reset'),
        },
        body: JSON.stringify({
          email: normalizedEmail,
          redirectTo: getPasswordResetRedirectUrl(authFlowState),
        }),
      });
      syncServerTimeFromHeaders(response.headers);

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, 'Şifre sıfırlama maili gönderilemedi.'));
      }
    } catch (error) {
      await clearAuthFlowState('recovery');
      throw error;
    }
  };
  const sendVerificationEmail = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const authFlowState = await beginAuthFlow('signup');
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: normalizedEmail,
      options: {
        emailRedirectTo: getEmailVerificationRedirectUrl(authFlowState),
      },
    });

    if (error) {
      await clearAuthFlowState('signup');
      throw new Error(normalizeAuthErrorMessage(error, 'Doğrulama maili gönderilemedi.'));
    }

    setPendingVerificationEmail(normalizedEmail);
  };

  const updateProfile = async (
    data: ProfileUpdateInput,
    options?: {
      onUploadProgress?: (progress: ProfilePhotoUploadProgress) => void;
      signal?: AbortSignal;
    },
  ) => {
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
        onProgress: options?.onUploadProgress,
        signal: options?.signal,
      });
      uploadedPhotosForRollback = payload.photos.filter((photo) => !previousPhotos.includes(photo));
    }

    if (options?.signal?.aborted) {
      if (uploadedPhotosForRollback.length > 0) {
        await cleanupManagedProfilePhotos(uploadedPhotosForRollback);
      }
      throw new ProfilePhotoUploadCancelledError();
    }

    try {
      const profile = await applyProfileUpdateRequest(payload);

      if (Array.isArray(payload.photos)) {
        await cleanupRemovedProfilePhotos(previousPhotos, profile?.photos ?? payload.photos);
      }

      if (profile && lastSessionUserIdRef.current === user.id) {
        const nextUser = { ...user, ...profile };
        setUser((current) => current?.id === user.id ? preserveEqualUser(current, nextUser) : current);
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
    await purgeLocalAuthSession(deletedUserId);
    lastSessionUserIdRef.current = null;
    commitUser(null);
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
