// SendViewModelTests.swift  (Phase 6 · U46 + U47 → iter-2)
// Exercises the rate-load, derived-state, and submission paths via
// the iter-2 thin-coordinator surface. All API calls are staged on
// the FakeAPIClient. Face ID belongs to app unlock, not transfer submit.

import XCTest
@testable import Kolaleaf

@MainActor
final class SendViewModelTests: XCTestCase {

    private func makeSampleRecipient() -> Recipient {
        Recipient(
            id: "rcp_1",
            fullName: "Folasade Adeyemi",
            bankName: "GTBank",
            bankCode: "058",
            accountNumber: "0123456789"
        )
    }

    private func makeRateResponse(
        ageSeconds: TimeInterval = 60,
        customerRate: String = "1050.25"
    ) -> RatePublicResponse {
        RatePublicResponse(
            baseCurrency: "AUD",
            targetCurrency: "NGN",
            corridorId: "corridor_au_ng",
            customerRate: customerRate,
            effectiveAt: Date().addingTimeInterval(-ageSeconds)
        )
    }

    private func makeAppState() -> AppState {
        let suite = "kola.send.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return AppState(defaults: defaults, arguments: [])
    }

    private func sampleTransfer(status: TransferStatus = .created) -> TransferShape {
        TransferShape.fixture(status: status)
    }

    // MARK: - Rate loading

