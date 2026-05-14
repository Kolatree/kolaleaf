// PayIDInstructionsViewModel.swift  (Phase 6 · U48)
// After a transfer has been created, the user needs to push AUD via
// PayID. We:
//   1. Issue the PayID via `POST /transfers/:id/issue-payid` (this
//      flips the transfer CREATED → AWAITING_AUD).
//   2. Show the PayID reference + copy/share affordances.
//   3. Surface the 24h AWAITING_AUD countdown — the timeout itself is
//      enforced server-side, but we render a client-side clock so the
//      user knows how long they have.
//
// Errors:
//   • `.kycRequired` — PayID issuance enforces the KYC gate; the
//     screen surfaces a "Verify identity" CTA that routes to the KYC
//     wizard.
//   • Any other failure — generic retry banner. We do not silently
//     retry; the user explicitly taps "Try again".

import Foundation
import Observation

public enum PayIDLoadState: Equatable, Sendable {
    case idle
    case loading
    case loaded(payId: String, payIdReference: String, issuedAt: Date)
    case kycBlocked
    case failed(String)
}

@MainActor
@Observable
public final class PayIDInstructionsViewModel {

    private let api: AuthAPI
    private let transferId: String

    /// 24h AWAITING_AUD expiry — matches the backend cleanup window.
    public static let expiryWindow: TimeInterval = 24 * 60 * 60

    public private(set) var state: PayIDLoadState = .idle

    public init(api: AuthAPI, transferId: String) {
        self.api = api
        self.transferId = transferId
    }

    /// Issues the PayID for the held transfer. Idempotent at the
    /// `.loading` guard. Iter-2 (S9 / API-010) renames from `load()`
    /// so the method name describes the side-effect (CREATED →
    /// AWAITING_AUD) rather than a generic "load".
    public func issuePayID() async {
        if case .loading = state { return }
        state = .loading

        let result = await api.send(TransfersEndpoints.IssuePayID(id: transferId))
        switch result {
        case .success(let response):
            let transfer = response.transfer
            // The wire shape carries both `payidProviderRef` (the actual
            // PayID handle, like `user@payid.monoova.com`) and
            // `payidReference` (our internal `KL-txn-…-…` correlation
            // key). The user pastes `payidProviderRef` into their bank.
            let displayed = transfer.payidProviderRef
                ?? transfer.payidReference
                ?? String(
                    localized: "send.payid.unable_to_load",
                    defaultValue: "Unable to load PayID"
                )
            let reference = transfer.payidReference ?? ""
            // S16 / ADV-P6-S5: capture server-supplied expiry if
            // present so the countdown isn't dependent on iOS clock
            // skew. Falls back to issuedAt+24h via `remainingUntilExpiry`.
            payidExpiresAt = transfer.payidExpiresAt
            state = .loaded(
                payId: displayed,
                payIdReference: reference,
                issuedAt: Date()
            )
        case .failure(let err):
            switch err {
            case .kycRequired, .forbidden:
                state = .kycBlocked
            default:
                state = .failed(err.errorDescription ?? String(
                    localized: "send.payid.issue_failed",
                    defaultValue: "Could not issue PayID."
                ))
            }
        }
    }

    /// Iter-1 shim — new callers use `issuePayID()`.
    public func load() async { await issuePayID() }

    /// Time-until-expiry. nil while the PayID isn't loaded. Honours
    /// the server-supplied `payidExpiresAt` (S16 / ADV-P6-S5) when
    /// present; falls back to a `issuedAt + expiryWindow` client clock.
    public func remainingUntilExpiry(now: Date = Date()) -> TimeInterval? {
        guard case .loaded(_, _, let issuedAt) = state else { return nil }
        if let serverExpiry = payidExpiresAt {
            return max(0, serverExpiry.timeIntervalSince(now))
        }
        let elapsed = now.timeIntervalSince(issuedAt)
        return max(0, Self.expiryWindow - elapsed)
    }

    /// Server-supplied expiry timestamp when the backend ships one.
    /// Captured at `issuePayID()` success.
    private(set) public var payidExpiresAt: Date?

    /// Iter-2 (S3 / OO-008): drives the countdown clock. The view
    /// reads `currentTick` for re-renders — every minute the VM
    /// publishes a fresh `Date` so countdown UI re-renders. Tests
    /// pin time by passing `now:` to `remainingUntilExpiry(_:)`.
    public private(set) var currentTick: Date = Date()

    /// Begin the once-per-minute tick. Idempotent. Caller invokes
    /// from `.task { vm.startCountdownClock() }`; the task is
    /// cancelled on view disappearance.
    public func startCountdownClock() async {
        while !Task.isCancelled {
            currentTick = Date()
            try? await Task.sleep(nanoseconds: 60_000_000_000)
        }
    }
}
