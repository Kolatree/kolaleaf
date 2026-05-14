// EmailEntryView.swift  (Phase 1 · U20)
// Screen 04: capture email + transactional opt-in, send 6-digit code on submit.
//
// Layout: gradient wallpaper, back chevron top-left, headline, frosted email
// field, opt-in row, primary CTA pinned above the home indicator.

import SwiftUI

public struct EmailEntryView: View {
    @State private var vm: EmailEntryViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss
    @FocusState private var emailFocused: Bool

    public init(vm: EmailEntryViewModel) {
        self._vm = State(initialValue: vm)
    }

    public var body: some View {
        ZStack(alignment: .top) {
            content
        }
        .kolaWallpaper()
        .sensitiveScreen()   // P1 fix (Phase 1 review): app-switcher snapshot blur for PII
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { backButton }
        }
        .onAppear { emailFocused = true }
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
            emailField
            optInRow
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
            Text("What's your email?")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
            Text("We'll send you a 6-digit code to verify it.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
        }
        .padding(.top, KolaSpacing.l)
    }

    private var emailField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            TextField("you@example.com", text: $vm.email)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .submitLabel(.continue)
                .onSubmit { Task { await vm.submit() } }
                .focused($emailFocused)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)

            if let error = vm.inlineError {
                Text(error)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(error)")
            }
        }
    }

    private var optInRow: some View {
        Button {
            vm.transactionalOptIn.toggle()
        } label: {
            HStack(alignment: .top, spacing: KolaSpacing.m) {
                Image(systemName: vm.transactionalOptIn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(vm.transactionalOptIn ? KolaColors.greenLight : KolaColors.whiteOnGradientMuted)
                Text("I agree to receive transactional emails about my transfers (required for compliance).")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(vm.transactionalOptIn ? .isSelected : [])
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
    }
}
