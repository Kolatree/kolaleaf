// PhoneOTPViewModel.swift  (Phase 11A-4 · phone-first onboarding)
//
// Mirror of EmailOTPViewModel for the SMS rail. Same surface
// (code, isSubmitting, errorMessage, resendCountdown, canSubmit,
// canResend, startCountdown, submit, resend) — only the API
// endpoints (VerifyPhoneCode / SendPhoneCode) and the on-screen
// copy differ.

import Foundation
import Observation

@MainActor
@Observable
public final class PhoneOTPViewModel {

    public let phone: String          // E.164 (normalised upstream)
    public var code: String = ""
    public private(set) var isSubmitting: Bool = false
    public private(set) var errorMessage: String?
    public private(set) var resendCountdown: Int = 60

    public var canSubmit: Bool { code.count == 6 && !isSubmitting }
    public var canResend: Bool { resendCountdown == 0 && !isSubmitting }

    private let api: AuthAPI
    private let onVerified: () -> Void
    private var countdownTask: Task<Void, Never>?

    public init(phone: String, api: AuthAPI, onVerified: @escaping () -> Void) {
        self.phone = phone
        self.api = api
        self.onVerified = onVerified
    }

    // MARK: - Countdown

    public func startCountdown() {
        countdownTask?.cancel()
        resendCountdown = 60
        countdownTask = Task { @MainActor [weak self] in
            while let self, self.resendCountdown > 0, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                self.resendCountdown = max(0, self.resendCountdown - 1)
            }
        }
    }

    public func cancelCountdown() {
        countdownTask?.cancel()
        countdownTask = nil
    }

    public func tickCountdownForTesting(to value: Int? = nil) {
        if let value {
            resendCountdown = max(0, value)
        } else {
            resendCountdown = max(0, resendCountdown - 1)
        }
    }

    // MARK: - Submit

    public func submit() async {
        guard code.count == 6 else { return }

        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        let result = await api.send(AuthEndpoints.VerifyPhoneCode(phone: phone, code: code))
        switch result {
        case .success:
            onVerified()
        case .failure(let error):
            errorMessage = userFacingMessage(for: error)
            // Mirror of EmailOTPViewModel: clear the code field for
            // any user-recoverable backend reason so the digits
            // re-render visibly empty and onChange-based auto-submit
            // doesn't silently drop the next entry attempt.
            //
            // 4-lens review fix (silent-failure-hunter): `no_token`
            // and `too_many_attempts` also require a fresh code via
            // Resend — leaving stale digits in the field would cause
            // the OTPField's auto-submit to re-fire the same bad
            // code immediately on next render.
            if case .codeInvalid(let reason) = error,
               ["wrong_code", "expired", "used",
                "no_token", "too_many_attempts"].contains(reason) {
                code = ""
            }
        }
    }

    // MARK: - Resend

    public func resend() async {
        guard canResend else { return }

        code = ""
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        let result = await api.send(AuthEndpoints.SendPhoneCode(phone: phone))
        switch result {
        case .success:
            startCountdown()
        case .failure(let error):
            errorMessage = userFacingMessage(for: error)
        }
    }

    // MARK: - Error mapping

    private func userFacingMessage(for error: APIError) -> String {
        switch error {
        case .codeInvalid(let reason):
            switch reason {
            case "wrong_code": return "That code didn't match. Please try again."
            case "expired":    return "That code has expired. Tap Resend to get a new one."
            case "used":       return "That code has already been used."
            case "no_token":   return "Please request a new code first."
            default:           return "Could not verify the code. Please try again."
            }
        case .rateLimited(let retryAfter):
            return "Too many attempts. Try again in \(Int(retryAfter)) seconds."
        case .transport:
            return "Connection problem. Please check your network."
        case .validation:
            return "Please enter the 6-digit code from your text message."
        default:
            return error.errorDescription ?? "Something went wrong. Please try again."
        }
    }
}
