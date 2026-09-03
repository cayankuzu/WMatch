import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { registerPushToken, unregisterPushToken } from './api';
import { theme } from '../shared/theme';
import { isAppActive } from '../shared/utils/appLifecycle';
import { subscribeToUserEvent } from './userEventBus';

let notificationsConfigured = false;
let activePushToken: string | null = null;
let activePushUserId: string | null = null;
let lastPushSyncAt = 0;
let lastPushSkipReason: string | null = null;
let pushSyncInFlight: {
  userId: string | null;
  requestPermission: boolean;
  promise: Promise<PushNotificationSyncResult>;
} | null = null;
let pushRetryTimer: ReturnType<typeof setTimeout> | null = null;
let pushRetryAttempt = 0;

const PUSH_SYNC_COOLDOWN_MS = 60_000;
const PUSH_RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000] as const;
const LOCAL_PRESENTATION_FLAG = '__localPresentation';
const LOCAL_PRESENTATION_TTL_MS = 90_000;
const ANDROID_NOTIFICATION_CHANNEL_ID = 'wmatch-alerts-v2';
const LEGACY_PUSH_REGISTRATION_STORAGE_KEY = '@wmatch/push-registration-v1';
const PUSH_REGISTRATION_STORAGE_KEY = 'wmatch.push-registration.v2';
const PUSH_REVOCATION_STORAGE_KEY = 'wmatch.push-revocations.v1';
const recentlyPresentedNotificationKeys = new Map<string, number>();
const activeLocalNotificationIdsByGroup = new Map<string, string>();

export type NotificationIntent =
  | {
      requestId: string;
      target: 'chat';
      userId: string;
      eventId: string | null;
      markThreadRead: boolean;
    }
  | {
      requestId: string;
      target: 'likes';
      eventId: string | null;
      preferredTab: 'likedme';
    };

export type PushNotificationSyncResult =
  | { status: 'registered' }
  | { status: 'settings-required'; reason: 'permission' | 'channel' }
  | { status: 'skipped' }
  | { status: 'retrying' };

type StoredPushRegistration = {
  token: string;
  userId: string;
};

type StoredPushRevocation = StoredPushRegistration & {
  attempts: number;
  createdAt: string;
};

function parseStoredPushRegistration(value: string | null): StoredPushRegistration | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<StoredPushRegistration>;
    return typeof parsed.token === 'string' && parsed.token.length > 0 && parsed.token.length <= 4096
      && typeof parsed.userId === 'string' && parsed.userId.length > 0 && parsed.userId.length <= 128
      ? { token: parsed.token, userId: parsed.userId }
      : null;
  } catch {
    return null;
  }
}

async function readStoredPushRegistration(): Promise<StoredPushRegistration | null> {
  try {
    const secureRegistration = parseStoredPushRegistration(
      await SecureStore.getItemAsync(PUSH_REGISTRATION_STORAGE_KEY),
    );
    if (secureRegistration) {
      return secureRegistration;
    }

    const legacyRegistration = parseStoredPushRegistration(
      await AsyncStorage.getItem(LEGACY_PUSH_REGISTRATION_STORAGE_KEY),
    );
    if (legacyRegistration) {
      await SecureStore.setItemAsync(PUSH_REGISTRATION_STORAGE_KEY, JSON.stringify(legacyRegistration));
      await AsyncStorage.removeItem(LEGACY_PUSH_REGISTRATION_STORAGE_KEY);
    }
    return legacyRegistration;
  } catch {
    return null;
  }
}

async function storePushRegistration(registration: StoredPushRegistration) {
  await SecureStore.setItemAsync(PUSH_REGISTRATION_STORAGE_KEY, JSON.stringify(registration));
  await AsyncStorage.removeItem(LEGACY_PUSH_REGISTRATION_STORAGE_KEY).catch(() => undefined);
}

async function removeStoredPushRegistration() {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(PUSH_REGISTRATION_STORAGE_KEY),
    AsyncStorage.removeItem(LEGACY_PUSH_REGISTRATION_STORAGE_KEY),
  ]);
}

