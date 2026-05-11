// BanksEndpoints.swift  (Phase 4 · U37 prerequisite)
// Endpoint conformance for `GET /api/v1/banks?country=NG`.
//
// Schema reference: src/app/api/v1/banks/_schemas.ts
//
// Pattern follows KYCEndpoints / AccountEndpoints exactly: namespaced
// enum with one Endpoint struct per backend verb. The `country` query
// is a constructor parameter so callers can extend to KE / GH when the
// payout adapter for those corridors lands; backend rejects any code
// other than "NG" today with 400 unsupported_country.

import Foundation

public enum BanksEndpoints {

    /// `GET /api/v1/banks?country=NG` — bank list for a destination
    /// country. Auth-required (the backend enforces session via
    /// `requireAuth`). Cached client-side via the route's
    /// `Cache-Control: private, max-age=3600` header for follow-up
    /// requests, but consumers should still avoid re-fetching for the
    /// lifetime of a presented sheet.
    public struct List: Endpoint {
        public typealias Response = BanksListResponse
        public let path = "/api/v1/banks"
        public let method: HTTPMethod = .get
        public let query: [URLQueryItem]

        public init(country: String = "NG") {
            self.query = [URLQueryItem(name: "country", value: country)]
        }
    }
}
