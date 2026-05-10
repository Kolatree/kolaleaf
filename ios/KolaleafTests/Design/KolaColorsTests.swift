// KolaColorsTests.swift  (Phase 0.6 · Vectors brand pivot)
// Asserts brand colour tokens parse to the Vectors-spec hex values.
// Source of truth: docs/Kolaleaf Vectors /kolaleaf_money_remittance_website_design_system.md §3.

import XCTest
import SwiftUI
@testable import Kolaleaf

final class KolaColorsTests: XCTestCase {

    // MARK: - Core brand

    func testTrustGreenResolvesToBrandHex() {
        // brand.green.900 — primary brand colour (Vectors §3).
        XCTAssertEqual(KolaColors.trustGreen.hexString, "#014D35")
        // Phase 0.6: `green` is an alias for `trustGreen` to keep view
        // call-sites compiling during the rebrand sweep.
        XCTAssertEqual(KolaColors.green.hexString, "#014D35")
    }

    func testKolaGreenResolvesToBrandHex() {
        // brand.green.800 — wordmark colour, nav active state.
        XCTAssertEqual(KolaColors.kolaGreen.hexString, "#03553C")
    }

    func testLeafGreenResolvesToBrandHex() {
        // brand.green.500 — success states, secondary CTA accents.
        XCTAssertEqual(KolaColors.leafGreen.hexString, "#289F2A")
        XCTAssertEqual(KolaColors.greenLight.hexString, "#289F2A")
    }

    func testHopeGoldResolvesToBrandHex() {
        // brand.gold.300 — premium accents.
        XCTAssertEqual(KolaColors.hopeGold.hexString, "#F6D09A")
        XCTAssertEqual(KolaColors.gold.hexString, "#F6D09A")
    }

    // MARK: - Semantic / status

    func testCoralResolvesToDangerHex() {
        // danger.600.
        XCTAssertEqual(KolaColors.coral.hexString, "#D92D20")
    }

    func testWarningResolvesToHex() {
        XCTAssertEqual(KolaColors.warning.hexString, "#F79009")
    }

    func testInfoResolvesToHex() {
        XCTAssertEqual(KolaColors.info.hexString, "#1570EF")
    }

    // MARK: - Neutrals + surfaces

    func testInkResolvesToNeutralHex() {
        // neutral.950 — primary text on light backgrounds.
        XCTAssertEqual(KolaColors.ink.hexString, "#0B1713")
    }

    func testMutedResolvesToNeutralHex() {
        // neutral.600 — body copy / helper text.
        XCTAssertEqual(KolaColors.muted.hexString, "#5E6F68")
    }

    func testBorderResolvesToNeutralHex() {
        // neutral.200 — card borders, dividers.
        XCTAssertEqual(KolaColors.border.hexString, "#DDE6E1")
    }

    func testSurfaceResolvesToNeutralHex() {
        // neutral.50 — page background.
        XCTAssertEqual(KolaColors.surface.hexString, "#FAFCFB")
        // pageLight alias for legacy callers.
        XCTAssertEqual(KolaColors.pageLight.hexString, "#FAFCFB")
    }

    func testCreamResolvesToHex() {
        // cream.50 — warm sections.
        XCTAssertEqual(KolaColors.cream.hexString, "#FFF8EF")
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
