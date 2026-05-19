// AppLocaleTests.swift  (Phase 12 · U81/U81c)

import XCTest
@testable import Kolaleaf

final class AppLocaleTests: XCTestCase {

    func test_supportedLocales_matchPhase12Languages() {
        XCTAssertEqual(
            AppLocale.allCases.map(\.rawValue),
            ["system", "en", "yo", "ig", "ha"]
        )
    }

    func test_normalized_fallsBackToSystemForUnknownValues() {
        XCTAssertEqual(AppLocale.normalized("fr"), .system)
        XCTAssertEqual(AppLocale.normalized(""), .system)
        XCTAssertEqual(AppLocale.normalized("yo"), .yoruba)
    }

    func test_localeIdentifier_isNilOnlyForSystem() {
        XCTAssertNil(AppLocale.system.localeIdentifier)
        XCTAssertEqual(AppLocale.english.localeIdentifier, "en")
        XCTAssertEqual(AppLocale.yoruba.localeIdentifier, "yo")
        XCTAssertEqual(AppLocale.igbo.localeIdentifier, "ig")
        XCTAssertEqual(AppLocale.hausa.localeIdentifier, "ha")
    }
}
