// ExpiredTransferViewModel.swift  (Phase 9 · U63 + iter-2 OO-902/D5/C4)
// Drives Screen 40: a 24h AWAITING_AUD window has lapsed. Loads
// today's customer rate so the user can re-quote at the new price.
//
// Re-quote pre-fill: the View calls `makePrefill()` and forwards the
// `SendPrefill` value to its parent (SendTabRoot), which seeds a new
// SendView. We don't pre-mutate any global state — the prefill is a
// pure value handed across the navigation seam.
//
// iter-2 changes:
//   • OO-902 / API-902: `SendPrefill` moved to Domain/Models/.
//     `makePrefill()` does the Decimal→Int conversion via
//     `SendPrefill.cents(forAud:)`.
//   • D5 / API-907: `loadState` renamed to `state` for naming
//     consistency with FloatPausedViewModel and other VMs.
//   • C4 / ADV-P9-W5: surfaces `rateMovementDeltaPercent` so the View
//     can render banded copy (silent <1%, "slightly lower" 1-3%,
//     explicit 3-10%, warning >10%).

import Foundation
import Observation

public enum ExpiredLoadState: Equatable, Sendable {
    case loading
    case loaded
    case error(String)
}

@MainActor
@Observable
public final class ExpiredTransferViewModel {

    private let api: AuthAPI
    private let expiredTransfer: Transfer
    private let recipient: Recipient

    public let lockedRate: Decimal
    public private(set) var todaysRate: Decimal?
    public private(set) var state: ExpiredLoadState = .loading

    /// Back-compat shim — preserved so existing tests / call sites
    /// that read `loadState` keep compiling. New code uses `state`.
    public var loadState: ExpiredLoadState { state }

    public init(api: AuthAPI, expiredTransfer: Transfer, recipient: Recipient) {
        self.api = api
        self.expiredTransfer = expiredTransfer
        self.recipient = recipient
        self.lockedRate = expiredTransfer.exchangeRate
    }

    public func loadTodaysRate() async {
        state = .loading
        let result = await api.send(RatesEndpoints.Quote(base: "AUD", target: "NGN"))
        switch result {
        case .success(let response):
            // The wire shape ships `customerRate` as a string for
            // decimal fidelity. A malformed string is a hard contract
            // breach — surface as an error rather than silently
            // coercing to zero.
            if let parsed = response.customerRateDecimal {
                todaysRate = parsed
                state = .loaded
            } else {
                state = .error(String(
                    localized: "expired.rate_read_failed",
                    defaultValue: "Couldn't read today's rate."
                ))
            }
        case .failure(let err):
            state = .error(err.errorDescription ?? String(
                localized: "expired.rate_load_failed",
                defaultValue: "Couldn't load today's rate."
            ))
        }
    }

    /// True when today's rate is strictly worse than the locked rate
    /// (NGN-per-AUD; lower number = the user gets less Naira). Returns
    /// false while today's rate is unloaded — we don't claim movement
    /// either way without data.
    public var rateMovedAgainstUser: Bool {
        guard let today = todaysRate else { return false }
        return today < lockedRate
    }

    /// Signed percent change of today's rate vs the locked rate.
    /// Positive = better for the sender, negative = worse. nil while
    /// today's rate hasn't loaded or the locked rate is zero (legacy
    /// callsite). Used by the View to band the disclosure.
    public var rateMovementDeltaPercent: Decimal? {
        guard let today = todaysRate, lockedRate > 0 else { return nil }
        var diff = today - lockedRate
        var hundred = Decimal(100)
        var product = Decimal()
        NSDecimalMultiply(&product, &diff, &hundred, .plain)
        var quotient = Decimal()
        var locked = lockedRate
        NSDecimalDivide(&quotient, &product, &locked, .plain)
        return quotient
    }

    /// Estimated NGN total at today's rate, given the original AUD send
    /// amount. nil while today's rate hasn't loaded.
    public var todaysTotalNgn: Decimal? {
        guard let today = todaysRate else { return nil }
        var product = Decimal()
        var send = expiredTransfer.sendAmount
        var rate = today
        NSDecimalMultiply(&product, &send, &rate, .plain)
        return product
    }

    /// Pre-fill payload for the re-quote CTA. The Send flow consumes
    /// this to seed a fresh SendView at today's rate.
    public func makePrefill() -> SendPrefill {
        SendPrefill(
            recipientId: recipient.id,
            cents: SendPrefill.cents(forAud: expiredTransfer.sendAmount)
        )
    }

    /// Exposed read-only handles for the View layer.
    public var recipientName: String { recipient.fullName }
    public var sendAmount: Decimal { expiredTransfer.sendAmount }
}
