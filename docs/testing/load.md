# Staging load and endurance tests

`tests/load/critical-read-paths.js` is a read-only k6 gate for health, Live Now,
compatibility discovery, matches and chat directory. It includes a short smoke
profile and the required first 1,000-concurrent-VU ramp. The test refuses to start
unless `LOAD_TARGET_ACK=staging-only`; production load runs are forbidden.

Inputs: `SUPABASE_URL`, legacy `SUPABASE_ANON_JWT`, `LOAD_TOKENS_FILE` containing a
JSON array of confirmed staging access tokens, and `LOAD_PROFILE=smoke|1k`. The 1k
profile requires at least 100 fixture identities to avoid measuring one account's
cache/rate behavior as if it represented a population.

Example (PowerShell):

```powershell
$env:LOAD_TARGET_ACK='staging-only'
$env:LOAD_PROFILE='smoke'
$env:SUPABASE_URL='https://staging-project.supabase.co'
$env:SUPABASE_ANON_JWT='<legacy-anon-jwt>'
$env:LOAD_TOKENS_FILE='staging-user-tokens.json'
k6 run tests/load/critical-read-paths.js --summary-export tests/load/smoke.summary.json
```

Only advance from smoke to 1k after the smoke thresholds pass. Retain the k6 JSON,
Edge/Postgres resource graphs, database slow-query sample, cache hit/miss sample and
realtime connection graph. Run separate 30-minute chat/realtime soak and profile
photo/storage download test because the read-path script does not prove WebSocket
fan-out or CDN/storage behavior. No staging credentials or reports containing tokens
belong in git.
