# WMatch Baseline

Date: 2026-07-14
Baseline commit: `48e1cd0`
Canonical package manager: npm with `package-lock.json`

## Toolchain

- Node: `v26.5.0`
- npm: `11.17.0`
- Java: `Temurin OpenJDK 17.0.18`
- Gradle wrapper: `9.3.1`
- Expo SDK: `~56.0.15`
- React Native: `0.85.3`
- App version: `1.0.22`

## Protected Identity

- Android package/applicationId: `com.wmatch.app`
- Android namespace: `com.wmatch.app`
- iOS bundle identifier: `com.wmatch.app`
- EAS project id: `5aab8659-db24-4152-aa79-142f210e16d1`
- EAS owner: `cayann`
- Android release SHA-1 guard: `E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34`

Signing files, keystores, provisioning files, Firebase platform files, and non-example `.env` files must not be tracked by Git.

## Local Gates

Run from the repository root:

```bash
npm run check
npm audit --omit=dev
npx expo install --check
npx expo export --platform android --output-dir .expo-export-check/android
npx expo export --platform ios --output-dir .expo-export-check/ios
cd android && .\gradlew.bat :app:bundleRelease
```

Expected known limitation: `npm run doctor` can report the Expo Doctor native-config advisory because this repository has checked-in `android/` native sources. Native Android config has been applied directly; there is no checked-in `ios/` directory in this workspace.

## Manual Baseline Evidence

The following cannot be generated from this Windows/local workspace alone:

- macOS/Xcode signed iOS archive and TestFlight smoke.
- Physical-device startup, frame, memory, battery, VoiceOver, and TalkBack matrix.
- Production Supabase migration/function deployment proof.
- Store console privacy/data-safety form evidence.
- On-call, dashboard, alert, backup/PITR, and restore-drill evidence.
