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

    private let stubSession = KYCSession(applicantId: "appl_1", verificationUrl: "https://sumsub/v?t=abc")

    func test_startVerification_fetchesToken_andCallsOnAccessToken() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            KYCEndpoints.InitiateAccessToken.self,
            KycInitiateResponse(applicantId: stubSession.applicantId,
                                verificationUrl: stubSession.verificationUrl)
        )

        var captured: KYCSession?
        let vm = makeVM(api: api) { captured = $0 }
        await vm.startVerification()

        XCTAssertEqual(captured?.applicantId, stubSession.applicantId)
        XCTAssertEqual(captured?.verificationUrl, stubSession.verificationUrl)
        XCTAssertNil(vm.errorMessage)
    }

    func test_startVerification_setsIsFetchingToken_thenClears() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            KYCEndpoints.InitiateAccessToken.self,
            KycInitiateResponse(applicantId: stubSession.applicantId,
                                verificationUrl: stubSession.verificationUrl)
        )
        let vm = makeVM(api: api)
        XCTAssertFalse(vm.isFetchingToken)

        let task = Task { await vm.startVerification() }
        await Task.yield()
        XCTAssertTrue(vm.isFetchingToken)
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

    func test_startVerification_409_setsErrorMessage_alreadyVerified() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            KYCEndpoints.InitiateAccessToken.self,
            .server(status: 409, message: "KYC already verified")
        )
        let vm = makeVM(api: FakeAPIClient())
        // Re-stage on the actual instance:
        let liveAPI = api
        let vm2 = makeVM(api: liveAPI)
        await vm2.startVerification()

        XCTAssertNotNil(vm2.errorMessage)
        _ = vm
    }

    func test_startVerification_unauthorized_setsErrorMessage() async {
        let api = FakeAPIClient()
        await api.stageFailure(KYCEndpoints.InitiateAccessToken.self, .unauthorized)
        let vm = makeVM(api: api)
        await vm.startVerification()
        XCTAssertNotNil(vm.errorMessage)
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
