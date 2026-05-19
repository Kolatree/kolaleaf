// PhoneEntryViewModel.swift  (Phase 11A-4 · phone-first onboarding)
//
// Drives the phone-entry screen: country picker + phone field +
// Send-code CTA + "or use email instead" fallback link. Mirror of
// EmailEntryViewModel — same canSubmit + isSubmitting + inlineError
// contract so the parent coordinator routes identically.
//
// Behaviour:
// • `country` is the selected CountryDialCode (defaults to AU).
// • `phoneInput` is the raw input buffer the user typed (kept
//   verbatim for the UI; we do NOT format-as-you-type so the cursor
//   doesn't jump around). E.164 normalisation happens only at submit
//   time via PhoneNumber.parse(dialCode:localNumber:). The name
//   makes the input-buffer-vs-validated-PhoneNumber distinction
//   explicit; `PhoneOTPViewModel.phone` carries the validated value.
// • `inlineError` surfaces backend 422 (fields.value) or a local
//   parse failure (.empty / .malformed) for immediate feedback.
// • `onCodeSent(normalised)` fires with the typed `PhoneNumber` so the
//   parent coordinator can route to `PhoneOTPView(phone:)`.

import Foundation
import Observation

@MainActor
@Observable
public final class PhoneEntryViewModel {

    public var country: CountryDialCode = CountryDialCodes.default
    public var phoneInput: String = ""
    /// Required explicit consent before sending verification and
    /// transfer-status SMS. Starts off so the user makes an affirmative
    /// choice instead of inheriting a pre-checked compliance box.
    public var transactionalOptIn: Bool = false

    public private(set) var isSubmitting: Bool = false
    public private(set) var inlineError: String?

    public var canSubmit: Bool {
        guard !isSubmitting else { return false }
        guard transactionalOptIn else { return false }
        if case .success = PhoneNumber.parse(dialCode: country.dialCode, localNumber: phoneInput) {
            return true
        }
        return false
    }

    private let api: AuthAPI
    private let onCodeSent: (_ phone: PhoneNumber) -> Void

    public init(api: AuthAPI, onCodeSent: @escaping (_ phone: PhoneNumber) -> Void) {
        self.api = api
        self.onCodeSent = onCodeSent
    }

    public func submit() async {
        guard transactionalOptIn else {
            inlineError = String(
                localized: "onboarding.phone.sms_consent_required",
                defaultValue: "Confirm transactional SMS consent to continue."
            )
            return
        }

        let parsed = PhoneNumber.parse(dialCode: country.dialCode, localNumber: phoneInput)
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

        let result = await api.send(AuthEndpoints.SendPhoneCode(phone: normalised))
        switch result {
        case .success:
            onCodeSent(normalised)
        case .failure(let error):
            inlineError = userFacingMessage(for: error)
        }
    }

    // MARK: - Helpers

    private static func message(for err: PhoneNumber.ParseError) -> String {
        switch err {
        case .empty:
            return String(
                localized: "common.phone.empty",
                defaultValue: "Enter your phone number."
            )
        case .malformed:
            return String(
                localized: "common.phone.malformed",
                defaultValue: "That doesn't look like a valid number."
            )
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
            return String(
                localized: "onboarding.phone.validation_failed",
                defaultValue: "Please check your number and try again."
            )
        case .rateLimited(let retryAfter):
            return String(
                localized: "common.error.rate_limited",
                defaultValue: "Too many attempts. Try again in \(Int(retryAfter)) seconds."
            )
        case .transport:
            return String(
                localized: "common.error.connection",
                defaultValue: "Connection problem. Please check your network."
            )
        default:
            return error.errorDescription ?? String(
                localized: "common.error.unknown",
                defaultValue: "Something went wrong. Please try again."
            )
        }
    }
}
