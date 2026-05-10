// AuthEndpoints.swift  (Phase 0 · U12)
// Concrete Endpoint conformances for the auth surface verified to exist in Wave 1.
// See src/app/api/v1/auth/* for canonical request/response shapes.

import Foundation

public enum AuthEndpoints {

    // MARK: - Email OTP (existing in Wave 1)

    public struct SendEmailCode: Endpoint {
        public typealias Response = SendCodeResponse
        public let path = "/api/v1/auth/send-code"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(email: String) {
            self.body = SendCodeRequest(email: email)
        }
    }

    public struct VerifyEmailCode: Endpoint {
        public typealias Response = VerifyCodeResponse
        public let path = "/api/v1/auth/verify-code"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(email: String, code: String) {
            self.body = VerifyCodeRequest(email: email, code: code)
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

        public init(email: String, password: String) {
            self.body = LoginRequest(email: email, password: password)
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

    public struct Me: Endpoint {
        public typealias Response = MeResponse
        public let path = "/api/v1/account/me"
        public let method: HTTPMethod = .get
        public init() {}
    }
}
