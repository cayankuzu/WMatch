# Real-device E2E matrix

Maestro runs against the native `com.wmatch.app` build. Never use production user
credentials in CI. The complete social journey needs an isolated Supabase staging
project and at least three confirmed fixture users so reciprocal like/match, block,
report and message state can be asserted deterministically.

## Available executable flows

- `.maestro/login.yaml`: clears application state and performs a real email/password
  login using `E2E_EMAIL` and `E2E_PASSWORD` environment variables.
- `.maestro/signed-in-navigation-smoke.yaml`: preserves the current test session and
  verifies all six mobile-only destinations render on a connected device.

## Required release evidence

Run against both a signed Android release build and an iOS release/TestFlight build:

1. New registration, email verification deep link and first login.
2. Select/start/pause/resume/stop a movie or series; verify watch discovery.
3. Compatibility pagination and score ordering with known fixture libraries.
4. One-sided like, reciprocal like, match creation, undo and quota behavior.
5. Block/unblock and report; verify the blocked user disappears from discovery,
   likes, matches and chat.
6. Send a stable client-id message, retry it offline, reconnect, assert one message,
   read status, pagination and realtime delivery on the peer device.
7. Edit profile/photo order, force-stop/relaunch, logout/login and delete a disposable
   account.
8. Exercise notification taps and verified HTTPS signup/reset deep links from a
   killed app.

For every run retain the Maestro report, screen recording, device/OS/build identity,
server release/schema health and fixture seed identifier. The checked-in flows are
automation assets; unexecuted rows remain `NO-GO` and must not be reported as proof.
