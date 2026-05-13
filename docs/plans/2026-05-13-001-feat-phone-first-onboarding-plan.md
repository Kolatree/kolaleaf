# Plan: Phone-First Onboarding (with email fallback)

**Date:** 2026-05-13
**Status:** Draft — substantial multi-week effort spanning backend + iOS + provider integration
**Origin:** User feedback during Phase 10 — "we started with phone number during design but you only implemented email"

## Why

The original product design (`docs/Kolaleaf Vectors/`, screens shared 2026-05-13) put **phone number** as the primary identifier with **email as a fallback link** ("or use email instead"). The current Wave 1 implementation ships email-only because the backend `LoginIdentifier` schema is `{type: "email", value: Email}` (`src/app/api/v1/auth/login/_schemas.ts:17-20`) — phone wasn't yet wired into the auth or send-code routes.

Phone-first matters because:

- Lower onboarding friction for the target Nigerian-Australian remittance audience (most have working SMS, not all have ready email access on a new device)
- AUSTRAC KYC depends on a verified phone for SMR/TTR notifications — collecting phone early aligns Kolaleaf with the regulatory data we need anyway
- The design's trust signals ("Standard SMS rates apply", "We'll never share your number") build credibility in a way email entry does not

## Scope

**In scope:**

- Backend `LoginIdentifier` widens to support `{type: "phone", value: E.164}`
- Backend `send-code` route accepts `{type: "phone", value: E.164}` and dispatches via SMS provider
- Backend `verify-code` route accepts a phone+code pair as well as email+code
- New SMS provider integration (Twilio recommended — AUSTRAC-friendly, AU number support, well-documented webhook-free flow)
- iOS `WelcomeView` + new `PhoneEntryView` + `PhoneOTPView` (phone-OTP variant of EmailOTP)
- iOS `SignInView` defaults to phone, with "or use email instead" link to fall back to current EmailEntryView
- iOS country-code picker (default +61 AU; +234 NG and others as the corridor expands)
- iOS E.164 normalisation at submit time (no normalisation in UI — keep what user types visible)

**Out of scope (later phases):**

- WhatsApp OTP fallback (cheaper than SMS internationally; deferred to corridor expansion)
- Voice-call OTP for accessibility (Twilio supports it, defer)
- Apple/Google sign-in (already commented as future work in `LoginIdentifier`)

## Backend changes

### 1. SMS provider — Twilio

