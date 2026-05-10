// Corridor.swift  (Phase 3 · API-010)
// Single source of truth for the active remittance corridor's
// residency country. Wave 1 ships AU → NGN; the country code shows up
// in PATCH /account/me bodies, KYC residency checks, and any future
// surface that needs to assert "this user lives in the send-side
// country we're licensed to operate from".
//
// Why a dedicated type instead of a literal `"AU"` scattered through
// view models:
//   • When SG → NGN or UK → NGN launches, every "AU" literal becomes
//     a hidden place to update — this collapses the list to one
//     symbol and the compiler tells us when something else needs
//     adjusting (KYC document validators, postcode regex, etc.).
//   • The `current` static makes the active corridor a property of
//     the build, not of an arbitrary feature. The send screen, the
//     account screen, and the address VM all read the same value.
//
// The struct (not enum) shape lets us add per-corridor behaviour
// (e.g. sendCurrency, receiveCurrency, postcodeRegex) without
// breaking call sites that only need `countryCode`.

import Foundation

public enum Corridor: String, Sendable, Equatable {

    /// AU → NGN — Wave 1 corridor.
    case auToNgn = "AU_NGN"

    /// The corridor this build targets. Wave 1 hard-codes AU → NGN;
    /// later waves can flip this in one place (or load it from a
    /// remote-config flag) without touching consumer code.
    public static let current: Corridor = .auToNgn

    /// ISO-3166 alpha-2 of the residency country we KYC against and
    /// the country we accept addresses for.
    public var countryCode: String {
        switch self {
        case .auToNgn: return "AU"
        }
    }
}
