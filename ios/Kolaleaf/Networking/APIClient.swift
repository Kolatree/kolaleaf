// APIClient.swift  (Phase 0 · U9)
// Single shared URLSession-backed client. Cookie-based session auth via private
// HTTPCookieStorage owned by this APIClient (not URLSession.shared, per r2 review).
//
// Backend contract (Wave 1):
//   • Opaque PG-session cookies (HttpOnly, Secure, SameSite=Lax). NOT JWTs.
//   • Error envelope: `{ error: string, reason: string }` (NOT `{error: {code, message}}`)
//   • Validation envelope: `{ error, reason: 'validation_failed', fields: Record<string, string[]> }`
//   • Login can return 200 LoginResponse OR 202 LoginVerificationRequiredResponse.
//
// r2-review fixes:
//   • Empty-body fast path now uses static type matching (E.Response.self == EmptyResponse.self).
//   • Retry-After header parsed for both delta-seconds AND HTTP-date forms.
//   • onSuccessfulCall fires for any 2xx (before decode), so backend contract drift
//     doesn't trip the idle-timer false-positive.
//   • 202 verification-required surfaces as APIError.verificationRequired.

import Foundation

public actor APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let cookieStorage: HTTPCookieStorage
    private let decoder: JSONDecoder
    private let builder: RequestBuilder
    private var onSuccessfulCall: (@Sendable () async -> Void)?

    public init(baseURL: URL) {
        self.baseURL = baseURL
        self.builder = RequestBuilder(baseURL: baseURL)

        // Private cookie jar so the auth session can't leak to/from URLSession.shared
        // or future Sumsub WKWebView instances.
        let cookieStorage = HTTPCookieStorage()
        cookieStorage.cookieAcceptPolicy = .onlyFromMainDocumentDomain
        self.cookieStorage = cookieStorage

        let config = URLSessionConfiguration.default
        config.httpCookieStorage = cookieStorage
        config.httpCookieAcceptPolicy = .onlyFromMainDocumentDomain
        config.timeoutIntervalForRequest = 15      // r2 reliability fix: 60s default is too long
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(Self.iso8601WithFractionalSeconds)
        self.decoder = decoder
    }

    /// Hook called on every successful 2xx HTTP response (before decode), so the idle
    /// timer reflects real backend traffic regardless of decode success.
    public func setSuccessHook(_ hook: @escaping @Sendable () async -> Void) {
        self.onSuccessfulCall = hook
    }

    /// Clears the private cookie jar. Used by `KolaleafApp.forceReauth()` so a
    /// stale session cookie cannot be replayed if `/auth/logout` fails (r2 fix #9).
    /// Also useful in tests for resetting between scenarios.
    public func clearCookies() {
        cookieStorage.cookies?.forEach { cookieStorage.deleteCookie($0) }
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

        // Success path: fire hook BEFORE decode so the idle clock reflects the
        // network-level success even if a contract-drift decode fails.
        if (200..<300).contains(http.statusCode) {
            await fireSuccessHook()

            // 202 verification-required: surface as a typed APIError so callers can route
            // to the verify-email screen instead of misinterpreting as 200 success.
            if http.statusCode == 202,
               let v = try? decoder.decode(LoginVerificationRequiredResponse.self, from: data) {
                return .failure(.verificationRequired(email: v.email, message: v.message))
            }

            // Empty-body fast path. Static type match avoids the runtime-cast trick
            // that fails for non-EmptyResponse types.
            if data.isEmpty {
                if E.Response.self == EmptyResponse.self {
                    return .success(EmptyResponse() as! E.Response)
                }
                // 204 with a non-Empty Response type — try parsing an empty object so
                // DTOs with all-optional fields decode cleanly.
                if let empty = try? decoder.decode(E.Response.self, from: Data("{}".utf8)) {
                    return .success(empty)
                }
                return .failure(.decode("Empty body for non-EmptyResponse endpoint"))
            }

            do {
                let decoded = try decoder.decode(E.Response.self, from: data)
                return .success(decoded)
            } catch {
                return .failure(.decode(error.localizedDescription))
            }
        }

        // Error path: 4xx/5xx. Try validation envelope first (richer fields data),
        // then plain envelope.
        let retryAfter = parseRetryAfter(from: http)
        if http.statusCode == 422,
           let v = try? decoder.decode(BackendValidationError.self, from: data) {
            return .failure(.map(httpStatus: 422, reason: v.reason, message: v.error,
                                 fields: v.fields, retryAfter: retryAfter))
        }
        let envelope = try? decoder.decode(BackendError.self, from: data)
        let mapped = APIError.map(
            httpStatus: http.statusCode,
            reason: envelope?.reason,
            message: envelope?.error,
            fields: nil,
            retryAfter: retryAfter
        )
        return .failure(mapped)
    }

    // MARK: - Private

    private func fireSuccessHook() async {
        if let hook = onSuccessfulCall {
            await hook()
        }
    }

    /// Parses Retry-After: either delta-seconds (integer or float) OR HTTP-date.
    /// Defaults are caller-side, not here.
    private func parseRetryAfter(from http: HTTPURLResponse) -> TimeInterval? {
        guard let raw = http.value(forHTTPHeaderField: "Retry-After") else { return nil }
        if let secs = TimeInterval(raw) { return secs }
        if let date = Self.httpDateFormatter.date(from: raw) {
            return max(0, date.timeIntervalSinceNow)
        }
        return nil
    }

    /// Decoder accepting ISO 8601 with fractional seconds (Prisma `.toISOString()` format)
    /// AND without (admin tooling, hand-rolled timestamps).
    @Sendable
    private static func iso8601WithFractionalSeconds(_ decoder: Decoder) throws -> Date {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        if let d = Self.fractionalSecondsFormatter.date(from: raw) { return d }
        if let d = Self.standardISOFormatter.date(from: raw) { return d }
        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Date \(raw) is not ISO 8601"
        )
    }

    // ISO8601DateFormatter / DateFormatter are not Sendable, but the instances
    // here are immutable after init and Foundation guarantees thread-safe `.date(from:)`.
    // `nonisolated(unsafe)` documents that we've audited the access pattern.
    nonisolated(unsafe) private static let fractionalSecondsFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    nonisolated(unsafe) private static let standardISOFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// RFC 7231 IMF-fixdate format used as the HTTP-date variant of Retry-After.
    /// `DateFormatter` is Sendable in current SDKs.
    private static let httpDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "GMT")
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return f
    }()
}
