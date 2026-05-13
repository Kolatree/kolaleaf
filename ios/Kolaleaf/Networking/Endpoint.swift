// Endpoint.swift  (Phase 0 · U11)
// Endpoint protocol + URLRequest builder.
//
// r2-review note: AnyEncodable type-erasure removed. Swift 5.9 supports `any Encodable`
// existentials directly, and JSONEncoder.encode<T: Encodable>(_:) accepts them. The
// per-endpoint body declaration becomes a one-liner instead of a wrapper allocation.

import Foundation

public enum HTTPMethod: String, Sendable {
    case get    = "GET"
    case post   = "POST"
    case patch  = "PATCH"
    case put    = "PUT"
    case delete = "DELETE"
}

/// Origin of an API call. Drives whether the success hook resets the
/// user-touch idle clock (Phase 10 · U76b4).
///
/// • `.user`   — the call was triggered by user intent (tap, form
///   submit, pull-to-refresh, screen open). On 2xx it counts as
///   activity and resets the idle window.
/// • `.system` — the call is background plumbing (push-token sync,
///   5-second fallback polls, refresh ticks). On 2xx it does NOT reset
///   the idle window — otherwise the user could be away and the
///   force-reauth at 14 minutes would never fire because polling kept
///   the clock fresh.
///
/// CA-2004 / API-2006 / ADV-P10B-W7 (Phase 10C iter-1): origin is
/// passed at the CALL SITE — `api.send(endpoint, origin: .system)`
/// — instead of being a property on `Endpoint`. The same `Get(id:)`
/// endpoint can now be used by user-driven flows (which default to
/// `.user`) and background pollers (which explicitly opt in to
/// `.system`) without forking the type.
public enum RequestOrigin: Sendable, Hashable, CaseIterable {
    case user
    case system
}

public protocol Endpoint: Sendable {
    associatedtype Response: Decodable & Sendable

    /// Path under the API base URL (e.g. `/api/v1/auth/login`). Leading slash required.
    var path: String { get }
    var method: HTTPMethod { get }
    /// Optional URL query items.
    var query: [URLQueryItem] { get }
    /// Encoded JSON body, if any. Use `any Encodable & Sendable` so each endpoint can
    /// pass a concrete struct directly without wrapping.
    var body: (any Encodable & Sendable)? { get }
    /// Headers added on top of `APIClient` defaults (Content-Type, Accept, cookies).
    var extraHeaders: [String: String] { get }
}

public extension Endpoint {
    var query: [URLQueryItem] { [] }
    var body: (any Encodable & Sendable)? { nil }
    var extraHeaders: [String: String] { [:] }
}

/// Sentinel response type for endpoints whose backend returns an empty body
/// (or `{ success: true }` we don't read). Pair with `APIClient`'s empty-body
/// fast path: `typealias Response = EmptyResponse` makes 204 + 200-empty both
/// decode without consuming the body.
public struct EmptyResponse: Decodable, Sendable, Equatable {
    public init() {}
}

// MARK: - Compatibility: AnyEncodable is preserved as a typealias so existing tests
// and any downstream consumers continue to compile during the migration.

public struct AnyEncodable: Encodable, Sendable {
    private let _encode: @Sendable (Encoder) throws -> Void
    public init<T: Encodable & Sendable>(_ value: T) {
        self._encode = { try value.encode(to: $0) }
    }
    public func encode(to encoder: Encoder) throws { try _encode(encoder) }
}

// MARK: - Request builder

enum EndpointBuilderError: Error {
    case invalidURL
    case encodingFailed(Error)
}

struct RequestBuilder {
    let baseURL: URL

    func makeRequest<E: Endpoint>(for endpoint: E) throws -> URLRequest {
        // Build the URL via URLComponents to handle leading-slash paths and query
        // encoding deterministically. baseURL.appendingPathComponent has well-known
        // edge cases with leading slashes (per adversarial review).
        let trimmedBase = baseURL.absoluteString.trimmingTrailingSlash()
        let trimmedPath = endpoint.path.hasPrefix("/") ? endpoint.path : "/" + endpoint.path
        guard let combined = URL(string: trimmedBase + trimmedPath),
              var components = URLComponents(url: combined, resolvingAgainstBaseURL: false) else {
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

private extension String {
    func trimmingTrailingSlash() -> String {
        hasSuffix("/") ? String(dropLast()) : self
    }
}
