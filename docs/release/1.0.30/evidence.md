# WMatch 1.0.30 Evidence

Date: 2026-07-15
Workspace: `C:\Users\Cayan\Desktop\WMatch-main`

## Fixes In This Build

- Fixed Edge API data loading failures caused by selecting the non-existent `matches.id` column. The production `matches` table uses the composite key `user1_id, user2_id`.
- Reworked profile photo swiping from a release-only PanResponder index jump to a horizontal `FlatList` pager. While dragging, adjacent photos are visible and the gesture is handled like the full-screen photo preview.
- Locked the photo pager to horizontal paging so profile pull-to-refresh is not triggered by normal left/right photo swipes.

## Supabase Deployment

- Project: `WMatch` (`eaggwbuvpfzrejamwqry`)
- `npx supabase db push --linked --dry-run`: passed; `Remote database is up to date.`
- `npx supabase db push --linked`: passed; `Remote database is up to date.`
- `npx supabase functions deploy make-server-d962235e --project-ref eaggwbuvpfzrejamwqry`: passed.
- Supabase CLI emitted `WARNING: Docker is not running`; function deployment still completed through CLI upload.
- Live health smoke passed for `/functions/v1/make-server-d962235e/health`: `ok=true`, `release=1.0.30`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `187b374b-67df-41f3-a3ea-c8348c403724`.

## Version Bump

- App/package version: `1.0.30`
- Android `versionCode`: `31`
- iOS `buildNumber`: `33`
- Edge `RELEASE_VERSION`: `1.0.30`

## Local Verification Commands

| Command | Result |
|---|---|
| `npm run check` | Passed, 46 tests |
| `npm run check:edge` | Passed; `version=1.0.30`, `schema=20260715201000`, `routes=37` |
| `npm run test:contract` | Passed, 39 tests |
| `npm run format:check` | Passed |
| `cd android && .\gradlew.bat clean` | Passed |
| `cd android && .\gradlew.bat :app:bundleRelease` | Passed; release signing fingerprint verified |

## Android Build Artifact

- Source: `android/app/build/outputs/bundle/release/app-release.aab`
- Desktop copy: `C:\Users\Cayan\Desktop\WMatch-1.0.30-vc31-release.aab`
- Size: `50,279,060` bytes
- SHA-256: `3886EB44A7E33CF67A3CA0BC802BC67F833460687A7EB246605418BE543349B3`
- Release signing SHA-1 verified by Gradle: `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`

## Notes

- Gradle completed with dependency/plugin deprecation warnings and a daemon metaspace restart warning after the build; the release bundle itself succeeded.
- No new Supabase migration was pending at deployment time.
