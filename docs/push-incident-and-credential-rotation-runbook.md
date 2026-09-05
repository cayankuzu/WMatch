# Push incident and credential rotation runbook

Use this runbook for Expo/FCM/APNs credential faults, elevated ticket/receipt errors, dead or stalled
outbox work, cross-account delivery, duplicate notification storms, scheduler failures, or suspected
secret compromise.

Current state: **owners, production alert delivery, current provider credentials, and current-device
drills require external evidence; release remains NO-GO**.

## Roles and severity

Assign named people before production:

- incident commander: containment and decision log;
- backend/operator: scheduler, Function, database aggregates, worker-secret rotation;
- mobile/provider owner: Expo, FCM, APNs, signed build identity;
- security/privacy owner: cross-account exposure, token/secret compromise, notification content;
- release approver: re-enable, requeue, rollback, and evidence acceptance.

Treat cross-account delivery, raw-token/secret exposure, or unauthorized drain access as security
severity P0. Widespread credential failure, duplicate storm, or unbounded backlog is availability P0.
Single invalid tokens are normal lifecycle events unless their rate breaches the approved baseline.

## Detect and contain

1. Open an incident ID and record UTC start, affected platforms/build/runtime, Function version,
   candidate SHA, scheduler run, and aggregate health. Never copy raw tokens or bodies.
2. For repeated global/provider failures, pause the scheduled drain using the protected GitHub
   workflow control. Preserve the most recent failed run and sanitized response first.
3. Do not delete or bulk requeue rows. Claims/receipts are forensic state and prevent duplicates.
4. If credential compromise is suspected, revoke the affected provider credential and rotate the
   independent scheduler worker secret. If cross-account delivery is suspected, stop push delivery
   until owner isolation is proven on physical devices.
5. Realtime in-app notification events may continue only if the incident does not involve payload or
   authorization integrity; document that decision.

## Sanitized diagnosis

Collect counts and error-code groups, not payloads:

- event states: pending, retry, processing, submitted, no_tokens, dead;
- oldest due age and processing lease age;
- receipt states and errors in the last 24 hours;
- platform/build/runtime/source SHA;
- Expo HTTP status, ticket error code, receipt error code;
- scheduled workflow run ID and Supabase Function version.

Common classifications:

| Signal | Likely cause | First action |
|---|---|---|
| `expo_ticket_InvalidCredentials` on Android | Wrong/expired FCM v1 account or Firebase project mismatch | Verify Expo project and Firebase sender identity; rotate FCM credential |
| `expo_receipt_InvalidCredentials` on iOS | APNs key/team/bundle association invalid | Verify Apple team, key, bundle ID; rotate/reassociate APNs key |
| HTTP `429`/`5xx` | Provider throttle/outage | Keep bounded retry, pause only if backlog/duplicates exceed SLO |
| HTTP `400` for one token | Obsolete/foreign Expo token or invalid payload | Preserve per-device isolation; remove invalid token after classified result |
| `DeviceNotRegistered` | App removed/token rotated | Allow automatic token cleanup; do not page by itself |
| `expo_receipt_pending` | Receipt not yet visible | Keep delayed bounded retry until 24-hour expiry |
| Lost processing lease/schema error | Function/DB contract mismatch | Stop drain; verify migration and Function same-SHA provenance |

## Rotate FCM or APNs credentials

1. Confirm Expo project ID, Android package/iOS bundle ID, Firebase project/Apple team, and affected
   signed build before modifying credentials.
2. Create/associate the replacement in the provider and Expo/EAS credential manager. Do not download
   it into the repository or attach it to the incident.
3. Revoke the superseded credential as soon as provider overlap policy and incident severity allow.
4. Use a newly created controlled event on a current physical device. Require accepted Expo ticket,
   delayed receipt, foreground/background/terminated behavior, and correct tap route.
5. Run the drain manually once, confirm zero dead/stalled/recent receipt failures, then observe a
   subsequent scheduled run before declaring recovery.
6. Record only credential identifier/fingerprint, owner, provider project/team, rotation time, test
   ticket/receipt references, and evidence URLs.

## Rotate the scheduler worker secret

The current endpoint accepts one worker secret, so rotation is a coordinated maintenance action:

1. Pause the scheduled drain and confirm no active run.
2. Generate a new independent high-entropy value in the approved secret manager.
3. Update the Supabase Edge Function secret and the protected GitHub `production` environment secret
   without printing either value.
4. Deploy/verify the intended Function version, run one protected manual drain, and confirm the old
   credential is rejected using a safe non-secret test mechanism.
5. Resume scheduling and retain the run URL and secret-version identifiers. Delete any temporary
   local secret material.

Do not substitute the Supabase service-role key, Expo token, or public anon/publishable key for the
worker secret.

## Recovery and requeue decision

- Prove the corrected path with a fresh synthetic event first.
- Never replay an event already accepted by at least one device; its `submitted` state prevents
  duplicate delivery.
- Do not blindly resend stale likes, matches, chat-state changes, or messages. Product and privacy
  owners must approve each delayed-delivery class and maximum age.
- Archive/discard stale failed delivery intent only through an approved, audited operation that
  preserves incident reason and aggregate evidence.
- Re-enable automatic drain gradually and watch event age, ticket errors, receipt errors, duplicate
  reports, and provider quotas.

## Close and retain evidence

Close only after root cause, affected interval/platform/build, containment, rotation identifiers,
fresh ticket/receipt, manual and scheduled drain health, device route tests, backlog disposition,
and follow-up owner are recorded. Redact raw tokens, keys, bodies, emails, user IDs, and URLs carrying
credentials. Link the incident evidence to the immutable release SHA; an incident from an older
binary does not validate the current candidate.
