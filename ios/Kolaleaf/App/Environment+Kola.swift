// Environment+Kola.swift  (Phase 0 · U8)
// Custom EnvironmentValues keys for cross-cutting dependencies.
//
// r2-review fix · 2026-05-09 (#10): defaults are fatalError-on-access sentinels rather
// than fresh detached instances. A view that reads `\.apiClient` without injection now
// crashes loudly instead of silently producing a separate instance pointed at production.
// AppState injection uses the iOS 17 `@Environment(AppState.self)` form (Observation
// framework), so no `\.appState` keypath is provided — that path was dead wiring.

import SwiftUI

// Default values for these keys are *placeholder* instances rather than fatalError sentinels.
// The original "crash loud on missing injection" design (#10) was too aggressive: SwiftUI's
// runtime enumerates EnvironmentKey defaults during view-graph setup (and the test runner
// launches the host app even when no test reads the value), so fatalError fires before any
// real injection point can run.
//
// Production callers always inject in `KolaleafApp.body`; missing-injection regressions show
// up as the placeholder instance hitting the network with a localhost URL or no-op keychain
// reads — surfaced through normal QA, not a debug-only crash that breaks `xcodebuild test`.

private struct APIClientKey: EnvironmentKey {
    static let defaultValue: APIClient = APIClient(baseURL: URL(string: "http://localhost")!)
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
