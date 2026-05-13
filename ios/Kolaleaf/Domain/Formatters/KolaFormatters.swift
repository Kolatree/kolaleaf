// KolaFormatters.swift  (Phase 9 iter-3 · F8 / OO-905 / CA-906)
// Centralised display helpers for screens that show AUD amounts,
// AUD-NGN rates, or short countdown timers. Iter-2 left four files
// each maintaining a private `formatAud` / `formatRate` /
// `formatCountdown` — same locale, same fraction-digit settings,
// same `Decimal` → `NSNumber` shuffle. This file owns the one true
// implementation; the callers just import the namespace.
//
// Why a new namespace and not extend AmountFormatter?
//   AmountFormatter is the AmountStore display surface (`A$100.00`,
//   `₦70,000`). This file holds raw decimal display (no currency
//   symbol — the caller composes "AU$" or "1 AUD = X NGN" around
//   the value) plus the countdown helper. Mixing them would muddy
//   the AmountFormatter contract, which is "render an AmountStore
//   for a user".
//
// All formatters use the en_AU locale because the senders see AUD
// grouping (1,234.56) regardless of system locale — the regulator's
// receipts are en_AU.

import Foundation

public enum KolaFormatters {

    /// Decimal display for AUD amounts shown inline as
    /// `AU$\(KolaFormatters.audDisplay(amount))`. Two fraction
    /// digits, en_AU grouping. NO `A$` symbol — the caller composes
    /// the prefix so display copy can vary ("AU$100.00", "100.00 AUD",
    /// "$100.00 AUD") without forking the formatter.
    public static func audDisplay(_ d: Decimal) -> String {
        audGroupedFormatter.string(from: NSDecimalNumber(decimal: d)) ?? "\(d)"
    }

    /// Decimal display for FX rates shown inline as
    /// `1 AUD = \(KolaFormatters.rateDisplay(rate)) NGN`. Two
    /// fraction digits, en_AU grouping. NO unit suffix — same
    /// rationale as `audDisplay`.
    public static func rateDisplay(_ d: Decimal) -> String {
        rateFormatter.string(from: NSDecimalNumber(decimal: d)) ?? "\(d)"
    }

    /// `mm:ss` countdown for short ETAs (≤ 60 minutes). Holds at
    /// `0:00` if a negative number ever sneaks through (defensive —
    /// the VMs already clamp).
    public static func countdown(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    // MARK: - Private

    private static let audGroupedFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 2
        f.minimumFractionDigits = 2
        f.locale = Locale(identifier: "en_AU")
        return f
    }()

    private static let rateFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 2
        f.minimumFractionDigits = 2
        f.locale = Locale(identifier: "en_AU")
        return f
    }()
}
