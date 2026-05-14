// StepUpAuthSheet.swift  (Phase 11.5 · U76c StepUpAuth)
// TOTP entry sheet presented after Face ID succeeds but the
// StepUpAuthService decides the transfer needs a second factor.
//
// Wraps the existing `AuthEndpoints.VerifyTwoFactor` call — the same
// endpoint `TwoFactorSignInViewModel` and `SecurityMenuViewModel` use
// for sign-in and 2FA-management verification. We don't try to reuse
// either of those view-models directly because they own non-trivial
// post-verification side effects (signing the user in / mutating the
// security profile). For a transfer step-up we only want the verify
// round-trip — succeed-only the sheet calls `onVerified()` and the
// SendViewModel resumes the POST /transfers path.

import SwiftUI

public struct StepUpAuthSheet: View {

    @Environment(\.apiClient) private var injectedAPI
    @State private var code: String = ""
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?
    @FocusState private var fieldFocused: Bool

    private let decision: StepUpAuthService.Decision
    private let onVerified: () -> Void
    private let onCancelled: () -> Void
    private let apiOverride: AuthAPI?

    public init(
        decision: StepUpAuthService.Decision,
        api: AuthAPI? = nil,
        onVerified: @escaping () -> Void,
        onCancelled: @escaping () -> Void
    ) {
        self.decision = decision
        self.apiOverride = api
        self.onVerified = onVerified
        self.onCancelled = onCancelled
    }

    public var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: KolaSpacing.card) {
                VStack(alignment: .leading, spacing: KolaSpacing.s) {
                    Text("Confirm this transfer with your authenticator")
                        .font(KolaFont.section)
                        .foregroundStyle(KolaColors.textPrimary)
                    Text(subtitleCopy)
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.textSecondary)
                }

                TextField("123456", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .focused($fieldFocused)
                    .font(KolaFont.row)
                    .padding(KolaSpacing.m)
                    .background(
                        RoundedRectangle(cornerRadius: KolaRadius.card)
                            .fill(KolaColors.surfaceSoft)
                    )
                    .privacySensitive()
                    .accessibilityIdentifier("stepup.code.field")

                if let errorMessage {
                    Text(errorMessage)
                        .font(KolaFont.tagline)
                        .foregroundStyle(KolaColors.coral)
                        .accessibilityIdentifier("stepup.error")
                }

                Button {
                    Task { await verify() }
                } label: {
                    HStack(spacing: KolaSpacing.s) {
                        if isSubmitting {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(.white)
                        }
                        Text("Verify and send")
                            .font(KolaFont.cta)
                    }
                    .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
                    .foregroundStyle(.white)
                    .background(
                        RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                            .fill(canSubmit ? KolaColors.trustGreen : KolaColors.trustGreen.opacity(0.4))
                    )
                }
                .disabled(!canSubmit)
                .accessibilityIdentifier("stepup.verify.button")

                Spacer(minLength: KolaSpacing.s)

                Button(action: onCancelled) {
                    Text("Cancel")
                        .font(KolaFont.cta)
                        .foregroundStyle(KolaColors.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
                        .background(
                            RoundedRectangle(cornerRadius: KolaRadius.pill, style: .continuous)
                                .strokeBorder(KolaColors.textSecondary.opacity(0.3), lineWidth: 1)
                        )
                }
                .accessibilityIdentifier("stepup.cancel.button")
            }
            .padding(KolaSpacing.xl)
            .navigationTitle("Extra confirmation")
            .navigationBarTitleDisplayMode(.inline)
        }
        .sensitiveScreen()
        .onAppear { fieldFocused = true }
    }

    // MARK: - Copy

    /// Pick subtitle copy based on the *first* triggering reason —
    /// Reasons are ordered (highValue, firstSend, velocity) so the
    /// strongest signal wins.
    private var subtitleCopy: String {
        guard let primary = decision.reasons.first else {
            return "We need a fresh authenticator code for this transfer."
        }
        switch primary {
        case .highValue:
            return "This is a larger transfer than usual, so we want to make sure it's really you."
        case .firstSendToRecipient:
            return "This is your first send to this recipient and we want to make sure it's really you."
        case .velocity:
            return "You've sent a few transfers recently. Confirm with your authenticator to keep your account safe."
        }
    }

    // MARK: - Submit

    private var canSubmit: Bool {
        !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
    }

    private func verify() async {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        // `\.apiClient` always provides a value (defaultValue is a real
        // APIClient origin); the override exists for previews/tests.
        let api: AuthAPI = apiOverride ?? injectedAPI

        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        let result = await api.send(AuthEndpoints.VerifyTwoFactor(code: trimmed))
        switch result {
        case .success:
            onVerified()
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
}
