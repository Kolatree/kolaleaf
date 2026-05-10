// SignInView.swift  (Phase 1 · U23b)
// Returning-user sign-in screen. The "Forgot password?" link calls a parent
// callback rather than implementing the reset flow inline (Phase 11 territory).

import SwiftUI

public struct SignInView: View {
    @State private var vm: SignInViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @FocusState private var focus: Field?
    private let onForgotPassword: (() -> Void)?

    public enum Field: Hashable { case email, password }

    public init(vm: SignInViewModel, onForgotPassword: (() -> Void)? = nil) {
        self._vm = State(initialValue: vm)
        self.onForgotPassword = onForgotPassword
    }

    public var body: some View {
        ZStack(alignment: .top) {
            content
        }
        .kolaWallpaper()
        .sensitiveScreen()   // P1 fix (Phase 1 review): email visible in switcher snapshot
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { backButton }
        }
        .onAppear { focus = .email }
    }

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
            passwordField
            rememberAndForgotRow
            if let error = vm.inlineError {
                Text(error)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(error)")
            }
            // P0 fix (Phase 1 review): block 2FA-required accounts from entering the
            // app until U73-U75 lands the challenge UI. SignInViewModel sets
            // appState.pendingTwoFactor on a 200 with requires2FA: true; we surface
            // the block here so the user has a clear next step instead of being
            // stranded mid-flow.
            if let pending = appState.pendingTwoFactor, let reason = pending.blockedReason {
                Text(reason)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.gold)
                    .accessibilityLabel("Two-factor sign-in unavailable: \(reason)")
            }
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
            Text("Welcome back")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
            Text("Sign in to send your next transfer.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
        }
        .padding(.top, KolaSpacing.l)
    }

    private var emailField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            fieldLabel("Email")
            TextField("you@example.com", text: $vm.email)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .submitLabel(.next)
                .onSubmit { focus = .password }
                .focused($focus, equals: .email)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)
        }
    }

    private var passwordField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            fieldLabel("Password")
            SecureField("Your password", text: $vm.password)
                .textContentType(.password)
                .submitLabel(.go)
                .onSubmit { Task { await vm.submit() } }
                .focused($focus, equals: .password)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .padding(.horizontal, KolaSpacing.xl)
                .padding(.vertical, KolaSpacing.l)
                .kolaFrosted(.card)
        }
    }

    private var rememberAndForgotRow: some View {
        HStack {
            Toggle(isOn: $vm.rememberMe) {
                Text("Remember me")
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.whiteOnGradient)
            }
            .toggleStyle(.switch)
            .tint(KolaColors.greenLight)
            Spacer()
            if let onForgotPassword {
                Button("Forgot password?") {
                    onForgotPassword()
                }
                .font(KolaFont.cta)
                .foregroundStyle(KolaColors.greenLight)
            }
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
                Text("Sign in")
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

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(KolaFont.fieldLabel)
            .kerning(KolaKerning.label)
            .textCase(.uppercase)
            .foregroundStyle(KolaColors.whiteOnGradientMuted)
    }
}
