// BiometricUnlockController.swift  (Phase 11 · Face ID unlock)
//
// Holds the "require Face ID at launch" user preference + the
// session-level unlocked flag. The setting persists to UserDefaults
// (kola.faceIDUnlockEnabled). The first authenticated session on a
// Face-ID-capable device enables the preference automatically unless
// the user has already made an explicit choice. The unlock flag is
// in-memory only — every cold launch and every
// foreground-after-background restart re-locks if the setting is on.
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
    /// foreground entry of an authenticated session. Mutable so
    /// SwiftUI's `Toggle` can bind, but the explicit
    /// `setFaceIDUnlockEnabled(_:)` setter is the recommended path
    /// because its side effects (persist + invalidate
    /// `unlockedThisSession`) are visible at the call site rather
    /// than hidden in didSet (4-lens review fix · type-design-analyzer #16).
    public var faceIDUnlockEnabled: Bool {
        didSet { applyFaceIDPreferenceSideEffects() }
    }

    /// True once the user has explicitly accepted the default or
    /// changed the Security toggle. Keeps the product default
    /// "protect logged-in sessions with Face ID when available" from
    /// overriding a user who turned the feature off.
    public private(set) var faceIDPreferenceConfigured: Bool

    /// Explicit setter — equivalent to assigning `faceIDUnlockEnabled`
    /// but documents the side effects at the call site. Toggle UI
    /// can still use the binding; programmatic mutations (settings
    /// migration, debug overrides) should go through here.
    public func setFaceIDUnlockEnabled(_ value: Bool) {
        // Direct assignment triggers didSet, which handles the
        // persistence + per-session invalidation in one place.
        faceIDUnlockEnabled = value
    }

    private func applyFaceIDPreferenceSideEffects() {
        defaults.set(faceIDUnlockEnabled, forKey: Self.kFaceIDEnabled)
        faceIDPreferenceConfigured = true
        defaults.set(true, forKey: Self.kFaceIDPreferenceConfigured)
        // Flipping the setting on resets `unlockedThisSession` so
        // the next foreground entry presents the lock screen
        // (otherwise enabling the setting mid-session would only
        // take effect on the next launch — surprising UX).
        if faceIDUnlockEnabled { unlockedThisSession = false }
    }

    /// True once the user has authenticated against Face ID this
    /// session. Reset on background / logout. Not persisted — the
    /// enrolled biometric stays on the device, only the per-session
    /// unlock flag is in-memory.
    public private(set) var unlockedThisSession: Bool = false

    /// 4-lens review fix (pr-test-analyzer #4): generation counter
    /// guards against the async race where `lockForBackground()`
    /// fires while an in-flight `unlock(using:)` is awaiting
    /// LAContext. Without this, the unlock continuation can land
    /// AFTER the background lock and set `unlockedThisSession =
    /// true` against the new (re-locked) session — leaking a Face
    /// ID success across a background hop.
    private var unlockGeneration: Int = 0

    private let defaults: UserDefaults
    private static let kFaceIDEnabled = "kola.faceIDUnlockEnabled"
    private static let kFaceIDPreferenceConfigured = "kola.faceIDUnlockPreferenceConfigured"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.faceIDUnlockEnabled = defaults.bool(forKey: Self.kFaceIDEnabled)
        self.faceIDPreferenceConfigured =
            defaults.bool(forKey: Self.kFaceIDPreferenceConfigured)
            || defaults.object(forKey: Self.kFaceIDEnabled) != nil
    }

    /// Enables app unlock by default once an authenticated session
    /// exists on a device that can evaluate biometrics. This is
    /// intentionally a no-op after the user has made an explicit
    /// choice, so the Security toggle remains an opt-out.
    public func enableByDefaultIfUnsetAndAvailable(using service: any BiometricsService) {
        guard !faceIDPreferenceConfigured else { return }
        guard case .available = service.availability() else { return }
        setFaceIDUnlockEnabled(true)
    }

    /// Composite gate consumed by the lock view. Caller supplies
    /// the session flag so the controller doesn't need to know
    /// about AppState directly (testability + dependency direction).
    public func isLocked(hasActiveSession: Bool) -> Bool {
        guard hasActiveSession else { return false }
        return faceIDUnlockEnabled && !unlockedThisSession
    }

    /// iter-2 review fix (API-404): the Face ID gate composition rule
    /// lives on the controller rather than the SwiftUI app shell. The
    /// caller supplies the session flag; the controller composes it
    /// against its own lock state. Keeps `rootContent` a single
    /// boolean read and lets the truth-table tests drive controller
    /// state (preference + unlock flag) instead of two non-independent
    /// booleans that the caller has to keep in sync.
    public func shouldShowGate(hasActiveSession: Bool) -> Bool {
        hasActiveSession && isLocked(hasActiveSession: hasActiveSession)
    }

    /// Drive the LAContext prompt and flip `unlockedThisSession` on
    /// success. Failure cases (cancel / lockout / not enrolled) are
    /// returned verbatim so the gate view can surface the right
    /// banner.
    ///
    /// 4-lens review fix (silent-failure-hunter): emit a DEBUG log
    /// for non-success results so Sentry / Console.app correlate the
    /// gate's "stuck in a re-prompt loop" symptom with the actual
    /// LAError code on iOS 18 betas where biometryNotAvailable
    /// surfaced unexpectedly. `.userCancel` is omitted from the log
    /// because it's the expected first-tap-cancel UX and would drown
    /// the signal.
    @discardableResult
    public func unlock(using service: any BiometricsService) async -> BiometricsResult {
        // 4-lens review fix (pr-test-analyzer #4): snapshot the
        // generation at entry. If `lockForBackground()` or
        // `clearForLogout()` runs while we're awaiting the LAContext
        // prompt, the generation increments and our post-await flip
        // becomes a no-op — the user must Face-ID again on next
        // foreground.
        let entryGeneration = unlockGeneration
        let result = await service.authenticate(intent: .unlockApp)
        guard entryGeneration == unlockGeneration else {
            // Race: a background hop / logout invalidated this
            // unlock attempt. Return the LAContext result so the
            // caller knows what happened, but don't flip the flag.
            #if DEBUG
            print("[BiometricUnlockController] unlock result discarded (stale generation \(entryGeneration) vs \(unlockGeneration))")
            #endif
            return result
        }
        if case .success = result {
            unlockedThisSession = true
        } else {
            #if DEBUG
            switch result {
            case .userCancel, .userFallback, .success:
                break
            case .authFailed, .lockedOut, .notEnrolled, .noHardware:
                print("[BiometricUnlockController] unlock failed: \(result)")
            case .unknownError(let message):
                print("[BiometricUnlockController] unlock unknown error: \(message)")
            }
            #endif
        }
        return result
    }

    /// Re-lock on background — every cold launch / foreground hop
    /// of an authenticated session re-presents the gate when the
    /// setting is on. Increments the generation counter so any
    /// in-flight `unlock(using:)` that resumes after this point
    /// becomes a no-op.
    public func lockForBackground() {
        unlockedThisSession = false
        unlockGeneration &+= 1
    }

    /// Logout clears the per-session unlock flag too — a fresh
    /// sign-in for a different user shouldn't inherit the prior
    /// owner's already-unlocked state. Bumps the generation so an
    /// in-flight unlock from the previous session can't flip the
    /// flag on the new session.
    public func clearForLogout() {
        unlockedThisSession = false
        unlockGeneration &+= 1
    }
}
