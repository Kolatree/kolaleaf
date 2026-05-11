// BankPickerRow.swift  (Phase 4 · iteration-2 · OO-005)
// Reusable picker affordance for the AddRecipientView's bank row.
// Renders one of two states inside a tappable card:
//   • placeholder ("Choose a bank") when no bank is picked yet
//   • the selected bank's BankRow content otherwise
// Both states share the same chevron + frosted card chrome so the
// row never reflows on selection.
//
// Lifted out of AddRecipientView so the same affordance can be
// reused in future picker callsites (e.g. recipient editing) and
// so the View body stays declarative.

import SwiftUI

public struct BankPickerRow: View {
    private let bank: Bank?
    private let onTap: () -> Void

    public init(bank: Bank?, onTap: @escaping () -> Void) {
        self.bank = bank
        self.onTap = onTap
    }

    public var body: some View {
        Button(action: onTap) {
            HStack(spacing: KolaSpacing.m) {
                if let bank {
                    BankRow(bank: bank)
                } else {
                    Text("Choose a bank")
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.muted)
                        .padding(.horizontal, KolaSpacing.xl)
                        .padding(.vertical, KolaSpacing.l)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(KolaColors.muted)
                    .padding(.trailing, KolaSpacing.xl)
            }
            .frame(maxWidth: .infinity)
            .kolaFrosted(.card)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(bank?.name ?? "Choose a bank")
    }
}
