# Cloudflare route matrix

This is the complete public Worker registry. Any path not listed here returns `404`; any method not
listed for a matched path returns `405`. Paths are case-sensitive, cannot contain percent escapes,
backslashes, or repeated slashes, and cannot exceed 512 characters. Exact routes accept no query
parameters unless the table says otherwise.

| Public path | Method | Edge auth | Rate-limit binding | Max request body | Edge cache | Destination |
|---|---|---|---|---:|---|---|
| `/health` | GET | none | public: 120/min | none | no-store | origin `/health` |
| `/auth/check-availability` | POST | none | auth: 10/min | 4 KiB | no-store | origin, signed |
| `/auth/password-reset` | POST | none | auth: 10/min | 4 KiB | no-store | origin, signed |
| `/auth/signup` | POST | none | auth: 10/min | 32 KiB | no-store | local `410` compatibility tombstone; never origin |
| `/reports` | POST | required | mutation: 20/min | 32 KiB | no-store | origin, signed |
| `/tmdb/media-batch` | POST | optional | public: 120/min | 8 KiB | no-store | origin, signed |
| `/tmdb/trending/all/week` | GET | optional | public: 120/min | none | 120 s when anonymous | origin, signed |
| `/tmdb/movie/popular` | GET | optional | public: 120/min | none | 300 s when anonymous | origin, signed |
| `/tmdb/tv/popular` | GET | optional | public: 120/min | none | 300 s when anonymous | origin, signed |
| `/tmdb/search/multi` | GET | optional | public: 120/min | none | no-store | origin, signed |
| `/tmdb/search/movie` | GET | optional | public: 120/min | none | no-store | origin, signed |
| `/tmdb/search/tv` | GET | optional | public: 120/min | none | no-store | origin, signed |
| `/tmdb/movie/:id` | GET | optional | public: 120/min | none | 900 s when anonymous | origin, signed |
| `/tmdb/tv/:id` | GET | optional | public: 120/min | none | 900 s when anonymous | origin, signed |
| `/tmdb/movie/:id/translations` | GET | optional | public: 120/min | none | 3,600 s when anonymous | origin, signed |
| `/tmdb/tv/:id/translations` | GET | optional | public: 120/min | none | 3,600 s when anonymous | origin, signed |

`:id` is a base-10 integer from 1 through 2,147,483,647 with no sign or leading zero. Optional auth
means anonymous requests are allowed, but a supplied `Authorization` header must be one valid
`Bearer` token. An invalid token is rejected rather than ignored. Authenticated TMDB responses are
never cached.

## Query contracts

| Route family | Allowed query keys | Required | Normalization and bounds |
|---|---|---|---|
| trending/popular | `language`, `page`, `region` | none | language `aa-BB`; region two letters; page 1-500 |
| search | `language`, `page`, `query`, `region` | `query` | query trimmed/NFC, 1-80 chars; other bounds as above |
| movie/TV detail | `language`, `region` | none | language and region as above |
| translations | none | none | any query rejected |

Duplicate and unknown query keys are rejected. Language is canonicalized to lowercase language and
uppercase region, region is uppercased, page is canonicalized as an integer string, and all keys are
sorted before origin signing and cache-key construction.

## JSON body contracts

- `/auth/check-availability` accepts only `email`, `username`, and optional UUID
  `currentUserId`; at least email or username is required.
- `/auth/password-reset` accepts only `email` and `redirectTo`. The redirect must be a clean URL
  whose exact origin is in `ALLOWED_REDIRECT_ORIGINS`.
- `/tmdb/media-batch` accepts only `refs`, containing 1-16 unique `{id, mediaType}` objects;
  `mediaType` is `movie` or `tv`.
- `/reports` accepts the existing report contract only. It requires a bounded `reasonCode`, at least
  ten non-whitespace detail characters, and a UUID target for profile reports. Context JSON is
  depth-, node-, collection-, key-, and string-bounded.
- `/auth/signup` parses only bounded JSON and always returns `410`. Signup continues through the
  existing direct Supabase Auth email-verification flow.

POST requests require UTF-8 `application/json`. Declared and streamed sizes are both enforced;
unknown fields and malformed JSON are rejected before reaching the origin.

## Headers and response behavior

Allowed CORS request headers are `authorization`, `content-type`, `idempotency-key`, `x-request-id`,
and `x-wmatch-install-id`. An idempotency key, when present, must be 8-128 characters from the
Worker's conservative allowlist. The Worker never trusts caller-supplied Supabase API keys, origin
signatures, forwarding headers, or client-IP headers; it constructs the origin request itself.

All responses receive a request ID, immutable Worker version, `nosniff`, no-referrer, restrictive
content/permissions policies, and no `Set-Cookie`. Default cache policy is `private, no-store`.
Errors use a stable JSON envelope with a safe code/message and request ID.

## Deliberately direct or server-only traffic

The following are outside the public Worker and must not be mapped to a wildcard edge route:

- Existing Supabase Auth signup, email confirmation, session refresh, sign-in, and sign-out remain
  direct SDK flows. Only the listed password-reset helper and availability check use this Worker.
- Supabase Database/RPC, Realtime, and Storage SDK traffic remains direct and continues to rely on
  its existing RLS/storage policy controls.
- `/notifications/push-outbox/drain` is server-to-server only. The Worker registry rejects it.
- Account deletion and every other unlisted function route remain outside this Worker until an
  explicit security review and route-registry change.

## Client integration rules

Use a dedicated edge-origin resolver for only the paths in this document. Do not replace the
Supabase URL or funnel all application traffic through one base URL. Public cacheable TMDB reads
should omit `Authorization`, `Cookie`, and `Range`; any of those headers forces a cache bypass.
`/reports` must send the user's access token. Preserve request IDs for support correlation, apply
normal client timeouts, and do not client-retry non-idempotent mutations.
