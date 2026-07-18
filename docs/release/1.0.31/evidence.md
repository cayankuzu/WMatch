# WMatch 1.0.31 Evidence

Date: 2026-07-16
Workspace: `C:\Users\Cayan\Desktop\WMatch-main`

## Fixes In This Build

- Fixed the chat modal crash from Supabase Realtime by moving typing broadcasts off the subscribed presence topic. Presence remains on `conversation:{pairKey}` and typing now uses `conversation-typing:{pairKey}`.
- Fixed chat thread opening so loaded conversations stick to the latest message after list layout/content measurement completes.
- Prevented older chat pages from auto-loading on open; older messages now load only after the user actually drags the message list near the top.
- Reduced slow startup/Watch reload pressure by deduplicating automatic live-now refreshes while preserving manual pull-to-refresh and pagination.
- Extended discovery cache TTL from 60 seconds to 120 seconds so returning to discovery screens can reuse warm data while realtime/app-active refreshes still update it.

## Supabase Deployment

- Project: `WMatch` (`eaggwbuvpfzrejamwqry`)
- `npx supabase db push --linked --dry-run`: passed; `Remote database is up to date.`
- `npx supabase db push --linked`: passed; `Remote database is up to date.`
- `npx supabase functions deploy make-server-d962235e --project-ref eaggwbuvpfzrejamwqry`: passed.
- Supabase CLI emitted `WARNING: Docker is not running`; function deployment still completed through CLI upload.
- Live health smoke passed for `/functions/v1/make-server-d962235e/health`: `ok=true`, `release=1.0.31`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `a1f50548-eb7c-41fa-80de-f0a9ff23c131`.

## Version Bump

- App/package version: `1.0.31`
- Android `versionCode`: `32`
- iOS `buildNumber`: `34`
- Edge `RELEASE_VERSION`: `1.0.31`

## Local Verification Commands

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run test:contract` | Passed, 42 tests |
| `npm run check:edge` | Passed; `version=1.0.31`, `schema=20260715201000`, `routes=37` |
| `npm run check:migrations` | Passed; `migrations=35`, latest `20260715201000_p0_reaudit_closures.sql` |
| `npm run format:check` | Passed |
| `npm run lint` | Passed |
| `npm run check` | Passed |
| `npm audit --omit=dev` | Passed, 0 vulnerabilities |
| `npx expo install --check` | Passed; dependencies are up to date |
| `npm run doctor` | Passed on retry; 20/20 checks |
| `cd android && .\gradlew.bat clean` | Passed |
| `cd android && .\gradlew.bat :app:bundleRelease` | Passed; release signing fingerprint verified |

## Android Build Artifact

- Source: `android/app/build/outputs/bundle/release/app-release.aab`
- Desktop copy: `C:\Users\Cayan\Desktop\WMatch-1.0.31-vc32-release.aab`
- Size: `50,279,939` bytes
- SHA-256: `656648D3CCF6640B129186FDC3A73CCA503AF4ECC7A7DA1C99A82A156A66B621`
- Release signing SHA-1 verified by Gradle: `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`

## Notes

- Gradle completed with dependency/plugin deprecation warnings and a daemon metaspace restart warning after the build; the release bundle itself succeeded.
- No new Supabase migration was pending at deployment time.
- The first `npm run doctor` attempt hit a transient `exp.host:443` connection timeout while checking the Expo config schema; the immediate retry passed 20/20 checks.
