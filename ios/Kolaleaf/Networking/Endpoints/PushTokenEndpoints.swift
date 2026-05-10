// PushTokenEndpoints.swift  (Phase 2 · U28)
// Endpoint conformance for the iOS half of push-token registration.
// Backend route is a follow-up (`POST /api/v1/account/push-tokens`);
// the iOS surface is laid here so PushPermissionService can compile and
// be unit-tested via FakeAPIClient. When the backend lands, no iOS code
// changes — only the route response shape may need DTO confirmation.

import Foundation

public struct RegisterPushTokenRequest: Codable, Sendable {
    /// Hex-encoded APNs device token (lowercase, no spaces/braces).
    public let deviceToken: String
    /// `live_activity` for ActivityKit pushes, `notification` for normal APNs.
    /// Backend uses one endpoint for both per plan.
    public let kind: String
    /// iOS bundle id. Backend can route per-environment.
    public let bundleId: String
    /// Hardware identifier (UIDevice modelIdentifier or similar). Optional.
    public let device: String?

    public init(deviceToken: String, kind: String, bundleId: String, device: String?) {
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
