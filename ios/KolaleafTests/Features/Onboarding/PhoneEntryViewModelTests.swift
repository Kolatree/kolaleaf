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
        onCodeSent: @escaping (String) -> Void = { _ in }
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
        vm.phone = "abc"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_trueWhenValid() {
        let vm = makeVM(api: FakeAPIClient())
        vm.phone = "0400000000"  // AU local, default +61 dial
        XCTAssertTrue(vm.canSubmit)
    }

    // MARK: - submit happy path

    func test_submit_normalisesAndCallsAPI() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AuthEndpoints.SendPhoneCode.self, SendCodeResponse(ok: true))
        var capturedSent: String?
        let vm = makeVM(api: api) { capturedSent = $0 }
        vm.phone = "0400 000 000"
        await vm.submit()

        XCTAssertEqual(capturedSent, "+61400000000")
        let body = await api.lastBody(
            for: String(describing: AuthEndpoints.SendPhoneCode.self),
            as: SendCodeRequest.self
        )
        XCTAssertEqual(body?.type, "phone")
        XCTAssertEqual(body?.value, "+61400000000")
    }

    // MARK: - local validation failure

    func test_submit_localValidationFailure_doesNotCallAPI() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.phone = "abc"
        await vm.submit()

        XCTAssertEqual(vm.inlineError, "That doesn't look like a valid number.")
        let calls = await api.calls
        XCTAssertEqual(calls.count, 0)
    }

    func test_submit_emptyPhone_setsInlineError() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        await vm.submit()
        XCTAssertEqual(vm.inlineError, "Enter your phone number.")
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
        vm.phone = "0400000000"
        await vm.submit()
        XCTAssertEqual(vm.inlineError, "Number invalid for region")
    }

    func test_submit_429rateLimited_setsRetryError() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.SendPhoneCode.self, .rateLimited(retryAfter: 42))
        let vm = makeVM(api: api)
        vm.phone = "0400000000"
        await vm.submit()
        XCTAssertEqual(vm.inlineError, "Too many attempts. Try again in 42 seconds.")
    }

    func test_submit_transportError_setsConnectionMessage() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.SendPhoneCode.self, .transport("offline"))
        let vm = makeVM(api: api)
        vm.phone = "0400000000"
        await vm.submit()
        XCTAssertEqual(vm.inlineError, "Connection problem. Please check your network.")
    }

    // MARK: - country switching

    func test_canSubmit_recalculatesWhenCountryChanges() {
        let vm = makeVM(api: FakeAPIClient())
        vm.phone = "8012345678"  // NG-style local digits, no leading 0
        // Default country is AU (+61) — the AU validator would accept
        // this as +61 8012345678 (10 digits, within range), so canSubmit=true.
        // Switching to a longer-prefix country still produces an E.164
        // string within the 7-15 digit window.
        if let ng = CountryDialCodes.first(matchingDialCode: "+234") {
            vm.country = ng
            XCTAssertTrue(vm.canSubmit, "NG dial code with valid local should pass")
        } else {
            XCTFail("expected NG in curated country list")
        }
    }
}
