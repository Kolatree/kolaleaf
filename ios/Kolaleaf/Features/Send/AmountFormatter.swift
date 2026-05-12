// AmountFormatter.swift  (Phase 6 iter-2 · W10 / CA-006)
// Feature-layer display formatting for the AmountStore. Iter-1
// inlined locale-aware grouping into the Domain `AmountStore`,
// which violated the layer separation — the store carries cents,
// not copy. This file owns the en_AU "1,000" display string.
//
// Phase 7 iter-2 (C2 / OO-001): added `aud(_:)` and `ngn(_:)` so
// the three duplicated currency formatters in Receipt/Share/Detail
// collapse to one shared surface. Output strings (`A$100.00`,
// `₦70,000`) match the prior inline formatters byte-for-byte so
// existing snapshot assertions pass unchanged.

import Foundation

public enum AmountFormatter {

    /// User-facing display of an AmountStore. Drops trailing `.00`
    /// for whole-dollar amounts.
    public static func display(_ cents: Int) -> String {
        if cents == 0 { return "0" }
        let whole = cents / 100
        let frac = cents % 100
        let wholeStr = grouped(whole)
        if frac == 0 {
            return wholeStr
        }
        return "\(wholeStr).\(String(format: "%02d", frac))"
    }

    /// AUD display — `A$100.00`. Two fraction digits, en_AU grouping,
    /// `A$` symbol (matches Australian fintech convention rather than
    /// the generic Locale.current "AUD" prefix).
    public static func aud(_ amount: Decimal) -> String {
        let f = audFormatter
        return f.string(from: amount as NSNumber) ?? "A$\(amount)"
    }

    /// NGN display — `₦70,000`. Zero fraction digits (NGN rounds to
    /// whole naira on display per the Vectors design system). Returns
    /// `"—"` for nil input so callers can render a missing-data dash
    /// instead of `₦0` on a freshly-issued transfer (W9 / ADV-P7-W3).
    public static func ngn(_ amount: Decimal?) -> String {
        guard let amount else { return "—" }
        let f = ngnFormatter
        let digits = f.string(from: amount as NSNumber) ?? "\(amount)"
        return "₦\(digits)"
    }

    // MARK: - Private

    private static func grouped(_ whole: Int) -> String {
        groupedFormatter.string(from: NSNumber(value: whole)) ?? "\(whole)"
    }

    private static let groupedFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = ","
        f.locale = Locale(identifier: "en_AU")
        return f
    }()

    private static let audFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "AUD"
        f.currencySymbol = "A$"
        f.maximumFractionDigits = 2
        f.minimumFractionDigits = 2
        f.locale = Locale(identifier: "en_AU")
        return f
    }()

    private static let ngnFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.minimumFractionDigits = 0
        f.groupingSeparator = ","
        f.locale = Locale(identifier: "en_AU")
        return f
    }()
}
