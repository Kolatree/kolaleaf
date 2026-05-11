// BankDTOs.swift  (Phase 4 · U37 prerequisite)
// DTOs for the bank-list surface. Backend Zod source of truth:
//   src/app/api/v1/banks/_schemas.ts
//
// Wire shape (200 OK):
//   { "banks": [{ "code": "044", "name": "Access Bank" }, …] }
//
// `Bank` is also `Identifiable` + `Hashable` so SwiftUI's
// `ForEach(banks)` works without a lookup-key helper, and
// `BankPickerSheet` can use it as a `@State` selection target. The
// id is the `code` because that is what the backend treats as the
// stable primary key for resolve calls.

import Foundation

public struct Bank: Codable, Identifiable, Hashable, Sendable {
    public let code: String
    public let name: String

    public var id: String { code }

    public init(code: String, name: String) {
        self.code = code
        self.name = name
    }
}

/// 200-OK response from `GET /api/v1/banks?country=NG`.
public struct BanksListResponse: Codable, Sendable {
    public let banks: [Bank]

    public init(banks: [Bank]) {
        self.banks = banks
    }
}
