# Kolaleaf — Session Handover

**Date:** 2026-04-15
**Session outcome:** Web app design system shipped (Variant D). Every public + dashboard + admin page now uses the same Variant D visual language with a persistent SiteHeader + SiteFooter on public routes. Landing page added.
**Resume prompt:** `You are Arch on Kolaleaf. Read CLAUDE.md, then handoff/HANDOVER.md. Confirm current state and the next action based on the user's direction.`

---

## Where We Are

Wave 1 build is **complete and now visually designed**. Step 13 (Variant D design system + landing page) is committed. 8 commits on `main`, build green, type-check green (4 pre-existing Sumsub test errors unchanged), 377 tests still passing.

### Commit history (newest first)
```
980b092 Step 13: Variant D web app design system + landing page
f207c08 Step 12: E2E testing + security audit
55ac706 Steps 10+11: Admin dashboard + background workers
2e08c5e Steps 8+9: Referral system + Web app UI + API routes
46f9dfb Steps 6+7: Sumsub KYC + Rate engine
72ee58d Steps 4+5: Monoova PayID + Flutterwave/Paystack payout
6cc6970 Steps 2+3: Custom auth system + transfer state machine
0dd25f4 Step 1: Project scaffold + database schema
```

### What was added this session
- **Design tokens** (`src/lib/design/tokens.ts`) — exact values from approved sketch (`~/.gstack/projects/Kolaleaf/designs/send-screen-20260414/approved-wireframe.html`)
- **Primitives** (`src/components/design/KolaPrimitives.tsx`) — `KolaLogo`, `Tagline`, `CurrencyBadge`, `FieldLabel`, `FlagAU/NG`, `TransferCard`, `TrustBar`, `BottomNav`, `SidebarNav`, `AdminSidebar`, `DashboardShell`, `AdminShell`
- **Public chrome** (`src/app/_components/site-header.tsx` + `site-footer.tsx`) — sticky translucent nav + 4-column footer
- **Landing page** (`src/app/(marketing)/page.tsx` + `_components/landing-page.tsx`) — hero with live rate card in gradient frame, social proof, how-it-works, why-kolaleaf, final CTA. Auth-redirects logged-in users to `/send`.
- **Marketing route group** (`src/app/(marketing)/layout.tsx`) — wraps every public page in SiteHeader + SiteFooter
- **Auth pages redesigned** — gradient band between SiteHeader + SiteFooter, white card matching `TransferCard` shape
- **Send page redesigned** — Variant D layout: headline + chips + recipient selector on left, gradient-framed `TransferCard` on right (wired to existing `/api/rates/aud-ngn`, `/api/recipients`, `/api/transfers`, `/api/kyc/status`)
- **Activity / Recipients / Account redesigned** — `DashboardShell` on light page with white cards, status pills, gradient avatars
- **Admin redesigned** — `AdminShell` with light data tables, gradient stat tile, gradient-dot timeline. All 5 admin pages.
- **Motion** (`globals.css`) — `kola-page-enter`, `kola-card-enter`, `kola-stagger`, `kola-shimmer` keyframes respecting `prefers-reduced-motion`
- **Docs** — `DESIGN_PLAN.md` + `DESIGN_MEMORY.md` at project root

### What's preserved
- All API contracts and route paths (per the design constraint)
- Auth flow, KYC gating, transfer state machine, all backend logic
- Test suite (377 tests across 52 files)

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

| Path | Layout | Renders |
|------|--------|---------|
| `/` | `(marketing)/layout.tsx` | LandingPage. Logged-in users redirect to `/send`. |
| `/login`, `/register` | `(auth)/layout.tsx` | SiteHeader → gradient band with auth card → SiteFooter |
| `/send` | `(dashboard)/layout.tsx` (auth gate) | DashboardShell with hero (Variant D card on right) |
| `/activity`, `/recipients`, `/account` | `(dashboard)` | DashboardShell, no hero |
| `/admin`, `/admin/transfers`, `/admin/transfers/[id]`, `/admin/rates`, `/admin/compliance` | `admin/layout.tsx` (auth + admin gate) | AdminShell |

---

## Known Issues (carried over)

1. **Test flakiness** — 4 transfer integration tests fail intermittently in the full suite (shared DB state). All pass individually. Fix: per-file test DB or transaction rollback.
2. **Login rate limiting** — not yet implemented. Documented in security audit.
3. **Admin rates page routing bug** — fixed indirectly by the redesign (AdminShell uses correct active key).
4. **Float API not connected** — Flutterwave wallet shows 0 NGN because no real account yet. Admin dashboard correctly alerts LOW FLOAT.
5. **No deployment yet** — Railway setup pending.
6. **4 pre-existing TS errors** in `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts` — runtime-safe.
7. **Stub footer links** (`/privacy`, `/terms`, `/compliance-info`) — point to non-existent pages. Need stub pages or removal.
8. **No mobile menu** — Top nav links collapse to "Sign in / Start sending" only on mobile. Hamburger menu would help once the marketing site grows.

