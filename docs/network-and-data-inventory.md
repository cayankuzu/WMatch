# WMatch network and data inventory

Baseline commit: `b8ff52ac41eda5f6ef1e43472784d794328f7050`
Minimum baseline binary: `1.0.50`
Baseline OTA runtime: **unset**
Current target binary/runtime: `1.0.51` / `1.0.51`
Current native builds: Android `53`, iOS `55`
Current required schema target: `20260831153000`

This inventory describes the repository contract, not a claim that a Cloudflare cutover or runtime
deployment exists. The frozen method/path set is also stored in
`quality/feature-surface.snapshot.json`.

## Shared transport contract

`utils/supabase/client.ts` creates the Supabase client and the current Edge base URL.
`fetchWithRetry` applies an `AbortController`, parses `Retry-After`, uses jitter and retries only
GET/HEAD/OPTIONS or a mutation carrying `Idempotency-Key`.

| Code | Timeout/retry/idempotency | Cache/offline |
|---|---|---|
| R | Interactive read: 6 s; bounded 250/650 ms retry plus jitter | Selected API reads use single-flight and a 3.5 s in-memory cache; session purge applies |
| M | Mutation: 10 s; no automatic retry without an idempotency key | No shared cache; caller owns optimistic rollback |
| I | Mutation: 10 s; bounded 500/1,200/2,500 ms retry because an idempotency key is present | No cache; server constraint/RPC/idempotency record must dedupe |
| B | Background: 15 s; bounded 800/2,000/4,000 ms retry when safe | Owner-scoped persisted outbox/snapshot where explicitly listed |
| S | GitHub scheduler: connect 10 s/max 45 s, three curl retries | Service-only outbox; no user response cache |

All API wrapper requests add `x-request-id`; response JSON is parsed once. Authenticated responses
contain user or relationship data and are never eligible for shared edge cache. The baseline client
uses direct Supabase. The current resolver can send only the exact selective allowlist below to
`EXPO_PUBLIC_API_BASE_URL`; every other route remains on the Supabase Function base URL. Repository
resolution logic is not proof that DNS, Worker, WAF, secrets, or production cutover exists.

Test codes: `H`=`tests/edge-http-security.test.ts`, `C`=`tests/production-guards.test.ts`,
`N`=`tests/network-retry.test.ts`, `D`=`supabase/tests/database/*`,
`T`=`tests/components/tmdb-cache.test.tsx`, `O`=chat cache/outbox tests, `P`=push outbox tests/docs.

## Current selective gateway resolution

| Mobile path | Current repository resolution | Cache rule | Runtime evidence |
|---|---|---|---|
| `/health` | Cloudflare only when the configured gateway URL exists | `private, no-store` | PENDING |
| `/auth/check-availability` | Cloudflare only when configured | `private, no-store` | PENDING |
| `/auth/password-reset` | Cloudflare only when configured | `private, no-store` | PENDING |
| `/reports` | Cloudflare only when configured | `private, no-store` | PENDING |
| `/tmdb` and `/tmdb/*` | Cloudflare only when configured | Shared cache only for eligible anonymous public GET | PENDING |
| Every other API path | Direct Supabase Edge Function | User/private data is never shared-cacheable | Provider deployment dependent |

The production Worker workflow requires same-SHA default-branch CI, Quality, and Database validation
runs. Canary requests use Cloudflare version override and require `x-wmatch-edge-version` to equal the
full candidate SHA. No successful provider run has yet been attached to the current candidate.

## Hono Edge Function routes

Auth codes: `P` publishable/anon boundary, `A` verified user bearer plus server-side owner/block/RLS
checks, `S` scheduler secret plus anon gateway key, `W` dedicated worker shared secret. `PII high`
includes email, exact location, message, profile media or device token. Unless marked as an internal
addition, each frozen product route has baseline minimum `1.0.50 / runtime unset`; the current target
is `1.0.51 / runtime 1.0.51`.

