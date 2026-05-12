// SyncService.swift  (Phase 8 · U61)
// Refreshes the SwiftData mirror from the server. Called from:
//   • App foreground (KolaleafApp scene phase → .active).
//   • Post-transfer create (so the recipient + the new transfer are
//     immediately visible in Activity / Recipients without waiting
//     for the next foreground hop).
//
// Idempotent: every write goes through `upsert*` which uses the
// wire `id` as the primary key. Re-running the same sync against
// the same server state is a no-op.
//
// Offline fallback: callers (RecipientsViewModel, ActivityViewModel)
// read the cache first, then fire-and-forget a sync. A failed sync
// leaves the cache untouched so the user keeps seeing the last
// successful list.

import Foundation
import SwiftData

@MainActor
public final class SyncService {

    private let api: AuthAPI
    private let stack: SwiftDataStack

    public init(api: AuthAPI, stack: SwiftDataStack) {
        self.api = api
        self.stack = stack
    }

    /// Refresh every mirrored entity. Called from the app scene-phase
    /// `.active` hook so a foreground hop reconciles recipients +
    /// transfers in a single round-trip. Idempotent: the underlying
    /// upserts no-op when the server response matches the cached
    /// state. (Phase 8 iter-2 · P5)
    ///
    /// Sequential rather than parallel: both upserts write through the
    /// same SwiftData `MainActor` context, and interleaved
    /// `context.save()` calls trip SwiftData's internal
    /// pending-changes state under `-strict-concurrency=complete`.
    /// The network cost is two sequential requests (~200-400ms) which
    /// is fine for a foreground-hop refresh — the user is already
    /// looking at cached rows while these run.
    public func syncAll() async {
        _ = await syncRecipients()
        _ = await syncTransfers()
    }

    // MARK: - Recipients

    /// Fetch `GET /api/v1/recipients` and upsert the result into the
    /// SwiftData mirror. Returns the wire list so callers can render
    /// immediately without going back through the cache. Returns nil
    /// on network failure — the cache is left intact.
    @discardableResult
    public func syncRecipients() async -> [Recipient]? {
        let result = await api.send(RecipientsEndpoints.List())
        switch result {
        case .success(let response):
            upsertRecipients(response.recipients)
            return response.recipients
        case .failure:
            return nil
        }
    }

    /// Upsert in place. Existing rows have their fields mutated;
    /// missing ids are inserted. Server-deleted rows are NOT pruned
    /// (Phase 8 ships without a delete endpoint per the plan TODO);
    /// `pruneRecipientsExcept(_:)` exists for future use.
    public func upsertRecipients(_ recipients: [Recipient]) {
        let context = stack.context
        for wire in recipients {
            if let existing = fetchRecipient(id: wire.id) {
                existing.fullName = wire.fullName
                existing.bankName = wire.bankName
                existing.bankCode = wire.bankCode
                existing.accountNumber = wire.accountNumber
                existing.lastSyncedAt = Date()
            } else {
                context.insert(CachedRecipient(
                    id: wire.id,
                    fullName: wire.fullName,
                    bankName: wire.bankName,
                    bankCode: wire.bankCode,
                    accountNumber: wire.accountNumber
                ))
            }
        }
        try? context.save()
    }

    /// Delete a cached recipient row by id. Called from
    /// `RecipientsViewModel.delete()` after the DELETE succeeds so the
    /// next foreground cache hit doesn't resurrect the removed row.
    /// Idempotent — missing id is a no-op. (Phase 8 iter-2 · P3)
    public func removeCachedRecipient(id: String) {
        let context = stack.context
        let descriptor = FetchDescriptor<CachedRecipient>()
        let rows = (try? context.fetch(descriptor)) ?? []
        for row in rows where row.id == id {
            context.delete(row)
        }
        do {
            try context.save()
        } catch {
            #if DEBUG
            FileHandle.standardError.write(Data(
                "[SyncService] removeCachedRecipient save failed: \(error)\n"
                    .utf8
            ))
            #endif
        }
    }

