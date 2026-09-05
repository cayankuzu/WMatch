import {
  NotificationOutboxPersistenceError,
  persistNotificationEvents,
} from "./notificationOutbox.ts";
import type { SupabaseAdminClient } from "../sharedMiddleware.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const draft = {
  userId: "11111111-1111-4111-8111-111111111111",
  kind: "message" as const,
  routeKind: "chat" as const,
  title: "New message",
  body: "Bounded preview",
};

const mockClient = (result: { data: { id: string } | null; error: unknown }) => ({
  from: () => ({
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve(result),
      }),
    }),
  }),
}) as unknown as SupabaseAdminClient;

Deno.test("notification outbox persistence returns a durable event id", async () => {
  const stored = await persistNotificationEvents(
    mockClient({ data: { id: "event-1" }, error: null }),
    [draft],
  );
  assert(stored[0]?.eventId === "event-1", "durable id must be returned");
});

Deno.test("notification outbox persistence fails loudly without leaking payload", async () => {
  let failure: unknown;
  try {
    await persistNotificationEvents(
      mockClient({ data: null, error: { code: "08006", details: "sensitive" } }),
      [draft],
    );
  } catch (error) {
    failure = error;
  }

  assert(
    failure instanceof NotificationOutboxPersistenceError,
    "DB failure must reject dispatch",
  );
  assert(
    failure instanceof Error && !failure.message.includes(draft.body),
    "failure text must not contain notification content",
  );
  assert(
    failure instanceof NotificationOutboxPersistenceError &&
      failure.databaseCode === "08006",
    "bounded database code must remain observable",
  );
});

