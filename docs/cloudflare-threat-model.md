# Cloudflare edge threat model

## Scope and assets

This model covers the selective Worker, its configuration and release path, the client-to-Worker
boundary, the Worker-to-Supabase-function boundary, anonymous TMDB cache entries, JWT/JWKS handling,
rate-limit identifiers, and structured telemetry. Supabase database RLS, mobile device compromise,
and provider-side TMDB behavior remain separate controls, though their boundaries are noted here.

Assets to protect include Supabase/TMDB credentials, user access tokens, report and auth payloads,
email/username availability, origin capacity, cache correctness, pseudonymous identifiers, release
integrity, and the availability/cost budget of the Worker and origin.

Assumed attackers include unauthenticated Internet clients, authenticated abusive users, browsers
on malicious origins, callers attempting direct Supabase-function access, cache poisoners, token
forgers, and an actor with a leaked deployment or origin credential.

## Threats, controls, and residual risk

| Threat | Implemented edge controls | Residual risk / owner action |
|---|---|---|
| Unknown-route exposure or SSRF | Exact path/method registry; fixed HTTPS origin; normalized paths/query; no caller-selected host; redirects disabled | Review every future route as a security change; never add a wildcard proxy |
| Direct origin bypass | Versioned HMAC header contract covers exact bytes, canonical path, method, timestamp, nonce, request ID, and pseudonymous client | **Required:** origin verifier, constant-time comparison, skew check, atomic nonce replay store, and enforcement flag must be live before production |
| Replayed signed request | Fresh UUID nonce and short timestamp window on every attempt | Signature alone is insufficient; origin must atomically consume nonces for at least the allowed skew window |
| Forged/stale JWT | Native signature verification; `ES256`/`RS256` only; same-origin HTTPS JWKS; issuer/audience/role/UUID subject and time claims; bounded JWKS; key-use checks | Token revocation may lag until expiry; origin authorization and RLS remain mandatory; alert on JWKS outage and invalid-token spikes |
| JWKS confusion or remote-key injection | Reject `jku`, embedded `jwk`, `x5u`, `crit`, `b64`; reject private/symmetric key material; configured JWKS only; five-minute cache and bounded unknown-key refresh | Key rotation requires controlled overlap and monitoring; a compromised configured issuer remains trusted |
| Cache data leakage | Cache only allowlisted anonymous GETs without Authorization, Cookie, or Range; versioned canonical key; schema-valid `200` JSON only; never `Set-Cookie`; per-route TTL | Cache API is data-center local and purge/propagation is not globally atomic; bump `CACHE_VERSION` during risky schema/content changes |
| Cache poisoning/key ambiguity | Reject duplicate/unknown query fields and encoded/ambiguous paths; normalize language, region, page, IDs, and sort queries; fixed origin | Origin response schema checks are deliberately minimal; provider data quality still requires monitoring |
| Credential/header smuggling | Origin headers are rebuilt; caller API key, cookie, forwarded-IP, and origin-signature headers are not copied; response `Set-Cookie` removed | Validate origin implementation independently; rotate any credential suspected of exposure |
| Oversized/slow/malformed traffic | Content-Length plus streamed body bounds; UTF-8/JSON/schema checks; fixed origin timeout and response limit; redirects disabled | Cloudflare/account quotas and origin saturation still apply; configure WAF/bot/cost alerts |
| Mutation replay or retry | Worker never retries POST; bounded idempotency key is forwarded | Origin must make idempotency semantics atomic where required; clients must not blindly retry reports/reset requests |
| Brute force and scraping | Per-route Cloudflare rate bindings keyed by HMAC user/IP; auth/public/mutation tiers; failure is closed | Binding counters are per Cloudflare location and eventually consistent, not a global exact quota; add owner-approved WAF rules and database-side exact controls |
| CORS abuse | Exact HTTPS origin set; strict preflight method/header list; no wildcard or credentials response | CORS does not stop non-browser clients and is not authorization |
| IP/PII leakage in logs | No URL/query/body/token/cookie/email/raw IP logging; HMAC client pseudonym; bounded request IDs and `cf-ray` | Cloudflare platform logs and downstream origin logs need separate retention/access review |
| Error information disclosure | Stable sanitized envelopes; no stack/config/upstream body leakage; security headers; no-store errors | Operators need protected evidence access because correlation IDs and traffic metadata remain sensitive |
| Rate-limit bypass through identity changes | Authenticated routes key by verified subject; anonymous routes key by Cloudflare client IP; route ID included | VPN/botnets and multi-colo distribution remain possible; database invariants and WAF provide defense in depth |
| Deployment/supply-chain compromise | Locked package; no production runtime dependency; pinned GitHub actions; tests in `workerd`; dry-run compile; protected manual immutable versions; exact staged-state checks | Protect branch and GitHub environments, require reviewers, use least-privilege short-lived/rotated Cloudflare token, review dependency alerts and provenance |
| Unsafe rollout or runaway cost | Upload does not serve; separate required observability and budget evidence URLs; exactly `5 -> 25 -> 50 -> 100`; health rollback; serialized workflow; retained evidence | Owner must define error/latency/cost budgets, review each gate, and stop/rollback when any budget is exceeded |
| Secret rotation outage | Separate environments and key ID; fail-closed placeholders; secret-name preflight | Use overlapping origin verification keys: accept old+new, publish version with new key ID/secret, drain old traffic, then remove old key |

