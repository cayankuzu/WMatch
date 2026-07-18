import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { registerPushToken, unregisterPushToken } from './api';
import { supabase } from '../../utils/supabase/client';
import { theme } from '../shared/theme';

let notificationsConfigured = false;
let activePushToken: string | null = null;
let activePushUserId: string | null = null;
let lastPushSyncAt = 0;
let lastPushSkipReason: string | null = null;
let pushSyncInFlight: { userId: string | null; promise: Promise<void> } | null = null;

const PUSH_SYNC_COOLDOWN_MS = 60_000;
const LOCAL_PRESENTATION_FLAG = '__localPresentation';
const LOCAL_PRESENTATION_TTL_MS = 90_000;
const ANDROID_NOTIFICATION_CHANNEL_ID = 'wmatch-alerts-v2';
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
    name: 'WMatch Alerts',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: theme.colors.notificationAccent,
  });

  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
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

async function presentLocalNotification(config: {
  title: string | null | undefined;
  body: string | null | undefined;
  data: Record<string, unknown>;
  fallbackKey: string;
}) {
  if (Platform.OS === 'web' || AppState.currentState !== 'active') {
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
    trigger: {
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
    },
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
  if (!userId || Platform.OS === 'web') {
    return () => undefined;
  }

  const channel = supabase.channel(`user-events:${userId}`, {
    config: { private: true },
  });

  channel.on(
    'broadcast',
    { event: 'notification_changed' },
    ({ payload }) => {
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
    },
  );

  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
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
  activePushToken = null;
  activePushUserId = null;
  lastPushSyncAt = 0;
  lastPushSkipReason = null;
}

export async function clearPushNotifications() {
  await pushSyncInFlight?.promise;
  const tokenToRemove = activePushToken;
  resetPushNotificationSyncState();

  if (!tokenToRemove) {
    return;
  }

  try {
    await unregisterPushToken(tokenToRemove);
  } catch (error) {
    console.warn('Push token cleanup skipped:', error);
  }
}

async function syncPushNotificationsOnce(userId: string | null) {
  try {
    await configureNotificationPresentation();

    if (!userId) {
      lastPushSkipReason = null;
      return;
    }

    if (Platform.OS === 'web') {
      return;
    }

    if (!Device.isDevice) {
      if (lastPushSkipReason !== 'simulator') {
        console.warn('Push notification sync skipped: real device required for remote push registration.');
        lastPushSkipReason = 'simulator';
      }
      return;
    }

    await ensureAndroidChannel();

    const existingPermissions = await Notifications.getPermissionsAsync();
    let finalStatus = existingPermissions.status;

    if (finalStatus !== 'granted') {
      const requestedPermissions = await Notifications.requestPermissionsAsync();
      finalStatus = requestedPermissions.status;
    }

    if (finalStatus !== 'granted') {
      if (lastPushSkipReason !== 'permission') {
        console.warn('Push notification sync skipped: notification permission not granted.');
        lastPushSkipReason = 'permission';
      }
      return;
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
    const previousToken = activePushToken;
    const previousUserId = activePushUserId;

    if (
      token === previousToken &&
      userId === previousUserId &&
      now - lastPushSyncAt < PUSH_SYNC_COOLDOWN_MS
    ) {
      return;
    }

    await registerPushToken(token, Platform.OS);

    if (previousToken && previousToken !== token) {
      await unregisterPushToken(previousToken).catch(() => undefined);
    }

    activePushToken = token;
    activePushUserId = userId;
    lastPushSyncAt = now;
    lastPushSkipReason = null;
  } catch (error) {
    console.warn('Push notification sync skipped:', error);
  }
}

export function syncPushNotifications(userId: string | null | undefined): Promise<void> {
  const normalizedUserId = userId ?? null;

  if (pushSyncInFlight) {
    if (pushSyncInFlight.userId === normalizedUserId) {
      return pushSyncInFlight.promise;
    }

    return pushSyncInFlight.promise.then(() => syncPushNotifications(normalizedUserId));
  }

  const promise = syncPushNotificationsOnce(normalizedUserId).finally(() => {
    if (pushSyncInFlight?.promise === promise) {
      pushSyncInFlight = null;
    }
  });

  pushSyncInFlight = { userId: normalizedUserId, promise };
  return promise;
}
