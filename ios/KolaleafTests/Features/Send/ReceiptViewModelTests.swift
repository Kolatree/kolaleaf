// ReceiptViewModelTests.swift  (Phase 7 · U50 → iter-2 C2/W9/W12/S2/S6)
// Behaviour spec for the Done · share · revisit screen view model.
//
// The VM is a pure derivation over a completed `Transfer` + the
// resolved `Recipient`. No async work — construction is deterministic
// so the screen renders instantly when the polling timeline hands off.

import XCTest
@testable import Kolaleaf

@MainActor
final class ReceiptViewModelTests: XCTestCase {

    private func makeRecipient(
        fullName: String = "Folasade Adeyemi",
        bankName: String = "GTBank"
    ) -> Recipient {
        Recipient(
            id: "rcp_1",
            fullName: fullName,
            bankName: bankName,
            bankCode: "058",
            accountNumber: "0123456789"
        )
    }

    private func makeTransfer(
        status: TransferStatus = .completed,
        sendAmount: Decimal = 100,
        receiveAmount: Decimal? = 70_000,
        exchangeRate: Decimal = 700,
        fee: Decimal = 0
    ) -> Transfer {
        Transfer(
            id: "txn_001",
            userId: "user_1",
            recipientId: "rcp_1",
            corridorId: "corridor_au_ng",
            status: status,
            sendAmount: sendAmount,
            receiveAmount: receiveAmount,
            exchangeRate: exchangeRate,
            fee: fee
        )
    }

    // MARK: - Construction

    func test_init_derivesSentAmountText() {
        let vm = ReceiptViewModel(
            transfer: makeTransfer(sendAmount: 100),
            recipient: makeRecipient()
        )
        XCTAssertEqual(vm.sendAmountText, "A$100.00")
    }

    func test_init_derivesReceivedAmountText() {
        let vm = ReceiptViewModel(
            transfer: makeTransfer(receiveAmount: 70_000),
            recipient: makeRecipient()
        )
        XCTAssertEqual(vm.receivedAmountText, "₦70,000")
    }

    func test_init_derivesReceivedAmountText_whenReceiveAmountMissing() {
        // Receive amount is nil before backend has settled the rate.
        // We still want a usable receipt, so VM falls back to the
        // computed value from sendAmount * exchangeRate.
        let vm = ReceiptViewModel(
            transfer: makeTransfer(
                receiveAmount: nil,
                exchangeRate: 1000
            ),
            recipient: makeRecipient()
        )
        XCTAssertEqual(vm.receivedAmountText, "₦100,000")
    }

    /// W9 / ADV-P7-W3: no receive amount AND no rate → render `—`
    /// instead of `₦0`. Receiving a receipt that says "you got ₦0"
    /// is worse than "we're still settling — here's a dash".
    func test_init_receivedAmount_dashesWhenBothMissing() {
        let vm = ReceiptViewModel(
            transfer: makeTransfer(
                receiveAmount: nil,
                exchangeRate: 0
            ),
            recipient: makeRecipient()
        )
        XCTAssertEqual(vm.receivedAmountText, "—")
    }

    func test_init_capturesRecipientNameAndBank() {
        let vm = ReceiptViewModel(
            transfer: makeTransfer(),
            recipient: makeRecipient(
                fullName: "Olumide Akinwumi",
                bankName: "Access Bank"
            )
        )
        XCTAssertEqual(vm.recipientName, "Olumide Akinwumi")
        XCTAssertEqual(vm.recipientBankLine, "Access Bank")
    }

    // MARK: - Headline

    func test_headline_isMoneysHome_whenCompleted() {
        let vm = ReceiptViewModel(
            transfer: makeTransfer(status: .completed),
            recipient: makeRecipient()
        )
        XCTAssertEqual(vm.headline, "Money's home")
    }

    func test_headline_isSentAndOnTheWay_whenNotYetCompleted() {
        // The receipt is rendered as soon as NGN_SENT lands so the
        // user sees "money's on the way" rather than waiting for the
        // bank's settle window.
        let vm = ReceiptViewModel(
            transfer: makeTransfer(status: .ngnSent),
            recipient: makeRecipient()
        )
        XCTAssertEqual(vm.headline, "On the way")
    }

    // MARK: - Send-another callback (S6 / ADV-P7-S1)

    func test_sendAnother_invokesCallbackWithRecipient() {
        var captured: Recipient?
        let recipient = makeRecipient()
        let vm = ReceiptViewModel(
            transfer: makeTransfer(),
            recipient: recipient,
            onSendAnother: { captured = $0 }
        )
        vm.sendAnother()
        XCTAssertEqual(captured?.id, recipient.id)
    }

    /// S6 / ADV-P7-S1: second + tap fires nothing. The View also
    /// disables the button visually after the first tap.
    func test_sendAnother_isDebounced() {
        var callCount = 0
        let vm = ReceiptViewModel(
            transfer: makeTransfer(),
            recipient: makeRecipient(),
            onSendAnother: { _ in callCount += 1 }
        )
        vm.sendAnother()
        vm.sendAnother()
        vm.sendAnother()
        XCTAssertEqual(callCount, 1, "send-another must fire at most once.")
        XCTAssertTrue(vm.didSendAnother)
    }

    func test_sendAnother_isNoOp_whenCallbackNotProvided() {
        // Default value lets the view-model be constructed by tests
        // and previews without forcing a closure.
        let vm = ReceiptViewModel(
            transfer: makeTransfer(),
            recipient: makeRecipient()
        )
        vm.sendAnother()  // must not crash.
    }

    // MARK: - Summary card

    func test_summary_includesBestRateLine() {
        // Backend doesn't ship a saved-vs-bank-rate delta yet. The
        // receipt surfaces a "Best available rate" line in its place
        // so the value-prop doesn't disappear from the design.
        // S2 / OO-007: renamed to `savingsLineCopy`.
        let vm = ReceiptViewModel(
            transfer: makeTransfer(),
            recipient: makeRecipient()
        )
        XCTAssertTrue(
            vm.savingsLineCopy.contains("Best available rate"),
            "Expected savings-line copy to mention the rate value-prop."
        )
    }
}
