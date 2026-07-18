# WMatch 1.0.26 Evidence

Date: 2026-07-14
Workspace: `C:\Users\Cayan\Desktop\WMatch-main`
Source checklists:

- `C:\Users\Cayan\Desktop\WMATCH_10_10_UYGULAMA_REHBERI.md`
- `C:\Users\Cayan\Desktop\WMATCH_10_10_UI_FIX_REHBERI.md`

## Implemented In This Pass

- Restored protected EAS project identity and owner to the baseline values and extended signing guard coverage.
- Added static guardrails for protected package/bundle/EAS identity, empty Supabase selects, bounded compatibility discovery, and structured Edge request logs.
- Added persistent TMDB response cache with stale fallback, in-flight dedupe, and bounded artwork prefetch retention.
- Prevented unauthenticated startup from loading home/feed data before the visible auth screen.
- Added durable movie-library outbox for favorites, watched items, and currently-watching sync with stable idempotency keys.
- Moved signup legal consent to the final review step, replaced the heavy preview with a lightweight summary, and persisted the non-password signup draft.
- Added 450 ms debounce and stale-result protection for signup e-mail and username availability checks.
- Added login/forgot/recovery/signup autofill hints, live error announcements, stronger double-submit guards, and normalized e-mail handling.
- Added 60 second verify-email resend cooldown and foreground session refresh after auth verification/recovery flows.
- Added provider-independent telemetry interface and wired it into API errors, auth user context, and render error boundary.
- Replaced raw Edge request logging with request id, route, status, duration, and anonymized actor structured logs.
- Narrowed message insert return payloads to `MESSAGE_SELECT` and reduced compatibility candidate pool to 320 rows.
- Added service-only `replace_user_movie_collections` RPC and routed profile movie collection sync through that atomic transaction boundary.
- Added semantic color, typography, spacing, layout, motion, elevation, and gradient tokens for the UI layer.
- Added responsive window-class, reduced-motion, and bottom-obstruction helpers, then wired them into app shell, screens, bottom navigation, and animation-sensitive controls.
- Added shared UI primitives for scalable text, icon buttons, modal/sheet surfaces, and loading/empty/error/offline data states.
- Hardened `Screen`, `AppButton`, `AppTextField`, chips, segmented controls, auth legal consent, auth footer, wordmark, loading, splash, search, skeleton, and transient popup components.
- Increased touched controls toward 48 dp targets and added labels, roles, selected/checked/disabled/busy states, live regions, and adjustable actions across navigation, auth, chat, filters, report, profile, movie, and photo-grid flows.
- Added compact/font-scale behavior for bottom navigation and quota controls so narrow screens and large text do not depend on clipped labels.
- Added static UI guard coverage for scalable typography, no 9/10/11 px font sizes, no negative letter spacing, no disabled opacity-only buttons, and required UI hardening primitives.

## Local Verification Commands

These commands were run locally during this pass:

| Command | Result |
|---|---|
| `npm run check` | Passed: signing guard, secret guard, i18n parity, TypeScript, 19 Vitest tests |
| `npm audit --omit=dev` | Passed: 0 vulnerabilities |
| `npx expo install --check` | Passed: dependencies are up to date |
| `npx expo export --platform android --output-dir .expo-export-check/android` | Passed |
| `npx expo export --platform ios --output-dir .expo-export-check/ios` | Passed |
| `npx expo export --platform android --output-dir .expo-export-check/android-ui` | Passed |
| `npx expo export --platform ios --output-dir .expo-export-check/ios-ui` | Passed |
| `npm run check:secrets` after export | Passed |
| `git diff --check` | Passed: CRLF conversion warnings only |
| `npm run doctor` | 20/21 passed; known non-CNG native-config advisory |
| `cd android && .\gradlew.bat :app:bundleRelease` | Passed |
| `deno --version` | Not available on this Windows workspace |

## Android Build Artifact

- Path: `android/app/build/outputs/bundle/release/app-release.aab`
- Size: `50,245,893` bytes
- SHA-256: `7F9A5A180A78E4C8D3855C74582064F4F06E363DB0760FD6D3A00F5BABD71A20`

## Manual Evidence Still Required

- Deploy Supabase migrations/functions/secrets to staging before production.
- Run RLS/API negative attack tests in staging.
- Run real iOS/Android device startup, offline, accessibility, font-scale, landscape, and upload/OOM tests.
- Build signed iOS archive on macOS and run TestFlight smoke.
- Build signed Android AAB with the existing upload key and run Play Internal testing.
- Complete App Store / Play privacy, data safety, UGC, moderation, and rollout checklists.
- Run load, backup/PITR restore, dashboard alert, and rollback drills with the production owner.
- Capture UI device evidence across 320-1024+ dp widths, portrait, landscape, tablet, and foldable layouts.
- Capture font-scale evidence at 1.0, 1.3, 1.5, and 2.0, including bold text and display-size settings.
- Run VoiceOver and TalkBack golden-path tests for onboarding, auth, discovery, match, chat, profile, filters, report, block, settings, and media flows.
- Capture screenshot/golden visual regression evidence and actual composited contrast checks from screenshots.
- Run reduced-motion, haptic-policy, keyboard, modal-focus, swipe, scroll, and release-mode performance checks on physical devices.
