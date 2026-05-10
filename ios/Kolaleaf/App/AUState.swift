// AUState.swift  (Domain)
// Australian state / territory enum used by every surface that takes a
// residential address — onboarding registration, PostKYC ConfirmAddress,
// Recipients, future Statements/Compliance backfill.
//
// CA-001 fix: previously declared inside
// `Features/Onboarding/RegistrationDetailsViewModel.swift`. That made
// PostKYC files implicitly depend on Onboarding for a domain type
// neither feature owns. Moving it to App/ removes the cross-feature
// coupling without renaming the type or adding any call-site changes
// (Swift resolves the symbol via module membership, not folder).
//
// Source of truth for the rawValues: `AU_STATES` in
// `src/lib/auth/constants.ts`. Keep these in lockstep.

import Foundation

public enum AUState: String, CaseIterable, Sendable {
    case nsw = "NSW"
    case vic = "VIC"
    case qld = "QLD"
    case wa = "WA"
    case sa = "SA"
    case tas = "TAS"
    case act = "ACT"
    case nt = "NT"
}
