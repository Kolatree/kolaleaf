// SendCoordinatorTests.swift  (Phase 7 · U54 → iter-2 W8/W13/W14)
// Pure state-machine spec for the Send flow's terminal routing.
// Mirrors `PostKYCFlowState` — value type, deterministic, unit-tested
// without any SwiftUI hierarchy.

import XCTest
@testable import Kolaleaf

@MainActor
final class SendCoordinatorTests: XCTestCase {

    private func makeRecipient() -> Recipient {
        Recipient(
            id: "rcp_1",
            fullName: "Folasade Adeyemi",
            bankName: "GTBank",
            bankCode: "058",
            accountNumber: "0123456789"
        )
    }

    private func makeTransfer(status: TransferStatus) -> Transfer {
        Transfer(
            id: "txn_001",
            userId: "user_1",
            recipientId: "rcp_1",
            corridorId: "corridor_au_ng",
            status: status,
            sendAmount: 100,
            receiveAmount: 70_000,
            exchangeRate: 700,
            fee: 0
        )
    }

    // MARK: - Initial state

    func test_initial_isSend() {
        let state = SendCoordinatorState()
        XCTAssertEqual(state.step, .send)
    }

    // MARK: - Happy path

    func test_advanceFromSending_movesToPayIDInstructions() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .created)
        state.advanceFromSending(transfer: transfer)
        XCTAssertEqual(state.step, .payIDInstructions(transfer))
    }

    func test_advanceFromPayID_movesToProcessingTimeline() {
        var state = SendCoordinatorState()
        state.advanceFromSending(transfer: makeTransfer(status: .created))
        state.advanceFromPayID(transferId: "txn_001", initialStatus: .awaitingAud)
        XCTAssertEqual(
            state.step,
            .processingTimeline(transferId: "txn_001", initialStatus: .awaitingAud)
        )
    }

    func test_advanceFromProcessing_completed_routesToReceipt() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .completed)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .receipt(transfer, makeRecipient()))
    }

    func test_advanceFromProcessing_ngnSent_routesToReceipt() {
        // NGN_SENT is the second-to-last happy-path state — funds have
        // left the route, so the user-visible value-add is done.
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .ngnSent)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .receipt(transfer, makeRecipient()))
    }

    func test_advanceFromProcessingHappy_directHappy_routesToReceipt() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .completed)
        state.advanceFromProcessingHappy(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .receipt(transfer, makeRecipient()))
    }

    // MARK: - Sad-path branches (W8 / ADV-P7-W2)

    func test_advanceFromProcessing_cancelled_routesToCancelled() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .cancelled)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .cancelled)
    }

    func test_advanceFromProcessing_expired_routesToExpired() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .expired)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .expired)
    }

    func test_advanceFromProcessing_floatInsufficient_routesToFloatPaused() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .floatInsufficient)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .floatPaused)
    }

    func test_advanceFromProcessing_ngnFailed_routesToPayoutFailed() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .ngnFailed)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .payoutFailed(transfer))
    }

    func test_advanceFromProcessing_ngnRetry_routesToPayoutFailed() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .ngnRetry)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .payoutFailed(transfer))
    }

    func test_advanceFromProcessing_needsManual_routesToNeedsManual() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .needsManual)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .needsManual(transfer))
    }

    func test_advanceFromProcessing_refunded_routesToRefunded() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .refunded)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .refunded(transfer))
    }

    // W14: sad-path advance doesn't need a recipient.
    func test_advanceFromProcessingSadPath_acceptsNoRecipient() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .ngnFailed)
        state.advanceFromProcessingSadPath(transfer: transfer)
        XCTAssertEqual(state.step, .payoutFailed(transfer))
    }

    func test_advanceFromProcessing_inFlight_isNoOp() {
        var state = SendCoordinatorState()
        state.advanceFromSending(transfer: makeTransfer(status: .created))
        state.advanceFromPayID(transferId: "txn_001", initialStatus: .awaitingAud)
        let before = state.step
        // PROCESSING_NGN is mid-flight; we shouldn't advance.
        state.advanceFromProcessing(
            transfer: makeTransfer(status: .processingNgn),
            recipient: makeRecipient()
        )
        XCTAssertEqual(state.step, before, "Mid-flight statuses must NOT advance the coordinator.")
    }

    // MARK: - Loopback

    func test_sendAnother_fromReceipt_returnsToSend() {
        var state = SendCoordinatorState()
        let transfer = makeTransfer(status: .completed)
        state.advanceFromProcessing(transfer: transfer, recipient: makeRecipient())
        XCTAssertEqual(state.step, .receipt(transfer, makeRecipient()))

        state.sendAnother()
        XCTAssertEqual(state.step, .send)
    }

    func test_sendAnother_fromOtherSteps_returnsToSend() {
        // The coordinator should always be safe to reset. Cancelled +
        // expired + floatPaused all loop back via the same call.
        var state = SendCoordinatorState()
        state.advanceFromProcessing(
            transfer: makeTransfer(status: .cancelled),
            recipient: makeRecipient()
        )
        state.sendAnother()
        XCTAssertEqual(state.step, .send)
    }
}
