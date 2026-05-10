// KYCIntroViewModelTests.swift  (Phase 1 · U22)
// TDD spec for the KYC intro screen view model.

import XCTest
@testable import Kolaleaf

@MainActor
final class KYCIntroViewModelTests: XCTestCase {

    private func makeVM(
        api: AuthAPI,
        onAccessToken: @escaping (KYCSession) -> Void = { _ in }
    ) -> KYCIntroViewModel {
        KYCIntroViewModel(api: api, onAccessToken: onAccessToken)
    }

    private let stubSession = KYCSession(
        applicantId: "appl_1",
        accessToken: "tok_sumsub_abc",
        verificationUrl: "https://sumsub/v?t=abc"
    )

    func test_startVerification_fetchesToken_andCallsOnAccessToken() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            KYCEndpoints.InitiateAccessToken.self,
            KycInitiateResponse(applicantId: stubSession.applicantId,
                                accessToken: stubSession.accessToken,
                                verificationUrl: stubSession.verificationUrl)
        )

        var captured: KYCSession?
        let vm = makeVM(api: api) { captured = $0 }
        await vm.startVerification()

        XCTAssertEqual(captured?.applicantId, stubSession.applicantId)
        XCTAssertEqual(captured?.accessToken, stubSession.accessToken,
                       "P1 fix: accessToken must round-trip through to KYCSession (Phase 2 SDK requires it).")
        XCTAssertEqual(captured?.verificationUrl, stubSession.verificationUrl)
        XCTAssertNil(vm.errorMessage)
    }

    /// P1 fix (Phase 1 review): the previous version of this test used `Task.yield()`
    /// then asserted `isFetchingToken == true`, which raced against FakeAPIClient
    /// resolving synchronously — the in-flight assertion ran AFTER the defer.
    /// Stage with a 50ms delay so the in-flight window is observable.
    func test_startVerification_setsIsFetchingToken_thenClears() async {
        let api = FakeAPIClient()
        await api.stageSuccessWithDelay(
            KYCEndpoints.InitiateAccessToken.self,
            KycInitiateResponse(applicantId: stubSession.applicantId,
                                accessToken: stubSession.accessToken,
                                verificationUrl: stubSession.verificationUrl),
            nanoseconds: 50_000_000
        )
        let vm = makeVM(api: api)
        XCTAssertFalse(vm.isFetchingToken)

        let task = Task { await vm.startVerification() }
        try? await Task.sleep(nanoseconds: 10_000_000)   // let the VM enter the await
        XCTAssertTrue(vm.isFetchingToken,
                      "VM should be in-flight while the staged 50ms delay is still pending")
        await task.value
        XCTAssertFalse(vm.isFetchingToken)
    }

    func test_startVerification_failure_setsErrorMessage() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            KYCEndpoints.InitiateAccessToken.self,
            .server(status: 500, message: "kyc_initiate_failed")
        )

        var called = false
        let vm = makeVM(api: api) { _ in called = true }
        await vm.startVerification()

        XCTAssertFalse(called)
        XCTAssertNotNil(vm.errorMessage)
    }

    func test_startVerification_409_setsAlreadyVerifiedMessage() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            KYCEndpoints.InitiateAccessToken.self,
            .server(status: 409, message: "KYC already verified")
        )
        let vm = makeVM(api: api)
        await vm.startVerification()

        XCTAssertEqual(vm.errorMessage, "KYC already verified",
                       "P2 fix: the 409 mapping should pass the backend's human message through, not a generic placeholder.")
    }

    func test_startVerification_unauthorized_promptsToSignInAgain() async {
        let api = FakeAPIClient()
        await api.stageFailure(KYCEndpoints.InitiateAccessToken.self, .unauthorized)
        let vm = makeVM(api: api)
        await vm.startVerification()
        XCTAssertNotNil(vm.errorMessage)
        XCTAssertTrue(vm.errorMessage?.lowercased().contains("sign in") ?? false,
                      "P2 fix: 401 should tell the user to sign in again, got: \(vm.errorMessage ?? "nil")")
    }

    func test_startVerification_429_surfacesRetryAfter() async {
        let api = FakeAPIClient()
        await api.stageFailure(KYCEndpoints.InitiateAccessToken.self, .rateLimited(retryAfter: 30))
        let vm = makeVM(api: api)
        await vm.startVerification()

        XCTAssertNotNil(vm.errorMessage)
        XCTAssertTrue(vm.errorMessage?.contains("30") ?? false,
                      "Expected retry-after seconds in message, got: \(vm.errorMessage ?? "nil")")
    }
}
