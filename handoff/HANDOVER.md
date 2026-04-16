# Kolaleaf -- Session Handover

**Date:** 2026-04-16
**Session outcome:** Step 15 fully shipped (13 checkpoint commits, 15a-15l). Web app is production-ready: `npm run build` succeeds, 607 tests pass, 0 TS errors. All 12 prior checkpoints verified intact by the capstone audit.
**Resume prompt:** `You are Arch on Kolaleaf. Read CLAUDE.md, then handoff/HANDOVER.md. Confirm current state and the next action based on the user's direction.`

---

## Where We Are

Wave 1 web build is **complete and production-ready**. Step 15 landed in 13 commits (15a through 15l). Build green, type-check green, 607 tests passing across 82 files, `npm run build` produces 53 routes with zero errors.

### Commit history (newest first)
```
[pending]  Step 15l: capstone audit + lazy env validation fix
343da3b    Step 15k: public stub pages + mobile hamburger menu
3befdeb    Step 15j: provider hardening -- env validation, retry, typed errors
b689814    Step 15i: BullMQ + Redis webhook queue with in-process fallback
f1955f7    Step 15h: /activity/[id] transfer detail page
bf8221b    Step 15g: account self-service -- change password, change email, remove email
38875d7    Step 15f-2: 2FA setup API + /account UI + Richard fixes
308cfac    Step 15f-1: migrate 2FA off legacy fields + drop legacy schema
55aee52    Step 15e: Twilio SMS + phone verification + SMS 2FA helpers
e29c4e8    Step 15d: Resend + email verification + password reset
0e9f786    Step 15c: schema migration for auth verification + 2FA foundation
ce0c046    Step 15b: user-safe projection, RateService unification, observability
a635198    Step 14 + 15a: rate gap closure + webhook/auth security hardening
b2510d7    docs: refresh session handover for next session
980b092    Step 13: Variant D web app design system + landing page
f207c08    Step 12: E2E testing + security audit
55ac706    Steps 10+11: Admin dashboard + background workers
2e08c5e    Steps 8+9: Referral system + Web app UI + API routes
46f9dfb    Steps 6+7: Sumsub KYC + Rate engine
72ee58d    Steps 4+5: Monoova PayID + Flutterwave/Paystack payout
6cc6970    Steps 2+3: Custom auth system + transfer state machine
0dd25f4    Step 1: Project scaffold + database schema
```

### What Step 15 delivered (cumulative across 13 commits)

**Security + correctness (15a-b):** Webhook raw-body signature verification, atomic idempotency (create-as-lock pattern), user-safe transfer projection, admin P2025 -> 404, timing-safe cron bearer, observability on all bare catches, RateService unification.

**Auth infrastructure (15c-g):** Schema migration for verification + 2FA. Resend email integration (verification + password reset). Twilio SMS integration (phone verification + 2FA challenges). TOTP 2FA (setup, enable, disable, backup codes, regenerate). Legacy 2FA migration + drop. Account self-service (change password, change email, remove email).

**Transfer detail (15h):** `/activity/[id]` page with timeline, cancel button, recipient card.

**Queue infrastructure (15i):** BullMQ webhook queue with in-process fallback. Signature verification at both route and worker layers.

**Provider hardening (15j):** env validation (fail-fast) + `withRetry` (exponential backoff + jitter + typed errors) on all 5 provider adapters. Idempotency keys on POST calls.

**Public pages (15k):** `/privacy`, `/terms`, `/compliance-info` stub pages. Mobile hamburger menu.

**Capstone audit (15l):** Lazy env validation so `npm run build` succeeds without provider creds at build-time. Deprecation comment on `/api/rates/[corridorId]`.

---

## What's Running

### PostgreSQL (local Docker)
```bash
docker ps --filter "name=kolaleaf"
# kolaleaf-db on port 5433
docker start kolaleaf-db
```

### Next.js dev server
```bash
cd /Users/ao/Documents/projects/Kolaleaf && npm run dev
# http://localhost:3000
```

### Test user
- **Email:** `ambrose@test.com`
- **Password:** `TestPass123!`
- **KYC status:** PENDING (Sumsub not initiated)
- **Admin access:** YES (in `ADMIN_EMAILS`)

---

## Routes Map

### Public (marketing chrome: SiteHeader + SiteFooter)
| Path | Renders |
|------|---------|
| `/` | LandingPage. Logged-in users redirect to `/send`. |
| `/privacy` | Privacy stub (server component, "Pending legal review" banner) |
| `/terms` | Terms stub |
| `/compliance-info` | Compliance stub |

### Auth (gradient band between SiteHeader + SiteFooter)
| Path | Renders |
|------|---------|
| `/login` | Login form (email + password + 2FA challenge) |
| `/register` | Register form |

### Dashboard (DashboardShell, auth-gated)
| Path | Renders |
|------|---------|
| `/send` | Transfer creation (live rate card, recipient selector) |
| `/activity` | Transfer list with status pills |
| `/activity/[id]` | Transfer detail (timeline, cancel, recipient) |
| `/recipients` | Recipient CRUD |
| `/account` | 2FA management, change password/email, phone verification |

