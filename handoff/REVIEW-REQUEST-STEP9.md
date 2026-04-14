# Review Request — Step 9: API Routes + Pages (Full Stack)

**Ready for Review: YES**

## Summary

Built the complete API layer (16 route files across 7 groups) and all frontend pages (auth flow, dashboard with 4 pages, bottom nav). Added auth middleware, Kolaleaf visual theme (purple-to-green gradient), and webhook raw body handling. Fixed pre-existing Turbopack build failures caused by `.js` extensions in TypeScript imports across the entire service layer.

## Files Changed

### New Files — API Routes

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/auth/middleware.ts` | 1-54 | Auth middleware: cookie parsing, session validation, requireAuth/requireKyc guards, AuthError class |
| `src/app/api/auth/register/route.ts` | 1-46 | POST — validate inputs, call registerUser, set session cookie, return 201 |
| `src/app/api/auth/login/route.ts` | 1-43 | POST — call loginUser, return user + requires2FA flag, set session cookie |
| `src/app/api/auth/logout/route.ts` | 1-23 | POST — revoke session, clear cookie |
| `src/app/api/auth/verify-2fa/route.ts` | 1-40 | POST — verify 6-digit TOTP token against user's totpSecret |
| `src/app/api/transfers/route.ts` | 1-87 | POST (create, requires KYC) + GET (list, requires auth) with Decimal.js amounts |
| `src/app/api/transfers/[id]/route.ts` | 1-25 | GET — single transfer by ID, ownership enforced |
| `src/app/api/transfers/[id]/cancel/route.ts` | 1-28 | POST — cancel transfer, ownership enforced |
| `src/app/api/recipients/route.ts` | 1-71 | POST (create) + GET (list), requires auth |
| `src/app/api/recipients/[id]/route.ts` | 1-29 | DELETE — remove recipient, ownership enforced |
| `src/app/api/webhooks/monoova/route.ts` | 1-26 | POST — raw body via request.text(), signature from x-monoova-signature |
| `src/app/api/webhooks/flutterwave/route.ts` | 1-31 | POST — raw body, signature from verif-hash header |
| `src/app/api/webhooks/paystack/route.ts` | 1-31 | POST — raw body, signature from x-paystack-signature |
| `src/app/api/webhooks/sumsub/route.ts` | 1-26 | POST — raw body, signature from x-payload-digest |
| `src/app/api/kyc/initiate/route.ts` | 1-26 | POST — initiate SumSub KYC, requires auth |
| `src/app/api/kyc/status/route.ts` | 1-16 | GET — KYC status for current user |
| `src/app/api/rates/[corridorId]/route.ts` | 1-27 | GET — public, returns current rate for corridor |

### New Files — Pages & Layouts

| File | Lines | Purpose |
|------|-------|---------|
| `src/app/(auth)/layout.tsx` | 1-11 | Server component, gradient background, centers auth pages |
| `src/app/(auth)/login/page.tsx` | 1-161 | Client component, email/password form + 2FA step, redirects to /send |
| `src/app/(auth)/register/page.tsx` | 1-124 | Client component, fullName/email/password/referralCode form |
| `src/app/(dashboard)/layout.tsx` | 1-34 | Server component, session check via cookies(), redirects to /login if unauthenticated |
| `src/app/(dashboard)/_components/bottom-nav.tsx` | 1-45 | Client component, 4 nav items (Send/Activity/Recipients/Account), active state via usePathname |
| `src/app/(dashboard)/send/page.tsx` | 1-242 | Core send page: amount input, live rate polling, recipient selector, KYC gate, trust indicators |
| `src/app/(dashboard)/activity/page.tsx` | 1-110 | Transfer list with status badges and formatted amounts |
| `src/app/(dashboard)/recipients/page.tsx` | 1-172 | Recipient CRUD with inline add form and delete |
| `src/app/(dashboard)/account/page.tsx` | 1-120 | KYC status display, 2FA section, logout |

### New Files — Tests

| File | Lines | Purpose |
|------|-------|---------|
| `tests/lib/auth/middleware.test.ts` | 1-65 | 7 tests: cookie parsing, set/clear cookie, AuthError class |
| `tests/app/api/auth/register.test.ts` | 1-80 | 6 tests: successful registration, validation errors, duplicate email |
| `tests/app/api/auth/login.test.ts` | 1-72 | 5 tests: successful login, invalid credentials, missing fields |
| `tests/app/api/webhooks/monoova.test.ts` | 1-59 | 4 tests: valid webhook, invalid signature, idempotent replay |
| `tests/app/api/rates/corridor.test.ts` | 1-45 | 2 tests: valid corridor rate, missing corridor |

### Modified Files

| File | Change |
|------|--------|
| `src/app/globals.css` | Added Kolaleaf theme colors via @theme inline (purple, green, green-light, gold, bg). Removed dark mode. |
| `src/app/layout.tsx` | Updated metadata title/description to Kolaleaf branding |
| `src/app/page.tsx` | Replaced default Next.js page with `redirect('/send')` |
| `src/lib/payments/payout/webhooks.ts` | Fixed dynamic import `.js` extension; changed `as unknown as Record` to `as object` for Prisma Json type |
| `src/lib/payments/payout/flutterwave.ts` | Wrapped 3 `unknown` property accesses with `String()` for type safety |
| `src/lib/transfers/state-machine.ts` | Cast metadata to `object` for Prisma Json field compatibility |
| All `src/lib/**/*.ts` files | Stripped `.js` extensions from relative imports (Turbopack compatibility fix) |

## Key Decisions

1. **Cookie-based auth, no NextAuth** — custom session via `kolaleaf_session` cookie (HttpOnly, SameSite=Lax, Max-Age=900). Auth middleware reads cookies from request headers for API routes, and from `cookies()` API for server component layouts.

2. **Webhook routes use `request.text()`** — raw body preserved for signature verification. Each webhook route parses JSON itself after signature check. No auth middleware on webhook endpoints.

3. **Dashboard layout server-side session check** — the `(dashboard)/layout.tsx` validates the session server-side and redirects to `/login` if invalid. This prevents flash of authenticated UI.

4. **Send page polls rates every 60s** — uses `setInterval` with cleanup. Rate displayed in real-time, receive amount calculated with Decimal.js. KYC gate checks user verification status before allowing transfer.

5. **`.js` import extension cleanup** — all existing service layer files used `.js` extensions in TypeScript imports (e.g., `from './cancel.js'`). Turbopack doesn't resolve these. Fixed globally with sed, then repaired `decimal.js` package name that was accidentally caught.

## Bugs Fixed (Pre-existing)

- **23 "Module not found" build errors** — `.js` extensions in TS imports incompatible with Turbopack. Fixed across all `src/lib/` files.
- **Prisma client out of sync** — `kycRejectionReasons` field existed in schema but not in generated client. Fixed with `npx prisma generate`.
- **Type errors in flutterwave.ts** — `Record<string, unknown>` return type meant all property accesses were `unknown`. Wrapped with `String()`.
- **Prisma Json field type mismatch** — `Record<string, unknown>` not assignable to Prisma's `Json` type after regeneration. Fixed with `as object` casts.

## Verification

```
npx next build — SUCCESS (22 routes: 14 static, 8 dynamic)
npx vitest run — 37 test files passed, 278 tests passed, 0 failed
```

## Open Questions

None. All brief requirements for Step 9 are implemented.
