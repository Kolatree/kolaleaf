// BiometricUnlockController.swift  (Phase 11 · Face ID unlock)
//
// Holds the "require Face ID at launch" user preference + the
// session-level unlocked flag. The setting persists to UserDefaults
// (kola.faceIDUnlockEnabled). The unlock flag is in-memory only —
// every cold launch and every foreground-after-background restart
// re-locks if the setting is on.
//
// Why a dedicated controller (vs folding into AppState):
//   • The locked/unlocked state is orthogonal to session/KYC
//     concerns AppState tracks. Splitting keeps each Observable
//     focused; views that only care about lock state subscribe to
//     this controller alone.
//   • The persistence key is device-local — a different user's
//     iCloud Restore must not inherit the prior owner's Face ID
//     preference. That's the same threat model AppState already
//     handles for `kycSkipped`; we mirror its UserDefaults pattern.
//
// Lock semantics:
//   isLocked = faceIDUnlockEnabled
//            && hasActiveSession (caller-provided)
//            && !unlockedThisSession
//
// The caller supplies `hasActiveSession` so a logged-out user
// never sees the lock screen. `unlockedThisSession` resets to
// false on `lockForBackground()` (called from scenePhase ==
// .background) and on `clearForLogout()` (called from
// KolaleafApp.forceReauth).

import Foundation
import Observation

@MainActor
@Observable
public final class BiometricUnlockController {

    /// Persisted setting: when on, the lock screen gates every
    /// foreground entry of an authenticated session.
    public var faceIDUnlockEnabled: Bool {
        didSet {
            defaults.set(faceIDUnlockEnabled, forKey: Self.kFaceIDEnabled)
            // Flipping the setting on resets `unlockedThisSession` so
            // the next foreground entry presents the lock screen
            // (otherwise enabling the setting mid-session would only
            // take effect on the next launch — surprising UX).
            if faceIDUnlockEnabled { unlockedThisSession = false }
        }
    }

    /// True once the user has authenticated against Face ID this
    /// session. Reset on background / logout. Not persisted — the
    /// enrolled biometric stays on the device, only the per-session
    /// unlock flag is in-memory.
    public private(set) var unlockedThisSession: Bool = false

    private let defaults: UserDefaults
    private static let kFaceIDEnabled = "kola.faceIDUnlockEnabled"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.faceIDUnlockEnabled = defaults.bool(forKey: Self.kFaceIDEnabled)
    }

    /// Composite gate consumed by the lock view. Caller supplies
    /// the session flag so the controller doesn't need to know
    /// about AppState directly (testability + dependency direction).
    public func isLocked(hasActiveSession: Bool) -> Bool {
        guard hasActiveSession else { return false }
        return faceIDUnlockEnabled && !unlockedThisSession
    }

    /// Drive the LAContext prompt and flip `unlockedThisSession` on
    /// success. Failure cases (cancel / lockout / not enrolled) are
    /// returned verbatim so the gate view can surface the right
    /// banner.
    @discardableResult
    public func unlock(using service: any BiometricsService) async -> BiometricsResult {
        let result = await service.authenticate(intent: .unlockApp)
        if case .success = result {
            unlockedThisSession = true
        }
        return result
    }

    /// Re-lock on background — every cold launch / foreground hop
    /// of an authenticated session re-presents the gate when the
    /// setting is on.
    public func lockForBackground() {
        unlockedThisSession = false
    }

    /// Logout clears the per-session unlock flag too — a fresh
    /// sign-in for a different user shouldn't inherit the prior
    /// owner's already-unlocked state.
    public func clearForLogout() {
        unlockedThisSession = false
    }
}
