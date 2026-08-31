# WMatch no-new-feature audit

Baseline: `b8ff52ac41eda5f6ef1e43472784d794328f7050`
Audit date: 2026-08-30
Scope: AAA-MVP hardening only

## Decision

The permitted product surface is exactly the baseline described by
`docs/existing-feature-contract.md` and `quality/feature-surface.snapshot.json`. The Stage-0 work
adds inventory, tests and a fail-closed guard; it adds no user feature. The final release audit must
run the same guard again on the immutable release SHA. This document is not a substitute for that
final run.

## Baseline surface

| Surface                             |         Frozen value |
| ----------------------------------- | -------------------: |
| Tabs                                |                    6 |
| State/navigation routes             |                   11 |
| Screen entrypoints                  |                   13 |
| Product modal entrypoints           |                   12 |
| Sheet entrypoints                   |                    2 |
| Notification event types            |                    6 |
| Baseline Hono method/path contracts |                   40 |
| Baseline database tables            |                   26 |
| Storage buckets                     | 1 (`profile-photos`) |

The snapshot also freezes auth states, chat/discovery filters, settings group/row/toggle keys,
translation namespaces, Expo/native permissions, deep-link schemes/hosts/paths and public API
contracts.

## Guard behavior

`scripts/guards/check-no-new-product-surface.mjs` derives the current surface from source rather
than trusting a hand-edited count. It fails on an added or removed:

- auth state, tab or state route;
- `*Screen`, product `*Modal` or `*Sheet` entrypoint;
- chat/discovery filter or discovery gender choice;
- notification type or notification route kind;
- visible Settings group, CTA/link or toggle;
- translation top-level namespace;
- Expo/native permission, deep-link or native capability;
- public API contract, Hono method/path, database table or Storage bucket.

Product fields cannot be placed in the infrastructure allowlist. A permitted internal change must
be an exact add/remove value on a limited infrastructure field and must record:

- classification `internal-security-ops`;
- a concrete reason;
- the existing flow being hardened;
- implementation paths.

The current reviewed allowlist contains the service-role-only `moderation_report_audit_events` and
`edge_origin_hmac_nonces` tables plus the worker-secret-only
`POST /account-deletion-jobs/resume` route. They strengthen the existing report/moderation,
origin-replay protection and account deletion flows and create no screen, CTA or new user job. The
live collector therefore reports 28 tables and 41 routes while the immutable baseline remains 26
and 40.

## Manual feature comparison

| Question                             | Baseline answer              | Stage-0 answer                                                                      |
| ------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------- |
| New top-level screen/tab/route?      | Not permitted                | No                                                                                  |
| New modal/sheet/user journey?        | Not permitted                | No                                                                                  |
| New Settings group/CTA/toggle?       | Not permitted                | No                                                                                  |
| New filter/content/media type?       | Not permitted                | No                                                                                  |
| New notification category/target?    | Not permitted                | No                                                                                  |
| New product-domain table or bucket?  | Not permitted                | No                                                                                  |
| New admin/moderator/organizer panel? | Not permitted                | No                                                                                  |
| Existing feature removed or renamed? | Not permitted                | No                                                                                  |
| Internal hardening state?            | Allowed with narrow evidence | Two internal tables and one account-deletion recovery route, explicitly allowlisted |

## Explicit rejected scope

Calendar/reminder, QR, waitlist, saved search, a new list/filter, dark mode, payment/premium
purchase, ads, verification badge, “why suggested”, watch party, calling, public profile/safety
pages and admin/moderator/organizer panels remain out of scope. New copy or a differently named
component does not make any of these acceptable.

## Verification

```bash
npm run check:feature-surface
npx vitest run tests/feature-surface-guard.test.ts
```

The focused test proves that the repository matches the snapshot, that simulated calendar
tab/route/table additions and an existing screen removal fail, and that a product field cannot use
the infrastructure allowlist.
CI/release integration must execute `npm run check:feature-surface` on the same clean commit used
for all other release evidence.

## Residual limitations

No source guard can replace review: a developer can hide a user flow inside an existing component
or deliberately edit both guard and snapshot. Reviewers must compare this immutable baseline SHA,
inspect new user-facing strings and JSX actions, and reject snapshot baseline changes. Runtime
screenshots and navigation automation are still required to prove the final binary exposes the
same surface.
