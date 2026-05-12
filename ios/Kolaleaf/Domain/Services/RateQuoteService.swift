// RateQuoteService.swift  (Phase 6 iter-2 · C1 / OO-001)
// Owns the customer-rate fetch for the Send flow. Extracted from the
// monolith `SendViewModel` so the View Model stays a thin coordinator
// (per OO-001).
//
// Contract:
//   • `loadRate(base:target:)` fetches and stores the latest quote.
//   • The service is the sole authority on rate freshness; ViewModel
//     consults `isStale(now:)` rather than computing it itself.
//   • `staleThreshold` matches the 12h customer-fairness window used
//     across the app; one constant lives here so changes are atomic.

import Foundation
import Observation

/// Snapshot of the most recent successful rate quote.
public struct RateQuote: Equatable, Sendable {
    public let corridorId: String
    public let customerRate: Decimal
    public let effectiveAt: Date

    public init(corridorId: String, customerRate: Decimal, effectiveAt: Date) {
        self.corridorId = corridorId
        self.customerRate = customerRate
        self.effectiveAt = effectiveAt
    }

    /// 12h customer-fairness window — duplicated here so the default
    /// param doesn't reach into MainActor-isolated state. Single source
    /// of truth for the constant remains `RateQuoteService.staleThreshold`;
    /// both surfaces return the same value.
    public static let defaultStaleThreshold: TimeInterval = 12 * 60 * 60

    /// Freshness check. `now` is injected so tests can pin the clock.
    public func isStale(now: Date = Date(),
                        threshold: TimeInterval = RateQuote.defaultStaleThreshold) -> Bool {
        now.timeIntervalSince(effectiveAt) >= threshold
    }
}

@MainActor
@Observable
public final class RateQuoteService {

    /// 12h customer-fairness window. Beyond this we refuse to submit
    /// with the cached rate; the user explicitly refreshes.
    public static let staleThreshold: TimeInterval = 12 * 60 * 60

    private let api: AuthAPI

    public private(set) var quote: RateQuote?
    public private(set) var isLoadingRate: Bool = false
    public private(set) var lastLoadFailed: Bool = false

    public init(api: AuthAPI) {
        self.api = api
    }

    /// Returns `true` if a quote is held AND has not crossed the
    /// stale-threshold. `false` when no quote OR the quote is stale.
    public func isFresh(now: Date = Date()) -> Bool {
        guard let q = quote else { return false }
        return !q.isStale(now: now)
    }

    /// Fetch the current customer rate. Idempotent at the
    /// `isLoadingRate` guard.
    @discardableResult
    public func loadRate(base: String = "AUD", target: String = "NGN") async -> Result<RateQuote, APIError> {
        guard !isLoadingRate else {
            if let q = quote { return .success(q) }
            return .failure(.transport("rate load already in flight"))
        }
        isLoadingRate = true
        defer { isLoadingRate = false }

        let result = await api.send(RatesEndpoints.Quote(base: base, target: target))
        switch result {
        case .success(let response):
            // Malformed numeric string from the backend is a hard
            // contract violation; treat it as a decode failure.
            guard let rate = response.customerRateDecimal else {
                lastLoadFailed = true
                return .failure(.decode("malformed customerRate: \(response.customerRate)"))
            }
            let q = RateQuote(
                corridorId: response.corridorId,
                customerRate: rate,
                effectiveAt: response.effectiveAt
            )
            quote = q
            lastLoadFailed = false
            return .success(q)
        case .failure(let err):
            lastLoadFailed = true
            return .failure(err)
        }
    }
}
