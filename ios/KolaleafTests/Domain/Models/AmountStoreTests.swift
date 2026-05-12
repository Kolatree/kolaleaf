// AmountStoreTests.swift  (Phase 6 · U41)
// AmountStore is the source of truth for the send-amount entry. The
// tests below pin down the cents-based arithmetic, the display
// formatting contract, and the digit-cap invariant — invariants the
// SendView relies on for both visual rendering and API submission.

import XCTest
@testable import Kolaleaf

@MainActor
final class AmountStoreTests: XCTestCase {

    // MARK: - append / delete / clear

    func test_init_zero() {
        let s = AmountStore()
        XCTAssertEqual(s.cents, 0)
        XCTAssertEqual(s.displayString, "0")
    }

    func test_append_singleDigit_buildsCents() {
        let s = AmountStore()
        s.append(1)
        s.append(2)
        s.append(3)
        XCTAssertEqual(s.cents, 123)
        XCTAssertEqual(s.displayString, "1.23")
    }

    func test_append_thousand_dollars_no_trailing_decimals() {
        // $1,000 = 100000 cents. Display should drop the .00.
        let s = AmountStore()
        for d in [1, 0, 0, 0, 0, 0] {
            s.append(d)
        }
        XCTAssertEqual(s.cents, 100_000)
        XCTAssertEqual(s.displayString, "1,000")
    }

    func test_append_leading_zero_suppressed() {
        let s = AmountStore()
        s.append(0)
        XCTAssertEqual(s.cents, 0)
        XCTAssertEqual(s.displayString, "0")
        s.append(0)
        s.append(0)
        XCTAssertEqual(s.cents, 0)
    }

    func test_append_outOfRange_isNoOp() {
        let s = AmountStore()
        s.append(-1)
        s.append(10)
        XCTAssertEqual(s.cents, 0)
    }

    func test_append_caps_atMaxDigits() {
        let s = AmountStore()
        // 9,999,999,999 cents = $99,999,999.99 (10 digits).
        for _ in 0..<10 {
            s.append(9)
        }
        XCTAssertEqual(s.cents, 9_999_999_999)
        // Eleventh append is a no-op.
        s.append(9)
        XCTAssertEqual(s.cents, 9_999_999_999)
    }

    func test_delete_removesLastDigit() {
        let s = AmountStore()
        s.append(1); s.append(2); s.append(3)
        s.delete()
        XCTAssertEqual(s.cents, 12)
        XCTAssertEqual(s.displayString, "0.12")
    }

    func test_delete_onEmpty_isNoOp() {
        let s = AmountStore()
        s.delete()
        XCTAssertEqual(s.cents, 0)
    }

    func test_clear_resets() {
        let s = AmountStore()
        s.append(5); s.append(0); s.append(0)
        s.clear()
        XCTAssertEqual(s.cents, 0)
        XCTAssertEqual(s.displayString, "0")
    }

    // MARK: - API submission shape

    func test_apiAmountString_alwaysTwoDecimals() {
        let s = AmountStore()
        for d in [1, 0, 0, 0, 0, 0] { s.append(d) }
        XCTAssertEqual(s.apiAmountString, "1000.00")

        s.clear()
        s.append(5); s.append(0)
        XCTAssertEqual(s.apiAmountString, "0.50")
    }

    func test_decimalAmount_matchesApiString() {
        let s = AmountStore()
        for d in [1, 5, 5, 0] { s.append(d) }
        // 1550 cents = $15.50
        XCTAssertEqual(s.decimalAmount, Decimal(string: "15.50"))
    }
}
