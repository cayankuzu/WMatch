# WMatch Private Repo Bootstrap

This repository plus the offline `WMatch_secrests` backup bundle are the continuity sources for WMatch production work.

The operating model is deliberate:

- `cayankuzu/WMatch` stays private.
- The GitHub repo keeps the source code, native project files, assets, migrations, and secret-free examples.
- `C:\Users\Cayan\Desktop\WMatch_secrests` keeps the local secrets, signing keys, Firebase configs, and restore scripts that can be moved to USB.

## Included in the private repo

- Android native files, source code, assets, scripts, Supabase functions, and migrations
- `.env.example`
- `credentials.json.example`
- `android/keystore.properties.example`

## Included in the offline backup bundle

- `.env`
- `credentials.json`
- `android/keystore.properties`
- `android/keystores/*`
- `android/app/debug.keystore`
- `android/app/google-services.json`
- `firebase/google-services.json`
- `firebase/GoogleService-Info.plist`
- `.secrets/firebase-admin/*`
- `.secrets/eas/*`
- `RESTORE-TO-PROJECT.ps1`
- `README.txt`
- `CRITICAL_NOTES.txt`
- `RESTORE-CHECKLIST.txt`
- `SHA256SUMS.txt`

## Intentionally excluded

- `node_modules/`
- `android/node_modules/`
- `.expo/`
- `android/.gradle/`
- `android/build/`
- `android/app/build/`
- `android/app/.cxx/`
- `supabase/.temp/`
- `tmp/`
- `*.apk`
- `*.aab`
- Log, cache, and temp artifacts

## GitHub warning

The repo must stay private, but build-critical secrets should not be committed to GitHub.

## New machine setup

```powershell
git clone https://github.com/cayankuzu/WMatch.git
cd WMatch
npm ci
```

After cloning, restore the secret files from the Desktop or USB backup:

```powershell
powershell -ExecutionPolicy Bypass -File <USB_OR_DESKTOP>\WMatch_secrests\RESTORE-TO-PROJECT.ps1 -ProjectRoot (Get-Location)
```

## Desktop backup refresh

Whenever `.env`, Firebase config, service-account material, or Android signing material changes, refresh the offline backup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\export-wmatch-secrests.ps1
```

Default backup target:

```text
C:\Users\Cayan\Desktop\WMatch_secrests
```

## Android development

```powershell
npm run dev
npm run android
```

## Android release AAB

```powershell
cd android
.\gradlew.bat printReleaseSigningFingerprint
.\gradlew.bat clean
.\gradlew.bat bundleRelease
```

Expected upload SHA1:

```text
E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34
```

Default AAB output:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

## Supabase

Project ref:

```text
eaggwbuvpfzrejamwqry
```

Function deploy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-supabase.ps1
```

Current local secret state on July 10, 2026:

- `SUPABASE_ACCESS_TOKEN` exists in `.env`
- `SUPABASE_SECRET_KEY` exists in `.env`
- `SUPABASE_SERVICE_ROLE_KEY` exists in `.env`
- `SUPABASE_DB_PASSWORD` is blank in `.env`

If you later add any missing secret values locally, rerun `scripts/export-wmatch-secrests.ps1` so the Desktop backup stays complete.

## iOS

- There is no checked-in `ios/` native project in this repo.
- On macOS, generate it with `npx expo prebuild --platform ios` if needed.
- For production iOS builds, use `npx eas build -p ios --profile production` after Apple-side setup is ready.

## Provider-side limits

- Google Play App Signing's app signing key remains on Google's side.
- The current EAS FCM V1 key id is documented in `.secrets/eas/android-remote-credentials-2026-07-07.txt` inside the offline backup bundle.
- Two local Google service account JSON backups are stored under `.secrets/firebase-admin/` inside the offline backup bundle and were validated on 2026-07-07 by successfully obtaining Google OAuth access tokens.
- Supabase-hosted runtime secrets that are only stored remotely are not exported by this repo unless you also save them locally.
