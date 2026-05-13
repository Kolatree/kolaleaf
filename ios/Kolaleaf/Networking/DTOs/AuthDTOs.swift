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

// MARK: - Identifier discriminator
//
// 4-lens review fix (type-design-analyzer): the wizard's wire-shape
// discriminator was previously a stringly-typed `String` with a
// `// "email" | "phone"` comment. Replaced with this enum so the
// Codable raw value still produces `"email"` / `"phone"` on the
// wire but the type system enforces the discriminator at every
// call site. The `init(email:)` / `init(phone:)` convenience
// initializers on the DTOs prevent callers from naming the
// discriminator at all — a typo (`type: "phon"`) is now
// unrepresentable.

public enum IdentifierKind: String, Codable, Sendable, Hashable {
    case email
    case phone
}

// MARK: - Verify-first wizard, step 1: send code
//
// 2026-05-13 phone-first widening: the body is a discriminated
// `{ type, value }` shape. Backend still accepts the legacy
// `{ email }` form via shape-sniffing for in-flight older app
// installs, but every new build sends the discriminated form.

public struct SendCodeRequest: Codable, Sendable {
    public let type: IdentifierKind
    public let value: String

    public init(email: String) {
        self.type = .email
        self.value = email
    }

    public init(phone: String) {
        self.type = .phone
        self.value = phone
    }
}

/// Backend literally returns `{ ok: true }` (z.literal(true)). Enumeration-proof:
/// always 200 regardless of whether the identifier is known / rate-limited / bounced.
public struct SendCodeResponse: Decodable, Sendable {
    public let ok: Bool
}

// MARK: - Verify-first wizard, step 2: verify code

public struct VerifyCodeRequest: Codable, Sendable {
    public let type: IdentifierKind
    public let value: String
    public let code: String

    public init(email: String, code: String) {
        self.type = .email
        self.value = email
        self.code = code
    }

    public init(phone: String, code: String) {
        self.type = .phone
        self.value = phone
        self.code = code
    }
}

/// Backend returns `{ verified: true }`. Note: this endpoint does NOT issue a session;
/// it opens a 30-min claim window for /complete-registration. The session-issuing call
/// is /complete-registration (different endpoint, different DTO).
public struct VerifyCodeResponse: Decodable, Sendable {
    public let verified: Bool
}

// MARK: - Complete registration (verify-first wizard, step 3)
//
// Wave 1 Zod schema reference: src/app/api/v1/auth/complete-registration/_schemas.ts.
// `state` is uppercased server-side; we send the AUState rawValue (already uppercase).
// `addressLine2` is omitted from the wire payload when empty so the server's optional
// schema applies cleanly (the route returns 400 on a non-empty < min-length string).

public struct CompleteRegistrationRequest: Codable, Sendable {
    public let email: String
    public let fullName: String
    public let password: String
    public let addressLine1: String
    public let addressLine2: String?
    public let city: String
    public let state: String
    public let postcode: String

    public init(
        email: String,
        fullName: String,
        password: String,
        addressLine1: String,
        addressLine2: String?,
        city: String,
        state: String,
        postcode: String
    ) {
        self.email = email
        self.fullName = fullName
        self.password = password
        self.addressLine1 = addressLine1
        self.addressLine2 = addressLine2
        self.city = city
        self.state = state
        self.postcode = postcode
    }
}

public struct CompleteRegistrationResponse: Decodable, Sendable {
    public struct User: Decodable, Sendable {
        public let id: String
        public let fullName: String
        public init(id: String, fullName: String) {
            self.id = id
            self.fullName = fullName
        }
    }
    public let user: User
    public init(user: User) { self.user = user }
}

// MARK: - Login (returning user)

/// Discriminated identifier per src/lib/schemas/common.ts IdentifierInput.
/// 2026-05-13: `phone` variant added. Apple/Google land in v1.1.
///
/// 4-lens review fix (type-design-analyzer): `type` is `IdentifierKind`
/// so a stringly-typed typo at any call site is unrepresentable.
/// Construct only via `email(_:)` / `phone(_:)` statics; the
/// memberwise init takes the enum so the type can't escape.
public struct LoginIdentifier: Codable, Sendable {
    public let type: IdentifierKind
    public let value: String

    public init(type: IdentifierKind, value: String) {
        self.type = type
        self.value = value
    }

    public static func email(_ value: String) -> LoginIdentifier {
        LoginIdentifier(type: .email, value: value)
    }

    public static func phone(_ value: String) -> LoginIdentifier {
        LoginIdentifier(type: .phone, value: value)
    }
}

public struct LoginRequest: Codable, Sendable {
    public let identifier: LoginIdentifier
    public let password: String

    public init(email: String, password: String) {
        self.identifier = .email(email)
        self.password = password
    }

    public init(phone: String, password: String) {
        self.identifier = .phone(phone)
        self.password = password
    }
}

/// Backend 200 response: `{ user: { id, fullName }, requires2FA, twoFactorMethod? }`
///
/// API-008: the wire still emits `requires2FA` (changing the wire is
/// out-of-scope for Phase 3 and would force a synchronised backend
/// release), but the Swift property reads `requiresTwoFactor` so call
/// sites don't carry the digit mid-identifier (which Swift naming
/// conventions discourage and which trips up downstream code-gen).
/// `CodingKeys` maps the Swift name back to the wire field.
public struct LoginResponse: Decodable, Sendable {
    public struct User: Decodable, Sendable {
        public let id: String
        public let fullName: String?
    }
    public let user: User
    public let requiresTwoFactor: Bool
    public let twoFactorMethod: String?  // "NONE" | "TOTP" | "SMS"

