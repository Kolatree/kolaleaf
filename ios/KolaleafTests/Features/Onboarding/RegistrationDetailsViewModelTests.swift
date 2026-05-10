// RegistrationDetailsViewModelTests.swift  (Phase 1 · U21a)
// TDD spec for the registration-details view model.

import XCTest
@testable import Kolaleaf

@MainActor
final class RegistrationDetailsViewModelTests: XCTestCase {

    private func makeVM(
        api: AuthAPI,
        email: String = "user@example.com",
        onRegistered: @escaping (CurrentUser) -> Void = { _ in }
    ) -> RegistrationDetailsViewModel {
        RegistrationDetailsViewModel(email: email, api: api, onRegistered: onRegistered)
    }

    private func fillValid(_ vm: RegistrationDetailsViewModel) {
        vm.fullName = "Ada Lovelace"
        vm.password = "Correct-Horse-1234"
        vm.addressLine1 = "12 Pitt St"
        vm.addressLine2 = ""
        vm.city = "Sydney"
        vm.state = .nsw
        vm.postcode = "2000"
    }

    // MARK: - canSubmit

    func test_canSubmit_falseWithEmptyFields() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_falseWithShortPassword() {
        let vm = makeVM(api: FakeAPIClient())
        fillValid(vm)
        vm.password = "Short1"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_falseWithInvalidPostcode() {
        let vm = makeVM(api: FakeAPIClient())
        fillValid(vm)
        vm.postcode = "12"
        XCTAssertFalse(vm.canSubmit)
        vm.postcode = "abcd"
        XCTAssertFalse(vm.canSubmit)
        vm.postcode = "20000"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_falseWithNameMissingLetter() {
        let vm = makeVM(api: FakeAPIClient())
        fillValid(vm)
        vm.fullName = "12345"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_falseWithShortAddressLine1() {
        let vm = makeVM(api: FakeAPIClient())
        fillValid(vm)
        vm.addressLine1 = "12"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_trueWithAllFieldsValid() {
        let vm = makeVM(api: FakeAPIClient())
        fillValid(vm)
        XCTAssertTrue(vm.canSubmit)
    }

    // MARK: - submit payload

    func test_submit_callsAPIWithExactPayload() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AuthEndpoints.CompleteRegistration.self,
            CompleteRegistrationResponse(user: .init(id: "u1", fullName: "Ada Lovelace"))
        )
        let vm = makeVM(api: api)
        vm.fullName = "  Ada Lovelace  "
        vm.password = "Correct-Horse-1234"
        vm.addressLine1 = "12 Pitt St"
        vm.addressLine2 = ""
        vm.city = "Sydney"
        vm.state = .nsw
        vm.postcode = "2000"
        await vm.submit()

        let body = await api.lastBody(
            for: String(describing: AuthEndpoints.CompleteRegistration.self),
            as: CompleteRegistrationRequest.self
        )
        XCTAssertEqual(body?.email, "user@example.com")
        XCTAssertEqual(body?.fullName, "Ada Lovelace") // trimmed
        XCTAssertEqual(body?.state, "NSW")             // uppercase
        XCTAssertNil(body?.addressLine2)               // empty → nil
        XCTAssertEqual(body?.postcode, "2000")
    }

    // MARK: - success path

    func test_submit_201_callsOnRegistered_withCurrentUser() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AuthEndpoints.CompleteRegistration.self,
            CompleteRegistrationResponse(user: .init(id: "u1", fullName: "Ada Lovelace"))
        )

        var captured: CurrentUser?
        let vm = makeVM(api: api) { captured = $0 }
        fillValid(vm)
        await vm.submit()

        XCTAssertEqual(captured?.id, "u1")
        XCTAssertEqual(captured?.legalName, "Ada Lovelace")
        XCTAssertEqual(captured?.email, "user@example.com")
    }

    // MARK: - error mapping

    func test_submit_409_setsInlineError_emailAlreadyRegistered() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.CompleteRegistration.self,
            .server(status: 409, message: "email_already_registered")
        )

        var called = false
        let vm = makeVM(api: api) { _ in called = true }
        fillValid(vm)
        await vm.submit()

        XCTAssertFalse(called)
        XCTAssertNotNil(vm.inlineErrors["email"])
    }

    func test_submit_422_setsFieldErrors_fromValidationFields() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.CompleteRegistration.self,
            .validation(fields: [
                "password": ["Password must be at least 12 characters"],
                "postcode": ["Postcode must be 4 digits"],
            ])
        )
        let vm = makeVM(api: api)
        fillValid(vm)
        await vm.submit()

        XCTAssertEqual(vm.inlineErrors["password"], "Password must be at least 12 characters")
        XCTAssertEqual(vm.inlineErrors["postcode"], "Postcode must be 4 digits")
    }

    func test_submit_400business_setsRecoverableError() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.CompleteRegistration.self,
            .server(status: 400, message: "claim_expired")
        )
        let vm = makeVM(api: api)
        fillValid(vm)
        await vm.submit()

        XCTAssertNotNil(vm.inlineErrors["form"])
        XCTAssertTrue(vm.inlineErrors["form"]?.lowercased().contains("expired") ?? false,
                      "Expected 'expired' in form-level error, got: \(vm.inlineErrors["form"] ?? "nil")")
    }

    func test_submit_localValidationFailure_doesNotCallAPI() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        // Leave fields empty.
        await vm.submit()
        let calls = await api.calls.count
        XCTAssertEqual(calls, 0)
    }

    // MARK: - state default

    func test_state_defaultsToNSW() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertEqual(vm.state, .nsw)
    }
}
