# WMatch deterministic validation containers

This directory is test and CI infrastructure only. It does not package the React Native app, an emulator, EAS Build, signing material, hosted Supabase, or the production Cloudflare Worker.

## Prerequisites

- Docker Engine/Desktop with Compose v2
- Node.js 22 and npm 11 on the host
- At least 6 GB of free memory for the isolated Supabase validation stack

No production credentials or data are accepted. The runners create a SHA-scoped Supabase worktree under the operating-system temp directory, allocate free local ports, and use synthetic fixtures. Local full-profile runs for the same SHA are serialized with an ownership lock; CI may add `WMATCH_DOCKER_RUN_ID` so reruns use disjoint Compose and Supabase resource names.

## Commands

| Command | Purpose |
|---|---|
| `npm run docker:config` | Validate every Compose profile without starting services. |
| `npm run docker:up:test` | Start only the deterministic TMDB, push, and Mailpit dependencies and wait for health. |
| `npm run docker:test` | Replay migrations twice, run pgTAP/RLS twice, DB lint/advisors/exposure, nonce concurrency, dump/restore, schema drift, mocks, mail, Edge and Worker contracts. |
| `npm run docker:resilience` | Exercise Toxiproxy faults for Supabase, TMDB, and push. Set `WMATCH_DOCKER_FULL_SUPABASE=true` to cover Auth/Storage/Realtime HTTP endpoints; CI uses this mode. |
| `npm run docker:load` | Run a bounded k6 infrastructure smoke against deterministic provider mocks. This is not application performance evidence. |
| `npm run docker:down` | Stop only the SHA-scoped WMatch Compose project; test volumes are retained. |
| `npm run docker:clean -- --confirm` | Remove only the current SHA/run-scoped WMatch Compose and Supabase test resources plus `tmp/docker-evidence`. Explicit confirmation is mandatory. |

Each run is fail-closed, waits for health checks, shuts down its own resources, checks exact ownership labels for orphan Compose/Supabase containers, networks, and volumes, removes its isolated temporary worktree, and only then writes a JSON evidence record under `tmp/docker-evidence`. CI adds image scan, SBOM, provenance, and SHA-256 checksums before uploading the same-SHA artifact.

## Profiles and trust boundary

- `test`: hardened Node tooling, TMDB/push mocks, and Mailpit. The canonical Supabase CLI stack remains host-managed so no Docker socket is mounted into a container.
- `mail`: Mailpit only, for the existing moderation/auth SMTP contract.
- `resilience`: test dependencies plus Toxiproxy. No provider secret crosses the boundary.
- `load`: k6 and deterministic mocks with fixed thresholds and bounded duration.

All long-running services use an internal network, immutable image digests, read-only filesystems, dropped capabilities, `no-new-privileges`, non-root users, PID/CPU/memory limits, health checks, and temporary writable mounts only. Do not add a service unless it exercises an existing WMatch contract.

## Troubleshooting

If a run is interrupted, first run `npm run docker:down`. Use the confirmed clean command only for WMatch-owned test artifacts. The scripts derive their Compose project name from the current commit and never stop or remove unrelated Docker projects.
