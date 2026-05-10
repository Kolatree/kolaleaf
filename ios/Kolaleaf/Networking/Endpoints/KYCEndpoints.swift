// KYCEndpoints.swift  (Phase 1 · U22 · extended in Phase 2 · U25/U26)
// Endpoint conformances for /api/v1/kyc/*. Schema reference:
//   src/app/api/v1/kyc/initiate/_schemas.ts
//   src/app/api/v1/kyc/status/_schemas.ts
//   src/app/api/v1/kyc/retry/_schemas.ts

import Foundation

public enum KYCEndpoints {

    /// `POST /api/v1/kyc/initiate` — derives the Sumsub applicant from the
    /// authenticated session; no request body. Returns 401 when unauthenticated,
    /// 409 when KYC is already verified or in review, 429 on rate-limit.
    public struct InitiateAccessToken: Endpoint {
        public typealias Response = KycInitiateResponse
        public let path = "/api/v1/kyc/initiate"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)? = nil
        public init() {}
    }

    /// `GET /api/v1/kyc/status` — polls the user's current KYC status. The
    /// processing screen (U25) polls this every 3 s while foregrounded.
    /// 401 surfaces as `APIError.unauthorized`; 5xx as `.server`.
    public struct Status: Endpoint {
        public typealias Response = KycStatusResponse
        public let path = "/api/v1/kyc/status"
        public let method: HTTPMethod = .get
        public init() {}
    }

    /// `POST /api/v1/kyc/retry` — only valid when current status is REJECTED.
    /// Re-mints a Sumsub access-token + URL and flips the user to IN_REVIEW.
    /// 409 when status is not REJECTED (caller should surface "already in
    /// review / verified" copy and route accordingly).
    public struct Retry: Endpoint {
        public typealias Response = KycRetryResponse
        public let path = "/api/v1/kyc/retry"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)? = nil
        public init() {}
    }
}
