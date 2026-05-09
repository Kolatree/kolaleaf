// APIClient.swift  (Phase 0 · U9)
// Single shared URLSession-backed client. Cookie-based session auth via HTTPCookieStorage.shared.
//
// Important contract (per r2 backend reality):
//   • Backend uses opaque PG-session cookies (HttpOnly, Secure, SameSite=Lax),
//     NOT JWTs. iOS reads cookies via HTTPCookieStorage and never tries to parse them.
//   • Session token is mirrored into the **app-private** Keychain (not App Group)
//     for survival across reinstalls. See Keychain.swift.
//   • Sumsub WKWebView uses a **non-persistent** WKWebsiteDataStore — its cookies
//     do NOT share with this storage. See SumsubWebViewWrapper (Phase 2).

import Foundation

public actor APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let builder: RequestBuilder

    /// Hook called on every successful API call so AppState can bump its idle clock (U76b).
    public var onSuccessfulCall: (@Sendable () async -> Void)?

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.builder = RequestBuilder(baseURL: baseURL)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    public func setSuccessHook(_ hook: @escaping @Sendable () async -> Void) {
        self.onSuccessfulCall = hook
    }

    /// Sends an endpoint and decodes the response.
    public func send<E: Endpoint>(_ endpoint: E) async -> Result<E.Response, APIError> {
        let request: URLRequest
        do {
            request = try builder.makeRequest(for: endpoint)
        } catch {
            return .failure(.transport("Bad request shape: \(error.localizedDescription)"))
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let urlError as URLError {
            return .failure(.transport(urlError.localizedDescription))
        } catch {
            return .failure(.transport(error.localizedDescription))
        }

        guard let http = response as? HTTPURLResponse else {
            return .failure(.transport("Non-HTTP response"))
        }

        // Success path
        if (200..<300).contains(http.statusCode) {
            // Empty-body case — endpoints whose Response is `EmptyResponse` accept zero bytes.
            if data.isEmpty, let empty = EmptyResponse() as? E.Response {
                await fireSuccessHook()
                return .success(empty)
            }
            do {
                let decoded = try decoder.decode(E.Response.self, from: data)
                await fireSuccessHook()
                return .success(decoded)
            } catch {
                return .failure(.decode(error.localizedDescription))
            }
        }

        // Error path: decode `{ error: { code, message } }` envelope.
        let envelope = try? decoder.decode(BackendErrorEnvelope.self, from: data)
        let retryAfter = parseRetryAfter(from: http)
        let mapped = APIError.map(
            httpStatus: http.statusCode,
            code: envelope?.error.code,
            message: envelope?.error.message,
            retryAfter: retryAfter
        )
        return .failure(mapped)
    }

    private func fireSuccessHook() async {
        if let hook = onSuccessfulCall {
            await hook()
        }
    }

    private func parseRetryAfter(from http: HTTPURLResponse) -> TimeInterval? {
        guard let raw = http.value(forHTTPHeaderField: "Retry-After") else { return nil }
        return TimeInterval(raw)
    }
}

// MARK: - Envelope

private struct BackendErrorEnvelope: Decodable {
    struct Inner: Decodable {
        let code: String?
        let message: String?
    }
    let error: Inner
}

/// Decodable placeholder for endpoints with no response body.
public struct EmptyResponse: Decodable, Sendable {
    public init() {}
}
