# WMatch 1.0.48 release evidence

Date: 2026-08-19

Android: `com.wmatch.app`, `versionName 1.0.48`, `versionCode 49`

iOS: `com.wmatch.app`, `buildNumber 51`

Verdict: **NO-GO** pending the external evidence listed below.

## Supabase deployment

- Linked project: `eaggwbuvpfzrejamwqry`.
- Dry-run found exactly two pending migrations.
- Applied `20260819090000_discovery_correctness_read_models.sql`.
- Applied `20260819100000_push_delivery_health.sql`.
- Final remote migration list matches all 42 local migrations through `20260819100000`.
- Deployed Edge Function: `make-server-d962235e`.
- Live health response: `ok=true`, `release=1.0.48`, `requiredSchema=20260819100000`, `schemaReady=true`, request ID `9a350ba9-d45f-4662-8d07-229f4f385c7d`.

The Windows Supabase CLI could connect but could not reopen migration files inside the repository. Each SQL file was therefore copied to an isolated temporary directory, executed once through the linked Management API, and only after success marked `applied` in migration history. The final remote/local migration list was then verified. No Docker or local Supabase stack was used.

## Android App Bundle

- Commands: `gradlew clean`, then `gradlew :app:bundleRelease --no-daemon`.
- Clean signed build: PASS in 654.7 seconds.
- Build-time Sentry source-map upload: disabled with `SENTRY_DISABLE_AUTO_UPLOAD=true` because the configured token is invalid; runtime Sentry instrumentation remains included.
- Repository artifact: `android/app/build/outputs/bundle/release/app-release.aab`.
- Desktop copy: `C:\Users\Cayan\Desktop\WMatch-1.0.48-vc49-release.aab`.
- Size: 68,234,778 bytes.
- SHA-256: `8C7FB010C9E885A6AEA2B98E67E51C60C538115288B45FD7AAAAFAFBEA132204`.
- `jarsigner` verification exit: 0.
- Upload certificate SHA-1: `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`.
- Gradle output metadata: `com.wmatch.app`, version `1.0.48`/`49`.
- Bundle structure contains the base manifest, primary DEX, BundleConfig and four ABI directories.
- Source and Desktop copy SHA-256 values match.

## Docker-free release gate

`npm run verify:release`: PASS.

| Check | Result |
|---|---|
| Format, source quality, secrets, signing and licenses | PASS |
| Dependency audit | PASS under the exact Metro/build-only exception |
| Turkish locale and touch-target guards | PASS |
| TypeScript | PASS |
| Unit tests | PASS — 32 tests |
| Component tests | PASS — 7 suites, 19 tests |
| Production contract tests | PASS — 80 tests |
| Migration/Edge static contracts | PASS — 42 migrations, 40 routes |
| Edge Deno typecheck | PASS |
| Expo dependency alignment | PASS |
| Expo Doctor | PASS — 20/20 |

## External evidence still required

- clean-database pgTAP/RLS output;
- valid Sentry source-map upload, dashboards and alert delivery;
- final Android and iOS E2E/accessibility/deep-link/notification/lifecycle runs;
- staging smoke, 1,000-VU and endurance results;
- deployed push schedule and dead/stalled queue alert proof;
- Play Console and App Store Connect review/signing/privacy evidence.
