# WMatch existing feature contract

Baseline repository: `cayankuzu/WMatch`
Immutable baseline commit: `b8ff52ac41eda5f6ef1e43472784d794328f7050`
Captured: 2026-08-30

This is the product-surface contract for the AAA-MVP hardening branch. The machine-readable
counterpart is `quality/feature-surface.snapshot.json`; `npm run check:feature-surface` must pass
before a change can be treated as feature-freeze compliant. Internal security, delivery, audit,
telemetry, Cloudflare and OTA work may harden the flows below, but may not create another user job.

## Existing user feature set

| Existing surface         | Existing user job                                                                                                                | Primary repository entrypoints                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication           | Register, sign in, request/reset a password, verify email, sign out                                                              | `LoginScreen.tsx`, `SignUpScreen.tsx`, `ForgotPasswordScreen.tsx`, `PasswordRecoveryScreen.tsx`, `VerifyEmailScreen.tsx`, `AuthContext.tsx` |
| Watch home               | Browse/search movie and series metadata, inspect details, manage currently-watching state and see live-now activity              | `WatchScreen.tsx`, `MovieDetailModal.tsx`, `CurrentMovieBar.tsx`, `useWatchHomeController.ts`, `tmdb.ts`                                    |
| Discovery filters        | Change the existing gender, age, distance and compatibility ranges                                                               | `DiscoveryFiltersModal.tsx`, `shared/utils/discovery.ts`                                                                                    |
| Match                    | Browse the existing match discovery deck and like/dislike/undo                                                                   | `MatchScreen.tsx`, `SwipeModal.tsx`, `SwipeQuotaBar.tsx`                                                                                    |
| Compatibility            | Browse compatibility-ranked profiles and the existing compatibility explanation                                                  | `CompatibilityScreen.tsx`, `CompatibilitySheet.tsx`, `shared/utils/compatibility.ts`                                                        |
| Likes                    | View existing incoming/outgoing like states and act on them                                                                      | `LikesScreen.tsx`, `likes/LikesGridPage.tsx`                                                                                                |
| Chat                     | List conversations, open a thread, send/read messages and use existing typing, online, read-receipt and notification settings    | `ChatScreen.tsx`, `ChatModal.tsx`, `ChatSettingsModal.tsx`, `chat/*`, `chatOutbox.ts`                                                       |
| Profile                  | View own/other profiles, edit existing identity/bio/location/media fields and reorder profile photos                             | `ProfileScreen.tsx`, `ProfileModal.tsx`, `ProfileViewer.tsx`, `EditProfileModal.tsx`                                                        |
| Safety                   | Block/unblock and report through the existing profile/chat actions                                                               | `BlockedUsersModal.tsx`, `ChatReportForm.tsx`, `api.ts`                                                                                     |
| Notifications/deep links | Receive the existing like, match, message and chat-state notifications and route to Likes or Chat                                | `notifications.ts`, `src/app/App.tsx`, Expo config                                                                                          |
| Settings                 | Use the existing profile, discovery, privacy/about and account rows; toggle age/gender visibility; log out or delete the account | `SettingsModal.tsx`                                                                                                                         |

The repository contains an entitlement/locked-filter data boundary and legacy `premium` copy, but
it contains no payment or purchase flow. This contract does not authorize adding one.

## Navigation and visible entrypoints

WMatch does not use a route-library registry. Navigation is a closed state machine in
`src/app/App.tsx`, `src/shared/types/index.ts` and `src/app/tabModules.ts`.

- Auth states: `login`, `signup`, `forgot`; guarded states: `password-recovery`, `verify-email`.
- Tabs: `watch`, `match`, `compatibility`, `likes`, `chat`, `profile` (six total).
- Screens (13): `Chat`, `Compatibility`, `ForgotPassword`, `Likes`, `Loading`, `Login`, `Match`,
  `PasswordRecovery`, `Profile`, `SignUp`, `Splash`, `VerifyEmail`, `Watch`.
- Product modals (12): `BlockedUsers`, `Chat`, `ChatSettings`, `DiscoveryFilters`, `EditProfile`,
  `ImagePreview`, `MatchSuccess`, `MovieDetail`, `Profile`, `ResetPassword`, `Settings`, `Swipe`.
- Sheets (2): `CompatibilitySheet`, `MatchContextSheet`.

`ui/Screen.tsx`, `ui/AppModal.tsx` and `ui/AccessibleModal.tsx` are primitives, not additional
product surfaces.

### Frozen filters and settings

- Discovery fields: `genderPreference`, `ageMin`, `ageMax`, `distanceMinKm`, `distanceMaxKm`,
  `compatibilityMin`, `compatibilityMax`.
- Discovery gender values: `random`, `female`, `male`, `nonbinary`.
- Chat list filters: `all`, `unread`, `read`, `ended`, `blocked`.
- Settings groups: `profile`, `discovery`, `privacy`, `account`.
- Settings rows/links: edit profile, profile visibility, filters, password, blocked users, about,
  privacy, terms, TMDB attribution, logout and delete account.
