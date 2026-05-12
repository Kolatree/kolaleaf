// TransactionDetailViewModelTests.swift  (Phase 7 · U52)
// Behaviour spec for the per-transfer audit-trail view (Screen 24).
//
// Backend wire shape: `GET /api/v1/transfers/:id` returns
// `{ transfer: TransferShape }` — NO events array. The user-facing
// timeline is composed locally from the current status + the happy-
// path ordering already encoded in `TransferTimeline`.

import XCTest
@testable import Kolaleaf

@MainActor
final class TransactionDetailViewModelTests: XCTestCase {

    private func transfer(
        id: String = "txn_001",
        status: TransferStatus = .completed
    ) -> TransferShape {
        TransferShape.fixture(id: id, status: status)
    }

    // MARK: - Load lifecycle

    func test_load_success_populatesTransfer() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.Get.self,
            TransferEnvelope(transfer: transfer(status: .completed))
        )
        let vm = TransactionDetailViewModel(api: api, transferId: "txn_001")

        await vm.load()

        guard case .loaded(let detail) = vm.state else {
            return XCTFail("Expected .loaded, got \(vm.state)")
        }
        XCTAssertEqual(detail.transfer.id, "txn_001")
        XCTAssertEqual(detail.transfer.status, .completed)
    }

    func test_load_failure_setsFailedState() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.Get.self, .transport("offline"))
        let vm = TransactionDetailViewModel(api: api, transferId: "txn_001")

        await vm.load()

        if case .failed = vm.state { } else {
            XCTFail("Expected .failed, got \(vm.state)")
        }
    }

    func test_load_404_setsNotFoundState() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.Get.self, .notFound)
        let vm = TransactionDetailViewModel(api: api, transferId: "txn_missing")

        await vm.load()

        if case .notFound = vm.state { } else {
            XCTFail("Expected .notFound, got \(vm.state)")
        }
    }

    func test_load_401_setsSessionExpired() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.Get.self, .unauthorized)
        let vm = TransactionDetailViewModel(api: api, transferId: "txn_001")

        await vm.load()

        if case .sessionExpired = vm.state { } else {
            XCTFail("Expected .sessionExpired, got \(vm.state)")
        }
    }

    // MARK: - Timeline composition

    func test_timeline_completedTransfer_marksAllRowsDone() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.Get.self,
            TransferEnvelope(transfer: transfer(status: .completed))
        )
        let vm = TransactionDetailViewModel(api: api, transferId: "txn_001")
        await vm.load()

        guard case .loaded(let detail) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(detail.rows.count, TransferTimeline.happyPath.count)
        // Every row in a completed transfer is done.
        for row in detail.rows {
            XCTAssertTrue(row.isDone || row.isActive,
                          "Completed transfer should leave no PENDING rows: \(row.status)")
        }
    }

    func test_timeline_inFlightTransfer_marksFutureRowsPending() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.Get.self,
            TransferEnvelope(transfer: transfer(status: .audReceived))
        )
        let vm = TransactionDetailViewModel(api: api, transferId: "txn_001")
        await vm.load()

        guard case .loaded(let detail) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        // AUD_RECEIVED is the 3rd happy-path row (idx 2). Rows 0/1
        // are done, row 2 active, rows 3-5 pending.
        let pendingCount = detail.rows.filter { !$0.isDone && !$0.isActive }.count
        XCTAssertEqual(pendingCount, 3,
                       "In-flight transfer should leave 3 PENDING rows after .audReceived.")
    }

    // MARK: - Provider refs

    func test_providerRefs_populatedWhenPresent() async {
        let api = FakeAPIClient()
        let shape = TransferShape.fixture(
            payidReference: "KL-txn-1234-5678",
            payidProviderRef: "ada@payid.monoova.com"
        )
        await api.stageSuccess(TransfersEndpoints.Get.self, TransferEnvelope(transfer: shape))
        let vm = TransactionDetailViewModel(api: api, transferId: "txn_001")
        await vm.load()

        guard case .loaded(let detail) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(detail.payidReference, "KL-txn-1234-5678")
        XCTAssertEqual(detail.payidProviderRef, "ada@payid.monoova.com")
    }

    func test_providerRefs_omittedWhenAbsent() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.Get.self,
            TransferEnvelope(transfer: transfer())
        )
        let vm = TransactionDetailViewModel(api: api, transferId: "txn_001")
        await vm.load()

        guard case .loaded(let detail) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertNil(detail.payidReference)
        XCTAssertNil(detail.payidProviderRef)
    }
}
