// PhoneEntryViewModelTests.swift  (Phase 11A-4 · phone-first onboarding)
//
// Mirror of EmailEntryViewModelTests for the SMS rail. Locks the
// canSubmit guard, the parse-failure messaging, the wire shape that
// hits FakeAPIClient (type='phone', value=E.164), and the error
// mapping for the 422 / 429 / 500 paths.

import XCTest
@testable import Kolaleaf

@MainActor
final class PhoneEntryViewModelTests: XCTestCase {

    private func makeVM(
        api: AuthAPI,
        onCodeSent: @escaping (PhoneNumber) -> Void = { _ in }
    ) -> PhoneEntryViewModel {
        PhoneEntryViewModel(api: api, onCodeSent: onCodeSent)
    }

    // MARK: - canSubmit

    func test_canSubmit_falseWhenEmpty() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_falseWhenInvalid() {
        let vm = makeVM(api: FakeAPIClient())
        vm.phoneInput = "abc"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_trueWhenValid() {
        let vm = makeVM(api: FakeAPIClient())
        vm.phoneInput = "0400000000"  // AU local, default +61 dial
        vm.transactionalOptIn = true
        XCTAssertTrue(vm.canSubmit)
    }

    func test_canSubmit_falseUntilSmsConsentConfirmed() {
        let vm = makeVM(api: FakeAPIClient())
        vm.phoneInput = "0400000000"
        XCTAssertFalse(vm.canSubmit)
        vm.transactionalOptIn = true
        XCTAssertTrue(vm.canSubmit)
    }

    // MARK: - submit happy path

    func test_submit_normalisesAndCallsAPI() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.SendPhoneCode.self, SendCodeResponse(ok: true))
        var capturedSent: PhoneNumber?
        let vm = makeVM(api: api) { capturedSent = $0 }
        vm.phoneInput = "0400 000 000"
        vm.transactionalOptIn = true
        await vm.submit()

        XCTAssertEqual(capturedSent?.e164, "+61400000000")
        let body = await api.lastBody(
            for: String(describing: AuthEndpoints.SendPhoneCode.self),
            as: SendCodeRequest.self
        )
        XCTAssertEqual(body?.type, .phone)
        XCTAssertEqual(body?.value, "+61400000000")
    }

    // MARK: - local validation failure

    func test_submit_localValidationFailure_doesNotCallAPI() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.phoneInput = "abc"
        vm.transactionalOptIn = true
        await vm.submit()

        XCTAssertEqual(vm.inlineError, "That doesn't look like a valid number.")
        let calls = await api.calls
        XCTAssertEqual(calls.count, 0)
    }

    func test_submit_emptyPhone_setsInlineError() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.transactionalOptIn = true
        await vm.submit()
        XCTAssertEqual(vm.inlineError, "Enter your phone number.")
        let calls = await api.calls
        XCTAssertEqual(calls.count, 0)
    }

    func test_submit_withoutSmsConsent_doesNotCallAPI() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.phoneInput = "0400000000"

        await vm.submit()

        XCTAssertEqual(vm.inlineError, "Confirm transactional SMS consent to continue.")
        let calls = await api.calls
        XCTAssertEqual(calls.count, 0)
    }

    // MARK: - backend errors

    func test_submit_422validation_setsInlineError() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.SendPhoneCode.self,
            .validation(fields: ["value": ["Number invalid for region"]])
        )
        let vm = makeVM(api: api)
        vm.phoneInput = "0400000000"
        vm.transactionalOptIn = true
        await vm.submit()
        XCTAssertEqual(vm.inlineError, "Number invalid for region")
    }

    func test_submit_429rateLimited_setsRetryError() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.SendPhoneCode.self, .rateLimited(retryAfter: 42))
        let vm = makeVM(api: api)
        vm.phoneInput = "0400000000"
        vm.transactionalOptIn = true
        await vm.submit()
        XCTAssertEqual(vm.inlineError, "Too many attempts. Try again in 42 seconds.")
    }

    func test_submit_transportError_setsConnectionMessage() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.SendPhoneCode.self, .transport("offline"))
        let vm = makeVM(api: api)
        vm.phoneInput = "0400000000"
        vm.transactionalOptIn = true
        await vm.submit()
        XCTAssertEqual(vm.inlineError, "Connection problem. Please check your network.")
    }

    // MARK: - country switching

    func test_canSubmit_recalculatesWhenCountryChanges() {
        // 4-lens review fix (pr-test-analyzer): the prior assertion
        // was a no-op — `canSubmit` stayed `true` under both AU and
        // NG dial codes for the same digit string, so a broken
        // recompute would also have passed. We now use a string
        // that's VALID under +61 (7+ digits total: "+61400") but
        // INVALID under +1 (7 digits is the E.164 minimum so still
        // valid actually — pick a string that's specifically valid
        // for the LONGER dial code prefix and invalid for the
        // SHORTER one). "12345" + "+234" = "+23412345" = 8 digits
        // valid; "12345" + "+1" = "+112345" = 6 digits invalid.
        let vm = makeVM(api: FakeAPIClient())
        vm.phoneInput = "12345"
        guard let ng = CountryDialCodes.first(matchingDialCode: "+234"),
              let us = CountryDialCodes.first(matchingDialCode: "+1") else {
            return XCTFail("expected NG + US in curated country list")
        }
        vm.country = ng
        vm.transactionalOptIn = true
        XCTAssertTrue(vm.canSubmit, "NG dial code (+234) + 5 local digits = 8 total — should pass E.164 7-15 range")
        vm.country = us
        XCTAssertFalse(vm.canSubmit, "US dial code (+1) + 5 local digits = 6 total — should fail E.164 minimum")
    }

    func test_transactionalOptIn_defaultsToFalse() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertFalse(vm.transactionalOptIn)
    }
}
