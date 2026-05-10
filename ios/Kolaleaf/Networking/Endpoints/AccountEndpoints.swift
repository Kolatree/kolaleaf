// AccountEndpoints.swift  (Phase 3 · U29/U30 — PostKYC)
// Endpoint conformances for /api/v1/account/me. Both verbs (GET + PATCH)
// live here as the canonical home — `/account/me` is an Account surface,
// not an Auth surface. `AuthEndpoints.Me` is a backward-compatible
// typealias kept for older call sites.
//
// API-002 fix: `Me` was originally declared inside AuthEndpoints (Phase 0
// alongside Login + 2FA). Moving it here groups the two `/account/me`
// verbs together and lets PostKYC code call `AccountEndpoints.Me()`
// rather than reach across into Auth.
//
// Schema reference: `src/app/api/v1/account/me/_schemas.ts`.
//
// Patterns follow KYCEndpoints exactly:
//   • One Endpoint struct per backend verb.
//   • The PATCH body is a Codable struct (`PatchMeBody`), encoded as JSON
//     by `RequestBuilder` in `Endpoint.swift`.
//   • All response decoding goes through `MeResponse` so GET and PATCH
//     return the same shape — matches the backend's `loadAccountMe`
//     helper.

import Foundation

public enum AccountEndpoints {

    /// `GET /api/v1/account/me` — canonical declaration.
    public struct Me: Endpoint {
        public typealias Response = MeResponse
        public let path = "/api/v1/account/me"
        public let method: HTTPMethod = .get
        public init() {}
    }

    /// `PATCH /api/v1/account/me` — partial update.
    ///
    /// The backend treats every field as optional; iOS encodes only the
    /// fields the caller set on `PatchMeBody`. JSONEncoder skips
    /// `Optional.none` automatically, so a body of `{displayName: "X"}`
    /// updates only the display name and leaves other columns alone.
    /// Empty strings normalise to NULL on the server (see
    /// `NullableIdentityString` in `_schemas.ts`).
    ///
    /// Returns the full `MeResponse` after the write so callers can
    /// refresh local state from the canonical row in one round-trip.
    public struct PatchMe: Endpoint {
        public typealias Response = MeResponse
        public let path = "/api/v1/account/me"
        public let method: HTTPMethod = .patch
        public let body: (any Encodable & Sendable)?

        public init(_ body: PatchMeBody) {
            self.body = body
        }
    }
}