## Security invariants

- No unregistered route reaches the origin.
- No public response is cacheable unless its route explicitly opts in and the request is anonymous.
- No request with a malformed or unverifiable bearer token is treated as anonymous.
- No production request proceeds with placeholder/missing configuration or an unavailable abuse
  binding.
- No raw IP, token, cookie, request body, query value, email, or username is intentionally logged.
- No production workflow command changes traffic during the `upload` operation.
- No rollout can skip a gate: the recorded Cloudflare deployment must equal the expected prior split.
- No Worker HMAC secret is sufficient to secure the origin unless the origin also verifies freshness
  and atomically rejects replay.

## Client transport security and the certificate-pinning decision

The mobile client is the other half of this boundary, so the transport decisions it depends on are
recorded here rather than left implicit.

Enforced today:

- `EXPO_PUBLIC_SUPABASE_*` configuration is schema-validated at startup; a non-`https:` origin, or a
  URL carrying embedded credentials, fails closed before any request is made. Plain `http:` is
  accepted only for an explicitly recognised local development URL.
- The release Android manifest sets `android:usesCleartextTraffic="false"`. The Android project is
  checked into this repository, so that manifest — not `app.json` — owns the flag; Expo's config
  schema has no such field, and `npm run check:native-parity` fails if anyone adds one. Only the
  `debug` and `debugOptimized` variants re-enable cleartext, and they do so through an explicit
  `tools:replace` override so a local Metro bundler keeps working. This is defence in depth: the
  platform default already denies cleartext at the current target SDK, and the explicit flag plus
  the parity guard stop a future config change from silently reopening it.
- iOS relies on App Transport Security defaults. `app.json` declares no `NSAppTransportSecurity`
  exception, and the same parity guard fails the build if `NSAllowsArbitraryLoads` or
  `NSAllowsArbitraryLoadsInWebContent` is ever set to `true`.
- The client never takes a caller-supplied host. Every request resolves through the central
  transport to either the fixed Supabase project origin or the configured `api.*` gateway.

Certificate pinning is **deliberately not implemented**, and this is a decision rather than an
omission:

- Both upstreams are provider-managed. Supabase and Cloudflare rotate leaf certificates, and may
  change issuing intermediates, on their own schedule and without notifying this repository.
- A pin baked into a store binary cannot be corrected by an OTA update, because trust evaluation
  happens below the JavaScript runtime. A rotation the pin does not anticipate would take every
  installed build offline until a new binary cleared review, which is a larger and less recoverable
  availability risk than the man-in-the-middle risk it removes.
- The residual MITM risk is already narrowed by the controls above plus origin-side authorisation:
  a proxy that terminates TLS still cannot mint a valid Supabase JWT, satisfy RLS, or produce a
  fresh, non-replayable Worker origin HMAC.

Revisit this decision only alongside a documented rotation contract from both providers, pin sets
that include backup keys, a remote kill switch for the pin, and a rehearsed recovery path. Until
then, treat certificate pinning as accepted risk with the compensating controls named above.

## Production NO-GO checklist

Production traffic must remain disabled until an owner records evidence for every item:

- [ ] The Supabase function verifies the exact HMAC canonical form, body hash, active key ID,
  timestamp skew, and signature with constant-time comparison.
- [ ] An atomic, expiring nonce store rejects replays, including concurrent duplicates, and failure
  of that store fails closed.
- [ ] Origin-enforcement flags have completed a monitored compatibility phase and require valid
  signatures on every Worker-managed route; direct bypass tests fail.
- [ ] Preview uses an isolated approved Worker/Supabase project and passes functional, security,
  negative-route, cache, load, and rollback smoke tests.
- [ ] The owner has attached the approved custom domain/routes; preview URLs and `workers.dev` are
  not unintentionally serving preview or production.
- [ ] GitHub `cloudflare-preview` and `cloudflare-production` environments have required reviewers,
  branch restrictions, protected variables, and no broad secret visibility.
- [ ] The Cloudflare API token is least-privilege, scoped to the intended account/Worker, rotated,
  and stored only as an environment secret.
- [ ] Exact production origins, redirect origins, Supabase issuer/JWKS/function URL, and smoke URL
  have been independently reviewed; no `REQUIRED__...` placeholder remains.
- [ ] WAF/bot rules, Cloudflare usage notifications, cost/request/CPU budgets, and alerts are enabled
  with owner-approved thresholds. No threshold is invented by this repository.
- [ ] Dashboards expose version-sliced request rate, `429`, `4xx`, `5xx`, origin timeout/latency,
  cache hit ratio, and Worker duration/CPU; on-call can distinguish Worker and origin failures.
- [ ] The known-good baseline version UUID and explicit rollback procedure have been exercised.
- [ ] Each rollout gate has reviewed observability and budget evidence before the next manual run.

If any item regresses, stop promotion and restore the named known-good version to `100%`.
