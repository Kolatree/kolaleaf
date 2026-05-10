// EmailOTPView.swift  (Phase 1 · U21)
// Screen 05: enter the 6-digit code emailed in U20.
//
// P0 fix (Phase 1 review): wired to U18 `OTPField` primitive. Earlier draft
// used an inline `TextField` whose `onChange` re-fired `vm.submit()` every
// time the value changed — letting brute-force scripts amplify attempts at
// backend-rate. `OTPField`'s internal completion latch fires `onComplete`
// exactly once per fully-filled state, so each new attempt requires a real
// reset + refill.

import SwiftUI

public struct EmailOTPView: View {
    @State private var vm: EmailOTPViewModel
    @StateObject private var otpModel: OTPFieldModel
    @Environment(\.dismiss) private var dismiss

    public init(vm: EmailOTPViewModel) {
        self._vm = State(initialValue: vm)
        // Build the OTPFieldModel here so onComplete captures `vm` directly. The
        // closure pushes the assembled code into the view model and submits.
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
        .sensitiveScreen()   // P1 fix (Phase 1 review): OTP visible in switcher snapshot
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
            // When the VM clears `code` after a wrong/expired/used backend reason,
            // mirror the reset into the OTP boxes so the user sees the empty state
            // and can retype. Also flag error so the boxes glow red briefly.
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
            Text("Check your email")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
            Text("We sent a 6-digit code to \(vm.email).")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
        }
        .padding(.top, KolaSpacing.l)
    }

    private var codeField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            OTPField(model: otpModel, disabled: vm.isSubmitting)
                .privacySensitive()   // P2 fix (Phase 1 review): redact under AirPlay/screen recording

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
            } else {
                Text("Resend in \(vm.resendCountdown)s")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
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
        .animation(KolaMotion.softFade, value: vm.canSubmit)
    }
}