    private enum CodingKeys: String, CodingKey {
        case user
        case requiresTwoFactor = "requires2FA"
        case twoFactorMethod
    }
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

/// Mirrors Wave 1 AccountMeResponse with forward+backward tolerance.
///
/// Phase 3 (U29 / U30 PostKYC) extension: `displayName`, the AU address
/// columns, and `kycStatus` were added to the route. Production hotfix
/// (2026-05-13): the deployed backend may still ship the pre-Phase-3
/// shape (`email` instead of `primaryEmail`, no `kycStatus`/`displayName`/
/// address fields). The custom decoder handles BOTH wire shapes so an
/// older deploy doesn't strand iOS on the post-login bootstrap loop:
///   - `primaryEmail` → falls back to legacy `email` key
///   - `kycStatus` → defaults to `.unknown` if missing (RootRouter
///      already handles `.unknown` cleanly, sending the user to the
///      KYC-resume path rather than locking the spinner)
///   - All Phase-3 additions decode as nil/empty when absent
public struct MeResponse: Decodable, Sendable {
    public let userId: String
    public let fullName: String?
    public let displayName: String?
    public let primaryEmail: EmailIdentifierDTO?
    public let secondaryEmails: [EmailIdentifierDTO]
    public let twoFactorMethod: String?
    public let twoFactorEnabledAt: String?
    public let hasVerifiedPhone: Bool
    public let phoneMasked: String?
    public let hasRemainingBackupCodes: Bool
    public let backupCodesRemaining: Int
    public let addressLine1: String?
    public let addressLine2: String?
    public let city: String?
    public let state: String?
    public let postcode: String?
    public let country: String?
    public let kycStatus: KycStatus

    /// Memberwise initialiser preserved for tests and call-site
    /// construction. The custom Decodable init below shadows the
    /// synthesised one — re-declare here so existing fixtures keep
    /// compiling.
    public init(
        userId: String,
        fullName: String?,
        displayName: String?,
        primaryEmail: EmailIdentifierDTO?,
        secondaryEmails: [EmailIdentifierDTO],
        twoFactorMethod: String?,
        twoFactorEnabledAt: String?,
        hasVerifiedPhone: Bool,
        phoneMasked: String?,
        hasRemainingBackupCodes: Bool,
        backupCodesRemaining: Int,
        addressLine1: String?,
        addressLine2: String?,
        city: String?,
        state: String?,
        postcode: String?,
        country: String?,
        kycStatus: KycStatus
    ) {
        self.userId = userId
        self.fullName = fullName
        self.displayName = displayName
        self.primaryEmail = primaryEmail
        self.secondaryEmails = secondaryEmails
        self.twoFactorMethod = twoFactorMethod
        self.twoFactorEnabledAt = twoFactorEnabledAt
        self.hasVerifiedPhone = hasVerifiedPhone
        self.phoneMasked = phoneMasked
        self.hasRemainingBackupCodes = hasRemainingBackupCodes
        self.backupCodesRemaining = backupCodesRemaining
        self.addressLine1 = addressLine1
        self.addressLine2 = addressLine2
        self.city = city
        self.state = state
        self.postcode = postcode
        self.country = country
        self.kycStatus = kycStatus
    }

    private enum CodingKeys: String, CodingKey {
        case userId, fullName, displayName
        case primaryEmail, email  // legacy alias
        case secondaryEmails
        case twoFactorMethod, twoFactorEnabledAt
        case hasVerifiedPhone, phoneMasked
        case hasRemainingBackupCodes, backupCodesRemaining
        case addressLine1, addressLine2, city, state, postcode, country
        case kycStatus
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.userId = try c.decode(String.self, forKey: .userId)
        self.fullName = try c.decodeIfPresent(String.self, forKey: .fullName)
        self.displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        // primaryEmail (current contract) OR email (legacy / pre-API-007)
        let primaryFromCanonical = try c.decodeIfPresent(EmailIdentifierDTO.self, forKey: .primaryEmail)
        let primaryFromLegacy = try c.decodeIfPresent(EmailIdentifierDTO.self, forKey: .email)
        self.primaryEmail = primaryFromCanonical ?? primaryFromLegacy
        self.secondaryEmails = (try c.decodeIfPresent([EmailIdentifierDTO].self, forKey: .secondaryEmails)) ?? []
        self.twoFactorMethod = try c.decodeIfPresent(String.self, forKey: .twoFactorMethod)
        self.twoFactorEnabledAt = try c.decodeIfPresent(String.self, forKey: .twoFactorEnabledAt)
        self.hasVerifiedPhone = (try c.decodeIfPresent(Bool.self, forKey: .hasVerifiedPhone)) ?? false
        self.phoneMasked = try c.decodeIfPresent(String.self, forKey: .phoneMasked)
        self.hasRemainingBackupCodes = (try c.decodeIfPresent(Bool.self, forKey: .hasRemainingBackupCodes)) ?? false
        self.backupCodesRemaining = (try c.decodeIfPresent(Int.self, forKey: .backupCodesRemaining)) ?? 0
        self.addressLine1 = try c.decodeIfPresent(String.self, forKey: .addressLine1)
        self.addressLine2 = try c.decodeIfPresent(String.self, forKey: .addressLine2)
        self.city = try c.decodeIfPresent(String.self, forKey: .city)
        self.state = try c.decodeIfPresent(String.self, forKey: .state)
        self.postcode = try c.decodeIfPresent(String.self, forKey: .postcode)
        self.country = try c.decodeIfPresent(String.self, forKey: .country)
        // Phase 3 added kycStatus; older deploys omit it. KycStatus's own
        // decoder maps unknown rawValues → .unknown; we default the
        // ENTIRE-FIELD-MISSING case to .unknown too.
        self.kycStatus = (try c.decodeIfPresent(KycStatus.self, forKey: .kycStatus)) ?? .unknown
    }
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
