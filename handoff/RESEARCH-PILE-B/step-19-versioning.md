# Step 19 — /api/v1 versioning — research

## Route inventory

- **auth** — 9 routes: `/api/auth/login`, `/api/auth/logout`, `/api/auth/register`, `/api/auth/send-code`, `/api/auth/verify-code`, `/api/auth/complete-registration`, `/api/auth/verify-email`, `/api/auth/resend-verification`, `/api/auth/request-password-reset`, `/api/auth/reset-password`
- **account** — 9 routes: `/api/account/me`, `/api/account/change-password`, `/api/account/change-email`, `/api/account/email/[id]`, `/api/account/phone/add`, `/api/account/phone/verify`, `/api/account/phone/remove`, `/api/account/2fa/setup`, `/api/account/2fa/enable`, `/api/account/2fa/disable`, `/api/account/2fa/regenerate-backup-codes`
- **admin** — 8 routes: `/api/admin/stats`, `/api/admin/float`, `/api/admin/rates`, `/api/admin/compliance`, `/api/admin/transfers`, `/api/admin/transfers/[id]`, `/api/admin/transfers/[id]/retry`, `/api/admin/transfers/[id]/refund`, `/api/admin/referrals/[id]/pay`
- **cron** — 5 routes: `/api/cron/rates`, `/api/cron/float`, `/api/cron/reconciliation`, `/api/cron/staleness`, `/api/cron/reap-pending-emails`
- **webhooks** — 4 routes: `/api/webhooks/monoova`, `/api/webhooks/flutterwave`, `/api/webhooks/paystack`, `/api/webhooks/sumsub`
- **transfers** — 3 routes: `/api/transfers`, `/api/transfers/[id]`, `/api/transfers/[id]/cancel`
- **recipients** — 3 routes: `/api/recipients`, `/api/recipients/[id]`, `/api/recipients/resolve`
- **rates** — 2 routes: `/api/rates/public`, `/api/rates/[corridorId]`
- **kyc** — 2 routes: `/api/kyc/status`, `/api/kyc/initiate`
- **banks** — 1 route: `/api/banks`

**Total: 47 routes**

## In-repo fetch callers

Direct `fetch()` calls:
- `src/app/_components/landing-page.tsx` → GET `/api/rates/public`
- `src/app/(auth)/login/page.tsx` → POST `/api/auth/login`, POST `/api/auth/verify-2fa`
- `src/app/(dashboard)/send/page.tsx` → GET `/api/rates/public`, GET `/api/recipients`, GET `/api/kyc/status`, POST `/api/transfers`
- `src/app/(dashboard)/recipients/page.tsx` → POST `/api/recipients/resolve`, GET `/api/banks`, GET `/api/recipients`, POST `/api/recipients`
- `src/app/(dashboard)/activity/page.tsx` → GET `/api/transfers`
- `src/app/(dashboard)/account/page.tsx` → GET `/api/kyc/status`, POST `/api/auth/logout`, POST `/api/kyc/initiate`
- `src/app/(dashboard)/account/_components/account-identity-section.tsx` → GET `/api/account/me`, POST `/api/account/change-password`, POST `/api/account/change-email`
- `src/app/(dashboard)/account/_components/two-factor-section.tsx` → GET `/api/account/me` (×2), POST `/api/account/2fa/setup`, POST `/api/account/2fa/enable`, POST `/api/account/2fa/disable`, POST `/api/account/2fa/regenerate-backup-codes`
- `src/app/admin/page.tsx` → GET `/api/admin/stats`, `/api/admin/float`, `/api/admin/rates` (via `fetchAdminJson`)
- `src/app/admin/rates/page.tsx` → GET `/api/admin/rates`, POST `/api/admin/rates`
- `src/app/admin/transfers/page.tsx` → GET `/api/admin/transfers`
- `src/app/admin/transfers/[id]/page.tsx` → GET `/api/admin/transfers/[id]`, POST retry, POST refund
- `src/app/admin/compliance/page.tsx` → GET `/api/admin/compliance`

Via `useWizardSubmit` hook (wraps `fetchWithTimeout`):
- `src/app/(auth)/register/page.tsx` → POST `/api/auth/send-code`
- `src/app/(auth)/register/verify/page.tsx` → POST `/api/auth/verify-code`, POST `/api/auth/send-code`
- `src/app/(auth)/register/details/page.tsx` → POST `/api/auth/complete-registration`
- `src/app/(auth)/verify-email/page.tsx` → POST `/api/auth/verify-email`, POST `/api/auth/resend-verification`
- `src/app/(dashboard)/kyc/page.tsx` → POST `/api/kyc/initiate`

## External webhook callers (must stay on /api/webhooks/*)

- `/api/webhooks/monoova` — called by Monoova (AUD PayID payment notifications)
- `/api/webhooks/flutterwave` — called by Flutterwave (NGN payout status)
- `/api/webhooks/paystack` — called by Paystack (NGN payout fallback status)
- `/api/webhooks/sumsub` — called by Sumsub (KYC approval/rejection events)

Cron routes (`/api/cron/*`) are also externally invoked (Railway cron scheduler). Moving them requires Railway job config changes.

## next.config rewrites/redirects

None. `next.config.ts` is empty (`nextConfig = {}`).

## Shared fetch wrapper

- `src/lib/http/fetch-with-timeout.ts` — exports `fetchWithTimeout()` with AbortController timeout. Used by `src/lib/hooks/use-wizard-submit.ts` (the wizard hook). Auth/dashboard pages call bare `fetch()` directly; admin pages use a local `fetchAdminJson` helper (not a shared module). No single centralized prefix — callers inline `/api/` paths.

## Open questions for Arch

- Should `/api/webhooks/*` remain permanently outside `/api/v1` (provider URLs are hardcoded on their side)?
- Should `/api/cron/*` remain outside `/api/v1` (Railway cron job URLs are config-side)?
- Admin routes (`/api/admin/*`) are consumed by Next.js server components via `fetchAdminJson` — does `/api/v1/admin/*` make sense or should admin stay on a separate path?
- `fetchWithTimeout` in `use-wizard-submit` is the natural place to inject a `/api/v1` prefix for wizard flows; bare `fetch()` in dashboard/admin pages would need individual updates. Should a unified client wrapper be introduced first?
