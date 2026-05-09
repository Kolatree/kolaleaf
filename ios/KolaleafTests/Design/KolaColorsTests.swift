// KolaColorsTests.swift  (Phase 0 · U2)
// Asserts brand color tokens parse to the expected hex values.

import XCTest
import SwiftUI
@testable import Kolaleaf

final class KolaColorsTests: XCTestCase {
    func testPurpleResolvesToBrandHex() {
        let c = KolaColors.purple
        XCTAssertEqual(c.hexString, "#2D1B69")
    }

    func testGreenResolvesToBrandHex() {
        XCTAssertEqual(KolaColors.green.hexString, "#1A6B3C")
    }

    func testGreenLightResolvesToBrandHex() {
        XCTAssertEqual(KolaColors.greenLight.hexString, "#7DD87D")
    }

    func testGoldResolvesToBrandHex() {
        XCTAssertEqual(KolaColors.gold.hexString, "#FFD700")
    }

    func testCoralResolvesToBrandHex() {
        XCTAssertEqual(KolaColors.coral.hexString, "#FF8A8A")
    }
}

// Test helper: extract hex string from a SwiftUI Color via UIColor.
private extension Color {
    var hexString: String {
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        let R = Int((r * 255).rounded())
        let G = Int((g * 255).rounded())
        let B = Int((b * 255).rounded())
        return String(format: "#%02X%02X%02X", R, G, B)
    }
}
