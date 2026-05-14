// StepUpAuthServiceTests.swift  (Phase 11.5 · U76c StepUpAuth)
// Pure-logic tests for the high-risk transfer step-up rule engine.
//
// Boundary coverage:
//   • Exactly $5,000  → not required (strict greater-than).
//   • $1     to known recipient, no velocity   → not required.
//   • $6,000 to known recipient                 → required, [.highValue].
//   • $500   to NEW recipient                    → required, [.firstSendToRecipient].
//   • $500   to known recipient, 3 in 24h        → required, [.velocity].
//   • $10k   to NEW recipient, high velocity     → required, all three reasons
//                                                   in enum declaration order.
//
// The service is pure logic — no fakes needed.

import XCTest
@testable import Kolaleaf

final class StepUpAuthServiceTests: XCTestCase {

    private func makeService() -> StepUpAuthService { StepUpAuthService() }

    // MARK: - Single-rule trigger cases

    func test_lowValue_knownRecipient_noVelocity_isNotRequired() {
        let decision = makeService().evaluate(
            amountAUD: 1_000,
            recipientHasCompletedTransfer: true,
            recentTransferCount: 0
        )
        XCTAssertFalse(decision.isRequired)
        XCTAssertEqual(decision.reasons, [])
    }

    func test_highValue_knownRecipient_isRequired_highValueOnly() {
        let decision = makeService().evaluate(
            amountAUD: 6_000,
            recipientHasCompletedTransfer: true,
            recentTransferCount: 0
        )
        XCTAssertTrue(decision.isRequired)
        XCTAssertEqual(decision.reasons, [.highValue])
    }

    func test_lowValue_newRecipient_isRequired_firstSendOnly() {
        let decision = makeService().evaluate(
            amountAUD: 500,
            recipientHasCompletedTransfer: false,
            recentTransferCount: 0
        )
        XCTAssertTrue(decision.isRequired)
        XCTAssertEqual(decision.reasons, [.firstSendToRecipient])
    }

    func test_lowValue_knownRecipient_velocityThreshold_isRequired_velocityOnly() {
        let decision = makeService().evaluate(
            amountAUD: 500,
            recipientHasCompletedTransfer: true,
            recentTransferCount: 3
        )
        XCTAssertTrue(decision.isRequired)
        XCTAssertEqual(decision.reasons, [.velocity])
    }

    // MARK: - Combined triggers

    func test_highValue_newRecipient_highVelocity_returnsAllReasonsInEnumOrder() {
        let decision = makeService().evaluate(
            amountAUD: 10_000,
            recipientHasCompletedTransfer: false,
            recentTransferCount: 5
        )
        XCTAssertTrue(decision.isRequired)
        // Order matches the Reason enum declaration order: highValue,
        // firstSendToRecipient, velocity. UI copy depends on this order
        // (subtitleCopy picks the first reason).
        XCTAssertEqual(decision.reasons, [.highValue, .firstSendToRecipient, .velocity])
    }

    // MARK: - Boundary conditions

    func test_exactlyFiveThousand_isNotRequired_strictGreaterThan() {
        let decision = makeService().evaluate(
            amountAUD: StepUpAuthService.highValueThresholdAUD,
            recipientHasCompletedTransfer: true,
            recentTransferCount: 0
        )
        XCTAssertFalse(decision.isRequired,
                       "Exactly $5,000 must NOT trigger high-value gate; strict >.")
    }

    func test_velocityCountBelowThreshold_isNotRequired() {
        let decision = makeService().evaluate(
            amountAUD: 500,
            recipientHasCompletedTransfer: true,
            recentTransferCount: 2
        )
        XCTAssertFalse(decision.isRequired)
    }

    func test_velocityCountAtThreshold_isRequired() {
        let decision = makeService().evaluate(
            amountAUD: 500,
            recipientHasCompletedTransfer: true,
            recentTransferCount: StepUpAuthService.velocityCountThreshold
        )
        XCTAssertTrue(decision.isRequired)
        XCTAssertEqual(decision.reasons, [.velocity])
    }

    // MARK: - StepUpAuthInputs (rule-input derivation)

    func test_recipientHasCompletedTransfer_trueWhenAnyCompletedExists() {
        let transfers = [
            makeTransfer(id: "t1", recipientId: "rcp_1", status: .completed),
            makeTransfer(id: "t2", recipientId: "rcp_2", status: .processingNgn),
        ]
        XCTAssertTrue(
            StepUpAuthInputs.recipientHasCompletedTransfer(
                recipientId: "rcp_1",
                transfers: transfers
            )
        )
    }

    func test_recipientHasCompletedTransfer_falseWhenOnlyPendingExists() {
        // A pending transfer (e.g. AWAITING_AUD) does NOT mark the
        // recipient as "known" — the spec wants a *completed* prior
        // send. This matches the regulatory framing: until money
        // actually reached the recipient, treat as first-send.
        let transfers = [
            makeTransfer(id: "t1", recipientId: "rcp_1", status: .awaitingAud),
            makeTransfer(id: "t2", recipientId: "rcp_1", status: .processingNgn),
        ]
        XCTAssertFalse(
            StepUpAuthInputs.recipientHasCompletedTransfer(
                recipientId: "rcp_1",
                transfers: transfers
            )
        )
    }

    func test_recentTransferCount_includesInWindowExcludesCancelledAndOutOfWindow() {
        let now = Date()
        let inWindow = now.addingTimeInterval(-60 * 60)            // 1h ago
        let alsoInWindow = now.addingTimeInterval(-12 * 60 * 60)   // 12h ago
        let outOfWindow = now.addingTimeInterval(-48 * 60 * 60)    // 48h ago

        let transfers = [
            makeTransfer(id: "a", status: .processingNgn, createdAt: inWindow),
            makeTransfer(id: "b", status: .completed,    createdAt: alsoInWindow),
            makeTransfer(id: "c", status: .cancelled,    createdAt: inWindow),    // excluded
            makeTransfer(id: "d", status: .completed,    createdAt: outOfWindow), // excluded
            makeTransfer(id: "e", status: .completed,    createdAt: nil),         // excluded
        ]

        let count = StepUpAuthInputs.recentTransferCount(
            transfers: transfers,
            window: StepUpAuthService.velocityWindow,
            now: now
        )
        XCTAssertEqual(count, 2)
    }

    // MARK: - Fixture helpers

    private func makeTransfer(
        id: String,
        recipientId: String = "rcp_default",
        status: TransferStatus,
        createdAt: Date? = nil
    ) -> Transfer {
        Transfer(
            id: id,
            userId: "u_1",
            recipientId: recipientId,
            corridorId: "corridor_au_ng",
            status: status,
            sendAmount: 100,
            receiveAmount: nil,
            exchangeRate: 1000,
            fee: 0,
            payidReference: nil,
            payidProviderRef: nil,
            payidExpiresAt: nil,
            completedAt: nil,
            createdAt: createdAt
        )
    }
}
