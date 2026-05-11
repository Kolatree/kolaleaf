// RecipientsEndpoints.swift  (Phase 4 · U36 + U37)
// Endpoint conformances for /api/v1/recipients/*. Schema reference:
//   src/app/api/v1/recipients/_schemas.ts
//   src/app/api/v1/recipients/resolve/_schemas.ts
//
// Pattern follows KYCEndpoints / AccountEndpoints exactly — namespaced
// enum with one Endpoint struct per backend verb.

import Foundation

public enum RecipientsEndpoints {

    /// `GET /api/v1/recipients` — list recipients owned by the
    /// authenticated user. Backend orders by `createdAt desc`.
    public struct List: Endpoint {
        public typealias Response = RecipientsListResponse
        public let path = "/api/v1/recipients"
        public let method: HTTPMethod = .get
        public init() {}
    }

    /// `POST /api/v1/recipients` — create a recipient. Backend
    /// returns 201 + `{ recipient }`. 422 surfaces as
    /// `APIError.validation` if the schema rejects (e.g. blank field).
    public struct Create: Endpoint {
        public typealias Response = CreateRecipientResponse
        public let path = "/api/v1/recipients"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(_ body: CreateRecipientBody) {
            self.body = body
        }
    }

    /// `POST /api/v1/recipients/resolve` — pre-flight bank-account
    /// lookup. Backend returns 200 + `{ accountName }`, 404 on
    /// account-not-found, 503 on provider-down, 429 on rate-limit.
    /// `RecipientResolveService` translates these into `.notFound /
    /// .bankDown` for the UI.
    public struct Resolve: Endpoint {
        public typealias Response = ResolveRecipientResponse
        public let path = "/api/v1/recipients/resolve"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(_ body: ResolveRecipientBody) {
            self.body = body
        }

        public init(bankCode: String, accountNumber: String) {
            self.body = ResolveRecipientBody(
                bankCode: bankCode,
                accountNumber: accountNumber
            )
        }
    }
}