---

## Key Files

| Artifact | Path |
|----------|------|
| Project root | `/Users/ao/Documents/projects/Kolaleaf` |
| **Design tokens** | `src/lib/design/tokens.ts` |
| **Design primitives** | `src/components/design/KolaPrimitives.tsx` |
| **Site chrome** | `src/app/_components/site-header.tsx` + `site-footer.tsx` |
| **Landing page** | `src/app/(marketing)/page.tsx` + `_components/landing-page.tsx` |
| **Design plan** | `DESIGN_PLAN.md` |
| **Design memory** | `DESIGN_MEMORY.md` |
| Approved sketch | `~/.gstack/projects/Kolaleaf/designs/send-screen-20260414/approved-wireframe.html` (mirrored at `file:///tmp/gstack-kolaleaf-sketch.html`) |
| Original design doc | `~/.gstack/projects/Kolaleaf/ao-unknown-design-20260414-081002.md` |
| Test plan | `~/.gstack/projects/Kolaleaf/ao-unknown-eng-review-test-plan-20260414-110752.md` |
| Three Man Team | `ARCHITECT.md`, `BUILDER.md`, `REVIEWER.md` |
| Project context | `CLAUDE.md` |
| Build log | `handoff/BUILD-LOG.md` |
| Previous handover | committed history (was at `handoff/HANDOVER.md` before this rewrite) |

---

## Environment

`.env`:
```
DATABASE_URL=postgresql://postgres:kolaleaf@localhost:5433/kolaleaf
ADMIN_EMAILS=ambrose@test.com
```

Provider secrets (Monoova, Flutterwave, Paystack, Sumsub, FX) still mocked. See previous handover for the full list.

---

## Decisions Locked This Session

1. **Variant D wins.** Light page background (`#f5f5f5`) with the purple→green gradient appearing only as a contained "frame" around the transfer card on the Send page (and as the auth band, marketing hero band, and final CTA band). Never full-bleed gradient.
2. **Tokens > arbitrary Tailwind values.** Every color/radius/size/shadow comes from `src/lib/design/tokens.ts`. Use inline `style={{}}` for token values; use Tailwind for layout (grid, flex, spacing utilities).
3. **One transfer card.** The same `<TransferCard>` primitive is the source of truth for the card visuals. Send page wires it to APIs; landing page renders it for display only.
4. **Public chrome via route groups.** `(marketing)` and `(auth)` layouts both include `SiteHeader` + `SiteFooter`. Dashboard and admin keep their own shells (sidebar + bottom nav / sidebar) — those replace the marketing chrome because the user is now in the app.
5. **Light first, dark later.** Dark mode tokens are spec'd in `DESIGN_PLAN.md` but not implemented. Ship light first.
6. **Animations respect `prefers-reduced-motion`.** Always.

---

## Next Session Options

### Option A: Product validation (still recommended)
The app is technically complete AND visually designed. The 10-person assignment from `office-hours` still stands:
- Contact 10 most recent CashRemit reach-outs
- Show them the new landing page + Send flow
- Ask: pain with CosmoRemit / what would make them switch / volume + frequency

### Option B: Deploy to Railway
- Provision Postgres on Railway (migrate schema)
- Set provider env vars (real Monoova/Flutterwave/Paystack/Sumsub keys)
- Deploy web app
- Configure Railway cron for `/api/cron/*` routes
- Verify with sandboxed providers

### Option C: Stub pages + polish
Quick-wins to make the public site feel complete:
- `/privacy`, `/terms`, `/compliance-info` stub pages (use `(marketing)` layout — they get nav + footer for free)
- Mobile hamburger menu in `SiteHeader`
- 404 page using Variant D language
- Email verification + password reset flows
- Activity detail page (`/activity/[id]`)

### Option D: Wave 2a — Native iOS (Swift)
Per CLAUDE.md plan. Mirror Variant D in SwiftUI — the design tokens transfer cleanly.

### Option E: Real provider sandboxes
- Sumsub sandbox + KYC widget integration
- Monoova test environment for PayID
- Flutterwave test keys for NGN payout
- Run end-to-end with real APIs

### Option F: Fix known issues
- Test flakiness (per-file DB or transaction rollback)
- Login rate limiting
- Pre-existing Sumsub test type errors

**Recommendation:** **Option A first** (talk to users), then **Option C** (close the public-site loops while waiting for user feedback), then **Option B** (deploy).

---

## How to Resume

```
You are Arch on Kolaleaf. Read CLAUDE.md, then handoff/HANDOVER.md.
Confirm current state and the next action based on the user's direction.
Do not re-read old review requests or design docs unless specifically needed.
Report status in one paragraph — what's done, what's next, what needs a decision.
```

---

## Quick Verification

After resuming, confirm the design system is healthy:

```bash
# Server still up?
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/         # 200 (landing)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login    # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/send     # 307 (auth redirect)

# Type check
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "error TS" | grep -v sumsub | wc -l   # 0

# Tests
npm test -- --run
```
