// ConfirmAddressViewModelTests.swift  (Phase 3 · U30)
// TDD spec for the PostKYC "Confirm Address" screen view model.
//
// Behaviour anchors:
//   • `load()` reads `/account/me` and pre-fills every address field.
//   • `confirmAddressUnchanged()` shows the existing values and locks
//     the fields read-only.
//   • `startEditingNewAddress()` clears the inputs and unlocks the
//     fields so the user can type a new address.
//   • Inline validation: blank `addressLine1` and non-4-digit
//     `postcode` produce per-field errors that block save.
//   • Save sends the FULL address payload (all six fields) so partial
//     edits don't leave stale columns behind.
//   • Save returns `true` on success / `false` on validation or API
//     failure so the View can branch correctly (API-004 / ADV-13).

import XCTest
@testable import Kolaleaf

@MainActor
final class ConfirmAddressViewModelTests: XCTestCase {

    private func stubMeResponse(
        addressLine1: String? = "1 Smith St",
        addressLine2: String? = "Apt 5",
        city: String? = "Sydney",
        state: String? = "NSW",
        postcode: String? = "2000",
        country: String? = "AU"
    ) -> MeResponse {
        MeResponse(
            userId: "u1",
            fullName: "Ada Lovelace",
            displayName: "Ada",
            primaryEmail: nil,
            secondaryEmails: [],
            twoFactorMethod: nil,
            twoFactorEnabledAt: nil,
            hasVerifiedPhone: false,
            phoneMasked: nil,
            hasRemainingBackupCodes: false,
            backupCodesRemaining: 0,
            addressLine1: addressLine1,
            addressLine2: addressLine2,
            city: city,
            state: state,
            postcode: postcode,
            country: country,
            kycStatus: .verified
        )
    }

    private func makeVM(api: AuthAPI) -> ConfirmAddressViewModel {
        // CA-003: ConfirmAddress no longer takes an AppState — its
        // address fields don't reflect into AppState (no home/nav
        // surface reads them).
        ConfirmAddressViewModel(api: api)
    }

    // MARK: - load

    func test_load_prefillsFromAccountMe() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = makeVM(api: api)
        await vm.load()

