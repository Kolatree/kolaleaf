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
        XCTAssertFalse(c.faceIDPreferenceConfigured)
    }

    func test_preferencePersistsAcrossInstances() {
        let c1 = BiometricUnlockController(defaults: defaults)
        c1.faceIDUnlockEnabled = true
        let c2 = BiometricUnlockController(defaults: defaults)
        XCTAssertTrue(c2.faceIDUnlockEnabled,
                      "Setting must persist via UserDefaults so a re-init reads the prior value")
        XCTAssertTrue(c2.faceIDPreferenceConfigured)
    }

    func test_setFaceIDUnlockEnabled_marksPreferenceConfigured() {
        let c = BiometricUnlockController(defaults: defaults)
        c.setFaceIDUnlockEnabled(false)

        XCTAssertFalse(c.faceIDUnlockEnabled)
        XCTAssertTrue(c.faceIDPreferenceConfigured,
                      "An explicit off choice must be remembered across launches")
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

    // MARK: - Pre-passcode migration

    func test_resetPrePasscodeLock_clearsPersistedPreference() {
        let c = BiometricUnlockController(defaults: defaults)
        c.setFaceIDUnlockEnabled(true)

        c.resetPrePasscodeLock()

        XCTAssertFalse(c.faceIDUnlockEnabled)
        XCTAssertFalse(c.faceIDPreferenceConfigured)
        XCTAssertFalse(c.shouldShowGate(hasActiveSession: true))
        let c2 = BiometricUnlockController(defaults: defaults)
        XCTAssertFalse(c2.faceIDUnlockEnabled)
        XCTAssertFalse(c2.faceIDPreferenceConfigured)
    }

    func test_resetPrePasscodeLock_invalidatesInFlightUnlock() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.setFaceIDUnlockEnabled(true)
        let pausable = PausableBiometricsService()
        let unlockTask = Task { await c.unlock(using: pausable) }
        await Task.yield()
        await pausable.waitUntilAuthenticating()

        c.resetPrePasscodeLock()
        pausable.resume(with: .success)
        _ = await unlockTask.value

        XCTAssertFalse(c.faceIDUnlockEnabled)
        XCTAssertFalse(c.unlockedThisSession)
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

    // MARK: - Async race (4-lens review · pr-test-analyzer #4)

    /// A `lockForBackground()` that fires while `unlock(using:)` is
    /// awaiting the LAContext prompt MUST invalidate the in-flight
    /// authentication. Without the generation guard, the unlock's
    /// post-await flip would land AFTER the background reset and
    /// leak a Face-ID success across the background hop.
    func test_unlockDuringBackgroundHop_doesNotLeakAcrossSession() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true

        // PausableBiometricsService blocks on a continuation until
        // resume() is called. Lets us interleave lockForBackground()
        // between the prompt start and its resolution.
        let pausable = PausableBiometricsService()
        let unlockTask = Task { await c.unlock(using: pausable) }

        // Wait for the unlock to enter the await — at least one
        // yield to give Task scheduling a chance to land.
        await Task.yield()
        await pausable.waitUntilAuthenticating()

        // Background hop while authenticating.
        c.lockForBackground()

        // Resume the prompt with a SUCCESS result. Without the
        // generation guard, this would set unlockedThisSession=true
        // against the now-locked session.
        pausable.resume(with: .success)
        _ = await unlockTask.value

        XCTAssertFalse(c.unlockedThisSession,
                       "Unlock that started before background MUST NOT flip the flag after lockForBackground")
        XCTAssertTrue(c.isLocked(hasActiveSession: true),
                      "Gate must still show after the discarded unlock")
    }

    func test_unlockDuringLogout_doesNotLeakIntoNewSession() async {
        let c = BiometricUnlockController(defaults: defaults)
        c.faceIDUnlockEnabled = true
        let pausable = PausableBiometricsService()
        let unlockTask = Task { await c.unlock(using: pausable) }
        await Task.yield()
        await pausable.waitUntilAuthenticating()

        c.clearForLogout()
        pausable.resume(with: .success)
        _ = await unlockTask.value

        XCTAssertFalse(c.unlockedThisSession,
                       "Unlock from the prior session MUST NOT flip the flag after clearForLogout")
    }
}

/// Test-only BiometricsService that blocks `authenticate(intent:)`
/// on an internal continuation. Lets the race tests interleave
/// `lockForBackground()` between the prompt-start and the
/// prompt-resolve so the controller's generation guard is
/// exercised deterministically.
@MainActor
final class PausableBiometricsService: BiometricsService {
    private var continuation: CheckedContinuation<BiometricsResult, Never>?
    private var authenticatingContinuation: CheckedContinuation<Void, Never>?
    private var isAuthenticating: Bool = false

    func availability() -> BiometricsAvailability {
        .available
    }

    func authenticate(intent: BiometricsIntent) async -> BiometricsResult {
        isAuthenticating = true
        // Wake any test waiting for the prompt to enter the await.
        authenticatingContinuation?.resume()
        authenticatingContinuation = nil
        return await withCheckedContinuation { c in
            self.continuation = c
        }
    }

    /// Suspends until the service is actually inside the
    /// `authenticate(...)` await, so the test can interleave
    /// state changes deterministically.
    func waitUntilAuthenticating() async {
        guard !isAuthenticating else { return }
        await withCheckedContinuation { c in
            self.authenticatingContinuation = c
        }
    }

    func resume(with result: BiometricsResult) {
        continuation?.resume(returning: result)
        continuation = nil
        isAuthenticating = false
    }
}
