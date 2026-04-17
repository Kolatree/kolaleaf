// Shared reason unions. These are the canonical machine-readable
// failure codes returned in `{ error, reason }` response bodies across
// the auth routes. Client code imports the union to get exhaustive
// switch checking; server code uses the strings directly in jsonError().

// Outcomes from verifying a 6-digit email code. Shared between the
// pre-account (PendingEmailVerification) and post-account
// (EmailVerificationToken) flows because the failure modes are
// structurally identical.
export type VerifyCodeReason =
  | 'no_token'
  | 'expired'
  | 'used'
  | 'wrong_code'
  | 'too_many_attempts'

// /api/auth/complete-registration error reasons. Superset of the
// generic failure modes (invalid_json / missing_email / etc.) plus the
// claim-window failure modes (no_pending_verification, claim_expired)
// and the race guard (already_registered).
export type CompleteRegistrationReason =
  | 'invalid_json'
  | 'missing_email'
  | 'missing_name'
  | 'weak_password'
  | 'missing_address_line1'
  | 'invalid_address_line2'
  | 'missing_city'
  | 'invalid_state'
  | 'invalid_postcode'
  | 'field_too_long'
  | 'name_letters_required'
  | 'no_pending_verification'
  | 'pending_not_verified'
  | 'claim_expired'
  | 'already_registered'
  | 'unexpected'