    func test_loadRate_success_populatesQuote() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRateResponse())
        let vm = SendViewModel(api: api)

        await vm.loadRate()

        XCTAssertEqual(vm.corridorId, "corridor_au_ng")
        XCTAssertEqual(vm.customerRate, Decimal(string: "1050.25"))
        XCTAssertFalse(vm.isRateStale)
        XCTAssertNil(vm.lastError)
    }

    func test_loadRate_failure_setsError() async {
        let api = FakeAPIClient()
        await api.stageFailure(RatesEndpoints.Quote.self, .transport("offline"))
        let vm = SendViewModel(api: api)

        await vm.loadRate()

        XCTAssertNil(vm.customerRate)
        XCTAssertEqual(vm.lastError, .rateLoadFailed)
    }

    // MARK: - Derived state

    func test_ngnPreview_updatesAsAmountChanges() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRateResponse(customerRate: "1000"))
        let vm = SendViewModel(api: api)

        await vm.loadRate()
        XCTAssertNil(vm.ngnPreview, "Zero amount should produce nil preview.")

        vm.amountStore.append(1); vm.amountStore.append(0)
        vm.amountStore.append(0); vm.amountStore.append(0)
        XCTAssertEqual(vm.amountStore.apiAmountString, "10.00")
        XCTAssertEqual(vm.ngnPreview, Decimal(10_000))
    }

    func test_canSubmit_false_whenAmountIsZero() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRateResponse())
        let vm = SendViewModel(api: api)
        await vm.loadRate()
        vm.selectedRecipient = makeSampleRecipient()
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_true_whenAllPreconditionsMet() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRateResponse())
        let vm = SendViewModel(api: api)
        await vm.loadRate()
        vm.selectedRecipient = makeSampleRecipient()
        vm.amountStore.append(1); vm.amountStore.append(0)
        vm.amountStore.append(0); vm.amountStore.append(0)
        XCTAssertTrue(vm.canSubmit)
    }

    func test_canSubmit_false_whenRateIsStale() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RatesEndpoints.Quote.self,
            makeRateResponse(ageSeconds: 13 * 60 * 60)
        )
        let vm = SendViewModel(api: api)
        await vm.loadRate()
        vm.selectedRecipient = makeSampleRecipient()
        vm.amountStore.append(1); vm.amountStore.append(0); vm.amountStore.append(0); vm.amountStore.append(0)
        XCTAssertTrue(vm.isRateStale)
        XCTAssertEqual(vm.submitBlocker, .rateStale)
        XCTAssertFalse(vm.canSubmit)
    }

    func test_submitBlocker_describesMissingPreconditions() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRateResponse())
        let vm = SendViewModel(api: api)

        XCTAssertEqual(vm.submitBlocker, .missingRecipient)

        vm.selectedRecipient = makeSampleRecipient()
        XCTAssertEqual(vm.submitBlocker, .missingRate)

        await vm.loadRate()
        XCTAssertEqual(vm.submitBlocker, .emptyAmount)

        vm.amountStore.append(5); vm.amountStore.append(0); vm.amountStore.append(0); vm.amountStore.append(0); vm.amountStore.append(0)
        XCTAssertNil(vm.submitBlocker)
    }

    func test_refreshRateForSend_surfacesStaleRateWhenBackendStillHasOldQuote() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RatesEndpoints.Quote.self,
            makeRateResponse(ageSeconds: 13 * 60 * 60)
        )
        let vm = SendViewModel(api: api)

        await vm.refreshRateForSend()

        XCTAssertEqual(vm.lastError, .rateStale)
        XCTAssertEqual(vm.submitBlocker, .missingRecipient)
    }

    // MARK: - End-to-end submit (C1/C5/C6)

    func test_confirmAndSubmit_success_routesTransfer() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRateResponse())
        await api.stageSuccess(
            TransfersEndpoints.Create.self,
            CreateTransferResponse(transfer: sampleTransfer())
        )
        let appState = makeAppState()
        let vm = SendViewModel(
            api: api,
            appState: appState
        )
        await vm.loadRate()
        vm.selectedRecipient = makeSampleRecipient()
        vm.amountStore.append(1); vm.amountStore.append(0); vm.amountStore.append(0); vm.amountStore.append(0)

        await vm.confirmAndSubmit()

        XCTAssertEqual(appState.activeTransfer?.id, "txn_001")
        // C6 / ADV-P6-C4: consumeLastCreated drains the sticky slot.
        let consumed = vm.consumeLastCreated()
        XCTAssertEqual(consumed?.id, "txn_001")
        XCTAssertNil(vm.consumeLastCreated(),
                     "Second consume must be nil — sticky transfer drained.")
    }

    func test_confirmAndSubmit_kycBlocked_setsErrorAndRollsBackState() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRateResponse())
        await api.stageFailure(TransfersEndpoints.Create.self, .kycRequired)
        let appState = makeAppState()
        let vm = SendViewModel(
            api: api,
            appState: appState
        )
        await vm.loadRate()
        vm.selectedRecipient = makeSampleRecipient()
        vm.amountStore.append(1); vm.amountStore.append(0); vm.amountStore.append(0); vm.amountStore.append(0)

        await vm.confirmAndSubmit()

        XCTAssertEqual(vm.lastError, .kycBlocked)
        XCTAssertNil(appState.activeTransfer,
                     "Failed submit must leave activeTransfer unset.")
    }

    func test_confirmAndSubmit_rateExpired_setsRateStale() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRateResponse())
        await api.stageFailure(TransfersEndpoints.Create.self, .rateExpired)
        let vm = SendViewModel(
            api: api,
            appState: makeAppState()
        )
        await vm.loadRate()
        vm.selectedRecipient = makeSampleRecipient()
        vm.amountStore.append(1); vm.amountStore.append(0); vm.amountStore.append(0); vm.amountStore.append(0)

        await vm.confirmAndSubmit()

        XCTAssertEqual(vm.lastError, .rateStale)
    }

    // MARK: - W21 / ADV-P6-W4: session expired

    func test_confirmAndSubmit_unauthorized_mapsToSessionExpired() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRateResponse())
        await api.stageFailure(TransfersEndpoints.Create.self, .unauthorized)
        let vm = SendViewModel(
            api: api,
            appState: makeAppState()
        )
        await vm.loadRate()
        vm.selectedRecipient = makeSampleRecipient()
        vm.amountStore.append(1); vm.amountStore.append(0); vm.amountStore.append(0); vm.amountStore.append(0)

        await vm.confirmAndSubmit()

        XCTAssertEqual(vm.lastError, .sessionExpired)
    }

}
