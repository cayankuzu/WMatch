# WMatch selective Cloudflare architecture

## Decision

Cloudflare fronts only a small allowlist of existing HTTP capabilities: public TMDB reads,
availability/password-reset abuse controls, authenticated report creation, and health. It does not
replace the Supabase client, proxy arbitrary paths, or introduce a new product feature.

```text
Mobile/web client
  |-- selected allowlisted HTTP routes --> WMatch Worker --> signed request --> Supabase Edge Function
  |                                      |-- anonymous TMDB GET cache
  |                                      `-- redacted logs + per-route rate limit
  |
  `-- existing direct SDK traffic ------> Supabase Auth / Database / Realtime / Storage

Server-only scheduler ------------------> push-outbox drain (never exposed by this Worker)
```

This split is intentional. A single global `API_BASE_URL` must not redirect Auth, Realtime,
Storage, database RPC, or push-drain traffic through the Worker.

## Trust boundaries and request pipeline

Every request crosses these checks in order:

1. Runtime configuration is parsed once per Worker isolate. Missing, malformed, insecure, or
   `REQUIRED__...` placeholder values return a sanitized `503`.
2. The exact path registry is matched. Encoded, backslash, double-slash, oversized, and unknown
   paths are rejected. Query keys are allowlisted and canonicalized.
3. An `Origin` header, if present, must exactly match `ALLOWED_ORIGINS`. Preflight methods and
   headers are also allowlisted. CORS is browser policy, not authentication.
4. Method, JSON content type, byte limit, UTF-8, schema, and unknown fields are checked before an
   origin request is made.
5. Routes with optional or required authentication verify an `ES256` or `RS256` access token with
   Web Crypto and the configured same-origin Supabase JWKS endpoint. Issuer, audience, lifetime,
   subject UUID, and `authenticated` role are checked.
6. The appropriate Cloudflare Rate Limiting binding receives an HMAC-pseudonymized user or IP key.
   Missing production client identity and binding errors fail closed.
7. Only eligible anonymous TMDB GETs consult the named Cache API. Everything else bypasses cache.
8. The Worker constructs a URL beneath one fixed HTTPS `ORIGIN_BASE_URL`; callers cannot choose a
   host or upstream path. Forwarded headers are rebuilt from scratch.
9. Each origin request carries a fresh timestamp/nonce and an HMAC over method, canonical path,
   exact body hash, request ID, and pseudonymous client identity. The origin must verify it.
10. Origin calls use an eight-second timeout and a two-MiB response ceiling by default. GETs receive
    at most one retry for a network failure or `502`/`503`/`504`; mutations and `429` responses are
    never retried.
11. Response headers are rebuilt, `Set-Cookie` is removed, security headers are added, and default
    caching is `private, no-store`. Logs contain route IDs and bounded identifiers, not payloads,
    URLs, query values, tokens, cookies, email addresses, or raw IP addresses.

The exact route, query, authentication, body, and cache contract is in
[`cloudflare-route-matrix.md`](cloudflare-route-matrix.md).

## Origin authentication contract

The Worker overwrites caller-supplied origin-authentication headers and emits:

- `x-wmatch-origin-key-id`
- `x-wmatch-origin-timestamp` as epoch seconds
- `x-wmatch-origin-nonce` as a UUID
- `x-wmatch-origin-body-sha256` as lowercase hex over the exact forwarded bytes
- `x-wmatch-origin-signature` as `v1=<unpadded-base64url-HMAC-SHA256>`
- `x-request-id`
- `x-wmatch-client-identity` as an HMAC pseudonym, never a raw IP

The signed value is nine LF-delimited lines, with no trailing LF:

```text
wmatch-origin-v1
<key-id>
<timestamp>
<nonce>
<UPPERCASE-METHOD>
<origin-path-and-sorted-query>
<lowercase-body-sha256>
<request-id>
<client-identity-hash>
```

The Supabase function must reconstruct the same value from the request, compare signatures in
constant time, enforce the configured clock-skew window, and atomically reject nonce reuse for at
least that window. A signature without replay storage does not close direct-origin bypass.

## Environment isolation

| Environment | Worker name | Public development URL | Rate-limit namespaces | Deployment intent |
|---|---|---:|---|---|
| development | `wmatch-edge-development` | allowed | `10001`-`10003` | local/manual only |
| preview | `wmatch-edge-preview` | disabled | `11001`-`11003` | isolated approved preview |
| production | `wmatch-edge-production` | disabled | `12001`-`12003` | protected manual rollout |