        XCTAssertEqual(vm.addressLine1, "1 Smith St")
        XCTAssertEqual(vm.addressLine2, "Apt 5")
        XCTAssertEqual(vm.city, "Sydney")
        XCTAssertEqual(vm.state, .nsw)
        XCTAssertEqual(vm.postcode, "2000")
    }

    func test_load_handlesNullColumns_byShowingEmptyFields() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AccountEndpoints.Me.self,
            stubMeResponse(
                addressLine1: nil, addressLine2: nil, city: nil,
                state: nil, postcode: nil, country: nil
            )
        )

        let vm = makeVM(api: api)
        await vm.load()

        XCTAssertEqual(vm.addressLine1, "")
        XCTAssertEqual(vm.addressLine2, "")
        XCTAssertEqual(vm.city, "")
        XCTAssertEqual(vm.postcode, "")
        // `state` defaults to NSW so the picker has a valid initial
        // value even when the row is null.
        XCTAssertEqual(vm.state, .nsw)
    }

    // MARK: - confirm / startEditing toggle

    func test_isAtPrefilledAddressTrue_keepsExistingValues() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = makeVM(api: api)
        await vm.load()

        // Default after load: isAtPrefilledAddress is true.
        XCTAssertTrue(vm.isAtPrefilledAddress)
        XCTAssertEqual(vm.addressLine1, "1 Smith St")
    }

    func test_startEditingNewAddress_clearsAllAddressFields() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = makeVM(api: api)
        await vm.load()

        vm.startEditingNewAddress()

        XCTAssertEqual(vm.addressLine1, "")
        XCTAssertEqual(vm.addressLine2, "")
        XCTAssertEqual(vm.city, "")
        XCTAssertEqual(vm.postcode, "")
        XCTAssertFalse(vm.isAtPrefilledAddress)
    }

    func test_confirmAddressUnchanged_restoresPrefilledValues() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = makeVM(api: api)
        await vm.load()
        vm.startEditingNewAddress()
        vm.addressLine1 = "junk"

        vm.confirmAddressUnchanged()

        XCTAssertTrue(vm.isAtPrefilledAddress)
        XCTAssertEqual(vm.addressLine1, "1 Smith St")
    }

    // MARK: - inline validation

    func test_save_blankAddressLine1_setsValidationError_doesNotCallAPI_returnsFalse() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = makeVM(api: api)
        await vm.load()
        vm.startEditingNewAddress()
        vm.addressLine1 = ""
        vm.city = "Sydney"
        vm.postcode = "2000"

        let didSave = await vm.save()
        XCTAssertFalse(didSave)

        XCTAssertNotNil(vm.validationErrors[.addressLine1])
        let calls = await api.calls
        let patchCalls = calls.filter { $0.path == "/api/v1/account/me" && $0.method == .patch }
        XCTAssertTrue(patchCalls.isEmpty, "Save must NOT hit the network when validation fails.")
    }

    func test_save_nonNumericPostcode_setsValidationError_doesNotCallAPI() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = makeVM(api: api)
        await vm.load()
        vm.startEditingNewAddress()
        vm.addressLine1 = "1 Smith St"
        vm.city = "Sydney"
        vm.postcode = "abc"

        let didSave = await vm.save()
        XCTAssertFalse(didSave)

        XCTAssertNotNil(vm.validationErrors[.postcode])
        let calls = await api.calls
        let patchCalls = calls.filter { $0.path == "/api/v1/account/me" && $0.method == .patch }
        XCTAssertTrue(patchCalls.isEmpty)
    }

    /// ADV-8: Unicode-Nd digits ("১২৩৪" Bengali, "٤" Arabic, "४"
    /// Devanagari) must be rejected client-side. The default
    /// `Character.isNumber` filter accepts them; pinning the regex to
    /// `[0-9]{4}` makes the client-side guard match the backend's
    /// ASCII-only `\d{4}` primitive.
    func test_save_unicodeDigitPostcode_isRejected() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = makeVM(api: api)
        await vm.load()
        vm.startEditingNewAddress()
        vm.addressLine1 = "1 Smith St"
        vm.city = "Sydney"
        // Bengali digits 1-2-3-4. NSRegularExpression's `\d` would
        // accept these as Nd; `[0-9]` rejects them.
        vm.postcode = "১২৩৪"

        let didSave = await vm.save()
        XCTAssertFalse(didSave)
        XCTAssertNotNil(vm.validationErrors[.postcode])
    }

    // MARK: - save (happy)

    func test_save_validInput_sendsFullAddressPayload_returnsTrue() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse(
            addressLine1: nil, addressLine2: nil, city: nil,
            state: nil, postcode: nil, country: nil
        ))
        await api.stageSuccess(
            AccountEndpoints.PatchMe.self,
            stubMeResponse(
                addressLine1: "2 Park Ave", addressLine2: "",
                city: "Melbourne", state: "VIC",
                postcode: "3000", country: "AU"
            )
        )

        let vm = makeVM(api: api)
        await vm.load()
        vm.startEditingNewAddress()
        vm.addressLine1 = "2 Park Ave"
        vm.addressLine2 = ""
        vm.city = "Melbourne"
        vm.state = .vic
        vm.postcode = "3000"

        let didSave = await vm.save()
        XCTAssertTrue(didSave, "Successful save returns true so the View can advance.")

        let body = await api.lastBody(
            for: String(describing: AccountEndpoints.PatchMe.self),
            as: PatchMeBody.self
        )
        XCTAssertEqual(body?.addressLine1, "2 Park Ave")
        XCTAssertEqual(body?.addressLine2, "",
                       "Empty addressLine2 sent literally — backend NullableIdentityString converts to NULL.")
        XCTAssertEqual(body?.city, "Melbourne")
        XCTAssertEqual(body?.state, "VIC")
        XCTAssertEqual(body?.postcode, "3000")
        XCTAssertEqual(body?.country, "AU")
        XCTAssertNil(body?.displayName, "ConfirmAddress must NOT touch displayName.")
    }

    // MARK: - save (failure → returns false / no advance)

    /// API-004: a failed save must NOT signal success. The View
    /// branches on the return value, so an API error keeps the user
    /// on the screen with a banner instead of advancing into the
    /// next step with a half-saved row.
    func test_save_apiFailure_returnsFalse() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())
        await api.stageFailure(
            AccountEndpoints.PatchMe.self,
            .server(status: 500, message: "internal_error")
        )

        let vm = makeVM(api: api)
        await vm.load()
        vm.startEditingNewAddress()
        vm.addressLine1 = "1 Smith St"
        vm.city = "Sydney"
        vm.postcode = "2000"

        let didSave = await vm.save()
        XCTAssertFalse(didSave)
        // API-009: typed error. A 500 surfaces as `.unknown(message:)`
        // (server message + per-screen fallback) — not `.network` or
        // `.sessionExpired` — so the View can branch correctly.
        guard case .unknown = vm.lastError else {
            return XCTFail("Expected .unknown SaveError, got \(String(describing: vm.lastError))")
        }
    }

    // MARK: - state picker

    func test_australianStatePicker_offersAllEightStates() {
        // The picker is the source of truth for which AU states the UI
        // exposes. Asserts on the enum so any regression to the list is
        // caught at compile time + here at runtime.
        let allCases = AUState.allCases
        XCTAssertEqual(allCases.count, 8)
        XCTAssertEqual(Set(allCases.map { $0.rawValue }),
                       ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"])
    }
}
