# Push notification current contract

Target: app/runtime `1.0.51`, Android `53`, iOS `55`

Status: **repository contract implemented; production/provider/device evidence pending; release NO-GO**.
This document describes the current code path. It is not proof that Expo, FCM, APNs, the scheduler,
or a store binary is correctly configured.

## End-to-end path

1. An existing product action creates one `notification_events` row through the Supabase Edge
   Function. The database row is the durable event and push outbox record.
2. A private `notification_changed` broadcast gives an active recipient the same event without
   waiting for remote push.
3. The Edge runtime claims due jobs with `claim_push_delivery_jobs`; claims use a processing lease
   and `FOR UPDATE SKIP LOCKED`.
4. Immediately before the external provider call, `authorize_push_delivery_job` locks the event/
   relationship decision. Blocked or inactive pairs, recipient-deleted chats, and disabled chat
   notifications become terminal `suppressed` events and never reach Expo.
5. Each registered device is submitted separately to Expo Push. Accepted ticket IDs are persisted
   in the service-only `push_delivery_receipts` table.
6. The scheduled `push-outbox-drain.yml` workflow drains event jobs and due receipts every five
   minutes, then fails closed when dead, stalled, receipt-failed, or receipt-stalled work exists.
7. The mobile client maps a notification tap only to an existing `likes` or `chat` destination.

No Cloudflare Worker route is used for push delivery. Token registration, read state, and the
service-only drain endpoint remain on the Supabase Edge Function.

## Frozen notification surface

| Event kind | Route kind | Required payload identity | Existing destination |
|---|---|---|---|
| `like` | `likes` | `eventId`; optional `sourceType` | Likes, `likedme` tab |
| `match` | `chat` | `eventId`, peer `userId`; optional `sourceType` | Existing chat thread |
| `message` | `chat` | `eventId`, peer `userId` | Existing chat thread; mark thread read |
| `chat_ended` | `chat` | `eventId`, peer `userId` | Existing chat thread/state |
| `chat_blocked` | `chat` | `eventId`, peer `userId` | Existing chat thread/state |
| `chat_unblocked` | `chat` | `eventId`, peer `userId` | Existing chat thread/state |

Unknown, malformed, or unsupported payloads do not create a new route. They are ignored by
`parseNotificationIntent`. Adding another event kind, route kind, CTA, tab, screen, or navigation
destination is a product-surface change and is outside the feature freeze.

## Payload and presentation invariants

- Provider payload data uses `type`, `eventId`, `routeKind`, and peer `userId`; arbitrary URLs are
  not accepted as navigation targets.
- `eventId` is the preferred presentation/dedupe key. `notificationTag` or `collapseId` is the group
  key when explicitly supplied.
- Foreground private broadcasts and remote notifications converge on the same local presentation
  path. A bounded in-memory key set suppresses immediate duplicate presentation.
- Android uses channel `wmatch-alerts-v2`. A disabled app/channel is reported as
  `settings-required`; the code does not silently claim registration success.
- Authenticated token and read-state mutations are `private, no-store`. Device tokens, titles,
  bodies, message text, and user identifiers must not appear in CI artifacts or general logs.

## Authorization boundaries

| Operation | Boundary |
|---|---|
| Register/delete token | Verified user bearer; owner-scoped mutation and abuse rate limit |
| Mark event read | Verified user bearer plus `user_id` equality |
| Claim/complete event or receipt jobs | `service_role`-only PostgreSQL functions |
| Final pre-send authorization/suppression | `service_role` RPC plus pair advisory lock and current relationship/preferences |
| Drain scheduler | Supabase gateway JWT plus independent `X-WMatch-Worker-Secret` |
| Device token and receipt tables | RLS enabled; anon/auth table access revoked for service-only paths |

The scheduler secret is not a mobile credential and must never use the Supabase service-role key as
its value.

## Source of truth and verification

- Mobile lifecycle: `src/services/notifications.ts`
- Mobile HTTP calls: `src/services/api.ts`
- Edge routes: `supabase/functions/make-server-d962235e/domains/notification.ts`
- Delivery runtime: `supabase/functions/make-server-d962235e/runtime.ts`
- Durable schema: migrations containing `notification_events`, `claim_push_delivery_jobs`, and
  `push_delivery_receipts`
- Scheduler: `.github/workflows/push-outbox-drain.yml`
- Static/contract checks: `tests/production-guards.test.ts` and `supabase/tests/database/`

Repository tests establish code and schema intent only. A GO decision still requires the same-SHA
real-device matrix in `docs/push-real-device-matrix.md`, provider receipt evidence, protected
environment configuration, and an observed scheduler run.