async function readPendingPushRevocations(): Promise<StoredPushRevocation[]> {
  try {
    const rawValue = await SecureStore.getItemAsync(PUSH_REVOCATION_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }
      const candidate = entry as Partial<StoredPushRevocation>;
      const registration = parseStoredPushRegistration(JSON.stringify(candidate));
      if (!registration) {
        return [];
      }
      return [{
        ...registration,
        attempts: Number.isSafeInteger(candidate.attempts) && Number(candidate.attempts) >= 0
          ? Number(candidate.attempts)
          : 0,
        createdAt: typeof candidate.createdAt === 'string'
          && Number.isFinite(new Date(candidate.createdAt).getTime())
          ? candidate.createdAt
          : new Date().toISOString(),
      }];
    });
  } catch {
    return [];
  }
}

async function writePendingPushRevocations(revocations: StoredPushRevocation[]) {
  if (revocations.length === 0) {
    await SecureStore.deleteItemAsync(PUSH_REVOCATION_STORAGE_KEY);
    return;
  }

  await SecureStore.setItemAsync(
    PUSH_REVOCATION_STORAGE_KEY,
    JSON.stringify(revocations),
  );
}

async function queuePushRevocation(registration: StoredPushRegistration) {
  const pending = await readPendingPushRevocations();
  const retained = pending.filter((entry) => (
    entry.token !== registration.token || entry.userId !== registration.userId
  ));
  await writePendingPushRevocations([
    ...retained,
    { ...registration, attempts: 0, createdAt: new Date().toISOString() },
  ]);
}

async function retryPendingPushRevocations(userId: string) {
  const pending = await readPendingPushRevocations();
  if (pending.length === 0) {
    return;
  }

  const retained: StoredPushRevocation[] = [];
  for (const revocation of pending) {
    if (revocation.userId !== userId) {
      retained.push(revocation);
      continue;
    }

    try {
      await unregisterPushToken(revocation.token);
    } catch {
      retained.push({ ...revocation, attempts: revocation.attempts + 1 });
    }
  }
  await writePendingPushRevocations(retained);
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNotificationIntent(data: unknown, requestId: string): NotificationIntent | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as Record<string, unknown>;
  const routeKind = normalizeString(record.routeKind);
  const type = normalizeString(record.type);
  const eventId = normalizeString(record.eventId);
  const userId = normalizeString(record.userId);

  if (routeKind === 'likes' || type === 'like') {
    return {
      requestId,
      target: 'likes',
      eventId,
      preferredTab: 'likedme',
    };
  }

  if (
    userId &&
    (routeKind === 'chat' ||
      type === 'message' ||
      type === 'match' ||
      type === 'chat_ended' ||
      type === 'chat_blocked' ||
      type === 'chat_unblocked')
  ) {
    return {
      requestId,
      target: 'chat',
      userId,
      eventId,
      markThreadRead: type === 'message',
    };
  }

  return null;
}

function getPresentationKey(data: Record<string, unknown>, fallback: string) {
  const eventId = normalizeString(data.eventId);
  const type = normalizeString(data.type);
  const userId = normalizeString(data.userId);

  if (eventId) {
    return `event:${eventId}`;
  }

  return `fallback:${type ?? 'unknown'}:${userId ?? 'none'}:${fallback}`;
}

function getNotificationGroupKey(data: Record<string, unknown>, fallback: string) {
  const notificationTag = normalizeString(data.notificationTag);
  const collapseId = normalizeString(data.collapseId);

  return notificationTag ?? collapseId ?? getPresentationKey(data, fallback);
}

function rememberPresentationKey(key: string) {
  const now = Date.now();

  recentlyPresentedNotificationKeys.forEach((createdAt, existingKey) => {
    if (now - createdAt > LOCAL_PRESENTATION_TTL_MS) {
      recentlyPresentedNotificationKeys.delete(existingKey);
    }
  });

  if (recentlyPresentedNotificationKeys.has(key)) {
    return false;
  }

  recentlyPresentedNotificationKeys.set(key, now);
  return true;
}

function toNotificationIntent(response: Notifications.NotificationResponse | null) {
  if (!response) {
    return null;
  }

  const requestId = response.notification.request.identifier;
  return parseNotificationIntent(response.notification.request.content.data, requestId);
}

function getProjectId() {
  const expoConfig = Constants.expoConfig as
    | {
        extra?: {
          eas?: {
            projectId?: string;
          };
          projectId?: string;
        };
      }
    | undefined;
  const easConfig = Constants.easConfig as { projectId?: string } | undefined;

  return easConfig?.projectId ?? expoConfig?.extra?.eas?.projectId ?? expoConfig?.extra?.projectId ?? null;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
    name: 'WMatch Bildirimleri',
    description: 'Mesajlar, eşleşmeler, beğeniler ve hesap etkinliği',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: theme.colors.notificationAccent,
  });

  await Notifications.setNotificationChannelAsync('default', {
    name: 'WMatch Bildirimleri',
    description: 'WMatch bildirimleri',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: theme.colors.notificationAccent,
  });
}

