// Environment+Kola.swift  (Phase 0 · U8)
// Custom EnvironmentValues keys for cross-cutting dependencies.
//
// AppState injection uses the iOS 17 `@Environment(AppState.self)` form (Observation
// framework), so no `\.appState` keypath is provided — that path was dead wiring.
//
// Defaults are detached safe sentinel instances. SwiftUI eagerly reads
// EnvironmentKey defaults during scene bootstrap, so a fatalError default would
// crash before any `.environment(...)` modifier had a chance to apply. A view
// that genuinely reads an un-injected client gets a freshly-built instance
// (pointed at the production base URL / app-private keychain) — wrong, but not
// a runtime crash. App body wiring still injects the canonical instance.

import SwiftUI

private struct APIClientKey: EnvironmentKey {
    static let defaultValue: APIClient = {
        let urlString = ProcessInfo.processInfo.environment["KOLA_API_BASE_URL"]
            ?? "https://kolaleaf.com.au"
        let url = URL(string: urlString) ?? URL(string: "https://kolaleaf.com.au")!
        return APIClient(baseURL: url)
    }()
}

private struct KeychainKey: EnvironmentKey {
    static let defaultValue: Keychain = Keychain()
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
