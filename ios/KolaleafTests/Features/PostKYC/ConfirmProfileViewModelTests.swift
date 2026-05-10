// ConfirmProfileViewModelTests.swift  (Phase 3 · U29)
// TDD spec for the PostKYC "Confirm Profile" screen view model.
//
// Behaviour anchors:
//   • `load()` reads `/account/me` and pre-fills displayName from the row.
//   • Save sends ONLY the displayName field (no other PATCH keys).
//   • Empty displayName falls back to the first whitespace-separated
//     token of `fullName` so users without a chosen name still get a
//     reasonable default in the rest of the app.
//   • Successful save calls `CurrentUserStore.updateDisplayName` so
//     the surrounding tab bar / nav reflect the new value immediately.
//   • API errors surface a typed `SaveError` so the View can branch.
//
// CA-003: tests inject a `FakeCurrentUserStore` instead of building
// an `AppState`. Cleaner setup, sharper assertions: we can verify the
// EXACT call (`updateDisplayName("Pet")`) instead of inspecting an
// unrelated nested struct on a global state container.

import XCTest
@testable import Kolaleaf

@MainActor
final class FakeCurrentUserStore: CurrentUserStore {
    var currentUser: CurrentUser?
    /// Captured `updateDisplayName(_:)` invocations in call order.
    private(set) var updateDisplayNameCalls: [String] = []

    init(currentUser: CurrentUser? = nil) {
        self.currentUser = currentUser
    }

    func updateDisplayName(_ name: String) {
        updateDisplayNameCalls.append(name)
        // Mirror the AppState conformance so any test that reads
        // `currentUser?.displayName` after a save still works without
        // duplicating the mutation contract.
        if let user = currentUser {
            currentUser = CurrentUser(
                id: user.id,
                displayName: name,
                legalName: user.legalName,
                email: user.email,
                phone: user.phone
            )
        }
    }
}

@MainActor
final class ConfirmProfileViewModelTests: XCTestCase {

    private func stubMeResponse(
        fullName: String = "Ada Lovelace",
        displayName: String? = nil
    ) -> MeResponse {
        MeResponse(
            userId: "u1",
            fullName: fullName,
            displayName: displayName,
            primaryEmail: nil,
            secondaryEmails: [],
            twoFactorMethod: nil,
            twoFactorEnabledAt: nil,
            hasVerifiedPhone: false,
            phoneMasked: nil,
            hasRemainingBackupCodes: false,
            backupCodesRemaining: 0,
            addressLine1: nil,
            addressLine2: nil,
            city: nil,
            state: nil,
            postcode: nil,
            country: nil,
            kycStatus: .verified
        )
    }

    private func makeVM(api: AuthAPI, store: any CurrentUserStore) -> ConfirmProfileViewModel {
        ConfirmProfileViewModel(api: api, store: store)
    }

    // MARK: - load

