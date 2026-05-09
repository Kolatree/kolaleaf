// Endpoint.swift  (Phase 0 · U11)
// Endpoint protocol + URLRequest builder.
//
// The Endpoint protocol is intentionally tiny — `path`, `method`, `body`, `query` —
// and consumed by `APIClient.send(_:)`. Each backend route gets one Endpoint type.

import Foundation

public enum HTTPMethod: String, Sendable {
    case get    = "GET"
    case post   = "POST"
    case patch  = "PATCH"
    case put    = "PUT"
    case delete = "DELETE"
}

/// Type-erased body. Per-endpoint structs are Encodable; we wrap as AnyEncodable so
/// the Endpoint protocol stays simple (no `associatedtype Body`).
public struct AnyEncodable: Encodable, Sendable {
    private let _encode: @Sendable (Encoder) throws -> Void
    public init<T: Encodable & Sendable>(_ value: T) {
        self._encode = { try value.encode(to: $0) }
    }
    public func encode(to encoder: Encoder) throws { try _encode(encoder) }
}

public protocol Endpoint: Sendable {
    associatedtype Response: Decodable & Sendable

    /// Path under the API base URL (e.g. `/api/v1/auth/login`). Leading slash required.
    var path: String { get }
    var method: HTTPMethod { get }
    /// Optional URL query items.
    var query: [URLQueryItem] { get }
    /// Encoded JSON body, if any.
    var body: AnyEncodable? { get }
    /// Headers added on top of `APIClient` defaults (Content-Type, Accept, cookies).
    var extraHeaders: [String: String] { get }
}

public extension Endpoint {
    var query: [URLQueryItem] { [] }
    var body: AnyEncodable? { nil }
    var extraHeaders: [String: String] { [:] }
}

// MARK: - Request builder

enum EndpointBuilderError: Error {
    case invalidURL
    case encodingFailed(Error)
}

struct RequestBuilder {
    let baseURL: URL

    func makeRequest<E: Endpoint>(for endpoint: E) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(endpoint.path),
                                             resolvingAgainstBaseURL: false) else {
            throw EndpointBuilderError.invalidURL
        }
        if !endpoint.query.isEmpty {
            components.queryItems = endpoint.query
        }
        guard let url = components.url else { throw EndpointBuilderError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        for (k, v) in endpoint.extraHeaders {
            request.setValue(v, forHTTPHeaderField: k)
        }

        if let body = endpoint.body {
            do {
                let encoder = JSONEncoder()
                encoder.dateEncodingStrategy = .iso8601
                request.httpBody = try encoder.encode(body)
            } catch {
                throw EndpointBuilderError.encodingFailed(error)
            }
        }

        return request
    }
}
