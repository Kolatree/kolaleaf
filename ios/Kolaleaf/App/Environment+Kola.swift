// Environment+Kola.swift  (Phase 0 · U8)
// Custom EnvironmentValues keys for cross-cutting dependencies. Use `@Environment(\.apiClient)`
// in views/view-models that need them; tests inject fakes via .environment(\.apiClient, FakeAPIClient()).

import SwiftUI

private struct APIClientKey: EnvironmentKey {
    static let defaultValue: APIClient = APIClient(
        baseURL: URL(string: "https://kolaleaf.com.au")!  // overridden at app launch from Info.plist
    )
}

private struct KeychainKey: EnvironmentKey {
    static let defaultValue: Keychain = Keychain()
}

private struct AppStateKey: EnvironmentKey {
    static let defaultValue: AppState = AppState()
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
    var appState: AppState {
        get { self[AppStateKey.self] }
        set { self[AppStateKey.self] = newValue }
    }
}
