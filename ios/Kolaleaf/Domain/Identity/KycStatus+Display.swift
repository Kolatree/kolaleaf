// KycStatus+Display.swift  (Phase 8 iter-2 · N16/N17)
// User-facing labels for the `KycStatus` enum (which lives next to
// `AppState`). Lifted out of `AccountViewModel.kycLabel` so every
// surface (Account badge, KYC processing toast, future
// SoftRejection-CTA) renders the same copy without import-cycling
// through a feature module.
//
// Why an extension rather than a separate type?
//   • The enum already carries the typed-Prisma-rawValue contract
//     (PENDING/IN_REVIEW/VERIFIED/REJECTED). Display copy is a pure
//     function of the case — no state, no I/O — so it belongs as an
//     extension property rather than a stateful renderer.

import Foundation

public extension KycStatus {
    /// Human-readable badge label (e.g. "Verified", "Action needed").
    /// Iter-2 (N16) — centralised here so a future copy review doesn't
    /// have to chase a duplicate per surface.
    var displayLabel: String {
        switch self {
        case .verified: return "Verified"
        case .pending:  return "Pending"
        case .inReview: return "In review"
        case .rejected: return "Action needed"
        case .unknown:  return "Unknown"
        }
    }
}
