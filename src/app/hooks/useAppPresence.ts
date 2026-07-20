import { useEffect, useMemo, useRef } from 'react';

import { supabase } from '../../../utils/supabase/client';
import { buildAppPresenceTopic, type AppPresencePayload } from '../../services/presence';
import { useAppStateStatus } from '../../shared/utils/appLifecycle';

export default function useAppPresence(userId: string | null) {
  const appState = useAppStateStatus();
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
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  useEffect(() => {
    if (!userId) {
      return;
    }

    const channel = supabase.channel(buildAppPresenceTopic(userId), {
      config: {
        private: true,
        presence: { key: userId },
      },
    });

    channelRef.current = channel;
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED' || !payloadRef.current) {
        return;
      }

      joinedRef.current = true;
      void channel.track(payloadRef.current);
    });

    return () => {
      joinedRef.current = false;
      channelRef.current = null;
      void channel.untrack().catch(() => undefined);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!joinedRef.current || !channelRef.current || !payload) {
      return;
    }

    void channelRef.current.track(payload);
  }, [payload]);
}
