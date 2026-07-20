export interface AppPresencePayload {
  userId: string;
  kind: 'app';
  isOnline: boolean;
  updatedAt: string;
}

export type AppPresenceSnapshot = Record<string, AppPresencePayload[]>;

export function buildAppPresenceTopic(userId: string) {
  return `presence:${userId}`;
}
