// AuthAPI.swift  (Phase 1 · U20 prerequisite)
// Single-method protocol so ViewModels can be exercised in tests without
// constructing a real `URLSession`-backed `APIClient`. The production
// `APIClient` actor conforms naturally — `send(_:)` already matches.
//
// Protocol-over-concrete-type is the smallest amount of indirection that lets
// `FakeAPIClient` (test-only, in `KolaleafTests/Helpers`) substitute for the
// real client. ViewModels accept `AuthAPI`, the App injects the concrete
// `APIClient`, and tests inject the fake.

import Foundation

public protocol AuthAPI: Sendable {
    func send<E: Endpoint>(_ endpoint: E) async -> Result<E.Response, APIError>
}

extension APIClient: AuthAPI {}

// MARK: - Feature-scoped repository protocols (W8 / CA-004)
//
// Iter-2 introduces narrow repository surfaces so feature services
// can depend on the operations they actually need rather than the
// blanket `AuthAPI` generic-send. The wholesale `AuthAPI` rename is
// out of scope — too much churn for marginal benefit — but new
// services should prefer the repository protocols so Phase 7's
// retry / circuit-breaker wraps a focused surface.

public protocol RateQuoteRepository: Sendable {
    func fetchQuote(base: String, target: String) async -> Result<RatePublicResponse, APIError>
}

public protocol TransferRepository: Sendable {
    func create(_ body: CreateTransferBody, idempotencyKey: String?) async
        -> Result<CreateTransferResponse, APIError>
    func get(id: String) async -> Result<TransferEnvelope, APIError>
    func issuePayId(id: String) async -> Result<IssuePayIDResponse, APIError>
}

// APIClient conforms naturally — each method routes through the
// existing `send(_:)` so there's no new code path to audit.
extension APIClient: RateQuoteRepository, TransferRepository {
    public func fetchQuote(base: String, target: String) async
        -> Result<RatePublicResponse, APIError>
    {
        await send(RatesEndpoints.Quote(base: base, target: target))
    }

    public func create(_ body: CreateTransferBody, idempotencyKey: String?) async
        -> Result<CreateTransferResponse, APIError>
    {
        await send(TransfersEndpoints.Create(body, idempotencyKey: idempotencyKey))
    }

    public func get(id: String) async -> Result<TransferEnvelope, APIError> {
        await send(TransfersEndpoints.Get(id: id))
    }

    public func issuePayId(id: String) async -> Result<IssuePayIDResponse, APIError> {
        await send(TransfersEndpoints.IssuePayID(id: id))
    }
}