export async function configureNotificationPresentation() {
  if (notificationsConfigured) {
    return true;
  }

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const isLocalPresentation = data?.[LOCAL_PRESENTATION_FLAG] === 'true';

      return {
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: isLocalPresentation,
        shouldShowList: isLocalPresentation,
      };
    },
  });

  notificationsConfigured = true;
  return true;
}

function clearPushRetry() {
  if (pushRetryTimer) {
    clearTimeout(pushRetryTimer);
    pushRetryTimer = null;
  }

  pushRetryAttempt = 0;
}

function schedulePushRetry(userId: string) {
  if (pushRetryTimer) {
    return;
  }

  const delay = PUSH_RETRY_DELAYS_MS[Math.min(pushRetryAttempt, PUSH_RETRY_DELAYS_MS.length - 1)];
  pushRetryAttempt += 1;
  pushRetryTimer = setTimeout(() => {
    pushRetryTimer = null;
    void syncPushNotifications(userId);
  }, delay);
}

function allowsNotifications(settings: Notifications.NotificationPermissionsStatus) {
  if (settings.granted || settings.status === 'granted') {
    return true;
  }

  const iosStatus = settings.ios?.status;
  return (
    iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED
    || iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL
    || iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

function shouldRequestNotificationPermission(settings: Notifications.NotificationPermissionsStatus) {
  if (!allowsNotifications(settings)) {
    return settings.canAskAgain;
  }

  return (
    Platform.OS === 'ios' &&
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL &&
    settings.canAskAgain
  );
}

async function requestNotificationPermission() {
  return Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      allowProvisional: false,
    },
  });
}

async function isAndroidNotificationChannelBlocked(
  settings: Notifications.NotificationPermissionsStatus,
) {
  if (Platform.OS !== 'android') {
    return false;
  }

  if (settings.android?.importance === Notifications.AndroidImportance.NONE) {
    return true;
  }

  const channel = await Notifications.getNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID);
  return channel?.importance === Notifications.AndroidImportance.NONE;
}

function isIosNotificationPresentationBlocked(
  settings: Notifications.NotificationPermissionsStatus,
) {
  if (
    Platform.OS !== 'ios' ||
    settings.ios?.status !== Notifications.IosAuthorizationStatus.AUTHORIZED
  ) {
    return false;
  }

  return (
    settings.ios.allowsAlert === false &&
    settings.ios.allowsDisplayInNotificationCenter === false &&
    settings.ios.allowsDisplayOnLockScreen === false
  );
}

async function deactivateStoredPushRegistration(userId: string) {
  const storedRegistration = await readStoredPushRegistration();
  const registeredToken =
    activePushUserId === userId
      ? activePushToken
      : storedRegistration?.userId === userId
        ? storedRegistration.token
        : null;

  if (!registeredToken) {
    return;
  }

  try {
    await unregisterPushToken(registeredToken);

    if (storedRegistration?.userId === userId && storedRegistration.token === registeredToken) {
      await removeStoredPushRegistration();
    }

    if (activePushUserId === userId && activePushToken === registeredToken) {
      activePushToken = null;
      activePushUserId = null;
      lastPushSyncAt = 0;
    }
  } catch (error) {
    await queuePushRevocation({ token: registeredToken, userId });
    console.warn('Disabled push token cleanup will be retried:', error);
  }
}

export async function openPushNotificationSettings() {
  if (Platform.OS === 'android' && Application.applicationId) {
    try {
      await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
        {
          key: 'android.provider.extra.APP_PACKAGE',
          value: Application.applicationId,
        },
        {
          key: 'android.provider.extra.CHANNEL_ID',
          value: ANDROID_NOTIFICATION_CHANNEL_ID,
        },
      ]);
      return;
    } catch {
      // Some Android vendors do not expose the channel settings intent.
    }
  }

  await Linking.openSettings();
}

