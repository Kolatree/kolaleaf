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
///
/// iter-2 review fix (API-406): domain field renamed from
/// `requires2FA` to `requiresTwoFactor` to align with Swift naming
/// conventions and the matching DTO field. The wire still emits
/// `requires2FA` — only the Swift identifier changed.
public struct LoginResult: Equatable, Sendable {
    public let user: CurrentUser
    public let requiresTwoFactor: Bool
    public let twoFactorMethod: String?

    public init(user: CurrentUser, requiresTwoFactor: Bool, twoFactorMethod: String?) {
        self.user = user
        self.requiresTwoFactor = requiresTwoFactor
        self.twoFactorMethod = twoFactorMethod
    }
}

@MainActor
@Observable
public final class SignInViewModel {

    /// Identifier rail the user is signing in with. Phone-default per
    /// the D4c flip; the email rail is reachable via a "Use email
    /// instead" toggle on the view.
    ///
    /// iter-2 review fix (API-405): the nested `Mode` enum was
    /// collapsed into `IdentifierKind` so the same discriminator
    /// drives the view rail, the DTO wire shape, and the
    /// `LoginIdentifier` enum — one source of truth instead of three
    /// parallel two-case enums.
    public var mode: IdentifierKind = .phone
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
            inlineError = String(
                localized: "onboarding.signin.password_required",
                defaultValue: "Please enter your password."
            )
            return
        }

        let identifier: LoginIdentifier
        let railEmail: String?
        let railPhone: String?

        // iter-2 review fix (API-410 / CA-302): build a typed
        // `LoginIdentifier` per rail so the discriminated enum reaches
        // the network DTO intact. The `.e164` projection only happens
        // inside the DTO's Codable encode.
        switch mode {
        case .email:
            let normalisedEmail = identifierInput.trimmed().lowercased()
            guard !normalisedEmail.isEmpty else {
                inlineError = String(
                    localized: "onboarding.signin.email_password_required",
                    defaultValue: "Please enter your email and password."
                )
                return
            }
            identifier = .email(normalisedEmail)
            railEmail = normalisedEmail
            railPhone = nil

        case .phone:
            let parsed = PhoneNumber.parse(
                dialCode: country.dialCode,
                localNumber: identifierInput
            )
            switch parsed {
            case .success(let phone):
                identifier = .phone(phone)
                railEmail = nil
                railPhone = phone.e164
            case .failure(let err):
                inlineError = Self.parseMessage(for: err)
                return
            }
        }
        let request = LoginRequest(identifier: identifier, password: password)

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
                // iter-2 review fix (API-406): domain `LoginResult`
                // identifier now matches the DTO field (`requiresTwoFactor`);
                // the wire still emits `requires2FA` via CodingKeys.
                requiresTwoFactor: response.requiresTwoFactor,
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
        case .empty:
            return String(
                localized: "common.phone.empty",
                defaultValue: "Enter your phone number."
            )
        case .malformed:
            return String(
                localized: "common.phone.malformed",
                defaultValue: "That doesn't look like a valid number."
            )
        }
    }

    private func userFacingMessage(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            switch mode {
            case .email:
                return String(
                    localized: "onboarding.signin.invalid_credentials_email",
                    defaultValue: "Email or password incorrect."
                )
            case .phone:
                return String(
                    localized: "onboarding.signin.invalid_credentials_phone",
                    defaultValue: "Phone or password incorrect."
                )
            }
        case .validation:
            return String(
                localized: "onboarding.signin.validation_failed",
                defaultValue: "Please check your details and try again."
            )
        case .rateLimited(let retryAfter):
            return String(
                localized: "common.error.rate_limited",
                defaultValue: "Too many attempts. Please try again in \(Int(retryAfter)) seconds."
            )
        case .transport:
            return String(
                localized: "common.error.connection",
                defaultValue: "Connection problem. Please check your network."
            )
        default:
            return error.errorDescription ?? String(
                localized: "common.error.unknown",
                defaultValue: "Something went wrong. Please try again."
            )
        }
    }
}

private extension String {
    func trimmed() -> String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
