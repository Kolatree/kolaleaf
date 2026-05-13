// ExpiredTransferViewModelTests.swift  (Phase 9 · U63)
// Cover the loaded-state seeding (lockedRate, todaysRate),
// the `rateMovedAgainstUser` derivation, and the failure path.

import XCTest
@testable import Kolaleaf

@MainActor
final class ExpiredTransferViewModelTests: XCTestCase {

    private func makeRecipient() -> Recipient {
        Recipient(
            id: "rcp_1",
            fullName: "Folasade Adeyemi",
            bankName: "GTBank",
            bankCode: "058",
            accountNumber: "0123456789"
        )
    }

    private func makeExpired(
        sendAmount: Decimal = 100,
        rate: Decimal = 1000
    ) -> Transfer {
        Transfer(
            id: "txn_001",
            userId: "user_1",
            recipientId: "rcp_1",
            corridorId: "corridor_au_ng",
            status: .expired,
            sendAmount: sendAmount,
            receiveAmount: sendAmount * rate,
            exchangeRate: rate,
            fee: 0
        )
    }

    private func makeRate(_ value: String) -> RatePublicResponse {
        RatePublicResponse(
            baseCurrency: "AUD",
            targetCurrency: "NGN",
            corridorId: "corridor_au_ng",
            customerRate: value,
            effectiveAt: Date()
        )
    }

    // MARK: - Initial state

    func test_initial_lockedRate_isFromTransfer() {
        let api = FakeAPIClient()
        let vm = ExpiredTransferViewModel(
            api: api,
            expiredTransfer: makeExpired(rate: 1000),
            recipient: makeRecipient()
        )
        XCTAssertEqual(vm.lockedRate, 1000)
        XCTAssertEqual(vm.loadState, .loading)
        XCTAssertNil(vm.todaysRate)
    }

    // MARK: - Happy path

    func test_loadTodaysRate_success_setsLoadedAndTodaysRate() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRate("1050.00"))
        let vm = ExpiredTransferViewModel(
            api: api,
            expiredTransfer: makeExpired(rate: 1000),
            recipient: makeRecipient()
        )

        await vm.loadTodaysRate()

        XCTAssertEqual(vm.loadState, .loaded)
        XCTAssertEqual(vm.todaysRate, Decimal(string: "1050.00"))
    }

    func test_loadTodaysRate_better_rateMovedAgainstUserIsFalse() async {
        let api = FakeAPIClient()
        // Today (1050) > locked (1000) — better for the sender.
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRate("1050.00"))
        let vm = ExpiredTransferViewModel(
            api: api,
            expiredTransfer: makeExpired(rate: 1000),
            recipient: makeRecipient()
        )

        await vm.loadTodaysRate()

        XCTAssertFalse(vm.rateMovedAgainstUser)
    }

    func test_loadTodaysRate_worse_rateMovedAgainstUserIsTrue() async {
        let api = FakeAPIClient()
        // Today (950) < locked (1000) — worse for the sender.
        await api.stageSuccess(RatesEndpoints.Quote.self, makeRate("950.00"))
        let vm = ExpiredTransferViewModel(
            api: api,
            expiredTransfer: makeExpired(rate: 1000),
            recipient: makeRecipient()
        )

        await vm.loadTodaysRate()

        XCTAssertTrue(vm.rateMovedAgainstUser)
    }

    // MARK: - Failure

    func test_loadTodaysRate_failure_setsErrorState() async {
        let api = FakeAPIClient()
        await api.stageFailure(RatesEndpoints.Quote.self, .transport("offline"))
        let vm = ExpiredTransferViewModel(
            api: api,
            expiredTransfer: makeExpired(rate: 1000),
            recipient: makeRecipient()
        )

        await vm.loadTodaysRate()

        if case .error = vm.loadState {
            // ok
        } else {
            XCTFail("Expected .error, got \(vm.loadState)")
        }
        XCTAssertNil(vm.todaysRate)
    }

    func test_rateMovedAgainstUser_isFalse_whenTodaysRateNil() {
        let api = FakeAPIClient()
        let vm = ExpiredTransferViewModel(
            api: api,
            expiredTransfer: makeExpired(rate: 1000),
            recipient: makeRecipient()
        )
        XCTAssertFalse(vm.rateMovedAgainstUser,
                       "Without today's rate we don't claim movement either way.")
    }

    // MARK: - Re-quote prefill

    func test_makePrefill_carriesRecipientAndAmount() {
        let api = FakeAPIClient()
        let vm = ExpiredTransferViewModel(
            api: api,
            expiredTransfer: makeExpired(sendAmount: 250, rate: 1000),
            recipient: makeRecipient()
        )
        let prefill = vm.makePrefill()
        XCTAssertEqual(prefill.recipientId, "rcp_1")
        // SendPrefill carries Int cents (B2 / OO-902 / API-902);
        // 250 AUD = 25_000 cents.
        XCTAssertEqual(prefill.cents, 25_000)
    }
}
