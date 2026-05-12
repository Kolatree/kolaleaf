// RateDTOs.swift  (Phase 6 · U46)
// DTO shapes for the public rate endpoint. Backend route:
//   src/app/api/v1/rates/public/route.ts
// Response example:
//   {
//     "baseCurrency": "AUD",
//     "targetCurrency": "NGN",
//     "corridorId": "ck...",
//     "customerRate": "1043.50",
//     "effectiveAt": "2026-05-09T01:23:45.000Z"
//   }
//
// Notes:
//   • `customerRate` is shipped as a string so neither end loses
//     decimal precision through JSON's float type. We keep it as a
//     `String` here and parse to `Decimal` at the call site.
//   • Public route — no auth needed. Caches via the server's
//     `Cache-Control: max-age=60, stale-while-revalidate=120`.

import Foundation

public struct RatePublicResponse: Codable, Sendable, Equatable {
    public let baseCurrency: String
    public let targetCurrency: String
    public let corridorId: String
    public let customerRate: String
    public let effectiveAt: Date

    public init(
        baseCurrency: String,
        targetCurrency: String,
        corridorId: String,
        customerRate: String,
        effectiveAt: Date
    ) {
        self.baseCurrency = baseCurrency
        self.targetCurrency = targetCurrency
        self.corridorId = corridorId
        self.customerRate = customerRate
        self.effectiveAt = effectiveAt
    }

    /// Convenience accessor. Returns nil only if the backend ships
    /// a malformed numeric string — which would already have been a
    /// hard contract violation worth surfacing.
    public var customerRateDecimal: Decimal? {
        Decimal(string: customerRate)
    }
}
