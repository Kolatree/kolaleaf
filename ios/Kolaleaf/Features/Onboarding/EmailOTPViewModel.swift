// EmailOTPViewModel.swift  (Phase 1 · U21)
// Drives screen 05: 6-digit code entry + countdown-gated resend + verify call.
//
// Design choices:
// • The 60-second resend countdown ticks via a single Task created in
//   `startCountdown()`. The Task self-terminates when `resendCountdown` hits
//   zero. `cancelCountdown()` is exposed for view dismissal.
// • `tickCountdownForTesting()` lets tests advance the countdown deterministically
//   without sleeping. Production callers go through `startCountdown()`.
// • Wrong-code resets `code` so the user re-enters cleanly; other errors
//   leave the entry in place so the user can correct without retyping.

import Foundation
import Observation

@MainActor
@Observable
public final class EmailOTPViewModel {

    public let email: String
    public var code: String = ""
    public private(set) var isSubmitting: Bool = false
    public private(set) var errorMessage: String?
    public private(set) var resendCountdown: Int = 60

    public var canSubmit: Bool { code.count == 6 && !isSubmitting }
    public var canResend: Bool { resendCountdown == 0 && !isSubmitting }

    private let api: AuthAPI
    private let onVerified: () -> Void
    private var countdownTask: Task<Void, Never>?

    public init(email: String, api: AuthAPI, onVerified: @escaping () -> Void) {
        self.email = email
        self.api = api
        self.onVerified = onVerified
    }
    // Cancellation lives on `cancelCountdown()` (called from `View.onDisappear`).
    // A `deinit` would need to touch the @MainActor `countdownTask`, which is
    // disallowed under strict-concurrency.

    // MARK: - Countdown

    /// Starts (or restarts) the 60-second resend countdown. Idempotent — calling
    /// twice cancels the prior tick task before kicking off a fresh one.
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

    /// Test-only countdown control. Production timing flows through `startCountdown()`.
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

        let result = await api.send(AuthEndpoints.VerifyEmailCode(email: email, code: code))
        switch result {
        case .success:
            onVerified()
        case .failure(let error):
            errorMessage = userFacingMessage(for: error)
            // P3 fix (Phase 1 review): clear the code field for any user-recoverable
            // backend reason so the user can retype cleanly. Previously only
            // `wrong_code` reset; `expired`/`used` left stale digits in the boxes
            // and EmailOTPView's onChange-based auto-submit silently dropped the
            // path because `code` didn't change.
            if case .codeInvalid(let reason) = error,
               ["wrong_code", "expired", "used"].contains(reason) {
                code = ""
            }
        }
    }

    // MARK: - Resend

    public func resend() async {
        guard canResend else { return }

        // P3 fix (Phase 1 review): clear the code at the top of resend so the boxes
        // are visibly empty and the user knows the new code starts fresh.
        code = ""
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        let result = await api.send(AuthEndpoints.SendEmailCode(email: email))
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
            return "Please enter the 6-digit code from your email."
        default:
            return error.errorDescription ?? "Something went wrong. Please try again."
        }
    }
}
