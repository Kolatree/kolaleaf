// EmailEntryViewModelTests.swift  (Phase 1 · U20)
// TDD spec for the email-entry screen view model.

import XCTest
@testable import Kolaleaf

@MainActor
final class EmailEntryViewModelTests: XCTestCase {

    private func makeVM(
        api: AuthAPI,
        onCodeSent: @escaping (String) -> Void = { _ in }
    ) -> EmailEntryViewModel {
        EmailEntryViewModel(api: api, onCodeSent: onCodeSent)
    }

    // MARK: - canSubmit

    func test_canSubmit_falseWhenEmpty() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_falseWhenInvalidEmail() {
        let vm = makeVM(api: FakeAPIClient())
        vm.email = "not-an-email"
        XCTAssertFalse(vm.canSubmit)
        vm.email = "missing@dot"
        XCTAssertFalse(vm.canSubmit)
        vm.email = "@nohost.com"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_trueWhenValidEmail() {
        let vm = makeVM(api: FakeAPIClient())
        vm.email = "user@example.com"
        vm.transactionalOptIn = true
        XCTAssertTrue(vm.canSubmit)
    }

    func test_canSubmit_falseUntilEmailConsentConfirmed() {
        let vm = makeVM(api: FakeAPIClient())
        vm.email = "user@example.com"
        XCTAssertFalse(vm.canSubmit)
        vm.transactionalOptIn = true
        XCTAssertTrue(vm.canSubmit)
    }

    func test_canSubmit_falseWhileSubmitting() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.SendEmailCode.self, SendCodeResponse(ok: true))
        let vm = makeVM(api: api)
        vm.email = "user@example.com"
        vm.transactionalOptIn = true

        // Kick off submit and immediately assert isSubmitting flips canSubmit off.
        let task = Task { await vm.submit() }
        // Allow the @MainActor task to start.
        await Task.yield()
        XCTAssertFalse(vm.canSubmit)
        await task.value
    }

    // MARK: - submit normalization + success

    func test_submit_normalizesAndCallsAPI() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.SendEmailCode.self, SendCodeResponse(ok: true))
        let vm = makeVM(api: api)
        vm.email = "  USER@Example.COM  "
        vm.transactionalOptIn = true
        await vm.submit()

        let body = await api.lastBody(
            for: String(describing: AuthEndpoints.SendEmailCode.self),
            as: SendCodeRequest.self
        )
        XCTAssertEqual(body?.type, .email)
        XCTAssertEqual(body?.value, "user@example.com")
    }

    func test_submit_invokesOnCodeSent_withNormalizedEmail() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.SendEmailCode.self, SendCodeResponse(ok: true))

        var captured: String?
        let vm = makeVM(api: api) { captured = $0 }
        vm.email = "  USER@Example.COM  "
        vm.transactionalOptIn = true
        await vm.submit()

        XCTAssertEqual(captured, "user@example.com")
    }

    func test_submit_setsIsSubmitting_thenClears() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.SendEmailCode.self, SendCodeResponse(ok: true))
        let vm = makeVM(api: api)
        vm.email = "user@example.com"
        vm.transactionalOptIn = true
        XCTAssertFalse(vm.isSubmitting)
        await vm.submit()
        XCTAssertFalse(vm.isSubmitting)
    }

    // MARK: - error paths

    func test_submit_422validation_setsInlineError_doesNotCallOnCodeSent() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.SendEmailCode.self,
            .validation(fields: ["email": ["Please enter a valid email address"]])
        )

        var called = false
        let vm = makeVM(api: api) { _ in called = true }
        vm.email = "user@example.com"
        vm.transactionalOptIn = true
        await vm.submit()

        XCTAssertFalse(called)
        XCTAssertNotNil(vm.inlineError)
    }

    func test_submit_429rateLimited_setsRetryAfterError() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.SendEmailCode.self,
            .rateLimited(retryAfter: 30)
        )
        let vm = makeVM(api: api)
        vm.email = "user@example.com"
        vm.transactionalOptIn = true
        await vm.submit()

        XCTAssertNotNil(vm.inlineError)
        XCTAssertTrue(vm.inlineError?.contains("30") ?? false,
                      "Expected retry-after seconds in message, got: \(vm.inlineError ?? "nil")")
    }

    func test_submit_500server_setsGenericError() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.SendEmailCode.self,
            .server(status: 500, message: nil)
        )
        let vm = makeVM(api: api)
        vm.email = "user@example.com"
        vm.transactionalOptIn = true
        await vm.submit()

        XCTAssertNotNil(vm.inlineError)
    }

    func test_submit_localValidationFailure_doesNotCallAPI() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.email = "not-an-email"
        vm.transactionalOptIn = true
        await vm.submit()
        let calls = await api.calls.count
        XCTAssertEqual(calls, 0)
        XCTAssertNotNil(vm.inlineError)
    }

    func test_submit_withoutEmailConsent_doesNotCallAPI() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.email = "user@example.com"

        await vm.submit()

        let calls = await api.calls.count
        XCTAssertEqual(calls, 0)
        XCTAssertEqual(vm.inlineError, "Confirm transactional email consent to continue.")
    }

    // MARK: - opt-in checkbox default

    func test_transactionalOptIn_defaultsToFalse() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertFalse(vm.transactionalOptIn)
    }
}
