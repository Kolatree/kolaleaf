// TransferStateLabels.swift  (Phase 6 iter-2 · W6 / CA-002)
// Feature-layer UI copy for the transfer timeline. Split out from
// `Domain/State/TransferStateDisplay.swift` so the Domain layer
// stays pure (transitions only) and copy lives next to the views
// that render it.

import Foundation

public enum TransferStateLabels {

    /// Short headline shown next to each timeline row.
    public static func label(for status: TransferStatus) -> String {
        switch status {
        case .created:           return "Transfer created"
        case .awaitingAud:       return "Waiting for your AUD"
        case .audReceived:       return "AUD received"
        case .processingNgn:     return "Sending NGN"
        case .ngnSent:           return "NGN sent"
        case .completed:         return "Transfer complete"
        case .ngnFailed:         return "Couldn't send NGN"
        case .ngnRetry:          return "Retrying"
        case .needsManual:       return "Needs review"
        case .refunded:          return "Refunded"
        case .expired:           return "Expired"
        case .cancelled:         return "Cancelled"
        case .floatInsufficient: return "Paused"
        case .unknown:           return "Updating"
        }
    }

    /// Sub-line under each row.
    public static func subtitle(for status: TransferStatus) -> String? {
        switch status {
        case .created:
            return "We've reserved your rate."
        case .awaitingAud:
            return "Push AUD to your PayID. We'll handle the rest."
        case .audReceived:
            return "We've received your AUD."
        case .processingNgn:
            return "Sending NGN to your recipient's bank."
        case .ngnSent:
            return "Funds have left for the recipient."
        case .completed:
            return "We've paid out to your recipient's bank."
        default:
            return nil
        }
    }
}

// Iter-1 compat: `TransferTimeline.label/subtitle` continues to
// resolve via these shims so the existing ProcessingTimelineView
// keeps compiling during the split.
public extension TransferTimeline {
    static func label(for status: TransferStatus) -> String {
        TransferStateLabels.label(for: status)
    }
    static func subtitle(for status: TransferStatus) -> String? {
        TransferStateLabels.subtitle(for: status)
    }
}
