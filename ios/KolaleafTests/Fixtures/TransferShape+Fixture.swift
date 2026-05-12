// TransferShape+Fixture.swift  (Phase 6 iter-2 · S10 / API-011)
// Test-only fixture factory for TransferShape. Iter-1 leaked a
// memberwise public initialiser; iter-2 makes that initialiser
// internal and routes test construction through this helper so app
// code can't accidentally synthesise wire-shape transfers.

import Foundation
@testable import Kolaleaf

extension TransferShape {
    static func fixture(
        id: String = "txn_001",
        userId: String = "user_1",
        recipientId: String = "rcp_1",
        corridorId: String = "corridor_au_ng",
        status: TransferStatus = .created,
        sendAmount: String = "10.00",
        receiveAmount: String? = "10000.00",
        exchangeRate: String = "1000",
        fee: String = "0",
        payidReference: String? = nil,
        payidProviderRef: String? = nil,
        payidExpiresAt: Date? = nil
    ) -> TransferShape {
        TransferShape(
            id: id,
            userId: userId,
            recipientId: recipientId,
            corridorId: corridorId,
            status: status,
            sendAmount: sendAmount,
            receiveAmount: receiveAmount,
            exchangeRate: exchangeRate,
            fee: fee,
            payidReference: payidReference,
            payidProviderRef: payidProviderRef,
            payidExpiresAt: payidExpiresAt
        )
    }
}
