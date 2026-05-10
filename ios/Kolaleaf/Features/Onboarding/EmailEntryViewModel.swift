// EmailEntryViewModel.swift  (Phase 1 · U20)
// Drives screen 04: email input + transactional-opt-in checkbox + Send-code CTA.
//
// Behaviour:
// • `email` is normalised at submit time (whitespace trimmed, lowercased) so
//   typing cadence doesn't fight the user's keyboard, but the wire payload
//   matches the backend `Email` Zod primitive (trimmed + lowercased).
// • `inlineError` is the human-readable string shown directly under the field;
//   for 422 validation we surface the first email-field message from the
//   backend if present, otherwise a generic prompt.
// • `onCodeSent(normalisedEmail)` is invoked once on success so the parent
//   coordinator can route to `EmailOTPView(email:)`.

import Foundation
import Observation

@MainActor
@Observable
public final class EmailEntryViewModel {

    public var email: String = ""
    /// Pre-checked per AUSTRAC-required transactional consent. Users may opt
    /// out from the legal-comms screen later; payment-related notices still send.
    public var transactionalOptIn: Bool = true

    public private(set) var isSubmitting: Bool = false
    public private(set) var inlineError: String?

    public var canSubmit: Bool {
        !isSubmitting && Self.isValidEmail(normalised(email))
    }

    private let api: AuthAPI
    private let onCodeSent: (String) -> Void

    public init(api: AuthAPI, onCodeSent: @escaping (String) -> Void) {
        self.api = api
        self.onCodeSent = onCodeSent
    }

    public func submit() async {
        let normalisedEmail = normalised(email)
        guard Self.isValidEmail(normalisedEmail) else {
            inlineError = "Please enter a valid email."
            return
        }

        isSubmitting = true
        inlineError = nil
        defer { isSubmitting = false }

        let result = await api.send(AuthEndpoints.SendEmailCode(email: normalisedEmail))
        switch result {
        case .success:
            onCodeSent(normalisedEmail)
        case .failure(let error):
            inlineError = userFacingMessage(for: error)
        }
    }

    // MARK: - Helpers

    private func normalised(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Pragmatic email regex: one local part, one host with at least one dot,
    /// no whitespace. Matches the wire-shape contract — backend's stricter
    /// Zod email check is the authoritative gate.
    private static let emailRegex = try! NSRegularExpression(
        pattern: #"^[^@\s]+@[^@\s]+\.[^@\s]+$"#,
        options: []
    )

    private static func isValidEmail(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return emailRegex.firstMatch(in: value, options: [], range: range) != nil
    }

    private func userFacingMessage(for error: APIError) -> String {
        switch error {
        case .validation(let fields):
            if let first = fields["email"]?.first { return first }
            return "Please check your email and try again."
        case .rateLimited(let retryAfter):
            return "Too many attempts. Try again in \(Int(retryAfter)) seconds."
        case .transport:
            return "Connection problem. Please check your network."
        default:
            return error.errorDescription ?? "Something went wrong. Please try again."
        }
    }
}
