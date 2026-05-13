// CancelTransferViewModel.swift  (Phase 9 · U62 + iter-2 A1/B4/B8/C1/C5)
// Drives Screen 39: a single destructive cancel CTA. The screen IS
// the confirm — there's no second-step sheet — so a tap fires the
// POST and the VM walks itself through .idle → .cancelling → terminal.
//
// Wire reference:
//   • src/app/api/v1/transfers/[id]/cancel/route.ts
//
// Backend response shape: 200 + `{ transfer: TransferShape }`. 4xx codes:
//   • 403 NotOwner
//   • 404 NotFound (iter-2 C5: treated as terminal-success-equivalent —
//     the row is gone, intent satisfied. Caller pops to Activity with
//     a one-shot toast.)
//   • 409 + `reason: "cancel_too_late"` → .tooLate
//   • 409 + `reason: "invalid_transition"` → .cancelled (idempotent
//     re-cancel; backend treats already-CANCELLED as success in
//     src/lib/transfers/cancel.ts but keep the typed branch for any
//     other latent invalid-transition path).
//   • 500 generic → .error(APIError)

import Foundation
import Observation

public enum CancelTransferState: Equatable, Sendable {
    case idle
    case cancelling
    case cancelled
    /// 409 + `reason: "cancel_too_late"` — the AUD has already arrived.
    /// The screen surfaces a "View transfer" CTA that pops back to the
    /// processing timeline.
    case tooLate
    /// 404 — the transfer row no longer exists (deleted, expired into
    /// a terminal sweep, etc). Treated as terminal-success-equivalent
    /// because the user's intent (no transfer) is already true. Caller
    /// pops to Activity with a one-shot toast.
    case gone
    /// Error payload carries the typed APIError so the View can render
    /// via `APIErrorPresenter` and tests can assert on the case rather
    /// than localized text. (B4 / OO-904)
    case error(APIError)
}

@MainActor
@Observable
public final class CancelTransferViewModel {

    private let api: AuthAPI
    private let transferId: String

    public private(set) var state: CancelTransferState = .idle
    /// Domain Transfer captured from the cancel response (or fabricated
    /// in idempotent branches that don't have a body). Surfaced to the
    /// caller via `onCancelled(Transfer)` so the parent threads the
    /// real DTO into AppState / SendCoordinator instead of a stub.
    /// (B8 / ADV-P9-S3)
    public private(set) var lastCancelledTransfer: Transfer?

    public init(api: AuthAPI, transferId: String) {
        self.api = api
        self.transferId = transferId
    }

    /// Cancel the transfer. Idempotent at the in-flight + terminal-success
    /// guards: re-tapping while `.cancelling`, `.cancelled` or `.gone` is
    /// a no-op (no second POST). `.tooLate` and `.error` are recoverable —
    /// the user can re-tap to retry the request.
    public func cancel() async {
        switch state {
        case .cancelling, .cancelled, .gone:
            return
        case .idle, .tooLate, .error:
            break
        }

        state = .cancelling

        let result = await api.send(TransfersEndpoints.Cancel(id: transferId))
        switch result {
        case .success(let envelope):
            lastCancelledTransfer = envelope.transfer.toDomainOrZero()
            state = .cancelled
        case .failure(let err):
            state = mapFailure(err)
        }
    }

    private func mapFailure(_ err: APIError) -> CancelTransferState {
        // A1 / API-901: backend ships typed `reason` for 409s so we
        // dispatch on the typed APIError case.
        switch err {
        case .cancelTooLate:
            return .tooLate
        case .invalidTransferTransition:
            // Backend's cancel.ts treats already-CANCELLED as success
            // (returns 200 with the existing row), so this branch is
            // a defensive catch for any latent invalid-transition path.
            // Fabricate a Domain Transfer in the cancelled state — we
            // know the row's id, and the parent only routes on status.
            lastCancelledTransfer = Transfer(
                id: transferId,
                userId: "",
                recipientId: "",
                corridorId: "",
                status: .cancelled,
                sendAmount: 0,
                receiveAmount: nil,
                exchangeRate: 0,
                fee: 0
            )
            return .cancelled
        case .notFound:
            // C5 / ADV-P9-W1: the row is gone — caller satisfied.
            return .gone
        default:
            return .error(err)
        }
    }
}
