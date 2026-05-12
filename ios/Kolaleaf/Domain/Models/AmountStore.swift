// AmountStore.swift  (Phase 6 · U41)
// Source of truth for the send-amount entry. Stores integer cents so
// arithmetic stays exact regardless of the user's locale. Floating-point
// dollars are NEVER used internally — the API submission path converts to
// a `Decimal` only at the boundary.
//
// Display rules:
//   • `cents == 0` → "0"
//   • whole AUD (cents % 100 == 0) → "1,000"
//   • fractional → "1,000.50"
//   • thousands separator follows en_AU (comma)
//   • max 10 digits total (≤ $99,999,999.99). Further `append` calls are
//     a no-op so a fat-finger can't overflow the integer space or push
//     the on-screen number off-screen.
//
// `decimalAmount` returns the API submission shape (`Decimal` in AUD,
// e.g. 1500 cents → 15.00). Two decimal places guaranteed because the
// backend `DecimalString` schema accepts both `15` and `15.00`, but
// shipping `15.00` makes the wire log unambiguous.

import Foundation
import Observation

@MainActor
@Observable
public final class AmountStore {

    /// Integer cents. Source of truth for everything else.
    public private(set) var cents: Int = 0

    /// Hard cap so the on-screen display can't grow past 10 digits.
    /// 10 digits in cents is $99,999,999.99 — more than any single
    /// AUSTRAC-permissible single-customer transfer.
    public static let maxDigits = 10

    public init(cents: Int = 0) {
        self.cents = max(0, cents)
    }

    /// Append a single decimal digit. Out-of-range digits or
    /// overflowing the digit cap are no-ops. Iter-2 (W24 / ADV-P6-W7):
    /// the digit-count cap is checked BEFORE the multiplication so a
    /// fat-fingered run on a near-cap value can't briefly overflow
    /// `Int` arithmetic before the cap reject.
    public func append(_ digit: Int) {
        guard (0...9).contains(digit) else { return }
        // Leading-zero suppression: 0 + 0 stays at 0.
        if cents == 0 && digit == 0 { return }
        // Pre-multiply digit-count gate: refuse the append outright
        // if the *current* cents are already at the cap. The post-
        // multiply check below remains as a belt-and-braces guard
        // because a `cents` value with fewer digits than the cap
        // can still overflow the cap once the new digit lands.
        if digitCount(cents) >= Self.maxDigits { return }
        let nextCents = cents * 10 + digit
        if digitCount(nextCents) > Self.maxDigits { return }
        cents = nextCents
    }

    /// Remove the last digit. No-op when already 0.
    public func delete() {
        guard cents > 0 else { return }
        cents = cents / 10
    }

    /// Reset to zero.
    public func clear() {
        cents = 0
    }

    /// User-facing display string. Iter-2 routes through
    /// `AmountFormatter` (in the Feature layer) so the Domain store
    /// stays free of locale-aware copy (W10 / CA-006). The shim
    /// preserves iter-1 callers without editing them.
    public var displayString: String {
        AmountFormatter.display(cents)
    }

    /// API submission value — `Decimal` in AUD. 1500 cents → `15.00`.
    public var decimalAmount: Decimal {
        var raw = Decimal(cents)
        var rounded = Decimal()
        var divisor = Decimal(100)
        NSDecimalDivide(&rounded, &raw, &divisor, .plain)
        return rounded
    }

    /// API submission string. Matches backend `DecimalString` shape.
    /// Always renders two decimal places so the wire log is unambiguous.
    public var apiAmountString: String {
        let whole = cents / 100
        let frac = cents % 100
        return "\(whole).\(String(format: "%02d", frac))"
    }

    private func digitCount(_ n: Int) -> Int {
        if n == 0 { return 1 }
        var count = 0
        var v = abs(n)
        while v > 0 { count += 1; v /= 10 }
        return count
    }
}
