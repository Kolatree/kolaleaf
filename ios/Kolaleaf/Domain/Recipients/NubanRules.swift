// NubanRules.swift  (Phase 5 · OO-105)
// Pure validation rules for Nigerian Uniform Bank Account Numbers.
// Extracted out of `RecipientResolveService` so the rules can live
// at the domain level and be tested in isolation — no actor, no
// network, no Observation framework.
//
// Source of truth: backend regex `^\d{10}$` enforced server-side at
// `src/app/api/v1/recipients/resolve/_schemas.ts`. The client mirror
// here exists to short-circuit obviously-invalid input before paying
// for a network round-trip; the backend remains the authoritative
// gate (defence-in-depth).

import Foundation

public enum NubanRules {

    /// True when `(bankCode, accountNumber)` passes the same shape
    /// rules the backend enforces. ASCII-only digits — the Unicode
    /// Nd category would otherwise sneak through `Character.isNumber`
    /// (Arabic-Indic digits, etc.) and produce a 422 server-side.
    public static func isValid(bankCode: String, accountNumber: String) -> Bool {
        guard !bankCode.isEmpty else { return false }
        guard accountNumber.count == 10 else { return false }
        return accountNumber.allSatisfy { $0.isASCII && $0.isNumber }
    }
}
