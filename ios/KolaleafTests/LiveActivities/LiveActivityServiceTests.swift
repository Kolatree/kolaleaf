// LiveActivityServiceTests.swift  (Phase 10B · U71)
//
// Coverage for the start / update / end orchestration. The real
// `Activity<KolaleafTransferAttributes>` is unmockable, so the service
// is exercised against `FakeLiveActivityAdapter` which records every
// call. ActivityKit is invoked from the production adapter only.

import ActivityKit
import XCTest
@testable import Kolaleaf

@MainActor
final class LiveActivityServiceTests: XCTestCase {

    // MARK: - Fixtures

    private func makeTransfer(id: String = "tx_1", status: TransferStatus = .awaitingAud) -> TransferShape {
        TransferShape(
            id: id,
            userId: "user_1",
            recipientId: "rcp_1",
            corridorId: "corr_au_ng",
            status: status,
            sendAmount: "100.00",
            receiveAmount: "70000.00",
            exchangeRate: "700",
            fee: "0.50"
        )
    }

    private func makeRecipient() -> Recipient {
        Recipient(
            id: "rcp_1",
            fullName: "Folasade",
            bankName: "GTBank",
            bankCode: "058",
            accountNumber: "0123456789"
        )
    }

    private func makeStore() -> InMemoryActivityIdStore { InMemoryActivityIdStore() }

    // MARK: - start

    func test_start_callsRequestExactlyOnce() async throws {
        let adapter = FakeLiveActivityAdapter()
        let svc = LiveActivityService(store: makeStore(), adapter: adapter)
        _ = try await svc.start(for: makeTransfer(), recipient: makeRecipient())
        let count = await adapter.requestCallCount()
        XCTAssertEqual(count, 1)
    }

    func test_start_isIdempotentForSameTransferId() async throws {
        let adapter = FakeLiveActivityAdapter()
        let svc = LiveActivityService(store: makeStore(), adapter: adapter)
        let token1 = try await svc.start(for: makeTransfer(), recipient: makeRecipient())
        let token2 = try await svc.start(for: makeTransfer(), recipient: makeRecipient())

        // Only one Activity.request call total — the second routed to update.
        let requests = await adapter.requestCallCount()
        XCTAssertEqual(requests, 1, "second start must not call request again")
        let updates = await adapter.updateCallCount()
        XCTAssertEqual(updates, 1, "second start should update the existing activity")
        XCTAssertEqual(token1.activityId, token2.activityId)
        XCTAssertEqual(token1.transferId, "tx_1")
    }

    func test_start_persistsActivityIdInStore() async throws {
        let store = makeStore()
        let svc = LiveActivityService(store: store, adapter: FakeLiveActivityAdapter())
        let token = try await svc.start(for: makeTransfer(), recipient: makeRecipient())
        let stored = await store.get(transferId: "tx_1")
        XCTAssertEqual(stored, token.activityId)
    }

    func test_start_withCreatedStatus_returnsEmptyToken_andDoesNotRequest() async throws {
        let adapter = FakeLiveActivityAdapter()
        let svc = LiveActivityService(store: makeStore(), adapter: adapter)
        let token = try await svc.start(
            for: makeTransfer(status: .created),
            recipient: makeRecipient()
        )
        XCTAssertEqual(token.activityId, "")
        let count = await adapter.requestCallCount()
        XCTAssertEqual(count, 0)
    }

    // MARK: - apply (update / end / no-op)

    func test_apply_processingNgn_pushesUpdate() async throws {
        let adapter = FakeLiveActivityAdapter()
        let svc = LiveActivityService(store: makeStore(), adapter: adapter)
        _ = try await svc.start(for: makeTransfer(), recipient: makeRecipient())
        await svc.apply(makeTransfer(status: .processingNgn), recipientName: "Folasade")
        let updates = await adapter.updateCallCount()
        // Initial start does not push an update; apply does.
        XCTAssertEqual(updates, 1)
        let lastBand = await adapter.lastUpdateBand()
        XCTAssertEqual(lastBand, .processingNGN)
    }

    func test_apply_cancelled_callsEndOnce() async throws {
        let adapter = FakeLiveActivityAdapter()
        let svc = LiveActivityService(store: makeStore(), adapter: adapter)
        _ = try await svc.start(for: makeTransfer(), recipient: makeRecipient())
        await svc.apply(makeTransfer(status: .cancelled))
        await svc.apply(makeTransfer(status: .cancelled))
        let endCount = await adapter.endCallCount()
        XCTAssertEqual(endCount, 1, "end must be idempotent for terminal status")
    }

    func test_apply_unknown_isNoOp() async throws {
        let adapter = FakeLiveActivityAdapter()
        let svc = LiveActivityService(store: makeStore(), adapter: adapter)
        _ = try await svc.start(for: makeTransfer(), recipient: makeRecipient())
        await svc.apply(makeTransfer(status: .unknown))
        let updates = await adapter.updateCallCount()
        XCTAssertEqual(updates, 0)
        let endCount = await adapter.endCallCount()
        XCTAssertEqual(endCount, 0)
    }

    // MARK: - end (manual)

