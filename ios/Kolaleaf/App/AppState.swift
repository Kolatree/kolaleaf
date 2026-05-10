// AppState.swift  (Phase 0 · U8 + U76b primitives)
// Central observable state container, MainActor-isolated.
//
// r2-review fixes · 2026-05-09:
//   • #3 (correctness): markForegrounded() no longer bumps interaction; the foreground
//     idle check is now reachable. Caller must compute shouldForceReauth() BEFORE
//     marking the scene foregrounded.
//   • #5 (correctness): TransferStatus has a custom Decodable that maps unknown
//     rawValues to .unknown, fulfilling the forward-compat contract.
//   • #11 (concurrency): @MainActor isolation makes the [weak appState] capture safe
//     under -strict-concurrency=complete.
//   • #16 (reliability): lastInteractionAt + lastBackgroundedAt persist to UserDefaults
//     so cold launch after force-quit honors the idle window correctly.

import Foundation
import Observation

@MainActor
@Observable
public final class AppState {

    // MARK: - Identity

    public var currentUser: CurrentUser?
    public var kycStatus: KycStatus = .unknown
    public var hasActiveSession: Bool { currentUser != nil }

    // MARK: - Active flow

    public var activeTransfer: ActiveTransfer?

    // MARK: - Network

    public var isReachable: Bool = true

    // MARK: - Idle tracking (U76b)
    //
    // Backend session TTL is 15 min sliding (src/lib/auth/sessions.ts:8 SESSION_EXPIRY_MINUTES = 15).
    // iOS idle threshold sits one minute below to align.
    //
    // U76b3: per-instance thresholds may be overridden via launch args
    // (`--idle-threshold=<n>`, `--background-idle=<n>`, `--inflight-idle=<n>`)
    // for UI tests that need to compress the clock. DEBUG only — release builds
    // ignore the args.

    /// Production default: foreground idle window (14 min, one minute below backend TTL).
    public static let defaultIdleThresholdSeconds: TimeInterval = 14 * 60
    /// Production default: background idle window (15 min, matches backend TTL).
    public static let defaultBackgroundIdleSeconds: TimeInterval = 15 * 60
    /// Production default: extended idle while a transfer is in-flight (90 min).
    public static let defaultInflightIdleSeconds: TimeInterval = 90 * 60

    /// Legacy aliases preserved for callers that still read static thresholds.
    /// New code should read instance properties so tests can override via launch args.
    public static let idleThresholdSeconds: TimeInterval = defaultIdleThresholdSeconds
    public static let backgroundIdleSeconds: TimeInterval = defaultBackgroundIdleSeconds
    public static let inflightIdleSeconds: TimeInterval = defaultInflightIdleSeconds

    /// Per-instance foreground idle threshold (seconds). May differ from the static
    /// default in DEBUG builds when `--idle-threshold=<n>` is passed.
    public let idleThresholdSeconds: TimeInterval
    /// Per-instance background idle threshold. DEBUG override: `--background-idle=<n>`.
    public let backgroundIdleSeconds: TimeInterval
    /// Per-instance in-flight extended idle threshold. DEBUG override: `--inflight-idle=<n>`.
    public let inflightIdleSeconds: TimeInterval

    private(set) public var lastInteractionAt: Date
    private(set) public var lastBackgroundedAt: Date?

