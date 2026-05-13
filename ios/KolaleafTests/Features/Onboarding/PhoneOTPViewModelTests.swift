// PhoneOTPViewModelTests.swift  (Phase 11A-4 · phone-first onboarding)
//
// Mirror of EmailOTPViewModelTests for the SMS rail. Locks the
// canSubmit/canResend gates, the verify wire shape that hits
// FakeAPIClient (type='phone', value=E.164, code=…), the resend
// countdown, and the error mapping including the wrong-code/
// expired/used reset semantics that keep OTPField in sync.

import XCTest
@testable import Kolaleaf

@MainActor
final class PhoneOTPViewModelTests: XCTestCase {

    private let PHONE: PhoneNumber = {
        guard case .success(let p) = PhoneNumber.parseE164("+61400000000") else {
            fatalError("PhoneNumber.parseE164 regression — \"+61400000000\" should always parse")
        }
        return p
    }()

    private func makeVM(
        api: AuthAPI,
        onVerified: @escaping () -> Void = {}
    ) -> PhoneOTPViewModel {
        PhoneOTPViewModel(phone: PHONE, api: api, onVerified: onVerified)
    }

    // MARK: - canSubmit / canResend gates

    func test_canSubmit_falseUntilSixDigits() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertFalse(vm.canSubmit)
        vm.code = "12345"
        XCTAssertFalse(vm.canSubmit)
        vm.code = "123456"
        XCTAssertTrue(vm.canSubmit)
    }

    func test_canResend_falseWhileCountdownActive() {
        let vm = makeVM(api: FakeAPIClient())
        vm.tickCountdownForTesting(to: 30)
        XCTAssertFalse(vm.canResend)
        vm.tickCountdownForTesting(to: 0)
        XCTAssertTrue(vm.canResend)
    }

    // MARK: - submit happy path

    func test_submit_callsVerifyPhoneCode_andOnVerified() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.VerifyPhoneCode.self, VerifyCodeResponse(verified: true))
        var verifiedCalled = false
        let vm = makeVM(api: api, onVerified: { verifiedCalled = true })
        vm.code = "123456"
        await vm.submit()

        XCTAssertTrue(verifiedCalled)
        let body = await api.lastBody(
            for: String(describing: AuthEndpoints.VerifyPhoneCode.self),
            as: VerifyCodeRequest.self
        )
        XCTAssertEqual(body?.type, .phone)
        XCTAssertEqual(body?.value, PHONE.e164)
        XCTAssertEqual(body?.code, "123456")
    }

    func test_submit_skippedWhenCodeIncomplete() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.code = "12345"
        await vm.submit()
        let calls = await api.calls
        XCTAssertEqual(calls.count, 0)
    }

    // MARK: - error mapping + recovery

    func test_submit_wrongCode_clearsCodeAndShowsMessage() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.VerifyPhoneCode.self,
            .codeInvalid(reason: "wrong_code")
        )
        let vm = makeVM(api: api)
        vm.code = "999999"
        await vm.submit()

        XCTAssertEqual(vm.errorMessage, "That code didn't match. Please try again.")
        XCTAssertEqual(vm.code, "", "wrong_code MUST clear the field so OTPField re-renders empty")
    }

    func test_submit_expired_clearsCodeWithExpiryMessage() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.VerifyPhoneCode.self,
            .codeInvalid(reason: "expired")
        )
        let vm = makeVM(api: api)
        vm.code = "123456"
        await vm.submit()
        XCTAssertEqual(vm.errorMessage, "That code has expired. Tap Resend to get a new one.")
        XCTAssertEqual(vm.code, "")
    }

    func test_submit_used_clearsCodeWithUsedMessage() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.VerifyPhoneCode.self,
            .codeInvalid(reason: "used")
        )
        let vm = makeVM(api: api)
        vm.code = "123456"
        await vm.submit()
        XCTAssertEqual(vm.errorMessage, "That code has already been used.")
        XCTAssertEqual(vm.code, "")
    }

    func test_submit_429rateLimited_setsRetryMessage() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.VerifyPhoneCode.self, .rateLimited(retryAfter: 18))
        let vm = makeVM(api: api)
        vm.code = "123456"
        await vm.submit()
        XCTAssertEqual(vm.errorMessage, "Too many attempts. Try again in 18 seconds.")
    }

    // MARK: - resend

    func test_resend_callsSendPhoneCode_andRestartsCountdown() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.SendPhoneCode.self, SendCodeResponse(ok: true))
        let vm = makeVM(api: api)
        vm.tickCountdownForTesting(to: 0)
        vm.code = "111111"

        await vm.resend()

        XCTAssertEqual(vm.code, "", "resend MUST clear the entry so the user re-types from empty")
        XCTAssertEqual(vm.resendCountdown, 60, "resend MUST restart the 60s countdown on success")
        let body = await api.lastBody(
            for: String(describing: AuthEndpoints.SendPhoneCode.self),
            as: SendCodeRequest.self
        )
        XCTAssertEqual(body?.type, .phone)
        XCTAssertEqual(body?.value, PHONE.e164)
    }

    func test_resend_blockedWhileCountdownActive() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.tickCountdownForTesting(to: 45)
        await vm.resend()
        let calls = await api.calls
        XCTAssertEqual(calls.count, 0)
    }

    // MARK: - countdown lifecycle

    func test_cancelCountdown_isIdempotent() {
        let vm = makeVM(api: FakeAPIClient())
        vm.cancelCountdown()
        vm.cancelCountdown()  // no crash, no state divergence
        XCTAssertEqual(vm.resendCountdown, 60)
    }
}
