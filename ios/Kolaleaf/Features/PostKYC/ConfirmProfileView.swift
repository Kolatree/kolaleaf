// ConfirmProfileView.swift  (Phase 3 · U29)
// PostKYC screen 1: confirm legal name (read-only) + display name
// (editable). Caller supplies `onContinue` which fires after a
// successful save so the coordinator can advance to ConfirmAddress.

import SwiftUI

public struct ConfirmProfileView: View {
    @State private var vm: ConfirmProfileViewModel
    private let onContinue: () -> Void

    public init(vm: ConfirmProfileViewModel, onContinue: @escaping () -> Void) {
        self._vm = State(initialValue: vm)
        self.onContinue = onContinue
    }

    public var body: some View {
        ScrollView {
            content
        }
        .scrollDismissesKeyboard(.interactively)
        .kolaWallpaper()
        .task { await vm.load() }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.card) {
            heading
            legalNameField
            displayNameField
            if let error = vm.lastError {
                // API-009: typed `SaveError`; banner copy lives on
                // the type itself (`displayMessage`). The View can
                // also branch on case identity for future polish.
                let copy = error.displayMessage
                Text(copy)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(copy)")
            }
            continueButton
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xxxl)
        .padding(.bottom, KolaSpacing.homeIndicator)
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Confirm your profile")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
            Text("This is how Kolaleaf will refer to you across the app and on receipts.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .padding(.top, KolaSpacing.l)
    }

    private var legalNameField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            fieldLabel("From your verified ID")
            Text(vm.legalName.isEmpty ? "—" : vm.legalName)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)
                .accessibilityLabel("Legal name")
        }
    }

    private var displayNameField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            fieldLabel("Display name")
            TextField("Optional", text: $vm.displayName)
                .textInputAutocapitalization(.words)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textPrimary)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)
                .accessibilityLabel("Display name")
            Text("Optional. Defaults to the first part of your legal name.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(KolaFont.fieldLabel)
            .kerning(KolaKerning.label)
            .textCase(.uppercase)
            .foregroundStyle(KolaColors.textSecondary)
    }

    private var continueButton: some View {
        Button {
            Task {
                // API-004: only advance after a successful save —
                // mirror the symmetry with ConfirmAddressView.
                let didSave = await vm.save()
                if didSave { onContinue() }
            }
        } label: {
            HStack(spacing: KolaSpacing.s) {
                if vm.isSaving {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                }
                Text("Continue")
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
            }
            .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                    .fill(vm.isSaving ? Color.gray.opacity(0.3) : KolaColors.greenLight)
            )
        }
        .disabled(vm.isSaving)
    }
}
