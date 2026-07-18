import { useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '../../../utils/supabase/client';
import type { ChatSettings } from '../../shared/types';

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  readReceipts: true,
  onlineStatus: true,
  typingIndicator: true,
  notifications: true,
};

interface AppPresencePayload {
  userId: string;
  kind: 'app' | 'viewer';
  isOnline: boolean;
  updatedAt: string;
}

type AppPresenceSnapshot = Record<string, AppPresencePayload[]>;

interface TypingBroadcastPayload {
  userId: string;
  isTyping: boolean;
  updatedAt: string;
}

interface ChatPresenceState {
  isOnline: boolean;
  isTyping: boolean;
}

interface ConversationRealtimeController {
  channel: ReturnType<typeof supabase.channel>;
  currentUserId: string;
  isJoined: boolean;
  consumers: number;
  presenceListeners: Set<() => void>;
  typingListeners: Set<(payload: TypingBroadcastPayload) => void>;
  disposalTimer: ReturnType<typeof setTimeout> | null;
}

const conversationControllers = new Map<string, ConversationRealtimeController>();
const conversationRemovalFlights = new Map<string, Promise<void>>();
const TYPING_BROADCAST_EVENT = 'typing';
const TYPING_BROADCAST_HEARTBEAT_MS = 2000;
const TYPING_BROADCAST_STALE_MS = 3200;
const CONVERSATION_CHANNEL_IDLE_MS = 1500;
const buildConversationTopic = (pairKey: string) => `conversation:${pairKey}`;
const buildTypingBroadcastTopic = buildConversationTopic;

function buildChatPairKey(leftUserId: string, rightUserId: string) {
  return leftUserId < rightUserId ? `${leftUserId}:${rightUserId}` : `${rightUserId}:${leftUserId}`;
}

function getLatestAppPresenceEntry(
  state: AppPresenceSnapshot,
  otherUserId: string,
): AppPresencePayload | null {
  const entries = Object.values(state)
    .flat()
    .filter((entry) => entry.kind === 'app' && entry.userId === otherUserId)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

  return entries[0] ?? null;
}

function createConversationController(pairKey: string, currentUserId: string) {
  const channel = supabase.channel(buildTypingBroadcastTopic(pairKey), {
    config: {
      private: true,
      broadcast: {
        self: true,
        ack: false,
      },
      presence: {
        key: currentUserId,
      },
    },
  });

  const controller: ConversationRealtimeController = {
    channel,
    currentUserId,
    isJoined: false,
    consumers: 0,
    presenceListeners: new Set(),
    typingListeners: new Set(),
    disposalTimer: null,
  };

  const notifyPresenceListeners = () => {
    controller.presenceListeners.forEach((listener) => listener());
  };

  channel.on('presence', { event: 'sync' }, notifyPresenceListeners);
  channel.on('presence', { event: 'join' }, notifyPresenceListeners);
  channel.on('presence', { event: 'leave' }, notifyPresenceListeners);
  channel.on('broadcast', { event: TYPING_BROADCAST_EVENT }, ({ payload }) => {
    const typingPayload = payload as TypingBroadcastPayload;

    controller.typingListeners.forEach((listener) => {
      listener(typingPayload);
    });
  });

  channel.subscribe(async (status) => {
    if (status !== 'SUBSCRIBED') {
      return;
    }

    controller.isJoined = true;
    void channel
      .track({
        userId: currentUserId,
        kind: 'app',
        isOnline: true,
        updatedAt: new Date().toISOString(),
      })
      .then(notifyPresenceListeners)
      .catch(() => undefined);
  });

  conversationControllers.set(pairKey, controller);
  return controller;
}

async function removeConversationController(
  pairKey: string,
  controller: ConversationRealtimeController,
) {
  if (conversationControllers.get(pairKey) === controller) {
    conversationControllers.delete(pairKey);
  }

  controller.isJoined = false;
  await controller.channel.untrack().catch(() => undefined);
  const status = await supabase.removeChannel(controller.channel).catch(() => 'error' as const);

  if (status !== 'ok') {
    controller.channel.teardown();
  }
}

function beginConversationControllerRemoval(
  pairKey: string,
  controller: ConversationRealtimeController,
) {
  const existingFlight = conversationRemovalFlights.get(pairKey);

  if (existingFlight) {
    return existingFlight;
  }

  const removalFlight = removeConversationController(pairKey, controller);
  conversationRemovalFlights.set(pairKey, removalFlight);
  void removalFlight.finally(() => {
    if (conversationRemovalFlights.get(pairKey) === removalFlight) {
      conversationRemovalFlights.delete(pairKey);
    }
  });

  return removalFlight;
}

async function acquireConversationController(pairKey: string, currentUserId: string) {
  const removalFlight = conversationRemovalFlights.get(pairKey);

  if (removalFlight) {
    await removalFlight;
  }

  let controller = conversationControllers.get(pairKey);

  if (controller && controller.currentUserId !== currentUserId) {
    await beginConversationControllerRemoval(pairKey, controller);
    controller = undefined;
  }

  controller ??= createConversationController(pairKey, currentUserId);

  if (controller.disposalTimer) {
    clearTimeout(controller.disposalTimer);
    controller.disposalTimer = null;
  }

  controller.consumers += 1;
  return controller;
}

