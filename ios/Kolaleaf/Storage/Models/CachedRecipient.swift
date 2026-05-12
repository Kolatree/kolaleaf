// CachedRecipient.swift  (Phase 8 · U61)
// SwiftData mirror for a single Recipient row. Sync runs at app
// foreground and after a successful POST /transfers so the Recipients
// tab can render from local cache while the network refresh races.
//
// Why mirror?
//   • Cold launch + bad network: the Recipients tab should still show
//     the user's existing recipients instantly. Without a local mirror
//     it shows an empty list until /api/v1/recipients returns.
//   • Send flow already loads /recipients on entry — caching saves
//     one network round-trip per session for the very common case
//     where the list didn't change.
//
// Why not Codable persistence?
//   • SwiftData gives us upsert-by-primary-key for free and is the
//     native iOS 17 pattern. Codable to disk would require us to
//     reinvent diff/merge. The model uses the wire `id` as the
//     primary key so re-syncs don't duplicate rows.

import Foundation
import SwiftData

@Model
public final class CachedRecipient {
    /// Wire `id` from `GET /api/v1/recipients`. Doubles as the primary
    /// key — SwiftData enforces uniqueness on `@Attribute(.unique)`.
    @Attribute(.unique) public var id: String
    public var fullName: String
    public var bankName: String
    public var bankCode: String
    public var accountNumber: String
    /// Set when SyncService writes the row. Used by RecipientsViewModel
    /// to sort the "Most sent to" pinned strip — without a server-side
    /// `sendCount` field (TODO: backend), the most-recently-touched
    /// rows are the best proxy for "frequent". Initialised to the
    /// upsert time on first write.
    public var lastSyncedAt: Date

    public init(
        id: String,
        fullName: String,
        bankName: String,
        bankCode: String,
        accountNumber: String,
        lastSyncedAt: Date = Date()
    ) {
        self.id = id
        self.fullName = fullName
        self.bankName = bankName
        self.bankCode = bankCode
        self.accountNumber = accountNumber
        self.lastSyncedAt = lastSyncedAt
    }
}

public extension CachedRecipient {
    /// Reconstruct the wire DTO from the cached row so feature code
    /// that already speaks `Recipient` doesn't grow a second shape.
    func toRecipient() -> Recipient {
        Recipient(
            id: id,
            fullName: fullName,
            bankName: bankName,
            bankCode: bankCode,
            accountNumber: accountNumber
        )
    }
}
