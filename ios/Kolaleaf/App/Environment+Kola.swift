// Environment+Kola.swift  (Phase 0 · U8)
// Custom EnvironmentValues keys for cross-cutting dependencies.
//
// r2-review fix · 2026-05-09 (#10): defaults are fatalError-on-access sentinels rather
// than fresh detached instances. A view that reads `\.apiClient` without injection now
// crashes loudly instead of silently producing a separate instance pointed at production.
// AppState injection uses the iOS 17 `@Environment(AppState.self)` form (Observation
// framework), so no `\.appState` keypath is provided — that path was dead wiring.

import SwiftUI

private struct APIClientKey: EnvironmentKey {
    static let defaultValue: APIClient = {
        fatalError("APIClient must be injected via .environment(\\.apiClient, ...) in App body")
    }()
}

private struct KeychainKey: EnvironmentKey {
    static let defaultValue: Keychain = {
        fatalError("Keychain must be injected via .environment(\\.keychain, ...) in App body")
    }()
}

public extension EnvironmentValues {
    var apiClient: APIClient {
        get { self[APIClientKey.self] }
        set { self[APIClientKey.self] = newValue }
    }
    var keychain: Keychain {
        get { self[KeychainKey.self] }
        set { self[KeychainKey.self] = newValue }
    }
}
