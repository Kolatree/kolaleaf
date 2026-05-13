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
    /// Phase 10 · U76b4: split into per-origin hooks so background
    /// traffic (push-token sync, 5s fallback polls) doesn't reset the
    /// user-touch idle clock and mask a walked-away user.
    private var onUserSuccess: (@Sendable () async -> Void)?
    private var onSystemSuccess: (@Sendable () async -> Void)?

    public init(baseURL: URL) {
        self.baseURL = baseURL
        self.builder = RequestBuilder(baseURL: baseURL)

        // App-Group-scoped cookie jar so the auth session can't leak to
        // URLSession.shared or to a future Sumsub WKWebView instance,
        // while still being a real working storage.
        //
        // ROOT CAUSE FIX (2026-05-13 production hotfix):
        //   The earlier code used `HTTPCookieStorage()` (direct init) to
        //   create a "private" cookie jar. Apple's HTTPCookieStorage API
        //   does NOT support direct instantiation — `HTTPCookieStorage()`
        //   returns a phantom storage object that silently drops every
        //   cookie passed to `setCookies(_:for:mainDocumentURL:)`. Verified
        //   reproducible in a standalone Swift test: a single valid Set-
        //   Cookie with future `Max-Age` results in 0 cookies in the jar
        //   on `HTTPCookieStorage()` vs 1 cookie on `.shared`.
        //
        //   Consequence: every authenticated request after `/auth/login`
        //   went out cookieless and the backend returned 401 "session
        //   expired". From the user's POV: they could log in, but the
        //   immediate `/account/me` bootstrap call failed — leaving them
        //   stranded on the loading shell (or, after the bootstrap-error
        //   UI landed, on the recoverable error screen).
        //
        //   The supported APIs for an isolated cookie jar are:
        //     • `HTTPCookieStorage.shared`  (process-wide; URLSession.shared
        //        sees it too — leak surface)
        //     • `HTTPCookieStorage.sharedCookieStorage(forGroupContainerIdentifier:)`
        //        (per-app-group; isolated from .shared and from the
        //        widget's own private jar unless the widget opts in via
        //        the same identifier — which is the case here since the
        //        widget's entitlement file lists `group.com.kolaleaf.shared`)
        //
        //   We pick the App-Group-scoped option using the same identifier
        //   the widget extension already declares
        //   (`group.com.kolaleaf.shared` — see project.yml entitlements).
        //
        // ADV-P10B-C9 (Phase 10C iter-1) — threat-model decision:
        //   The widget extension entitlement declaration means the
        //   widget *could* read this cookie jar if a future code change
        //   added networking imports to the widget target. Removing the
        //   App Group from the widget would force an App Store
        //   entitlement-profile re-review (see comment in
        //   `KolaleafWidgets.entitlements`), so we keep the group and
        //   instead enforce widget purity mechanically:
        //   `KolaleafTests/Security/WidgetCookieIsolationTests.swift`
        //   fails the build if any widget Swift file references
        //   `URLSession`, `URLRequest`, `HTTPCookieStorage`, or
        //   `URLSessionConfiguration`. With no networking surface
        //   reachable from the widget process, the theoretical cookie
        //   exposure is inert — the widget can hold a copy of the
        //   cookies but has no API to use them.
        //
        //   Option (b) — keep App-Group + add per-call user-binding
        //   token — is heavier and was rejected in favour of the
        //   mechanical-enforcement approach.
        let cookieStorage = HTTPCookieStorage.sharedCookieStorage(
            forGroupContainerIdentifier: "group.com.kolaleaf.shared"
        )
        cookieStorage.cookieAcceptPolicy = .always
        self.cookieStorage = cookieStorage

        let config = URLSessionConfiguration.default
        config.httpCookieStorage = cookieStorage
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 15      // r2 reliability fix: 60s default is too long
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(Self.iso8601WithFractionalSeconds)
        self.decoder = decoder
    }

    /// Hook called on every successful 2xx HTTP response for `.user`-origin
    /// endpoints (Phase 10 · U76b4). Resets the user-touch idle clock.
    public func setUserSuccessHook(_ hook: @escaping @Sendable () async -> Void) {
        self.onUserSuccess = hook
    }

    /// Hook called on every successful 2xx HTTP response for `.system`-origin
    /// endpoints (push-token sync, fallback polls). Does NOT reset the
    /// user-touch idle clock — system traffic must not mask an absent user.
    public func setSystemSuccessHook(_ hook: @escaping @Sendable () async -> Void) {
        self.onSystemSuccess = hook
    }

    /// Clears the private cookie jar. Used by `KolaleafApp.forceReauth()` so a
    /// stale session cookie cannot be replayed if `/auth/logout` fails (r2 fix #9).
    /// Also useful in tests for resetting between scenarios.
    public func clearCookies() {
        cookieStorage.cookies?.forEach { cookieStorage.deleteCookie($0) }
    }

    /// Sends an endpoint and decodes the response. Convenience
    /// overload — defaults `origin` to `.user`. Background pollers and
    /// the push-token sync MUST call the `(_:origin:)` overload with
    /// `.system` so their successes don't reset the user-touch idle
    /// clock (CA-2004 / API-2006 / ADV-P10B-W7).
    public func send<E: Endpoint>(_ endpoint: E) async -> Result<E.Response, APIError> {
        await send(endpoint, origin: .user)
    }

    /// Sends an endpoint and decodes the response. `origin` selects
    /// which success hook fires on 2xx — `.user` resets the idle
    /// clock; `.system` does not.
    public func send<E: Endpoint>(
        _ endpoint: E,
        origin: RequestOrigin
    ) async -> Result<E.Response, APIError> {
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

        // Phase 1 review fix (advisory): eagerly commit any Set-Cookie headers
        // into our private cookieStorage BEFORE returning success. URLSession
        // ordinarily writes cookies to the configured storage during request
        // teardown, but on iOS 17+ with `.onlyFromMainDocumentDomain` policy
        // the commit can race against a follow-up request issued from the same
        // RunLoop tick — observed as cookieless next-requests after a
        // session-issuing endpoint (e.g. complete-registration → kyc/initiate).
        // Parsing the response headers and writing the cookies synchronously
        // closes the window: the cookie is in the jar by the time send(_:)
        // returns, regardless of URLSession's internal scheduling.
        if let url = http.url,
           let headerFields = http.allHeaderFields as? [String: String] {
            let cookies = HTTPCookie.cookies(
                withResponseHeaderFields: headerFields,
                for: url
            )
            if !cookies.isEmpty {
                cookieStorage.setCookies(cookies, for: url, mainDocumentURL: url)
            }
        }

        // Success path: fire hook AFTER successful decode (ADV-P10B-W8).
        // The earlier "fire BEFORE decode" pattern bumped the user-touch
        // idle clock for 200-with-malformed-body responses that the user
        // perceives as a failure (corrupt upstream proxy, HTML 200 from a
        // misconfigured edge, partial response). Firing post-decode means
        // the hook only marks the user as present when the response was
        // both 2xx AND a usable payload.
        // Origin (user vs system) selects which hook fires (U76b4).
        if (200..<300).contains(http.statusCode) {
            // 202 verification-required: surface as a typed APIError so callers can route
            // to the verify-email screen instead of misinterpreting as 200 success.
            // No hook fire — verification-required is not user-success.
            if http.statusCode == 202,
               let v = try? decoder.decode(LoginVerificationRequiredResponse.self, from: data) {
                return .failure(.verificationRequired(email: v.email, message: v.message))
            }

            // Empty-body fast path. Static type match avoids the runtime-cast trick
            // that fails for non-EmptyResponse types.
            if data.isEmpty {
                if E.Response.self == EmptyResponse.self {
                    await fireSuccessHook(origin: origin)
                    return .success(EmptyResponse() as! E.Response)
                }
                // 204 with a non-Empty Response type — try parsing an empty object so
                // DTOs with all-optional fields decode cleanly.
                if let empty = try? decoder.decode(E.Response.self, from: Data("{}".utf8)) {
                    await fireSuccessHook(origin: origin)
                    return .success(empty)
                }
                return .failure(.decode("Empty body for non-EmptyResponse endpoint"))
            }

            do {
                let decoded = try decoder.decode(E.Response.self, from: data)
                await fireSuccessHook(origin: origin)
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

    private func fireSuccessHook(origin: RequestOrigin) async {
        switch origin {
        case .user:
            if let hook = onUserSuccess { await hook() }
        case .system:
            if let hook = onSystemSuccess { await hook() }
        }
    }

    /// Parses Retry-After: either delta-seconds (integer or float) OR HTTP-date.
    /// Defaults are caller-side, not here.
    ///
    /// Iter-3 (ADV5-IT2-002): every parsed form is clamped to ≥ 0 so a
    /// buggy/malicious server returning `Retry-After: -5` cannot push
    /// a negative cooldown to downstream consumers. The retrier
    /// applies a second clamp (≤ `maxRetryAfter`) so the caller cannot
    /// blow up its time budget either; this is defense-in-depth at
    /// the parse boundary.
    private func parseRetryAfter(from http: HTTPURLResponse) -> TimeInterval? {
        guard let raw = http.value(forHTTPHeaderField: "Retry-After") else { return nil }
        if let secs = TimeInterval(raw) { return max(0, secs) }
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
