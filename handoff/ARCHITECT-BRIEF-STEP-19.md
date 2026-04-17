# Architect Brief — Step 19: `/api/v1` Versioning
*Written by Arch. Read by Bob (builder) and Richard (reviewer).*

---

## Goal

Move every route that is **not pinned to an external caller** under a
`/api/v1/` prefix, and introduce a single in-repo HTTP client so future
version bumps (v2, v3) are a one-line constant change instead of a
code-wide rewrite.

This is the foundation for Steps 20, 21, 23, 24, 25 — each of those
assumes a versioned surface. Doing it now, pre-launch, costs one session.
Doing it after Wave 2 (mobile apps) costs a coordinated client release.

---

## Why now

- No external API consumer exists yet. Mobile apps (Wave 2, weeks 10-24)
  will read `/api/v1/*` natively.
- The next five Pile B steps each want a stable contract surface —
  `User.state` enum (22), Zod schemas (20), identifier union (21),
  observability tags (24), queue-emitted events (23). A versioned root
  keeps those additions visibly v1-scoped.
- No rewrites in `next.config.ts` today (it's `{}`), so no conflicts.

---

## Scope — what moves, what doesn't

### Move under `/api/v1/*` (42 routes)

| Area | Count | Examples |
|---|---|---|
| auth | 11 | `/api/v1/auth/login`, `/api/v1/auth/send-code`, `/api/v1/auth/verify-code`, `/api/v1/auth/complete-registration`, `/api/v1/auth/request-password-reset`, `/api/v1/auth/reset-password`, `/api/v1/auth/verify-2fa`, `/api/v1/auth/verify-email`, `/api/v1/auth/resend-verification`, `/api/v1/auth/logout`, `/api/v1/auth/register` (the 410-gone stub — see below) |
| account | 11 | `/api/v1/account/me`, `/api/v1/account/change-password`, `/api/v1/account/change-email`, `/api/v1/account/email/[id]`, `/api/v1/account/phone/{add,verify,remove}`, `/api/v1/account/2fa/{setup,enable,disable,regenerate-backup-codes}` |
| admin | 9 | `/api/v1/admin/stats`, `/api/v1/admin/float`, `/api/v1/admin/rates`, `/api/v1/admin/compliance`, `/api/v1/admin/transfers`, `/api/v1/admin/transfers/[id]`, `/api/v1/admin/transfers/[id]/retry`, `/api/v1/admin/transfers/[id]/refund`, `/api/v1/admin/referrals/[id]/pay` |
| transfers | 3 | `/api/v1/transfers`, `/api/v1/transfers/[id]`, `/api/v1/transfers/[id]/cancel` |
| recipients | 3 | `/api/v1/recipients`, `/api/v1/recipients/[id]`, `/api/v1/recipients/resolve` |
| rates | 2 | `/api/v1/rates/public`, `/api/v1/rates/[corridorId]` |
| kyc | 2 | `/api/v1/kyc/status`, `/api/v1/kyc/initiate` |
| banks | 1 | `/api/v1/banks` |

**Total: 42.**

### Stay on `/api/*` (9 routes — URLs are owned off-platform)

| Area | Routes | Why |
|---|---|---|
| webhooks | `/api/webhooks/{monoova,flutterwave,paystack,sumsub}` | URLs registered on provider dashboards. Moving them requires a provider-side change AND a coordinated cutover. Out of scope. |
| cron | `/api/cron/{rates,float,reconciliation,staleness,reap-pending-emails}` | URLs registered in Railway cron config. Simpler to leave. |

**Rationale.** The `/api/v1` prefix communicates *client-facing* versioning.
Webhook and cron endpoints are machine-to-machine callbacks, not part of
the public client API. Keeping them outside `v1` also means a future v2
bump doesn't accidentally drag provider-registered URLs along.

---

## Decisions Locked

| Question | Decision |
|---|---|
| Move webhooks under `/api/v1`? | **No.** Provider URLs are immutable. |
| Move cron under `/api/v1`? | **No.** Railway cron config is the canonical URL registry; avoid a drift surface. |
| Move admin under `/api/v1`? | **Yes.** Admin is still "the API", just auth-gated. One rule is simpler than two. |
| Redirects from legacy `/api/*` → `/api/v1/*`? | **No.** Pre-launch, zero external consumers of the 42 versioned routes. Atomic move + caller rewrite + test rewrite in one commit. |
| Keep the `/api/auth/register` 410-Gone stub at the legacy path? | **Yes, permanently.** Its job is catching stale clients pointing at the old URL. Moving it under `/api/v1` would lose that signal. The stub stays at `/api/auth/register`. **Nothing else in Pile B touches it.** |
| New shared HTTP client? | **Yes, required, and introduced BEFORE moving routes.** See §Architecture. |
| Any `next.config.ts` rewrites needed? | **No.** |

---

## Architecture

### New module — `src/lib/http/api-client.ts`

Single-source API prefix. Every in-repo caller goes through this.

```ts
// src/lib/http/api-client.ts
export const API_V1 = '/api/v1'

export interface ApiFetchInit extends RequestInit {
  timeoutMs?: number
}

/**
 * Fetch a v1 API endpoint. Path is joined to API_V1; callers pass the
 * tail (e.g. 'auth/login', not '/api/v1/auth/login').
 */
export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response>
```

- Internally uses `fetchWithTimeout` from `src/lib/http/fetch-with-timeout.ts`
  (already exists — just wrap it).
- Leading `/` on `path` is stripped defensively so both `'auth/login'` and
  `'/auth/login'` work.
- Default `timeoutMs` matches `fetchWithTimeout`'s current default; no
  behavior change for wizard callers.

### Updated — `src/lib/hooks/use-wizard-submit.ts`

Replace its inline `fetchWithTimeout(path, …)` with `apiFetch(path, …)` and
change all wizard call sites to pass *relative v1* paths:

```diff
- await fetchWithTimeout('/api/auth/send-code', { ... })
+ await apiFetch('auth/send-code', { ... })
```

### Caller rewrite rule

For every bare `fetch('/api/...')` in `src/app/`, replace with
`apiFetch('...')`. The 18 call sites listed in
`handoff/RESEARCH-PILE-B/step-19-versioning.md` are the complete set.

Exception: webhook and cron callers (n/a — no in-repo code calls them;
they're entered by external requests) and the 410 stub (no callers).

### `fetchAdminJson` in admin pages

Whatever shape it currently has, refactor it to sit on top of `apiFetch`.
One HTTP client, one prefix.

---

## File Moves

Concretely, Bob runs (in order, atomically, one commit):

```
mv src/app/api/auth           src/app/api/v1/auth
mv src/app/api/account        src/app/api/v1/account
mv src/app/api/admin          src/app/api/v1/admin
mv src/app/api/transfers      src/app/api/v1/transfers
mv src/app/api/recipients     src/app/api/v1/recipients
mv src/app/api/rates          src/app/api/v1/rates
mv src/app/api/kyc            src/app/api/v1/kyc
mv src/app/api/banks          src/app/api/v1/banks
```

Then restores the 410 stub at its original path:

```
mkdir -p src/app/api/auth
mv src/app/api/v1/auth/register src/app/api/auth/register
```

Result:
- `src/app/api/v1/*` — 42 moved routes
- `src/app/api/auth/register/route.ts` — 410 stub only
- `src/app/api/webhooks/*` — untouched
- `src/app/api/cron/*` — untouched

### Tests

Move all `tests/app/api/<area>/*` → `tests/app/api/v1/<area>/*` except:
- `tests/app/api/auth/register.*` (if it still exists — matches the 410 stub at legacy path)
- `tests/app/api/webhooks/*`
- `tests/app/api/cron/*`

In-file path strings: global replace `'/api/` → `'/api/v1/` in tests for
the moved routes. Verify via `grep -n "'/api/[^v]" tests/` returns only
webhook, cron, and the register-410 test.

---

## Required Tests (TDD-first)

Write these FIRST, confirm they fail, then implement:

1. **`tests/lib/http/api-client.test.ts`** — 4 cases:
   - `apiFetch('auth/login')` hits `/api/v1/auth/login`
   - `apiFetch('/auth/login')` also hits `/api/v1/auth/login` (leading slash tolerated)
   - `apiFetch(...)` passes through request body, headers, method
   - `apiFetch(..., { timeoutMs: 50 })` aborts on timeout

2. **`tests/e2e/versioning-smoke.test.ts`** — 4 cases against real Next dev server:
   - `POST /api/v1/auth/send-code` → 200 (happy path)
   - `POST /api/auth/send-code` → **404** (legacy path gone)
   - `POST /api/auth/register` → 410 (stub preserved)
   - `POST /api/webhooks/monoova` with bad sig → 401 (webhook still at legacy path)

3. **Every existing route test** — pattern `/api/v1/…` in URLs. Existing
   assertions unchanged.

Existing test count: 698. Expected after Step 19: 698 + 4 (api-client) + 4
(versioning smoke) = **706 passing**. Anything else regressed is a bug.

---

## Verification checklist (Bob, before REVIEW-REQUEST)

- [ ] `npm test -- --run` → 706 passing
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `rm -rf .next && npm run build` → success
- [ ] `grep -rn "'/api/[^v]" src/app tests` returns ONLY: webhook paths, cron paths, `auth/register` 410 stub
- [ ] `grep -rn 'fetch("/api/' src/app tests | grep -v /api/v1` → 0 lines (all callers use apiFetch)
- [ ] Local curl smoke:
  - `curl -i -X POST http://localhost:3000/api/v1/auth/send-code -H 'content-type: application/json' -d '{"email":"a@b.com"}'` → 200
  - `curl -i http://localhost:3000/api/auth/login` → 404
  - `curl -i -X POST http://localhost:3000/api/auth/register` → 410
  - `curl -i http://localhost:3000/api/webhooks/monoova` → 401/405 (still wired)

---

## Deploy Plan (Arch)

- Railway cron config: **no change** (cron URLs are unchanged).
- Provider dashboards (Monoova, Flutterwave, Paystack, Sumsub): **no change**.
- Rollback: single-commit revert restores all 42 paths. No DB migration,
  so rollback is instant.

---

## Non-goals

- `/api/v2` planning (premature — there is no `v1` customer yet).
- OpenAPI / Zod schemas — Step 20 owns that.
- Observability / request IDs on the new client — Step 24 owns that.
- Deleting the `/api/auth/register` 410 stub — keep indefinitely.

---

## Files Bob will touch (expected ~44 files)

- **New** (2): `src/lib/http/api-client.ts`, `tests/lib/http/api-client.test.ts`
- **New** (1): `tests/e2e/versioning-smoke.test.ts`
- **Moved** (42 route files + their directories): see §File Moves
- **Moved** (~35 test files): paired tests under `tests/app/api/v1/...`
- **Modified** (~18 call-site files): dashboard + admin + auth pages, and the wizard hook

Full per-file diff expected in `handoff/REVIEW-REQUEST-STEP-19.md`.
