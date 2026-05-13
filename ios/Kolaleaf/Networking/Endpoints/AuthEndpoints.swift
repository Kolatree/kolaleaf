// AuthEndpoints.swift  (Phase 0 · U12)
// Concrete Endpoint conformances for the auth surface verified to exist in Wave 1.
// See src/app/api/v1/auth/* for canonical request/response shapes.

import Foundation

public enum AuthEndpoints {

    // MARK: - OTP wizard step 1: send code (email or phone)

    public struct SendEmailCode: Endpoint {
        public typealias Response = SendCodeResponse
        public let path = "/api/v1/auth/send-code"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(email: String) {
            self.body = SendCodeRequest(email: email)
        }
    }

    /// Accepts the typed `PhoneNumber` so the cascade survives all
    /// the way to DTO construction; the `.e164` projection happens
    /// here at the wire boundary. The email-rail twin
    /// (`SendEmailCode`) will tighten the same way when an
    /// `EmailAddress` value type lands.
    public struct SendPhoneCode: Endpoint {
        public typealias Response = SendCodeResponse
        public let path = "/api/v1/auth/send-code"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(phone: PhoneNumber) {
            self.body = SendCodeRequest(phone: phone.e164)
        }
    }

    // MARK: - OTP wizard step 2: verify code

    public struct VerifyEmailCode: Endpoint {
        public typealias Response = VerifyCodeResponse
        public let path = "/api/v1/auth/verify-code"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(email: String, code: String) {
            self.body = VerifyCodeRequest(email: email, code: code)
        }
    }

    public struct VerifyPhoneCode: Endpoint {
        public typealias Response = VerifyCodeResponse
        public let path = "/api/v1/auth/verify-code"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(phone: PhoneNumber, code: String) {
            self.body = VerifyCodeRequest(phone: phone.e164, code: code)
        }
    }

    // MARK: - Complete registration (Wave 1 verify-first wizard, step 3)

    public struct CompleteRegistration: Endpoint {
        public typealias Response = CompleteRegistrationResponse
        public let path = "/api/v1/auth/complete-registration"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(_ request: CompleteRegistrationRequest) {
            self.body = request
        }
    }

    // MARK: - Login (returning user)
    //
    // Login can return EITHER 200 LoginResponse OR 202 LoginVerificationRequiredResponse.
    // The 202 case is handled at APIClient.send level and surfaces as
    // APIError.verificationRequired — so the iOS Endpoint declares only the 200 type.

    public struct Login: Endpoint {
        public typealias Response = LoginResponse
        public let path = "/api/v1/auth/login"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        // iter-2 review fix (API-402): only the LoginRequest-taking
        // form remains. Email/phone string-rail conveniences were
        // removed so the type-narrowed `LoginIdentifier` enum reaches
        // every call site intact.
        public init(_ request: LoginRequest) {
            self.body = request
        }
    }

    public struct VerifyTwoFactor: Endpoint {
        public typealias Response = VerifySignInTwoFactorResponse
        public let path = "/api/v1/auth/verify-2fa"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(code: String, challengeId: String? = nil) {
            self.body = VerifySignInTwoFactorRequest(code: code, challengeId: challengeId)
        }
    }

    public struct DeviceAttestation: Endpoint {
        public typealias Response = DeviceAttestationResponse
        public let path = "/api/v1/auth/device-attestation"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(_ request: DeviceAttestationRequest) {
            self.body = request
        }
    }

    // MARK: - Logout

    /// Logout uses EmptyResponse so APIClient's empty-body fast-path applies even when
    /// the backend evolves to 204 No Content. Today it returns `{ success: true }` but
    /// we intentionally don't decode the body — only the HTTP status matters.
    public struct Logout: Endpoint {
        public typealias Response = EmptyResponse
        public let path = "/api/v1/auth/logout"
        public let method: HTTPMethod = .post
        public init() {}
    }

    // MARK: - /account/me
    //
    // Backward-compatibility alias. The canonical declaration moved to
    // `AccountEndpoints.Me` (API-002) so the two `/account/me` verbs
    // (GET + PATCH) live together. Existing call sites that still read
    // `AuthEndpoints.Me` keep compiling via the typealias.

    public typealias Me = AccountEndpoints.Me
}