Sign up for Twilio business account. Buy AU SMS sender (long-code or short-code). Add env vars to Railway:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM` — the sender number

Cost estimate: ~$0.07 AUD per SMS to AU. At 10k signups/year × 2 codes (signup + login) = $1,400/yr.

### 2. New `src/lib/auth/sms/sms-client.ts`

```ts
export interface SmsClient {
  send(to: string, message: string): Promise<void>
}
export function createTwilioSmsClient(): SmsClient { ... }
```

### 3. Schema widen — `_schemas.ts` files

`src/app/api/v1/auth/send-code/_schemas.ts`:

```ts
export const SendCodeBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("email"), value: Email }),
  z.object({ type: z.literal("phone"), value: PhoneE164 }),
]);
```

`src/app/api/v1/auth/verify-code/_schemas.ts`: same shape extension.

`src/app/api/v1/auth/login/_schemas.ts`: extend `LoginIdentifier` discriminated union to include the phone variant.

### 4. Route updates

`src/app/api/v1/auth/send-code/route.ts`:

- Branch on `type`: if email → existing email-OTP path; if phone → call `smsClient.send(value, code)`.
- Persistence: existing `EmailVerificationCode` table needs to be renamed to `VerificationCode` with a `kind` column (`EMAIL` | `PHONE`) — Prisma migration.

`src/app/api/v1/auth/verify-code/route.ts`:

- Branch the lookup by `(value, kind, code)`.
- On verify-success for `phone`: mark phone identifier verified on the User row; mint session cookie if it's a login flow.

`src/app/api/v1/auth/login/route.ts`:

- For `phone` identifier: lookup user by verified phone identifier, password check unchanged.

### 5. Database migration

```sql
-- Rename + add kind discriminator
ALTER TABLE email_verification_codes RENAME TO verification_codes;
ALTER TABLE verification_codes ADD COLUMN kind TEXT NOT NULL DEFAULT 'EMAIL';
ALTER TABLE verification_codes ADD COLUMN identifier TEXT NOT NULL;
-- Backfill identifier from email column for existing rows
UPDATE verification_codes SET identifier = email WHERE identifier IS NULL;
ALTER TABLE verification_codes DROP COLUMN email;
```

Apply via the consolidated production migration scripts pattern per `~/.claude/CLAUDE.md`.

## iOS changes

### 6. New endpoint DTOs

`ios/Kolaleaf/Networking/DTOs/AuthDTOs.swift`:

```swift
public enum LoginIdentifier: Codable, Sendable {
    case email(String)
    case phone(String)  // E.164
}
public struct SendCodeRequest: Codable, Sendable {
    public let type: String  // "email" | "phone"
    public let value: String
}
```

### 7. New views

- `ios/Kolaleaf/Features/Onboarding/PhoneEntryView.swift` + ViewModel — country picker + phone field + Send code CTA + "or use email instead" link
- `ios/Kolaleaf/Features/Onboarding/PhoneOTPView.swift` + ViewModel — 6-digit code entry (mirror of EmailOTPView shape)
- `ios/Kolaleaf/Features/Onboarding/CountryPicker.swift` — list of supported country codes

### 8. Welcome flow change

`OnboardingCoordinator`: change the `.welcome` → `.emailEntry` default path to `.welcome` → `.phoneEntry`. EmailEntry remains reachable via the fallback link.

`SignInView`: default identifier field is phone; secondary "Use email" link toggles to email field.

### 9. Tests

- Backend Vitest: phone send-code → SMS provider stub → verify-code → session cookie issued
- Backend Vitest: login with phone identifier → 200 + cookie
- iOS XCTest: PhoneEntryViewModel happy path + invalid number + rate limit
- iOS XCTest: PhoneOTPViewModel verify happy path + wrong code + expired
- Update `LoginRequest` shape tests for the new identifier union

## Sequencing

| Wave      | Work                                                           | Estimate             |
| --------- | -------------------------------------------------------------- | -------------------- |
| W1        | Twilio account + AU sender + Railway env vars                  | 1 day                |
| W2        | Backend: SmsClient + schema widen + routes + migration + tests | 3 days               |
| W3        | iOS: DTOs + endpoints + new views + coordinator changes        | 4 days               |
| W4        | E2E test on simulator + physical device + Twilio sandbox       | 1 day                |
| W5        | Production rollout via feature flag (`PHONE_LOGIN_ENABLED`)    | 1 day                |
| **Total** |                                                                | **~10 working days** |

## Migration risk

- Existing email-only users continue to work (LoginIdentifier remains a discriminated union with the email branch unchanged)
- New users land on phone-first immediately
- Existing users who want to add a phone identifier do so via Account → Security (separate flow, out of scope here but already on the Phase 11 roadmap per `KYCEndpoints` adjacency)

## Open questions

1. **Whitelist vs allowlist for country codes**: Wave 1 corridor is AU→NG. Allow only `+61` and `+234` initially, or open to all and rely on KYC for residency proof? Recommendation: AU only at signup (matches AUSTRAC AU-resident requirement), open to NG + global once corridor expands.
2. **WhatsApp OTP**: Twilio supports it — significantly cheaper internationally. Defer to phase that handles second corridor.
3. **Existing accounts without verified phone**: prompt to add at next sign-in? Or only at the next AML threshold event? Recommend the latter — don't wall existing users out.
