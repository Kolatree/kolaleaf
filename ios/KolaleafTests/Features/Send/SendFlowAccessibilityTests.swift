// SendFlowAccessibilityTests.swift  (Phase 12 · U79/U80)
// Render smoke tests for the money-path screens under the largest
// accessibility Dynamic Type size.

import SwiftUI
import XCTest
@testable import Kolaleaf

@MainActor
final class SendFlowAccessibilityTests: XCTestCase {

    func test_sendView_rendersAtAX5() {
        let view = SendView(
            recipients: [recipient()],
            initialRecipient: recipient(),
            api: FakeAPIClient(),
            onAddRecipient: {},
            onCreated: { _ in }
        )
        .environment(AppState(defaults: defaults()))

        assertRenders(view)
    }

    func test_payIDInstructionsView_rendersAtAX5() {
        let view = PayIDInstructionsView(
            api: FakeAPIClient(),
            transferId: "txn_001",
            onContinue: {}
        )

        assertRenders(view)
    }

    func test_receiptView_rendersAtAX5() {
        let view = ReceiptView(
            vm: ReceiptViewModel(
                transfer: transfer(status: .completed),
                recipient: recipient()
            )
        )

        assertRenders(view)
    }

    private func assertRenders<V: View>(
        _ view: V,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let hosted = view
            .environment(\.dynamicTypeSize, .accessibility5)
            .frame(width: 393, height: 852)

        let controller = UIHostingController(rootView: hosted)
        controller.view.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        controller.loadViewIfNeeded()
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        XCTAssertEqual(controller.view.bounds.size.width, 393, file: file, line: line)
        XCTAssertEqual(controller.view.bounds.size.height, 852, file: file, line: line)
    }

    private func defaults() -> UserDefaults {
        let suite = "kola.ax.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    private func recipient() -> Recipient {
        Recipient(
            id: "rcp_1",
            fullName: "Folasade Adeyemi",
            bankName: "GTBank",
            bankCode: "058",
            accountNumber: "0123456789"
        )
    }

    private func transfer(status: TransferStatus) -> Transfer {
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
}
