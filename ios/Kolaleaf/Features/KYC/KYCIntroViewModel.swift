// KYCIntroViewModel.swift  (Phase 1 · U22)
// Drives screen 06: 3-step verification preview, then fetches a Sumsub
// session (`KYCSession`) on user confirmation and hands it to the parent
// for U24 hand-off (native SDK or WKWebView fallback).

import Foundation
import Observation

/// Compact bag carrying the values U24 needs to initialise the Sumsub flow.
///
/// P1 fix (Phase 1 review): added `accessToken`. The backend response carries
/// three required fields and the native Sumsub SDK (Phase 2 / U24a) needs the
/// access token to bootstrap. Earlier draft silently dropped it.
public struct KYCSession: Equatable, Sendable {
    public let applicantId: String
    public let accessToken: String
    public let verificationUrl: String

    public init(applicantId: String, accessToken: String, verificationUrl: String) {
        self.applicantId = applicantId
        self.accessToken = accessToken
        self.verificationUrl = verificationUrl
    }
}

@MainActor
@Observable
public final class KYCIntroViewModel {

    public private(set) var isFetchingToken: Bool = false
    public private(set) var errorMessage: String?

    private let api: AuthAPI
    private let onAccessToken: (KYCSession) -> Void

    public init(api: AuthAPI, onAccessToken: @escaping (KYCSession) -> Void) {
        self.api = api
        self.onAccessToken = onAccessToken
    }

    public func startVerification() async {
        isFetchingToken = true
        errorMessage = nil
        defer { isFetchingToken = false }

        let result = await api.send(KYCEndpoints.InitiateAccessToken())
        switch result {
        case .success(let response):
            onAccessToken(KYCSession(
                applicantId: response.applicantId,
                accessToken: response.accessToken,
                verificationUrl: response.verificationUrl
            ))
        case .failure(let error):
            errorMessage = userFacingMessage(for: error)
        }
    }

    private func userFacingMessage(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            return String(
                localized: "kyc.intro.session_expired",
                defaultValue: "Your session expired. Please sign in again to verify your identity."
            )
        case .server(let status, let message) where status == 409:
            // 409 covers "KYC already verified" and "KYC already in review" — both
            // mean the user shouldn't retry; the route up the stack should bounce them.
            return message ?? String(
                localized: "kyc.intro.already_in_progress",
                defaultValue: "Your verification is already in progress."
            )
        case .rateLimited(let retryAfter):
            return String(
                localized: "common.error.rate_limited",
                defaultValue: "Too many attempts. Try again in \(Int(retryAfter)) seconds."
            )
        case .transport:
            return String(
                localized: "kyc.intro.transport",
                defaultValue: "Connection problem. Please check your network and try again."
            )
        default:
            return error.errorDescription ?? String(
                localized: "kyc.intro.start_failed",
                defaultValue: "Couldn't start verification. Please try again."
            )
        }
    }
}
