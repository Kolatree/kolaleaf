// AppStateTests.swift  (Phase 0 · U8 + U76b)
// Validates the idle-timer state machine and clearForLogout invariants.
//
// Uses a per-test UserDefaults suite so persistence doesn't bleed between tests.

import XCTest
@testable import Kolaleaf

@MainActor
final class AppStateTests: XCTestCase {

    private var defaults: UserDefaults!

    override func setUp() async throws {
        let suiteName = "kola.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        defaults?.removePersistentDomain(forName: defaults.dictionaryRepresentation().description)
        defaults = nil
    }

    // MARK: - shouldForceReauth

    func test_shouldForceReauth_returnsFalseWithoutSession() {
        let s = AppState(defaults: defaults, arguments: [])
        XCTAssertFalse(s.shouldForceReauth())
    }

    func test_shouldForceReauth_falseWhenInteractionRecent() {
        let s = makeAuthed()
        XCTAssertFalse(s.shouldForceReauth())
    }

    func test_shouldForceReauth_trueAfterForegroundIdleThreshold() {
        let s = makeAuthed()
        // Backdate interaction past the 14-min threshold.
        defaults.set(Date().addingTimeInterval(-(15 * 60)),
                     forKey: "kola.lastInteractionAt")
        // Force a fresh AppState read of the persisted timestamp.
        let s2 = makeAuthed()
        _ = s
        XCTAssertTrue(s2.shouldForceReauth())
    }

    func test_shouldForceReauth_trueAfterBackgroundExceedsThreshold() {
        let s = makeAuthed()
        // Simulate a >15min background.
        defaults.set(Date().addingTimeInterval(-(20 * 60)),
                     forKey: "kola.lastBackgroundedAt")
        let s2 = makeAuthed()
        _ = s
        XCTAssertTrue(s2.shouldForceReauth())
    }

    func test_shouldForceReauth_extendsTo90mWhileTransferInFlight() {
        let s = makeAuthed()
        s.activeTransfer = ActiveTransfer(
            id: "tx1", status: .processingNgn,
            audAmount: 100, ngnAmount: 100_000, recipientId: "r1"
        )
        // 30 min idle with in-flight transfer should NOT trip — threshold is 90m.
        defaults.set(Date().addingTimeInterval(-(30 * 60)),
                     forKey: "kola.lastInteractionAt")
        let s2 = makeAuthed()
        s2.currentUser = s.currentUser
        s2.activeTransfer = s.activeTransfer
        XCTAssertFalse(s2.shouldForceReauth())
    }

    // MARK: - markForegrounded does NOT bump interaction (r2 fix #3)

    func test_markForegrounded_doesNotResetIdleClock() {
        let s = makeAuthed()
        // Simulate 13 min of foreground idle.
        let backdate = Date().addingTimeInterval(-(13 * 60))
        defaults.set(backdate, forKey: "kola.lastInteractionAt")
        let s2 = makeAuthed()
        s2.currentUser = s.currentUser

        // Briefly background and foreground.
        s2.markBackgrounded()
        s2.markForegrounded()

        // Idle clock should still reflect the original 13-min backdate, not be reset.
        XCTAssertEqual(s2.lastInteractionAt.timeIntervalSinceReferenceDate,
                       backdate.timeIntervalSinceReferenceDate,
                       accuracy: 0.01)
    }

    // MARK: - clearForLogout

    func test_clearForLogout_nullsAllSessionFields() {
        let s = makeAuthed()
        s.kycStatus = .verified
        s.activeTransfer = ActiveTransfer(
            id: "tx1", status: .awaitingAud,
            audAmount: 100, ngnAmount: 100_000, recipientId: "r1"
        )
        s.pendingTwoFactor = PendingTwoFactor(method: "TOTP", blockedReason: "test")

        s.clearForLogout()

        XCTAssertNil(s.currentUser)
        XCTAssertEqual(s.kycStatus, .unknown)
        XCTAssertNil(s.activeTransfer)
        XCTAssertNil(s.pendingTwoFactor)
        XCTAssertNil(s.lastBackgroundedAt)
        // P1 fix (Phase 1 review): lastInteractionAt is now distantPast so any
        // accidental rehydration that sets currentUser without going through
        // forceReauth still trips shouldForceReauth on the next active scene.
        XCTAssertEqual(s.lastInteractionAt, .distantPast,
                       "clearForLogout should mark lastInteractionAt as fully expired")
    }

    // MARK: - bumpInteraction persists

    func test_bumpInteraction_persistsAcrossReinit() {
        let s = AppState(defaults: defaults, arguments: [])
        s.bumpInteraction()
        let bumpedAt = s.lastInteractionAt

        // Recreate AppState from same defaults — should restore the bumped timestamp.
        let s2 = AppState(defaults: defaults)
        XCTAssertEqual(s2.lastInteractionAt.timeIntervalSinceReferenceDate,
                       bumpedAt.timeIntervalSinceReferenceDate,
                       accuracy: 0.01)
    }

    // MARK: - Helpers

    private func makeAuthed() -> AppState {
        let s = AppState(defaults: defaults, arguments: [])
        s.currentUser = CurrentUser(
            id: "user_1", displayName: "Test", legalName: nil,
            email: "test@example.com", phone: nil
        )
        return s
    }
}

// MARK: - TransferStatus Codable

final class TransferStatusCodableTests: XCTestCase {
    func test_decodesAllKnownPrismaCases() throws {
        let cases: [(String, TransferStatus)] = [
            ("CREATED", .created),
            ("AWAITING_AUD", .awaitingAud),
            ("AUD_RECEIVED", .audReceived),
            ("PROCESSING_NGN", .processingNgn),
            ("NGN_SENT", .ngnSent),
            ("COMPLETED", .completed),
            ("NGN_FAILED", .ngnFailed),
            ("NGN_RETRY", .ngnRetry),
            ("NEEDS_MANUAL", .needsManual),
            ("REFUNDED", .refunded),
            ("EXPIRED", .expired),
            ("CANCELLED", .cancelled),
            ("FLOAT_INSUFFICIENT", .floatInsufficient),
        ]
        for (raw, expected) in cases {
            let json = "\"\(raw)\"".data(using: .utf8)!
            let decoded = try JSONDecoder().decode(TransferStatus.self, from: json)
            XCTAssertEqual(decoded, expected, "Failed for \(raw)")
        }
    }

    func test_decodesUnknownToUnknownSentinel() throws {
        let json = "\"FUTURE_STATUS_FROM_BACKEND\"".data(using: .utf8)!
        let decoded = try JSONDecoder().decode(TransferStatus.self, from: json)
        XCTAssertEqual(decoded, .unknown)
    }

    func test_unknownIsInFlight_false() {
        let t = ActiveTransfer(id: "x", status: .unknown,
                               audAmount: 0, ngnAmount: 0, recipientId: "r")
        XCTAssertFalse(t.isInFlight)
    }
}