- Settings toggles: show age and show gender.

## Existing API and data access surface

The mobile application currently derives `SUPABASE_URL` from
`EXPO_PUBLIC_SUPABASE_PROJECT_ID`. Auth, PostgreSQL/RLS, Realtime and Storage are direct Supabase
contracts. The baseline HTTP application contract is the 40-route Hono function under
`/functions/v1/make-server-d962235e`; it is enumerated in
`docs/network-and-data-inventory.md` and frozen in the JSON snapshot. Current hardening adds one
worker-secret-only recovery route for the existing account deletion saga; it has no mobile caller
and is recorded as an internal allowlist entry.

Mobile HTTP callers are concentrated in:

- `src/services/api.ts`: profile, discovery, swipe/quota, likes, match, block/report, chat,
  notification and account mutations;
- `src/services/tmdb.ts`: existing TMDB metadata proxy routes;
- `src/services/storage.ts`: private `profile-photos` Storage operations and signed URLs;
- `utils/supabase/client.ts`: Supabase client, auth storage, timeout/retry transport;
- `src/services/presence.ts`, `src/services/userEventBus.ts` and chat presence hooks: Realtime.

The API route set, auth mode, PII/RLS boundary, retry/idempotency behavior and tests are recorded in
the network inventory. New internal Worker routes do not become user-facing routes and must be
explicitly allowlisted by the feature guard.

## Notifications

Frozen event types from `NotificationEventKind`:

- `like`
- `match`
- `message`
- `chat_ended`
- `chat_blocked`
- `chat_unblocked`

Frozen navigation targets are `likes` and `chat`. The Android application creates the existing
`wmatch-alerts-v2` and compatibility `default` channels. No new notification category is allowed.

## Permissions, links and native capabilities

Expo-declared Android permissions:

- `android.permission.ACCESS_COARSE_LOCATION`
- `android.permission.ACCESS_FINE_LOCATION`
- `android.permission.POST_NOTIFICATIONS`

The checked-in Android manifest additionally contains `INTERNET`, `VIBRATE` and the bounded legacy
`READ_EXTERNAL_STORAGE` permission with `maxSdkVersion=32`; camera, audio recording, overlay and
write-external-storage permissions are explicitly removed.

iOS usage descriptions are limited to photo-library selection and when-in-use location. Existing
native capabilities are tablet support, predictive back, secure auth storage, push/background
remote notification configuration and associated domains.

Existing link contracts:

- custom scheme: `wmatch://`;
- verified HTTPS host: `cayankuzu.github.io`;
- Android auth path prefix: `/WMatch_web/auth`;
- iOS associated domain: `applinks:cayankuzu.github.io`.

Changing infrastructure behind the existing auth/deep-link contract is allowed only with native
parity, compatibility and rollback evidence. It does not authorize a new public page.

## Database domains and Storage

User-visible domain state is held by `profiles`, `profiles_private`, `discovery_preferences`,
`user_movies`, `currently_watching`, `likes`, `matches`, `messages`, `chat_settings`, `hidden_chats`,
`swipe_quotas`, `user_blocks`, `moderation_reports`, `notification_events` and
`user_entitlements`.

Supporting internal state at the baseline is held by `account_deletion_jobs`,
`chat_pair_summaries`, `chat_repair_audit`, `device_push_tokens`, `push_delivery_receipts`,
`kv_store_d962235e`, `media_identity_repair_history`, `media_identity_repair_queue`,
`mutation_idempotency_records`, `request_rate_limits` and `schema_contracts`.

The only application Storage bucket declared by repository migrations is `profile-photos`. It is
private at the current schema boundary. New buckets or product-domain tables are frozen. A new
service-only audit/outbox/delivery table requires a narrow snapshot allowlist record naming its
existing flow, reason and implementation path.

## Explicitly out of scope

Do not add a new screen, tab, top-level modal, route, onboarding step, setting group, CTA, filter,
content type or notification category. In particular, calendar/reminder, QR, waitlist, saved
search, dark theme, payment/premium purchase, ads, profile verification badge, “why suggested”,
watch party, calling, public profile page, safety center and admin/moderator/organizer panels are
not part of WMatch's frozen feature set.

## Contract verification

Run:

```bash
npm run check:feature-surface
npx vitest run tests/feature-surface-guard.test.ts
```

At capture time the expected product counts are six tabs, 13 screens, 12 product modals, two
sheets, 40 baseline Hono routes and 26 baseline database tables. The current collector sees 41
routes and 28 tables only because the worker-secret account-deletion recovery route plus the
service-role-only `moderation_report_audit_events` and `edge_origin_hmac_nonces` tables are reviewed
internal security/ops additions. None is a product domain or user journey. A removal is also a
contract change: final and baseline user feature lists must remain equal.
