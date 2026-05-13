// SignInViewModel.swift  (Phase 1 · U23b)
// Drives the returning-user sign-in screen. Routes:
// • 200 → onSignedIn(LoginResult). 2FA branching is the caller's job.
// • 202 verificationRequired → onVerificationRequired(email): caller deep-links
//   to EmailOTPView so the user can finish verifying.
// • 401/422/429 → inlineError displayed under the form.
//
// D4c: phone-default sign-in. `mode` selects which identifier rail the
// view renders; `/auth/login` accepts the discriminated
// `{ identifier: { type, value }, password }` shape so both rails share
// one submit path.

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

    /// Identifier rail the user is signing in with. Phone-default per
    /// the D4c flip; the email rail is reachable via a "Use email
    /// instead" toggle on the view.
    public enum Mode: Hashable, Sendable { case phone, email }

    public var mode: Mode = .phone
    /// Raw input buffer the user types. Interpreted per `mode`:
    /// phone → parsed with `country.dialCode`; email → trimmed +
    /// lowercased at submit.
    public var identifierInput: String = ""
    public var country: CountryDialCode = CountryDialCodes.default
    public var password: String = ""
    public var rememberMe: Bool = false
    public private(set) var isSubmitting: Bool = false
    public private(set) var inlineError: String?

    public var canSubmit: Bool {
        guard !isSubmitting, !password.isEmpty else { return false }
        switch mode {
        case .phone:
            if case .success = PhoneNumber.parse(
                dialCode: country.dialCode,
                localNumber: identifierInput
            ) { return true }
            return false
        case .email:
            let trimmed = identifierInput.trimmed()
            return trimmed.count >= 3 && trimmed.contains("@")
        }
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
        guard !password.isEmpty else {
            inlineError = "Please enter your password."
            return
        }

        let request: LoginRequest
        let railEmail: String?
        let railPhone: String?

        switch mode {
        case .email:
            let normalisedEmail = identifierInput.trimmed().lowercased()
            guard !normalisedEmail.isEmpty else {
                inlineError = "Please enter your email and password."
                return
            }
            request = LoginRequest(email: normalisedEmail, password: password)
            railEmail = normalisedEmail
            railPhone = nil

        case .phone:
            let parsed = PhoneNumber.parse(
                dialCode: country.dialCode,
                localNumber: identifierInput
            )
            switch parsed {
            case .success(let phone):
                request = LoginRequest(phone: phone.e164, password: password)
                railEmail = nil
                railPhone = phone.e164
            case .failure(let err):
                inlineError = Self.parseMessage(for: err)
                return
            }
        }

        isSubmitting = true
        inlineError = nil
        defer { isSubmitting = false }

        let result = await api.send(AuthEndpoints.Login(request))
        switch result {
        case .success(let response):
            let user = CurrentUser(
                id: response.user.id,
                displayName: response.user.fullName,
                legalName: response.user.fullName,
                email: railEmail,
                phone: railPhone
            )
            onSignedIn(LoginResult(
                user: user,
                // API-008: DTO renamed `requiresTwoFactor` (CodingKey
                // still maps to wire `requires2FA`). Domain
                // `LoginResult` keeps the legacy name for now — the
                // public surface change is scoped to the network DTO
                // per the issue brief.
                requires2FA: response.requiresTwoFactor,
                twoFactorMethod: response.twoFactorMethod
            ))
        case .failure(.verificationRequired(let backendEmail, _)):
            onVerificationRequired(backendEmail)
        case .failure(let error):
            inlineError = userFacingMessage(for: error)
        }
    }

    private static func parseMessage(for err: PhoneNumber.ParseError) -> String {
        switch err {
        case .empty:     return "Enter your phone number."
        case .malformed: return "That doesn't look like a valid number."
        }
    }

    private func userFacingMessage(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            switch mode {
            case .email: return "Email or password incorrect."
            case .phone: return "Phone or password incorrect."
            }
        case .validation:
            return "Please check your details and try again."
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
