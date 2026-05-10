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
