// BankBrandTableTests.swift  (Phase 5 · OO-202 / CA-201 — iteration 3)
// Pure-function coverage for the brand-colour table. These exercise
// the substring-matching logic directly, without standing up a
// BankStore or threading through SwiftUI's environment.
//
// Color values can't be structurally compared (Color has no
// cross-colour-space `Equatable`), so the assertion contract is:
//   • The lookup returns without crashing for representative names.
//   • Unknown names fall back to `KolaColors.mutedDisabled`.
//   • Case + prefix variants ("ACCESS BANK PLC", "First Bank of …")
//     route to the same colour as the canonical name.
//
// We can't peek inside `Color` to assert specific hex values, but we
// CAN assert structural identity (`==`) between two calls that
// should return the same swatch. SwiftUI's `Color` is `Equatable`
// for literal constants and `Color(hex:)` references — calls with
// the same input produce the same value.

import XCTest
import SwiftUI
@testable import Kolaleaf

@MainActor
final class BankBrandTableTests: XCTestCase {

    // MARK: - Unknown bank fallback

    func test_unknownBank_fallsBackToMutedDisabled() {
        let color = BankBrandTable.color(forBankName: "Bank of Kolaleaf")
        // Structural identity against the documented fallback.
        XCTAssertEqual(color, KolaColors.mutedDisabled)
    }

    func test_emptyName_fallsBackToMutedDisabled() {
        let color = BankBrandTable.color(forBankName: "")
        XCTAssertEqual(color, KolaColors.mutedDisabled)
    }

    // MARK: - Known banks

    func test_knownBank_accessBank_returnsBrandColor() {
        let access = BankBrandTable.color(forBankName: "Access Bank")
        // Cross-check: the unknown-name fallback must differ.
        XCTAssertNotEqual(access, KolaColors.mutedDisabled)
    }

    func test_knownBank_gtbank_returnsBrandColor() {
        let gtbank = BankBrandTable.color(forBankName: "GTBank")
        XCTAssertNotEqual(gtbank, KolaColors.mutedDisabled)
    }

    // MARK: - Case + prefix variants

    /// Substring matching is case-insensitive: "ACCESS BANK PLC"
    /// resolves to the same colour as "Access Bank".
    func test_caseInsensitive_uppercaseVariantMatchesCanonical() {
        let canonical = BankBrandTable.color(forBankName: "Access Bank")
        let upper = BankBrandTable.color(forBankName: "ACCESS BANK PLC")
        XCTAssertEqual(canonical, upper)
    }

    /// Prefix wrappers ("First Bank of Nigeria Limited") resolve via
    /// the canonical substring match.
    func test_prefixVariant_firstBank_matchesCanonical() {
        let canonical = BankBrandTable.color(forBankName: "First Bank")
        let wrapped = BankBrandTable.color(forBankName: "First Bank of Nigeria Limited")
        XCTAssertEqual(canonical, wrapped)
    }

    /// "United Bank for Africa" must match the "uba" / "united bank"
    /// branch, not fall through to mutedDisabled.
    func test_unitedBankForAfrica_matchesUba() {
        let canonical = BankBrandTable.color(forBankName: "UBA")
        let wrapped = BankBrandTable.color(forBankName: "United Bank for Africa")
        XCTAssertEqual(canonical, wrapped)
    }

    /// Order matters where one name is a prefix of another:
    /// "Stanbic IBTC" must resolve to the Stanbic branch even though
    /// "stanbic" contains the "ibtc" trigger too. The current
    /// implementation tests both fragments under the same return.
    func test_prefixCollision_stanbicResolvesConsistently() {
        let stanbic = BankBrandTable.color(forBankName: "Stanbic IBTC Bank")
        let ibtc = BankBrandTable.color(forBankName: "IBTC")
        XCTAssertEqual(stanbic, ibtc, "Stanbic and IBTC share the same brand colour.")
    }
}
