// KolaleafAppGateCompositionTests.swift  (D3 · Face ID gate composition)
//
// iter-2 review fix (API-404): the gate composition rule moved off
// `KolaleafApp` (where it took two non-independent booleans and the
// caller had to thread `hasActiveSession` into both) and onto
// `BiometricUnlockController.shouldShowGate(hasActiveSession:)` which
// composes the session flag against its own internal state.
//
// The truth-table coverage stays — we just drive the controller's
// preference + unlock flag instead of two parallel booleans. Tests
// remain pure-function (no SwiftUI host needed) and the controller
// stays the single source of truth for "is the gate visible?".

import XCTest
@testable import Kolaleaf

@MainActor
final class KolaleafAppGateCompositionTests: XCTestCase {

    private var defaults: UserDefaults!

    override func setUp() async throws {
        // Isolated UserDefaults suite so the controller's persistence
        // doesn't leak between tests.
        let suiteName = "kola.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        defaults = nil
    }

    // MARK: - Truth table

    /// Preference on + not yet unlocked this session + active session
    /// → the only state where the Face ID gate overlays RootCoordinator.
    func test_shouldShowGate_sessionAndLocked_returnsTrue() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        XCTAssertTrue(
            c.shouldShowGate(hasActiveSession: true),
            "Active session + lock engaged is the only state where the Face ID gate overlays RootCoordinator"
        )
    }

    /// After a successful unlock the gate must NOT re-overlay until
    /// the next background hop re-locks the controller.
    func test_shouldShowGate_sessionAndUnlocked_returnsFalse() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        _ = await c.unlock(using: FakeBiometricsService(staged: .success))
        XCTAssertFalse(
            c.shouldShowGate(hasActiveSession: true),
            "Once the user has Face-ID-unlocked the session, the gate must NOT re-overlay until the next background hop re-locks the controller"
        )
    }

    /// No active session means the user is on Welcome/SignIn — gating
    /// those screens behind Face ID would soft-lock first launch.
    func test_shouldShowGate_noSessionAndLocked_returnsFalse() {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        XCTAssertFalse(
            c.shouldShowGate(hasActiveSession: false),
            "No active session means the user is on Welcome/SignIn — gating those screens behind Face ID would soft-lock first launch"
        )
    }

    /// Cold launch into Welcome — no session, preference off, no gate.
    func test_shouldShowGate_noSessionAndUnlocked_returnsFalse() {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = false
        XCTAssertFalse(
            c.shouldShowGate(hasActiveSession: false),
            "Cold launch into Welcome — no session, no lock, no gate"
        )
    }

    /// Preference off + active session → no gate, even with a session
    /// alive. Closes the symmetric corner of the truth table.
    func test_shouldShowGate_sessionButPreferenceOff_returnsFalse() {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = false
        XCTAssertFalse(
            c.shouldShowGate(hasActiveSession: true),
            "Preference off must keep the gate hidden even with an active session"
        )
    }
}
