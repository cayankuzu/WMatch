# WMatch Production Readiness Status

Date: 2026-07-16
Source checklists:

- `C:\Users\Cayan\Desktop\WMATCH_10_10_UYGULAMA_REHBERI.md`
- `C:\Users\Cayan\Desktop\WMATCH_10_10_UI_FIX_REHBERI.md`
- `C:\Users\Cayan\Desktop\WMATCH_1_0_27_FINAL_REAUDIT_FIX.md`
- `C:\Users\Cayan\Desktop\WMATCH_B17FB436_ALL_MD_FINAL_VERIFICATION.md`

This file tracks what is actually complete in the repository after the hardening and UI pass. AAWmatch defines 10/10 as code plus automated and manual evidence; therefore items that still need device, staging, store, load, RLS, UI screenshot, screen-reader, or operations evidence are not marked fully 10/10.

## Latest Local Verification

- Current release version: `1.0.32`; Android `versionCode` `33`; iOS `buildNumber` `35`.
- Supabase migrations/functions: checked and deployed on 2026-07-16 to project `eaggwbuvpfzrejamwqry`; linked migration push reported `Remote database is up to date`, function deploy succeeded, and live health smoke returned `release=1.0.32`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `a734a99b-3113-40c3-892a-ef405e5c7769`.
- `npm run check`: passed on 2026-07-16 after bottom tab warm-mounting, discovery cache, and render dedupe performance fixes.
- `cd android && .\gradlew.bat clean`: passed on 2026-07-16 for `1.0.32`.
- `cd android && .\gradlew.bat :app:bundleRelease`: passed on 2026-07-16 for `1.0.32`; AAB SHA-256 is recorded in `docs/release/1.0.32/evidence.md` and copied to `C:\Users\Cayan\Desktop\WMatch-1.0.32-vc33-release.aab`.
- Previous release `1.0.31`: Supabase migrations/functions were checked and deployed on 2026-07-16 to project `eaggwbuvpfzrejamwqry`; linked migration push reported `Remote database is up to date`, function deploy succeeded, and live health smoke returned `release=1.0.31`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `a1f50548-eb7c-41fa-80de-f0a9ff23c131`.
- Previous Android `1.0.31`: `cd android && .\gradlew.bat clean` and `cd android && .\gradlew.bat :app:bundleRelease` passed on 2026-07-16; AAB SHA-256 is recorded in `docs/release/1.0.31/evidence.md` and copied to `C:\Users\Cayan\Desktop\WMatch-1.0.31-vc32-release.aab`.
- `npm audit --omit=dev`: passed on 2026-07-16 with 0 vulnerabilities.
- `npx expo install --check`: passed on 2026-07-16; dependencies are up to date.
- `npm run doctor`: passed on 2026-07-16 with 20/20 checks after one transient `exp.host:443` timeout retry.
- Previous release `1.0.30`: Supabase migrations/functions were checked and deployed on 2026-07-15 to project `eaggwbuvpfzrejamwqry`; linked migration push reported `Remote database is up to date`, function deploy succeeded, and live health smoke returned `release=1.0.30`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `187b374b-67df-41f3-a3ea-c8348c403724`.
- Previous Android `1.0.30`: `cd android && .\gradlew.bat clean` and `cd android && .\gradlew.bat :app:bundleRelease` passed on 2026-07-15; AAB SHA-256 is recorded in `docs/release/1.0.30/evidence.md` and copied to `C:\Users\Cayan\Desktop\WMatch-1.0.30-vc31-release.aab`.
- Supabase migrations/functions: checked and deployed on 2026-07-15 to project `eaggwbuvpfzrejamwqry`; linked migration push reported `Remote database is up to date`, function deploy succeeded, and live health smoke returned `release=1.0.29`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `de5dfd01-439e-4941-9e1f-79a4ce6e840f`.
- `cd android && .\gradlew.bat clean`: passed on 2026-07-15 for `1.0.29`.
- `cd android && .\gradlew.bat :app:bundleRelease`: passed on 2026-07-15 for `1.0.29`; AAB SHA-256 is recorded in `docs/release/1.0.29/evidence.md` and copied to `C:\Users\Cayan\Desktop\WMatch-1.0.29-vc30-release.aab`.
- Supabase migrations/functions: deployed on 2026-07-15 to project `eaggwbuvpfzrejamwqry`; live health smoke returned `release=1.0.28`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `e65cf6bb-de65-41d7-9983-9434162119e9`. `20260715201000_p0_reaudit_closures.sql` was applied with `npx supabase db query --linked --file` because `db push` hit the known Windows file-open issue; migration history was repaired to `applied`, then dry-run reported the remote database is up to date.
- Final 90 Plus evidence added under `docs/release/final-90-plus/`; public production verdict remains `NO-GO` until manual owner/store/device/security evidence is complete.
- `npm run verify:release`: passed on 2026-07-15; includes format, source-quality, signing, secrets, i18n, TypeScript, split Vitest suites, migration/edge guards, npm audit, Expo dependency check, and Expo Doctor.
- Supabase health re-smoke with anon auth passed on 2026-07-15; `release=1.0.28`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `18f7a5b3-6c01-4e25-8c42-d460b0a2265f`.
- `npm run check`: passed on 2026-07-15 after Final 90 Plus repository updates; signing guard, secret guard, i18n parity, TypeScript, and 45 Vitest tests.
- `npm audit --omit=dev`: passed on 2026-07-15 with 0 vulnerabilities.
- `npx expo install --check`: passed on 2026-07-15 after Expo SDK 56 patch alignment.
- `npm run doctor`: passed on 2026-07-15 with 20/20 checks. The non-CNG native-config check is explicitly disabled through Expo Doctor's supported `expo.doctor.appConfigFieldsNotSyncedCheck.enabled=false` setting because this repository has checked-in native Android sources.
- `cd android && .\gradlew.bat clean`: passed on 2026-07-15.
- `cd android && .\gradlew.bat :app:bundleRelease`: passed on 2026-07-15; AAB SHA-256 is recorded in `docs/release/1.0.28/evidence.md` and copied to `C:\Users\Cayan\Desktop\WMatch-1.0.28-vc29-release.aab`.
- `npm run check`: passed on 2026-07-14; signing guard, secret guard, i18n parity, TypeScript, and 19 Vitest tests.
- `npm audit --omit=dev`: passed on 2026-07-14 with 0 vulnerabilities.
- `npx expo install --check`: passed on 2026-07-14.
- `npx expo export --platform android --output-dir .expo-export-check/android`: passed on 2026-07-14.
- `npx expo export --platform ios --output-dir .expo-export-check/ios`: passed on 2026-07-14.
- `npx expo export --platform android --output-dir .expo-export-check/android-ui`: passed on 2026-07-14.
- `npx expo export --platform ios --output-dir .expo-export-check/ios-ui`: passed on 2026-07-14.
- `npm run check:secrets`: passed after export on 2026-07-14.
- `git diff --check`: passed on 2026-07-14 with CRLF conversion warnings only.
- `cd android && .\gradlew.bat :app:bundleRelease`: passed on 2026-07-14; AAB SHA-256 is recorded in `docs/release/1.0.26/evidence.md`.
- Static production guard tests now cover public Supabase env fallback removal, PKCE/raw-token deep-link rejection, `exp+wmatch:` trust removal, discovery polling removal, no global `currently_watching` client subscription, Edge wildcard/empty select removal, private location migration, direct DML revoke migration, protected release identity, bounded compatibility discovery, typed media collection RPC, typed movie/TV compatibility collision handling, media repair history, Live Now RPC tuple cursor path, structured Edge request logging, Edge health schema readiness, chat stats and legacy message-peer recovery RPCs, chat repair audit/backfill functions, watch CAS transition RPC, no empty read fallbacks, private chat presence lifecycle, signup local-photo metadata blocking, post-verification signup draft photo finalize, likes pager responsive grids, profile image galleries, merged Expo/native Android release permissions, blocking CI Doctor/dependency checks, focus-aware tab mounting, scalable UI typography, and required UI hardening primitives.
- `deno --version`: not available on this Windows workspace; Edge function Deno typecheck still needs a Deno/Supabase CLI environment.

