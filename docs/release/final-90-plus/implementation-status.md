# Final 90 Plus Implementation Status

Date: 2026-07-15

## Completed In This Pass

- Added `npm run verify:release` as the local aggregate release gate.
- Added static release guards:
  - `scripts/check-format.mjs`
  - `scripts/check-source-quality.mjs`
  - `scripts/check-edge-contracts.mjs`
  - `scripts/check-migrations.mjs`
- Wired the new gates into `.github/workflows/ci.yml`.
- Added Settings About/Legal/TMDB attribution UI with links to privacy, terms, and TMDB.
- Added i18n keys for the About/Legal/TMDB screen in Turkish and English catalogs.
- Added production guard coverage for release verification scripts and Settings legal/TMDB attribution.
- Re-copied the signed Android release AAB to Desktop and revalidated its SHA-256.
- Re-ran Supabase Edge health smoke with anon auth and confirmed schema readiness.

## Already Completed Before This Pass And Preserved

- Version bump to `1.0.28`.
- Android `versionCode` bump to `29`.
- iOS `buildNumber` bump to `31`.
- Edge `RELEASE_VERSION` bump to `1.0.28`.
- Supabase migration `20260715201000_p0_reaudit_closures.sql` applied to the linked remote database.
- Supabase migration history repaired to mark `20260715201000` as applied after the Windows `db push` file-open issue.
- Supabase Edge function `make-server-d962235e` deployed.
- `gradlew clean` and `:app:bundleRelease` completed successfully.

## Deliberately Not Marked Complete

- Destructive migration squash/reset or remote DB rewrite.
- RLS attack suite against a staging database with seeded users.
- Supabase dashboard-only Realtime auth policy work.
- TMDB/provider secret rotation.
- DNS/hosting publication of `apple-app-site-association` and `assetlinks.json`.
- App Store Connect / Play Console forms and internal testing rollout.
- Real iOS archive/TestFlight build.
- Full device, screen-reader, orientation, tablet/foldable, and performance matrix.
- PITR/backup restore drill.

## Phase Mapping

| Plan area | Status | Evidence |
|---|---:|---|
| F90-000 baseline and constraints | Partial | `baseline.md`, current git status, release identity guards |
| F90-001 evidence directory | Complete for repo | `docs/release/final-90-plus/*` |
| F90-002 characterization tests | Partial | Existing Vitest production guards plus new script/legal guards |
| F90-010 migration consolidation | Blocked/manual | Destructive remote history/squash requires owner approval |
| F90-011 release schema contract | Complete for repo/live smoke | Edge health contract and `check:edge` |
| F90-012 RLS/security | Partial | Static migration guard only; no live attack suite |
| F90-020 Edge modularization | Not completed | Large module remains; no risky broad refactor in this pass |
| F90-040 navigation/server state | Not completed | Existing architecture preserved |
| F90-050 UI primitives/raw Modal | Partial | About screen uses `AppModal`; migration budget measured |
| F90-075 TMDB attribution | Complete for app UI | Settings About/Legal/TMDB screen and guard test |
| F90-082 lint/format/complexity gate | Partial | Static source quality and format gates added |
| F90-090 test pyramid | Partial | Split scripts added; true E2E/device suites still missing |
| F90-092 CI | Partial | New gates wired into GitHub Actions |
| F90-100 telemetry | Partial | Existing telemetry/logging preserved; no provider dashboard |
| F90-110 verified links | Partial | App config has auth link intent filter; hosted files/manual proof missing |
| F90-111 privacy/legal | Partial | In-app links and TMDB attribution added; store/legal owner forms missing |
| F90-112 native source of truth | Partial | Existing checked-in native config preserved; no ADR expansion |
| F90-113 manual build/internal testing | Partial/manual | Android AAB built; store/internal testing not run |
