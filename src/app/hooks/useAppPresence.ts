import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { supabase } from '../../../utils/supabase/client';

const APP_PRESENCE_CHANNEL_PREFIX = 'user';

interface AppPresencePayload {
  userId: string;
  kind: 'app';
  isOnline: boolean;
  updatedAt: string;
}

export type AppPresenceSnapshot = Record<string, AppPresencePayload[]>;

type AppPresenceListener = (state: AppPresenceSnapshot) => void;

const appPresenceListenersByUserId = new Map<string, Set<AppPresenceListener>>();
const latestAppPresenceStateByUserId = new Map<string, AppPresenceSnapshot>();

function publishAppPresence(userId: string, state: AppPresenceSnapshot) {
  latestAppPresenceStateByUserId.set(userId, state);

  appPresenceListenersByUserId.get(userId)?.forEach((listener) => {
    listener(state);
  });
}

export function subscribeToAppPresence(userId: string, listener: AppPresenceListener) {
  const listeners = appPresenceListenersByUserId.get(userId) ?? new Set<AppPresenceListener>();
  listeners.add(listener);
  appPresenceListenersByUserId.set(userId, listeners);
  listener(latestAppPresenceStateByUserId.get(userId) ?? {});

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      appPresenceListenersByUserId.delete(userId);
    }
  };
}

export default function useAppPresence(userId: string | null) {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const joinedRef = useRef(false);

  const payload = useMemo<AppPresencePayload | null>(() => {
    if (!userId) {
      return null;
    }

    return {
      userId,
      kind: 'app',
      isOnline: appState === 'active',
      updatedAt: new Date().toISOString(),
    };
  }, [appState, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const channel = supabase.channel(`${APP_PRESENCE_CHANNEL_PREFIX}:${userId}`, {
      config: {
        private: true,
        presence: {
          key: userId,
        },
      },
    });

    const syncPresenceState = () => {
      publishAppPresence(userId, channel.presenceState<AppPresencePayload>());
    };

    channelRef.current = channel;
    channel.on('presence', { event: 'sync' }, syncPresenceState);
    channel.on('presence', { event: 'join' }, syncPresenceState);
    channel.on('presence', { event: 'leave' }, syncPresenceState);

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') {
        return;
      }

      joinedRef.current = true;
      await channel.track(payload!);
      syncPresenceState();
    });

    return () => {
      joinedRef.current = false;
      publishAppPresence(userId, {});
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (!channelRef.current || !joinedRef.current || !payload) {
      return;
    }

    void channelRef.current.track(payload).then(() => {
      publishAppPresence(payload.userId, channelRef.current?.presenceState<AppPresencePayload>() ?? {});
    });
  }, [payload, userId]);
}
