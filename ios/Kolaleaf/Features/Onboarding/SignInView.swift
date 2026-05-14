// SignInView.swift  (Phase 1 · U23b)
// Returning-user sign-in screen. The "Forgot password?" link calls a parent
// callback rather than implementing the reset flow inline (Phase 11 territory).
//
// D4c: phone-default rail with a "Use email instead" toggle. The
// phone field re-uses CountryPicker + .phonePad keyboard so the
// rhythm matches PhoneEntryView; the email field shape is unchanged
// from the iter-1 baseline.

import SwiftUI

public struct SignInView: View {
    @State private var vm: SignInViewModel
    @State private var pickerShown: Bool = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @FocusState private var focus: Field?
    private let onForgotPassword: (() -> Void)?

    public enum Field: Hashable { case identifier, password }

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
        .sheet(isPresented: $pickerShown) {
            CountryPicker(selection: $vm.country)
                .presentationDetents([.medium, .large])
        }
        .onAppear { focus = .identifier }
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
            identifierField
            passwordField
            modeToggleRow
            rememberAndForgotRow
            if let error = vm.inlineError {
                Text(error)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(error)")
            }
            // Phase 11 keeps this fallback for stale pending states that
            // predate the real 2FA challenge route.
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
                .accessibilityAddTraits(.isHeader)
            Text("Sign in to send your next transfer.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, KolaSpacing.l)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var identifierField: some View {
        switch vm.mode {
        case .phone: phoneField
        case .email: emailField
        }
    }

    private var phoneField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            fieldLabel("Phone")
            HStack(spacing: 0) {
                countryButton
                Divider()
                    .frame(height: 28)
                    .background(KolaColors.whiteOnGradient.opacity(0.25))
                    .padding(.vertical, KolaSpacing.m)
                TextField("400 000 000", text: $vm.identifierInput)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
                    .focused($focus, equals: .identifier)
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                    .padding(.horizontal, KolaSpacing.l)
                    .padding(.vertical, KolaSpacing.l)
            }
            .kolaFrosted(.card)
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

    private var emailField: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            fieldLabel("Email")
            TextField("you@example.com", text: $vm.identifierInput)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .submitLabel(.next)
                .onSubmit { focus = .password }
                .focused($focus, equals: .identifier)
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

    private var modeToggleRow: some View {
        Button {
            // Flip rail; clear the input buffer and any inline error
            // so the user doesn't see a phone-format complaint while
            // staring at an email field (or vice versa).
            vm.mode = (vm.mode == .phone) ? .email : .phone
            vm.identifierInput = ""
            // iter-2 review fix (API-409): after the rail flips, drop
            // focus onto the (now-different) identifier field so the
            // keyboard / autofill type re-resolves immediately rather
            // than leaving the user staring at a blurred field.
            focus = .identifier
        } label: {
            Text(vm.mode == .phone ? "Use email instead" : "Use phone instead")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .underline()
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHint(
            vm.mode == .phone
                ? "Switch to signing in with an email address"
                : "Switch to signing in with a phone number"
        )
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
        .animation(KolaMotion.fade(reduce: reduceMotion), value: vm.canSubmit)
        .accessibilityLabel(vm.isSubmitting ? "Signing in" : "Sign in")
        .accessibilityHint("Sign in with the credentials you entered above")
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(KolaFont.fieldLabel)
            .kerning(KolaKerning.label)
            .textCase(.uppercase)
            .foregroundStyle(KolaColors.whiteOnGradientMuted)
    }
}

@MainActor
@Observable
public final class TwoFactorSignInViewModel {
    public let method: String
    public var code = ""
    public private(set) var isSubmitting = false
    public private(set) var errorMessage: String?

    private let api: AuthAPI
    private let onVerified: (CurrentUser) -> Void

    public init(method: String, api: AuthAPI, onVerified: @escaping (CurrentUser) -> Void) {
        self.method = method
        self.api = api
        self.onVerified = onVerified
    }

    public var title: String {
        method == "SMS" ? "Enter your SMS code" : "Enter your authenticator code"
    }

    public var subtitle: String {
        method == "SMS"
            ? "Use the 6-digit code we sent to your phone, or an unused backup code."
            : "Use the 6-digit code from your authenticator app, or an unused backup code."
    }

    public func submit() async {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        let verify = await api.send(AuthEndpoints.VerifyTwoFactor(code: trimmed))
        switch verify {
        case .success:
            let me = await api.send(AccountEndpoints.Me())
            switch me {
            case .success(let response):
                onVerified(Self.currentUser(from: response))
            case .failure(let error):
                errorMessage = APIErrorPresenter.userFacingMessage(
                    for: error,
                    fallback: "Two-factor verified, but we could not load your account."
                )
            }
        case .failure(let error):
            errorMessage = APIErrorPresenter.userFacingMessage(
                for: error,
                fallback: "Could not verify that code."
            )
            if case .codeInvalid = error {
                code = ""
            }
        }
    }

    private static func currentUser(from me: MeResponse) -> CurrentUser {
        CurrentUser(
            id: me.userId,
            displayName: me.displayName ?? me.fullName,
            legalName: me.fullName,
            email: me.primaryEmail?.email,
            phone: nil
        )
    }
}

public struct TwoFactorSignInView: View {
    @State private var vm: TwoFactorSignInViewModel
    @FocusState private var focused: Bool

    public init(vm: TwoFactorSignInViewModel) {
        self._vm = State(initialValue: vm)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.card) {
            VStack(alignment: .leading, spacing: KolaSpacing.s) {
                Text(vm.title)
                    .font(KolaFont.headline)
                    .kerning(KolaKerning.headline)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                    .accessibilityAddTraits(.isHeader)
                Text(vm.subtitle)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, KolaSpacing.xxxl)

            TextField("123456", text: $vm.code)
                .keyboardType(.asciiCapable)
                .textContentType(.oneTimeCode)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .focused($focused)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .padding(KolaSpacing.l)
                .kolaFrosted(.card)
                .privacySensitive()
                .accessibilityLabel("Two-factor code")
                .accessibilityHint("Enter the 6-digit code or an unused backup code")

            if let error = vm.errorMessage {
                Text(error)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(error)")
            }

            Spacer(minLength: KolaSpacing.card)

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
                        .fill(!vm.code.isEmpty && !vm.isSubmitting ? KolaColors.greenLight : Color.white.opacity(0.18))
                )
            }
            .disabled(vm.isSubmitting || vm.code.isEmpty)
            .accessibilityLabel(vm.isSubmitting ? "Verifying" : "Verify")
            .accessibilityHint("Confirm your two-factor code to finish signing in")
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.bottom, KolaSpacing.homeIndicator)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .kolaWallpaper()
        .sensitiveScreen()
        .navigationBarBackButtonHidden(false)
        .onAppear { focused = true }
    }
}
