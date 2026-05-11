// BankStore.swift  (Phase 4 · iteration-2 · CA-002)
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
// `reset()` is called on logout (AppState.clearForLogout) so a fresh
// sign-in starts from a cold cache. Without that the previous user's
// list (which is identical anyway, but the contract is per-session)
// would survive into the new session.

import Foundation
import Observation

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

    /// Drop the cached list. Called from `AppState.clearForLogout` so
    /// the next sign-in starts with a cold cache.
    public func reset() {
        banks = []
        lastFetchedAt = nil
        loadState = .idle
    }
}

public enum BankListLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(APIError)
}
