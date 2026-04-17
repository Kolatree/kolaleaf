# Step 24 — Observability — research

## Current logging
- library: none — raw `console.*` only (no pino, winston, bunyan)
- console.* count in src/: 72 calls across non-generated TypeScript files
- Pattern: tagged plain-text strings e.g. `[webhooks/monoova] dispatch failed`, `[FLOAT ALERT] ...`, `[STALENESS ALERT] ...`

## Request ID handling
- present: no
- location: n/a — no `x-request-id`, `requestId`, or correlation-ID middleware found anywhere

## Health/metrics routes
- `/api/health` — directory exists but route file is empty (no `route.ts`)
- `/api/cron/float` — POST, returns balance/threshold/sufficient/pausedCount/resumedCount as JSON
- `/api/cron/staleness` — POST, returns alerts[]/blocked[] as JSON
- `/api/cron/reconciliation` — POST, returns reconciliation report as JSON
- No `/metrics` (Prometheus-style) route exists

## APM / OTel
- installed: none — package.json has no OTel, Sentry, Datadog, New Relic, or any APM package

## Log format on Railway
- plain text (not JSON)
- example shape from webhook handler: `[webhooks/monoova] dispatch failed <Error object>`
- example from float alert: `[FLOAT ALERT] Balance 450000 NGN below threshold 500000 NGN. Paused 3 transfers.`
- no timestamp, level, or traceId fields — Railway wraps with its own timestamp only

## Existing timing/metrics code
- none — no `performance.now()`, `Date.now()` diffs, histogram increments, or latency tracking found anywhere

## Alerting destinations (float low, rate stale)
- Float low: `src/lib/workers/float-alert.ts` → `console.log` only; no email/Slack/webhook out
- Rate stale: `src/lib/workers/staleness-alert.ts` → `console.log` + writes a `compliance_report` DB row (type: `SUSPICIOUS`); comment says "placeholder for email/push notification"
- Reconciliation: `src/lib/workers/reconciliation.ts` → unknown (not read), cron route returns JSON report but no visible external alert path confirmed

## Open questions for Arch
- Stand up self-hosted Prometheus on Railway, or push to a SaaS (Grafana Cloud free tier, Axiom, Betterstack)?
- Pino vs structured `console.log(JSON.stringify(...))` — pino is zero-dep overhead but adds a package; worth it?
- Float/staleness alerts are currently fire-and-forget DB rows. Should step 24 wire up a real alert channel (email via Resend, which is already installed) or is that a separate step?
- The `/api/health` directory exists with no route file — intentional stub or was it accidentally skipped?
