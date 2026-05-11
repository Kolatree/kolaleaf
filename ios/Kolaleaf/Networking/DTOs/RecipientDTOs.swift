// RecipientDTOs.swift  (Phase 4 · U36 + U37 + U37b)
// DTOs for the recipients surface. Backend Zod source of truth:
//   src/app/api/v1/recipients/_schemas.ts
//   src/app/api/v1/recipients/resolve/_schemas.ts
//
// Three concerns:
//   • `Recipient` — the row shape (`fullName`, `bankName`, `bankCode`,
//     `accountNumber`). Backend marks the schema `.passthrough()`,
//     so a future column won't break decoding here.
//   • Create — `POST /recipients` request + response.
//   • Resolve — `POST /recipients/resolve` request + response.

import Foundation

// MARK: - Recipient row

public struct Recipient: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let fullName: String
    public let bankName: String
    public let bankCode: String
    public let accountNumber: String

    public init(id: String, fullName: String, bankName: String, bankCode: String, accountNumber: String) {
        self.id = id
        self.fullName = fullName
        self.bankName = bankName
        self.bankCode = bankCode
        self.accountNumber = accountNumber
    }
}

/// 200-OK response from `GET /api/v1/recipients`.
public struct RecipientsListResponse: Codable, Sendable {
    public let recipients: [Recipient]

    public init(recipients: [Recipient]) {
        self.recipients = recipients
    }
}

// MARK: - Create

/// Body for `POST /api/v1/recipients`.
public struct CreateRecipientBody: Codable, Sendable, Equatable {
    public let fullName: String
    public let bankName: String
    public let bankCode: String
    public let accountNumber: String

    public init(fullName: String, bankName: String, bankCode: String, accountNumber: String) {
        self.fullName = fullName
        self.bankName = bankName
        self.bankCode = bankCode
        self.accountNumber = accountNumber
    }
}

/// 201-Created response from `POST /api/v1/recipients`.
public struct CreateRecipientResponse: Codable, Sendable {
    public let recipient: Recipient

    public init(recipient: Recipient) {
        self.recipient = recipient
    }
}

// MARK: - Resolve

/// Body for `POST /api/v1/recipients/resolve`. Backend enforces
/// `accountNumber` matches `^\d{10}$`; clients should pre-validate
/// to avoid wasting a 422 round-trip.
public struct ResolveRecipientBody: Codable, Sendable, Equatable {
    public let bankCode: String
    public let accountNumber: String

    public init(bankCode: String, accountNumber: String) {
        self.bankCode = bankCode
        self.accountNumber = accountNumber
    }
}

/// 200-OK response from `POST /api/v1/recipients/resolve`. The backend
/// returns ONLY `accountName` on success — bank holder lookup is the
/// whole point of the verification step.
///
/// Error codes:
///   • 404 → `account_not_found` → `RecipientResolveService` maps to `.notFound`.
///   • 503 → `resolve_unavailable` → maps to `.bankDown`.
///   • 429 → `rate_limited`        → maps to `.bankDown` (caller can retry).
public struct ResolveRecipientResponse: Codable, Sendable {
    public let accountName: String

    public init(accountName: String) {
        self.accountName = accountName
    }
}
