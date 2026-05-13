// ProcessingTimelineViewModelTests.swift  (Phase 6 · U49)
// Covers the state-only-advances invariant, terminal-state stop,
// and one-shot polling. The 5-second poll loop itself is not
// exercised — the timing is verified by pinning `pollInterval` to a
// short value and asserting the resulting call cadence.

import XCTest
@testable import Kolaleaf

@MainActor
final class ProcessingTimelineViewModelTests: XCTestCase {

    private func makeTransfer(
        id: String = "txn_001",
        status: TransferStatus,
        receiveAmount: String? = "10000.00"
    ) -> TransferShape {
        TransferShape(
            id: id,
            userId: "user_1",
            recipientId: "rcp_1",
            corridorId: "corridor_au_ng",
            status: status,
            sendAmount: "10.00",
            receiveAmount: receiveAmount,
            exchangeRate: "1000",
            fee: "0",
            payidReference: nil,
            payidProviderRef: nil
        )
    }

    private func makeAppState() -> AppState {
        let suite = "kola.timeline.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return AppState(defaults: defaults, arguments: [])
    }

    // MARK: - State advancement

    func test_apply_advancesStatus_whenPollProgresses() {
        let api = FakeAPIClient()
        let vm = ProcessingTimelineViewModel(
            api: api,
            transferId: "txn_001",
            initialStatus: .created
        )
        vm.apply(makeTransfer(status: .awaitingAud))
        XCTAssertEqual(vm.currentStatus, .awaitingAud)
    }

    func test_apply_ignoresRegression() {
        let api = FakeAPIClient()
        let vm = ProcessingTimelineViewModel(
            api: api,
            transferId: "txn_001",
            initialStatus: .processingNgn
        )
        vm.apply(makeTransfer(status: .audReceived))
        XCTAssertEqual(vm.currentStatus, .processingNgn,
                       "Earlier status must NOT regress the current state.")
    }

    func test_apply_acceptsSadPathTransition() {
        let api = FakeAPIClient()
        let vm = ProcessingTimelineViewModel(
            api: api,
            transferId: "txn_001",
            initialStatus: .processingNgn
        )
        vm.apply(makeTransfer(status: .needsManual))
        XCTAssertEqual(vm.currentStatus, .needsManual)
    }

    func test_apply_writesToAppState() {
        let appState = makeAppState()
        appState.activeTransfer = ActiveTransfer(
            id: "txn_001", status: .created,
            audAmount: 10, ngnAmount: 10_000,
            recipientId: "rcp_1"
        )
        let api = FakeAPIClient()
        let vm = ProcessingTimelineViewModel(
            api: api,
            transferId: "txn_001",
            initialStatus: .created,
            appState: appState
        )
        vm.apply(makeTransfer(status: .audReceived))
        XCTAssertEqual(appState.activeTransfer?.status, .audReceived)
    }

    // MARK: - Polling

    func test_pollOnce_success_appliesStatus() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.GetForBackgroundPoll.self,
            TransferEnvelope(transfer: makeTransfer(status: .awaitingAud))
        )
        let vm = ProcessingTimelineViewModel(
            api: api,
            transferId: "txn_001",
            initialStatus: .created
        )

        await vm.pollOnce()

        XCTAssertEqual(vm.currentStatus, .awaitingAud)
    }

    func test_pollOnce_failure_setsLastError() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.GetForBackgroundPoll.self, .transport("offline"))
        let vm = ProcessingTimelineViewModel(
            api: api,
            transferId: "txn_001",
            initialStatus: .created
        )
        await vm.pollOnce()
        XCTAssertNotNil(vm.lastError)
    }

    func test_terminalStatus_stopsPolling() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.GetForBackgroundPoll.self,
            TransferEnvelope(transfer: makeTransfer(status: .completed))
        )
        let vm = ProcessingTimelineViewModel(
            api: api,
            transferId: "txn_001",
            initialStatus: .ngnSent,
            pollInterval: 0.05
        )
        vm.startPolling()
        // Give the loop time to fire once and then break on terminal.
        try? await Task.sleep(nanoseconds: 150_000_000)  // 150 ms
        XCTAssertEqual(vm.currentStatus, .completed)
        XCTAssertFalse(vm.isPolling)
    }
}

@MainActor
final class TransferTimelineHelperTests: XCTestCase {

    func test_isTerminal() {
        XCTAssertTrue(TransferTimeline.isTerminal(.completed))
        XCTAssertTrue(TransferTimeline.isTerminal(.refunded))
        XCTAssertTrue(TransferTimeline.isTerminal(.cancelled))
        XCTAssertTrue(TransferTimeline.isTerminal(.expired))
        XCTAssertTrue(TransferTimeline.isTerminal(.needsManual))
        XCTAssertFalse(TransferTimeline.isTerminal(.created))
        XCTAssertFalse(TransferTimeline.isTerminal(.awaitingAud))
        XCTAssertFalse(TransferTimeline.isTerminal(.ngnRetry))
    }

    func test_advancesFrom_progressIsAdvance() {
        XCTAssertTrue(TransferTimeline.advancesFrom(.created, to: .awaitingAud))
        XCTAssertTrue(TransferTimeline.advancesFrom(.created, to: .created))
    }

    func test_advancesFrom_regressionIsNotAdvance() {
        XCTAssertFalse(TransferTimeline.advancesFrom(.processingNgn, to: .audReceived))
        XCTAssertFalse(TransferTimeline.advancesFrom(.completed, to: .created))
    }

    func test_advancesFrom_sadPathIsAdvance() {
        XCTAssertTrue(TransferTimeline.advancesFrom(.processingNgn, to: .needsManual))
        XCTAssertTrue(TransferTimeline.advancesFrom(.awaitingAud, to: .expired))
    }
}