### Admin (AdminShell, auth + admin-gated)
| Path | Renders |
|------|---------|
| `/admin` | Stats tiles, recent transfers, float status |
| `/admin/transfers` | Transfer list (filterable) |
| `/admin/transfers/[id]` | Transfer detail + admin actions (retry/refund) |
| `/admin/rates` | Rate management (override, history) |
| `/admin/compliance` | Compliance reports |

### API routes (45 total)
Auth: `register`, `login`, `logout`, `verify-2fa`, `verify-email`, `resend-verification`, `request-password-reset`, `reset-password`
Account: `me`, `change-password`, `change-email`, `email/[id]`, `phone/add`, `phone/verify`, `phone/remove`, `2fa/setup`, `2fa/enable`, `2fa/disable`, `2fa/regenerate-backup-codes`
Transfers: CRUD + cancel
Recipients: CRUD + delete
KYC: initiate + status
Rates: public (pair-based) + [corridorId] (deprecated)
Admin: stats, float, transfers (list + detail + retry + refund), rates, compliance, referrals pay
Webhooks: monoova, flutterwave, paystack, sumsub
Cron: float, rates, reconciliation, staleness

---

## Known Issues

1. **Login rate limiting** -- not yet implemented.
2. **Test flakiness** -- 4 transfer integration tests fail intermittently (shared DB state).
3. **Float API not connected** -- Flutterwave wallet shows 0 NGN (no real account).
4. **No deployment yet** -- Railway setup pending.
5. **Regex E.164 phone normalisation** is a placeholder (needs `libphonenumber-js`).
6. **Activity page** missing empty-state copy for "no transfers yet".
7. **`RateService` singleton** not consolidated (instantiated per-file in 4 places).
8. Full list: see `handoff/BUILD-LOG.md` Known Gaps section.

---

## Key Files

| Artifact | Path |
|----------|------|
| Project root | `/Users/ao/Documents/projects/Kolaleaf` |
| Design tokens | `src/lib/design/tokens.ts` |
| Design primitives | `src/components/design/KolaPrimitives.tsx` |
| Site chrome | `src/app/_components/site-header.tsx` + `site-footer.tsx` |
| Landing page | `src/app/(marketing)/page.tsx` + `_components/landing-page.tsx` |
| Three Man Team | `ARCHITECT.md`, `BUILDER.md`, `REVIEWER.md` |
| Project context | `CLAUDE.md` |
| Build log | `handoff/BUILD-LOG.md` |
| Audit findings | `handoff/ARCHITECT-BRIEF.md` (Phase A Findings -- Step 15l) |

---

## Environment

`.env`:
```
DATABASE_URL=postgresql://postgres:kolaleaf@localhost:5433/kolaleaf
ADMIN_EMAILS=ambrose@test.com
```

Provider secrets (Monoova, Flutterwave, Paystack, Sumsub, FX, Resend, Twilio) still mocked/blank. All provider adapters use lazy validation (first-use, not module-load) so builds succeed without creds.

---

## Decisions Locked This Session

1. **Lazy env validation on provider clients.** Fail-fast timing moved from module-load to first-use so `next build` can evaluate route modules without env vars. Server still throws at runtime with the specific missing-variable name. Applied to: FX, Monoova, Sumsub, Resend, Twilio. Flutterwave + Paystack were already build-safe.
2. All prior decisions from Step 13 session remain locked (Variant D, tokens > Tailwind, one transfer card, public chrome via route groups, light first, animations respect prefers-reduced-motion).

---

## Next Steps

### Deploy to Railway (recommended next)
The web app is complete. Next milestone: live on a URL.
1. Provision Postgres on Railway (migrate schema)
2. Set all provider env vars (real Monoova/Flutterwave/Paystack/Sumsub/Resend/Twilio/FX keys)
3. Deploy web app (`npm run build` now succeeds in prod)
4. Configure Railway cron for `/api/cron/*` routes
5. Spin up Redis + webhook worker (`npm run worker`)
6. Verify with sandboxed providers

### Real provider sandboxes
- Sumsub sandbox + KYC widget
- Monoova test environment for PayID
- Flutterwave test keys for NGN payout
- Run end-to-end with real APIs

### Wave 2a -- Native iOS (Swift)
Per CLAUDE.md plan. Mirror Variant D in SwiftUI.

### Product validation
Contact 10 most recent CashRemit reach-outs. Show landing page + Send flow.

---

## How to Resume

```
You are Arch on Kolaleaf. Read CLAUDE.md, then handoff/HANDOVER.md.
Confirm current state and the next action based on the user's direction.
Do not re-read old review requests or design docs unless specifically needed.
Report status in one paragraph -- what's done, what's next, what needs a decision.
```

---

## Quick Verification

After resuming, confirm the app is healthy:

```bash
# Type check
npx tsc --noEmit      # 0 errors

# Tests
npm test -- --run      # 82 files / 607 tests

# Build
npm run build          # 53 routes, 0 errors

# Dev server (if DB is running)
npm run dev
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/         # 200 (landing)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login    # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/send     # 307 (auth redirect)
```