| Method/path | Caller | Auth; schema | PII/RLS | Net | Cache/offline | Cloudflare decision | Tests |
|---|---|---|---|---|---|---|---|
| `GET /health` | `api.getHealthStatus` | P; `HealthStatus` | none; schema-contract read | R | no-store | edge candidate, sanitized health only | H,C |
| `POST /tmdb/media-batch` | `tmdb.getMediaListByRefs` | P; media refs -> metadata items | none; no user rows | M | bounded TMDB memory/persistent cache | selected public proxy/cache | T,H,C |
| `GET /tmdb/*` | `tmdb` browse/search/detail calls | P; allowlisted TMDB query -> provider JSON | search text low; no RLS | R | memory + AsyncStorage, 30 m fresh/7 d stale baseline | selected public proxy/cache | T,H,C |
| `POST /auth/check-availability` | `AuthContext.checkAvailability` | P; email/username -> availability | email/username high; service lookup | M | no-store | edge abuse/schema/rate-limit, never cache | H,C,D |
| `POST /auth/password-reset` | `AuthContext.sendPasswordReset` | P; email + trusted redirect -> generic `202` | email high; enumeration-safe target | I | no-store | edge abuse/schema/rate-limit, never cache | H,C |
| `POST /auth/signup` | no current mobile caller; legacy contract | P; signup/profile seed -> result | identity/profile high; service write | M | no-store | compatibility only; protect or retire after usage proof | H,C,D |
| `GET /profile/:userId` | `AuthContext.loadUserProfile` | A; path UUID -> `ApiUser` | profile/photos/location high; visibility/block checks | R | signed photos; no shared cache | direct Supabase/no-store | C,D |
| `PUT /profile` | `AuthContext`, `AppContext` | A; existing profile/media/watch fields -> profile/conflict | profile/location/media high; owner write | I | optimistic/local state; no shared cache | selected schema/abuse edge, no cache | C,D,N |
| `DELETE /account` | `AuthContext.deleteAccount` | A; no body -> deletion saga status | all account data high; owner/service saga | I | purge local cache/outbox/session | selected high-risk edge, no cache | C,D |
| `POST /account-deletion-jobs/resume` | no mobile caller; deletion worker only | W; user UUID -> existing saga status | all account data high; service-only job | I | no-store; idempotent staged resume | internal recovery for existing deletion flow; allowlisted | C,D |
| `GET /watch/live-now` | `api.getLiveNowUsers` | A; cursor/limit -> `LiveNowResponse` | profile/activity medium; block/privacy read model | R | single-flight + 3.5 s client cache | direct Supabase/no-store | C,D,N |
| `GET /users` | `api.getUsers` | A; `activeOnly` -> `ApiUser[]` | profile/location medium/high; block/visibility | R | single-flight + 3.5 s client cache | compatibility route, no shared cache | C,D |
| `GET /swipe-quota` | `api.getSwipeQuota` | A; none -> `SwipeQuotaState` | user usage low; owner row | R | owner-scoped persisted quota snapshot | direct Supabase/no-store | C,D |
| `POST /swipe-quota/consume` | `api.consumeSwipeQuota` | A; kind -> atomic quota state | user usage low; owner RPC | M | optimistic quota rollback | direct; DB is business-quota authority | C,D,N |
| `POST /likes/:userId` | `api.likeUser` | A; source/media -> match/quota result | relationship high; block/target checks | I | optimistic card removal + rollback | direct/no-store; optional abuse edge | C,D,N |
| `POST /likes/:userId/undo` | `api.undoLikeUser` | A; target -> success/quota | relationship high; owner atomic RPC | I | optimistic rollback | direct/no-store | C,D,N |
| `DELETE /likes/:userId` | `api.unlikeUser` | A; target -> success | relationship high; owner pair | M | cache invalidation | direct/no-store | C,D |
| `DELETE /likes/incoming/:userId` | `api.rejectIncomingLike` | A; actor -> success | relationship high; recipient ownership | M | cache invalidation | direct/no-store | C,D |
| `PUT /likes/incoming/:userId/restore` | `api.restoreIncomingLike` | A; actor -> success | relationship high; recipient ownership | M | cache invalidation | direct/no-store | C,D |
| `GET /likes` | `api.getLikes` | A; none -> incoming/outgoing IDs | relationship high; owner/block checks | R | single-flight + 3.5 s client cache | direct/no-store | C,D |
| `GET /discovery/watch` | `api.getWatchDiscoveryUsers` | A; cursor/limit -> discovery page | profile/location high; RLS/block/exclusion | R | single-flight + 3.5 s cache | direct/no-store | C,D,N |
| `GET /discovery/compatibility` | `api.getCompatibilityDiscoveryEntries` | A; cursor/limit -> compatibility page | profile/library high; RLS/block/exclusion | R | single-flight + 3.5 s cache | direct/no-store | C,D,N |
| `GET /discovery/likes` | `api.getLikesDiscovery` | A; none -> likes discovery page | relationship/profile high; entitlement/block | R | single-flight + 3.5 s cache | direct/no-store | C,D |
| `GET /matches` | `api.getMatches` | A; none -> `ApiMatch[]` | relationship/profile high; participant only | R | single-flight + 3.5 s cache | direct/no-store | C,D |
| `PUT /matches/status` | `api.updateMatchStatus`, `endChat` | A; pair/status -> result | relationship high; participant invariant | M | invalidate matches/chats/messages | direct/no-store | C,D,O |
| `GET /blocks` | `api.getBlockedUsers` | A; none -> `ApiUser[]` | safety relationship high; blocker owner | R | no shared cache | direct/no-store | C,D |
| `POST /blocks/:userId` | `api.blockUser` | A; target -> success | safety relationship high; owner/target checks | M | immediate cache/subscription cleanup | selected abuse/schema edge, no cache | C,D,O |
| `DELETE /blocks/:userId` | `api.unblockUser` | A; target -> success | safety relationship high; owner/target checks | M | invalidate discovery/chat/profile | direct/no-store | C,D,O |
| `POST /chats/:userId/hide` | `api.hideChat` | A; peer -> success | relationship high; participant only | M | local chat cache invalidation | direct/no-store | C,D,O |
| `POST /chats/:userId/delete` | `api.deleteChat` | A; mode -> atomic result | messages/relationship high; participant only | M | outbox/cache/thread cleanup | direct/no-store | C,D,O |
| `PUT /chats/:userId/settings` | `api.updateChatSettings` | A; four existing booleans -> settings | preferences medium; owner/pair | M | local settings update | direct/no-store | C,D,O |
| `POST /reports` | `api.submitUserReport` | A; target/reason/details/context -> accepted | safety/profile/message high; reporter/target validation | M | no cache | selected abuse/schema/rate-limit edge, no cache | H,C,D |
| `POST /notifications/push-outbox/drain` | `.github/workflows/push-outbox-drain.yml` | S; no user body -> health/counts | token/job high internally; service only | S | durable DB outbox/DLQ | keep internal; Queue only if measured need | P,C,D |
| `POST /notifications/push-token` | `notifications.registerPushToken` | A; Expo token/platform -> success | device token high; owner row | M | local registration snapshot | direct/no-store | P,C,D |
| `DELETE /notifications/push-token` | `notifications.unregisterPushToken` | A; optional token -> success | device token high; owner row | M | local registration purge | direct/no-store | P,C,D |
| `PUT /notifications/events/:eventId/read` | `api.markNotificationEventRead` | A; event -> success | notification relationship medium; recipient owner | M | local badge/read update | direct/no-store | P,C,D |
| `GET /messages/:userId` | `api.getChatThread` | A; cursor/limit -> thread/page | message text high; participants/block state | R | single-flight + chat cache; no shared cache | direct/no-store | C,D,O,N |
| `POST /messages/:userId` | `api.sendMessage`, chat outbox | A; text + client IDs -> `ApiMessage` | message text high; participants/block state | I when client ID exists | persistent owner outbox/replay | direct/no-store | C,D,O,N |
| `PUT /messages/thread/:userId/read` | `api.markChatThreadRead` | A; peer -> success | message metadata medium; receiver/participant | M | optimistic read state | direct/no-store | C,D,O |
| `PUT /messages/:messageId/read` | `api.markMessageRead` | A; message ID -> success | message metadata medium; receiver owner | M | optimistic read state | direct/no-store | C,D,O |
| `GET /chats` | `api.getChats` | A; cursor/limit -> chat directory | message summary/profile high; participant/block | R | single-flight + chat cache | direct/no-store | C,D,O,N |