    func test_load_populatesFieldsFromAccountMe() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AccountEndpoints.Me.self,
            stubMeResponse(fullName: "Ada Lovelace", displayName: "Ada")
        )

        let vm = makeVM(api: api, store: FakeCurrentUserStore())
        await vm.load()

        XCTAssertEqual(vm.legalName, "Ada Lovelace")
        XCTAssertEqual(vm.displayName, "Ada")
    }

    func test_load_populatesEmptyDisplayName_whenServerNull() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AccountEndpoints.Me.self,
            stubMeResponse(fullName: "Ada Lovelace", displayName: nil)
        )

        let vm = makeVM(api: api, store: FakeCurrentUserStore())
        await vm.load()

        XCTAssertEqual(vm.legalName, "Ada Lovelace")
        XCTAssertEqual(vm.displayName, "")
    }

    // MARK: - save (display name fallback)

    func test_save_blankDisplayName_fallsBackToFirstTokenOfFullName() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AccountEndpoints.Me.self,
            stubMeResponse(fullName: "Ada Lovelace", displayName: nil)
        )
        await api.stageSuccess(
            AccountEndpoints.PatchMe.self,
            stubMeResponse(fullName: "Ada Lovelace", displayName: "Ada")
        )

        let vm = makeVM(api: api, store: FakeCurrentUserStore())
        await vm.load()
        vm.displayName = "   " // pure whitespace counts as blank
        await vm.save()

        let body = await api.lastBody(
            for: String(describing: AccountEndpoints.PatchMe.self),
            as: PatchMeBody.self
        )
        XCTAssertEqual(body?.displayName, "Ada",
                       "Blank input should resolve to the first token of fullName before PATCH.")
    }

    // MARK: - save (PATCH body shape)

    func test_save_sendsOnlyDisplayName_inPatchBody_returnsTrue() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AccountEndpoints.Me.self,
            stubMeResponse(fullName: "Ada Lovelace", displayName: nil)
        )
        await api.stageSuccess(
            AccountEndpoints.PatchMe.self,
            stubMeResponse(fullName: "Ada Lovelace", displayName: "Pet")
        )

        let vm = makeVM(api: api, store: FakeCurrentUserStore())
        await vm.load()
        vm.displayName = "Pet"
        let didSave = await vm.save()
        XCTAssertTrue(didSave, "Successful save returns true so the View can advance.")

        let body = await api.lastBody(
            for: String(describing: AccountEndpoints.PatchMe.self),
            as: PatchMeBody.self
        )
        XCTAssertEqual(body?.displayName, "Pet")
        XCTAssertNil(body?.addressLine1, "ConfirmProfile should not touch address fields.")
        XCTAssertNil(body?.city)
        XCTAssertNil(body?.state)
        XCTAssertNil(body?.postcode)
        XCTAssertNil(body?.country)
    }

    // MARK: - save success → CurrentUserStore (CA-003)

    func test_save_success_callsUpdateDisplayName_onStore() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AccountEndpoints.Me.self,
            stubMeResponse(fullName: "Ada Lovelace", displayName: nil)
        )
        await api.stageSuccess(
            AccountEndpoints.PatchMe.self,
            stubMeResponse(fullName: "Ada Lovelace", displayName: "Pet")
        )

        let store = FakeCurrentUserStore(currentUser: CurrentUser(
            id: "u1",
            displayName: "Ada Lovelace",
            legalName: "Ada Lovelace",
            email: "a@b.com",
            phone: nil
        ))

        let vm = makeVM(api: api, store: store)
        await vm.load()
        vm.displayName = "Pet"
        await vm.save()

        // CA-003: assertion is on the protocol contract, not on the
        // concrete AppState. We verify the EXACT mutation requested.
        XCTAssertEqual(store.updateDisplayNameCalls, ["Pet"],
                       "Save must invoke updateDisplayName with the resolved name.")
        XCTAssertEqual(store.currentUser?.displayName, "Pet",
                       "Store reflects the new display name.")
        XCTAssertEqual(store.currentUser?.legalName, "Ada Lovelace",
                       "Legal name must NOT be mutated — KYC verified it.")
    }

    // MARK: - save error → typed SaveError

    func test_save_apiError_setsLastError_returnsFalse() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AccountEndpoints.Me.self,
            stubMeResponse(fullName: "Ada Lovelace", displayName: nil)
        )
        await api.stageFailure(
            AccountEndpoints.PatchMe.self,
            .server(status: 500, message: "internal_error")
        )

        let vm = makeVM(api: api, store: FakeCurrentUserStore())
        await vm.load()
        vm.displayName = "Pet"
        // API-004: failed save returns false so the View doesn't
        // advance the user past a row that didn't actually persist.
        let didSave = await vm.save()
        XCTAssertFalse(didSave)
        // API-009: typed error. A 500 maps to `.unknown(message:)`.
        guard case .unknown = vm.lastError else {
            return XCTFail("Expected .unknown SaveError, got \(String(describing: vm.lastError))")
        }
    }
}
