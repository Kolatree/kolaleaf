// TransfersEndpoints.swift  (Phase 6 · U46 + U47 + U48 + U49)
// Endpoint conformances for /api/v1/transfers/* used by the Send
// flow. Schema reference:
//   • src/app/api/v1/transfers/_schemas.ts
//   • src/app/api/v1/transfers/[id]/issue-payid/_schemas.ts
//   • src/app/api/v1/transfers/[id]/route.ts

import Foundation

public enum TransfersEndpoints {

    /// `POST /api/v1/transfers` — create a new transfer in CREATED.
    /// Auth: required (email_verified). KYC gate lives downstream at
    /// PayID issuance, NOT here.
    ///
    /// `idempotencyKey` (Phase 6 iter-2 · C3): when non-nil, ships as
    /// `Idempotency-Key: <uuid>`. Backend dedups concurrent submits per
    /// (userId, key); replays with a matching body return the cached
    /// transfer, mismatched bodies return 409 idempotency_key_conflict.
    public struct Create: Endpoint {
        public typealias Response = CreateTransferResponse
        public let path = "/api/v1/transfers"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?
        public let extraHeaders: [String: String]

        public init(_ body: CreateTransferBody, idempotencyKey: String? = nil) {
            self.body = body
            self.extraHeaders = idempotencyKey.map { ["Idempotency-Key": $0] } ?? [:]
        }
    }

    /// `GET /api/v1/transfers/:id` — single transfer for the polling
    /// fallback used by ProcessingTimelineViewModel.
    public struct Get: Endpoint {
        public typealias Response = TransferEnvelope
        public let path: String
        public let method: HTTPMethod = .get

        public init(id: String) {
            self.path = "/api/v1/transfers/\(id)"
        }
    }

    /// `POST /api/v1/transfers/:id/issue-payid` — CREATED → AWAITING_AUD
    /// transition. Returns the transfer with `payidReference` and
    /// `payidProviderRef` populated.
    public struct IssuePayID: Endpoint {
        public typealias Response = IssuePayIDResponse
        public let path: String
        public let method: HTTPMethod = .post

        public init(id: String) {
            self.path = "/api/v1/transfers/\(id)/issue-payid"
        }
    }

    /// `GET /api/v1/transfers` — Phase 7 placeholder (S11 / API-012).
    /// Listed here so the next phase can fill in without a search;
    /// the actual endpoint conformance lands in Phase 7 with cursor
    /// pagination + status filter.
    // public struct List: Endpoint { … }  // Phase 7
}

// Phase 6 iter-2 (W13 / API-004): canonicalise the casing on
// "PayID" to match product copy. The old `IssuePayId` casing is
// preserved as a typealias so existing test fixtures compile during
// the rename. The Response type alias mirrors the rename in
// TransferDTOs.swift.
public typealias IssuePayIdResponse = IssuePayIDResponse
public extension TransfersEndpoints {
    typealias IssuePayId = IssuePayID
}
