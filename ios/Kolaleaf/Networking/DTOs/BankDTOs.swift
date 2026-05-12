// BankDTOs.swift  (Phase 4 · U37 prerequisite · iter-3 CA-202)
// DTOs for the bank-list surface. Backend Zod source of truth:
//   src/app/api/v1/banks/_schemas.ts
//
// Wire shape (200 OK):
//   { "banks": [{ "code": "044", "name": "Access Bank" }, …] }
//
// Iter-3 (CA-202): the `Bank` value type moved to
// `Domain/Recipients/Bank.swift` so the recipient subdomain owns the
// ubiquitous language; this file now hosts only the wire envelope.

import Foundation

/// 200-OK response from `GET /api/v1/banks?country=NG`.
public struct BanksListResponse: Codable, Sendable {
    public let banks: [Bank]

    public init(banks: [Bank]) {
        self.banks = banks
    }
}
