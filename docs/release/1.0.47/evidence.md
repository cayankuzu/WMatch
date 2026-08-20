# WMatch 1.0.47 release evidence

Date: 2026-08-19  
Android: `com.wmatch.app`, `versionName 1.0.47`, `versionCode 48`  
iOS: `com.wmatch.app`, `buildNumber 50`  
Verdict: **NO-GO**

## Implemented scope

- Database-authoritative discovery eligibility, exclusion, ranking and keyset pagination.
- Strict Edge request identity, CORS/auth-link handling, idempotency and timeout behavior.
- Runtime validation for auth, profile, discovery, likes, matches, chat and messages.
- Expo 57 / React Native 0.86.2 / Hermes dependency and native-project alignment.
- Generated database types, smaller auth/app UI contexts and extracted Edge cursor/security helpers.
- Central touch-target primitives and an AST-backed regression guard.
- Push outbox health/scheduler, redacted observability contract, Maestro flows and staging-only k6 profiles.

## Local command evidence

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run check:edge:type` | PASS |
| `npm run check:migrations` | PASS — 42 migrations; latest `20260819100000` |
| `npm run test:contract` | PASS — 80 tests |
| `npm run test:unit` | PASS — 32 tests |
| `npm run test:component` | PASS — 7 suites, 19 tests |
| `npm run lint` | PASS — zero explicit production `any` findings |
| `npm run check:audit` | PASS under the repository's exact Metro/build-only exception |
| `npm run check:touch` | PASS |
| signing, format, secrets and licenses | PASS |
| `npm run verify:release` | PASS — complete Docker-free release gate |
| `npx expo install --check` / Expo Doctor | PASS — dependencies aligned; 20/20 checks |
| `k6 inspect ... tests/load/critical-read-paths.js` | PASS — smoke scenario and all thresholds parsed; no requests sent |
| local database pgTAP/RLS | NOT RUN — Docker intentionally not used |
| staging k6 execution | NOT RUN — no isolated staging credentials/fixture authority in this pass |
| iOS archive/device run | NOT RUN — no macOS/Xcode device environment |

## Android artifact and device

The final repository-source builds use the expected upload certificate SHA-1 `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`. Signing credentials were read from the documented private continuity backup through temporary process environment variables; no keystore or password was copied into the repository.

| Artifact | Result |
|---|---|
| `android/app/build/outputs/apk/release/app-release.apk` | PASS — 95,851,868 bytes; SHA-256 `BD67FEE0D8F6C789B44CCF7E267B1E690DF04CC3C2242EE22C1D1AD0384F6D64`; APK Signature Scheme v2; one expected signer |
| `android/app/build/outputs/bundle/release/app-release.aab` | PASS — 68,234,984 bytes; SHA-256 `7C223B400192006D5804717CC63D51F2A794180478E27CBF54A09AF21963A158`; `jarsigner` reports `jar verified`; expected upload certificate |

Merged APK verification reports package `com.wmatch.app`, version `1.0.47`/`48`, minSdk 24 and targetSdk 36. `allowBackup` and `fullBackupContent` are false. The verified HTTPS filter is `cayankuzu.github.io/WMatch_web/auth`. Camera, microphone, system-overlay and external-storage write permissions are absent; the Android 12-and-earlier read-only gallery permission remains capped at API 32.

The first production build reached Sentry source-map upload and failed with HTTP 401 because the configured Sentry auth token is invalid. Local APK/AAB verification builds therefore used `SENTRY_DISABLE_AUTO_UPLOAD=true`; this does not satisfy production source-map upload evidence and remains a release blocker.

A previously installed signed 1.0.47/48 release launched on physical device `3a0a7660`, Redmi Note 9 Pro, Android 10. Initial content and all six bottom destinations rendered. Maestro discovered the views, but MIUI rejected injected tap events with `INJECT_EVENTS`. The device later disappeared from ADB, so the final `BD67...F6D64` APK was not installed; neither observation is accepted as final navigation-journey proof.

## External evidence still required

- clean database pgTAP/RLS output and deployed schema/Edge health;
- Sentry source-map upload, dashboards and test-alert delivery;
- complete Android/iOS E2E, accessibility, deep-link, notification and lifecycle matrix;
- staging smoke/1k/soak results with infrastructure graphs;
- deployed push schedule/manual run and dead/stalled queue alarm proof;
- Play Console/App Store Connect signing, privacy and review artifacts.
