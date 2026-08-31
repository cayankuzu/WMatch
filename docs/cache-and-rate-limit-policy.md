# Cache and rate-limit policy

## Cache policy

The invariant is `private, no-store`. The Worker opts into cache only when all of these are true:

- the matched route has an explicit positive TTL;
- the method is `GET`;
- the request has no `Authorization`, `Cookie`, or `Range` header;
- the origin returns schema-valid JSON with status `200` and no `Set-Cookie`.

Errors, redirects, malformed responses, authenticated traffic, search, batch requests, auth routes,
health, reports, CORS preflights, and every mutation are never stored. The response finalizer removes
`Set-Cookie` even on a cache bypass.

| Route | Edge `s-maxage` | Browser `max-age` | Notes |
|---|---:|---:|---|
| `/tmdb/trending/all/week` | 120 s | 60 s | anonymous, schema-valid list only |
| `/tmdb/movie/popular` | 300 s | 60 s | anonymous, schema-valid list only |
| `/tmdb/tv/popular` | 300 s | 60 s | anonymous, schema-valid list only |
| `/tmdb/movie/:id` and `/tmdb/tv/:id` | 900 s | 60 s | anonymous, schema-valid detail only |
| movie/TV translations | 3,600 s | 60 s | anonymous, schema-valid translation list only |
| search, media batch, auth, reports, health | none | none | `private, no-store` |

The cache key is the public Worker origin plus canonical path and sorted normalized query, with an
internal `__wmatch_cache_version=<CACHE_VERSION>` discriminator. Credentials never enter the key
because credential-bearing requests bypass cache entirely. Callers receive `x-wmatch-cache` as
`HIT`, `MISS`, `BYPASS`, or `NOT_ELIGIBLE`; origin correlation IDs are removed before storage.

Cloudflare's Cache API is local to a data center, so entries and invalidation are not a globally
strongly consistent database. For ordinary changes, allow the bounded TTL to expire. For a schema,
privacy, or correctness-sensitive change, advance `CACHE_VERSION`, deploy it as part of the immutable
Worker version, and retain the old version for rollback. If an emergency dashboard/API purge is
needed, the owner must use an exact reviewed scope; the workflows do not issue broad purges.

Monitor cache hit ratio by route and version, origin request rate, response-contract failures,
cache-write errors, and unexpected `BYPASS` growth. A hit-rate drop is not a reason to weaken the
anonymous-only rule.

## Worker rate limits

| Tier / binding | Limit | Applied routes | Identity key |
|---|---:|---|---|
| `AUTH_RATE_LIMITER` | 10 per 60 s | availability, password reset, disabled signup tombstone | HMAC(Cloudflare client IP), plus route ID |
| `MUTATION_RATE_LIMITER` | 20 per 60 s | authenticated report creation | HMAC(verified user subject), plus route ID |
| `PUBLIC_RATE_LIMITER` | 120 per 60 s | health, all allowlisted TMDB GETs, and media batch | HMAC(verified user subject or Cloudflare client IP), plus route ID |

Rate-limit keys are HMAC-SHA256 pseudonyms using `RATE_LIMIT_HASH_SECRET`; raw IPs and user UUIDs
are not sent to logs. The Worker returns `429` with `Retry-After: 60` when denied. A missing client
identity in preview/production or a binding failure returns `503` rather than silently allowing the
request. Development alone has a deterministic local fallback.

Cloudflare Workers Rate Limiting bindings are intentionally fast but counters are local to a
Cloudflare location and eventually consistent. They can allow short global bursts and must not be
used for exact business quotas, financial limits, authorization, uniqueness, or durable abuse
state. Exact invariants remain in Supabase transactions/RLS/functions. Rotating the hash secret
changes every key and therefore effectively resets edge counters.

Development, preview, and production use distinct rate-limit namespace IDs. Do not reuse an ID
across environments or tiers.

## Layered abuse and cost controls

The owner should add reviewed Cloudflare WAF/bot rules for coarse volumetric attacks and known-bad
signals before the Worker, then retain route validation/rate bindings in the Worker and exact
database controls at the origin. WAF thresholds, challenge actions, exclusions, usage alerts, and
monetary/CPU/request budgets depend on the real plan and traffic baseline and are therefore manual
configuration—not guessed source defaults.

Before advancing each production gate, compare the target version with the baseline for request
volume, `429`, `503`, origin error/timeout rate, p95/p99 latency, Worker duration/CPU, cache hit ratio,
and estimated spend. Any security, reliability, or budget breach blocks the next gate and triggers
rollback consideration.

## Required verification

Automated Worker-runtime tests cover allowlist rejection, method/CORS/body/query enforcement,
authentication failures, rate-limit allow/deny/binding-error behavior, canonical cache hits and
bypasses, non-caching of origin errors or `Set-Cookie`, response size/timeouts, retry rules, JWT key
rotation, and origin-signature/header scrubbing. Release workflows additionally compile each named
environment, assert immutable version metadata and traffic splits, smoke `/health`, and retain
deployment evidence.

Preview validation must still exercise real multi-request behavior, WAF rules, origin replay
rejection, multi-region/cache expectations, and owner-defined load/cost budgets before production.
