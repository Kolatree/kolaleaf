// TransactionDetailViewModel.swift  (Phase 7 · U52 → iter-2 W3/W6/W10/W15)
// Loads a single transfer for the Activity → Detail tap (Screen 24)
// and exposes a composed timeline of the happy-path states.
//
// Iter-2 fixes:
//   • W3 / OO-005: timeline composition moved to Domain
//     (`TransferTimeline.projection`); both the Send-flow processing
//     screen and this detail screen consume the same projection.
//   • W6 / CA-005: provider refs read off the Domain `Transfer`, not
//     the DTO. The DTO is the wire shape; the VM speaks Domain only.
//   • W10 / ADV-P7-W4: scenePhase-aware refresh on resume. The
//     transfer can settle while the app is backgrounded; on .active
//     resume we re-fetch so the user doesn't stare at stale state.
//   • W15 / API-003: TimelineRow + TransactionDetail lifted to file
//     scope (the latter still a member type; the former is now
//     `TransferTimelineRow` from Domain).

import Foundation
import Observation

@MainActor
@Observable
public final class TransactionDetailViewModel {

    public enum State: Equatable {
        case idle
        case loading
        case loaded(TransactionDetail)
        case notFound
        case sessionExpired
        case failed(String)
    }

    public struct TransactionDetail: Equatable {
        public let transfer: Transfer
        public let rows: [TransferTimelineRow]
        /// Internal correlation key — `KL-txn-…`. Shown to the user
        /// because they can reference it when contacting support.
        public let payidReference: String?
        /// External PayID handle — `<x>@payid.monoova.com`. Shown so
        /// the user can see which address their bank sent funds to.
        public let payidProviderRef: String?

        public init(
            transfer: Transfer,
            rows: [TransferTimelineRow],
            payidReference: String?,
            payidProviderRef: String?
        ) {
            self.transfer = transfer
            self.rows = rows
            self.payidReference = payidReference
            self.payidProviderRef = payidProviderRef
        }
    }

    public private(set) var state: State = .idle

    private let api: AuthAPI
    private let transferId: String

    public init(api: AuthAPI, transferId: String) {
        self.api = api
        self.transferId = transferId
    }

    /// Fetches the transfer + composes the timeline.
    public func load() async {
        state = .loading
        let result = await api.send(TransfersEndpoints.Get(id: transferId))
        switch result {
        case .success(let envelope):
            // W9: throwing bridge — malformed money is a decode error.
            do {
                let transfer = try envelope.transfer.toDomain()
                let rows = TransferTimeline.projection(currentStatus: transfer.status)
                state = .loaded(TransactionDetail(
                    transfer: transfer,
                    rows: rows,
                    // W6 / CA-005: read provider refs from Domain
                    // Transfer, not the DTO envelope.
                    payidReference: transfer.payidReference,
                    payidProviderRef: transfer.payidProviderRef
                ))
            } catch let decodeErr as TransferDecodeError {
                state = .failed(String(
                    localized: "transaction.detail.decode_field_failed",
                    defaultValue: "Couldn't read \(decodeErr.field) from the server response."
                ))
            } catch {
                state = .failed(String(
                    localized: "transaction.detail.decode_failed",
                    defaultValue: "Couldn't read the server response."
                ))
            }
        case .failure(let err):
            switch err {
            case .notFound:
                state = .notFound
            case .unauthorized:
                state = .sessionExpired
            default:
                state = .failed(err.errorDescription ?? String(
                    localized: "transaction.detail.load_failed",
                    defaultValue: "Couldn't load that transfer."
                ))
            }
        }
    }

    /// W10 / ADV-P7-W4: refresh on scene-resume. Called from
    /// `TransactionDetailView` when `scenePhase` transitions to
    /// `.active`. Idempotent — re-runs the loader.
    public func refreshOnResume() async {
        // Skip if we never loaded; the .task on first appear handles
        // initial load, and refreshing from .idle would race that.
        guard case .loaded = state else { return }
        await load()
    }
}