function releaseConversationController(pairKey: string, controller: ConversationRealtimeController) {
  controller.consumers = Math.max(0, controller.consumers - 1);

  if (controller.consumers > 0 || controller.disposalTimer) {
    return;
  }

  controller.disposalTimer = setTimeout(() => {
    controller.disposalTimer = null;
    if (controller.consumers === 0) {
      void beginConversationControllerRemoval(pairKey, controller);
    }
  }, CONVERSATION_CHANNEL_IDLE_MS);
}

async function sendTypingBroadcast(
  controller: ConversationRealtimeController | null,
  payload: TypingBroadcastPayload,
) {
  if (!controller?.isJoined) {
    return;
  }

  await controller.channel.send({
    type: 'broadcast',
    event: TYPING_BROADCAST_EVENT,
    payload,
  });
}

export default function useChatPresence({
  currentUserId,
  otherUserId,
  peerSettings,
  isTyping,
  publishTyping = true,
}: {
  currentUserId: string;
  otherUserId: string;
  peerSettings?: ChatSettings | null;
  isTyping: boolean;
  publishTyping?: boolean;
}) {
  const [peerPresence, setPeerPresence] = useState<ChatPresenceState>({
    isOnline: false,
    isTyping: false,
  });
  const resolvedPeerSettings = peerSettings ?? DEFAULT_CHAT_SETTINGS;
  const pairKey = useMemo(
    () => buildChatPairKey(currentUserId, otherUserId),
    [currentUserId, otherUserId],
  );
  const conversationControllerRef = useRef<ConversationRealtimeController | null>(null);
  const isTypingRef = useRef(isTyping);
  const typingResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  isTypingRef.current = isTyping;

  useEffect(() => {
    let cancelled = false;
    let controller: ConversationRealtimeController | null = null;

    const syncPresenceState = () => {
      if (!controller) {
        return;
      }

      const state = controller.channel.presenceState<AppPresencePayload>();
      const entry = getLatestAppPresenceEntry(state, otherUserId);
      setPeerPresence((current) => ({
        ...current,
        isOnline: resolvedPeerSettings.onlineStatus ? Boolean(entry?.isOnline) : false,
      }));
    };
    const handleTypingBroadcast = (payload: TypingBroadcastPayload) => {
      if (payload.userId !== otherUserId) {
        return;
      }

      if (typingResetTimeoutRef.current) {
        clearTimeout(typingResetTimeoutRef.current);
        typingResetTimeoutRef.current = null;
      }

      setPeerPresence((current) => ({
        ...current,
        isTyping: Boolean(payload.isTyping),
      }));

      if (payload.isTyping) {
        typingResetTimeoutRef.current = setTimeout(() => {
          setPeerPresence((current) => ({
            ...current,
            isTyping: false,
          }));
          typingResetTimeoutRef.current = null;
        }, TYPING_BROADCAST_STALE_MS);
      }
    };

    void acquireConversationController(pairKey, currentUserId).then((nextController) => {
      if (cancelled) {
        releaseConversationController(pairKey, nextController);
        return;
      }

      controller = nextController;
      conversationControllerRef.current = nextController;
      nextController.presenceListeners.add(syncPresenceState);
      nextController.typingListeners.add(handleTypingBroadcast);
      syncPresenceState();

      if (publishTyping && isTypingRef.current) {
        void sendTypingBroadcast(nextController, {
          userId: currentUserId,
          isTyping: true,
          updatedAt: new Date().toISOString(),
        });
      }
    });

    return () => {
      cancelled = true;

      if (controller) {
        if (publishTyping) {
          void sendTypingBroadcast(controller, {
            userId: currentUserId,
            isTyping: false,
            updatedAt: new Date().toISOString(),
          });
        }

        controller.presenceListeners.delete(syncPresenceState);
        controller.typingListeners.delete(handleTypingBroadcast);
        releaseConversationController(pairKey, controller);
      }

      if (conversationControllerRef.current === controller) {
        conversationControllerRef.current = null;
      }

      if (typingResetTimeoutRef.current) {
        clearTimeout(typingResetTimeoutRef.current);
        typingResetTimeoutRef.current = null;
      }
    };
  }, [currentUserId, otherUserId, pairKey, publishTyping, resolvedPeerSettings.onlineStatus]);

  useEffect(() => {
    if (!publishTyping) {
      return;
    }

    const sendCurrentState = (nextIsTyping: boolean) =>
      sendTypingBroadcast(conversationControllerRef.current, {
        userId: currentUserId,
        isTyping: nextIsTyping,
        updatedAt: new Date().toISOString(),
      });

    void sendCurrentState(isTyping);

    const heartbeatId = isTyping
      ? setInterval(() => {
          void sendCurrentState(true);
        }, TYPING_BROADCAST_HEARTBEAT_MS)
      : null;

    return () => {
      if (heartbeatId) {
        clearInterval(heartbeatId);
      }

      void sendCurrentState(false);
    };
  }, [currentUserId, isTyping, pairKey, publishTyping]);

  return peerPresence;
}
