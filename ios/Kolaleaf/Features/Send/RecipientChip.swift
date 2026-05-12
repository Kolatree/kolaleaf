// RecipientChip.swift  (Phase 6 · U42)
// Top-of-Send-screen pill that names the active recipient and opens
// the picker sheet. Visually it is a horizontal capsule: avatar
// initials in a circle + recipient name + bank name + chevron hint.
//
// The chip is a pure view — it takes a `Recipient` and an `onTap`
// closure. The parent (`SendView`) owns the selected-recipient state.

import SwiftUI

public struct RecipientChip: View {

    private let recipient: Recipient
    private let onTap: () -> Void

    public init(recipient: Recipient, onTap: @escaping () -> Void) {
        self.recipient = recipient
        self.onTap = onTap
    }

    public var body: some View {
        Button(action: onTap) {
            HStack(spacing: KolaSpacing.m) {
                avatar
                VStack(alignment: .leading, spacing: 2) {
                    Text(recipient.fullName)
                        .font(KolaFont.rowValue)
                        .foregroundStyle(KolaColors.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(recipient.bankName)
                        .font(KolaFont.tagline)
                        .foregroundStyle(KolaColors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(KolaColors.textSecondary)
            }
            .padding(.horizontal, KolaSpacing.l)
            .padding(.vertical, KolaSpacing.m)
            .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.pill, style: .continuous)
                    .fill(Color.white)
            )
            .overlay(
                RoundedRectangle(cornerRadius: KolaRadius.pill, style: .continuous)
                    .strokeBorder(KolaColors.border, lineWidth: 1)
            )
            .shadow(
                color: KolaColors.Card.shadow,
                radius: KolaColors.Card.shadowRadius,
                x: 0,
                y: KolaColors.Card.shadowY
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Sending to \(recipient.fullName), \(recipient.bankName)")
        .accessibilityHint("Opens the recipient picker")
    }

    private var avatar: some View {
        ZStack {
            Circle()
                .fill(BankBrandTable.color(forBankName: recipient.bankName))
            // Iter-2 (S4 / OO-009): single Recipient.initials helper.
            Text(recipient.initials)
                .font(KolaFont.rowTotal)
                .foregroundStyle(.white)
        }
        .frame(width: 32, height: 32)
        .accessibilityHidden(true)
    }
}
