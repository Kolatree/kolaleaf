// BiometricUnlockControllerTests.swift  (Phase 11 · Face ID unlock)
//
// Locks the preference + per-session unlock semantics. The controller
// is thin glue around UserDefaults + a Bool, but each behaviour has
// a user-visible consequence (gate appears / hides, persists across
// launches, doesn't bleed across logout, etc.) so each gets a test.

import XCTest
@testable import Kolaleaf

@MainActor
final class BiometricUnlockControllerTests: XCTestCase {

    private var defaults: UserDefaults!

    override func setUp() async throws {
        let suiteName = "kola.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        defaults = nil
    }

    // MARK: - Preference persistence

    func test_preferenceDefaultsToOff() {
        let c = BiometricUnlockController(defaults: defaults)
        XCTAssertFalse(c.faceIDUnlockEnabled)
    }

    func test_preferencePersistsAcrossInstances() {
        let c1 = BiometricUnlockController(defaults: defaults)
        c1.faceIDUnlockEnabled = true
        let c2 = BiometricUnlockController(defaults: defaults)
        XCTAssertTrue(c2.faceIDUnlockEnabled,
                      "Setting must persist via UserDefaults so a re-init reads the prior value")
    }

    func test_enablingPreferenceResetsUnlockedFlag() async {
        let c = BiometricUnlockController(defaults: defaults)
        // Simulate prior session unlock
        let fake = FakeBiometricsService(staged: .success)
        c.faceIDUnlockEnabled = true
        _ = await c.unlock(using: fake)
        XCTAssertTrue(c.unlockedThisSession)
        // Toggling off then back on must lock again
        c.faceIDUnlockEnabled = false
        c.faceIDUnlockEnabled = true
        XCTAssertFalse(c.unlockedThisSession,
                       "Flipping the preference on must re-lock so the gate re-prompts")
    }

    // MARK: - isLocked composite

    func test_isLockedFalseWithoutSession() {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        XCTAssertFalse(c.isLocked(hasActiveSession: false),
                       "Logged-out users must never see the lock screen")
    }

    func test_isLockedFalseWhenPreferenceOff() {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = false
        XCTAssertFalse(c.isLocked(hasActiveSession: true))
    }

    func test_isLockedTrueWhenPreferenceOnAndNotUnlocked() {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        XCTAssertTrue(c.isLocked(hasActiveSession: true))
    }

    // MARK: - unlock

    func test_unlockSuccessFlipsTheFlag() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        let fake = FakeBiometricsService(staged: .success)
        let result = await c.unlock(using: fake)
        XCTAssertEqual(result, .success)
        XCTAssertTrue(c.unlockedThisSession)
        XCTAssertFalse(c.isLocked(hasActiveSession: true),
                       "isLocked must become false after a successful unlock")
    }

    func test_unlockFailureLeavesLocked() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        let fake = FakeBiometricsService(staged: .userCancel)
        let result = await c.unlock(using: fake)
        XCTAssertEqual(result, .userCancel)
        XCTAssertFalse(c.unlockedThisSession)
        XCTAssertTrue(c.isLocked(hasActiveSession: true))
    }

    func test_lockedOutResultDoesNotMarkUnlocked() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        let fake = FakeBiometricsService(staged: .lockedOut)
        _ = await c.unlock(using: fake)
        XCTAssertFalse(c.unlockedThisSession)
    }

    // MARK: - Lifecycle

    func test_lockForBackgroundResetsUnlockedFlag() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        _ = await c.unlock(using: FakeBiometricsService(staged: .success))
        XCTAssertTrue(c.unlockedThisSession)
        c.lockForBackground()
        XCTAssertFalse(c.unlockedThisSession,
                       "Background must re-lock so the next foreground entry re-prompts")
    }

    func test_clearForLogoutResetsUnlockedFlag() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        _ = await c.unlock(using: FakeBiometricsService(staged: .success))
        c.clearForLogout()
        XCTAssertFalse(c.unlockedThisSession)
    }

    func test_clearForLogoutDoesNotResetPreference() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        c.clearForLogout()
        XCTAssertTrue(c.faceIDUnlockEnabled,
                      "Logout must not erase the device-local Face ID setting")
    }
}
