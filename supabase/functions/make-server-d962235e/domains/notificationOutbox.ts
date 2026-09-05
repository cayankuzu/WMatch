import type { Json } from "../../../types/database.generated.ts";
import type { SupabaseAdminClient } from "../sharedMiddleware.ts";

export type NotificationEventKind =
  | "like"
  | "match"
  | "message"
  | "chat_ended"
  | "chat_blocked"
  | "chat_unblocked";
export type NotificationRouteKind = "likes" | "chat";

export interface NotificationEventDraft {
  userId: string;
  actorUserId?: string | null;
  kind: NotificationEventKind;
  routeKind: NotificationRouteKind;
  routeUserId?: string | null;
  title: string;
  body: string;
  payload?: { [key: string]: Json | undefined };
}

export class NotificationOutboxPersistenceError extends Error {
  readonly databaseCode: string;

  constructor(databaseCode: string) {
    super("notification_outbox_persistence_failed");
    this.name = "NotificationOutboxPersistenceError";
    this.databaseCode = databaseCode;
  }
}

export const persistNotificationEvents = async (
  supabase: SupabaseAdminClient,
  notifications: NotificationEventDraft[],
) =>
  Promise.all(notifications.map(async (notification) => {
    const { data, error } = await supabase
      .from("notification_events")
      .insert({
        user_id: notification.userId,
        actor_user_id: notification.actorUserId ?? null,
        kind: notification.kind,
        route_kind: notification.routeKind,
        route_user_id: notification.routeUserId ?? null,
        title: notification.title,
        body: notification.body,
        payload: notification.payload ?? {},
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      throw new NotificationOutboxPersistenceError(
        typeof error?.code === "string" ? error.code : "missing_event_id",
      );
    }

    return { ...notification, eventId: data.id };
  }));