Preview and production deliberately declare neither a route nor a custom domain in source. The
owner must attach an already-approved domain after confirming zone ownership. This repository does
not guess account IDs, zones, domains, Supabase projects, or WAF policy.

Configuration is repeated for every Wrangler environment because variables, secrets, Durable
Object-style bindings, and rate-limit bindings are non-inheritable. The release workflows replace
all deploy-time variables explicitly and refuse placeholders.

### Required secrets

| Binding | Purpose | Rotation note |
|---|---|---|
| `ORIGIN_API_KEY` | Supabase API key sent only to the fixed origin | Rotate with the origin project |
| `ORIGIN_ANON_JWT` | Legacy anon bearer needed by the existing function gateway | Keep scoped as anon; never service-role |
| `ORIGIN_HMAC_SECRET` | Authenticates Worker-to-origin requests | Rotate with a new `ORIGIN_HMAC_KEY_ID` and overlap verifier keys |
| `RATE_LIMIT_HASH_SECRET` | Pseudonymizes rate-limit identities | Rotation resets effective counters |

Secrets are provisioned independently per environment with the Cloudflare version-aware secret
command. Workflows verify names only and never accept, echo, or write secret values. Initial Worker
service creation, secret provisioning, and creation of the first known-good production baseline are
manual owner bootstrap steps; release workflows fail closed until they exist.

### Required variables

`ALLOWED_ORIGINS`, `ALLOWED_REDIRECT_ORIGINS`, `CACHE_VERSION`, `JWT_AUDIENCE`, `JWT_ISSUER`,
`JWT_JWKS_URL`, `ORIGIN_BASE_URL`, and `ORIGIN_HMAC_KEY_ID` are supplied through the protected
GitHub environment. Timeouts, size ceilings, HMAC skew, and the fixed environment name are pinned
by the workflows.

## Observability

The structured `wmatch_edge_request` event records environment, immutable Worker version, route ID,
method, status, sanitized result code, duration, JWT outcome, cache outcome, rate-limit outcome,
origin latency, bounded origin request ID, request ID, and validated `cf-ray`. A cache write failure
uses a separate redacted event.

Release review should compare at least request rate, `4xx`/`5xx`, `429`, `503`, origin timeout,
origin latency, cache hit ratio by route, and Worker CPU/duration against the prior version. Alerts,
retention, log destinations, and monetary budgets remain owner-controlled Cloudflare settings.

## Release and rollback model

Preview deployment is manual after tests and uses one immutable version at `100%`. A failed health
smoke restores the captured preview baseline when one exists.

Production is deliberately two-phase:

1. `upload` verifies the package and creates or reuses a version tagged with the full commit SHA; it
   does not change traffic.
2. An owner reviews security and smoke results, then supplies separate HTTPS observability and
   cost/budget evidence links.
3. Separate approved `rollout` runs advance exactly `baseline 100% -> target 5% -> 25% -> 50% ->
   100%`. The target source commit is tested, must be an ancestor of the protected default branch,
   and must match the immutable version tag. Each run proves the current split is the expected prior
   gate before changing traffic.
4. Each gate saves Cloudflare JSON/text evidence and runs `/health`. A failed rollout smoke
   automatically restores the named baseline to `100%`.
5. `rollback` can restore a validated known-good version to `100%` with a recorded reason.

There are no unattended promotion timers and no `wrangler deploy` latest-code shortcut.

## Owner-controlled production prerequisites

GitHub tarafında `cloudflare-preview` ve `cloudflare-production` environment'ları oluşturulmuştur;
`cloudflare-production` reviewer `cayankuzu` ve protected-branch deployment policy kullanır. Gerekli
vars/secrets henüz yüklenmemiştir ve gerçek approval/deploy run'ı yoktur; bu nedenle bu control-plane
hazırlığı production Worker kanıtı değildir.

Production traffic remains **NO-GO** until the checklist in
[`cloudflare-threat-model.md`](cloudflare-threat-model.md) is closed. In particular, the owner must
verify origin HMAC plus replay enforcement, create/attach the approved custom domain, configure
protected GitHub environments and least-privilege API tokens, set WAF/bot/cost controls, approve the
isolated preview project and routes, and record successful functional and observability evidence.

## Cloudflare references

- [Workers environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Workers versions and deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/)
- [Gradual deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/)
- [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
