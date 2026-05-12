// Decimal+WireFormat.swift  (Phase 6 iter-2 · W22 / ADV-P6-W5)
// Locale-invariant Decimal → wire-string formatter for money values.
//
// Why this exists:
//   The backend's `DecimalString` Zod schema expects a `[0-9]+(\.[0-9]+)?`
//   shape (no thousands separators, dot for the fractional separator).
//   Calls like `NSDecimalNumber(decimal: d).stringValue` honour the
//   current Locale — under `fr_FR` that emits `1500,00` which fails Zod
//   validation. A user on a French phone could not submit a transfer.
//
// One canonical formatter lives here so every call site is wire-safe
// by construction. New callers: `Decimal.wireString` is the only
// supported way to serialise a money Decimal to the backend.

import Foundation

extension Decimal {

    /// Backend-shaped decimal string. ALWAYS uses `en_US_POSIX` so the
    /// fractional separator is `.` and grouping is suppressed, regardless
    /// of the user's locale. Trailing zeros are NOT trimmed — the
    /// representation is whatever `NSDecimalNumber.stringValue` yields
    /// in POSIX locale (a stable canonical form).
    public var wireString: String {
        let n = NSDecimalNumber(decimal: self)
        return Self.wireFormatter.string(from: n) ?? "\(self)"
    }

    /// Backend-shaped money string with two fractional digits. Used for
    /// fields where the wire format is documented as "two decimal places"
    /// (e.g. AUD `sendAmount`) so the network log stays unambiguous.
    public var wireMoneyString: String {
        Self.wireMoneyFormatter.string(from: NSDecimalNumber(decimal: self))
            ?? "\(self)"
    }

    // NumberFormatter is documented thread-safe for read-only use on
    // Foundation since 10.10 / iOS 7. We hold static formatters because
    // allocating one per call shows up under the financial keypad.
    private static let wireFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.numberStyle = .decimal
        f.usesGroupingSeparator = false
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 20
        return f
    }()

    private static let wireMoneyFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.numberStyle = .decimal
        f.usesGroupingSeparator = false
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()
}
