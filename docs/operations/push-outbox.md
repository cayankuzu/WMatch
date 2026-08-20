# Push outbox operations

The production push worker is invoked by `.github/workflows/push-outbox-drain.yml`
every five minutes and can also be run manually. The workflow drains durable event
jobs and delayed Expo receipt jobs, then fails if the service-only health read
model reports a dead letter, a provider receipt failure or work that has remained
due/locked for more than ten minutes. A failed scheduled workflow is the
operational alarm; GitHub Actions notifications or the repository's external alert
integration must route that failure to the on-call owner.

Required secrets in the GitHub `production` environment:

- `SUPABASE_URL`: project URL, without a trailing slash.
- `SUPABASE_ANON_JWT`: legacy JWT-shaped anon key used only for the function
  gateway check. A publishable `sb_publishable_...` key is not valid in the
  `Authorization` header while `verify_jwt = true`.
- `NOTIFICATION_WORKER_SECRET`: independent random worker secret, configured with
  the same value in Supabase Edge Function secrets.

The worker endpoint additionally checks `X-WMatch-Worker-Secret`; the anon JWT is
not sufficient to drain jobs. Queue rows, claims, exponential retry, five-attempt
dead-letter transition and the health RPC remain service-role only.

Each device token is submitted independently so an obsolete token from another
Expo project cannot poison a valid device batch with HTTP 400. Successful Expo
tickets are written to `push_delivery_receipts`; their first lookup is delayed for
15 minutes and missing receipts are retried until Expo's 24-hour expiry boundary.
`DeviceNotRegistered` receipts remove the corresponding token. Credential and
sender errors are retained as provider failures without resending an already
accepted event to healthy devices.

Credential triage:

- `expo_ticket_InvalidCredentials` on Android: replace the Expo project's FCM v1
  service-account credential with one from the Firebase project referenced by
  `firebase/google-services.json`.
- `expo_receipt_InvalidCredentials` on iOS: replace or re-associate the Apple Push
  Notification key for the Expo project and Apple team.
- `expo_http_400`: inspect the recorded provider response. The per-device submit
  path prevents an obsolete token from blocking the recipient's other devices.
- `DeviceNotRegistered`: no manual deletion is required; the receipt worker removes
  the token and the app registers again on its next authenticated foreground.

After repairing credentials, do not blindly resend stale social notifications.
Archive old incident rows first (the current production backlog is already more
than two weeks old):

```sql
UPDATE public.notification_events
SET
  push_status = 'not_requested',
  push_next_attempt_at = NULL,
  push_locked_at = NULL,
  push_last_error = 'operator_discarded_stale_after_push_incident'
WHERE push_status IN ('dead', 'retry')
  AND created_at < NOW() - INTERVAL '24 hours';
```

Only requeue a recent event when product explicitly decides that a delayed
notification is still useful. Run the worker after this decision and verify both
event and receipt health. Do not activate or requeue before fixing credentials; it
only recreates the same failures.

After deployment, run the workflow manually once and retain the run URL as release
evidence. A repository workflow file by itself is configuration, not proof that the
production scheduler is active.
