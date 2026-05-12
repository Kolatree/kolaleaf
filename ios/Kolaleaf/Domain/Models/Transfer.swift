// Transfer.swift  (Phase 6 iter-2 · W5 / CA-001)
// Domain-layer Transfer model.
//
// The DTO `TransferShape` (in Networking/DTOs/TransferDTOs.swift) is
// the JSON-decode surface for the backend wire shape. Feature code
// (SendView, ProcessingTimelineView, navigation payloads) should
// reference the domain `Transfer` instead — that keeps decoded
// Decimal-as-String fields parsed-once and isolates the wire shape
// from screen state.
//
// `TransferShape.toDomain()` is the only sanctioned bridge; if a new
// wire field is needed, surface it here too.

import Foundation

/// Phase 6 domain model for an in-flight transfer.
public struct Transfer: Equatable, Sendable, Hashable, Identifiable {
    public let id: String
    public let userId: String
    public let recipientId: String
    public let corridorId: String
    public let status: TransferStatus
    /// AUD send amount (parsed once from the wire string).
    public let sendAmount: Decimal
    /// NGN receive amount, when the backend has computed it.
    public let receiveAmount: Decimal?
    public let exchangeRate: Decimal
    public let fee: Decimal
    public let payidReference: String?
    public let payidProviderRef: String?
    /// Server-supplied PayID expiry; nil for transfers not yet
    /// transitioned to AWAITING_AUD. iOS uses this when present (S16).
    public let payidExpiresAt: Date?
    /// Server-supplied completion timestamp (Phase 7 iter-2 · S7).
    /// Optional because the backend doesn't ship it yet; the share
    /// renderer falls back to `Date()` when nil.
    public let completedAt: Date?

    public init(
        id: String,
        userId: String,
        recipientId: String,
        corridorId: String,
        status: TransferStatus,
        sendAmount: Decimal,
        receiveAmount: Decimal?,
        exchangeRate: Decimal,
        fee: Decimal,
        payidReference: String? = nil,
        payidProviderRef: String? = nil,
        payidExpiresAt: Date? = nil,
        completedAt: Date? = nil
    ) {
        self.id = id
        self.userId = userId
        self.recipientId = recipientId
        self.corridorId = corridorId
        self.status = status
        self.sendAmount = sendAmount
        self.receiveAmount = receiveAmount
        self.exchangeRate = exchangeRate
        self.fee = fee
        self.payidReference = payidReference
        self.payidProviderRef = payidProviderRef
        self.payidExpiresAt = payidExpiresAt
        self.completedAt = completedAt
    }
}

/// Decode failure surfaced when a money-field string fails to parse
/// as Decimal (W9 / ADV-P7-W3). Iter-1 silently coerced a malformed
/// `sendAmount` to 0, which would render `₦0` on a receipt instead
/// of failing loudly.
public struct TransferDecodeError: Error, Equatable {
    public let field: String
    public let value: String
}

extension TransferShape {
    /// Bridge from the wire DTO into the feature-layer Domain model.
    /// Decimal parsing happens once, here. Future wire-shape additions
    /// must be surfaced here too.
    ///
    /// Phase 7 iter-2 (W9 / ADV-P7-W3): `sendAmount` / `exchangeRate`
    /// must parse cleanly — a malformed wire string is a decode error,
    /// NOT a silent zero. Use `toDomain()` (throwing) for the strict
    /// path; the unchecked `toDomainOrZero()` exists as a back-compat
    /// shim for legacy call sites that haven't been migrated yet.
    public func toDomain() throws -> Transfer {
        guard let send = Decimal(string: sendAmount) else {
            throw TransferDecodeError(field: "sendAmount", value: sendAmount)
        }
        guard let rate = Decimal(string: exchangeRate) else {
            throw TransferDecodeError(field: "exchangeRate", value: exchangeRate)
        }
        guard let feeDec = Decimal(string: fee) else {
            throw TransferDecodeError(field: "fee", value: fee)
        }
        // receiveAmount may legitimately be nil (pre-FX-lock). It is
        // a decode error only when present-but-malformed.
        let receive: Decimal?
        if let r = receiveAmount {
            guard let parsed = Decimal(string: r) else {
                throw TransferDecodeError(field: "receiveAmount", value: r)
            }
            receive = parsed
        } else {
            receive = nil
        }
        return Transfer(
            id: id,
            userId: userId,
            recipientId: recipientId,
            corridorId: corridorId,
            status: status,
            sendAmount: send,
            receiveAmount: receive,
            exchangeRate: rate,
            fee: feeDec,
            payidReference: payidReference,
            payidProviderRef: payidProviderRef,
            payidExpiresAt: payidExpiresAt,
            completedAt: completedAt
        )
    }

    /// Back-compat shim for call sites that haven't been migrated to
    /// the throwing bridge yet. Coerces parse failures to 0 just like
    /// the iter-1 surface; new code MUST use `toDomain()` and handle
    /// the error.
    public func toDomainOrZero() -> Transfer {
        (try? toDomain()) ?? Transfer(
            id: id,
            userId: userId,
            recipientId: recipientId,
            corridorId: corridorId,
            status: status,
            sendAmount: Decimal(string: sendAmount) ?? 0,
            receiveAmount: receiveAmount.flatMap { Decimal(string: $0) },
            exchangeRate: Decimal(string: exchangeRate) ?? 0,
            fee: Decimal(string: fee) ?? 0,
            payidReference: payidReference,
            payidProviderRef: payidProviderRef,
            payidExpiresAt: payidExpiresAt,
            completedAt: completedAt
        )
    }
}
