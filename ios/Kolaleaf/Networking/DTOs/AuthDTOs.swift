// AuthDTOs.swift  (Phase 0 · U12)
// Codable DTOs mirroring the Wave 1 auth endpoints. Field shapes verified against
// the actual Zod schemas at:
//   src/app/api/v1/auth/send-code/_schemas.ts
//   src/app/api/v1/auth/verify-code/_schemas.ts
//   src/app/api/v1/auth/login/_schemas.ts
//   src/app/api/v1/account/me/_schemas.ts
//   src/lib/schemas/common.ts (ErrorEnvelope, ValidationErrorEnvelope, IdentifierInput)
//
// r2-review fix · 2026-05-09: prior shapes were wrong on every single endpoint.
// This file now mirrors the Wave 1 contract exactly. Verified by reading the schemas.

import Foundation

// MARK: - Email OTP (Wave 1 verify-first wizard, step 1: send code)

public struct SendCodeRequest: Encodable, Sendable {
    public let email: String
    public init(email: String) { self.email = email }
}

/// Backend literally returns `{ ok: true }` (z.literal(true)). Enumeration-proof:
/// always 200 regardless of whether the address is known / rate-limited / bounced.
public struct SendCodeResponse: Decodable, Sendable {
    public let ok: Bool
}

// MARK: - Email OTP step 2: verify code

public struct VerifyCodeRequest: Encodable, Sendable {
    public let email: String
    public let code: String
    public init(email: String, code: String) {
        self.email = email
        self.code = code
    }
}

/// Backend returns `{ verified: true }`. Note: this endpoint does NOT issue a session;
/// it opens a 30-min claim window for /complete-registration. The session-issuing call
/// is /complete-registration (different endpoint, different DTO).
public struct VerifyCodeResponse: Decodable, Sendable {
    public let verified: Bool
}

// MARK: - Login (returning user)

/// Discriminated identifier per src/lib/schemas/common.ts IdentifierInput.
/// Only `email` is implemented at v1. Apple/Google added in v1.1.
public struct LoginIdentifier: Encodable, Sendable {
    public let type: String  // "email" only at v1
    public let value: String

    public static func email(_ value: String) -> LoginIdentifier {
        LoginIdentifier(type: "email", value: value)
    }
}

public struct LoginRequest: Encodable, Sendable {
    public let identifier: LoginIdentifier
    public let password: String

    public init(email: String, password: String) {
        self.identifier = .email(email)
        self.password = password
    }
}

/// Backend 200 response: `{ user: { id, fullName }, requires2FA, twoFactorMethod? }`
public struct LoginResponse: Decodable, Sendable {
    public struct User: Decodable, Sendable {
        public let id: String
        public let fullName: String?
    }
    public let user: User
    public let requires2FA: Bool
    public let twoFactorMethod: String?  // "NONE" | "TOTP" | "SMS"
}

/// Backend 202 response: password OK but email not verified yet — backend issued an
/// OTP. iOS must surface a "verify your email" screen. Branch on HTTP status.
public struct LoginVerificationRequiredResponse: Decodable, Sendable {
    public let requiresVerification: Bool
    public let email: String
    public let message: String
}

// MARK: - Logout

/// Backend currently returns `{ success: true }` but treat as empty-body-tolerant.
/// EmptyResponse is the right shape if the route ever migrates to 204 No Content.
/// To avoid the empty-body-trap (see APIClient.swift), declare as Logout.Response = EmptyResponse.

// MARK: - /account/me

public struct EmailIdentifierDTO: Decodable, Sendable {
    public let id: String
    public let email: String
    public let verified: Bool
}

/// Mirrors Wave 1 AccountMeResponse exactly. Note: backend has NO kycStatus field —
/// kycStatus comes from /api/v1/kyc/status (separate endpoint, separate DTO).
public struct MeResponse: Decodable, Sendable {
    public let userId: String
    public let fullName: String?
    public let email: EmailIdentifierDTO?
    public let secondaryEmails: [EmailIdentifierDTO]
    public let twoFactorMethod: String?       // "NONE" | "TOTP" | "SMS" | nil
    /// ISO-8601 string (always with milliseconds via JS toISOString). Decoded as String
    /// at this layer; callers parse on demand using the fractional-seconds-aware formatter.
    public let twoFactorEnabledAt: String?
    public let hasVerifiedPhone: Bool
    public let phoneMasked: String?
    public let hasRemainingBackupCodes: Bool
    public let backupCodesRemaining: Int
}

// MARK: - Backend error envelope helpers

/// Mirrors src/lib/schemas/common.ts ErrorEnvelope: `{ error: string, reason: string }`.
/// `error` is the human message, `reason` is the machine code. NOT `{error: {code,message}}`.
public struct BackendError: Decodable, Sendable {
    public let error: String     // human-readable message
    public let reason: String    // machine code (e.g., "wrong_code", "rate_limited")
}

/// Mirrors ValidationErrorEnvelope: `{ error, reason: 'validation_failed', fields }`.
public struct BackendValidationError: Decodable, Sendable {
    public let error: String
    public let reason: String
    public let fields: [String: [String]]
}
