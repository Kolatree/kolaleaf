// CancelTransferViewModelTests.swift  (Phase 9 · U62)
// Cancel-transfer screen state machine. The VM hits
// `POST /api/v1/transfers/{id}/cancel` and routes the result into
// one of four terminal states (.cancelled / .tooLate / .error /
// .idle-after-noop). The screen-level "are you sure?" pattern is
// the screen itself — so a successful POST is the only commit the
// user issues.

import XCTest
@testable import Kolaleaf

@MainActor
final class CancelTransferViewModelTests: XCTestCase {

    private func makeTransferShape(status: TransferStatus = .cancelled) -> TransferShape {
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

    func test_initial_state_isIdle() {
        let api = FakeAPIClient()
        let vm = CancelTransferViewModel(api: api, transferId: "txn_001")
        XCTAssertEqual(vm.state, .idle)
    }

    // MARK: - Happy path

    func test_cancel_success_setsCancelled() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.Cancel.self,
            TransferEnvelope(transfer: makeTransferShape())
        )
        let vm = CancelTransferViewModel(api: api, transferId: "txn_001")

        await vm.cancel()

        XCTAssertEqual(vm.state, .cancelled)
    }

    func test_cancel_hitsCorrectPath() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.Cancel.self,
            TransferEnvelope(transfer: makeTransferShape())
        )
        let vm = CancelTransferViewModel(api: api, transferId: "txn_xyz")

        await vm.cancel()

        let calls = await api.calls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.path, "/api/v1/transfers/txn_xyz/cancel")
        XCTAssertEqual(calls.first?.method, .post)
    }

    // MARK: - Edge cases

    func test_cancel_409CancelTooLate_setsTooLate() async {
        let api = FakeAPIClient()
        // A1 / API-901: backend now ships `reason: "cancel_too_late"`
        // alongside the 409. APIError.map routes that to the typed
        // `.cancelTooLate` case (APIError.swift:78). The VM dispatches
        // on the typed case — no more bare-status branching.
        await api.stageFailure(TransfersEndpoints.Cancel.self, .cancelTooLate)
        let vm = CancelTransferViewModel(api: api, transferId: "txn_001")

        await vm.cancel()

        XCTAssertEqual(vm.state, .tooLate)
    }

    func test_cancel_403_setsError() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.Cancel.self, .forbidden)
        let vm = CancelTransferViewModel(api: api, transferId: "txn_001")

        await vm.cancel()

        if case .error = vm.state {
            // ok
        } else {
            XCTFail("Expected .error, got \(vm.state)")
        }
    }

    func test_cancel_networkFailure_setsError() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.Cancel.self, .transport("offline"))
        let vm = CancelTransferViewModel(api: api, transferId: "txn_001")

        await vm.cancel()

        if case .error = vm.state {
            // ok
        } else {
            XCTFail("Expected .error, got \(vm.state)")
        }
    }

    // MARK: - Idempotency

    func test_cancel_isNoopWhileCancelling() async {
        let api = FakeAPIClient()
        // 200ms delay — observable in-flight window so we can second-tap.
        await api.stageSuccessWithDelay(
            TransfersEndpoints.Cancel.self,
            TransferEnvelope(transfer: makeTransferShape()),
            nanoseconds: 200_000_000
        )
        let vm = CancelTransferViewModel(api: api, transferId: "txn_001")

        // Fire the first cancel asynchronously.
        let firstTask = Task { await vm.cancel() }
        // Spin briefly so the first cancel transitions to .cancelling
        // before the second tap.
        try? await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(vm.state, .cancelling)

        // Second tap during in-flight should be a no-op.
        await vm.cancel()
        await firstTask.value

        XCTAssertEqual(vm.state, .cancelled)
        let calls = await api.calls
        XCTAssertEqual(calls.count, 1, "Re-tap during .cancelling must not re-POST")
    }

    func test_cancel_isNoopAfterSuccess() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.Cancel.self,
            TransferEnvelope(transfer: makeTransferShape())
        )
        let vm = CancelTransferViewModel(api: api, transferId: "txn_001")

        await vm.cancel()
        XCTAssertEqual(vm.state, .cancelled)

        await vm.cancel()  // re-fire after success

        let calls = await api.calls
        XCTAssertEqual(calls.count, 1, "Re-firing after success must not re-POST")
        XCTAssertEqual(vm.state, .cancelled)
    }
}
