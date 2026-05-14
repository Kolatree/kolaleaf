// SendCoordinatorIntegrationTests.swift  (Phase 11.6 · U54b)
// Integration-style state-machine coverage for terminal routing that
// arrives while the user is already inside a deeper send-flow screen.

import XCTest
@testable import Kolaleaf

@MainActor
final class SendCoordinatorIntegrationTests: XCTestCase {

    private func recipient() -> Recipient {
        Recipient(
            id: "rcp_integration",
            fullName: "Folasade Adeyemi",
            bankName: "GTBank",
            bankCode: "058",
            accountNumber: "0123456789"
        )
    }

    private func transfer(id: String = "txn_integration", status: TransferStatus) -> Transfer {
        Transfer(
            id: id,
            userId: "user_1",
            recipientId: "rcp_integration",
            corridorId: "corridor_au_ng",
            status: status,
            sendAmount: 100,
            receiveAmount: 70_000,
            exchangeRate: 700,
            fee: 0
        )
    }

    func test_payIDInstructions_floatInsufficientPush_routesToFloatPaused() {
        var state = SendCoordinatorState()
        state.advanceFromSending(transfer: transfer(status: .awaitingAud))
        XCTAssertEqual(state.step, .payIDInstructions(transfer(status: .awaitingAud)))

        state.advanceFromProcessingSadPath(transfer: transfer(status: .floatInsufficient))

        XCTAssertEqual(state.step, .floatPaused)
    }

    func test_processingTimeline_cancelledPush_routesToCancelled() {
        var state = SendCoordinatorState()
        state.advanceFromSending(transfer: transfer(status: .created))
        state.advanceFromPayID(
            transferId: "txn_integration",
            initialStatus: .awaitingAud
        )
        XCTAssertEqual(
            state.step,
            .processingTimeline(transferId: "txn_integration", initialStatus: .awaitingAud)
        )

        state.advanceFromProcessingSadPath(transfer: transfer(status: .cancelled))

        XCTAssertEqual(state.step, .cancelled)
    }

    func test_outOfOrderMidFlightPush_afterReceipt_doesNotRegressUI() {
        var state = SendCoordinatorState()
        let completed = transfer(status: .completed)
        state.advanceFromProcessingHappy(transfer: completed, recipient: recipient())
        XCTAssertEqual(state.step, .receipt(completed, recipient()))

        state.advanceFromProcessing(
            transfer: transfer(status: .processingNgn),
            recipient: recipient()
        )

        XCTAssertEqual(state.step, .receipt(completed, recipient()))
    }
}
