# WMatch AAA-MVP baseline

Baseline commit: `b8ff52ac41eda5f6ef1e43472784d794328f7050`
Baseline date: 2026-08-30
Decision: **NO-GO**

This is a repository-evidence baseline, not a release claim. A checked-in test or historical result
is not counted as runtime proof. Scores are conservative triage values used to order the work; no
field can receive `9.80` until automated, same-SHA runtime/device and operational evidence exists.

## Repository state at the baseline

- Expo `~57.0.14`, React Native `0.86.2`, application `1.0.50`.
- Six tabs, 13 screens, 12 product modals, two sheets, 40 Hono routes and 26 database tables.
- Supabase Auth/PostgreSQL/RLS/Realtime/private Storage is the source of truth.
- Mobile HTTP traffic uses the Supabase Edge Function origin directly.
- Android source is checked in; no `ios/` source tree is checked in.
- `expo-updates` is not installed, `runtimeVersion`/update URL/channels are absent and Android has
  `expo.modules.updates.ENABLED=false`.
- The repository had CI, unit/component/contract/RLS assets and a signed 1.0.50 AAB, but no evidence
  manifest tying all evidence to this baseline SHA. The release evidence files were last changed at
  `4515ebf3f96a60c0a759549417875de0cafbd751`.
- Existing readiness documentation already records a public-production `NO-GO` for missing device,
  load, observability and store evidence.

## 35-field starting scorecard

|   # | Area                   | Start | Repository evidence                                                      | Baseline blocker                                                                         |
| --: | ---------------------- | ----: | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
|   1 | UI/UX                  |   8.4 | Shared UI primitives and state components exist                          | No same-SHA visual regression and device matrix                                          |
|   2 | Multi-device           |   6.2 | Responsive/window and safe-area helpers exist                            | No Android/iOS small/large/low-device evidence                                           |
|   3 | Performance            |   6.0 | Budgets, telemetry hooks and bounded caches exist                        | No same-device cold/warm/FPS/memory measurements                                         |
|   4 | Security/privacy       |   7.0 | RLS migrations, secret/signing guards and attack SQL exist               | Arbitrary non-managed profile-photo URL accepted at baseline; no full-history/SAST proof |
|   5 | Architecture           |   7.0 | Shared services and schema contract exist                                | 6k+ line Edge entrypoint and no architecture boundary guard                              |
|   6 | DRY                    |   7.1 | Common API/UI/cache helpers exist                                        | Large modules and repeated route logic remain unmeasured                                 |
|   7 | Hardcode/config        |   6.5 | Public Supabase env values are validated                                 | Environments, stable edge host and schema-validated config are incomplete                |
|   8 | State                  |   7.6 | Owner-scoped caches, optimistic rollback and outbox code exist           | Cross-device/property evidence incomplete                                                |
|   9 | Network/API            |   8.0 | Timeout, abort, retry, `Retry-After`, idempotency and typed errors exist | No complete route contract snapshot/runtime fault matrix                                 |
|  10 | Accessibility          |   8.0 | Accessible primitives, scalable type and touch guard exist               | VoiceOver/TalkBack/font-scale device proof absent                                        |
|  11 | Scale                  |   5.0 | k6 read-path asset exists                                                | No isolated-staging execution, DB plans or retained graphs                               |
|  12 | Resilience             |   6.2 | Chat outbox, retry and push dead-letter state exist                      | Provider outage, process-kill, restore and rollback drills absent                        |
|  13 | Tests                  |   8.0 | Unit, component, contract, DB/RLS and Maestro assets exist               | E2E matrix largely manual; evidence is not bound to baseline SHA                         |
|  14 | Localization           |   8.4 | Typed Turkish catalog and parity guard exist                             | No locale/device screenshot evidence; encoding review still required                     |
|  15 | Offline                |   7.2 | Cached snapshots and chat outbox exist                                   | Formal TTL/replay/dead-letter contract and 24-hour replay proof absent                   |
|  16 | Push/deep link         |   7.6 | Token lifecycle, receipts, dedupe and two navigation targets exist       | Terminated-app/device and association-file proof absent                                  |
|  17 | Observability          |   7.0 | Sentry/telemetry and push operations documents exist                     | Alert delivery, `cf-ray`, OTA metadata and dashboard proof absent                        |
|  18 | CI/CD                  |   7.4 | Pinned checkout/setup actions and fail-fast CI checks exist              | No feature/OTA classifier, deploy workflows or evidence artifact retention               |
|  19 | Documentation          |   6.0 | Release, test and push runbooks exist                                    | Required inventories/runbooks were absent and older release docs are stale               |
|  20 | Domain logic           |   8.0 | Atomic like/quota/watch/chat RPCs and contract tests exist               | Property/concurrency coverage is incomplete                                              |
|  21 | Dependencies           |   8.0 | Lockfile, audit, license and Dependabot checks exist                     | Provenance/exception expiry and current Expo patch alignment incomplete                  |
|  22 | Battery/resources      |   5.5 | Bounded polling/cache and lifecycle hooks exist                          | No battery/thermal/background measurements                                               |
|  23 | Platform compatibility |   6.0 | Package/bundle/signing guard passes                                      | Native parity check disabled; OTA disabled; iOS source unavailable                       |
|  24 | Store readiness        |   6.0 | Signed AAB and historical TestFlight evidence exist                      | Not same baseline SHA; store/device forms and rollout evidence missing                   |
|  25 | Operational maturity   |   5.5 | Push runbook and NO-GO record exist                                      | Owners, alert tests, RPO/RTO and incident/restore drills incomplete                      |
|  26 | Readability            |   6.5 | Source-quality budgets and modular UI areas exist                        | Edge entrypoint exceeds a maintainable module budget                                     |
|  27 | Overall maturity       |   6.0 | Production schema/function history and rollback notes exist              | Canary, same-SHA live health and manual gates incomplete                                 |
|  28 | Code architecture      |   6.5 | UI/shared/service/context boundaries are visible                         | No enforceable dependency-direction rule                                                 |
|  29 | Code quality           |   7.5 | Strict TypeScript, static checks and typed API errors exist              | Historical console/`any` transition budgets and no SAST gate                             |
|  30 | KISS                   |   8.0 | Supabase remains the only source of truth                                | Cloudflare selection rationale/route matrix not yet recorded                             |
|  31 | Code hardcode          |   7.0 | Several limits/TTLs are centralized                                      | Network/cache/release/environment values remain distributed                              |
|  32 | Reuse                  |   8.0 | Shared modal/button/text/image/state primitives are broadly used         | No machine guard against a second visual system                                          |
|  33 | Code performance       |   6.5 | Single-flight, bounded maps, projection and prefetch controls exist      | No profiler artifact or regression budget result                                         |
|  34 | Testability            |   7.0 | Deterministic utility tests and network fault tests exist                | Time/provider adapters and broad fault injection incomplete                              |
|  35 | Extensibility          |   7.0 | Schema health and generated DB types exist                               | API versioning, OTA runtime and compatibility matrix incomplete                          |

