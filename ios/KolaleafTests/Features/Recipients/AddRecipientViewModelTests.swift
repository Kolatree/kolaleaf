// AddRecipientViewModelTests.swift  (Phase 4 · U36)
// Spec for the Add Recipient flow's view model.
//
// Behaviour anchors:
//   • Initial state: empty fields, .idle resolve, !canSave.
//   • Setting a 10-digit NUBAN with a bank schedules a resolve.
//   • Setting an account number under 10 digits leaves resolve idle.
//   • canSave is true ONLY when a bank is selected AND resolveState
//     is .resolved.
//   • save() success returns the new Recipient and POSTs the right body.
//   • save() API failure surfaces a typed `SaveError` and returns nil.

import XCTest
@testable import Kolaleaf

@MainActor
final class AddRecipientViewModelTests: XCTestCase {

    // MARK: - Helpers

    private func makeVM(api: FakeAPIClient) -> AddRecipientViewModel {
        // Inject a fresh resolve service that talks to the same fake.
        AddRecipientViewModel(
            api: api,
            resolveService: RecipientResolveService(api: api)
        )
    }

    private let testBank = Bank(code: "044", name: "Access Bank")

    // MARK: - Initial state

    func test_init_isIdleAndCannotSave() {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)

        XCTAssertNil(vm.selectedBank)
        XCTAssertEqual(vm.accountNumber, "")
        XCTAssertEqual(vm.nickname, "")
        XCTAssertEqual(vm.resolveState, .idle)
        XCTAssertFalse(vm.canSave)
        XCTAssertNil(vm.lastError)
    }

    // MARK: - canSave gating

    func test_canSave_falseWithoutBank_evenIfResolved() async {
        // Inject a service with a known-resolved state so we can
        // assert canSave's gating without needing `selectedBank`'s
        // didSet to drive the resolve path.
        let api = FakeAPIClient()
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Holder")
        )
        let svc = RecipientResolveService(api: api)
        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))
        XCTAssertEqual(svc.state, .resolved(name: "Holder", bankCode: "044", accountNumber: "0123456789"))

        let vm = AddRecipientViewModel(api: api, resolveService: svc)
        // selectedBank still nil → canSave false even though service is resolved.
        XCTAssertNil(vm.selectedBank)
        XCTAssertEqual(vm.resolveState, .resolved(name: "Holder", bankCode: "044", accountNumber: "0123456789"))
        XCTAssertFalse(vm.canSave)
    }

    func test_canSave_trueWhenBankSelectedAndResolved() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Holder")
        )
        let vm = makeVM(api: api)
        vm.selectedBank = testBank
        vm.accountNumber = "0123456789"
        try? await Task.sleep(for: .milliseconds(450))

        XCTAssertEqual(vm.resolveState, .resolved(name: "Holder", bankCode: "044", accountNumber: "0123456789"))
        XCTAssertTrue(vm.canSave)
    }

    func test_canSave_falseWhenResolveStateNotResolved() async {
        let api = FakeAPIClient()
        await api.stageFailure(RecipientsEndpoints.Resolve.self, .notFound)
        let vm = makeVM(api: api)
        vm.selectedBank = testBank
        vm.accountNumber = "0123456789"
        try? await Task.sleep(for: .milliseconds(450))

        XCTAssertEqual(
            vm.resolveState,
            .notFound(bankCode: "044", accountNumber: "0123456789")
        )
        XCTAssertFalse(vm.canSave)
    }

    // MARK: - accountNumber input filtering

    func test_setAccountNumber_stripsNonDigits() {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.accountNumber = "01-23 45-6789a"
        XCTAssertEqual(vm.accountNumber, "0123456789")
    }

    func test_setAccountNumber_truncatesAt10() {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.accountNumber = "01234567899999"
        XCTAssertEqual(vm.accountNumber, "0123456789")
    }

    // MARK: - ADV-010: truncation hint flag

    func test_setAccountNumber_overflow_setsTruncatedFlag() {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)

        // 12 digits → clipped to 10, wasTruncated = true.
        vm.accountNumber = "012345678999"
        XCTAssertEqual(vm.accountNumber, "0123456789")
        XCTAssertTrue(vm.wasTruncated)

        // Exactly 10 digits → no truncation.
        vm.accountNumber = "0123456789"
        XCTAssertEqual(vm.accountNumber, "0123456789")
        XCTAssertFalse(vm.wasTruncated)

        // 10 digits + a non-digit → non-digit stripped, then exactly
        // 10 digits remain. Stripping is not truncation.
        vm.accountNumber = "0123456789X"
        XCTAssertEqual(vm.accountNumber, "0123456789")
        XCTAssertFalse(vm.wasTruncated)
    }

    /// Iter-3 ADV5-IT2-005: `wasTruncated` must NOT latch. After a
    /// paste-truncate-to-10 pass, a subsequent edit that does not
    /// itself truncate (e.g. typing a letter that gets stripped, or
    /// any value that produces ≤ 10 digits) must clear the flag so
    /// the "Truncated to 10 digits" warning doesn't stick around.
    func test_wasTruncated_clearedAfterNonTruncatingEdit() {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)

        // Step 1: paste 12 digits → truncated to 10.
        vm.accountNumber = "012345678999"
        XCTAssertEqual(vm.accountNumber, "0123456789")
        XCTAssertTrue(vm.wasTruncated, "Paste of 12 digits must set the flag.")

        // Step 2: edit produces 10 digits + a letter (letter stripped,
        // no overflow). Flag must clear — this pass did not truncate.
        vm.accountNumber = "0123456789X"
        XCTAssertEqual(vm.accountNumber, "0123456789")
        XCTAssertFalse(
            vm.wasTruncated,
            "Stripping a non-digit is not truncation; flag must clear."
        )
    }

    func test_setAccountNumber_below10_doesNotTriggerResolveAPICall() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        vm.selectedBank = testBank
        vm.accountNumber = "12345" // < 10
        try? await Task.sleep(for: .milliseconds(450))

        let calls = await api.calls
        XCTAssertTrue(
            calls.allSatisfy { $0.path != "/api/v1/recipients/resolve" },
            "Partial NUBAN must not hit the resolve endpoint."
        )
        XCTAssertEqual(vm.resolveState, .idle)
    }

    // MARK: - changing bank re-resolves

    func test_changingBank_reTriggersResolve() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Holder")
        )
        let vm = makeVM(api: api)
        vm.accountNumber = "0123456789"
        vm.selectedBank = testBank
        try? await Task.sleep(for: .milliseconds(450))

        let initialCalls = await api.calls
        let initialResolveCalls = initialCalls.filter { $0.path == "/api/v1/recipients/resolve" }.count

        // Pick a different bank — must re-trigger.
        vm.selectedBank = Bank(code: "058", name: "GTBank")
        try? await Task.sleep(for: .milliseconds(450))

        let afterCalls = await api.calls
        let afterResolveCalls = afterCalls.filter { $0.path == "/api/v1/recipients/resolve" }.count
        XCTAssertGreaterThan(afterResolveCalls, initialResolveCalls,
                              "Bank change must re-trigger resolve.")
    }

    // MARK: - save()

    func test_save_success_returnsRecipient_andPostsCorrectBody() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Adaeze N.")
        )
        let createdRecipient = Recipient(
            id: "rec_1",
            fullName: "Adaeze N.",
            bankName: "Access Bank",
            bankCode: "044",
            accountNumber: "0123456789"
        )
        await api.stageSuccess(
            RecipientsEndpoints.Create.self,
            CreateRecipientResponse(recipient: createdRecipient)
        )
        let vm = makeVM(api: api)
        vm.selectedBank = testBank
        vm.accountNumber = "0123456789"
        try? await Task.sleep(for: .milliseconds(450))
        XCTAssertTrue(vm.canSave)

        let saved = await vm.save()
        XCTAssertEqual(saved?.id, "rec_1")
        XCTAssertNil(vm.lastError)

        let body = await api.lastBody(
            for: String(describing: RecipientsEndpoints.Create.self),
            as: CreateRecipientBody.self
        )
        XCTAssertEqual(body?.bankCode, "044")
        XCTAssertEqual(body?.accountNumber, "0123456789")
        XCTAssertEqual(body?.bankName, "Access Bank")
        XCTAssertEqual(body?.fullName, "Adaeze N.")
    }

    func test_save_apiError_setsLastError_returnsNil() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Holder")
        )
        await api.stageFailure(
            RecipientsEndpoints.Create.self,
            .server(status: 500, message: "boom")
        )
        let vm = makeVM(api: api)
        vm.selectedBank = testBank
        vm.accountNumber = "0123456789"
        try? await Task.sleep(for: .milliseconds(450))

        let saved = await vm.save()
        XCTAssertNil(saved)
        XCTAssertNotNil(vm.lastError)
    }

    func test_save_withoutBank_returnsNilImmediately_andSetsError() async {
        let api = FakeAPIClient()
        let vm = makeVM(api: api)
        let saved = await vm.save()
        XCTAssertNil(saved)
        XCTAssertNotNil(vm.lastError)
        let calls = await api.calls
        XCTAssertTrue(
            calls.allSatisfy { $0.path != "/api/v1/recipients" },
            "Save without a bank must not POST."
        )
    }

    // MARK: - Phase 5 / U40: retry plumbing

    /// Manual retry must round-trip through the resolve service: a
    /// stale `.bankDown` becomes `.resolved` once the next staged
    /// response succeeds. Proves `vm.retryResolve()` actually fires
    /// the service rather than swallowing the call.
    func test_userTappedRetry_callsServiceRetryNow() async {
        let api = FakeAPIClient()
        // Stage a failed resolve so the service ends in `.bankDown`
        // (mapErrorToState routes 503 → bankDown). Use a tight retry
        // schedule so the auto-retry doesn't race the manual retry.
        await api.stageFailure(
            RecipientsEndpoints.Resolve.self,
            .server(status: 503, message: "resolve_unavailable")
        )
        let svc = RecipientResolveService(
            api: api,
            debounce: .milliseconds(20),
            retrySchedule: [10, 20, 40] // huge slots so auto-retry waits
        )
        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(60))
        // Sanity: service is now in `.bankDown`.
        if case .bankDown = svc.state { /* ok */ } else {
            XCTFail("Expected .bankDown after staged 503, got \(svc.state)")
        }

        // Stage a success for the manual retry round-trip.
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Holder")
        )

        let vm = AddRecipientViewModel(api: api, resolveService: svc)
        vm.userTappedRetry()
        try? await Task.sleep(for: .milliseconds(80))

        // The manual retry should have re-fired the resolve and the
        // staged success should now be the service's terminal state.
        if case let .resolved(name, bankCode, accountNumber) = svc.state {
            XCTAssertEqual(name, "Holder")
            XCTAssertEqual(bankCode, "044")
            XCTAssertEqual(accountNumber, "0123456789")
        } else {
            XCTFail("Expected .resolved after retry, got \(svc.state)")
        }
    }

    /// Smoke: pause/resume just forward to the service without
    /// crashing. The substantive behaviour (timer cancellation, resume
    /// re-arming the schedule) is covered in BankDownAutoRetryTests
    /// against the service directly.
    func test_screenDeactivated_screenActivated_forwardsToService() async {
        let api = FakeAPIClient()
        let svc = RecipientResolveService(api: api)
        let vm = AddRecipientViewModel(api: api, resolveService: svc)
        vm.screenDeactivated()
        vm.screenActivated()
    }

    func test_save_alwaysSendsResolvedName_asFullName_evenWhenNicknamePresent() async {
        // ADV-004: nickname must NEVER override the bank-verified holder
        // name. Phase 7 NGN payout rejects NAME_MISMATCH and AUSTRAC
        // requires the verified name in the audit trail. The nickname
        // field is captured locally only for a future pass when the
        // backend schema grows a `nickname` column; until then the
        // resolved name is the only thing persisted as `fullName`.
        let api = FakeAPIClient()
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Adaeze N.")
        )
        let createdRecipient = Recipient(
            id: "rec_1",
            fullName: "Adaeze N.",
            bankName: "Access Bank",
            bankCode: "044",
            accountNumber: "0123456789"
        )
        await api.stageSuccess(
            RecipientsEndpoints.Create.self,
            CreateRecipientResponse(recipient: createdRecipient)
        )
        let vm = makeVM(api: api)
        vm.selectedBank = testBank
        vm.accountNumber = "0123456789"
        vm.nickname = "Mum"  // user-supplied nickname is ignored on the wire
        try? await Task.sleep(for: .milliseconds(450))

        _ = await vm.save()
        let body = await api.lastBody(
            for: String(describing: RecipientsEndpoints.Create.self),
            as: CreateRecipientBody.self
        )
        XCTAssertEqual(body?.fullName, "Adaeze N.",
                       "fullName must be the bank-verified holder name, not the nickname.")
    }
}

