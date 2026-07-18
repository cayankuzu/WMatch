# WMatch 1.0.32 Evidence

Date: 2026-07-16
Workspace: `C:\Users\Cayan\Desktop\WMatch-main`

## Fixes In This Build

- Reworked bottom tab rendering so visited screens stay mounted instead of being destroyed and recreated on every tab change.
- Added staggered tab warmup after login so Match, Compatibility, Likes, Chat, and Profile can initialize in the background without blocking the first Watch screen.
- Removed the tab-change live-now reload path. Watch data now reloads on pull-to-refresh, app foreground, or realtime/data events rather than every bottom-nav tap.
- Changed hidden tab layers to remain mounted with `opacity`, `pointerEvents`, and accessibility hiding instead of `display: none`, preserving scroll position, component state, and in-memory caches.
- Extended discovery cache freshness to 5 minutes and stopped cached discovery screens from auto-refreshing on mount; realtime/app-active updates still refresh without clearing visible data.
- Added in-flight discovery request deduping so repeated silent refresh triggers do not stack duplicate API calls.
- Memoized bottom tab screen components and movie rows, and stabilized core tab handlers to reduce unnecessary renders while hidden screens remain warm.

## Supabase Deployment

- Project: `WMatch` (`eaggwbuvpfzrejamwqry`)
- `npx supabase db push --linked --dry-run`: passed; `Remote database is up to date.`
- `npx supabase db push --linked`: passed; `Remote database is up to date.`
- `npx supabase functions deploy make-server-d962235e --project-ref eaggwbuvpfzrejamwqry`: passed.
- Supabase CLI emitted `WARNING: Docker is not running`; function deployment still completed through CLI upload.
- Live health smoke passed for `/functions/v1/make-server-d962235e/health`: `ok=true`, `release=1.0.32`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `a734a99b-3113-40c3-892a-ef405e5c7769`.

## Version Bump

- App/package version: `1.0.32`
- Android `versionCode`: `33`
- iOS `buildNumber`: `35`
- Edge `RELEASE_VERSION`: `1.0.32`

## Local Verification Commands

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run test:contract` | Passed, 43 tests |
| `npm run check:edge` | Passed; `version=1.0.32`, `schema=20260715201000`, `routes=37` |
| `npm run check:migrations` | Passed; `migrations=35`, latest `20260715201000_p0_reaudit_closures.sql` |
| `npm run format:check` | Passed |
| `npm run lint` | Passed |
| `npm run check` | Passed |
| `npm test` | Passed, 50 tests |
| `npm audit --omit=dev` | Passed, 0 vulnerabilities |
| `npx expo install --check` | Passed; dependencies are up to date |
| `npm run doctor` | Passed, 20/20 checks |
| `cd android && .\gradlew.bat clean` | Passed |
| `cd android && .\gradlew.bat :app:bundleRelease` | Passed; release signing fingerprint verified |

## Android Build Artifact

- Source: `android/app/build/outputs/bundle/release/app-release.aab`
- Desktop copy: `C:\Users\Cayan\Desktop\WMatch-1.0.32-vc33-release.aab`
- Size: `50,281,577` bytes
- SHA-256: `FADBBF05241F54AC90C9ABD72D620E3B5F0FB09C3B7618E9DF35D7501A69B76D`
- Release signing SHA-1 verified by Gradle: `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`

## Notes

- Gradle completed with dependency/plugin deprecation warnings and a daemon metaspace restart warning after the build; the release bundle itself succeeded.
- No new Supabase migration was pending at deployment time.
