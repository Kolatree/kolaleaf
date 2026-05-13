// AccountDTOs.swift  (Phase 3 · U29/U30 — PostKYC)
// Backend Zod source of truth: `src/app/api/v1/account/me/_schemas.ts`.
//
// `PatchMeBody` is the request body for `PATCH /api/v1/account/me`.
// Every field is optional — sending nil omits the key from the encoded
// JSON, which the backend treats as "leave this column alone". Sending
// an empty string for an address field clears the column to NULL via
// the `nullableTrimmed` transform on the backend.

import Foundation

// `Codable` rather than `Encodable` so test helpers can round-trip a
// recorded request body back into the struct for assertions
// (`FakeAPIClient.lastBody(for:as:)`). Production code only ever
// encodes — Swift synthesises `init(from:)` for free.
public struct PatchMeBody: Codable, Sendable, Equatable {
    public var displayName: String?
    public var addressLine1: String?
    public var addressLine2: String?
    public var city: String?
    public var state: String?
    public var postcode: String?
    public var country: String?

    public init(
        displayName: String? = nil,
        addressLine1: String? = nil,
        addressLine2: String? = nil,
        city: String? = nil,
        state: String? = nil,
        postcode: String? = nil,
        country: String? = nil
    ) {
        self.displayName = displayName
        self.addressLine1 = addressLine1
        self.addressLine2 = addressLine2
        self.city = city
        self.state = state
        self.postcode = postcode
        self.country = country
    }
}

// MARK: - Phase 11 2FA DTOs

public enum TwoFactorMethodKind: String, Codable, Sendable, Equatable {
    case none = "NONE"
    case totp = "TOTP"
    case sms = "SMS"
}

public struct SetupTwoFactorBody: Codable, Sendable, Equatable {
    public let method: TwoFactorMethodKind

    public init(method: TwoFactorMethodKind) {
        self.method = method
    }
}

public struct SetupTwoFactorResponse: Decodable, Sendable, Equatable {
    public let method: TwoFactorMethodKind
    public let secret: String?
    public let otpauthUri: String?
    public let qrDataUrl: String?
    public let challengeId: String?
}

public struct EnableTwoFactorBody: Codable, Sendable, Equatable {
    public let method: TwoFactorMethodKind
    public let secret: String?
    public let challengeId: String?
    public let code: String

    public init(method: TwoFactorMethodKind, secret: String? = nil, challengeId: String? = nil, code: String) {
        self.method = method
        self.secret = secret
        self.challengeId = challengeId
        self.code = code
    }
}

public struct EnableTwoFactorResponse: Decodable, Sendable, Equatable {
    public let enabled: Bool
    public let backupCodes: [String]
}

public struct VerifyTwoFactorBody: Codable, Sendable, Equatable {
    public let code: String
    public let challengeId: String?

    public init(code: String, challengeId: String? = nil) {
        self.code = code
        self.challengeId = challengeId
    }
}

public struct DisableTwoFactorResponse: Decodable, Sendable, Equatable {
    public let disabled: Bool
}

public struct RegenerateBackupCodesResponse: Decodable, Sendable, Equatable {
    public let backupCodes: [String]
}
