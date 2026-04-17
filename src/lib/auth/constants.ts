// AU-only address constants. Single source of truth for the wizard's
// details step, the complete-registration route, and any future KYC
// backfill job.
export const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const
export type AuState = (typeof AU_STATES)[number]
export const AU_STATE_SET: ReadonlySet<string> = new Set(AU_STATES)
export const AU_POSTCODE_RE = /^\d{4}$/

// Shared rate limits for the email-verification flows. Both the
// pre-account wizard (PendingEmailVerification) and the post-account
// change-email path (EmailVerificationToken) cap code sends at 5 per
// email per hour — keeping them in one place prevents enumeration-
// asymmetry bugs if one gets tuned without the other.
export const EMAIL_CODE_SENDS_PER_HOUR = 5

// 6-digit code space is 1M; combined with a short TTL and a hard
// per-token attempt cap, this brings brute-force probability into
// the noise.
export const EMAIL_CODE_TTL_MINUTES = 30
export const EMAIL_CODE_MAX_ATTEMPTS = 5

// Claim window: between verify-code success and complete-registration.
// Intentionally equals the TTL — no reason to grant longer than a
// fresh code would have survived.
export const EMAIL_CLAIM_WINDOW_MINUTES = 30
