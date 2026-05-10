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
    private(set) public var calls: [Recorded] = []

    public init() {}

    /// Stage the next result for an endpoint type. Use the endpoint's metatype
    /// as the key to disambiguate when the same VM hits multiple endpoints.
    public func stage<E: Endpoint>(_ type: E.Type, result: Result<E.Response, APIError>) {
        stagedResults[String(describing: type)] = result
    }

    /// Convenience: stage a success.
    public func stageSuccess<E: Endpoint>(_ type: E.Type, _ value: E.Response) {
        stage(type, result: .success(value))
    }

    /// Convenience: stage a failure.
    public func stageFailure<E: Endpoint>(_ type: E.Type, _ error: APIError) {
        stage(type, result: .failure(error))
    }

    public func send<E: Endpoint>(_ endpoint: E) async -> Result<E.Response, APIError> {
        let key = String(describing: E.self)
        let bodyData: Data? = {
            guard let body = endpoint.body else { return nil }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            return try? encoder.encode(body)
        }()
        calls.append(Recorded(
            typeName: key,
            path: endpoint.path,
            method: endpoint.method,
            bodyData: bodyData
        ))

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
