# Edge API boundaries

`index.ts` remains the single deployed Supabase Edge Function entry point. Its URL contract is intentionally stable at `/make-server-d962235e/*`; splitting deployment units without a compatibility layer would break released clients.

## Current ownership

| Boundary | Routes | Supporting module |
|---|---|---|
| Platform | health, request logging, CORS, error mapping | `index.ts` |
| HTTP security | trusted client identity, auth redirect validation, idempotency and abuse hashes | `httpSecurity.ts` |
| Pagination | opaque signed/validated cursors | `cursors.ts` |
| Authentication | availability, password reset, signup | `index.ts` |
| Profile and account | profile reads/writes, account deletion | `index.ts` |
| Discovery | live-now, users, watch and compatibility discovery, swipe quota | `index.ts` plus SQL read models |
| Relationships | likes, matches, blocks | `index.ts` plus database RPCs |
| Chat and safety | chats, messages, reports | `index.ts` plus database RPCs |
| Notifications | push tokens, read state, outbox drain | `index.ts` plus outbox RPCs |
| Media proxy | TMDB batch and proxy routes | `index.ts` |

## Change rules

- Route handlers validate external input before database access and return the existing public response shape.
- Discovery ranking, eligibility and keyset pagination stay in SQL read models; handlers must not re-rank or post-filter a page.
- Authenticated routes use `authMiddleware`. Worker-only routes require their dedicated secret in addition to the Supabase function authorization layer.
- Shared HTTP/security behavior belongs in a focused module with unit tests. Domain extraction should be incremental and behavior-preserving, not a deployment split.
- Generated database types are the source of truth for tables and RPCs. Temporary manual additions are allowed only for a migration that has not yet been regenerated remotely and must retain an explicit schema-version guard.
- New modules must remain free of framework-global mutable state so a warm Edge isolate cannot leak request data.

## Safe extraction order

When route churn justifies another split, extract one domain at a time in this order: media proxy, authentication, profile/account, discovery, relationships, chat/safety, notifications. Keep route registration in `index.ts`, move pure validation and service functions first, and run `npm run check:edge:type`, unit tests and contract tests after every boundary move.
