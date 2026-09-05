# Push outbox, retry, receipt, and dead-letter contract

Status: **repository implementation present; clean database/provider runtime evidence pending**.

## Event outbox state machine

```text
pending/retry -> processing -> submitted
                         |--> no_tokens
                         |--> suppressed
                         |--> retry -> processing
                         `--> dead
```

`notification_events` is both the user notification record and durable push-event outbox. Claims
are service-role-only, ordered by due time, protected by `FOR UPDATE SKIP LOCKED`, limited to 25 by
the runtime, and recover a processing lease older than five minutes.

| Result | Rule |
|---|---|
| `submitted` | At least one device was accepted by Expo; accepted healthy devices are not resent |
| `no_tokens` | Recipient has no registered device token |
| `suppressed` | Final locked policy check rejects blocked/inactive/deleted/muted pair delivery |
| `retry` | No device was accepted and the failure is transient |
| `dead` | Permanent submission failure, or the fifth retryable event attempt is exhausted |

Event retry delay is `30 * 2^(attempt-1)` seconds capped at one hour. The completion RPC only updates
a row that still owns its `processing` lease; a lost lease is a hard error except an idempotent
already-suppressed completion. `suppressed` is terminal, remains in the notification timeline for
auditability, clears its due/lease fields, and is never reclaimed.

Before any provider call, `authorize_push_delivery_job` locks the event and relationship pair and
rechecks bilateral blocks, active match/chat state, recipient chat deletion, and the recipient's
`notifications_enabled` setting. A relationship mutation also suppresses not-yet-terminal paired
events under the same advisory lock. This closes the claim-to-send race without deleting the event.

## Per-device submission rules

- Devices are submitted one per Expo HTTP request so an obsolete token/project cannot poison a
  healthy token in a mixed batch.
- HTTP `429` and `5xx`, a missing ticket, `MessageRateExceeded`, and transport failures are
  retryable when no device has been accepted.
- Other HTTP `4xx` and ticket errors are permanent. `DeviceNotRegistered` removes the token.
- If at least one device was accepted, the event becomes `submitted` even when another device
  failed. The partial error is retained, but the whole event is not replayed because that would
  duplicate the healthy device notification.

## Receipt state machine

```text
pending/retry -> processing -> delivered
                         |--> retry -> processing
                         |--> error
                         `--> dead (24-hour expiry)
```

Accepted ticket IDs are inserted idempotently by `ticket_id`. The first lookup is due after 15
minutes. Receipt jobs use a five-minute lease, batches up to 300 in the runtime, and retry after
`300 * 2^(attempt-1)` seconds capped at one hour. Unresolved jobs become `dead` after 24 hours;
terminal receipt rows older than seven days are deleted by the claim function.

An Expo receipt `ok` becomes `delivered`. A missing receipt, provider HTTP fault, or transport fault
retries. A provider receipt error becomes `error`, is copied to the parent event's sanitized
`push_last_error`, and makes scheduler health fail. `DeviceNotRegistered` also removes the token.

## Health and scheduler invariant

`.github/workflows/push-outbox-drain.yml` calls the service-only drain endpoint every five minutes.
The response is healthy only when all of these are zero:

- event `dead`;
- event work due/locked for more than ten minutes;
- receipt `error` or `dead` updated in the last 24 hours;
- receipt work due/locked for more than ten minutes.

The workflow must be protected by the production environment. Its failure notification must be
routed to an assigned on-call owner. A repository cron definition is not proof that scheduling or
alert delivery is active.

## Dead-letter handling

1. Stop automatic drain or otherwise contain repeated provider calls when credential/global faults
   are active.
2. Preserve aggregate counts, timestamps, error codes, Function version, and workflow run URL. Do
   not export raw tokens or message bodies.
3. Classify credential, invalid-token, rate-limit, provider outage, schema/lease, or application
   contract failure.
4. Correct the cause and validate with a newly created controlled event.
5. Requeue only a recent event for which delayed delivery is still a product-approved outcome.
   Never bulk replay stale likes, matches, or messages.
6. Record the operator, incident ID, affected IDs as salted hashes, UTC interval, action, and final
   receipt/health result.

Detailed credential and incident procedure:
`docs/push-incident-and-credential-rotation-runbook.md`.
