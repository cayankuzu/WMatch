# WMatch 1.0.29 Evidence

Date: 2026-07-15
Workspace: `C:\Users\Cayan\Desktop\WMatch-main`

## Supabase Deployment

- Project: `WMatch` (`eaggwbuvpfzrejamwqry`)
- `npx supabase db push --linked --dry-run`: passed; `Remote database is up to date.`
- `npx supabase db push --linked`: passed; `Remote database is up to date.`
- `npx supabase functions deploy make-server-d962235e --project-ref eaggwbuvpfzrejamwqry`: passed.
- Supabase CLI emitted `WARNING: Docker is not running`; function deployment still completed through CLI upload.
- Live health smoke passed for `/functions/v1/make-server-d962235e/health`: `ok=true`, `release=1.0.29`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `de5dfd01-439e-4941-9e1f-79a4ce6e840f`.

## Version Bump

- App/package version: `1.0.29`
- Android `versionCode`: `30`
- iOS `buildNumber`: `32`
- Edge `RELEASE_VERSION`: `1.0.29`

## Local Verification Commands

| Command | Result |
|---|---|
| `npm run check` | Passed |
| `npm run check:edge` | Passed; `version=1.0.29`, `schema=20260715201000`, `routes=37` |
| `npm run format:check` | Passed |
| `cd android && .\gradlew.bat clean` | Passed |
| `cd android && .\gradlew.bat :app:bundleRelease` | Passed; release signing fingerprint verified |

## Android Build Artifact

- Source: `android/app/build/outputs/bundle/release/app-release.aab`
- Desktop copy: `C:\Users\Cayan\Desktop\WMatch-1.0.29-vc30-release.aab`
- Size: `50,278,580` bytes
- SHA-256: `946E6CA448FCCA263415FB44CE14B32389991A81305A3D6C848DAB173B95C518`
- Release signing SHA-1 verified by Gradle: `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`

## Notes

- Gradle completed with dependency/plugin deprecation warnings and a daemon metaspace restart warning after the build; the release bundle itself succeeded.
- No new Supabase migration was pending at deployment time.
