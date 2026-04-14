# Review Request — Step 10: Admin Dashboard

**Ready for Review: YES**

## Summary

Built the admin dashboard for the ops co-founder to manage day-to-day operations. Includes admin middleware (email-based auth guard), 9 API routes, 5 admin pages, and a sidebar layout.

## Files Changed

### Admin Middleware
- `src/lib/auth/admin-middleware.ts` (lines 1-31) — `requireAdmin(request)` checks session + ADMIN_EMAILS env var. Returns 403 for non-admins, 401 for unauthenticated.
- `src/lib/auth/__tests__/admin-middleware.test.ts` (lines 1-103) — 4 tests: admin passes, non-admin 403, unauthenticated 401, invalid token 401. All pass.

### Admin API Routes (9 endpoints)
- `src/app/api/admin/transfers/route.ts` — `GET /api/admin/transfers` with status, date range, search filters. Cursor pagination. Includes user/recipient.
- `src/app/api/admin/transfers/[id]/route.ts` — `GET /api/admin/transfers/[id]` with events, user, recipient.
- `src/app/api/admin/transfers/[id]/retry/route.ts` — `POST` transitions NEEDS_MANUAL -> PROCESSING_NGN. Logs ADMIN_TRANSFER_RETRY auth event.
- `src/app/api/admin/transfers/[id]/refund/route.ts` — `POST` transitions NEEDS_MANUAL -> REFUNDED. Logs ADMIN_TRANSFER_REFUND auth event.
- `src/app/api/admin/rates/route.ts` — `GET` returns all corridor rates with staleness info and history. `POST` creates admin rate override via `setAdminRate`. Logs ADMIN_RATE_OVERRIDE.
- `src/app/api/admin/stats/route.ts` — `GET` returns transfers today, AUD volume, active users (30d), pending KYC, transfers grouped by status. All real aggregated data.
- `src/app/api/admin/float/route.ts` — `GET` returns float balance, threshold, and sufficiency status via FloatMonitor.
- `src/app/api/admin/compliance/route.ts` — `GET` lists compliance reports with type filter and cursor pagination.
- `src/app/api/admin/referrals/[id]/pay/route.ts` — `POST` processes referral reward payment via `processReward`. Logs ADMIN_REFERRAL_PAID.

### Admin Layout
- `src/app/admin/layout.tsx` — Server component. Auth guard checks session + admin email, redirects to /login if not admin. Sidebar + main content layout.
- `src/app/admin/_components/admin-sidebar.tsx` — Client component. Side nav with Dashboard, Transfers, Rates, Compliance links. Active state highlighting.

### Admin Pages (5 pages)
- `src/app/admin/page.tsx` — Dashboard overview: stat cards (transfers today, volume, active users, pending KYC), float status with low-float alert, stale rate warnings, transfer status breakdown.
- `src/app/admin/transfers/page.tsx` — Transfer table with status filter, search by user/recipient, cursor-based Load More. Links to detail view.
- `src/app/admin/transfers/[id]/page.tsx` — Transfer detail: all fields, event timeline with actor/metadata, Retry Payout and Refund buttons for NEEDS_MANUAL transfers.
- `src/app/admin/rates/page.tsx` — Current rates per corridor with staleness indicator, expandable rate history table, admin rate override form.
- `src/app/admin/compliance/page.tsx` — Compliance report list with type filter and cursor pagination.

### Pre-existing Fix
- `src/lib/workers/float-alert.ts` (line 16) — Fixed pre-existing build error: `FlutterwaveProvider` constructor requires config, was being called with no args. Passed required `secretKey` and `apiUrl` from env vars.

## Verification

- `npm run build` — succeeds, all 9 admin API routes and 4 admin pages in build output
- `npm test` — admin middleware tests: 4 passed, 4 total
- Pre-existing test failures: `tests/lib/transfers/queries.test.ts` (5 failed) and `tests/lib/transfers/create.test.ts` (9 skipped) due to missing AUD-NGN corridor in test DB. Not caused by this step.

## Design Decisions

1. **Admin auth via ADMIN_EMAILS env var** — Simple comma-separated email list. No role table. As specified in the brief.
2. **All admin actions logged** — Every mutation (retry, refund, rate override, referral pay) creates an AuthEvent with the admin's userId.
3. **Server component layout** — Admin layout does the auth check server-side, preventing any flash of admin UI for non-admins.
4. **Functional UI** — No gradient, no fancy design. Clean white/gray with clear data hierarchy. Admin is for ops, not marketing.
5. **Reused existing services** — `transitionTransfer`, `RateService.setAdminRate`, `FloatMonitor.checkFloatBalance`, `processReward` — no duplication.

## Open Questions

None.
