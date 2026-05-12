// TransferSubmissionService.swift  (Phase 6 iter-2 · C1 / C3 / C5 / C6)
// Owns the money-creating POST. Extracted from `SendViewModel` (per
// OO-001) so the View Model is a thin coordinator and the
// invariants that protect the money path live in one auditable file.
//
// Invariants enforced here:
//   1. (C2) Submission entry points are `internal`. No public API
//      ever calls POST /transfers — that bypasses biometrics by
//      definition. The View Model coordinates biometrics, then calls
//      this service via its single `submit(...)` method.
//   2. (C3) An idempotency UUID is generated per slide-confirm INTENT
//      (i.e. per call to `submit(...)`), NOT per network attempt.
//      The same UUID rides every transport retry of the same intent
//      so a duplicate POST on a flaky network does not create a
//      duplicate Transfer.
//   3. (C5) After biometrics succeeds and before POST, the rate is
//      re-checked. A 12h stale window at submit-time is refused —
//      auto-refresh on tap is fine, silent stale-rate submit is not.
//      A rate that REFRESHED between slide-start and submit (different
//      `effectiveAt`) is also refused so the user explicitly re-confirms.
//   4. (C6) No fake "local-pending" Transfer id leaks into AppState.
//      The optimistic flag is `AppState.isSubmittingTransfer`. The
//      real `activeTransfer` is populated only on backend success.

import Foundation

public enum TransferSubmissionResult: Equatable, Sendable {
    /// Backend accepted the create. `Transfer` is the domain shape.
    case success(Transfer)
    /// Pre-flight refused the request. Slide pill re-arms.
    case refusedRateStale
    case refusedRateRefreshed
    /// A submit was attempted while another is in flight.
    case refusedAlreadyInFlight
    /// The user's session is expired (HTTP 401). Caller routes to login.
    case sessionExpired
    /// Mapped APIError. Caller surfaces in the error banner.
    case failed(APIError)
}

@MainActor
public final class TransferSubmissionService {

    private let api: AuthAPI
    private weak var appState: AppState?
    private let audit: TransferAuditLogger

    /// Active idempotency UUID. Held across retries of the same
    /// submit intent; released after a successful create or a
    /// non-transient failure.
    private var pendingIdempotencyKey: String?

    public private(set) var isSubmittingTransfer: Bool = false

    public init(
        api: AuthAPI,
        appState: AppState? = nil,
        audit: TransferAuditLogger = NoOpTransferAuditLogger()
    ) {
        self.api = api
        self.appState = appState
        self.audit = audit
    }

    public func attach(appState: AppState) {
        self.appState = appState
    }

    /// Submit a transfer. Idempotent at the `isSubmittingTransfer`
    /// guard; double-tap returns `.refusedAlreadyInFlight`.
    ///
    /// `rateQuote`: the quote captured at slide-start. The service
    /// re-validates freshness AND verifies the `effectiveAt` matches
    /// the in-VM service's current quote before POSTing (C5).
    /// `currentRateQuoteAt`: the `effectiveAt` of the VM's current
    /// quote at the moment of submit. If it differs from
    /// `rateQuote.effectiveAt`, the rate refreshed mid-biometrics
    /// and we refuse so the user re-confirms at the new rate.
    @discardableResult
    internal func submit(
        recipientId: String,
        rateQuote: RateQuote,
        currentRateQuoteAt: Date,
        sendAmount: Decimal,
        now: Date = Date()
    ) async -> TransferSubmissionResult {
        audit.log(.slideConfirmed)
        guard !isSubmittingTransfer else {
            audit.log(.submitRefused("alreadyInFlight"))
            return .refusedAlreadyInFlight
        }
        guard appState?.activeTransfer == nil else {
            // C6: refuse a second submit while there is a real
            // backend-tracked transfer already active.
            audit.log(.submitRefused("activeTransferExists"))
            return .refusedAlreadyInFlight
        }

        // C5 — rate freshness re-check at the very last gate.
        if rateQuote.isStale(now: now) {
            audit.log(.submitRefused("rateStale"))
            return .refusedRateStale
        }
        if rateQuote.effectiveAt != currentRateQuoteAt {
            audit.log(.submitRefused("rateRefreshed"))
            return .refusedRateRefreshed
        }

        isSubmittingTransfer = true
        appState?.isSubmittingTransfer = true
        defer {
            isSubmittingTransfer = false
            appState?.isSubmittingTransfer = false
        }

        // C3 — generate ONCE per submit intent. Retries of the same
        // intent must reuse this key (no current retry loop, but the
        // contract is now in place for Phase 7's BoundedRetrier wrap).
        if pendingIdempotencyKey == nil {
            pendingIdempotencyKey = UUID().uuidString
        }
        let key = pendingIdempotencyKey ?? UUID().uuidString

        let body = CreateTransferBody(
            recipientId: recipientId,
            corridorId: rateQuote.corridorId,
            sendAmount: sendAmount.wireMoneyString,
            exchangeRate: rateQuote.customerRate.wireString,
            fee: nil
        )

        audit.log(.postCreateIssued(idempotencyKey: key))
        let result = await api.send(TransfersEndpoints.Create(body, idempotencyKey: key))
        switch result {
        case .success(let response):
            let transfer = response.transfer.toDomain()
            // Single-write of the real, backend-tracked transfer.
            appState?.activeTransfer = ActiveTransfer(
                id: transfer.id,
                status: transfer.status,
                audAmount: transfer.sendAmount,
                ngnAmount: transfer.receiveAmount ?? 0,
                recipientId: transfer.recipientId
            )
            pendingIdempotencyKey = nil
            audit.log(.postCreateSucceeded(transferId: transfer.id))
            return .success(transfer)
        case .failure(let err):
            audit.log(.postCreateFailed(reason: String(describing: err)))
            // Keep the idempotency key only when retrying is safe
            // (transport blips). Any backend-level error retires the
            // key because re-trying would just hit the same conflict.
            switch err {
            case .transport:
                break
            default:
                pendingIdempotencyKey = nil
            }
            if case .unauthorized = err { return .sessionExpired }
            return .failed(err)
        }
    }
}
