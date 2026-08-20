# WMatch production readiness

Date: 2026-08-19

Candidate: `1.0.50` — Android `versionCode 51`, iOS `buildNumber 53`

Verdict: **NO-GO**

The 1.0.50 database schema and Edge Function are deployed, the signed Android App Bundle is built, and the iOS build is valid in TestFlight. Production readiness remains NO-GO until the remaining device, load, observability and store-review evidence is complete.

## Deployed production state

- Supabase project: `eaggwbuvpfzrejamwqry`.
- Migration history matches local through `20260819190000_push_delivery_receipts.sql`.
- Newly applied migrations include `20260819090000_discovery_correctness_read_models.sql`, `20260819100000_push_delivery_health.sql` and `20260819190000_push_delivery_receipts.sql`.
- Edge Function `make-server-d962235e` version 95 is deployed.
- Live health: `release=1.0.50`, `requiredSchema=20260819190000`, `schemaReady=true`; request ID `f64483e5-8212-4ed5-8805-09c915a230f6`.

## Push incident resolution

- Production inspection on 2026-08-19 found 8 dead push jobs and 5 retry jobs
  stalled since 2026-08-02. Recorded Android errors are `expo_http_400` and
  `expo_ticket_InvalidCredentials`.
- Stale incident rows were archived without replaying old user notifications.
- The backend isolates submissions per device, distinguishes permanent provider
  errors, persists Expo receipts, and cleans invalid device tokens.
- Android FCM V1 and iOS APNs production credentials are assigned and live
  provider receipt tests passed on both platforms.
- The worker secret and GitHub production environment are active. Workflow run
  `32298597744` passed with a healthy queue and zero dead, stalled,
  receipt-failed, or receipt-stalled jobs.
- Mobile permission and token-sync fixes are included in Android 1.0.50 (51)
  and iOS 1.0.50 (53); the iOS build is `VALID` in TestFlight.

## Verified locally without Docker

- `npm run verify:release` passes: format, source quality, signing, secret, license, dependency audit, i18n, touch targets, TypeScript, 32 unit tests, 19 component tests, 80 production-contract tests, static RLS/migration checks, Edge contracts and Deno typecheck, Expo dependency alignment and Doctor 20/20.
- `gradlew clean` followed by `gradlew :app:bundleRelease` passes with the expected upload key.
- Release metadata is `com.wmatch.app`, version `1.0.50`/`51`, with four Android ABIs.
- The signed AAB is copied to `C:\Users\Cayan\Desktop\WMatch-1.0.50-vc51-release.aab`.
- AAB SHA-256: `752371006BEB451E65F8E4C8F53C18219CCD39717A9057AC4E8A8CE90CD9DED0`.
- Upload certificate SHA-1: `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`.
- EAS iOS build and submission finished; App Store Connect reports 1.0.50 (53) as `VALID`.

## Required before GO

1. Run the database pgTAP/RLS suite against a clean database. Docker was intentionally not used in this pass.
2. Replace the invalid Sentry upload credential and prove source-map upload, dashboard visibility and test-alert delivery for 1.0.50.
3. Install the final artifact and run the checked-in Maestro journey matrix on Android, then repeat the release matrix on iOS/TestFlight.
4. Execute k6 smoke, 1,000-VU ramp and endurance tests against isolated staging fixtures and retain infrastructure graphs.
5. Complete accessibility, deep-link, notification, lifecycle/memory and Play Console/App Store Connect review evidence.

Detailed evidence: `docs/release/1.0.50/evidence.md`.