async function presentLocalNotification(config: {
  title: string | null | undefined;
  body: string | null | undefined;
  data: Record<string, unknown>;
  fallbackKey: string;
}) {
  if (!isAppActive()) {
    return;
  }

  const key = getPresentationKey(config.data, config.fallbackKey);

  if (!rememberPresentationKey(key)) {
    return;
  }

  const notificationGroupKey = getNotificationGroupKey(config.data, config.fallbackKey);
  await configureNotificationPresentation();
  await ensureAndroidChannel();
  const previousNotificationId = activeLocalNotificationIdsByGroup.get(notificationGroupKey);

  if (previousNotificationId) {
    await Notifications.dismissNotificationAsync(previousNotificationId).catch(() => undefined);
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: config.title ?? '',
      body: config.body ?? '',
      data: {
        ...config.data,
        [LOCAL_PRESENTATION_FLAG]: 'true',
      },
      ...(Platform.OS === 'ios' ? { sound: 'default' as const } : {}),
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    identifier: notificationGroupKey,
    trigger: Platform.OS === 'android' ? { channelId: ANDROID_NOTIFICATION_CHANNEL_ID } : null,
  });

  activeLocalNotificationIdsByGroup.set(notificationGroupKey, notificationId);
}

export function subscribeToForegroundNotificationPresentation() {
  const subscription = Notifications.addNotificationReceivedListener((notification) => {
    const content = notification.request.content;
    const data = (content.data ?? {}) as Record<string, unknown>;

    if (data[LOCAL_PRESENTATION_FLAG] === 'true') {
      return;
    }

    void presentLocalNotification({
      title: content.title,
      body: content.body,
      data,
      fallbackKey: notification.request.identifier,
    });
  });

  return () => {
    subscription.remove();
  };
}

export function subscribeToNotificationEventInserts(userId: string | null | undefined) {
  if (!userId) {
    return () => undefined;
  }

  return subscribeToUserEvent(userId, 'notification_changed', (payload) => {
      const row = (payload as { notification?: {
        id?: string;
        kind?: string;
        routeKind?: string;
        routeUserId?: string | null;
        title?: string | null;
        body?: string | null;
        payload?: Record<string, unknown> | null;
      } } | null)?.notification;

      if (!row) {
        return;
      }

      const data = {
        type: row.kind ?? null,
        eventId: row.id ?? null,
        routeKind: row.routeKind ?? null,
        userId: row.routeUserId ?? null,
        ...(row.payload ?? {}),
      };

      void presentLocalNotification({
        title: row.title,
        body: row.body,
        data,
        fallbackKey: row.id ?? `${row.kind ?? 'event'}:${Date.now()}`,
      });
    });
}

export function subscribeToNotificationResponses(listener: (intent: NotificationIntent) => void) {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const intent = toNotificationIntent(response);

    if (intent) {
      listener(intent);
    }
  });

  return () => {
    subscription.remove();
  };
}

export async function getLastNotificationIntent() {
  const response = await Notifications.getLastNotificationResponseAsync();
  const intent = toNotificationIntent(response);

  if (response) {
    await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }

  return intent;
}

export function resetPushNotificationSyncState() {
  clearPushRetry();
  activePushToken = null;
  activePushUserId = null;
  lastPushSyncAt = 0;
  lastPushSkipReason = null;
}

export async function clearPushNotifications() {
  await pushSyncInFlight?.promise;
  const storedRegistration = await readStoredPushRegistration();
  const registrationsToRemove = new Map<string, StoredPushRegistration>();
  if (activePushToken && activePushUserId) {
    registrationsToRemove.set(activePushToken, { token: activePushToken, userId: activePushUserId });
  }
  if (storedRegistration) {
    registrationsToRemove.set(storedRegistration.token, storedRegistration);
  }

  for (const registration of registrationsToRemove.values()) {
    try {
      await unregisterPushToken(registration.token);
    } catch (error) {
      await queuePushRevocation(registration);
      console.warn('Push token cleanup will be retried:', error);
    }
  }

  await removeStoredPushRegistration().catch(() => undefined);
  resetPushNotificationSyncState();
}

