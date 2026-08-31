# Edge API boundaries

`index.ts` remains the single deployed Supabase Edge Function entry point. Its URL contract is intentionally stable at `/make-server-d962235e/*`; splitting deployment units without a compatibility layer would break released clients.

## Current ownership

| Boundary | Routes | Supporting module |
|---|---|---|
| Deploy entrypoint | shared middleware registration, route registration, `Deno.serve` | `index.ts` |
| Platform | health and schema readiness | `domains/system.ts` |
| Shared runtime | database helpers, serializers, error mapping and cross-domain services | `runtime.ts` |
| Shared middleware | authentication, request ID/logging, trusted-origin HMAC and rate limiting | `sharedMiddleware.ts` |
| HTTP security | trusted client identity, auth redirect validation, idempotency and abuse hashes | `httpSecurity.ts` |
| Pagination | opaque signed/validated cursors | `cursors.ts` |
| Authentication/account | availability, reset, signup and deletion jobs | `domains/auth.ts` |
| Profile/discovery | profile reads/writes, live-now and discovery reads | `domains/profileDiscovery.ts` |
| Swipe | quotas, likes and incoming-like discovery | `domains/swipe.ts` |
| Match | matches and blocks | `domains/match.ts` |
| Chat | chat settings/state and messages | `domains/chat.ts` |
| Moderation | report validation, persistence and mail handoff | `domains/moderation.ts` |
| Notifications | push tokens, read state and outbox drain | `domains/notification.ts` |
| Storage | owned profile-photo validation, signing and cleanup | `domains/storage.ts` |
| Media proxy | TMDB batch and proxy routes | `domains/tmdb.ts` |
| Route contract | deterministic registry and reviewed 41-route snapshot | `routeRegistry.ts`, `quality/edge-route-contract.snapshot.json` |

## Change rules

- Route handlers validate external input before database access and return the existing public response shape.
- Discovery ranking, eligibility and keyset pagination stay in SQL read models; handlers must not re-rank or post-filter a page.
- Authenticated routes use `authMiddleware`. Worker-only routes require their dedicated secret in addition to the Supabase function authorization layer.
- Shared HTTP/security behavior belongs in the common middleware/security modules with unit tests. Domain modules own real handlers and business validation while remaining one deployment unit.
- Generated database types are the source of truth for tables and RPCs. Temporary manual additions are allowed only for a migration that has not yet been regenerated remotely and must retain an explicit schema-version guard.
- New modules must remain free of framework-global mutable state so a warm Edge isolate cannot leak request data.

The route registry is machine-readable at runtime, while
`quality/edge-route-contract.snapshot.json` is the reviewed build-time contract. Any method/path
change must update both deliberately and pass `npm run check:edge` plus the feature-surface guard.