    func test_end_isIdempotent() async throws {
        let adapter = FakeLiveActivityAdapter()
        let svc = LiveActivityService(store: makeStore(), adapter: adapter)
        _ = try await svc.start(for: makeTransfer(), recipient: makeRecipient())
        await svc.end(transferId: "tx_1", dismissalPolicy: .immediate)
        await svc.end(transferId: "tx_1", dismissalPolicy: .immediate)
        let endCount = await adapter.endCallCount()
        XCTAssertEqual(endCount, 1)
    }

    func test_end_removesStoreEntry() async throws {
        let store = makeStore()
        let svc = LiveActivityService(store: store, adapter: FakeLiveActivityAdapter())
        _ = try await svc.start(for: makeTransfer(), recipient: makeRecipient())
        await svc.end(transferId: "tx_1", dismissalPolicy: .immediate)
        let stored = await store.get(transferId: "tx_1")
        XCTAssertNil(stored)
    }

    // MARK: - reconcileOnLaunch

    func test_reconcile_dropsStaleStoreEntries_whenActivityKilled() async throws {
        let store = makeStore()
        // Pretend a previous launch persisted a mapping but the OS
        // killed the activity (so adapter.currentActivities is empty).
        await store.set(activityId: "act_xyz", forTransferId: "tx_dead")
        let svc = LiveActivityService(store: store, adapter: FakeLiveActivityAdapter())
        await svc.reconcileOnLaunch()
        let stored = await store.get(transferId: "tx_dead")
        XCTAssertNil(stored, "reconcile must drop entries the OS reaped")
    }

    func test_reconcile_reindexesSurvivors() async throws {
        let store = makeStore()
        let adapter = FakeLiveActivityAdapter()
        // Survivor — adapter says it exists.
        await adapter.injectActivity(transferId: "tx_alive", activityId: "act_alive")
        await store.set(activityId: "act_alive", forTransferId: "tx_alive")
        let svc = LiveActivityService(store: store, adapter: adapter)
        await svc.reconcileOnLaunch()
        let stored = await store.get(transferId: "tx_alive")
        XCTAssertEqual(stored, "act_alive")
    }

    // MARK: - Stage labels guarded by lint

    func test_stageLabels_passLintForEveryStatus() {
        // Each status that maps to .update(...) must produce a label
        // that doesn't trip the forbidden-vocabulary lint. The lint
        // assertionFailure trips XCTest in DEBUG; the lack of failure
        // here is the assertion.
        let statuses: [TransferStatus] = [
            .awaitingAud, .audReceived, .processingNgn, .ngnSent, .ngnRetry,
            .floatInsufficient, .completed, .ngnFailed, .needsManual,
        ]
        for status in statuses {
            _ = LiveActivityStageLabels.label(for: status, recipientName: "Folasade")
        }
    }
}

// MARK: - In-memory store

actor InMemoryActivityIdStore: ActivityIdStoring {
    private var map: [String: String] = [:]
    func get(transferId: String) -> String? { map[transferId] }
    func set(activityId: String, forTransferId transferId: String) { map[transferId] = activityId }
    func remove(transferId: String) { map.removeValue(forKey: transferId) }
    func all() -> [String: String] { map }
}

// MARK: - Fake adapter

actor FakeLiveActivityAdapter: LiveActivityAdapter {
    private var requests: Int = 0
    private var updates: Int = 0
    private var ends: Int = 0
    private var lastBand: LiveActivityState?
    private var injected: [LiveActivityHandle] = []
    /// Per-handle update/end counters keyed by activityId so all live
    /// handles share the same fake state.
    private var sharedUpdates: Int = 0
    private var sharedEnds: Int = 0

    func requestCallCount() -> Int { requests }
    func updateCallCount() -> Int { updates }
    func endCallCount() -> Int { ends }
    func lastUpdateBand() -> LiveActivityState? { lastBand }

    func injectActivity(transferId: String, activityId: String) async {
        let handle = makeHandle(id: activityId, transferId: transferId)
        injected.append(handle)
    }

    func currentActivities() async -> [LiveActivityHandle] {
        injected
    }

    @MainActor
    func request(
        attributes: KolaleafTransferAttributes,
        content: ActivityContent<KolaleafTransferAttributes.ContentState>
    ) async throws -> LiveActivityHandle {
        await bumpRequest()
        let id = "act_\(attributes.transferId)_\(await currentRequestCount())"
        let handle = await makeHandle(id: id, transferId: attributes.transferId)
        await injectInternal(handle)
        return handle
    }

    private func bumpRequest() { requests += 1 }
    private func currentRequestCount() -> Int { requests }
    private func injectInternal(_ h: LiveActivityHandle) { injected.append(h) }

    private func recordUpdate(band: LiveActivityState) {
        updates += 1
        lastBand = band
    }

    private func recordEnd() {
        ends += 1
    }

    private func makeHandle(id: String, transferId: String) -> LiveActivityHandle {
        // Capture self weakly; the closure can't await on the actor
        // directly, so we hop into a Task and re-enter the actor.
        LiveActivityHandle(
            id: id,
            transferId: transferId,
            pushToken: nil,
            update: { [weak self] content in
                let band = content.state.state
                await self?.recordUpdate(band: band)
            },
            end: { [weak self] _, _ in
                await self?.recordEnd()
            }
        )
    }
}
