# WMatch production readiness status

Updated: 2026-09-03

Current target: app/runtime `1.0.51`, Android `versionCode 53`, iOS `buildNumber 55`

Verdict: **NO-GO**

This file is the short current-status entry point. The detailed assessment and evidence rules are in
`docs/release-readiness.md` and `release-evidence/README.md`.

## Repository state

- Selective Cloudflare Worker, OTA channels/runtime, fail-closed change classifier, database guards,
  and forward migrations are present in the repository.
- Cloudflare production operations now require successful default-branch same-SHA CI, Quality, and
  Database validation runs. A gradual rollout smoke targets the exact Worker UUID and requires the
  response version header to equal the candidate commit SHA.
- Release evidence automation generates a real `manifest.json` from clean source identity, upstream
  run records, command logs, SBOMs, Expo export checksums, and current migration identity.
- `infra/docker/` adds a measured, mobile-runtime-free validation layer. Its `test`, `resilience`, and
  `load` profiles were executed on the current content and all exited 0: two full migration replays
  with four pgTAP files and 166 assertions per round, zero warn-level database advisors, an
  owner-preserving dump/restore, Toxiproxy fault injection, and a deterministic k6 provider smoke.
- `npm run verify:release` passes end to end on the clean candidate tree, including the new
  `check:deno:lock` gate, a refreshed Expo SDK 57 patch alignment, and the scoped `@xmldom/xmldom`
  overrides that close GHSA-6gmq-8vp8-gcm6.
- Provider, device, signed artifact, store, alert, restore, and manual evidence is never inferred by
  those repository checks.

## Current release blockers

1. The candidate commit now carries every current change and passes the local gate chain, but no
   pushed same-SHA `CI`, `Quality`, `Database validation`, `Docker validation`, or `Release evidence`
   run exists yet, so there is still no immutable provider-side evidence set.
2. `20260831153000_chat_privacy_push_invariants.sql` replays cleanly twice on an isolated local
   PostgreSQL 17 stack with the full pgTAP RLS/IDOR matrix, an empty `public,storage,realtime` diff,
   and a verified dump/restore. It still has no staging apply and no approved production apply.
3. GitHub environment shells exist, and `production`/`cloudflare-production` require reviewer
   `cayankuzu` plus protected branches. `main` now strictly requires `CI verify` and `Quality verify`,
   enforces the rule for admins and blocks force-push/delete. Environment secrets/vars,
   Cloudflare/EAS provider configuration, and a real approval run remain unverified or missing.
4. No current Cloudflare preview/production rollout and rollback evidence exists.
5. No current OTA preview/production group, staged rollout, rollback, or code-signing evidence exists.
6. Current signed Android 53 and iOS 55 artifacts are not tied to one immutable SHA with signature,
   store, and physical-device evidence.
7. The push real-device/provider/scheduler matrix remains pending on both platforms.
8. Load, accessibility, observability/alert, provider PITR/Storage restore, moderation, account
   deletion, privacy/store forms, and review evidence remains pending.

## Historical evidence boundary

`docs/release/1.0.50/evidence.md` records historical Android 51/iOS 53 and provider work. It must not
be used as proof for app/runtime 1.0.51, Android 53, iOS 55, the new migration, or the current Worker
and OTA contracts.

No production database reset, history rewrite, invented provider result, synthetic device proof, or
cross-SHA evidence merge is allowed. GO requires the complete evidence set under one candidate SHA.
