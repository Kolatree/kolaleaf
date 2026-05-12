// BankStore.swift  (Phase 4 · iteration-2 · CA-002 + Phase 5 · CA-003 — iteration 3)
// Session-scoped cache for the bank list returned by
// `GET /api/v1/banks?country=NG`. Lives at the App level (one instance
// per session), injected via `EnvironmentValues.bankStore`. Replaces
// the prior @State-array inside BankPickerSheet so a sheet re-open
// (or a re-mount triggered by a parent .id change) doesn't re-hit the
// network.
//
// TTL defaults to 1h to match the route's `Cache-Control: private,
// max-age=3600`. The store re-fetches when the cache is empty or
// older than the TTL; otherwise it short-circuits.
//
// `reset()` is called on logout (KolaleafApp.forceReauth +
// AccountView.performSignOut, Phase 8 iter-2 · P4) so a fresh
// sign-in starts from a cold cache. Without that the previous user's
// list (which is identical anyway, but the contract is per-session)
// would survive into the new session.
//
// Iteration 3 fixes:
//   • OO-202 / CA-201 — the brand-colour pattern table moved to
//     `Domain/Recipients/BankBrandTable.swift`. BankStore is now a
//     thin composer: it knows the bank list (network cache), the
//     table knows the colour palette (pure function). The store's
//     `brand(...)` methods are 3-line look-up + dispatch.
//   • OO-203 — `brand(forCode:)`, `brand(for:)`, and the internal
//     `bankName(forCode:)` are no longer `nonisolated`. The
//     `MainActor.assumeIsolated` block they previously needed to
//     read `banks` was a brittle workaround — any future caller
//     touching the property from a non-MainActor context would
//     trap at runtime. SwiftUI bodies are `@MainActor` already, so
//     callers were already isolated; the assume-isolated dance
//     was a tell that the API was wrong.

import Foundation
import SwiftUI

@MainActor
@Observable
public final class BankStore {

    public private(set) var banks: [Bank] = []
    public private(set) var loadState: BankListLoadState = .idle
    public private(set) var lastFetchedAt: Date?

    private let api: AuthAPI
    private let ttl: TimeInterval

    // `nonisolated` so an `EnvironmentKey.defaultValue` can construct
    // an instance without crossing a MainActor boundary at type-init
    // time. Mutations on `banks` / `loadState` are still MainActor-only.
    public nonisolated init(api: AuthAPI, ttl: TimeInterval = 3600) {
        self.api = api
        self.ttl = ttl
    }

    /// Hit the network only when the cache is empty or stale. Concurrent
    /// callers within the TTL window short-circuit on the cached state.
    public func loadIfStale() async {
        if let last = lastFetchedAt,
           Date().timeIntervalSince(last) < ttl,
           !banks.isEmpty {
            return
        }
        loadState = .loading
        let result = await api.send(BanksEndpoints.List(country: "NG"))
        switch result {
        case .success(let response):
            self.banks = response.banks
            self.lastFetchedAt = Date()
            self.loadState = .loaded
        case .failure(let err):
            self.loadState = .failed(err)
        }
    }

    /// Drop the cached list. Invoked from `KolaleafApp.forceReauth()`
    /// and `AccountView.performSignOut()` so the next sign-in starts
    /// with a cold cache (Phase 8 iter-2 · P4).
    public func reset() {
        banks = []
        lastFetchedAt = nil
        loadState = .idle
    }

    // MARK: - Brand lookup (CA-003 + iter-3 CA-201/OO-203)

    /// Look up the brand for a bank known by code. Returns `nil` when
    /// the cache is cold or the code is unknown — callers can fall
    /// back to whatever sentinel makes sense at the call site (e.g.
    /// the bare bank code as a diagnostic, per API-006).
    ///
    /// MainActor-isolated like the rest of the store; SwiftUI bodies
    /// run on MainActor so calling this from a `body` is direct.
    public func brand(forCode code: String) -> BankBrand? {
        guard !code.isEmpty else { return nil }
        guard let name = bankName(forCode: code) else { return nil }
        return BankBrand(
            code: code,
            name: name,
            color: BankBrandTable.color(forBankName: name)
        )
    }

    /// Brand for a known `Bank` value. Always non-nil because the
    /// caller already has the name and code; an unknown name maps to
    /// the muted-disabled grey via `BankBrandTable` so an unmapped
    /// bank still renders without a layout shift.
    public func brand(for bank: Bank) -> BankBrand {
        BankBrand(
            code: bank.code,
            name: bank.name,
            color: BankBrandTable.color(forBankName: bank.name)
        )
    }

    /// Look up the bank name for a code if the cache contains it.
    private func bankName(forCode code: String) -> String? {
        banks.first(where: { $0.code == code })?.name
    }
}

public enum BankListLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(APIError)
}
