// BiometricsService.swift  (Phase 6 · U45 → iter-2 hardened)
// Face ID / Touch ID confirmation for money-path actions. Wraps
// `LAContext` behind a `@MainActor` protocol so ViewModels can be
// exercised against a `FakeBiometricsService` without spinning up
// the real system prompt.
//
// Policy: `.deviceOwnerAuthenticationWithBiometrics` (biometrics
// only, no fallback to passcode). The Send flow handles
// `.userFallback` separately; in iter-2 it surfaces as
// `SendError.sessionExpired` so the UI shows "Sign in again".
//
// Iter-2 closes:
//   • W2 / OO-003 — distinct `.authFailed` case; not collapsed into
//     `.userCancel`. Single-attempt failure (Face ID didn't match)
//     surfaces as `.authFailed` so the banner reads "Face ID didn't
//     match. Try again." rather than the silent cancel UX.
//   • W3 / OO-004 — `BiometricsService` is `@MainActor`. The fake is
//     a `@MainActor final class` matching production isolation.
//   • W14 / API-005 — `BiometricsIntent` enum drives the reason
//     string so call sites don't hand-roll English strings.
//
// Info.plist key: `NSFaceIDUsageDescription` is wired (see
// `ios/Kolaleaf/Info.plist`) — adding biometric work without it would
// crash the first call on a Face ID device.

import Foundation
import LocalAuthentication

public enum BiometricsResult: Equatable, Sendable {
    /// User passed the biometric check.
    case success
    /// User tapped Cancel on the LAContext prompt.
    case userCancel
    /// User tapped "Use Passcode" — we don't fall back automatically
    /// because money-handling requires explicit policy alignment.
    case userFallback
    /// Too many failed biometric attempts; device is locked out and
    /// requires passcode to unlock. SendView surfaces "Sign in again
    /// to retry" + escalation path.
    case lockedOut
    /// Single Face ID mismatch. Distinct from `.userCancel` so the
    /// banner can encourage a retry (W2 / OO-003).
    case authFailed
    /// No biometrics enrolled on device. SendView falls back to a
    /// re-keyed transfer confirmation prompt (TODO Phase 7).
    case notEnrolled
    /// Device has no biometric hardware OR biometrics are disabled
    /// in Settings → Face ID & Passcode. Same fallback as notEnrolled.
    case noHardware
    /// Underlying LAContext error that doesn't fit the above cases.
    case unknownError(String)
}

/// Why the app is asking for biometrics. Resolved to a localised
/// prompt string internally so call sites don't hand-roll English.
public enum BiometricsIntent: Equatable, Sendable {
    case confirmTransfer
    case unlockApp

    public var localizedReason: String {
        switch self {
        case .confirmTransfer: return "Confirm your transfer"
        case .unlockApp:       return "Unlock Kolaleaf"
        }
    }
}

@MainActor
public protocol BiometricsService: Sendable {
    func authenticate(intent: BiometricsIntent) async -> BiometricsResult
}

public extension BiometricsService {
    /// Back-compat shim. Old `authenticate(reason:)` call-sites can
    /// keep compiling while we migrate to the intent-based API.
    func authenticate(reason: String) async -> BiometricsResult {
        _ = reason
        return await authenticate(intent: .confirmTransfer)
    }
}

/// Production implementation wrapping `LAContext`.
@MainActor
public struct LABiometricsService: BiometricsService {

    public init() {}

    public func authenticate(intent: BiometricsIntent) async -> BiometricsResult {
        let context = LAContext()
        // Disable the system's automatic "Use Passcode" fallback so
        // the user explicitly chooses biometrics. They can still tap
        // Cancel; we surface that as `.userCancel`.
        context.localizedFallbackTitle = ""

        var policyError: NSError?
        let canEvaluate = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &policyError
        )
        if !canEvaluate {
            if let policyError {
                return Self.map(policyError)
            }
            return .unknownError("canEvaluatePolicy returned false")
        }

        do {
            let ok = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: intent.localizedReason
            )
            return ok ? .success : .unknownError("evaluatePolicy returned false")
        } catch let laError as LAError {
            return Self.map(laError as NSError)
        } catch {
            return .unknownError(error.localizedDescription)
        }
    }

    /// Maps an LAError NSError code to our `BiometricsResult`. Exposed
    /// `internal` so unit tests can pin the contract without standing
    /// up an LAContext.
    static func map(_ nsError: NSError) -> BiometricsResult {
        guard nsError.domain == LAErrorDomain else {
            return .unknownError(nsError.localizedDescription)
        }
        let code = LAError.Code(rawValue: nsError.code) ?? .invalidContext
        switch code {
        case .userCancel, .appCancel, .systemCancel:
            return .userCancel
        case .userFallback:
            return .userFallback
        case .biometryLockout:
            return .lockedOut
        case .biometryNotEnrolled:
            return .notEnrolled
        case .biometryNotAvailable, .passcodeNotSet:
            return .noHardware
        case .authenticationFailed:
            // Iter-2 (W2 / OO-003): single mismatch is distinct from
            // userCancel — SendView surfaces "Face ID didn't match"
            // and re-arms the slide pill.
            return .authFailed
        default:
            return .unknownError(nsError.localizedDescription)
        }
    }
}

#if DEBUG
/// Test/preview fake. Returns a staged result without involving
/// `LAContext`. Switched in iter-2 from an `actor` to a
/// `@MainActor final class` so production-vs-fake isolation matches
/// (W3 / OO-004).
@MainActor
public final class FakeBiometricsService: BiometricsService {
    private var stagedResult: BiometricsResult
    private(set) public var callCount: Int = 0
    private(set) public var lastIntent: BiometricsIntent?

    public init(staged: BiometricsResult = .success) {
        self.stagedResult = staged
    }

    public func stage(_ result: BiometricsResult) {
        self.stagedResult = result
    }

    public func authenticate(intent: BiometricsIntent) async -> BiometricsResult {
        callCount += 1
        lastIntent = intent
        return stagedResult
    }

    /// Iter-1 shim. Tests reading `lastReason` keep compiling;
    /// the returned value is the localised reason string for the
    /// recorded intent.
    public var lastReason: String? {
        lastIntent?.localizedReason
    }
}
#endif
