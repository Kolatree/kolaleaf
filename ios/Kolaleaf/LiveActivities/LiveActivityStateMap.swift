// LiveActivityStateMap.swift  (Phase 10B · U71)
//
// Pure mapping from app-side `TransferStatus` to widget-side
// `LiveActivityState` band + the action `LiveActivityService` should
// take (push a content-state update, end the activity, or no-op).
//
// Lives APP-SIDE — `TransferStatus` is an app-target type. This file
// MUST NOT be added to the `KolaleafWidgets` target's source list.

import Foundation

/// Outcome of mapping a `TransferStatus` for Live Activity purposes.
public enum LiveActivityAction: Sendable, Equatable {
    /// Push a fresh `ContentState` to the activity (start it if no
    /// activity exists yet).
    case update(LiveActivityState)
    /// End the activity. The lock-screen surface is dismissed per the
    /// caller's `dismissalPolicy`.
    case end
    /// No-op. The status carries no Live Activity surface
    /// (`CREATED` — pre-AWAITING_AUD; `unknown` — sentinel).
    case ignore
}

/// Provides the SLA estimate (in seconds) for each `LiveActivityState`.
/// Pulled out of `LiveActivityService` so tests can override and the
/// widget never decodes wall-clock dependent surfaces.
public protocol ETAProvider: Sendable {
    func etaSeconds(for state: LiveActivityState) -> Int
}

/// Default impl: hard-coded SLA estimates per state. The numbers come
/// from the product CLAUDE.md (transfer state machine timing budgets).
public struct DefaultETAProvider: ETAProvider {
    public init() {}

    public func etaSeconds(for state: LiveActivityState) -> Int {
        switch state {
        case .awaitingAUD:    return 24 * 3600   // 24h PayID window
        case .processingNGN:  return 5 * 60      // ~5 min payout SLA
        case .floatPaused:    return 4 * 60      // 4 min treasury silence
        case .failedRetry:    return 90          // ~90s retry cycle
        case .needsAction:    return 0           // user gates progress
        case .completed:      return 0
        case .unknown:        return 0
        }
    }
}

/// Pure mapping surface — protocol so `LiveActivityService` can be
/// injected with a fake in tests. The default `LiveActivityStateMap`
/// holds the canonical table.
public protocol LiveActivityStateMapping: Sendable {
    /// Return the action `LiveActivityService` should take for the
    /// given backend status.
    func action(for status: TransferStatus) -> LiveActivityAction

    /// Build a fresh `ContentState` for a status the caller has
    /// already decided maps to `.update(...)`. Returns nil for any
    /// status that does not map to an update (caller should switch on
    /// `action(for:)` first).
    func contentState(
        from status: TransferStatus,
        now: Date,
        eta: ETAProvider,
        stageLabel: String
    ) -> KolaleafTransferAttributes.ContentState?
}

public struct LiveActivityStateMap: LiveActivityStateMapping {

    public static let shared = LiveActivityStateMap()

    public init() {}

    public func action(for status: TransferStatus) -> LiveActivityAction {
        switch status {
        case .awaitingAud:
            return .update(.awaitingAUD)
        case .audReceived, .processingNgn, .ngnSent, .ngnRetry:
            return .update(.processingNGN)
        case .completed:
            return .update(.completed)
        case .floatInsufficient:
            return .update(.floatPaused)
        case .ngnFailed:
            return .update(.failedRetry)
        case .needsManual:
            return .update(.needsAction)
        case .cancelled, .expired, .refunded:
            return .end
        case .created, .unknown:
            return .ignore
        }
    }

    public func contentState(
        from status: TransferStatus,
        now: Date,
        eta: ETAProvider,
        stageLabel: String
    ) -> KolaleafTransferAttributes.ContentState? {
        guard case .update(let band) = action(for: status) else { return nil }
        return KolaleafTransferAttributes.ContentState(
            state: band,
            etaSeconds: eta.etaSeconds(for: band),
            lastUpdate: now,
            stageLabel: stageLabel
        )
    }
}
