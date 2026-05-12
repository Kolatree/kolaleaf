// SendCoordinator.swift  (Phase 7 · U54 → iter-2 W8/W13/W14)
// Pure state machine for the Send flow's terminal routing. The
// existing destination-stack in `SendTabRoot` handles the
// imperative push/pop; this coordinator answers a single question:
// **given a Transfer's status, what's the next step?**
//
// Architecture mirrors `PostKYCFlowState` (Phase 3 · U32):
//   • Value type, deterministic, no SwiftUI / Observation.
//   • Each transition is a pure mutator returning `Void`.
//   • The coordinator does NOT know about navigation — it computes
//     state. The View layer wires the state back into push/pop.
//
// Iter-2 fixes:
//   • W13 / API-001: case names use nouns (`send` not `sending`,
//     `processingTimeline` not `processing`) to mirror
//     `PostKYCStep` and the destination labels.
//   • W8 / ADV-P7-W2: sad-path branches for NEEDS_MANUAL /
//     NGN_FAILED / NGN_RETRY / REFUNDED. Iter-1 silently no-op'd
//     for those, leaving the user stuck on the processing screen.
//   • W14 / API-002: split happy/sad advance APIs so sad-path
//     transitions don't demand a Recipient they won't use.

import Foundation

/// Step in the Send flow. Carries the data each screen needs to
/// render itself so destinations don't pull state from a global
/// store.
public enum SendCoordinatorStep: Equatable {
    case send
    case payIDInstructions(Transfer)
    case processingTimeline(transferId: String, initialStatus: TransferStatus)
    case receipt(Transfer, Recipient)
    case cancelled
    case expired
    case floatPaused
    /// W8 / ADV-P7-W2: NGN payout failed (terminal — manual review)
    /// or exhausted retries.
    case payoutFailed(Transfer)
    /// W8: NEEDS_MANUAL — transfer escalated to ops review.
    case needsManual(Transfer)
    /// W8: REFUNDED — AUD returned to user's source account.
    case refunded(Transfer)
}

/// Pure value type backing the Send flow's terminal routing.
public struct SendCoordinatorState: Equatable {
    public private(set) var step: SendCoordinatorStep = .send

    public init() {}

    /// Sending → PayID instructions. Caller invokes when
    /// `SendViewModel.consumeLastCreated()` yields a transfer.
    public mutating func advanceFromSending(transfer: Transfer) {
        step = .payIDInstructions(transfer)
    }

    /// PayID instructions → Processing timeline. Caller invokes when
    /// the user taps "Track this transfer".
    public mutating func advanceFromPayID(
        transferId: String,
        initialStatus: TransferStatus
    ) {
        step = .processingTimeline(transferId: transferId, initialStatus: initialStatus)
    }

    /// Processing → receipt (happy path). Caller must already have
    /// confirmed the status is COMPLETED or NGN_SENT.
    ///
    /// W14 / API-002: split from the legacy `advanceFromProcessing`
    /// so happy-path advances don't share an entry point with sad-
    /// path advances (which don't need a Recipient).
    public mutating func advanceFromProcessingHappy(
        transfer: Transfer,
        recipient: Recipient
    ) {
        switch transfer.status {
        case .completed, .ngnSent:
            step = .receipt(transfer, recipient)
        default:
            assertionFailure(
                "advanceFromProcessingHappy called with non-happy status \(transfer.status)"
            )
            return
        }
    }

    /// Processing → terminal sad path. Routes by `transfer.status`:
    ///   • CANCELLED        → `.cancelled`
    ///   • EXPIRED          → `.expired`
    ///   • FLOAT_INSUFFICIENT → `.floatPaused`
    ///   • NGN_FAILED / NGN_RETRY → `.payoutFailed(transfer)`
    ///   • NEEDS_MANUAL     → `.needsManual(transfer)`
    ///   • REFUNDED         → `.refunded(transfer)`
    ///   • Any other (mid-flight) → no-op (caller stays on processing)
    public mutating func advanceFromProcessingSadPath(transfer: Transfer) {
        switch transfer.status {
        case .cancelled:
            step = .cancelled
        case .expired:
            step = .expired
        case .floatInsufficient:
            step = .floatPaused
        case .ngnFailed, .ngnRetry:
            step = .payoutFailed(transfer)
        case .needsManual:
            step = .needsManual(transfer)
        case .refunded:
            step = .refunded(transfer)
        default:
            return
        }
    }

    /// Legacy combined entry. Routes happy and sad statuses to the
    /// appropriate split mutator. Preserved so iter-1 SendTabRoot /
    /// SendCoordinatorTests call sites keep compiling during the
    /// W14 split rollout.
    public mutating func advanceFromProcessing(
        transfer: Transfer,
        recipient: Recipient
    ) {
        switch transfer.status {
        case .completed, .ngnSent:
            advanceFromProcessingHappy(transfer: transfer, recipient: recipient)
        case .cancelled, .expired, .floatInsufficient,
             .ngnFailed, .ngnRetry, .needsManual, .refunded:
            advanceFromProcessingSadPath(transfer: transfer)
        case .unknown, .created, .awaitingAud, .audReceived, .processingNgn:
            // Mid-flight: caller stays on the processing screen.
            return
        }
    }

    /// Reset to sending. Used by "Send another" on the receipt screen
    /// and by the cancelled/expired/floatPaused placeholder screens.
    public mutating func sendAnother() {
        step = .send
    }
}
