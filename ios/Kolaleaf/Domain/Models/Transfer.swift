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
        payidExpiresAt: Date? = nil
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
    }
}

extension TransferShape {
    /// Bridge from the wire DTO into the feature-layer Domain model.
    /// Decimal parsing happens once, here. Future wire-shape additions
    /// must be surfaced here too.
    public func toDomain() -> Transfer {
        Transfer(
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
            payidExpiresAt: payidExpiresAt
        )
    }
}
