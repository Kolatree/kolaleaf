// AddRecipientView.swift  (Phase 4 · U36 + U37 + Phase 5 · U40 — Iteration 2)
// First-send flow's destination after EmptySendView's CTA. Three
// rows: Bank picker (opens BankPickerSheet), 10-digit account number
// field, optional nickname. ResolvedNameCard appears between the
// account number and nickname rows once the resolve service produces
// a name.
//
// `onCreated` fires only after a successful POST so a transient
// network blip can't pop the screen with a half-saved row.
//
// VM construction lives at the call site (SendTabRoot) so the View
// stays referentially transparent and tests can inject any VM
// without touching environment plumbing — same pattern as
// ConfirmAddressView in Phase 3.
//
// Iteration 2 fixes (ADV5-005, API-001 / OO-103, OO-102 / API-006):
//   • ADV5-005 — scenePhase pause/resume reacts to .background and
//     .active ONLY. The previous `.inactive` branch fired on Control
//     Center and notification banners — transient interruptions
//     where iOS keeps the app fully alive — which would cancel and
//     re-arm the retry timer for nothing, losing wait progress.
//   • API-001 / OO-103 — the View calls screen-domain VM names
//     (`screenDeactivated()`, `screenActivated()`,
//     `userTappedRetry()`) so the body reads as prose at the call
//     site, not implementation mechanics.
//   • OO-102 / API-006 — `bankName` is passed explicitly to
//     `ResolvedNameCard` so the card stays a pure function of its
//     inputs. When the BankStore cache hasn't surfaced a name we
//     fall back to the bank code (fail loud) rather than a vague
//     "the bank" sentinel.

import SwiftUI

public struct AddRecipientView: View {
    @State private var vm: AddRecipientViewModel
    @State private var isPickerPresented: Bool = false
    @Environment(\.dismiss) private var dismiss
    /// API-007: pause/resume the resolve service's auto-retry loop
    /// with the app lifecycle so a backgrounded app doesn't keep
    /// firing the 3s/8s/20s retry schedule against the bank
    /// provider. The transition rules live below (ADV5-005).
    @Environment(\.scenePhase) private var scenePhase

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
            // binding directly.
            BankPickerSheet(selection: $vm.selectedBank)
        }
        .onChange(of: scenePhase) { _, newPhase in
            // ADV5-005: react to .background / .active ONLY.
            // .inactive is a transient state (Control Center,
            // notification banners, app switcher) where iOS keeps
            // the app fully alive; pausing here would cancel and
            // re-arm the retry timer for nothing, losing wait
            // progress.
            switch newPhase {
            case .background: vm.screenDeactivated()
            case .active:     vm.screenActivated()
            case .inactive:   break
            @unknown default: break
            }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.card) {
            heading
            bankRow
            accountNumberRow
            ResolvedNameCard(
                state: vm.resolveState,
                // OO-102 / API-006: pass the bank name explicitly so
                // the card stays a pure function of its inputs. Fall
                // back to the bank code (fail loud) when the picker
                // hasn't selected anything yet — diagnosable beats
                // a vague "the bank" sentinel.
                bankName: vm.selectedBank?.name ?? vm.selectedBank?.code ?? "—",
                onRetry: { vm.userTappedRetry() }
            )
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
