# Production observability contract

## Emitted signals

- Mobile Sentry events are initialized with `environment`, native application
  `release` and native build `dist`; default PII is disabled and custom context is
  recursively redacted.
- `api.request` records normalized route, method, outcome, status, duration and the
  600 ms client budget. Startup, useful-content, warm-resume and tab-commit budgets
  are recorded with `budgetExceeded`.
- Edge logs are one JSON object per request with request id, normalized route,
  method, status, duration and a truncated actor reference. Secrets and payloads
  are not logged.
- Push delivery has a service-only health read model and a five-minute scheduler
  alarm described in `push-outbox.md`.

## Release SLOs and alarms

| Signal | Objective | Window | Alarm condition |
| --- | ---: | ---: | --- |
| Critical API availability | >= 99.9% non-5xx | rolling 28 days | 5-minute burn > 14.4x or 1-hour burn > 6x |
| Critical API latency | p95 <= 600 ms | rolling 1 hour | two consecutive 10-minute windows over budget |
| Crash-free mobile sessions | >= 99.5% | rolling 7 days, per release/dist | below objective after at least 100 sessions |
| Cold useful content | p95 <= 1,800 ms | rolling 1 hour | two consecutive 10-minute windows over budget |
| Push delivery | zero dead, provider-receipt failures or >10-minute stalled jobs | every scheduler run | scheduled workflow fails immediately |

Critical API routes are auth, profile, watch/discovery, compatibility, like/match,
block/report, chat/message and account deletion. TMDB upstream failures are tracked
separately so they do not hide first-party availability.

Before production GO, the release owner must create the Sentry/Supabase dashboards,
route alerts to the on-call destination and attach links/screenshots plus one test
alert to the release evidence. Repository instrumentation and thresholds alone do
not prove that external alert delivery is active.
