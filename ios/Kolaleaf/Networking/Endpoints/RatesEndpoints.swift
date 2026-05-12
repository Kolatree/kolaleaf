// RatesEndpoints.swift  (Phase 6 · U46)
// Endpoint conformance for `GET /api/v1/rates/public?base=&target=`.
//
// Backend route: src/app/api/v1/rates/public/route.ts
//
// This is a PUBLIC endpoint — no auth cookie required. Calling it
// from an authenticated client is harmless; calling it from an
// unauthenticated client (e.g. the marketing landing) is the same
// endpoint, same shape.
//
// The route ships `Cache-Control: max-age=60, stale-while-revalidate=120`
// so a 60-second polling interval is the natural cadence. The
// ViewModel uses a longer 15-minute refresh because the customer rate
// is locked at transfer-create time, and the FX engine updates every
// 15 min.

import Foundation

public enum RatesEndpoints {

    /// `GET /api/v1/rates/public?base=AUD&target=NGN` — most recent
    /// customer rate for a currency pair. Auth-free. Backend returns
    /// 200 + RatePublicResponse, 400 on missing query params, 404 on
    /// corridor-not-found.
    ///
    /// Phase 6 iter-2 (W17 / API-008): "Quote" reads better than
    /// "Public" — this is the customer-facing quote endpoint, not
    /// a general-purpose public API. The old `Public` casing remains
    /// as a typealias so existing call-sites and snapshot tests keep
    /// compiling during the rename.
    public struct Quote: Endpoint {
        public typealias Response = RatePublicResponse
        public let path = "/api/v1/rates/public"
        public let method: HTTPMethod = .get
        public let query: [URLQueryItem]

        public init(base: String = "AUD", target: String = "NGN") {
            self.query = [
                URLQueryItem(name: "base", value: base),
                URLQueryItem(name: "target", value: target),
            ]
        }
    }

    /// Deprecated alias. Prefer `Quote`.
    public typealias Public = Quote
}
