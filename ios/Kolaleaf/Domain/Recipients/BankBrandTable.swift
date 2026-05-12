// BankBrandTable.swift  (Phase 5 · OO-202 / CA-201 — iteration 3)
// Pure colour table mapping a bank name to its launch-corridor brand
// colour. Extracted from `BankStore` so the lookup stops conflating
// "fetch the bank list" (network cache, MainActor-bound) with "what
// does this bank look like" (pure function, no dependencies).
//
// Why a standalone enum:
//   • The previous `BankStore.brandColor(forBankName:)` static method
//     had no dependency on the cached `banks` array, no need for the
//     network cache, and lived on a 200-line service class as 60+
//     lines of unrelated pattern-matching. SRP violation.
//   • A standalone enum makes the function reachable from anywhere
//     (BankRow, the resolved-name card, a future picker callsite)
//     without anybody having to depend on BankStore just for a colour.
//   • When the backend grows a `brand_color` column on Bank, this
//     table becomes a fallback for missing/unknown entries instead of
//     the canonical source.
//
// Match strategy: lowercased substring search by name fragment so
// "Access Bank Plc" and "ACCESS BANK" both resolve. Order matters
// where one name is a prefix of another (Standard / Stanbic — search
// the longer key first).

import SwiftUI

public enum BankBrandTable {

    /// Brand colour for a known Nigerian bank. Unknown banks fall back
    /// to the muted-disabled grey so an unmapped bank still renders
    /// without a layout shift.
    public static func color(forBankName name: String) -> Color {
        let key = name.lowercased()
        if key.contains("gtbank") || key.contains("guaranty trust") {
            return Color(hex: 0xE53935) // red
        }
        if key.contains("zenith") {
            return Color(hex: 0xC62828) // red
        }
        if key.contains("access") {
            return Color(hex: 0xF26522) // orange
        }
        if key.contains("stanbic") || key.contains("ibtc") {
            return Color(hex: 0x1565C0) // blue
        }
        if key.contains("fcmb") {
            return Color(hex: 0xEF6C00) // orange
        }
        if key.contains("wema") {
            return Color(hex: 0x6A1B9A) // purple
        }
        if key.contains("sterling") {
            return Color(hex: 0x1976D2) // blue
        }
        if key.contains("polaris") {
            return Color(hex: 0x7B1FA2) // purple
        }
        if key.contains("first bank") || key.contains("firstbank") {
            return Color(hex: 0x0D47A1) // navy
        }
        if key.contains("uba") || key.contains("united bank") {
            return Color(hex: 0xC62828) // red
        }
        if key.contains("union") {
            return Color(hex: 0x1B5E20) // green
        }
        if key.contains("ecobank") {
            return Color(hex: 0x1565C0) // blue
        }
        if key.contains("kuda") {
            return Color(hex: 0x6F00FF) // purple
        }
        if key.contains("opay") {
            return Color(hex: 0x00C853) // green
        }
        if key.contains("palmpay") {
            return Color(hex: 0x6200EA) // purple
        }
        if key.contains("moniepoint") {
            return Color(hex: 0x00B0FF) // light blue
        }
        if key.contains("keystone") {
            return Color(hex: 0x004D40) // teal
        }
        if key.contains("fidelity") {
            return Color(hex: 0x4527A0) // indigo
        }
        if key.contains("heritage") {
            return Color(hex: 0xFF8F00) // amber
        }
        if key.contains("titan") {
            return Color(hex: 0x303F9F) // blue
        }
        return KolaColors.mutedDisabled
    }
}
