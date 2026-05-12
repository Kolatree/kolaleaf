// ReceiptViewModel.swift  (Phase 7 · U50 → iter-2 C2/W9/W12/S2/S6)
// Pure derivation over a completed `Transfer` + its resolved
// `Recipient`. The receipt is the terminal screen of the Send flow:
// big check, "Money's home", amount, summary card, share + send-
// another CTAs.
//
// Iter-2 fixes:
//   • C2 / OO-001: AUD/NGN formatting via shared `AmountFormatter`.
//   • W9 / ADV-P7-W3: nil + zero-rate receiveAmount renders "—" so
//     the receipt never shows ₦0 on a still-settling transfer.
//   • W12 / ADV-P7-W6: precondition transfer.status is COMPLETED or
//     NGN_SENT — construction with any other status is a programming
//     error (we'd be celebrating a failure).
//   • S2 / OO-007: `savingsLine` → `savingsLineCopy` so the name
//     reflects that it's static copy, not a derived figure.
//   • S6 / ADV-P7-S1: send-another debounce — fires at most once.

import Foundation
import Observation

@MainActor
@Observable
public final class ReceiptViewModel {

    /// The completed transfer that produced this receipt.
    public let transfer: Transfer
    /// The recipient row. Captured here so "Send another" can re-prime
    /// the next Send flow with the same person.
    // TODO(CA): W1 / OO-003 — `Recipient` is currently a Codable DTO
    // doubling as a domain type. Introduce DomainRecipient; mirror
    // the Transfer/TransferShape split so feature code stops
    // depending on the wire shape.
    public let recipient: Recipient

    /// Required: parent supplies the callback. S6 / ADV-P7-S1 — the
    /// VM debounces internally so a double-tap fires the callback
    /// exactly once.
    private let onSendAnother: (Recipient) -> Void

    /// S6 / ADV-P7-S1: debounce flag. The View also disables the
    /// button after the first tap (mirrors this state).
    public private(set) var didSendAnother: Bool = false

    public init(
        transfer: Transfer,
        recipient: Recipient,
        onSendAnother: @escaping (Recipient) -> Void = { _ in }
    ) {
        // W12 / ADV-P7-W6: construction with a non-success status is
        // a programming error. Only the coordinator's happy-path
        // branch reaches here.
        assert(
            transfer.status == .completed || transfer.status == .ngnSent,
            "ReceiptViewModel constructed with non-success status: \(transfer.status)"
        )
        self.transfer = transfer
        self.recipient = recipient
        self.onSendAnother = onSendAnother
    }

    // MARK: - Derived display

    /// Localised AUD amount: `A$100.00`. C2 / OO-001 — shared formatter.
    public var sendAmountText: String {
        AmountFormatter.aud(transfer.sendAmount)
    }

    /// Localised NGN amount: `₦70,000`. Falls back to
    /// `sendAmount * exchangeRate` when the backend hasn't shipped
    /// `receiveAmount`. W9 / ADV-P7-W3: if both the receive amount AND
    /// the exchangeRate are missing/zero, render `—` instead of `₦0`.
    public var receivedAmountText: String {
        if let received = transfer.receiveAmount {
            return AmountFormatter.ngn(received)
        }
        // Computed fallback. Refuse to render ₦0 — that's worse than
        // a missing-data dash on the receipt.
        let rate = transfer.exchangeRate
        guard rate > 0 else { return "—" }
        return AmountFormatter.ngn(transfer.sendAmount * rate)
    }

    public var recipientName: String { recipient.fullName }
    public var recipientBankLine: String { recipient.bankName }

    /// Top-of-screen headline. `Money's home` on COMPLETED, `On the
    /// way` for the brief NGN_SENT window before the bank settles.
    public var headline: String {
        switch transfer.status {
        case .completed:
            return "Money's home"
        default:
            return "On the way"
        }
    }

    /// Placeholder until backend ships the saved-vs-bank-rate delta.
    /// S2 / OO-007: renamed `savingsLine` → `savingsLineCopy` to
    /// signal this is fixed copy, not a derivation.
    public var savingsLineCopy: String {
        "Best available rate"
    }

    // MARK: - Actions

    /// User tapped "Send another". The coordinator parent receives the
    /// captured recipient and re-primes the Send screen with it.
    /// S6 / ADV-P7-S1: debounced — second+ taps are no-ops.
    public func sendAnother() {
        guard !didSendAnother else { return }
        didSendAnother = true
        onSendAnother(recipient)
    }
}
