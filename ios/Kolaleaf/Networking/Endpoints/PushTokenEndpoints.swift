// PushTokenEndpoints.swift  (Phase 2 · U28)
// Endpoint conformance for the iOS half of push-token registration.
// Backend route is a follow-up (`POST /api/v1/account/push-tokens`);
// the iOS surface is laid here so PushPermissionService can compile and
// be unit-tested via FakeAPIClient. When the backend lands, no iOS code
// changes — only the route response shape may need DTO confirmation.

import Foundation

/// Tagged enum for the kind of push token being registered. API-2003
/// (Phase 10B iter-2): replaces the earlier free-form `kind: String`
/// so call sites cannot ship typos that the backend would silently
/// accept and bucket into "unknown". Raw values are wire-compatible
/// with the previous string form ("live_activity", "notification") so
/// no backend change is required.
public enum PushTokenKind: String, Codable, Sendable, Hashable, CaseIterable {
    case liveActivity = "live_activity"
    case notification
}

public struct RegisterPushTokenRequest: Codable, Sendable {
    /// Hex-encoded APNs device token (lowercase, no spaces/braces).
    public let deviceToken: String
    /// `live_activity` for ActivityKit pushes, `notification` for normal APNs.
    /// Backend uses one endpoint for both per plan.
    public let kind: PushTokenKind
    /// iOS bundle id. Backend can route per-environment.
    public let bundleId: String
    /// Hardware identifier (UIDevice modelIdentifier or similar). Optional.
    public let device: String?

    public init(deviceToken: String, kind: PushTokenKind, bundleId: String, device: String?) {
        self.deviceToken = deviceToken
        self.kind = kind
        self.bundleId = bundleId
        self.device = device
    }
}

public enum PushTokenEndpoints {

    /// `POST /api/v1/account/push-tokens` — registers an APNs token (backend
    /// follow-up). EmptyResponse so the call is idempotent and a 204 + 200-empty
    /// both decode cleanly.
    ///
    /// CA-2004 / API-2006 / ADV-P10B-W7 (Phase 10C iter-1): origin
    /// is no longer a property on the endpoint. Call sites
    /// (`PushTokenSync`, `PushPermissionService`) pass
    /// `origin: .system` explicitly so push-token registration does
    /// NOT reset the user-touch idle clock.
    public struct Register: Endpoint {
        public typealias Response = EmptyResponse
        public let path = "/api/v1/account/push-tokens"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(_ request: RegisterPushTokenRequest) {
            self.body = request
        }
    }
}
