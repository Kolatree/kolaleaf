// PhoneEntryViewModel.swift  (Phase 11A-4 · phone-first onboarding)
//
// Drives the phone-entry screen: country picker + phone field +
// Send-code CTA + "or use email instead" fallback link. Mirror of
// EmailEntryViewModel — same canSubmit + isSubmitting + inlineError
// contract so the parent coordinator routes identically.
//
// Behaviour:
// • `country` is the selected CountryDialCode (defaults to AU).
// • `phone` is what the user typed (kept verbatim for the UI; we
//   do NOT format-as-you-type so the cursor doesn't jump around).
//   E.164 normalisation happens only at submit time via
//   PhoneNumber.parse(dialCode:localNumber:).
// • `inlineError` surfaces backend 422 (fields.value) or a local
//   parse failure (.empty / .malformed) for immediate feedback.
// • `onCodeSent(normalisedE164)` fires on success so the parent
//   coordinator can route to `PhoneOTPView(phone:)`.

import Foundation
import Observation

@MainActor
@Observable
public final class PhoneEntryViewModel {

    public var country: CountryDialCode = CountryDialCodes.default
    public var phone: String = ""
    /// Pre-checked per AUSTRAC-required transactional consent. Mirror
    /// of EmailEntryViewModel.transactionalOptIn so the legal-comms
    /// screen later can flip both opt-ins via a single control.
    public var transactionalOptIn: Bool = true

    public private(set) var isSubmitting: Bool = false
    public private(set) var inlineError: String?

    public var canSubmit: Bool {
        guard !isSubmitting else { return false }
        if case .success = PhoneNumber.parse(dialCode: country.dialCode, localNumber: phone) {
            return true
        }
        return false
    }

    private let api: AuthAPI
    private let onCodeSent: (String) -> Void

    public init(api: AuthAPI, onCodeSent: @escaping (String) -> Void) {
        self.api = api
        self.onCodeSent = onCodeSent
    }

    public func submit() async {
        let parsed = PhoneNumber.parse(dialCode: country.dialCode, localNumber: phone)
        let normalised: PhoneNumber
        switch parsed {
        case .success(let p):
            normalised = p
        case .failure(let err):
            inlineError = Self.message(for: err)
            return
        }

        isSubmitting = true
        inlineError = nil
        defer { isSubmitting = false }

        let result = await api.send(AuthEndpoints.SendPhoneCode(phone: normalised.e164))
        switch result {
        case .success:
            onCodeSent(normalised.e164)
        case .failure(let error):
            inlineError = userFacingMessage(for: error)
        }
    }

    // MARK: - Helpers

    private static func message(for err: PhoneNumber.ParseError) -> String {
        switch err {
        case .empty:     return "Enter your phone number."
        case .malformed: return "That doesn't look like a valid number."
        }
    }

    private func userFacingMessage(for error: APIError) -> String {
        switch error {
        case .validation(let fields):
            // Backend reports `fields.value` for discriminated bodies;
            // older builds may surface `fields.phone` or `fields.email`
            // depending on which legacy path got matched. Pick the
            // first available message.
            if let first = fields["value"]?.first { return first }
            if let first = fields["phone"]?.first { return first }
            return "Please check your number and try again."
        case .rateLimited(let retryAfter):
            return "Too many attempts. Try again in \(Int(retryAfter)) seconds."
        case .transport:
            return "Connection problem. Please check your network."
        default:
            return error.errorDescription ?? "Something went wrong. Please try again."
        }
    }
}
