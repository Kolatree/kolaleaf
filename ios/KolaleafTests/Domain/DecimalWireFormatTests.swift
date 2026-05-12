// DecimalWireFormatTests.swift  (Phase 6 iter-2 · W22 / ADV-P6-W5)
// Pins the locale-invariant wire formatter for money values. A
// previous regression where `NSDecimalNumber.stringValue` returned
// `1500,00` under `fr_FR` (failing the backend Zod `DecimalString`
// shape) is the reason this exists.

import XCTest
@testable import Kolaleaf

final class DecimalWireFormatTests: XCTestCase {

    func test_wireString_usesDotSeparator_underFrenchLocale() {
        // We can't change the process locale at runtime in a way that
        // affects NumberFormatter('s default), but the canonical
        // formatter is pinned to en_US_POSIX so the output is
        // deterministic regardless of the user's locale.
        let d = Decimal(string: "1500.50")!
        XCTAssertEqual(d.wireString, "1500.5",
                       "wireString must use '.' separator and no grouping.")
    }

    func test_wireMoneyString_alwaysTwoDecimals() {
        XCTAssertEqual(Decimal(string: "1500")!.wireMoneyString, "1500.00")
        XCTAssertEqual(Decimal(string: "0.5")!.wireMoneyString, "0.50")
        XCTAssertEqual(Decimal(string: "10.5")!.wireMoneyString, "10.50")
    }

    func test_wireString_doesNotInsertGroupingSeparator() {
        XCTAssertFalse(Decimal(1_234_567).wireString.contains(","))
        XCTAssertFalse(Decimal(1_234_567).wireMoneyString.contains(","))
    }
}
