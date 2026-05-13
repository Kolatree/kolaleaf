// FloatPausedViewModelTests.swift  (Phase 9 · U64)
// Polls the transfer until the status leaves `.floatInsufficient`,
// running a 240s countdown alongside. CRITICAL: the VM never speaks
// the treasury reason — copy is operational, this VM exposes only
// state.

import XCTest
@testable import Kolaleaf

@MainActor
final class FloatPausedViewModelTests: XCTestCase {

    private func makeTransfer(status: TransferStatus) -> TransferShape {
        TransferShape(
            id: "txn_001",
            userId: "user_1",
            recipientId: "rcp_1",
            corridorId: "corridor_au_ng",
            status: status,
            sendAmount: "100.00",
            receiveAmount: "70000.00",
            exchangeRate: "700",
            fee: "0",
            payidReference: nil,
            payidProviderRef: nil
        )
    }

    // MARK: - Initial state

    func test_initial_state_seedsCountdown() {
        let api = FakeAPIClient()
        let vm = FloatPausedViewModel(api: api, transferId: "txn_001")
        XCTAssertEqual(vm.remainingSeconds, 240)
        XCTAssertEqual(vm.currentStatus, .floatInsufficient)
        XCTAssertFalse(vm.hasResumed)
    }

    func test_initial_state_honoursCustomEta() {
        let api = FakeAPIClient()
        let vm = FloatPausedViewModel(api: api, transferId: "txn_001", etaSeconds: 90)
        XCTAssertEqual(vm.remainingSeconds, 90)
    }

    // MARK: - Countdown

    func test_tick_recomputesFromWallClockDeadline() {
        // F3 / ADV-P9-W7: tick() reads `deadline.timeIntervalSinceNow`
        // rather than naively decrementing. We backdate the deadline
        // via the test seam so the assertion doesn't have to wait
        // real wall-clock seconds.
        let api = FakeAPIClient()
        let nineSecondsOut = Date().addingTimeInterval(9)
        let vm = FloatPausedViewModel(
            api: api,
            transferId: "txn_001",
            deadlineOverride: nineSecondsOut
        )
        vm.tick()
        // Within a sub-second margin (test wall-clock drift), the
        // recomputed remaining is 8 or 9 depending on scheduling.
        XCTAssertTrue(
            vm.remainingSeconds == 9 || vm.remainingSeconds == 8,
            "Expected ~9s remaining from a 9s deadline, got \(vm.remainingSeconds)"
        )
    }

    func test_tick_clampsAtZero() {
        // Past the deadline, tick() holds at 0 rather than going
        // negative. Backdate the deadline so it's already elapsed.
        let api = FakeAPIClient()
        let elapsed = Date().addingTimeInterval(-5)
        let vm = FloatPausedViewModel(
            api: api,
            transferId: "txn_001",
            deadlineOverride: elapsed
        )
        vm.tick(); vm.tick(); vm.tick(); vm.tick()
        XCTAssertEqual(vm.remainingSeconds, 0,
                       "Past the deadline we hold at zero rather than going negative.")
    }

    // MARK: - Polling / resume

    func test_pollOnce_statusUnchanged_doesNotResume() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.GetForBackgroundPoll.self,
            TransferEnvelope(transfer: makeTransfer(status: .floatInsufficient))
        )
        let vm = FloatPausedViewModel(api: api, transferId: "txn_001")

        await vm.pollOnce()

        XCTAssertEqual(vm.currentStatus, .floatInsufficient)
        XCTAssertFalse(vm.hasResumed)
    }

    func test_pollOnce_statusLeavesFloatPaused_setsResumed() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.GetForBackgroundPoll.self,
            TransferEnvelope(transfer: makeTransfer(status: .processingNgn))
        )
        let vm = FloatPausedViewModel(api: api, transferId: "txn_001")

        await vm.pollOnce()

        XCTAssertEqual(vm.currentStatus, .processingNgn)
        XCTAssertTrue(vm.hasResumed)
    }

    func test_pollOnce_resumeFiresCallback() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.GetForBackgroundPoll.self,
            TransferEnvelope(transfer: makeTransfer(status: .processingNgn))
        )
        var received: TransferStatus?
        let vm = FloatPausedViewModel(api: api, transferId: "txn_001") { status in
            received = status
        }

        await vm.pollOnce()

        XCTAssertEqual(received, .processingNgn)
    }

    func test_pollOnce_resumeFiresOnlyOnce() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.GetForBackgroundPoll.self,
            TransferEnvelope(transfer: makeTransfer(status: .processingNgn))
        )
        var fireCount = 0
        let vm = FloatPausedViewModel(api: api, transferId: "txn_001") { _ in
            fireCount += 1
        }

        await vm.pollOnce()
        await vm.pollOnce()  // status already off floatInsufficient

        XCTAssertEqual(fireCount, 1, "Resume callback fires at most once per VM lifetime.")
    }

    // MARK: - start / stop polling

    func test_start_kicksOffPollingLoop() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.GetForBackgroundPoll.self,
            TransferEnvelope(transfer: makeTransfer(status: .floatInsufficient))
        )
        let vm = FloatPausedViewModel(
            api: api,
            transferId: "txn_001",
            pollInterval: 0.05
        )
        vm.start()
        try? await Task.sleep(nanoseconds: 120_000_000)  // 120 ms — at least 1 poll
        vm.stop()
        let calls = await api.calls
        XCTAssertGreaterThanOrEqual(calls.count, 1)
    }
}
