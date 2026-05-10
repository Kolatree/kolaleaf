// KYCSoftRejectionViewModel.swift  (Phase 2 · U26)
// Drives the soft-rejection screen. The retry CTA hits POST /kyc/retry, which
// is atomic: it mints a fresh Sumsub access-token + URL AND flips the user's
// status from REJECTED → IN_REVIEW. On success, fires `onRetryReady(session)`
// so the parent coordinator can route into the pre-warm shell.

import Foundation
import Observation

@MainActor
@Observable
public final class KYCSoftRejectionViewModel {

    public private(set) var isSubmitting: Bool = false
    public private(set) var inlineError: String?

    private let api: AuthAPI
    private let onRetryReady: (KYCSession) -> Void

    public init(api: AuthAPI, onRetryReady: @escaping (KYCSession) -> Void) {
        self.api = api
        self.onRetryReady = onRetryReady
    }

    public func retry() async {
        isSubmitting = true
        inlineError = nil
        defer { isSubmitting = false }

        let result = await api.send(KYCEndpoints.Retry())
        switch result {
        case .success(let response):
            // Backend returns accessToken + verificationUrl only; the
            // applicantId is the same one stored on the user (we don't get
            // it back). KYCSession holds applicantId only for symmetry — at
            // retry-time iOS doesn't strictly need it (Sumsub re-resolves
            // from the verificationUrl). Pass an empty string to avoid
            // creating a fake one.
            onRetryReady(KYCSession(
                applicantId: "",
                accessToken: response.accessToken,
                verificationUrl: response.verificationUrl
            ))
        case .failure(let error):
            inlineError = userFacingMessage(for: error)
        }
    }

    private func userFacingMessage(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            return "Your session expired. Please sign in again."
        case .server(let status, let message) where status == 409:
            // 409: backend says retry isn't valid (status isn't REJECTED).
            // Surface the human message; the user is likely in IN_REVIEW or
            // VERIFIED already and the next /kyc/status poll will reconcile.
            return message ?? "This isn't a retry-able state. Try refreshing."
        case .rateLimited(let after):
            return "Too many attempts. Try again in \(Int(after)) seconds."
        case .transport:
            return "Connection problem. Please check your network."
        default:
            return error.errorDescription ?? "Couldn't start retry. Please try again."
        }
    }
}
