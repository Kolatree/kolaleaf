// BankRow.swift  (Phase 4 · U37 + Phase 5 · CA-003 — iteration 3)
// One row in the BankPickerSheet. Brand-colour swatch + bank name.
//
// CA-003 originally moved the brand-colour table to BankStore.
// Iteration 3 (OO-202 / CA-201) split that further: the colour table
// itself lives in `BankBrandTable`, a pure function with no
// dependency on the network cache. BankRow now bypasses the store
// entirely for swatch rendering and asks the pure table directly,
// since the row already has the bank name on hand.
//
// `brandColor(for:)` is kept as a static shim that delegates to
// `BankBrandTable` so the existing pure-function tests in
// `BankRowBrandColorTests` still pass without environment plumbing.

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
            .fill(BankBrandTable.color(forBankName: bank.name))
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)
    }

    /// Static shim that delegates to the pure `BankBrandTable`. Kept
    /// so the pure-function tests in `BankRowBrandColorTests`
    /// continue to call `BankRow.brandColor` without needing the
    /// table's name directly.
    public nonisolated static func brandColor(for bank: Bank) -> Color {
        BankBrandTable.color(forBankName: bank.name)
    }
}
