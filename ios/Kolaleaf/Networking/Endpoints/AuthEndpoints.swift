// AuthEndpoints.swift  (Phase 0 · U12)
// Concrete Endpoint conformances for the auth surface verified to exist in the Wave 1
// backend. See src/app/api/v1/auth/* for canonical request/response shapes.
//
// Phone OTP variants (Phase 1.5 · U17/U19) are added as separate endpoints once the
// backend SMS provider integration lands.

import Foundation

public enum AuthEndpoints {

    // MARK: - Email OTP (existing in Wave 1)

    public struct SendEmailCode: Endpoint {
        public typealias Response = SendCodeResponse
        public let path = "/api/v1/auth/send-code"
        public let method: HTTPMethod = .post
        public let body: AnyEncodable?

        public init(email: String) {
            self.body = AnyEncodable(SendCodeRequest(email: email))
        }
    }

    public struct VerifyEmailCode: Endpoint {
        public typealias Response = VerifyCodeResponse
        public let path = "/api/v1/auth/verify-code"
        public let method: HTTPMethod = .post
        public let body: AnyEncodable?

        public init(email: String, code: String) {
            self.body = AnyEncodable(VerifyCodeRequest(email: email, code: code))
        }
    }

    // MARK: - Login (returning user)

    public struct Login: Endpoint {
        public typealias Response = LoginResponse
        public let path = "/api/v1/auth/login"
        public let method: HTTPMethod = .post
        public let body: AnyEncodable?

        public init(email: String, password: String) {
            self.body = AnyEncodable(LoginRequest(email: email, password: password))
        }
    }

    // MARK: - Logout

    public struct Logout: Endpoint {
        public typealias Response = LogoutResponse
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
