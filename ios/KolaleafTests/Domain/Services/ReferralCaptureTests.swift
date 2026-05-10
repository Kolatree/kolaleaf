// ReferralCaptureTests.swift  (Phase 1 · U91)
// Validates the actor-based ReferralCapture service. Uses a fake PasteboardSource
// + a per-test UserDefaults suite + a per-test Keychain service so persistence
// doesn't bleed between tests.

import XCTest
@testable import Kolaleaf

final class ReferralCaptureTests: XCTestCase {

    private var defaults: UserDefaults!
    private var keychain: Keychain!
    private var pasteboard: FakePasteboard!
    private var capture: ReferralCapture!

    private static let validToken = "kola_a3f9b7c2d8e1"
    private static let otherValid = "kola_z9y8x7w6v5u4"

    override func setUp() async throws {
        let suiteName = "kola.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        keychain = Keychain(service: "com.kolaleaf.tests.\(UUID().uuidString)")
        pasteboard = FakePasteboard()
        capture = ReferralCapture(keychain: keychain, defaults: defaults, pasteboard: pasteboard)
    }

    override func tearDown() async throws {
        // Keychain items in this per-test service are orphaned but harmless;
        // each new test uses a fresh service identifier.
        try? await keychain.delete(forKey: KeychainKeys.referralToken)
        defaults = nil
        keychain = nil
        pasteboard = nil
        capture = nil
    }

    // MARK: - Pasteboard

    func test_pasteboardCapture_validToken_storesAndReturns() async throws {
        await pasteboard.setString(Self.validToken)

        let captured = await capture.captureFromPasteboardIfNotConsumed()

        XCTAssertEqual(captured, Self.validToken)
        let stored = try await keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertEqual(stored, Self.validToken)
        XCTAssertTrue(defaults.bool(forKey: "kola.referralPasteboardScanned"))
    }

    func test_pasteboardCapture_invalidFormat_returnsNil_doesNotStore() async {
        await pasteboard.setString("not-a-kola-token")

        let captured = await capture.captureFromPasteboardIfNotConsumed()

        XCTAssertNil(captured)
        let stored = try? await keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertNil(stored)
        // Scan flag is still set: we did inspect the pasteboard.
        XCTAssertTrue(defaults.bool(forKey: "kola.referralPasteboardScanned"))
    }

    func test_pasteboardCapture_secondCallAfterScan_returnsNil_evenIfPasteboardChanged() async {
        await pasteboard.setString("garbage-on-first-launch")
        _ = await capture.captureFromPasteboardIfNotConsumed()

        // User pastes a valid token AFTER the one-shot scan has already fired.
        await pasteboard.setString(Self.validToken)

        let second = await capture.captureFromPasteboardIfNotConsumed()
        XCTAssertNil(second, "One-shot guard must prevent re-scanning the pasteboard")
    }

    func test_pasteboardCapture_emptyPasteboard_returnsNil() async {
        await pasteboard.setString(nil)

        let captured = await capture.captureFromPasteboardIfNotConsumed()

        XCTAssertNil(captured)
    }

    // MARK: - Universal link

    func test_universalLink_validToken_overridesPasteboard() async throws {
        // Pasteboard fired first with a valid token.
        await pasteboard.setString(Self.validToken)
        _ = await capture.captureFromPasteboardIfNotConsumed()

        let url = URL(string: "https://kolaleaf.com.au/refer/\(Self.otherValid)")!
        let captured = await capture.captureFromUniversalLink(url)

        XCTAssertEqual(captured, Self.otherValid)
        let stored = try await keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertEqual(stored, Self.otherValid, "Universal link must override pasteboard token")
    }

    func test_universalLink_invalidToken_returnsNil_doesNotOverride() async throws {
        await pasteboard.setString(Self.validToken)
        _ = await capture.captureFromPasteboardIfNotConsumed()

        let url = URL(string: "https://kolaleaf.com.au/refer/BAD-FORMAT")!
        let captured = await capture.captureFromUniversalLink(url)

        XCTAssertNil(captured)
        let stored = try await keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertEqual(stored, Self.validToken, "Bad universal link must not erase a stored token")
    }

    func test_universalLink_unrecognizedPath_returnsNil() async {
        let url = URL(string: "https://kolaleaf.com.au/something-else")!
        let captured = await capture.captureFromUniversalLink(url)
        XCTAssertNil(captured)
    }

    // MARK: - Explicit prompt

    func test_explicit_validToken_overridesEverything() async throws {
        await pasteboard.setString(Self.validToken)
        _ = await capture.captureFromPasteboardIfNotConsumed()
        _ = await capture.captureFromUniversalLink(URL(string: "https://kolaleaf.com.au/refer/\(Self.otherValid)")!)

        let third = "kola_111122223333"
        let captured = await capture.captureFromExplicit(third)

        XCTAssertEqual(captured, third)
        let stored = try await keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertEqual(stored, third)
    }

    func test_explicit_invalidToken_returnsNil() async {
        let captured = await capture.captureFromExplicit("nope")
        XCTAssertNil(captured)
    }

    func test_explicit_trimsWhitespaceAndLowercases() async {
        let captured = await capture.captureFromExplicit("  KOLA_A3F9B7C2D8E1  ")
        XCTAssertEqual(captured, Self.validToken)
    }

    // MARK: - currentToken / consume

    func test_currentToken_returnsLatestStored() async {
        _ = await capture.captureFromExplicit(Self.validToken)
        let cur = await capture.currentToken()
        XCTAssertEqual(cur, Self.validToken)
    }

    func test_currentToken_nilWhenNeverCaptured() async {
        let cur = await capture.currentToken()
        XCTAssertNil(cur)
    }

    func test_consume_clearsKeychain() async {
        _ = await capture.captureFromExplicit(Self.validToken)
        await capture.consume()
        let cur = await capture.currentToken()
        XCTAssertNil(cur)
    }
}

// MARK: - Test fakes

/// In-memory PasteboardSource. Lets tests drive the pasteboard without UIPasteboard.
private actor FakePasteboard: PasteboardSource {
    private var current: String?
    func setString(_ value: String?) { current = value }
    func currentString() async -> String? { current }
}
