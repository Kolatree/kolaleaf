// PayIDInstructionsViewModelTests.swift  (Phase 6 · U48)
// Covers the issue-payid wire shape, KYC blocking, and the
// expiry-countdown math.

import XCTest
@testable import Kolaleaf

@MainActor
final class PayIDInstructionsViewModelTests: XCTestCase {

    private func makeTransfer(
        status: TransferStatus = .awaitingAud,
        payidProviderRef: String? = "kola@payid.monoova.com",
        payidReference: String? = "KL-txn-001-1700000000"
    ) -> TransferShape {
        TransferShape(
            id: "txn_001",
            userId: "user_1",
            recipientId: "rcp_1",
            corridorId: "corridor_au_ng",
            status: status,
            sendAmount: "10.00",
            receiveAmount: "10000.00",
            exchangeRate: "1000",
            fee: "0",
            payidReference: payidReference,
            payidProviderRef: payidProviderRef
        )
    }

    func test_load_success_setsLoadedState() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.IssuePayId.self,
            IssuePayIdResponse(transfer: makeTransfer())
        )
        let vm = PayIDInstructionsViewModel(api: api, transferId: "txn_001")

        await vm.load()

        if case .loaded(let payId, let ref, _) = vm.state {
            XCTAssertEqual(payId, "kola@payid.monoova.com")
            XCTAssertEqual(ref, "KL-txn-001-1700000000")
        } else {
            XCTFail("Expected .loaded state, got \(vm.state)")
        }
    }

    func test_load_kycBlocked_setsKycState() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.IssuePayId.self, .kycRequired)
        let vm = PayIDInstructionsViewModel(api: api, transferId: "txn_001")

        await vm.load()

        XCTAssertEqual(vm.state, .kycBlocked)
    }

    func test_load_forbidden_treatedAsKycBlocked() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.IssuePayId.self, .forbidden)
        let vm = PayIDInstructionsViewModel(api: api, transferId: "txn_001")

        await vm.load()

        XCTAssertEqual(vm.state, .kycBlocked)
    }

    func test_load_genericFailure_setsFailedState() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.IssuePayId.self, .transport("offline"))
        let vm = PayIDInstructionsViewModel(api: api, transferId: "txn_001")

        await vm.load()

        if case .failed = vm.state {
            // ok
        } else {
            XCTFail("Expected .failed state, got \(vm.state)")
        }
    }

    func test_remainingUntilExpiry_isNil_whenNotLoaded() {
        let api = FakeAPIClient()
        let vm = PayIDInstructionsViewModel(api: api, transferId: "txn_001")
        XCTAssertNil(vm.remainingUntilExpiry())
    }

    func test_remainingUntilExpiry_decreasesOverTime() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.IssuePayId.self,
            IssuePayIdResponse(transfer: makeTransfer())
        )
        let vm = PayIDInstructionsViewModel(api: api, transferId: "txn_001")
        await vm.load()

        guard case .loaded(_, _, let issuedAt) = vm.state else {
            XCTFail("Expected loaded state")
            return
        }

        let oneHourLater = issuedAt.addingTimeInterval(3600)
        let remaining = vm.remainingUntilExpiry(now: oneHourLater)
        XCTAssertNotNil(remaining)
        XCTAssertEqual(remaining ?? 0, 23 * 3600, accuracy: 1)
    }

    func test_payidFallsBackToInternalReference_whenProviderRefMissing() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.IssuePayId.self,
            IssuePayIdResponse(transfer: makeTransfer(
                payidProviderRef: nil,
                payidReference: "KL-txn-001"
            ))
        )
        let vm = PayIDInstructionsViewModel(api: api, transferId: "txn_001")

        await vm.load()

        if case .loaded(let payId, _, _) = vm.state {
            XCTAssertEqual(payId, "KL-txn-001")
        } else {
            XCTFail("Expected .loaded state")
        }
    }
}
