// KolaleafAppGateCompositionTests.swift  (D3 · Face ID gate composition)
//
// Pure-function test of `KolaleafApp.shouldShowGate(hasActiveSession:isLocked:)`,
// extracted in D3 from `rootContent`'s ZStack composition. The
// individual pieces (`AppState.hasActiveSession`,
// `BiometricUnlockController.isLocked(hasActiveSession:)`) are already
// well-covered. This file locks the COMPOSITION rule between them so
// a future change to the gate's policy (e.g. emergency-call exemption,
// per-screen override) lands here as a visible test diff rather than
// a silent ZStack rewrite.
//
// No ViewInspector needed — the function is a pure boolean predicate.

import XCTest
@testable import Kolaleaf

@MainActor
final class KolaleafAppGateCompositionTests: XCTestCase {

    // MARK: - Truth table

    func test_shouldShowGate_sessionAndLocked_returnsTrue() {
        XCTAssertTrue(
            KolaleafApp.shouldShowGate(hasActiveSession: true, isLocked: true),
            "Active session + lock engaged is the only state where the Face ID gate overlays RootCoordinator"
        )
    }

    func test_shouldShowGate_sessionAndUnlocked_returnsFalse() {
        XCTAssertFalse(
            KolaleafApp.shouldShowGate(hasActiveSession: true, isLocked: false),
            "Once the user has Face-ID-unlocked the session, the gate must NOT re-overlay until the next background hop re-locks the controller"
        )
    }

    func test_shouldShowGate_noSessionAndLocked_returnsFalse() {
        XCTAssertFalse(
            KolaleafApp.shouldShowGate(hasActiveSession: false, isLocked: true),
            "No active session means the user is on Welcome/SignIn — gating those screens behind Face ID would soft-lock first launch"
        )
    }

    func test_shouldShowGate_noSessionAndUnlocked_returnsFalse() {
        XCTAssertFalse(
            KolaleafApp.shouldShowGate(hasActiveSession: false, isLocked: false),
            "Cold launch into Welcome — no session, no lock, no gate"
        )
    }
}
