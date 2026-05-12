// NubanRulesTests.swift  (Phase 5 · OO-105)
// Pure-function coverage for the NUBAN validation rules extracted
// out of `RecipientResolveService`. Mirrors the backend regex
// `^\d{10}$` on `src/app/api/v1/recipients/resolve/_schemas.ts`.

import XCTest
@testable import Kolaleaf

final class NubanRulesTests: XCTestCase {

    func test_isValid_acceptsTenAsciiDigits() {
        XCTAssertTrue(NubanRules.isValid(bankCode: "044", accountNumber: "0123456789"))
    }

    func test_isValid_rejectsEmptyBankCode() {
        XCTAssertFalse(NubanRules.isValid(bankCode: "", accountNumber: "0123456789"))
    }

    func test_isValid_rejectsShortAccountNumber() {
        XCTAssertFalse(NubanRules.isValid(bankCode: "044", accountNumber: "123"))
    }

    func test_isValid_rejectsLongAccountNumber() {
        XCTAssertFalse(NubanRules.isValid(bankCode: "044", accountNumber: "01234567899"))
    }

    func test_isValid_rejectsLetters() {
        XCTAssertFalse(NubanRules.isValid(bankCode: "044", accountNumber: "012345678a"))
    }

    func test_isValid_rejectsArabicIndicDigits_unicodeNd() {
        // U+0660 ARABIC-INDIC DIGIT ZERO and friends pass
        // `Character.isNumber` but FAIL the backend's ASCII-only
        // regex. The validator must reject them client-side too.
        XCTAssertFalse(NubanRules.isValid(bankCode: "044", accountNumber: "٠١٢٣٤٥٦٧٨٩"))
    }
}
