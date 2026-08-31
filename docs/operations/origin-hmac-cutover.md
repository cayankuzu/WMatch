# Cloudflare origin HMAC cutover

The Cloudflare Worker signs selected origin requests with the `wmatch-origin-v1`
contract. Supabase Edge verifies every signed request even while direct-origin
compatibility remains enabled. A valid signature is followed by an atomic nonce claim
in `edge_origin_hmac_nonces`, preventing replay across Edge isolates.

Keep `REQUIRE_CLOUDFLARE_ORIGIN_HMAC=false` during the measured old-binary cutover.
When false, an unsigned selected request is accepted, but a partially signed or invalid
request is rejected. Set the flag to `true` only after direct-origin traffic for the
selected routes has reached the approved threshold.

The selected routes are health, availability, password reset, reports, and TMDB proxy
routes. The signed canonical path includes `/functions/v1` and the Worker-normalized,
sorted query string.

## Rotation

1. Configure the Edge Function with the current `ORIGIN_HMAC_KEY_ID` and
   `ORIGIN_HMAC_SECRET`.
2. During rotation, move the old pair to `ORIGIN_HMAC_PREVIOUS_KEY_ID` and
   `ORIGIN_HMAC_PREVIOUS_SECRET`, then deploy the new active pair to the Worker.
3. After at least the maximum retry/skew window and successful telemetry verification,
   remove the previous pair.

`ORIGIN_HMAC_MAX_SKEW_SECONDS` defaults to 60 and must remain between 30 and 300.
Secrets must contain at least 32 bytes of entropy. Never log signatures, secrets, raw
client IPs, authorization headers, or request bodies.

## Fail-closed checks

Before enabling the required flag, confirm:

- the Worker and Edge active key IDs match;
- both sides use the exact nine-line canonical contract;
- signed health and report requests succeed;
- tampered body/path/query, stale/future timestamp, unknown key, and repeated nonce are
  rejected;
- the nonce table cleanup index and service-only RPC are present;
- direct-origin rollback requires an explicit flag change and incident record.
