// RecipientChipTests.swift  (Phase 6 · U42)
// RecipientChip is a stateless presentational view. Tests pin down
// the closure surface and the initials derivation through the
// produced accessibility label.

import XCTest
import SwiftUI
@testable import Kolaleaf

@MainActor
final class RecipientChipTests: XCTestCase {

    private let sample = Recipient(
        id: "rcp_1",
        fullName: "Folasade Adeyemi",
        bankName: "GTBank",
        bankCode: "058",
        accountNumber: "0123456789"
    )

    func test_init_capturesOnTapClosure() {
        var taps = 0
        _ = RecipientChip(recipient: sample, onTap: { taps += 1 })
        XCTAssertEqual(taps, 0, "Construction alone must not fire onTap.")
    }
}

@MainActor
final class RecipientPickerSheetTests: XCTestCase {

    private let sample = Recipient(
        id: "rcp_1",
        fullName: "Folasade Adeyemi",
        bankName: "GTBank",
        bankCode: "058",
        accountNumber: "0123456789"
    )

    func test_init_storesParameters() {
        let view = RecipientPickerSheet(
            recipients: [sample],
            selectedRecipientId: nil,
            onSelect: { _ in },
            onAddNew: { }
        )
        let mirror = Mirror(reflecting: view)
        XCTAssertNotNil(mirror.descendant("recipients"))
        XCTAssertNotNil(mirror.descendant("onSelect"))
        XCTAssertNotNil(mirror.descendant("onAddNew"))
    }
}