## Direct Supabase SDK contracts

These do not move through a Worker. They use the same Supabase client transport and authenticated
session, and PostgreSQL RLS/Realtime authorization remains authoritative.

| Caller | Operation/schema | Auth and PII | Retry/idempotency/cache | Cloudflare decision | Tests |
|---|---|---|---|---|---|
| `AuthContext.tsx` | `auth.signInWithPassword`, `signUp`, `resetPasswordForEmail`, `updateUser`, refresh/sign-out/session reads | Supabase Auth; credentials/token high | SDK request through bounded transport; auth state is SecureStore-backed; refresh synchronization in context | always direct Supabase Auth | C,N |
| `storage.ts` | `storage.from('profile-photos').upload/remove/createSignedUrl/getPublicUrl` | authenticated owner path; private media high | upload validation/abort, deterministic owner path; mutations are not shared-cacheable | always direct private Storage | C,D, component storage tests |
| `presence.ts`, `userEventBus.ts`, chat presence hooks | Realtime broadcast/presence/postgres changes | authenticated private topics; presence/typing medium | reconnect lifecycle and session cleanup; never shared cache | always direct Supabase Realtime | C,D, chat presence tests |
| `chatCache.ts`, `chatOutbox.ts`, snapshot services | AsyncStorage owner-scoped cached responses/outbox | local user data high | schema/owner keys, bounded TTL/replay and auth purge | local only | O, network-fault tests |

