// EmailOTPView.swift  (Phase 1 · U21)
// Screen 05: enter the 6-digit code emailed in U20.
//
// TODO Phase 1 merge: replace the inline TextField with the U18 OTPField
// primitive once Agent A's branch lands. The placeholder field below uses
// `.numberPad` + `.oneTimeCode` content type so iOS still autofills.

import SwiftUI

public struct EmailOTPView: View {
    @State private var vm: EmailOTPViewModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var codeFocused: Bool

    public init(vm: EmailOTPViewModel) {
        self._vm = State(initialValue: vm)
    }

    public var body: some View {
        ZStack(alignment: .top) {
            content
        }
        .kolaWallpaper()
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { backButton }
        }
        .onAppear {
            vm.startCountdown()
            codeFocused = true
        }
        .onDisappear { vm.cancelCountdown() }
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
            // TODO Phase 1 merge: replace with `OTPField(value: $vm.code, ...)` from Agent A.
            TextField("000000", text: $vm.code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .submitLabel(.done)
                .focused($codeFocused)
                .font(KolaFont.amountMedium)
                .kerning(KolaKerning.amount)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)
                .onChange(of: vm.code) { _, newValue in
                    let digits = newValue.filter(\.isNumber)
                    let trimmed = String(digits.prefix(6))
                    if trimmed != newValue { vm.code = trimmed }
                    if trimmed.count == 6 { Task { await vm.submit() } }
                }

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
