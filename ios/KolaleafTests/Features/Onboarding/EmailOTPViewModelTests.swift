// EmailOTPViewModelTests.swift  (Phase 1 · U21)
// TDD spec for the email-OTP screen view model. Covers code-length gating,
// resend countdown, and backend reason-code mapping (wrong_code / expired /
// used / 429).

import XCTest
@testable import Kolaleaf

@MainActor
final class EmailOTPViewModelTests: XCTestCase {

    private func makeVM(
        api: AuthAPI,
        email: String = "user@example.com",
        onVerified: @escaping () -> Void = {}
    ) -> EmailOTPViewModel {
        EmailOTPViewModel(email: email, api: api, onVerified: onVerified)
    }

    // MARK: - canSubmit

    func test_canSubmit_trueAt6Digits() {
        let vm = makeVM(api: FakeAPIClient())
        vm.code = "123456"
        XCTAssertTrue(vm.canSubmit)
    }

    func test_canSubmit_falseAt5Digits() {
        let vm = makeVM(api: FakeAPIClient())
        vm.code = "12345"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_falseWhileSubmitting() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.VerifyEmailCode.self, VerifyCodeResponse(verified: true))
        let vm = makeVM(api: api)
        vm.code = "123456"
        let task = Task { await vm.submit() }
        await Task.yield()
        XCTAssertFalse(vm.canSubmit)
        await task.value
    }

    // MARK: - resend gating

    func test_canResend_falseDuringCountdown() {
        let vm = makeVM(api: FakeAPIClient())
        // Countdown starts at 60.
        XCTAssertFalse(vm.canResend)
    }

    func test_canResend_trueWhenCountdownAtZero() {
        let vm = makeVM(api: FakeAPIClient())
        vm.tickCountdownForTesting(to: 0)
        XCTAssertTrue(vm.canResend)
    }

    // MARK: - submit success / error mapping

    func test_submit_verified_callsOnVerified() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.VerifyEmailCode.self, VerifyCodeResponse(verified: true))

        var called = false
        let vm = makeVM(api: api) { called = true }
        vm.code = "123456"
        await vm.submit()

        XCTAssertTrue(called)
        XCTAssertNil(vm.errorMessage)
    }

    func test_submit_wrongCode_setsErrorAndResetsCode() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.VerifyEmailCode.self, .codeInvalid(reason: "wrong_code"))
        let vm = makeVM(api: api)
        vm.code = "111111"
        await vm.submit()

        XCTAssertNotNil(vm.errorMessage)
        XCTAssertEqual(vm.code, "")
    }

    func test_submit_expired_setsExpiredError() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.VerifyEmailCode.self, .codeInvalid(reason: "expired"))
        let vm = makeVM(api: api)
        vm.code = "123456"
        await vm.submit()

        XCTAssertTrue(vm.errorMessage?.lowercased().contains("expired") ?? false,
                      "Expected expired-code message, got: \(vm.errorMessage ?? "nil")")
    }

    func test_submit_used_setsUsedError() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.VerifyEmailCode.self, .codeInvalid(reason: "used"))
        let vm = makeVM(api: api)
        vm.code = "123456"
        await vm.submit()

        XCTAssertTrue(vm.errorMessage?.lowercased().contains("already") ?? false,
                      "Expected already-used message, got: \(vm.errorMessage ?? "nil")")
    }

    func test_submit_429tooManyAttempts_setsRetryError() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.VerifyEmailCode.self, .rateLimited(retryAfter: 60))
        let vm = makeVM(api: api)
        vm.code = "123456"
        await vm.submit()

        XCTAssertNotNil(vm.errorMessage)
        XCTAssertTrue(vm.errorMessage?.contains("60") ?? false,
                      "Expected retry-after seconds in message, got: \(vm.errorMessage ?? "nil")")
    }

    func test_submit_doesNotCallVerifyWhenLessThan6Digits() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.code = "123"
        await vm.submit()
        let calls = await api.calls.count
        XCTAssertEqual(calls, 0)
    }

    // MARK: - resend behaviour

    func test_resend_callsSendCode_andRestartsCountdown() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.SendEmailCode.self, SendCodeResponse(ok: true))
        let vm = makeVM(api: api)
        vm.tickCountdownForTesting(to: 0)
        XCTAssertTrue(vm.canResend)

        await vm.resend()

        let calls = await api.calls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.path, "/api/v1/auth/send-code")
        XCTAssertEqual(vm.resendCountdown, 60)
    }

    func test_resend_blocked_whileCountdownActive() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.SendEmailCode.self, SendCodeResponse(ok: true))
        let vm = makeVM(api: api)
        // Countdown still > 0 (default 60).
        await vm.resend()

        let calls = await api.calls.count
        XCTAssertEqual(calls, 0)
    }

    // MARK: - countdown decrement

    func test_countdownTick_decrementsBy1() {
        let vm = makeVM(api: FakeAPIClient())
        let before = vm.resendCountdown
        vm.tickCountdownForTesting()
        XCTAssertEqual(vm.resendCountdown, before - 1)
    }

    func test_countdownTick_doesNotGoBelowZero() {
        let vm = makeVM(api: FakeAPIClient())
        vm.tickCountdownForTesting(to: 0)
        vm.tickCountdownForTesting()
        XCTAssertEqual(vm.resendCountdown, 0)
    }
}
