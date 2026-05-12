// CachedTransfer.swift  (Phase 8 · U61 — iter-2 · A2 + N14)
// SwiftData mirror for a single Transfer row in the Activity list.
// `statusRaw: String` preserves the wire literal verbatim so a future
// backend status string decodes cleanly into `.unknown` for the live
// view AND still round-trips through the cache without loss (the next
// release that knows the new literal will read it correctly).
//
// Money fields stay as the wire String — Decimal-from-String parse
// happens at the Domain bridge (`toTransfer()`). Storing the string
// avoids a parse-and-reformat round-trip on every read and keeps the
// cache shape identical to the wire shape for the fields we mirror.
//
// Iter-2 (A2 + N14):
//   • The canonical bridge `toTransfer()` returns the Domain `Transfer`
//     directly — Storage no longer transitively depends on the wire
//     DTO (`TransferShape`).
//   • `userId` / `corridorId` are persisted so the Domain `Transfer`
//     constructed from the cache is structurally complete (iter-1 set
//     both to empty strings which lied to downstream consumers about
//     identity).

import Foundation
import SwiftData

@Model
public final class CachedTransfer {
    @Attribute(.unique) public var id: String
    /// Phase 8 iter-2 (N14): mirror `userId` / `corridorId` so the
    /// cache can reconstitute a structurally-complete Domain
    /// `Transfer`. SwiftData auto-migrates older rows by inserting the
    /// default empty string; `toTransfer()` treats empty as "unknown
    /// from this cache row", which downstream consumers handle the
    /// same way they handle a missing field on `GET /transfers/:id`.
    public var userId: String
    public var corridorId: String
    /// Raw backend status literal (e.g. `"COMPLETED"`). Kept as a
    /// String, not a TransferStatus enum, so a future backend literal
    /// at a later release doesn't break decode. Consumers re-derive
    /// the typed enum via `TransferStatus(rawValue:) ?? .unknown`.
    public var statusRaw: String
    /// AUD send amount as the wire string (DecimalString). Parsed once
    /// at the Domain bridge — never arithmetic at the cache layer.
    public var sendAmount: String
    public var receiveAmount: String?
    public var exchangeRate: String
    public var fee: String
    public var recipientId: String
    public var payidReference: String?
    public var payidProviderRef: String?
    public var completedAt: Date?
    public var createdAt: Date?

    public init(
        id: String,
        userId: String = "",
        corridorId: String = "",
        statusRaw: String,
        sendAmount: String,
        receiveAmount: String?,
        exchangeRate: String,
        fee: String,
        recipientId: String,
        payidReference: String?,
        payidProviderRef: String?,
        completedAt: Date?,
        createdAt: Date?
    ) {
        self.id = id
        self.userId = userId
        self.corridorId = corridorId
        self.statusRaw = statusRaw
        self.sendAmount = sendAmount
        self.receiveAmount = receiveAmount
        self.exchangeRate = exchangeRate
        self.fee = fee
        self.recipientId = recipientId
        self.payidReference = payidReference
        self.payidProviderRef = payidProviderRef
        self.completedAt = completedAt
        self.createdAt = createdAt
    }
}

public extension CachedTransfer {
    /// Canonical bridge — Storage → Domain. Decimal parsing happens
    /// here; malformed money strings fold to zero (the cache is
    /// best-effort, not the source of truth — the live fetch will
    /// overwrite on the next foreground hop). For strict parsing use
    /// the wire bridge `TransferShape.toDomain()` instead.
    /// (Phase 8 iter-2 · A2)
    func toTransfer() -> Transfer {
        Transfer(
            id: id,
            userId: userId,
            recipientId: recipientId,
            corridorId: corridorId,
            status: TransferStatus(rawValue: statusRaw) ?? .unknown,
            sendAmount: Decimal(string: sendAmount) ?? 0,
            receiveAmount: receiveAmount.flatMap { Decimal(string: $0) },
            exchangeRate: Decimal(string: exchangeRate) ?? 0,
            fee: Decimal(string: fee) ?? 0,
            payidReference: payidReference,
            payidProviderRef: payidProviderRef,
            payidExpiresAt: nil,
            completedAt: completedAt,
            createdAt: createdAt
        )
    }
}
