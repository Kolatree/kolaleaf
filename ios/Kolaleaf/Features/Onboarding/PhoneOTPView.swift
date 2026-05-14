// PhoneOTPView.swift  (Phase 11A-4 · phone-first onboarding)
//
// Mirror of EmailOTPView wired to PhoneOTPViewModel. Same OTPField
// primitive + countdown + verify CTA; only the heading copy and
// the underlying API endpoints differ.

import SwiftUI

public struct PhoneOTPView: View {
    @State private var vm: PhoneOTPViewModel
    @StateObject private var otpModel: OTPFieldModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss

    public init(vm: PhoneOTPViewModel) {
        self._vm = State(initialValue: vm)
        let captured = vm
        self._otpModel = StateObject(wrappedValue: OTPFieldModel(length: 6) { code in
            captured.code = code
            Task { await captured.submit() }
        })
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
        .onAppear {
            vm.startCountdown()
            otpModel.beginEditing()
        }
        .onDisappear { vm.cancelCountdown() }
        .onChange(of: vm.errorMessage) { _, newError in
            if newError != nil && vm.code.isEmpty {
                otpModel.reset()
                otpModel.setError(true)
                otpModel.beginEditing()
            }
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
            codeField
            resendRow
            Spacer(minLength: KolaSpacing.card)
            submitButton
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xxxl)
        .padding(.bottom, KolaSpacing.homeIndicator)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Check your messages")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .accessibilityAddTraits(.isHeader)
            Text("We texted a 6-digit code to \(vm.phone.displayFormatted).")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, KolaSpacing.l)
    }

    private var codeField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            OTPField(model: otpModel, disabled: vm.isSubmitting)
                .privacySensitive()

            if let error = vm.errorMessage {
                Text(error)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(error)")
            }
        }
    }

    private var resendRow: some View {
        HStack {
            if vm.canResend {
                Button("Resend code") {
                    Task { await vm.resend() }
                }
                .font(KolaFont.cta)
                .foregroundStyle(KolaColors.greenLight)
                .accessibilityHint("Resend a fresh 6-digit code to your phone")
            } else {
                Text("Resend in \(vm.resendCountdown)s")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
                    .accessibilityLabel("Resend available in \(vm.resendCountdown) seconds")
            }
            Spacer()
        }
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
                Text("Verify")
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
        .accessibilityLabel(vm.isSubmitting ? "Verifying" : "Verify")
        .accessibilityHint("Confirm the 6-digit code you received")
    }
}
