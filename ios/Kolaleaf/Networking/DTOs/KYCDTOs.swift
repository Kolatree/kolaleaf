// KYCDTOs.swift  (Phase 1 · U22 · extended in Phase 2 · U24/U25/U26)
// DTOs for the KYC surface. Backend Zod source of truth:
//   src/app/api/v1/kyc/initiate/_schemas.ts
//   src/app/api/v1/kyc/status/_schemas.ts
//   src/app/api/v1/kyc/retry/_schemas.ts

import Foundation

// MARK: - /kyc/initiate

/// Successful response from `POST /api/v1/kyc/initiate`.
///
/// P1 fix (Phase 1 review): backend returns three required fields per
/// `src/app/api/v1/kyc/initiate/_schemas.ts:8-12`. The earlier draft of this
/// DTO declared only `applicantId` and `verificationUrl`; Decodable silently
/// dropped `accessToken`, which is the field Phase 2 (U24a) hands to the
/// native Sumsub SDK. Without it the SDK has nothing to bootstrap with.
public struct KycInitiateResponse: Decodable, Sendable {
    public let applicantId: String
    public let accessToken: String
    public let verificationUrl: String

    public init(applicantId: String, accessToken: String, verificationUrl: String) {
        self.applicantId = applicantId
        self.accessToken = accessToken
        self.verificationUrl = verificationUrl
    }
}

// MARK: - /kyc/status

/// Successful response from `GET /api/v1/kyc/status`. The Zod schema is
/// `.passthrough()` so the wire payload may include additional fields a
/// future backend revision adds (e.g. `rejectionReasons`); we decode only
/// what we need at v1 and ignore the rest.
///
/// `status` decodes to the iOS `KycStatus` enum, which round-trips the
/// authoritative backend rawValues (`PENDING | IN_REVIEW | VERIFIED |
/// REJECTED`) plus an `unknown` sentinel for forward-compat.
public struct KycStatusResponse: Decodable, Sendable {
    public let status: KycStatus
    public let applicantId: String?

    public init(status: KycStatus, applicantId: String? = nil) {
        self.status = status
        self.applicantId = applicantId
    }
}

// MARK: - /kyc/retry

/// Successful response from `POST /api/v1/kyc/retry`. Only valid when the
/// user is currently REJECTED; on success the user flips to IN_REVIEW and
/// gets a fresh access-token + URL so they can re-enter the Sumsub flow.
public struct KycRetryResponse: Decodable, Sendable {
    public let accessToken: String
    public let verificationUrl: String

    public init(accessToken: String, verificationUrl: String) {
        self.accessToken = accessToken
        self.verificationUrl = verificationUrl
    }
}