## Work Package Matrix

| ID | Status | Repository evidence | Remaining evidence/work |
|---|---|---|---|
| BASE-001 | Partial | `docs/release/baseline.md`, npm lock, local command list | Physical-device profiles, iOS archive hash, production release evidence |
| BASE-002 | Complete for repo guard | `scripts/check-signing-identity.mjs`, CI job, Android SHA-1 guard, EAS owner/project guard | Real store credential build must be run by release owner |
| BASE-003 | Partial | TMDB key removed from mobile source, Supabase public env fallback removed, secret guard scans tracked and untracked files | Rotate leaked TMDB key and inventory provider secrets manually |
| SEC-001 | Partial | Public DTO allowlisting, explicit Edge select lists, `profiles_private` location migration, location omitted from Edge payloads, regression guard tests | Apply migration in Supabase, recursive payload contract test, staging RLS attack pack |
| SEC-002 | Partial | Hardening migration revokes direct DML and blocks critical table DML | Apply migration in Supabase and run RLS attack tests |
| SEC-003 | Partial | SecureStore auth adapter, native fail-closed storage, backup disabled, logout/delete cleanup path | Native reinstall/backup/device-lock tests |
| SEC-004 | Partial | Supabase PKCE flow enabled, trusted auth link allowlist, raw access/refresh token deep links rejected | Associated Domains, assetlinks, replay/negative link matrix |
| SEC-005 | Partial | Generic password reset, e-mail availability no longer enumerates, rate limits | Credential-stuffing alarms and proxy trust policy |
| SEC-006 | Partial | Token previews removed, API support headers added, structured Edge request logger avoids query/body/token logging | PII canary, retention/access policy |
| SEC-007 | Partial | npm audit, dependency pinning/override, CI guards | SBOM/license/provenance and hosted secret scanning |
| API-001 | Partial | API headers, typed client surfaces, safer errors, no Edge wildcard/empty selects | Full schema/OpenAPI generation and contract snapshot suite |
| API-002 | Complete for client wrapper | Timeout/retry/idempotency-aware fetch wrapper | Network fault suite on device/staging |
| API-003 | Partial | Idempotent mutation keys and message `client_message_id` uniqueness | Generic idempotency table, conflict hashing, TTL cleanup job |
| DATA-001 | Partial | Movie sync uses service-only typed `replace_user_media_collections` RPC; `user_movies` PK includes `media_type`; compatibility scoring now keys by `mediaType:id`; legacy integer RPC is redefined to delete/insert only `media_type='movie'`; repair queue resolver writes media repair history before changing legacy assumed-movie rows | Apply `20260715201000` remotely, run catalog repair with audit export, and add service-role fixture tests |
| DATA-002 | Partial | Account deletion cleanup improved | Full resumable deletion saga, DLQ, legal retention policy |
| CHAT-001 | Partial | Chat pagination, cursor API, optimistic `client_message_id` merge; legacy message history can be read without re-enabling sends when no match exists | Same-timestamp keyset proof and E2E scroll tests |
| CHAT-002 | Partial | Chat list stats remain bounded; message-peer RPC restores legacy chat list rows; `chat_repair_audit` plus service-role apply function supports approved backfill | Conversation summary table, atomic unread counters, drift job, remote audit/backfill run |
| CHAT-003 | Partial | Idempotent message insert and redacted push logs | Durable notification outbox/DLQ |
| CHAT-004 | Partial | Client uses private user/conversation Realtime channels for app/chat presence and typing lifecycle | Supabase-managed `realtime.messages` policies require owner/dashboard authorization; load and attack tests |
| DISC-001 | Partial | Server-side filtering, bounded hydration, compatibility candidate pool capped at 320 rows | Full SQL/PostGIS scoring cursor and query-plan evidence |
| DISC-002 | Complete for app code | Interval polling removed; scoped Realtime, foreground fallback, and no global client subscription to `currently_watching` | Reconnect/load tests |
| DISC-003 | Partial | Live Now uses DB RPC with block prefiltering and tuple cursor; client merges/dedupes paged results and preserves last good data on refresh error | Synthetic 10k row load/query-plan evidence and private live event invalidation |
| MEDIA-001 | Partial | Storage bucket migration and public path cleanup | Private/signed media model and retention policy |
| MEDIA-002 | Complete for app code | Picker uses URI only; local JPEG normalization and size cap | Low-memory/device interruption tests |
| MEDIA-003 | Partial | Upload concurrency bounded and rollback cleanup exists | Upload session/resume/progress/idempotency |
| MEDIA-004 | Partial | Removed-photo cleanup and storage policies | Variant worker, atomic finalize, orphan cleanup job |
| MEDIA-005 | Partial | Signup auth metadata filters out local `file://` photos; non-password signup draft is retained through mail verification and finalized after verified session sync when the server profile has no photos | Registration upload session/finalize worker, draft expiry cleanup, and cross-device post-verification proof |
| ARCH-001 | Partial | Edge API safer but still large single module | Modular monolith extraction |
| ARCH-002 | Partial | Safer transport, persistent TMDB stale cache, bounded caches | Server-state/query layer and full cache invalidation model |
| ARCH-003 | Partial | Some state/hook isolation improved | Full context split and account-isolation tests |
| ARCH-004 | Not complete | Existing navigation retained | Router/native navigation migration requires product QA |
| ARCH-005 | Partial | Optimistic send/retry primitives and durable movie-library outbox exist | Full offline conflict policy and E2E reconnect suite |
| ARCH-006 | Partial | Shared UI controls improved | Duplication gate and domain component split |
| UX-001 | Partial | Semantic UI tokens, layout tokens, `useWindowClass`, `Screen`, `AppButton`, `AppTextField`, chips, segmented controls, bottom navigation, and touched target sizing improved | Design QA screenshots for all states and device widths |
| UX-002 | Partial | Reduce-motion hook, a11y labels/states, live regions, auth autofill, verify-email cooldown, dynamic auth footer year, loading delay copy, and typography guard for no 9/10/11 px or negative letter spacing | Haptic/reduce-motion device pass and automated/manual scanner pass |
| UX-003 | Partial | `DataState` primitive added; error boundary, persistent TMDB stale fallback, movie outbox, skeletons, loading, empty, error, and offline affordances improved | Full loading/empty/error/offline state matrix screenshots |
| UX-004 | Partial | Main flows preserved with safer feedback | Product UX acceptance on device matrix |
| A11Y-001 | Partial | Labels, roles, selected/checked/disabled/busy states, and larger targets added in navigation, forms, chips, segmented controls, chat, report, filters, profile, and media controls | Full semantic contract audit with screen readers |
| A11Y-002 | Partial | `AppModal`/`AppSheet` primitives added and edited modals/sheets now carry dialog semantics, close labels, backdrop handling, and safer focus targets | VoiceOver/TalkBack focus journey and full modal migration review |
| A11Y-003 | Partial | Photo grid has accessibility actions for move/make cover/remove, discovery slider exposes adjustable actions, and reduced-motion fallbacks were added | Reduce-motion, alternative input, and gesture replacement audit |
| A11Y-004 | Not complete | No automated a11y scanner in repo | Automated scanner plus manual screen-reader tests |
| RESP-001 | Partial | `useWindowClass`, responsive `Screen` max widths, 16 dp screen gutters, compact bottom navigation behavior, quota wrapping, and more stable list/control dimensions | 320 dp/tablet/orientation/foldable/font-scale screenshots |
| PERF-001 | Partial | Fixed splash delay removed, startup fetch gated behind authenticated visible screen, startup fetch bounded | Physical cold/warm-start measurements |
| PERF-002 | Complete for edited lists | Scroll maps converted to `FlatList` on heavy screens | Long-list profiler/OOM evidence |
| PERF-003 | Partial | Bounded artwork prefetch/cache | Image memory/network report |
| PERF-004 | Complete for app code | TMDB proxy/cache, persistent mobile stale cache, and bounded metadata hydration | Rotate key and staging proxy SLO |
| PERF-005 | Partial | Polling/timer reduction and stale response guards | React profiler and dropped-frame budget |
| PERF-006 | Partial | Background polling reduced; permissions minimized | Battery/network/low-data tests |
| CI-001 | Partial | GitHub CI runs dependency audit, guards, typecheck, tests, Expo dependency check, and blocking Expo Doctor; local `npm run check` passed with 45 tests; Android/iOS Expo export, UI export, and Android bundleRelease passed | Protected branch and release pipeline setup |
| CI-002 | Partial | npm audit is clean; Expo-compatible deps checked and aligned to SDK 56 patch expectations | SBOM/license/provenance job |
| CI-003 | Partial | Migration file added; SQL applied to Supabase; migration history repaired; remote dry-run is up to date | Rollback tests |
| OBS-001 | Partial | Provider-independent telemetry interface wired to API errors, auth user ref, and error boundary | Real telemetry provider, crash/performance dashboards |
| OBS-002 | Partial | Request id/API version/server time headers and structured Edge request logs | Backend traces, DB metrics, PII canary |
| OBS-003 | Not complete | No SLO dashboard in repo | SLO alarms and release health dashboards |
| OPS-001 | Not complete | No durable worker/DLQ | Queue/outbox/DLQ implementation |
| OPS-002 | Partial | Release docs added | Incident runbook and owner rota |
| OPS-003 | Not complete | No production backup access from repo | PITR/restore drill by Supabase owner |
| STORE-001 | Complete for Android config | Least-privilege merged Expo/native Android release permissions, no `RECORD_AUDIO`/media read permission, backup disabled, verified HTTPS auth link intent filter added | Play Console declaration and internal test |
| STORE-002 | Complete for app config | iOS privacy manifest entries and permission strings | Apple privacy form and device review |
| STORE-003 | Partial | Report/block paths remain; token logs redacted | Moderation SLA/support/live ops proof |
| STORE-004 | Partial | Store/legal docs not in app | TMDB attribution/about/privacy UX final copy |
| STORE-005 | Partial | Checked-in Android native config updated directly; Expo Doctor non-CNG check is explicitly disabled with supported project config | ADR for CNG vs checked-in native and iOS config source |
| STORE-006 | Manual | Release docs list steps; Android 1.0.32 release AAB copied to Desktop | TestFlight/Play Internal/staged rollout |

