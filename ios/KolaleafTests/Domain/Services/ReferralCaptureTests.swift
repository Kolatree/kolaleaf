// ReferralCaptureTests.swift  (Phase 1 · U91)
// Validates the actor-based ReferralCapture service. Each test builds its own
// fixture so Swift 6 strict-concurrency doesn't flag stored test properties as
// "sent" into actor inits.

import XCTest
@testable import Kolaleaf

final class ReferralCaptureTests: XCTestCase {

    private static let validToken = "kola_a3f9b7c2d8e1"
    private static let otherValid = "kola_z9y8x7w6v5u4"

    // MARK: - Fixture

    /// Per-test fixture. Constructed inside an `async` helper so the actor init
    /// runs in an isolated context — the local `defaults` and `keychain` are then
    /// safe to read on the test thread (Swift 6 strict-concurrency satisfied).
    private func makeFixture() async -> Fixture {
        let defaults = UserDefaults(suiteName: "kola.tests.\(UUID().uuidString)")!
        let keychain = Keychain(service: "com.kolaleaf.tests.\(UUID().uuidString)")
        let pasteboard = FakePasteboard()
        let capture = ReferralCapture(keychain: keychain, defaults: defaults, pasteboard: pasteboard)
        return Fixture(defaults: defaults, keychain: keychain, pasteboard: pasteboard, capture: capture)
    }

    /// Fixture wrapper. UserDefaults isn't formally Sendable in this SDK but is
    /// thread-safe in practice; `@unchecked Sendable` documents the audit.
    private struct Fixture: @unchecked Sendable {
        let defaults: UserDefaults
        let keychain: Keychain
        let pasteboard: FakePasteboard
        let capture: ReferralCapture
    }

    // MARK: - Pasteboard

    func test_pasteboardCapture_validToken_storesAndReturns() async throws {
        let f = await makeFixture()
        await f.pasteboard.setString(Self.validToken)

        let captured = await f.capture.captureFromPasteboardIfNotConsumed()

        XCTAssertEqual(captured, Self.validToken)
        let stored = try await f.keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertEqual(stored, Self.validToken)
        XCTAssertTrue(f.defaults.bool(forKey: "kola.referralPasteboardScanned"))
    }

    func test_pasteboardCapture_invalidFormat_returnsNil_doesNotStore() async {
        let f = await makeFixture()
        await f.pasteboard.setString("not-a-kola-token")

        let captured = await f.capture.captureFromPasteboardIfNotConsumed()

        XCTAssertNil(captured)
        let stored = try? await f.keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertNil(stored)
        XCTAssertTrue(f.defaults.bool(forKey: "kola.referralPasteboardScanned"))
    }

    func test_pasteboardCapture_secondCallAfterScan_returnsNil_evenIfPasteboardChanged() async {
        let f = await makeFixture()
        await f.pasteboard.setString("garbage-on-first-launch")
        _ = await f.capture.captureFromPasteboardIfNotConsumed()

        await f.pasteboard.setString(Self.validToken)
        let second = await f.capture.captureFromPasteboardIfNotConsumed()
        XCTAssertNil(second, "One-shot guard must prevent re-scanning the pasteboard")
    }

    func test_pasteboardCapture_emptyPasteboard_returnsNil() async {
        let f = await makeFixture()
        await f.pasteboard.setString(nil)

        let captured = await f.capture.captureFromPasteboardIfNotConsumed()

        XCTAssertNil(captured)
    }

    // MARK: - Universal link

    func test_universalLink_validToken_overridesPasteboard() async throws {
        let f = await makeFixture()
        await f.pasteboard.setString(Self.validToken)
        _ = await f.capture.captureFromPasteboardIfNotConsumed()

        let url = URL(string: "https://kolaleaf.com.au/refer/\(Self.otherValid)")!
        let captured = await f.capture.captureFromUniversalLink(url)

        XCTAssertEqual(captured, Self.otherValid)
        let stored = try await f.keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertEqual(stored, Self.otherValid, "Universal link must override pasteboard token")
    }

    func test_universalLink_invalidToken_returnsNil_doesNotOverride() async throws {
        let f = await makeFixture()
        await f.pasteboard.setString(Self.validToken)
        _ = await f.capture.captureFromPasteboardIfNotConsumed()

        let url = URL(string: "https://kolaleaf.com.au/refer/BAD-FORMAT")!
        let captured = await f.capture.captureFromUniversalLink(url)

        XCTAssertNil(captured)
        let stored = try await f.keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertEqual(stored, Self.validToken, "Bad universal link must not erase a stored token")
    }

    func test_universalLink_unrecognizedPath_returnsNil() async {
        let f = await makeFixture()
        let url = URL(string: "https://kolaleaf.com.au/something-else")!
        let captured = await f.capture.captureFromUniversalLink(url)
        XCTAssertNil(captured)
    }

    // MARK: - Explicit prompt

    func test_explicit_validToken_overridesEverything() async throws {
        let f = await makeFixture()
        await f.pasteboard.setString(Self.validToken)
        _ = await f.capture.captureFromPasteboardIfNotConsumed()
        _ = await f.capture.captureFromUniversalLink(URL(string: "https://kolaleaf.com.au/refer/\(Self.otherValid)")!)

        let third = "kola_111122223333"
        let captured = await f.capture.captureFromExplicit(third)

        XCTAssertEqual(captured, third)
        let stored = try await f.keychain.loadString(forKey: KeychainKeys.referralToken)
        XCTAssertEqual(stored, third)
    }

    func test_explicit_invalidToken_returnsNil() async {
        let f = await makeFixture()
        let captured = await f.capture.captureFromExplicit("nope")
        XCTAssertNil(captured)
    }

    func test_explicit_trimsWhitespaceAndLowercases() async {
        let f = await makeFixture()
        let captured = await f.capture.captureFromExplicit("  KOLA_A3F9B7C2D8E1  ")
        XCTAssertEqual(captured, Self.validToken)
    }

    // MARK: - currentToken / consume

    func test_currentToken_returnsLatestStored() async {
        let f = await makeFixture()
        _ = await f.capture.captureFromExplicit(Self.validToken)
        let cur = await f.capture.currentToken()
        XCTAssertEqual(cur, Self.validToken)
    }

    func test_currentToken_nilWhenNeverCaptured() async {
        let f = await makeFixture()
        let cur = await f.capture.currentToken()
        XCTAssertNil(cur)
    }

    func test_consume_clearsKeychain() async {
        let f = await makeFixture()
        _ = await f.capture.captureFromExplicit(Self.validToken)
        await f.capture.consume()
        let cur = await f.capture.currentToken()
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
