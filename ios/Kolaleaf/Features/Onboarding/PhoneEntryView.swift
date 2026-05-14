// PhoneEntryView.swift  (Phase 11A-4 · phone-first onboarding)
//
// Mirror of EmailEntryView but with a country-code prefix + phone
// field instead of a single email input. Includes an "or use email
// instead" fallback link so the user can still complete signup with
// email if the SMS path fails them (no signal, prepaid SIM, etc.).
//
// Layout matches EmailEntryView exactly so the wizard's visual
// rhythm doesn't change when the welcome screen routes the user
// here instead of to email entry.

import SwiftUI

public struct PhoneEntryView: View {
    @State private var vm: PhoneEntryViewModel
    @State private var pickerShown: Bool = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss
    @FocusState private var phoneFocused: Bool

    /// Optional callback for the "or use email instead" link. When
    /// nil (e.g. previews or a sign-in flow where the fallback
    /// reroute lives elsewhere), the link is hidden.
    private let onUseEmailInstead: (() -> Void)?

    public init(
        vm: PhoneEntryViewModel,
        onUseEmailInstead: (() -> Void)? = nil
    ) {
        self._vm = State(initialValue: vm)
        self.onUseEmailInstead = onUseEmailInstead
    }

    public var body: some View {
        ZStack(alignment: .top) {
            content
        }
        .kolaWallpaper()
        .sensitiveScreen()
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { backButton }
        }
        .sheet(isPresented: $pickerShown) {
            CountryPicker(selection: $vm.country)
                .presentationDetents([.medium, .large])
        }
        .onAppear { phoneFocused = true }
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
            phoneField
            optInRow
            Spacer(minLength: KolaSpacing.card)
            if let onUseEmailInstead {
                useEmailLink(onUseEmailInstead)
            }
            submitButton
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xxxl)
        .padding(.bottom, KolaSpacing.homeIndicator)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("What's your phone number?")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .accessibilityAddTraits(.isHeader)
            Text("We'll text you a 6-digit code. Your mobile carrier's standard SMS charges may apply.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, KolaSpacing.l)
    }

    private var phoneField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            HStack(spacing: 0) {
                countryButton
                Divider()
                    .frame(height: 28)
                    .background(KolaColors.whiteOnGradient.opacity(0.25))
                    .padding(.vertical, KolaSpacing.m)
                TextField("400 000 000", text: $vm.phoneInput)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .submitLabel(.continue)
                    .onSubmit { Task { await vm.submit() } }
                    .focused($phoneFocused)
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                    .padding(.horizontal, KolaSpacing.l)
                    .padding(.vertical, KolaSpacing.l)
                    .accessibilityLabel("Phone number")
            }
            .kolaFrosted(.card)

            if let error = vm.inlineError {
                Text(error)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(error)")
            }
        }
    }

    private var countryButton: some View {
        Button {
            pickerShown = true
        } label: {
            HStack(spacing: KolaSpacing.s) {
                Text(vm.country.flag)
                    .font(.system(size: 22))
                Text(vm.country.dialCode)
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
            }
            .padding(.horizontal, KolaSpacing.l)
            .padding(.vertical, KolaSpacing.l)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Country code: \(vm.country.name) \(vm.country.dialCode)")
    }

    private var optInRow: some View {
        Button {
            vm.transactionalOptIn.toggle()
        } label: {
            HStack(alignment: .top, spacing: KolaSpacing.m) {
                Image(systemName: vm.transactionalOptIn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(vm.transactionalOptIn ? KolaColors.greenLight : KolaColors.whiteOnGradientMuted)
                Text("I agree to receive transactional SMS about my transfers (required for compliance).")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(vm.transactionalOptIn ? .isSelected : [])
    }

    private func useEmailLink(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text("or use email instead")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .underline()
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityHint("Sign up with an email address instead of a phone number")
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
                Text("Continue")
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
        .accessibilityLabel(vm.isSubmitting ? "Sending code" : "Continue")
        .accessibilityHint("Send a 6-digit verification code to this phone")
    }
}
