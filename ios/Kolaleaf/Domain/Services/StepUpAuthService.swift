// StepUpAuthService.swift  (Phase 11.5 · U76c StepUpAuth)
// Pure rule evaluator for the second-factor step-up gate.
//
// The Send flow runs Face ID for *every* transfer. This service
// decides, on top of that, when we additionally demand a fresh
// authenticator (TOTP) entry — the regulator-friendly "high-risk
// transaction" gate.
//
// Three rules, OR'd together. Any matching reason flips the gate ON:
//   • highValue            — amount strictly greater than $5,000 AUD
//   • firstSendToRecipient — recipient has no prior COMPLETED transfer
//                            from this user (deletes / refunds / cancels
//                            don't count as a "completed" history).
//   • velocity             — >= 3 non-cancelled transfers in the trailing
//                            24 hours
//
// Design constraints:
//   • Pure logic. No network calls, no SwiftData reads. Caller threads
//     the three inputs in. Keeps the service trivially testable and
//     keeps the velocity / history derivations near the place that
//     already owns the SwiftData mirror (`SyncService`).
//   • `amountAUD: Decimal` — matches `Transfer.sendAmount` and the wire
//     DTO. Float would lose pennies and the threshold lives at a round
//     dollar boundary; only Decimal is safe.
//   • `Decision.reasons` is an array, not a Set, so the call-site can
//     render a stable ordered list of triggers (enum declaration order
//     via `Reason.allCases`).

import Foundation

/// Pure rule evaluator. Intentionally **not** `@MainActor`: the
/// evaluator is value-in / value-out and has no shared mutable state,
/// so any isolation domain can call it. The Send flow drives it from
/// the main actor, but the static constants below feed default
/// parameters of a non-isolated helper (`StepUpAuthInputs`) and would
/// fail isolation if the class were main-actor pinned.
public final class StepUpAuthService: Sendable {

    // MARK: - Rule constants
    //
    // Surfaced as public statics so:
    //   1) Tests can reference the boundary directly (no magic numbers
    //      drifting between service and test).
    //   2) Future tuning happens in one place. Backend mirror lives in
    //      the compliance config; iOS keeps its own copy so an offline
    //      app can still gate locally before round-trips.

    /// Strict greater-than threshold. Exactly $5,000 does NOT trigger
    /// the gate — matches the spec's "amount > $5,000" wording.
    public static let highValueThresholdAUD: Decimal = 5000

    /// Trailing window for the velocity rule.
    public static let velocityWindow: TimeInterval = 24 * 60 * 60

    /// Minimum count (inclusive) of in-window transfers that flips the
    /// velocity gate.
    public static let velocityCountThreshold: Int = 3

    // MARK: - Decision shape

    public struct Decision: Sendable, Hashable {
        public let isRequired: Bool
        public let reasons: [Reason]

        public init(isRequired: Bool, reasons: [Reason]) {
            self.isRequired = isRequired
            self.reasons = reasons
        }

        public static let notRequired = Decision(isRequired: false, reasons: [])
    }

    /// Reasons are surfaced in declaration order so the sheet's copy
    /// composition is deterministic (highValue first, then first-send,
    /// then velocity) regardless of how the inputs arrive.
    public enum Reason: String, Sendable, Hashable, CaseIterable {
        case highValue
        case firstSendToRecipient
        case velocity
    }

    // MARK: - Init

    public init() {}

    // MARK: - Evaluation

    /// Evaluate all three rules against the supplied inputs. The
    /// caller is responsible for sourcing `recipientHasCompletedTransfer`
    /// and `recentTransferCount` — see `SyncService.cachedTransfers()`
    /// for the canonical local source.
    ///
    /// - Parameters:
    ///   - amountAUD: send-side AUD amount the user is about to submit.
    ///   - recipientHasCompletedTransfer: `true` if there is at least
    ///     one prior `COMPLETED` transfer from this user to the same
    ///     recipient. `false` flips the firstSend gate.
    ///   - recentTransferCount: count of transfers created in the
    ///     trailing `velocityWindow` whose status is NOT cancelled.
    ///     A value of 3 or more flips the velocity gate.
    public func evaluate(
        amountAUD: Decimal,
        recipientHasCompletedTransfer: Bool,
        recentTransferCount: Int
    ) -> Decision {
        var reasons: [Reason] = []

        if amountAUD > Self.highValueThresholdAUD {
            reasons.append(.highValue)
        }
        if !recipientHasCompletedTransfer {
            reasons.append(.firstSendToRecipient)
        }
        if recentTransferCount >= Self.velocityCountThreshold {
            reasons.append(.velocity)
        }

        return Decision(isRequired: !reasons.isEmpty, reasons: reasons)
    }
}

// MARK: - Rule-input derivation from the SwiftData mirror
//
// The two non-amount inputs (`recipientHasCompletedTransfer`,
// `recentTransferCount`) are derived from the SyncService cache so the
// gate runs locally without a network round-trip. Kept as static
// helpers on a separate type (rather than instance methods on the
// service) so the rule evaluator stays a pure function and the
// SyncService dependency is opt-in.

public enum StepUpAuthInputs {

    /// `true` when at least one transfer to `recipientId` is in the
    /// terminal-success bucket. Mirrors the `TransferStatus.terminalSuccess`
    /// definition (`COMPLETED` only) so a still-pending transfer doesn't
    /// quietly mark the recipient as "known". Refunded / cancelled
    /// transfers also do not count.
    public static func recipientHasCompletedTransfer(
        recipientId: String,
        transfers: [Transfer]
    ) -> Bool {
        for t in transfers {
            if t.recipientId == recipientId && TransferStatus.terminalSuccess.contains(t.status) {
                return true
            }
        }
        return false
    }

    /// Count of transfers created in the trailing `velocityWindow`
    /// whose status is not `.cancelled`. Cancelled is excluded because
    /// it represents a deliberate user abandon before AUD changed hands
    /// — the spec calls for "transfers" that consumed velocity budget,
    /// not abandoned drafts.
    ///
    /// `createdAt` is optional on `Transfer` (older cached rows didn't
    /// mirror it). Rows missing `createdAt` are excluded so a backfill
    /// gap doesn't synthesise velocity.
    public static func recentTransferCount(
        transfers: [Transfer],
        window: TimeInterval = StepUpAuthService.velocityWindow,
        now: Date = Date()
    ) -> Int {
        let cutoff = now.addingTimeInterval(-window)
        var count = 0
        for t in transfers {
            guard let createdAt = t.createdAt else { continue }
            guard t.status != .cancelled else { continue }
            if createdAt >= cutoff { count += 1 }
        }
        return count
    }
}
