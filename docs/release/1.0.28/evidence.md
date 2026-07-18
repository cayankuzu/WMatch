# WMatch 1.0.28 Evidence

Date: 2026-07-15
Workspace: `C:\Users\Cayan\Desktop\WMatch-main`

## Supabase Deployment

- Project: `WMatch` (`eaggwbuvpfzrejamwqry`)
- Migration deployed/applied:
  - `20260715201000_p0_reaudit_closures.sql`
- `npx supabase db push --linked --dry-run`: passed before deployment and showed only `20260715201000_p0_reaudit_closures.sql` pending.
- `npx supabase db push --linked`: hit the known Windows migration file-open issue (`Erişim engellendi`).
- `npx supabase db query --linked --file .\supabase\migrations\20260715201000_p0_reaudit_closures.sql`: passed.
- `npx supabase migration repair --linked --status applied 20260715201000`: passed.
- Follow-up `npx supabase db push --linked --dry-run`: `Remote database is up to date.`
- `npx supabase functions deploy make-server-d962235e --project-ref eaggwbuvpfzrejamwqry`: passed.
- Live health smoke passed for `/functions/v1/make-server-d962235e/health`: `ok=true`, `release=1.0.28`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `e65cf6bb-de65-41d7-9983-9434162119e9`.
- Final 90 Plus health re-smoke passed with anon auth: `ok=true`, `release=1.0.28`, `requiredSchema=20260715201000`, `schemaReady=true`, request id `18f7a5b3-6c01-4e25-8c42-d460b0a2265f`.

## Version Bump

- App/package version: `1.0.28`
- Android `versionCode`: `29`
- iOS `buildNumber`: `31`

## Local Verification Commands

| Command | Result |
|---|---|
| `npm run check` | Passed |
| `npm run verify:release` | Passed |
| `npx expo install --check` | Passed: dependencies are up to date |
| `npm run doctor` | Passed: 20/20 checks |
| `cd android && .\gradlew.bat clean` | Passed |
| `cd android && .\gradlew.bat :app:bundleRelease` | Passed; release signing fingerprint verified |

## Android Build Artifact

- Source: `android/app/build/outputs/bundle/release/app-release.aab`
- Desktop copy: `C:\Users\Cayan\Desktop\WMatch-1.0.28-vc29-release.aab`
- Size: `50,274,965` bytes
- SHA-256: `DCE154573C7E9947AAC897CD5F7272239CF67D4D1A180E5F005B5321F5351AF4`

## Notes

- Gradle emitted deprecation warnings from dependencies/plugins, but the release bundle completed successfully.
- Supabase function deploy emitted `WARNING: Docker is not running`; the function still deployed through the CLI upload path.
