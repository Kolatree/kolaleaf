// FakeAPIClient.swift  (Phase 1 test helper)
// Records sent endpoints and returns canned results. ViewModels accept a real
// `APIClient` actor today, so the fake is also an actor that exposes the same
// `send(_:)` surface the VMs call.
//
// Design notes:
// • Built around the same `Endpoint` protocol the production client uses, so
//   request shapes are exercised end-to-end (URL building still happens in
//   `RequestBuilder` via the production code path when needed).
// • Canned results are keyed by endpoint type identifier so tests can stage
//   distinct responses for distinct endpoints.
// • Captures the most recent body for each endpoint type for payload assertions.

import Foundation
@testable import Kolaleaf

/// Records calls and returns staged results.
public actor FakeAPIClient: AuthAPI {

    public struct Recorded: Sendable {
        public let typeName: String
        public let path: String
        public let method: HTTPMethod
        public let bodyData: Data?
    }

    private var stagedResults: [String: Any] = [:]
    /// Per-endpoint sequence queue. When non-empty, takes precedence over
    /// `stagedResults` for that key. Used by tests that need successive
    /// `send(_:)` calls to return different outcomes (e.g. the auto-retry
    /// loop in `RecipientResolveService`: 3 failures then a success).
    private var stagedSequences: [String: [Any]] = [:]
    private(set) public var calls: [Recorded] = []

    public init() {}

    /// Stage the next result for an endpoint type. Use the endpoint's metatype
    /// as the key to disambiguate when the same VM hits multiple endpoints.
    public func stage<E: Endpoint>(_ type: E.Type, result: Result<E.Response, APIError>) {
        stagedResults[_typeName(type, qualified: true)] = result
    }

    /// Convenience: stage a success.
    public func stageSuccess<E: Endpoint>(_ type: E.Type, _ value: E.Response) {
        stage(type, result: .success(value))
    }

    /// Convenience: stage a failure.
    public func stageFailure<E: Endpoint>(_ type: E.Type, _ error: APIError) {
        stage(type, result: .failure(error))
    }

    /// Stage an ordered queue of results for an endpoint type. The 1st `send`
    /// call returns the 1st item, the 2nd returns the 2nd, and so on. Once
    /// the queue drains, the fake falls back to `stagedResults[key]` (so a
    /// trailing "and then keep returning success" can be expressed with a
    /// `stageSuccess` after the sequence). When neither is set, `send`
    /// returns a transport error as before.
    public func stageSequence<E: Endpoint>(
        _ type: E.Type,
        results: [Result<E.Response, APIError>]
    ) {
        stagedSequences[_typeName(type, qualified: true)] = results
    }

    /// P1 fix (Phase 1 review): delay-injection seam for in-flight assertions.
    ///
    /// Without this, tests that need to observe `vm.isFetchingToken == true` mid-call
    /// race against the fake resolving synchronously. Stage with a small
    /// `nanoseconds` value (e.g. 50ms) so the in-flight window is observable.
    /// `stageSuccessWithDelay` is the success variant; `stageFailureWithDelay` mirrors
    /// it for error paths.
    private var stagedDelays: [String: UInt64] = [:]

    public func stageSuccessWithDelay<E: Endpoint>(
        _ type: E.Type,
        _ value: E.Response,
        nanoseconds: UInt64
    ) {
        stage(type, result: .success(value))
        stagedDelays[_typeName(type, qualified: true)] = nanoseconds
    }

    public func stageFailureWithDelay<E: Endpoint>(
        _ type: E.Type,
        _ error: APIError,
        nanoseconds: UInt64
    ) {
        stage(type, result: .failure(error))
        stagedDelays[_typeName(type, qualified: true)] = nanoseconds
    }

    public func send<E: Endpoint>(_ endpoint: E) async -> Result<E.Response, APIError> {
        // Use fully-qualified type name for the staged-results lookup
        // so nested endpoint types with identical leaf names (e.g.
        // `RecipientsEndpoints.List` vs `TransfersEndpoints.List`)
        // don't collide. Discovered while writing the Phase 8 iter-2
        // syncAll test. `Recorded.typeName` keeps the legacy
        // unqualified form so existing `lastBody(for:)` callers (which
        // pass `String(describing:)`) keep working.
        let key = _typeName(E.self, qualified: true)
        let bodyData: Data? = {
            guard let body = endpoint.body else { return nil }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            return try? encoder.encode(body)
        }()
        calls.append(Recorded(
            typeName: String(describing: E.self),
            path: endpoint.path,
            method: endpoint.method,
            bodyData: bodyData
        ))

        // Honor any staged delay so tests can observe in-flight state.
        if let delayNs = stagedDelays[key] {
            try? await Task.sleep(nanoseconds: delayNs)
        }

        // Sequence queue takes precedence — pop the head when present.
        if var queue = stagedSequences[key], !queue.isEmpty {
            let head = queue.removeFirst()
            stagedSequences[key] = queue
            guard let typed = head as? Result<E.Response, APIError> else {
                return .failure(.transport("FakeAPIClient: sequenced result for \(key) has wrong type"))
            }
            return typed
        }

        guard let staged = stagedResults[key] else {
            return .failure(.transport("FakeAPIClient: no result staged for \(key)"))
        }
        guard let typed = staged as? Result<E.Response, APIError> else {
            return .failure(.transport("FakeAPIClient: staged result for \(key) has wrong type"))
        }
        return typed
    }

    /// Decode the most recent body sent for a given endpoint type.
    public func lastBody<T: Decodable>(for typeName: String, as: T.Type) -> T? {
        guard let recorded = calls.reversed().first(where: { $0.typeName == typeName }),
              let data = recorded.bodyData else {
            return nil
        }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