async function syncPushNotificationsOnce(
  userId: string | null,
  requestPermission: boolean,
): Promise<PushNotificationSyncResult> {
  try {
    await configureNotificationPresentation();

    if (!userId) {
      lastPushSkipReason = null;
      return { status: 'skipped' };
    }

    await retryPendingPushRevocations(userId);

    if (!Device.isDevice) {
      if (lastPushSkipReason !== 'simulator') {
        console.warn('Push notification sync skipped: real device required for remote push registration.');
        lastPushSkipReason = 'simulator';
      }
      return { status: 'skipped' };
    }

    await ensureAndroidChannel();

    let finalPermissions = await Notifications.getPermissionsAsync();

    if (requestPermission && shouldRequestNotificationPermission(finalPermissions)) {
      finalPermissions = await requestNotificationPermission();
    }

    if (!allowsNotifications(finalPermissions)) {
      await deactivateStoredPushRegistration(userId);

      if (lastPushSkipReason !== 'permission') {
        console.warn('Push notification sync skipped: notification permission not granted.');
        lastPushSkipReason = 'permission';
      }
      return { status: 'settings-required', reason: 'permission' };
    }

    if (await isAndroidNotificationChannelBlocked(finalPermissions)) {
      if (lastPushSkipReason !== 'channel') {
        console.warn('Push notification sync skipped: Android notification channel is disabled.');
        lastPushSkipReason = 'channel';
      }
      return { status: 'settings-required', reason: 'channel' };
    }

    if (isIosNotificationPresentationBlocked(finalPermissions)) {
      if (lastPushSkipReason !== 'ios-presentation') {
        console.warn('Push notification sync warning: iOS notification presentation is disabled.');
        lastPushSkipReason = 'ios-presentation';
      }
      return { status: 'settings-required', reason: 'permission' };
    }

    const projectId = getProjectId();
    if (!projectId && lastPushSkipReason !== 'missing-project-id') {
      console.warn('Push notification sync warning: Expo projectId missing, token registration may fail on development builds.');
      lastPushSkipReason = 'missing-project-id';
    }
    const tokenResponse = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenResponse.data;
    const now = Date.now();
    const storedRegistration = await readStoredPushRegistration();
    const previousToken =
      activePushUserId === userId
        ? activePushToken
        : storedRegistration?.userId === userId
          ? storedRegistration.token
          : null;
    const previousUserId = activePushUserId ?? storedRegistration?.userId ?? null;

    if (
      token === previousToken &&
      userId === previousUserId &&
      now - lastPushSyncAt < PUSH_SYNC_COOLDOWN_MS
    ) {
      return { status: 'registered' };
    }

    await registerPushToken(token, Platform.OS);

    if (previousToken && previousToken !== token) {
      try {
        await unregisterPushToken(previousToken);
      } catch {
        if (previousUserId) {
          await queuePushRevocation({ token: previousToken, userId: previousUserId });
        }
      }
    }

    await storePushRegistration({ token, userId });
    activePushToken = token;
    activePushUserId = userId;
    lastPushSyncAt = now;
    lastPushSkipReason = null;
    clearPushRetry();
    return { status: 'registered' };
  } catch (error) {
    console.warn('Push notification sync skipped:', error);
    if (userId) {
      schedulePushRetry(userId);
    }
    return { status: 'retrying' };
  }
}

export function subscribeToPushTokenChanges(userId: string | null | undefined) {
  if (!userId) {
    return () => undefined;
  }

  const tokenSubscription = Notifications.addPushTokenListener(() => {
    lastPushSyncAt = 0;
    void syncPushNotifications(userId);
  });
  const droppedSubscription = Notifications.addNotificationsDroppedListener(() => {
    lastPushSyncAt = 0;
    void syncPushNotifications(userId);
  });

  return () => {
    tokenSubscription.remove();
    droppedSubscription.remove();
  };
}

function runPushNotificationSync(
  userId: string | null | undefined,
  requestPermission: boolean,
): Promise<PushNotificationSyncResult> {
  const normalizedUserId = userId ?? null;

  if (pushSyncInFlight) {
    if (
      pushSyncInFlight.userId === normalizedUserId &&
      (!requestPermission || pushSyncInFlight.requestPermission)
    ) {
      return pushSyncInFlight.promise;
    }

    return pushSyncInFlight.promise.then(() => runPushNotificationSync(normalizedUserId, requestPermission));
  }

  const promise = syncPushNotificationsOnce(normalizedUserId, requestPermission).finally(() => {
    if (pushSyncInFlight?.promise === promise) {
      pushSyncInFlight = null;
    }
  });

  pushSyncInFlight = { userId: normalizedUserId, requestPermission, promise };
  return promise;
}

export function syncPushNotifications(userId: string | null | undefined) {
  return runPushNotificationSync(userId, false);
}

export function requestPushNotifications(userId: string) {
  lastPushSyncAt = 0;
  return runPushNotificationSync(userId, true);
}
