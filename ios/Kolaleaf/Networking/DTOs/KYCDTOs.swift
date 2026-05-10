// KYCDTOs.swift  (Phase 1 · U22)
// DTOs for the KYC surface. Backend Zod source of truth:
//   src/app/api/v1/kyc/initiate/_schemas.ts

import Foundation

/// Successful response from `POST /api/v1/kyc/initiate`.
public struct KycInitiateResponse: Decodable, Sendable {
    public let applicantId: String
    public let verificationUrl: String

    public init(applicantId: String, verificationUrl: String) {
        self.applicantId = applicantId
        self.verificationUrl = verificationUrl
    }
}
