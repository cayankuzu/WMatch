# Push provider and token lifecycle

Status: **configuration and real-device proof pending; release NO-GO**.

WMatch uses Expo Push as the delivery broker. Expo forwards accepted messages to FCM v1 on Android
and APNs on iOS. An Expo ticket means the broker accepted a submission; only a later receipt can
show delivery acceptance or a provider error. Neither a checked-in workflow nor an old store build
proves current credentials.

## Required trust chain

| Layer | Required identity/configuration | Evidence required for current candidate |
|---|---|---|
| Mobile binary | Expo/EAS `projectId`, package/bundle identity, notification entitlement/config | Signed Android 53 and iOS 55 metadata from the candidate SHA |
| Expo project | Production FCM v1 and APNs credentials associated with that project | Provider credential reference, owner, rotation date; never the secret itself |
| Supabase Edge | Public gateway key plus service-only runtime; no provider credential in mobile | Deployed Function version/source SHA and sanitized health |
| Scheduler | Protected `production` environment and independent worker secret | Successful manual and scheduled run URLs for the same release window |
| Device | Physical device, permission and enabled OS/channel state | Redacted token hash, platform/build/runtime/SHA, ticket and receipt references |

## Registration lifecycle

1. Startup/foreground synchronization configures presentation without automatically granting a
   permission the user has denied.
2. Remote registration is skipped on simulators. A physical device is mandatory.
3. Permission is requested only through the explicit request path. iOS authorized, provisional, or
   ephemeral status is recognized; disabled Android channel and blocked iOS presentation are
   surfaced as settings-required.
4. The client resolves the Expo project ID and calls `getExpoPushTokenAsync`.
5. `POST /notifications/push-token` accepts only `ExpoPushToken[...]` or
   `ExponentPushToken[...]`, normalizes the platform, rate-limits the owner/request identity, and
   upserts `last_seen_at`.
6. A successful registration is stored owner-scoped on the device. A 60-second cooldown and one
   in-flight synchronization prevent startup/foreground races.
7. Token-listener and dropped-notification callbacks trigger another serialized sync. Transient
   client failures retry after 5 s, 15 s, 60 s, then 5 minutes.

## Rotation, account switch, logout, and revocation

- When the provider returns a different token, the new token is registered before the previous
  token is removed.
- Failed old-token removal is stored in SecureStore as a pending revocation and retried for the same
  owner on a later sync.
- Logout/account deletion waits for current sync, tries to unregister all known tokens, queues
  failed revocations, removes the active local registration, and clears in-memory sync state.
- A token belongs to exactly one current owner because it is the table primary key. Account-switch
  tests must prove that the old account no longer receives events after ownership changes.
- Expo ticket or receipt error `DeviceNotRegistered` deletes the obsolete token server-side.

Tokens are credentials/PII. Operational output may use a stable salted hash or the last few
characters only; raw tokens are prohibited in issues, screenshots, logs, and release evidence.

## Credential validation and rotation policy

- Validate Android and iOS independently on current signed binaries. One platform passing does not
  validate the other.
- Rotate FCM/APNs credentials before expiry or immediately after compromise, project/team change,
  `InvalidCredentials`, or sender mismatch.
- Use the Expo/EAS credential owner account and provider consoles; never commit service-account JSON,
  `.p8`, passwords, or private keys.
- After rotation, send a new synthetic event to a controlled device, retain the ticket and delayed
  receipt, exercise background/terminated tap routing, and observe at least one subsequent scheduled
  drain. Do not reuse a stale social event as the test.
- Follow `docs/push-incident-and-credential-rotation-runbook.md`; do not requeue dead rows until the
  credential fault is corrected.

## GO gate

Current target evidence must include both platforms, current source SHA, Android/iOS build numbers,
Expo project/runtime identity, redacted device/token identity, accepted ticket, delayed `ok` receipt,
tap destination, and scheduler health. Until attached to one immutable SHA, this area remains
**NO-GO**.
