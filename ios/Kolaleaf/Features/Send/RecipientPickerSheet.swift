// RecipientPickerSheet.swift  (Phase 6 · U42)
// Sheet rendered from `RecipientChip`'s tap. Lists the user's
// recipients and offers an "Add new" entry that routes back to the
// AddRecipient flow.
//
// The sheet takes a recipient list directly rather than fetching
// itself — the parent (`SendView`) owns the recipients-store loading
// and ensures the chip and the sheet stay in sync. This avoids a
// duplicate fetch when the user reopens the sheet.

import SwiftUI

public struct RecipientPickerSheet: View {

    public typealias OnSelect = (Recipient) -> Void
    public typealias OnAddNew = () -> Void

    private let recipients: [Recipient]
    private let selectedRecipientId: String?
    private let onSelect: OnSelect
    private let onAddNew: OnAddNew

    @Environment(\.dismiss) private var dismiss

    public init(
        recipients: [Recipient],
        selectedRecipientId: String?,
        onSelect: @escaping OnSelect,
        onAddNew: @escaping OnAddNew
    ) {
        self.recipients = recipients
        self.selectedRecipientId = selectedRecipientId
        self.onSelect = onSelect
        self.onAddNew = onAddNew
    }

    public var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(action: {
                        dismiss()
                        onAddNew()
                    }) {
                        HStack(spacing: KolaSpacing.m) {
                            ZStack {
                                Circle()
                                    .fill(KolaColors.trustGreen)
                                Image(systemName: "plus")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                            .frame(width: 32, height: 32)
                            Text("Add a new recipient")
                                .font(KolaFont.rowValue)
                                .foregroundStyle(KolaColors.textPrimary)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(KolaColors.textSecondary)
                        }
                        .frame(minHeight: KolaSpacing.hitTarget)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Add a new recipient")
                    .accessibilityHint("Opens the add-recipient form")
                }

                if !recipients.isEmpty {
                    Section("Your recipients") {
                        ForEach(recipients) { recipient in
                            Button(action: {
                                onSelect(recipient)
                                dismiss()
                            }) {
                                row(for: recipient)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Recipients")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(KolaFont.cta)
                        .foregroundStyle(KolaColors.trustGreen)
                }
            }
        }
    }

    @ViewBuilder
    private func row(for recipient: Recipient) -> some View {
        let isSelected = recipient.id == selectedRecipientId
        HStack(spacing: KolaSpacing.m) {
            ZStack {
                Circle()
                    .fill(BankBrandTable.color(forBankName: recipient.bankName))
                // Iter-2 (S4 / OO-009): single Recipient.initials helper.
                Text(recipient.initials)
                    .font(KolaFont.rowTotal)
                    .foregroundStyle(.white)
            }
            .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(recipient.fullName)
                    .font(KolaFont.rowValue)
                    .foregroundStyle(KolaColors.textPrimary)
                Text("\(recipient.bankName) · \(recipient.accountNumber)")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.textSecondary)
            }

            Spacer()
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(KolaColors.trustGreen)
            }
        }
        .frame(minHeight: KolaSpacing.hitTarget)
        .contentShape(Rectangle())
        .accessibilityLabel("\(recipient.fullName), \(recipient.bankName), \(recipient.accountNumber)")
        .accessibilityHint(isSelected ? "Currently selected" : "Tap to select this recipient")
    }

}
