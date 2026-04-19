// Dev/test escape hatch for the AUSTRAC KYC gate at PayID issuance.
// NEVER set this in production — the gate is the boundary where we
// become a money handler under AUSTRAC rules. This exists so Wave 1
// transaction-flow work can progress before Sumsub API keys land.
//
// Strict parsing: accept only the literal string `"true"`. Other
// truthy-looking values (`TRUE`, `1`, `yes`) return false so a stray
// value can't accidentally disable the gate.

export function isKycGateDisabled(): boolean {
  return process.env.KOLA_DISABLE_KYC_GATE === 'true'
}

// Production tripwire. Mirrors `assertStubProvidersSafe()` in
// src/lib/payments/flag.ts — every caller that trusts the KYC bypass
// flag must call this first so a stray env var in a Railway deploy
// cannot silently degrade AUSTRAC KYC enforcement.
export function assertKycGateSafe(): void {
  if (isKycGateDisabled() && process.env.NODE_ENV === 'production') {
    throw new Error(
      'KOLA_DISABLE_KYC_GATE=true is forbidden in production — ' +
        'the KYC gate is the AUSTRAC money-handler boundary and ' +
        'cannot be bypassed for live customer transfers. Unset the ' +
        'flag and redeploy.',
    )
  }
}
