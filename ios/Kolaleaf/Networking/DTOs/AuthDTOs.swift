// AuthDTOs.swift  (Phase 0 · U12)
// Codable DTOs mirroring the Wave 1 auth endpoints. Field shapes verified against
// src/app/api/v1/auth/*/_schemas.ts and src/app/api/v1/account/me/route.ts.

import Foundation

// MARK: - Email OTP (Wave 1)

public struct SendCodeRequest: Encodable, Sendable {
    public let email: String
    public init(email: String) { self.email = email }
}

public struct SendCodeResponse: Decodable, Sendable {
    public let success: Bool
    public let resendAvailableInSeconds: Int?
}

public struct VerifyCodeRequest: Encodable, Sendable {
    public let email: String
    public let code: String
    public init(email: String, code: String) {
        self.email = email
        self.code = code
    }
}

public struct VerifyCodeResponse: Decodable, Sendable {
    public let userId: String
    public let kycStatus: String
    public let twoFactorRequired: Bool
}

// MARK: - Login (existing email + password user)

public struct LoginRequest: Encodable, Sendable {
    public let email: String
    public let password: String
    public init(email: String, password: String) {
        self.email = email
        self.password = password
    }
}

public struct LoginResponse: Decodable, Sendable {
    public let userId: String
    public let twoFactorRequired: Bool
    /// Backend-determined "this device hasn't been seen before for this user" flag (U76e).
    /// Backend may not implement this until the App Attest key-ID stable identifier lands;
    /// optional decode tolerates absence.
    public let isNewDevice: Bool?
}

// MARK: - Logout

public struct LogoutResponse: Decodable, Sendable {
    public let success: Bool
}

// MARK: - /account/me

public struct MeResponse: Decodable, Sendable {
    public let id: String
    public let email: String?
    public let phone: String?
    public let displayName: String?
    public let legalName: String?
    public let kycStatus: String

    // 2FA state lives on /account/me, not on a separate /account/2fa endpoint
    // (per r2 backend reality fix).
    public let twoFactorMethod: String?       // "totp" | "sms" | nil
    public let twoFactorEnabledAt: Date?
    public let hasRemainingBackupCodes: Bool?
}