## P0 risks

| Risk                                                                                      | User impact                                                                            | Blast radius                                                  | Required closure                                                                                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Profile photo input accepts a non-empty external URL when it is not a managed Storage URL | Tracking/content injection and privacy boundary bypass                                 | Signup/edit profile, every profile payload and image consumer | Accept only owner-scoped private object keys/upload results; validate media; test attacker/victim paths |
| OTA is disabled and has no runtime/channel contract                                       | A claimed OTA could never reach installed users or could target an incompatible binary | Every installed Android/iOS binary                            | New OTA-capable binaries, explicit runtime/channel separation, classifier and rollback evidence         |
| Release evidence is not tied to `b8ff52ac…`                                               | Tests/artifacts can be combined across different source states                         | Entire release decision                                       | Generate a manifest with immutable SHA, dirty-tree state and artifact checksums                         |
| No restore drill/evidence                                                                 | Data-loss recovery is unproven                                                         | All accounts, messages and private media                      | Define RPO/RTO and restore into an isolated project at the release SHA                                  |

## P1 risks

- No immutable feature-surface guard existed at the baseline; this branch adds the snapshot and
  `check:feature-surface` without changing product behavior.
- Cloudflare route/cache/rate-limit/origin decisions were undocumented and no Worker existed.
- `npx expo install --check` and Expo Doctor had moved to newer SDK 57 patch expectations.
- `appConfigFieldsNotSyncedCheck` was disabled, so a green Doctor result did not prove native parity.
- CI generated an SBOM only in runner temp and did not retain a same-SHA evidence manifest.
- `docs/release/baseline.md`, `final-90-plus/*` and `DEPLOYMENT.md` describe older versions or
  incomplete migration procedures and cannot be the current operational contract.
- Full-history gitleaks, Semgrep/SAST, Worker tests, signed OTA tests and architecture boundaries
  were absent.

## Performance and failure baseline

No real-device measurement artifact exists for the baseline SHA. Therefore startup, screen-ready,
FPS, memory, battery and Worker/DB percentiles are **unknown**, not zero and not passing. The
repository contains proposed 600 ms API, 1.8 s useful-content and availability/crash objectives in
`docs/operations/observability.md`; they remain objectives until a baseline run, dashboard link and
alert test are attached.

Known executable failure assets are network retry tests, component network-fault tests, chat outbox
tests, production contract tests, DB/RLS SQL and two Maestro smoke flows. Provider outage, process
kill, long replay, signed artifact install, restore and staged rollback still require evidence.

## Release and rollback baseline

1. Keep release status `NO-GO` while any P0 or same-SHA evidence gate is open.
2. Run static/unit/component/contract/DB guards on one clean commit.
3. Build and checksum native artifacts from that commit; inspect identities and native parity.
4. Deploy preview/staging first and attach runtime/device/load/alert/restore results to the same SHA.
5. Promote only through protected production approval and staged rollout.
6. Roll back Worker, Supabase function, migration/cutover, OTA and store binary independently; do
   not rewrite production migration history.

## Feature-freeze evidence

The baseline and final comparison source is `quality/feature-surface.snapshot.json`. The baseline
contains six tabs, 13 screens, 12 product modals, two sheets, 40 baseline API routes, 26 baseline
tables, the existing notification/filter/settings keys and native permission/link contract. The
current 41st route plus 27th and 28th tables are separately reviewed internal security/ops allowlist
entries: account-deletion resume, moderation audit and origin-HMAC nonce replay state.
Run `npm run check:feature-surface`; any user-visible addition or removal is a release failure.
