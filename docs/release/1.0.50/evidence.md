# WMatch 1.0.50 release evidence

Date: 2026-08-19

- App version: `1.0.50`
- Android: `com.wmatch.app`, `versionCode 51`
- iOS: `com.wmatch.app`, `buildNumber 53`

## Supabase production

- Project: `eaggwbuvpfzrejamwqry`.
- Local and remote migration histories match at 43/43 through
  `20260819190000_push_delivery_receipts.sql`; no migration was pending.
- Edge Function `make-server-d962235e` version 95 is active.
- Live health passed with `ok=true`, `release=1.0.50`,
  `requiredSchema=20260819190000`, and `schemaReady=true`.
- Health request ID: `f64483e5-8212-4ed5-8805-09c915a230f6`.
- Push-outbox workflow run
  `https://github.com/cayankuzu/WMatch/actions/runs/32298597744` passed with
  `healthy=true` and zero dead, stalled, receipt-failed, or receipt-stalled jobs.

## Android production artifact

- Commands: `gradlew.bat clean`, then `gradlew.bat bundleRelease`.
- Sentry source-map upload was disabled for the local build; runtime Sentry
  instrumentation remains included.
- Repository artifact:
  `android/app/build/outputs/bundle/release/app-release.aab`.
- Desktop copy:
  `C:\Users\Cayan\Desktop\WMatch-1.0.50-vc51-release.aab`.
- Size: 68,234,872 bytes.
- SHA-256:
  `752371006BEB451E65F8E4C8F53C18219CCD39717A9057AC4E8A8CE90CD9DED0`.
- Source and Desktop hashes match.
- `jarsigner` verification passed.
- Upload certificate SHA-1:
  `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`.

## iOS and TestFlight

- EAS production build `9baead8e-89b8-445a-8cf7-9f2aeb887e3c` finished.
- Build page:
  `https://expo.dev/accounts/cayann/projects/wmatch/builds/9baead8e-89b8-445a-8cf7-9f2aeb887e3c`.
- IPA:
  `https://expo.dev/artifacts/eas/mjJQxIsdsNzFg9k7h44qJ26luJeJNdnQCZIvVHiMWrw.ipa`.
- EAS submission `f616805c-0798-40ab-b292-651224b6273c` finished.
- Submission page:
  `https://expo.dev/accounts/cayann/projects/wmatch/submissions/f616805c-0798-40ab-b292-651224b6273c`.
- Apple accepted the upload and completed TestFlight processing.
- Apple build ID: `9830a89c-d096-4ff2-83ec-f8d8fe498660`.
- App Store Connect state: `VALID`; the build is not expired.
- App Store Connect:
  `https://appstoreconnect.apple.com/apps/6779453259/testflight/ios`.

## Docker-free release gate

`npm run verify:release`: PASS.

- Format, source-quality, signing, secret, license, dependency-audit, i18n,
  touch-target, and TypeScript checks passed.
- Unit tests: 32 passed.
- Component tests: 7 suites and 19 tests passed.
- Production contract tests: 80 passed.
- Static migration and Edge contracts passed; Deno typecheck passed.
- Expo dependency alignment passed; Expo Doctor passed 20/20 checks.
