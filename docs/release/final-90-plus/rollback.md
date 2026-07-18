# Final 90 Plus Rollback Notes

Date: 2026-07-15

## App Rollback

- Keep the previous signed AAB available until internal testing validates `1.0.28`.
- If `1.0.28` fails internal testing, halt rollout in Play Console and keep the previous production track active.
- Do not generate a new Android signing key; release identity must stay unchanged.

## Edge Rollback

- Supabase function deploy is versioned by source state, but this repository does not have a saved remote function rollback pointer.
- To roll back, deploy the previously validated function source from the previous release commit and verify `/health` returns the expected release/schema contract.

## Database Rollback

- No automated rollback migration was added in this pass.
- Do not run destructive rollback against production without owner approval and backup verification.
- For schema-contract issues, first verify `schema_contracts` state and Edge `/health` `schemaReady` output.
- For data repair issues, use the audit tables added by migration `20260715201000` before applying any manual repair.

## Verification After Rollback

- `npm run check:edge`
- `npm run check:migrations`
- Supabase `/functions/v1/make-server-d962235e/health`
- Android internal install smoke
- Critical auth/profile/discovery/chat smoke