## Manual-Only Items From AAWmatch Section 22

1. Rotate the leaked TMDB key/token in the provider panel and set the new Supabase secret.
2. Approve any remaining Supabase secret changes and run post-deploy operational checks.
3. Change repo visibility, branch protection, and organization access.
4. Publish HTTPS auth domain, `apple-app-site-association`, and `assetlinks.json` through DNS/hosting.
5. Confirm Apple Associated Domains/App ID capability and provisioning with the existing identity.
6. Complete App Store Connect privacy, age rating, DSA trader, and review answers.
7. Complete Play Console Data Safety, content rating, permission, and policy declarations.
8. Approve moderation support address, SLA/on-call, legal, and privacy text as the business owner.
9. Enable backup/PITR and run restore drill with account-owner access.
10. Build AAB/archive with existing Android/iOS signing credentials; do not generate a new key.
11. Run TestFlight/Play Internal/Closed testing, real device matrix, and staged production rollout.
12. Keep store reviewer demo account and moderation/support operation live.
13. Capture UI evidence across 320-1024+ dp widths, portrait, landscape, tablet, foldable, font scale 1.0/1.3/1.5/2.0, bold text, display size, screenshot contrast, VoiceOver, TalkBack, reduced motion, haptics, keyboard, modal focus, swipe, scroll, and release-mode performance.
