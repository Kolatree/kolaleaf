// SignInViewModel.swift  (Phase 1 · U23b)
// Drives the returning-user sign-in screen. Routes:
// • 200 → onSignedIn(LoginResult). 2FA branching is the caller's job.
// • 202 verificationRequired → onVerificationRequired(email): caller deep-links
//   to EmailOTPView so the user can finish verifying.
// • 401/422/429 → inlineError displayed under the form.

import Foundation
import Observation

/// Result delivered to `onSignedIn` on a 200 login.
public struct LoginResult: Equatable, Sendable {
    public let user: CurrentUser
    public let requires2FA: Bool
    public let twoFactorMethod: String?

    public init(user: CurrentUser, requires2FA: Bool, twoFactorMethod: String?) {
        self.user = user
        self.requires2FA = requires2FA
        self.twoFactorMethod = twoFactorMethod
    }
}

@MainActor
@Observable
public final class SignInViewModel {

    public var email: String = ""
    public var password: String = ""
    public var rememberMe: Bool = false
    public private(set) var isSubmitting: Bool = false
    public private(set) var inlineError: String?

    public var canSubmit: Bool {
        !isSubmitting && !email.trimmed().isEmpty && !password.isEmpty
    }

    private let api: AuthAPI
    private let onSignedIn: (LoginResult) -> Void
    private let onVerificationRequired: (String) -> Void

    public init(
        api: AuthAPI,
        onSignedIn: @escaping (LoginResult) -> Void,
        onVerificationRequired: @escaping (String) -> Void
    ) {
        self.api = api
        self.onSignedIn = onSignedIn
        self.onVerificationRequired = onVerificationRequired
    }

    public func submit() async {
        let normalisedEmail = email.trimmed().lowercased()
        guard !normalisedEmail.isEmpty, !password.isEmpty else {
            inlineError = "Please enter your email and password."
            return
        }

        isSubmitting = true
        inlineError = nil
        defer { isSubmitting = false }

        let result = await api.send(AuthEndpoints.Login(email: normalisedEmail, password: password))
        switch result {
        case .success(let response):
            let user = CurrentUser(
                id: response.user.id,
                displayName: response.user.fullName,
                legalName: response.user.fullName,
                email: normalisedEmail,
                phone: nil
            )
            onSignedIn(LoginResult(
                user: user,
                requires2FA: response.requires2FA,
                twoFactorMethod: response.twoFactorMethod
            ))
        case .failure(.verificationRequired(let backendEmail, _)):
            onVerificationRequired(backendEmail)
        case .failure(let error):
            inlineError = userFacingMessage(for: error)
        }
    }

    private func userFacingMessage(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            return "Email or password incorrect."
        case .validation:
            return "Please check your email and password."
        case .rateLimited(let retryAfter):
            return "Too many attempts. Please try again in \(Int(retryAfter)) seconds."
        case .transport:
            return "Connection problem. Please check your network."
        default:
            return error.errorDescription ?? "Something went wrong. Please try again."
        }
    }
}

private extension String {
    func trimmed() -> String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
