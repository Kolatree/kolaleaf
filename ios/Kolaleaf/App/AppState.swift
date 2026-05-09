// AppState.swift  (Phase 0 · U8 + U76b primitives)
// Central observable state container for the app.
//
// Scope:
//   • Identity:     current user, KYC status (mirror of backend)
//   • Active flow:  in-flight transfer (if any)
//   • Network:      session token presence, reachability
//   • Idle:         lastInteractionAt timestamp + threshold (for U76b session timeout)
//
// AppState is mutated by Services (TransferService, AuthService, etc.) and read by
// Coordinators + ViewModels. Views never read it directly — they read their ViewModel.

import Foundation
import Observation

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

    /// Backend session TTL is 15 min sliding (per src/lib/auth/sessions.ts:8).
    /// iOS idle threshold sits one minute below to align with backend's window.
    public static let idleThresholdSeconds: TimeInterval = 14 * 60
    public static let backgroundIdleSeconds: TimeInterval = 15 * 60
    /// While a transfer is in-flight, idle window extends so the user can watch
    /// the timeline tick without being kicked out.
    public static let inflightIdleSeconds: TimeInterval = 90 * 60

    private(set) public var lastInteractionAt: Date = Date()
    private(set) public var lastBackgroundedAt: Date?

    // MARK: - Public mutations

    public init() {}

    /// Reset on any user touch, successful API call, or APNS state-change push for the active transfer.
    public func bumpInteraction() {
        lastInteractionAt = Date()
    }

    public func markBackgrounded() {
        lastBackgroundedAt = Date()
    }

    public func markForegrounded() {
        lastBackgroundedAt = nil
        bumpInteraction()
    }

    /// True when the iOS-side idle window has elapsed and the app should force re-auth.
    /// Caller (RootCoordinator) checks this on foreground and on each scene activate.
    public func shouldForceReauth() -> Bool {
        let now = Date()

        // Background-only path: any backgrounding longer than 15 min triggers re-auth.
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
    }
}

// MARK: - Domain types referenced by AppState
//
// These are placeholders for now; the real implementations land in `Domain/Models/`
// during the auth + transfer phases. Defined inline here to keep AppState self-
// contained at Phase 0.

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

/// Tracks the user's currently-in-flight transfer, if any. Mirrors the server-side row;
/// kept in memory so the Send coordinator can drive UI without re-fetching on every event.
public struct ActiveTransfer: Equatable, Sendable {
    public let id: String
    public let status: TransferStatus
    public let audAmount: Decimal
    public let ngnAmount: Decimal
    public let recipientId: String

    public var isInFlight: Bool {
        switch status {
        case .completed, .cancelled, .expired, .refunded, .needsManual:
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

/// Mirror of `enum TransferStatus` in `prisma/schema.prisma:26`.
/// MUST cover all 11 backend cases — default `case unknown` for forward compatibility.
public enum TransferStatus: String, Equatable, Sendable, Codable {
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
    case unknown
}