    // Keys used to persist across cold launches.
    private static let kLastInteractionAt = "kola.lastInteractionAt"
    private static let kLastBackgroundedAt = "kola.lastBackgroundedAt"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard,
                arguments: [String] = ProcessInfo.processInfo.arguments) {
        self.defaults = defaults

        #if DEBUG
        self.idleThresholdSeconds = Self.parseLaunchArg(
            arguments, key: "--idle-threshold=",
            default: Self.defaultIdleThresholdSeconds)
        self.backgroundIdleSeconds = Self.parseLaunchArg(
            arguments, key: "--background-idle=",
            default: Self.defaultBackgroundIdleSeconds)
        self.inflightIdleSeconds = Self.parseLaunchArg(
            arguments, key: "--inflight-idle=",
            default: Self.defaultInflightIdleSeconds)
        #else
        self.idleThresholdSeconds = Self.defaultIdleThresholdSeconds
        self.backgroundIdleSeconds = Self.defaultBackgroundIdleSeconds
        self.inflightIdleSeconds = Self.defaultInflightIdleSeconds
        #endif

        // Restore persisted state so cold launch after force-quit honors prior idle.
        let restoredInteraction = (defaults.object(forKey: Self.kLastInteractionAt) as? Date)
            ?? Date()
        let restoredBackground = defaults.object(forKey: Self.kLastBackgroundedAt) as? Date
        self.lastInteractionAt = restoredInteraction
        self.lastBackgroundedAt = restoredBackground
    }

    /// Parses `--<key>=<n>` from a launch-args array. Clamps to `[1, 3600]` seconds.
    /// Returns `fallback` when the arg is missing, malformed, or out-of-clamp.
    private static func parseLaunchArg(_ args: [String],
                                       key: String,
                                       default fallback: TimeInterval) -> TimeInterval {
        guard let arg = args.first(where: { $0.hasPrefix(key) }),
              let value = TimeInterval(arg.dropFirst(key.count)),
              value.isFinite else {
            return fallback
        }
        return min(max(value, 1), 3600)
    }

    // MARK: - Mutations

    /// Reset on user touch, successful API call, or APNS state-change push for the active transfer.
    public func bumpInteraction() {
        lastInteractionAt = Date()
        defaults.set(lastInteractionAt, forKey: Self.kLastInteractionAt)
    }

    public func markBackgrounded() {
        lastBackgroundedAt = Date()
        defaults.set(lastBackgroundedAt, forKey: Self.kLastBackgroundedAt)
    }

    /// Does NOT bump interaction (per r2 fix #3 + #8) — the caller must check
    /// `shouldForceReauth()` BEFORE invoking this so the idle clock is preserved.
    public func markForegrounded() {
        lastBackgroundedAt = nil
        defaults.removeObject(forKey: Self.kLastBackgroundedAt)
    }

    /// True when the iOS-side idle window has elapsed and the app should force re-auth.
    public func shouldForceReauth() -> Bool {
        // Must have an active session for "force re-auth" to even be meaningful.
        guard hasActiveSession else { return false }

        let now = Date()

        // Background path: any backgrounding longer than 15 min triggers re-auth.
        if let bg = lastBackgroundedAt, now.timeIntervalSince(bg) >= self.backgroundIdleSeconds {
            return true
        }

        // Foreground idle path. While a transfer is in-flight, extend window.
        let threshold: TimeInterval = (activeTransfer?.isInFlight == true)
            ? self.inflightIdleSeconds
            : self.idleThresholdSeconds
        return now.timeIntervalSince(lastInteractionAt) >= threshold
    }

    /// Clears all session state on logout.
    public func clearForLogout() {
        currentUser = nil
        kycStatus = .unknown
        activeTransfer = nil
        lastInteractionAt = Date()
        lastBackgroundedAt = nil
        defaults.set(lastInteractionAt, forKey: Self.kLastInteractionAt)
        defaults.removeObject(forKey: Self.kLastBackgroundedAt)
    }
}

// MARK: - Domain types referenced by AppState

public struct CurrentUser: Equatable, Sendable {
    public let id: String
    public let displayName: String?
    public let legalName: String?
    public let email: String?
    public let phone: String?

    public init(id: String, displayName: String?, legalName: String?, email: String?, phone: String?) {
        self.id = id
        self.displayName = displayName
        self.legalName = legalName
        self.email = email
        self.phone = phone
    }
}

public enum KycStatus: String, Equatable, Sendable {
    case unknown
    case notStarted = "NOT_STARTED"
    case processing = "PROCESSING"
    case approved   = "APPROVED"
    case softRejected = "SOFT_REJECTED"
    case underReview = "UNDER_REVIEW"
    case hardRejected = "HARD_REJECTED"
}

/// Tracks the user's currently-in-flight transfer, if any.
public struct ActiveTransfer: Equatable, Sendable {
    public let id: String
    public let status: TransferStatus
    public let audAmount: Decimal
    public let ngnAmount: Decimal
    public let recipientId: String

    public var isInFlight: Bool {
        switch status {
        case .completed, .cancelled, .expired, .refunded, .needsManual, .unknown:
            return false
        default:
            return true
        }
    }

    public init(id: String, status: TransferStatus, audAmount: Decimal, ngnAmount: Decimal, recipientId: String) {
        self.id = id
        self.status = status
        self.audAmount = audAmount
        self.ngnAmount = ngnAmount
        self.recipientId = recipientId
    }
}

/// Mirror of `enum TransferStatus` in `prisma/schema.prisma:26`. Custom Codable
/// maps unknown rawValues to `.unknown` so a future backend status doesn't break
/// decoding — that's the actual forward-compat contract (r2 fix #5).
public enum TransferStatus: String, Equatable, Sendable {
    case created           = "CREATED"
    case awaitingAud       = "AWAITING_AUD"
    case audReceived       = "AUD_RECEIVED"
    case processingNgn     = "PROCESSING_NGN"
    case ngnSent           = "NGN_SENT"
    case completed         = "COMPLETED"
    case ngnFailed         = "NGN_FAILED"
    case ngnRetry          = "NGN_RETRY"
    case needsManual       = "NEEDS_MANUAL"
    case refunded          = "REFUNDED"
    case expired           = "EXPIRED"
    case cancelled         = "CANCELLED"
    case floatInsufficient = "FLOAT_INSUFFICIENT"
    /// Sentinel for any rawValue not recognized at this iOS build's release. The non-
    /// colliding rawValue prevents accidental impersonation by a backend literal.
    case unknown           = "_iOS_UNKNOWN"
}

extension TransferStatus: Codable {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TransferStatus(rawValue: raw) ?? .unknown
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(self.rawValue)
    }
}
