// TransferStateDisplay.swift  (Phase 6 · U49 → iter-2 W6/W16)
// Pure-Domain transitions for the transfer state machine. UI label
// strings have moved to `Features/Send/TransferStateLabels.swift` so
// the Domain layer never carries copy.
//
// Iter-2 also returns `TransitionVerdict` from `verdict(from:to:)`
// (W16 / API-007) so callers can distinguish "advance happy-path"
// from "transition to sad-path" rather than collapsing both into a
// single Bool. The legacy `advancesFrom(_:to:)` shim is preserved.

import Foundation

/// Classification of a status transition, used by the polling layer
/// and any APNS-pushed updates.
public enum TransitionVerdict: Equatable, Sendable {
    /// Forward progression along the happy-path timeline.
    case advance
    /// Same status (no observable change).
    case noChange
    /// Earlier status than the current one — out-of-order or stale.
    case regression
    /// Transition into a sad-path / terminal state.
    case sadPathEscape
}

/// Ordered list of the "happy-path" states the user sees on the
/// timeline. Terminal sad-path states (NGN_FAILED, NGN_RETRY,
/// NEEDS_MANUAL, REFUNDED, CANCELLED, EXPIRED, FLOAT_INSUFFICIENT)
/// surface as banners — they don't get a timeline row.
public enum TransferTimeline {

    public static let happyPath: [TransferStatus] = [
        .created,
        .awaitingAud,
        .audReceived,
        .processingNgn,
        .ngnSent,
        .completed,
    ]

    /// Terminal states stop polling — no further transitions can occur.
    public static func isTerminal(_ status: TransferStatus) -> Bool {
        switch status {
        case .completed, .refunded, .cancelled, .expired, .needsManual:
            return true
        default:
            return false
        }
    }

    /// Ordinal position in the happy-path timeline. `nil` for sad-path
    /// or unknown states. Used by `ProcessingTimelineViewModel` to
    /// enforce the "state only advances" invariant.
    public static func ordinal(for status: TransferStatus) -> Int? {
        happyPath.firstIndex(of: status)
    }

    /// W16 / API-007: rich verdict.
    public static func verdict(from current: TransferStatus,
                               to next: TransferStatus) -> TransitionVerdict {
        if current == next { return .noChange }
        let currentOrdinal = ordinal(for: current)
        let nextOrdinal = ordinal(for: next)
        switch (currentOrdinal, nextOrdinal) {
        case (let c?, let n?):
            return n > c ? .advance : .regression
        case (nil, _?):
            // Current is sad-path; happy-path again is an escape.
            return .sadPathEscape
        case (_, nil):
            return .sadPathEscape
        }
    }

    /// Legacy shim — `true` for any verdict that should be applied
    /// (advance, noChange, or sadPathEscape).
    public static func advancesFrom(_ current: TransferStatus,
                                    to next: TransferStatus) -> Bool {
        switch verdict(from: current, to: next) {
        case .advance, .noChange, .sadPathEscape: return true
        case .regression:                          return false
        }
    }
}
