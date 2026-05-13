// AU-only address constants. Single source of truth for the wizard's
// details step, the complete-registration route, and any future KYC
// backfill job.
export const AU_STATES = [
  "NSW",
  "VIC",
  "QLD",
  "WA",
  "SA",
  "TAS",
  "ACT",
  "NT",
] as const;
export type AuState = (typeof AU_STATES)[number];
export const AU_STATE_SET: ReadonlySet<string> = new Set(AU_STATES);
export const AU_POSTCODE_RE = /^\d{4}$/;

// Type-level drift guard: if Prisma's generated AuState enum ever
// diverges from AU_STATES above (add/remove/rename a value),
// `tsc --noEmit` breaks loudly. Runtime cost: zero.
import type { $Enums } from "@/generated/prisma/client";
type _AuStateSyncCheck = $Enums.AuState extends AuState
  ? AuState extends $Enums.AuState
    ? true
    : never
  : never;
const _auStateSyncCheck: _AuStateSyncCheck = true;
void _auStateSyncCheck;

// Shared rate limits for the email-verification flows. Both the
// pre-account wizard (PendingEmailVerification) and the post-account
// change-email path (EmailVerificationToken) cap code sends at 5 per
// email per hour — keeping them in one place prevents enumeration-
// asymmetry bugs if one gets tuned without the other.
export const EMAIL_CODE_SENDS_PER_HOUR = 5;

// 6-digit code space is 1M; combined with a short TTL and a hard
// per-token attempt cap, this brings brute-force probability into
// the noise.
export const EMAIL_CODE_TTL_MINUTES = 30;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

// Claim window: between verify-code success and complete-registration.
// Intentionally equals the TTL — no reason to grant longer than a
// fresh code would have survived.
export const EMAIL_CLAIM_WINDOW_MINUTES = 30;

// Phone (SMS) variants for the verify-first wizard. Stricter than
// email on every axis because SMS costs money and a stolen phone
// code window is a more potent fraud vector than a stolen email
// code (the attacker probably also has the device).
//
// • 3 sends per hour vs email's 5 — Twilio charges per send (~$0.07
//   AUD per AU SMS at launch).
// • 10-minute TTL vs email's 30 — matches the existing
//   /account/phone/add flow (CODE_TTL_MS in account/phone/add/route.ts)
//   so add-phone and phone-first signup speak the same SMS budget
//   to the user ("expires in 10 minutes").
// • Attempt cap unchanged at 5: the 6-digit code space (10^6) ÷ TTL
//   makes brute-force prohibitive at any cap < TTL/attempt.
export const PHONE_CODE_SENDS_PER_HOUR = 3;
export const PHONE_CODE_TTL_MINUTES = 10;
export const PHONE_CODE_MAX_ATTEMPTS = 5;
// Claim window equals TTL — same logic as EMAIL_CLAIM_WINDOW_MINUTES.
export const PHONE_CLAIM_WINDOW_MINUTES = 10;
