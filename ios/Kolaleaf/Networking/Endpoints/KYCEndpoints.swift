// KYCEndpoints.swift  (Phase 1 · U22)
// Endpoint conformances for /api/v1/kyc/*. Schema reference:
//   src/app/api/v1/kyc/initiate/_schemas.ts
//
// Initiate response: `{ applicantId: string, verificationUrl: string }`.
// The `verificationUrl` is the Sumsub WebSDK URL the iOS app loads in U24
// once the native SDK isn't available.

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
}