    /// Read the cached recipients table. Returns an empty array when
    /// the cache hasn't been populated yet.
    ///
    /// Sort happens in-memory rather than via `SortDescriptor` because
    /// the SwiftData `KeyPath` overload isn't Sendable under
    /// `-strict-concurrency=complete` (Swift 6 mode). The cache is
    /// session-scoped and small (tens of rows), so the in-memory sort
    /// is cheap.
    public func cachedRecipients() -> [Recipient] {
        let descriptor = FetchDescriptor<CachedRecipient>()
        let rows = (try? stack.context.fetch(descriptor)) ?? []
        return rows
            .sorted { $0.lastSyncedAt > $1.lastSyncedAt }
            .map { $0.toRecipient() }
    }

    // MARK: - Transfers

    /// Fetch the first page of `GET /api/v1/transfers` (no filters)
    /// and upsert into the mirror. Returns the wire list on success;
    /// nil on network failure.
    @discardableResult
    public func syncTransfers() async -> [TransferShape]? {
        let result = await api.send(TransfersEndpoints.List())
        switch result {
        case .success(let response):
            upsertTransfers(response.transfers)
            return response.transfers
        case .failure:
            return nil
        }
    }

    public func upsertTransfers(_ transfers: [TransferShape]) {
        let context = stack.context
        for wire in transfers {
            if let existing = fetchTransfer(id: wire.id) {
                existing.userId = wire.userId
                existing.corridorId = wire.corridorId
                existing.statusRaw = wire.status.rawValue
                existing.sendAmount = wire.sendAmount
                existing.receiveAmount = wire.receiveAmount
                existing.exchangeRate = wire.exchangeRate
                existing.fee = wire.fee
                existing.recipientId = wire.recipientId
                existing.payidReference = wire.payidReference
                existing.payidProviderRef = wire.payidProviderRef
                existing.completedAt = wire.completedAt
                existing.createdAt = wire.createdAt
            } else {
                context.insert(CachedTransfer(
                    id: wire.id,
                    userId: wire.userId,
                    corridorId: wire.corridorId,
                    statusRaw: wire.status.rawValue,
                    sendAmount: wire.sendAmount,
                    receiveAmount: wire.receiveAmount,
                    exchangeRate: wire.exchangeRate,
                    fee: wire.fee,
                    recipientId: wire.recipientId,
                    payidReference: wire.payidReference,
                    payidProviderRef: wire.payidProviderRef,
                    completedAt: wire.completedAt,
                    createdAt: wire.createdAt
                ))
            }
        }
        do {
            try context.save()
        } catch {
            #if DEBUG
            FileHandle.standardError.write(Data(
                "[SyncService] upsertTransfers save failed: \(error)\n"
                    .utf8
            ))
            #endif
        }
    }

    /// Cached transfer list ordered by createdAt desc. Falls back to
    /// id-desc when `createdAt` is missing (older cached rows).
    /// In-memory sort for the same Sendable-keypath reason as
    /// `cachedRecipients()`.
    ///
    /// Iter-2 (A2): returns Domain `Transfer` so Storage no longer
    /// transitively depends on Networking (`TransferShape`). Feature
    /// code that still speaks the wire shape uses
    /// `cachedTransfersAsShapes()` to bridge back through
    /// `Transfer.toWireShape()`.
    public func cachedTransfers() -> [Transfer] {
        let descriptor = FetchDescriptor<CachedTransfer>()
        let rows = (try? stack.context.fetch(descriptor)) ?? []
        return rows
            .sorted { lhs, rhs in
                switch (lhs.createdAt, rhs.createdAt) {
                case let (l?, r?): return l > r
                case (_?, nil):    return true
                case (nil, _?):    return false
                case (nil, nil):   return lhs.id > rhs.id
                }
            }
            .map { $0.toTransfer() }
    }

    // MARK: - Private

    // Why no `#Predicate { $0.id == id }`?
    //   `#Predicate` introduces a Sendable closure that captures the
    //   model's KeyPath, and `ReferenceWritableKeyPath<CachedX, String>`
    //   isn't Sendable under `-strict-concurrency=complete`. Filtering
    //   in-memory is fine for session-scoped caches in the tens of rows.

    private func fetchRecipient(id: String) -> CachedRecipient? {
        let descriptor = FetchDescriptor<CachedRecipient>()
        let rows = (try? stack.context.fetch(descriptor)) ?? []
        return rows.first(where: { $0.id == id })
    }

    private func fetchTransfer(id: String) -> CachedTransfer? {
        let descriptor = FetchDescriptor<CachedTransfer>()
        let rows = (try? stack.context.fetch(descriptor)) ?? []
        return rows.first(where: { $0.id == id })
    }
}
