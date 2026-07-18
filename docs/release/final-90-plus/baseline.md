# Final 90 Plus Baseline

Date: 2026-07-15
Workspace: `C:\Users\Cayan\Desktop\WMatch-main`
Branch: `agent/release-1.0.27-supabase-ui-hardening`
Baseline HEAD: `f511d58044d09a9a48814c381270af9133d1ddb4`
Execution plan: `C:\Users\Cayan\Desktop\WMATCH_FINAL_90_PLUS_PRODUCTION_EXECUTION_PLAN.md`

## Scope Decision

The plan includes repo-side hardening, Supabase deployment evidence, release verification gates, store/legal work, destructive/manual database cleanup, and real-device rollout tasks. This pass applies the parts that can be completed safely from the repository and local tooling. Owner-only, destructive, or external-console tasks remain explicitly blocked/manual and are not marked complete.

## Starting State

- Local tree already contained the `1.0.28` version bump, Supabase function/migration deployment evidence, release AAB build output, and production guard updates from the prior release task.
- `HEAD` stayed at `f511d58044d09a9a48814c381270af9133d1ddb4`; this pass has not committed or pushed changes.
- Protected release identity is unchanged:
  - Android package: `com.wmatch.app`
  - iOS bundle identifier: `com.wmatch.app`
  - EAS project id: `0aa025b7-dd97-4ad9-951c-3864e0beb8fc`
  - EAS owner: `cayan`
  - Android release SHA-1 guard: `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`

## Current Release Coordinates

- App/package version: `1.0.28`
- Android `versionCode`: `29`
- iOS `buildNumber`: `31`
- Edge `RELEASE_VERSION`: `1.0.28`
- Required schema contract: `20260715201000`
- Latest migration: `20260715201000_p0_reaudit_closures.sql`
- Migration count: `35`
- Edge route count: `37`

## Live Smoke Evidence

- Supabase health smoke with public anon auth passed on 2026-07-15.
- Response summary: `ok=true`, `release=1.0.28`, `requiredSchema=20260715201000`, `schemaReady=true`.
- Request id: `18f7a5b3-6c01-4e25-8c42-d460b0a2265f`

## Android Build Artifact

- Source: `android/app/build/outputs/bundle/release/app-release.aab`
- Desktop copy: `C:\Users\Cayan\Desktop\WMatch-1.0.28-vc29-release.aab`
- Size: `50,274,965` bytes
- SHA-256: `DCE154573C7E9947AAC897CD5F7272239CF67D4D1A180E5F005B5321F5351AF4`

## Baseline Measurements

- Raw React Native `Modal` imports outside `ui/AppModal.tsx`: `13`
- Console calls across `src`, `supabase`, `scripts`, `tests`: `193`
- Explicit `any` token count across `src`, `supabase`, `tests`: `94`
- These are measured and tracked, not hidden. They are transition budgets, not proof that the full architecture/a11y plan is complete.
