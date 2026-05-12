// SwiftDataStackTests.swift  (Phase 8 iter-2 · P2)
// Covers the SwiftData store-management surface that lives on
// `SwiftDataStack` itself:
//   • `deleteAll()` wipes every mirrored entity so a logout can't
//     leak the previous user's recipients/transfers into the next
//     sign-in.
//   • Subsequent inserts after a wipe succeed (i.e. the context is
//     still usable post-delete — no torn state).

import XCTest
import SwiftData
@testable import Kolaleaf

@MainActor
final class SwiftDataStackTests: XCTestCase {

    private var stack: SwiftDataStack!

    override func setUp() async throws {
        try await super.setUp()
        stack = SwiftDataStack(inMemory: true)
    }

    override func tearDown() async throws {
        stack = nil
        try await super.tearDown()
    }

    func test_deleteAll_emptiesEveryMirroredEntity() throws {
        let context = stack.context
        // Seed: one recipient, two transfers.
        context.insert(CachedRecipient(
            id: "r1", fullName: "Mary", bankName: "GTBank",
            bankCode: "058", accountNumber: "0123456789"
        ))
        context.insert(CachedTransfer(
            id: "t1", statusRaw: "COMPLETED", sendAmount: "100",
            receiveAmount: "100000", exchangeRate: "1000", fee: "0",
            recipientId: "r1", payidReference: nil,
            payidProviderRef: nil, completedAt: nil, createdAt: nil
        ))
        context.insert(CachedTransfer(
            id: "t2", statusRaw: "PROCESSING_NGN", sendAmount: "50",
            receiveAmount: nil, exchangeRate: "1000", fee: "0",
            recipientId: "r1", payidReference: nil,
            payidProviderRef: nil, completedAt: nil, createdAt: nil
        ))
        try context.save()

        XCTAssertEqual(
            try context.fetch(FetchDescriptor<CachedRecipient>()).count,
            1
        )
        XCTAssertEqual(
            try context.fetch(FetchDescriptor<CachedTransfer>()).count,
            2
        )

        try stack.deleteAll()

        XCTAssertEqual(
            try context.fetch(FetchDescriptor<CachedRecipient>()).count,
            0,
            "deleteAll must remove every cached recipient"
        )
        XCTAssertEqual(
            try context.fetch(FetchDescriptor<CachedTransfer>()).count,
            0,
            "deleteAll must remove every cached transfer"
        )
    }

    func test_deleteAll_contextStillUsableAfterwards() throws {
        let context = stack.context
        context.insert(CachedRecipient(
            id: "r1", fullName: "Mary", bankName: "GTBank",
            bankCode: "058", accountNumber: "0123456789"
        ))
        try context.save()
        try stack.deleteAll()

        // Insert a new row to prove the context isn't torn.
        context.insert(CachedRecipient(
            id: "r2", fullName: "John", bankName: "First Bank",
            bankCode: "011", accountNumber: "0000000001"
        ))
        try context.save()

        let rows = try context.fetch(FetchDescriptor<CachedRecipient>())
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.id, "r2")
    }
}
