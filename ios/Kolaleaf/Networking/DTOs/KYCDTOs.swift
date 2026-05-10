// KYCDTOs.swift  (Phase 1 · U22)
// DTOs for the KYC surface. Backend Zod source of truth:
//   src/app/api/v1/kyc/initiate/_schemas.ts

import Foundation

/// Successful response from `POST /api/v1/kyc/initiate`.
///
/// P1 fix (Phase 1 review): backend returns three required fields per
/// `src/app/api/v1/kyc/initiate/_schemas.ts:8-12`. The earlier draft of this
/// DTO declared only `applicantId` and `verificationUrl`; Decodable silently
/// dropped `accessToken`, which is the field Phase 2 (U24a) will hand to the
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
