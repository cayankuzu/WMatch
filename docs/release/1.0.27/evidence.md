# WMatch 1.0.27 Evidence

Date: 2026-07-15
Workspace: `C:\Users\Cayan\Desktop\WMatch-main`

## Supabase Deployment

- Project: `WMatch` (`eaggwbuvpfzrejamwqry`)
- Migrations deployed/applied:
  - `20260714224500_atomic_user_movie_collections_rpc.sql`
  - `20260715083000_kv_store_d962235e_index_cleanup.sql`
  - `20260715162000_media_type_live_now_contract.sql`
  - `20260715183000_final_reaudit_contracts.sql`
- `replace_user_media_collections(uuid,jsonb,jsonb)`, legacy `replace_user_movie_collections(uuid,integer[],integer[])`, and `get_live_now_users(uuid,timestamptz,uuid,integer)` exist on remote.
- `supabase db push --linked --dry-run` reports the remote database is up to date.
- Function deployment completed for `make-server-d962235e` after final re-audit fixes with JWT verification enabled.
- Live health smoke passed on 2026-07-15 for `/functions/v1/make-server-d962235e/health`: `ok=true`, `release=1.0.27`, `requiredSchema=20260715183000`, `schemaReady=true`, request id `6ff459a4-958d-42cc-80d3-daf06e7c9f67`.
- B17 re-audit repo delta adds `20260715201000_p0_reaudit_closures.sql` and updates the Edge function required schema to `20260715201000`. This revision includes movie/TV identity compatibility fixes, media repair history, legacy chat message-peer recovery, chat repair audit/backfill RPCs, and CAS watch-session transitions.
- `npx supabase db push --linked --dry-run` for the B17 re-audit revision could not connect from this workstation because `SUPABASE_DB_PASSWORD` failed authentication. Remote apply/deploy for `20260715201000` is still pending.

## Version Bump

- App/package version: `1.0.27`
- Android `versionCode`: `28`
- iOS `buildNumber`: `30`

## Local Verification Commands

| Command | Result |
|---|---|
| `npm run check` | Passed: signing guard, secret guard, i18n parity, TypeScript, 43 Vitest tests |
| `npm audit --omit=dev` | Passed: 0 vulnerabilities |
| `npx expo install --check` | Passed: dependencies are up to date after SDK 56 patch alignment |
| `npm run doctor` | Passed: 20/20 checks; non-CNG native-config check disabled through supported Expo Doctor project config |
| `cd android && .\gradlew.bat clean` | Passed |
| `cd android && .\gradlew.bat :app:bundleRelease` | Passed after final re-audit fixes |

## Android Build Artifact

- Source: `android/app/build/outputs/bundle/release/app-release.aab`
- Desktop copy: `C:\Users\Cayan\Desktop\WMatch-1.0.27-vc28-release.aab`
- Size: `50,270,630` bytes
- SHA-256: `D3F32CEC2BAB95D5D328014AA5CAA81F75881257671911A5CE5018870515855D`

## Notes

- Supabase CLI `db push` could not directly open the new cleanup migration file on Windows during the write phase, although dry-run could see it and the file was readable from PowerShell. The SQL was applied with `supabase db query --linked --file`, then migration history was repaired to `applied`.
- Supabase CLI had the same Windows file-open failure for `20260715183000_final_reaudit_contracts.sql`; the SQL was applied with `supabase db query --linked --file`, then migration history was repaired to `applied`. A follow-up dry-run returned `Remote database is up to date`.
- The later B17 re-audit migration `20260715201000_p0_reaudit_closures.sql` has not been applied to the linked Supabase project from this workstation because the configured DB password is rejected.
- The cleanup migration removed repeated duplicate KV pattern indexes, leaving only `kv_store_d962235e_pkey` and `kv_store_d962235e_key_idx`.
- `realtime.messages` policy creation is wrapped as best-effort because the linked migration role is not the owner of Supabase-managed `realtime.messages`; client channels now request private topics, and the dashboard Realtime Authorization setting remains an operator gate.
