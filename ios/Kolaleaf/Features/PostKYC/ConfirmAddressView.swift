// ConfirmAddressView.swift  (Phase 3 · U30)
// PostKYC screen 2: confirm AU residential address. Toggle "I still
// live here" reuses the values we have on file; toggling it OFF clears
// the inputs so the user can type a new address.
//
// Caller supplies `onContinue` which fires after a successful save so
// the coordinator can hand control back to its caller. ADV-13 / API-004
// fix: the View now branches on `vm.save()`'s `Bool` return so a failed
// save can NEVER advance the flow.

import SwiftUI

public struct ConfirmAddressView: View {
    @State private var vm: ConfirmAddressViewModel
    private let onContinue: () -> Void

    public init(vm: ConfirmAddressViewModel, onContinue: @escaping () -> Void) {
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
            stillLiveHereToggle
            addressFields
            if let error = vm.lastError {
                // API-009: typed `SaveError` exposes `displayMessage`
                // for the banner. The View can also branch on case
                // identity in future polish (e.g. dismiss on
                // `.sessionExpired`).
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
            Text("Confirm your address")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
            Text("AUSTRAC requires us to keep your residential address current.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .padding(.top, KolaSpacing.l)
    }

    private var stillLiveHereToggle: some View {
        Toggle(isOn: Binding(
            get: { vm.isAtPrefilledAddress },
            set: { newValue in
                if newValue {
                    vm.confirmAddressUnchanged()
                } else {
                    vm.startEditingNewAddress()
                }
            }
        )) {
            Text("I still live at this address")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textPrimary)
        }
        .tint(KolaColors.greenLight)
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.vertical, KolaSpacing.l)
        .kolaFrosted(.card)
    }

    @ViewBuilder
    private var addressFields: some View {
        let readOnly = vm.isAtPrefilledAddress

        VStack(alignment: .leading, spacing: KolaSpacing.m) {
            field(label: "Street address") {
                TextField("12 Pitt Street", text: $vm.addressLine1)
                    .textContentType(.streetAddressLine1)
                    .disabled(readOnly)
            }
            errorIfAny(.addressLine1)

            field(label: "Apt / Suite (optional)") {
                TextField("Apt 4B", text: $vm.addressLine2)
                    .textContentType(.streetAddressLine2)
                    .disabled(readOnly)
            }

            field(label: "City") {
                TextField("Sydney", text: $vm.city)
                    .textContentType(.addressCity)
                    .textInputAutocapitalization(.words)
                    .disabled(readOnly)
            }
            errorIfAny(.city)

            HStack(spacing: KolaSpacing.m) {
                VStack(alignment: .leading, spacing: KolaSpacing.s) {
                    fieldLabel("State")
                    if readOnly {
                        AustralianStateLabel(state: vm.state)
                    } else {
                        AustralianStatePicker(selection: $vm.state)
                    }
                }
                VStack(alignment: .leading, spacing: KolaSpacing.s) {
                    fieldLabel("Postcode")
                    TextField("2000", text: $vm.postcode)
                        .keyboardType(.numberPad)
                        .textContentType(.postalCode)
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.textPrimary)
                        .padding(.horizontal, KolaSpacing.xl)
                        .padding(.vertical, KolaSpacing.l)
                        .kolaFrosted(.card)
                        .disabled(readOnly)
                        .onChange(of: vm.postcode) { _, newValue in
                            // ADV-8: filter to ASCII digits only — the
                            // default `Character.isNumber` accepts
                            // Unicode-Nd ("১২৩৪", "٤", "४"). Pinning to
                            // ASCII matches the backend's `\d{4}`
                            // primitive (JS RegExp `\d` = ASCII).
                            let digits = String(
                                newValue
                                    .filter { $0.isASCII && $0.isNumber }
                                    .prefix(4)
                            )
                            if digits != newValue { vm.postcode = digits }
                        }
                }
            }
            errorIfAny(.postcode)
        }
    }

    // MARK: Helpers

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(KolaFont.fieldLabel)
            .kerning(KolaKerning.label)
            .textCase(.uppercase)
            .foregroundStyle(KolaColors.textSecondary)
    }

    private func field<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            fieldLabel(label)
            content()
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textPrimary)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)
        }
    }

    @ViewBuilder
    private func errorIfAny(_ field: ConfirmAddressViewModel.Field) -> some View {
        if let message = vm.validationErrors[field] {
            Text(message)
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.coral)
        }
    }

    private var continueButton: some View {
        Button {
            Task {
                // API-004: only advance after a successful save. The VM
                // returns `false` for both validation and API failures
                // so a transient network blip can't push the flow into
                // the next step with a half-saved row.
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
