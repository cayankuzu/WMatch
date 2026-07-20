import { supabase } from '../../utils/supabase/client';

export type UserEventName = 'chat_changed' | 'discovery_changed' | 'notification_changed';
export type UserEventStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';
type EventListener = (payload: unknown) => void;
type StatusListener = (status: UserEventStatus) => void;

interface UserEventConnection {
  channel: ReturnType<typeof supabase.channel>;
  eventListeners: Map<UserEventName, Set<EventListener>>;
  statusListeners: Set<StatusListener>;
  status: UserEventStatus | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
}

const EVENT_NAMES: UserEventName[] = ['chat_changed', 'discovery_changed', 'notification_changed'];
const connections = new Map<string, UserEventConnection>();

function createConnection(userId: string) {
  const channel = supabase.channel(`user-events:${userId}`, {
    config: { private: true },
  });
  const connection: UserEventConnection = {
    channel,
    eventListeners: new Map(EVENT_NAMES.map((event) => [event, new Set<EventListener>()])),
    statusListeners: new Set(),
    status: null,
    closeTimer: null,
  };

  EVENT_NAMES.forEach((event) => {
    channel.on('broadcast', { event }, ({ payload }) => {
      connection.eventListeners.get(event)?.forEach((listener) => listener(payload));
    });
  });

  channel.subscribe((status) => {
    const nextStatus = status as UserEventStatus;
    connection.status = nextStatus;
    connection.statusListeners.forEach((listener) => listener(nextStatus));
  });
  connections.set(userId, connection);
  return connection;
}

function connectionHasListeners(connection: UserEventConnection) {
  if (connection.statusListeners.size > 0) {
    return true;
  }

  return [...connection.eventListeners.values()].some((listeners) => listeners.size > 0);
}

function scheduleConnectionClose(userId: string, connection: UserEventConnection) {
  if (connectionHasListeners(connection) || connection.closeTimer) {
    return;
  }

  connection.closeTimer = setTimeout(() => {
    connection.closeTimer = null;
    if (connectionHasListeners(connection) || connections.get(userId) !== connection) {
      return;
    }

    connections.delete(userId);
    void supabase.removeChannel(connection.channel);
  }, 100);
}

export function subscribeToUserEvent(
  userId: string,
  event: UserEventName,
  listener: EventListener,
  onStatus?: StatusListener,
) {
  const connection = connections.get(userId) ?? createConnection(userId);
  if (connection.closeTimer) {
    clearTimeout(connection.closeTimer);
    connection.closeTimer = null;
  }

  connection.eventListeners.get(event)?.add(listener);
  if (onStatus) {
    connection.statusListeners.add(onStatus);
    if (connection.status) {
      onStatus(connection.status);
    }
  }

  return () => {
    connection.eventListeners.get(event)?.delete(listener);
    if (onStatus) {
      connection.statusListeners.delete(onStatus);
    }
    scheduleConnectionClose(userId, connection);
  };
}
