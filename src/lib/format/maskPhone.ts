// PII-safe phone masking helper.
//
// Renders an E.164 phone number like `+61412345678` as `+61 ••• 678`
// (first 3 chars + bullet ellipsis + last 3) so the UI can give the user
// a visual confirmation cue without leaking the middle digits.
//
// CA-005 / OO-002 fix: previously inlined inside
// `src/app/api/v1/account/me/route.ts`. Lifted to a generic format
// helper so any surface that needs a phone-masking display string uses
// the same algorithm. The helper is intentionally pure and side-effect
// free.

/**
 * Mask an E.164 phone number for display.
 *
 * Returns the input unchanged when it's shorter than 6 characters
 * (nothing meaningful to mask). Otherwise: `${first 3}${" ••• "}${last 3}`.
 */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  const first = phone.slice(0, 3);
  const last = phone.slice(-3);
  return `${first} ••• ${last}`;
}
