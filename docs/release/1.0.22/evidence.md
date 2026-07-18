# WMatch 1.0.22 Evidence

Date: 2026-07-14
Workspace: `C:\Users\Cayan\Desktop\WMatch-main`

## Implemented In This Hardening Pass

- Removed the hardcoded TMDB API key from the mobile bundle path and moved TMDB access behind the Supabase Edge API.
- Added a TMDB proxy allowlist, IP/path rate limit, upstream-key env lookup, in-memory TTL cache, and inflight request dedupe.
- Removed source-code fallback for Supabase public client config; `EXPO_PUBLIC_SUPABASE_PROJECT_ID` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are now required environment values.
- Added signing identity, private-secret, and i18n parity CI guards.
- Added request id, API version, and server-time headers on Edge responses.
- Removed e-mail existence disclosure from the signup availability check.
- Preserved Android/iOS identity and signing guard values.

## Local Verification Commands

These commands were run locally during this pass and must stay green for the release candidate:

| Command | Result |
|---|---|
| `npm run check` | Passed: signing guard, secret guard, i18n parity, typecheck, 6 Vitest tests |
| `npm audit --omit=dev` | Passed: 0 vulnerabilities |
| `npx expo install --check` | Passed: dependencies up to date |
| `npx expo export --platform android --output-dir .expo-export-check/android` | Passed |
| `npx expo export --platform ios --output-dir .expo-export-check/ios` | Passed |
| `cd android && .\gradlew.bat :app:bundleRelease` | Passed |
| Package secret scan on `.expo-export-check` and `android/app/build/outputs` | Passed: no matches for old TMDB key/direct `api_key=`/private Supabase env names |
| Source scan for the leaked TMDB key and hardcoded TMDB-like keys | Passed: no matches |
| `git diff --check` | Passed: no whitespace errors; CRLF conversion warnings only |
| `npm run doctor` | 20/21 passed; known non-CNG native-config advisory |
| `deno --version` | Not run: Deno is not installed on this machine |

## Android Build Artifact

- Path: `android/app/build/outputs/bundle/release/app-release.aab`
- Size: `50,233,588` bytes
- SHA-256: `9DB0C771BA3D1F554B04A6BFD08E5C058C81640117956861AD4A9A532F0F54C2`

## Manual Evidence Still Required

- Rotate the old TMDB key in the provider panel and set the new `TMDB_API_KEY` secret in Supabase.
- Deploy the new Supabase migration/function to staging and production.
- Run RLS/API attack tests against staging.
- Run device matrix, accessibility, and performance measurements on physical iOS/Android devices.
- Build signed iOS archive on macOS and run TestFlight smoke.
- Submit Play Internal / TestFlight, then run staged rollout with owner-approved stop thresholds.
