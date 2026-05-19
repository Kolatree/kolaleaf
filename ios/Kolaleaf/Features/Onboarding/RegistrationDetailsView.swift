// RegistrationDetailsView.swift  (Phase 1 · U21a)
// Post-OTP form: name + password + AU residential address. Submits to
// /auth/complete-registration which consumes the verified-email claim and
// creates the User row.

import SwiftUI

public struct RegistrationDetailsView: View {
    @State private var vm: RegistrationDetailsViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss

    public init(vm: RegistrationDetailsViewModel) {
        self._vm = State(initialValue: vm)
    }

    public var body: some View {
        ZStack(alignment: .top) {
            ScrollView {
                content
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                stickySubmitArea
            }
        }
        .kolaWallpaper()
        .sensitiveScreen()   // P1 fix (Phase 1 review): full PII (legal name + AU address)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { backButton }
        }
    }

    // MARK: - Subviews

    private var backButton: some View {
        Button {
            dismiss()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(KolaColors.whiteOnGradient)
                .hitTarget44()
        }
        .accessibilityLabel("Back")
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.card) {
            heading
            identitySection
            addressSection
            if let formError = vm.inlineErrors["form"] {
                Text(formError)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(formError)")
            }
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xxxl)
        .padding(.bottom, KolaSpacing.xxxl + KolaSpacing.homeIndicator)
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Almost there")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .accessibilityAddTraits(.isHeader)
            Text("A few details so we can verify your identity under Australian law.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, KolaSpacing.l)
    }

    // MARK: Identity

    private var identitySection: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.m) {
            sectionLabel("Identity")

            field(label: "Full name") {
                TextField("Full legal name", text: $vm.fullName)
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
                    .accessibilityValue(vm.fullName.isEmpty ? "Empty" : vm.fullName)
            }
            errorIfAny(forKey: "fullName")

            field(label: "Password") {
                SecureField("At least 12 characters", text: $vm.password)
                    .textContentType(.newPassword)
                    .accessibilityValue(vm.password.isEmpty ? "Empty" : "Entered")
            }
            errorIfAny(forKey: "password")

            // iter-2 review fix (API-403): rail label, display value
            // and inline-error key all read through the typed
            // `LoginIdentifier` helpers so a future rail addition lands
            // here as a single switch update.
            field(label: vm.identifier.kind == .email ? "Email" : "Phone") {
                Text(vm.identifier.stringValue)
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            errorIfAny(forKey: vm.identifier.fieldKey)
        }
    }

    // MARK: Address

    private var addressSection: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.m) {
            sectionLabel("Residential address")

            field(label: "Address line 1") {
                TextField("Street address", text: $vm.addressLine1)
                    .textContentType(.streetAddressLine1)
                    .accessibilityValue(vm.addressLine1.isEmpty ? "Empty" : vm.addressLine1)
            }
            errorIfAny(forKey: "addressLine1")

            field(label: "Address line 2 (optional)") {
                TextField("Apartment, suite or unit", text: $vm.addressLine2)
                    .textContentType(.streetAddressLine2)
                    .accessibilityValue(vm.addressLine2.isEmpty ? "Empty" : vm.addressLine2)
            }

            field(label: "City") {
                TextField("Suburb or city", text: $vm.city)
                    .textContentType(.addressCity)
                    .textInputAutocapitalization(.words)
                    .accessibilityValue(vm.city.isEmpty ? "Empty" : vm.city)
            }
            errorIfAny(forKey: "city")

            HStack(spacing: KolaSpacing.m) {
                VStack(alignment: .leading, spacing: KolaSpacing.s) {
                    fieldLabel("State")
                    Picker("State", selection: $vm.state) {
                        ForEach(AUState.allCases, id: \.self) { state in
                            Text(state.rawValue).tag(state)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(KolaColors.greenLight)
                    .padding(.horizontal, KolaSpacing.xl)
                    .padding(.vertical, KolaSpacing.l)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kolaFrosted(.card)
                }
                VStack(alignment: .leading, spacing: KolaSpacing.s) {
                    fieldLabel("Postcode")
                    TextField("Postcode", text: $vm.postcode)
                        .keyboardType(.numberPad)
                        .textContentType(.postalCode)
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.whiteOnGradient)
                        .padding(.horizontal, KolaSpacing.xl)
                        .padding(.vertical, KolaSpacing.l)
                        .kolaFrosted(.card)
                        .accessibilityValue(vm.postcode.isEmpty ? "Empty" : vm.postcode)
                        .onChange(of: vm.postcode) { _, newValue in
                            let digits = String(newValue.filter(\.isNumber).prefix(4))
                            if digits != newValue { vm.postcode = digits }
                        }
                }
            }
            errorIfAny(forKey: "postcode")
            errorIfAny(forKey: "state")
        }
    }

    // MARK: Helpers

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(KolaFont.section)
            .foregroundStyle(KolaColors.whiteOnGradient)
            .padding(.top, KolaSpacing.s)
            .accessibilityAddTraits(.isHeader)
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(KolaFont.fieldLabel)
            .kerning(KolaKerning.label)
            .textCase(.uppercase)
            .foregroundStyle(KolaColors.whiteOnGradientMuted)
    }

    private func field<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            fieldLabel(label)
            content()
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)
        }
    }

    @ViewBuilder
    private func errorIfAny(forKey key: String) -> some View {
        if let message = vm.inlineErrors[key] {
            Text(message)
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.coral)
        }
    }

    private var stickySubmitArea: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            if !vm.canSubmit && !vm.isSubmitting {
                Text(registrationSubmitGuidance)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(registrationSubmitGuidance)
            }
            submitButton
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.m)
        .padding(.bottom, KolaSpacing.homeIndicator)
        .background(.ultraThinMaterial)
    }

    private var registrationSubmitGuidance: String {
        if vm.fullName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter your full legal name."
        }
        if vm.password.isEmpty {
            return "Create a password with at least 12 characters, including letters and numbers."
        }
        if vm.addressLine1.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter your residential street address."
        }
        if vm.city.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter your suburb or city."
        }
        if vm.postcode.count != 4 {
            return "Enter your 4-digit Australian postcode."
        }
        return "Check the highlighted fields."
    }

    private var submitButton: some View {
        Button {
            Task { await vm.submit() }
        } label: {
            HStack(spacing: KolaSpacing.s) {
                if vm.isSubmitting {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                }
                Text("Create account")
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
            }
            .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                    .fill(vm.canSubmit ? KolaColors.greenLight : Color.white.opacity(0.18))
            )
        }
        .disabled(!vm.canSubmit)
        .animation(KolaMotion.fade(reduce: reduceMotion), value: vm.canSubmit)
        .accessibilityLabel(vm.isSubmitting ? "Creating account" : "Create account")
        .accessibilityHint("Submit your details and create your Kolaleaf account")
    }
}
