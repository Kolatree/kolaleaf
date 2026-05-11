// AddRecipientView.swift  (Phase 4 · U36 + U37)
// First-send flow's destination after EmptySendView's CTA. Three
// rows: Bank picker (opens BankPickerSheet), 10-digit account number
// field, optional nickname. ResolvedNameCard appears between the
// account number and nickname rows once the resolve service produces
// a name (Phase 5 will fill the resolving / notFound / bankDown
// variants of that card).
//
// `onCreated` fires only after a successful POST so a transient
// network blip can't pop the screen with a half-saved row.
//
// VM construction lives at the call site (SendTabRoot) so the View
// stays referentially transparent and tests can inject any VM
// without touching environment plumbing — same pattern as
// ConfirmAddressView in Phase 3.

import SwiftUI

public struct AddRecipientView: View {
    @State private var vm: AddRecipientViewModel
    @State private var isPickerPresented: Bool = false
    @Environment(\.dismiss) private var dismiss

    private let onCreated: (Recipient) -> Void

    public init(vm: AddRecipientViewModel, onCreated: @escaping (Recipient) -> Void) {
        self._vm = State(initialValue: vm)
        self.onCreated = onCreated
    }

    public var body: some View {
        @Bindable var vm = vm
        ScrollView {
            content
        }
        .scrollDismissesKeyboard(.interactively)
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationTitle("Add recipient")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isPickerPresented) {
            // API-105: sheet writes the selected bank through the
            // binding directly. Removes the redundant onSelect closure
            // whose only job was to flip the same value back into the
            // VM.
            BankPickerSheet(selection: $vm.selectedBank)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.card) {
            heading
            bankRow
            accountNumberRow
            ResolvedNameCard(state: vm.resolveState)
            nicknameRow
            if let error = vm.lastError {
                Text(error.displayMessage)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(error.displayMessage)")
            }
            saveButton
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xxxl)
        .padding(.bottom, KolaSpacing.homeIndicator)
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Who are you sending to?")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Pick the bank and account number — we'll confirm the holder name before saving.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
    }

    private var bankRow: some View {
        // OO-005: the placeholder/selected-state rendering lives in
        // BankPickerRow so it can be reused by future picker callsites.
        BankPickerRow(bank: vm.selectedBank) {
            isPickerPresented = true
        }
    }

    private var accountNumberRow: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Account number")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            TextField("10-digit NUBAN", text: $vm.accountNumber)
                .keyboardType(.numberPad)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textPrimary)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)
            // ADV-010: surface NUBAN truncation as an inline hint so
            // the user knows characters were dropped from their paste.
            if vm.wasTruncated {
                Text("Truncated to 10 digits.")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.warning)
            }
        }
    }

    private var nicknameRow: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Nickname (optional)")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            TextField("Mum, Brother, …", text: $vm.nickname)
                .textInputAutocapitalization(.words)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textPrimary)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)
        }
    }

    private var saveButton: some View {
        Button {
            Task {
                if let recipient = await vm.save() {
                    onCreated(recipient)
                    dismiss()
                }
            }
        } label: {
            HStack(spacing: KolaSpacing.s) {
                if vm.isSaving {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                }
                Text("Save recipient")
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
            }
            .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                    .fill(vm.canSave && !vm.isSaving
                          ? KolaColors.trustGreen
                          : Color.gray.opacity(0.3))
            )
        }
        .disabled(!vm.canSave || vm.isSaving)
        .buttonStyle(.plain)
    }
}
