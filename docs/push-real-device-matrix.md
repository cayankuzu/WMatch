# Push real-device verification matrix

Candidate target: app/runtime `1.0.51`, Android `53`, iOS `55`

Verdict: **NO-GO — no current same-SHA matrix row is marked passed**.

This is the required evidence matrix, not a claim of execution. Replace `PENDING` only with an
artifact path containing the immutable source SHA, signed build identity, device/OS, UTC time,
redacted token hash, event ID hash, Expo ticket/receipt reference, expected/actual result, and tester.
Screenshots or prose without those fields are insufficient.

## Required device coverage

| Platform/build | Minimum physical coverage | Install source | Status | Evidence |
|---|---|---|---|---|
| Android `53` | One current Android and one supported older API level; include OEM channel settings | Play Internal or verified signed AAB-derived install | PENDING | — |
| iOS `55` | One current iOS and one supported older iOS version | TestFlight or verified signed IPA | PENDING | — |

Emulator/simulator results may supplement debugging but cannot satisfy remote push registration.
Old Android 51/iOS 53 results are historical and cannot close this matrix.

## Lifecycle and routing cases

Run every applicable case on both platforms and both candidate devices.

| Case | Expected result | Android | iOS |
|---|---|---|---|
| First launch before permission request | No unsolicited permission prompt from background sync | PENDING | PENDING |
| Explicit allow | Token registers once; owner and platform are correct | PENDING | PENDING |
| Deny / cannot ask again | No token remains active; settings-required is shown safely | PENDING | PENDING |
| Android app/channel disabled | No false registered UX; settings opens the correct channel | PENDING | N/A |
| iOS presentation disabled/provisional transition | State is detected and explicit request/settings path behaves correctly | N/A | PENDING |
| App foreground | One visible local presentation; no Realtime/remote duplicate | PENDING | PENDING |
| App background | Provider notification appears once and tap opens expected destination | PENDING | PENDING |
| App terminated/cold start | Last response is consumed once and opens expected destination | PENDING | PENDING |
| `like` | Opens Likes `likedme`; no new route | PENDING | PENDING |
| `match` | Opens the existing peer chat | PENDING | PENDING |
| `message` | Opens peer chat and read behavior remains owner-scoped | PENDING | PENDING |
| `chat_ended`/`chat_blocked`/`chat_unblocked` | Opens existing chat state without exposing blocked content | PENDING | PENDING |
| Disable per-chat notifications before provider send | Event is terminal `suppressed`; no remote notification arrives | PENDING | PENDING |
| Block/end/delete chat while a job is claimed | Locked final authorization suppresses stale delivery | PENDING | PENDING |
| Unknown/malformed payload | Safely ignored; no arbitrary URL/navigation | PENDING | PENDING |
| Collapse/tag and duplicate event | At most one presentation for the intended group/event | PENDING | PENDING |

## Token and failure cases

| Case | Required assertion | Android | iOS |
|---|---|---|---|
| Token rotation | New token registers before old token removal; no duplicate recipient | PENDING | PENDING |
| Logout | Current token is removed or queued for secure revocation; old account gets no push | PENDING | PENDING |
| Account switch | Token belongs only to the new owner; cross-account delivery is zero | PENDING | PENDING |
| Offline during unregister | Pending SecureStore revocation retries after reconnect | PENDING | PENDING |
| `DeviceNotRegistered` ticket | Server deletes only the invalid token | PENDING | PENDING |
| `DeviceNotRegistered` receipt | Receipt worker deletes only the invalid token | PENDING | PENDING |
| One valid and one obsolete token | Valid device receives once; bad token cannot poison the event | PENDING | PENDING |
| Provider `429`/`5xx` | Bounded retry/backoff; no duplicate after accepted ticket | PENDING | PENDING |
| Invalid FCM/APNs credential | Health fails, alert arrives, no blind stale replay | PENDING | PENDING |
| Receipt delay | First lookup is delayed; ticket reaches `delivered` or actionable error | PENDING | PENDING |
| Scheduler outage/recovery | Stalled threshold alerts; controlled recovery preserves lease/dedupe | PENDING | PENDING |

## Exit criteria

- Both platforms have accepted tickets and delayed `ok` receipts from the current candidate.
- Foreground, background, terminated, permission, channel, account switch, logout, token rotation,
  invalid token, provider fault, and tap routing cases pass.
- The scheduled drain and its alert path are observed, not merely configured.
- Evidence contains no raw token, secret, user message, email, precise location, or private URL.
- Every artifact and provider record is tied to the same immutable candidate SHA.

Until all exit criteria are met, push remains a release-blocking **NO-GO**.
