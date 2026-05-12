// AmountFormatter.swift  (Phase 6 iter-2 · W10 / CA-006)
// Feature-layer display formatting for the AmountStore. Iter-1
// inlined locale-aware grouping into the Domain `AmountStore`,
// which violated the layer separation — the store carries cents,
// not copy. This file owns the en_AU "1,000" display string.

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
}
