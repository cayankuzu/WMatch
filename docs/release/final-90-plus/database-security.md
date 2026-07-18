# Final 90 Plus Database And Security Evidence

Date: 2026-07-15

## Applied Remote State

- Linked Supabase project: `eaggwbuvpfzrejamwqry`.
- Migration `20260715201000_p0_reaudit_closures.sql` was applied with `npx supabase db query --linked --file` after `npx supabase db push --linked` hit a Windows file-open error.
- Migration history was repaired with `npx supabase migration repair --linked --status applied 20260715201000`.
- Follow-up dry-run reported the remote database up to date.

## Static Guards Added

- Latest migration must remain `20260715201000_p0_reaudit_closures.sql`.
- Schema contract tokens and service-role-only RPC grants are required.
- Catastrophic patterns such as dropping core public tables, dropping the public schema, truncating core tables, or deleting from `auth.users` fail the guard.
- Edge release version, Android/iOS version coordinates, required schema, health contract, route count, and wildcard/empty selects are checked by `npm run check:edge`.

## Remaining Security Gaps

- Static migration checks do not prove RLS behavior.
- A staging RLS attack suite with seeded attacker/victim users is still required.
- Owner approval is required before any migration squash, destructive reset, or production data rewrite.
- Provider secret rotation and Supabase dashboard secret inventory are manual owner tasks.
