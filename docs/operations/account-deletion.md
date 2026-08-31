# Account deletion recovery

Account deletion is a forward-only, resumable job. The authenticated `DELETE /account`
route creates the job once and advances it through:

`requested -> related_data_deleted -> storage_deleted -> auth_deleted -> completed`

The job deliberately survives removal of the Auth user. Do not recreate a missing job
from the operations endpoint: the original job contains the owner-scoped photo paths
captured before deletion began.

## Resume an incomplete job

1. Confirm the user ID and inspect `account_deletion_jobs` with service-role access.
   Record the current `stage`, `updated_at`, and `last_error` in the incident ticket.
2. Set `ACCOUNT_DELETION_WORKER_SECRET` in the Edge Function secret store. Send the same
   value in `X-WMatch-Worker-Secret`; never put it in query strings, logs, or a mobile build.
3. Call the internal endpoint with one explicit UUID:

   ```sh
   curl --fail-with-body \
     --request POST "$WMATCH_API_BASE/account-deletion-jobs/resume" \
     --header "Content-Type: application/json" \
     --header "X-WMatch-Worker-Secret: $ACCOUNT_DELETION_WORKER_SECRET" \
     --data '{"userId":"00000000-0000-4000-8000-000000000000"}'
   ```

4. Verify the response reports `stage: completed`, then verify the job has a
   `completed_at` value and no profile or Auth user remains.

The endpoint returns `404` when no prior job exists, `401` for a missing or incorrect
worker secret, and `500` when a stage remains retryable. A retry resumes from the saved
stage; it must never reset `photo_paths` or create a new deletion request.

## Rotation and incident handling

Rotate the worker secret after suspected exposure and update the Edge secret before the
next retry. Repeated `last_error` values should be escalated with the job UUID and stage,
without copying profile photos, report details, access tokens, or other user content into
the ticket.
