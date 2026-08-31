# WMatch selective Cloudflare edge

This package is the narrow public edge for the existing WMatch capabilities listed in
[`docs/cloudflare-route-matrix.md`](../../../docs/cloudflare-route-matrix.md). It is not a
general Supabase proxy. Unknown paths fail with `404`, unsupported methods fail with `405`, and
responses are `private, no-store` unless a specific anonymous TMDB route is cache-eligible.

## Local verification

Requires Node.js 22 or later and npm 11.19.0 or later. The package pins npm 11.19.0 so its
version-specific lifecycle-script allowlist is enforced consistently.

```bash
npm ci
npm run types:check
npm run typecheck
npm test
npm run deploy:dry-run
```

Tests run inside the Cloudflare Workers runtime through `@cloudflare/vitest-plugin`. The dry run
compiles a Worker version but does not publish it.

For local requests, copy `.dev.vars.example` to `.dev.vars.development` and replace every
`REQUIRED__...` value. Do not commit `.dev.vars*`; the package `.gitignore` excludes those files.
The non-secret variables in `wrangler.jsonc` are deliberately fail-closed placeholders and must
be supplied by the environment or release workflow.

## Bindings

Versioned secrets, provisioned separately in each environment:

- `ORIGIN_API_KEY`
- `ORIGIN_ANON_JWT`
- `ORIGIN_HMAC_SECRET`
- `RATE_LIMIT_HASH_SECRET`

Non-secret configuration:

- `ALLOWED_ORIGINS`
- `ALLOWED_REDIRECT_ORIGINS`
- `CACHE_VERSION`
- `ENVIRONMENT`
- `JWT_AUDIENCE`
- `JWT_ISSUER`
- `JWT_JWKS_URL`
- `ORIGIN_BASE_URL`
- `ORIGIN_HMAC_KEY_ID`
- `ORIGIN_HMAC_MAX_SKEW_SECONDS`
- `ORIGIN_MAX_RESPONSE_BYTES`
- `ORIGIN_TIMEOUT_MS`

`PUBLIC_RATE_LIMITER`, `AUTH_RATE_LIMITER`, and `MUTATION_RATE_LIMITER` are configured with
different namespace IDs in development, preview, and production. Environment bindings are
repeated intentionally because Wrangler does not inherit these bindings into named environments.

## Releases

- `cloudflare-preview.yml` verifies every relevant pull request and can deploy the selected commit
  to the isolated preview Worker after environment approval.
- `cloudflare-production.yml` is manual and protected. `upload` creates or reuses an immutable
  version without serving it. `rollout` permits only `5% -> 25% -> 50% -> 100%`, verifies the
  current traffic split first, and requires reviewed observability and budget evidence. `rollback`
  restores a specified known-good version to `100%`.
- Neither workflow creates a zone, custom domain, route, WAF rule, account, or project. Those are
  owner-controlled actions.

An owner must bootstrap each Worker service and its four versioned secret bindings before either
deployment job can pass its secret-name preflight. Production additionally requires a recorded,
currently deployed known-good baseline. This first-time account operation is intentionally not
automated by the repository.

Do not send production traffic until every production `NO-GO` item in
[`docs/cloudflare-threat-model.md`](../../../docs/cloudflare-threat-model.md) is closed, especially
origin HMAC verification and replay protection.

## Design references

- [`docs/cloudflare-architecture.md`](../../../docs/cloudflare-architecture.md)
- [`docs/cloudflare-route-matrix.md`](../../../docs/cloudflare-route-matrix.md)
- [`docs/cloudflare-threat-model.md`](../../../docs/cloudflare-threat-model.md)
- [`docs/cache-and-rate-limit-policy.md`](../../../docs/cache-and-rate-limit-policy.md)
