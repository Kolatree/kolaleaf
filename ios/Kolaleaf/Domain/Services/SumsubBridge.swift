// SumsubBridge.swift  (Phase 2 · U24c)
// Maps a SumsubResult into an iOS-side optimistic KycStatus + the next
// onboarding route, side-effect-free for unit testing.
//
// Backend webhook is the source of truth — this bridge sets only an
// optimistic state so the UI advances immediately after Sumsub dismisses
// without waiting for the next /kyc/status poll.

import Foundation

/// Pure decision: given a SumsubResult, what does iOS optimistically believe
/// about the user's KYC status, and where should the coordinator route next?
public struct SumsubBridgeDecision: Equatable, Sendable {
    public let optimisticStatus: KycStatus
    public let nextRoute: NextRoute
    /// User-facing copy when the result is a failure. nil for success/cancel.
    public let userMessage: String?

    public enum NextRoute: Equatable, Sendable {
        /// Move to U25 KYCProcessingView, which polls /kyc/status.
        case processing
        /// Stay on KYC intro so the user can retry the Sumsub session.
        case retryFromIntro
        /// Backend reports VERIFIED already — skip processing, go straight on.
        case verified
    }

    public init(optimisticStatus: KycStatus, nextRoute: NextRoute, userMessage: String?) {
        self.optimisticStatus = optimisticStatus
        self.nextRoute = nextRoute
        self.userMessage = userMessage
    }
}

public enum SumsubBridge {

    /// Maps a `SumsubResult` (terminal Sumsub event) to an iOS-side decision.
    ///
    /// Mapping rationale:
    ///   • `.submitted` — set `.inReview` optimistically; route to processing
    ///     so polling kicks in. Webhook will confirm or correct.
    ///   • `.verdict("GREEN")` — set `.verified` optimistically; route to
    ///     verified so the post-KYC flow starts now. Webhook is authoritative
    ///     and the polling screen will reconcile if Sumsub flips it later.
    ///   • `.verdict("RED")` — set `.rejected`; route to retry. The user
    ///     hits /kyc/retry from the soft-rejection screen (U26).
    ///   • `.verdict(_)` (other) — set `.inReview`; route to processing as a
    ///     conservative default. Backend will ground-truth the status.
    ///   • `.cancelled` — leave status unchanged (caller passes the current
    ///     status). Route back to intro so the user can re-enter the flow.
    ///   • `.failed` — leave status unchanged; route back to intro and surface
    ///     the SDK message so the user can retry.
    public static func decide(
        result: SumsubResult,
        currentStatus: KycStatus
    ) -> SumsubBridgeDecision {
        switch result {
        case .submitted:
            return SumsubBridgeDecision(
                optimisticStatus: .inReview,
                nextRoute: .processing,
                userMessage: nil
            )

        case .verdict(let answer):
            switch answer.uppercased() {
            case "GREEN":
                return SumsubBridgeDecision(
                    optimisticStatus: .verified,
                    nextRoute: .verified,
                    userMessage: nil
                )
            case "RED":
                return SumsubBridgeDecision(
                    optimisticStatus: .rejected,
                    nextRoute: .retryFromIntro,
                    userMessage: nil
                )
            default:
                return SumsubBridgeDecision(
                    optimisticStatus: .inReview,
                    nextRoute: .processing,
                    userMessage: nil
                )
            }

        case .cancelled:
            return SumsubBridgeDecision(
                optimisticStatus: currentStatus,
                nextRoute: .retryFromIntro,
                userMessage: nil
            )

        case .failed(_, let message):
            return SumsubBridgeDecision(
                optimisticStatus: currentStatus,
                nextRoute: .retryFromIntro,
                userMessage: message.isEmpty
                    ? "Verification couldn't finish. Please try again."
                    : message
            )
        }
    }
}
