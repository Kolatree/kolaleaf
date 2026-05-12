// TransferDTOs.swift  (Phase 6 · U46 + U47 + U48)
// DTOs for the transfer surface. Backend Zod sources of truth:
//   • src/app/api/v1/transfers/_schemas.ts            (POST /transfers)
//   • src/app/api/v1/transfers/[id]/route.ts          (GET /transfers/:id)
//   • src/app/api/v1/transfers/[id]/issue-payid/...   (POST issue-payid)
//
// The wire `transfer.status` is a backend Prisma enum literal. We
// decode it through `TransferStatus` (in `App/AppState.swift`) so
// unknown literals map to `.unknown` and don't break a release-day
// client.

import Foundation

// MARK: - Shape

/// Mirror of the backend `TransferShape`. Money fields ship as
/// decimal strings; we keep them as `String` and parse to `Decimal`
/// only where arithmetic is needed.
public struct TransferShape: Codable, Sendable, Equatable, Hashable, Identifiable {
    public let id: String
    public let userId: String
    public let recipientId: String
    public let corridorId: String
    public let status: TransferStatus
    public let sendAmount: String
    public let receiveAmount: String?
    public let exchangeRate: String
    public let fee: String
    public let payidReference: String?
    public let payidProviderRef: String?
    /// Server-supplied PayID expiry (Phase 6 iter-2 · S16). Optional so
    /// builds against older backends that don't emit the field decode
    /// cleanly. iOS uses server time when present and falls back to a
    /// client-side `issuedAt + 24h` window otherwise.
    public let payidExpiresAt: Date?
    /// Server-supplied transition timestamp for the COMPLETED / NGN_SENT
    /// state (Phase 7 iter-2 · S7 / ADV-P7-S2). Optional so older
    /// backends decode; renderer (`ShareReceiptCard`) falls back to
    /// `Date()` when nil so the receipt always shows a date.
    public let completedAt: Date?
    /// Server-supplied creation timestamp (Phase 8 · U55 / U59). Needed
    /// by the Activity tab (for "this month" totals) and the Statements
    /// FY-grouping. Optional because `GET /transfers/:id` historically
    /// didn't return it — `listTransfers` does.
    public let createdAt: Date?

    /// Memberwise initialiser. `internal` so test fixtures live next
    /// to the type without bleeding the wire-shape constructor into
    /// app code (per S10 / API-011).
    internal init(
        id: String,
        userId: String,
        recipientId: String,
        corridorId: String,
        status: TransferStatus,
        sendAmount: String,
        receiveAmount: String?,
        exchangeRate: String,
        fee: String,
        payidReference: String? = nil,
        payidProviderRef: String? = nil,
        payidExpiresAt: Date? = nil,
        completedAt: Date? = nil,
        createdAt: Date? = nil
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
        self.createdAt = createdAt
    }
}

// MARK: - Create

/// Body for `POST /api/v1/transfers`. Money fields ship as strings so
/// neither end loses decimal precision through JSON's float type.
public struct CreateTransferBody: Codable, Sendable, Equatable {
    public let recipientId: String
    public let corridorId: String
    public let sendAmount: String
    public let exchangeRate: String
    public let fee: String?

    public init(
        recipientId: String,
        corridorId: String,
        sendAmount: String,
        exchangeRate: String,
        fee: String? = nil
    ) {
        self.recipientId = recipientId
        self.corridorId = corridorId
        self.sendAmount = sendAmount
        self.exchangeRate = exchangeRate
        self.fee = fee
    }
}

public struct CreateTransferResponse: Codable, Sendable, Equatable {
    public let transfer: TransferShape

    public init(transfer: TransferShape) {
        self.transfer = transfer
    }
}

// MARK: - Get

/// Envelope returned by `GET /api/v1/transfers/:id` and used as the
/// polling response by `ProcessingTimelineViewModel`.
public struct TransferEnvelope: Codable, Sendable, Equatable {
    public let transfer: TransferShape

    public init(transfer: TransferShape) {
        self.transfer = transfer
    }
}

// MARK: - Issue PayID

/// Response shape for `POST /api/v1/transfers/:id/issue-payid`.
/// "PayID" is the registered product name — the casing here matches
/// product copy (W13 / API-004).
///
/// Iter-2 (S6 / CA-008): identical to `TransferEnvelope` (a single
/// `transfer:` key). We keep the distinct symbol so call sites read
/// self-documentingly ("issue-payid response") but the underlying
/// type is the same envelope — Codable conformances stay in lock-step.
public typealias IssuePayIDResponse = TransferEnvelope

// MARK: - List (Phase 8 · U55)

/// 200-OK response from `GET /api/v1/transfers`. Backend orders by
/// `createdAt desc` and pages by id cursor (see
/// `src/lib/transfers/queries.ts:listTransfers`).
public struct ListTransfersResponse: Codable, Sendable, Equatable {
    public let transfers: [TransferShape]
    /// Cursor for the next page. nil when the server has no more rows.
    public let nextCursor: String?

    public init(transfers: [TransferShape], nextCursor: String? = nil) {
        self.transfers = transfers
        self.nextCursor = nextCursor
    }
}
