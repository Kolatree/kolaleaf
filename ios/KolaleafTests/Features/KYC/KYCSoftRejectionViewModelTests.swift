// KYCSoftRejectionViewModelTests.swift  (Phase 2 · U26)

import XCTest
@testable import Kolaleaf

@MainActor
final class KYCSoftRejectionViewModelTests: XCTestCase {

    private func makeVM(
        api: AuthAPI,
        onRetryReady: @escaping (KYCSession) -> Void = { _ in }
    ) -> KYCSoftRejectionViewModel {
        KYCSoftRejectionViewModel(api: api, onRetryReady: onRetryReady)
    }

    func test_retry_success_invokesOnRetryReady_withFreshSession() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            KYCEndpoints.Retry.self,
            KycRetryResponse(accessToken: "tok_new", verificationUrl: "https://sumsub.test/v?t=new")
        )

        var captured: KYCSession?
        let vm = makeVM(api: api) { captured = $0 }
        await vm.retry()

        XCTAssertEqual(captured?.accessToken, "tok_new")
        XCTAssertEqual(captured?.verificationUrl, "https://sumsub.test/v?t=new")
        XCTAssertNil(vm.inlineError)
        XCTAssertFalse(vm.isSubmitting)
    }

    func test_retry_409_setsInlineError_doesNotInvokeCallback() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            KYCEndpoints.Retry.self,
            .server(status: 409, message: "Not retry-able right now")
        )

        var called = false
        let vm = makeVM(api: api) { _ in called = true }
        await vm.retry()

        XCTAssertFalse(called)
        XCTAssertEqual(vm.inlineError, "Not retry-able right now")
    }

    func test_retry_unauthorized_setsSignInPrompt() async {
        let api = FakeAPIClient()
        await api.stageFailure(KYCEndpoints.Retry.self, .unauthorized)
        let vm = makeVM(api: api)
        await vm.retry()

        XCTAssertNotNil(vm.inlineError)
        XCTAssertTrue(vm.inlineError?.lowercased().contains("sign in") ?? false)
    }

    func test_retry_429_surfacesRetryAfter() async {
        let api = FakeAPIClient()
        await api.stageFailure(KYCEndpoints.Retry.self, .rateLimited(retryAfter: 60))
        let vm = makeVM(api: api)
        await vm.retry()

        XCTAssertTrue(vm.inlineError?.contains("60") ?? false)
    }
}
