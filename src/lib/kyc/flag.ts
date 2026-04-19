// Dev/test escape hatch for the AUSTRAC KYC gate at PayID issuance.
// NEVER set this in production — the gate is the boundary where we
// become a money handler under AUSTRAC rules. This exists so Wave 1
// transaction-flow work can progress before Sumsub API keys land.
export function isKycGateDisabled(): boolean {
  return process.env.KOLA_DISABLE_KYC_GATE === 'true'
}
