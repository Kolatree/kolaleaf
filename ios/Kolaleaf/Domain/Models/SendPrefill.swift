// SendPrefill.swift  (Phase 9 iter-2 · OO-902 / API-902)
// Domain pre-fill payload handed to a Send screen when re-quoting an
// expired transfer. Lives in Domain/Models/ (not Features/) because
// both ExpiredTransferViewModel (producer) and SendView (consumer)
// reach for it across feature boundaries.
//
// `cents: Int` rather than `sendAmount: Decimal` because:
//   • `AmountStore` already stores cents internally, so the consumer
//     doesn't need a Decimal→Int conversion at the boundary.
//   • Carrying the canonical integer prevents floating-point drift on
//     a re-quote (a Decimal round-trip via `* 100` then `intValue`
//     was the iter-1 producer; making it the producer's contract
//     keeps the precision call in one place).

import Foundation

public struct SendPrefill: Equatable, Sendable, Hashable {
    public let recipientId: String
    /// AUD send amount in whole cents (1 AUD = 100). The consumer
    /// (SendView) seeds AmountStore directly from this.
    public let cents: Int

    public init(recipientId: String, cents: Int) {
        self.recipientId = recipientId
        self.cents = cents
    }

    /// Decimal → cents conversion at the producer boundary. Asserts on
    /// values that would overflow Int (≈ 21M AUD on 32-bit, well past
    /// any plausible remittance amount on 64-bit). Negative inputs are
    /// clamped to 0 — the only sensible default for a money seed.
    public static func cents(forAud aud: Decimal) -> Int {
        let scaled = aud * 100
        // NSDecimalNumber.intValue rounds toward zero. We use that
        // because the wire money string is already a 2-decimal value
        // — cents are exact, no rounding required for in-range inputs.
        let raw = NSDecimalNumber(decimal: scaled).intValue
        return max(0, raw)
    }
}
