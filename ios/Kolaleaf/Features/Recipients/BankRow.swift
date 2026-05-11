// BankRow.swift  (Phase 4 · U37)
// One row in the BankPickerSheet. Brand-colour swatch + bank name.
//
// Brand colours are hardcoded for the top NG banks; an unrecognised
// bank falls back to a neutral grey swatch. The mapping lives here
// (not in Theme/) because it's specific to the Recipients surface
// and hasn't been re-used elsewhere yet — promote when it grows a
// second consumer.

import SwiftUI

public struct BankRow: View {
    private let bank: Bank
    private let isSelected: Bool

    public init(bank: Bank, isSelected: Bool = false) {
        self.bank = bank
        self.isSelected = isSelected
    }

    public var body: some View {
        HStack(spacing: KolaSpacing.m) {
            swatch
            Text(bank.name)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer()
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(KolaColors.trustGreen)
            }
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.vertical, KolaSpacing.m)
        .frame(minHeight: KolaSpacing.hitTarget)
        .contentShape(Rectangle())
    }

    private var swatch: some View {
        RoundedRectangle(cornerRadius: KolaRadius.chipSmall, style: .continuous)
            .fill(BankRow.brandColor(for: bank))
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)
    }

    /// Brand colour table for the most common Nigerian banks. Misses
    /// fall back to a neutral grey so an unmapped bank still renders
    /// without a layout shift.
    static func brandColor(for bank: Bank) -> Color {
        // Match by lowercased name fragment so "Access Bank Plc" and
        // "ACCESS BANK" both resolve. Order matters where one name is
        // a prefix of another (Standard / Stanbic).
        let key = bank.name.lowercased()
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
