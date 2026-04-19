// Stub-provider escape hatch.
//
// `KOLA_USE_STUB_PROVIDERS=true` activates in-memory stubs for Monoova
// (PayID issuance), BudPay (payout), and Flutterwave (payout). Lets the
// full transaction flow be exercised end-to-end in dev without any real
// provider credentials.
//
// NEVER set this in production — we'd silently skip real money handling
// and manufacture fake success. `assertStubProvidersSafe()` is the
// tripwire every provider factory calls before returning a stub.
//
// Strict parsing: we only accept the literal string `"true"`. Other
// truthy-looking values (`TRUE`, `1`, `yes`) return false so a copy-paste
// from a different project's convention can't accidentally flip prod.

export function isStubProvidersEnabled(): boolean {
  return process.env.KOLA_USE_STUB_PROVIDERS === 'true'
}

export function assertStubProvidersSafe(): void {
  if (isStubProvidersEnabled() && process.env.NODE_ENV === 'production') {
    throw new Error(
      'KOLA_USE_STUB_PROVIDERS=true is forbidden in production — ' +
        'stub providers synthesize fake success and must not be used ' +
        'against real customer transfers. Unset the flag and redeploy.',
    )
  }
}