## Request/response validation and RLS notes

- Mobile validation types live in `src/services/api/contracts.ts`, `validation.ts` and
  `shared/utils/apiValidation.ts`; the Edge function performs its own body/path validation.
- Service-role access is confined to the Edge function. Mobile bundles use only public Supabase
  configuration and the current user's bearer token.
- RLS/IDOR coverage is in `supabase/tests/database/rls_attack_matrix.sql` and related SQL suites;
  static presence is not a substitute for executing them against a clean database.
- Profile, discovery, likes, matches, blocks, reports, chat, messages, notifications and private
  media are user-specific and default to `private, no-store` at any future edge boundary.
- Only TMDB/public metadata is eligible for shared cache, after query allowlisting, normalized keys,
  provider error exclusions and leakage tests.

## Known baseline and current deployment gaps

- The baseline has no runtime version, stable `api.*` host, Cloudflare route matrix or Worker.
- The current repository has runtime and Worker contracts, but stable DNS/WAF/secrets, rollout,
  rollback, origin cutover, budget, and observability evidence is still absent.
- Several mutations rely on atomic DB constraints rather than a client idempotency header and are
  intentionally not automatically retried; each must retain a server invariant test.
- The Edge `auth/signup` route has no current mobile caller. It must remain compatibility-only until
  production usage is measured; removal is not allowed by feature freeze without a compatibility
  decision.
- Arbitrary external profile-photo strings are accepted by the baseline sanitizer. Closing that P0
  boundary must preserve the existing profile/edit-profile UI and Storage bucket.
- Same-SHA k6, device, provider-outage and cursor-gap evidence is not present.
- Push token/provider/outbox/device requirements are defined in `docs/push-current-contract.md`,
  `docs/push-provider-and-token-lifecycle.md`, `docs/push-outbox-retry-receipt-dlq.md`, and
  `docs/push-real-device-matrix.md`; every current real-device/provider row remains pending.
