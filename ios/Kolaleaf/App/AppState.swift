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

    public static let idleThresholdSeconds: TimeInterval = 14 * 60
    public static let backgroundIdleSeconds: TimeInterval = 15 * 60
    /// While a transfer is in-flight, idle window extends so the user can watch
    /// the timeline tick without being kicked out.
    public static let inflightIdleSeconds: TimeInterval = 90 * 60

    private(set) public var lastInteractionAt: Date
    private(set) public var lastBackgroundedAt: Date?

    // Keys used to persist across cold launches.
    private static let kLastInteractionAt = "kola.lastInteractionAt"
    private static let kLastBackgroundedAt = "kola.lastBackgroundedAt"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // Restore persisted state so cold launch after force-quit honors prior idle.
        let restoredInteraction = (defaults.object(forKey: Self.kLastInteractionAt) as? Date)
            ?? Date()
        let restoredBackground = defaults.object(forKey: Self.kLastBackgroundedAt) as? Date
        self.lastInteractionAt = restoredInteraction
        self.lastBackgroundedAt = restoredBackground
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
        if let bg = lastBackgroundedAt, now.timeIntervalSince(bg) >= Self.backgroundIdleSeconds {
            return true
        }

        // Foreground idle path. While a transfer is in-flight, extend window.
        let threshold: TimeInterval = (activeTransfer?.isInFlight == true)
            ? Self.inflightIdleSeconds
            : Self.idleThresholdSeconds
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
