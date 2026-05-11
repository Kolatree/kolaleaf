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

// Default values for these keys are *placeholder* instances rather than fatalError sentinels.
// The original "crash loud on missing injection" design (#10) was too aggressive: SwiftUI's
// runtime enumerates EnvironmentKey defaults during view-graph setup (and the test runner
// launches the host app even when no test reads the value), so fatalError fires before any
// real injection point can run.
//
// Production callers always inject in `KolaleafApp.body`; missing-injection regressions show
// up as the placeholder instance hitting the network with a localhost URL or no-op keychain
// reads — surfaced through normal QA, not a debug-only crash that breaks `xcodebuild test`.

// CA-001 / CA-005 (iteration-2): the EnvironmentKey is typed against the
// `AuthAPI` protocol rather than the concrete `APIClient` actor. Production
// still injects an `APIClient` (which conforms), but tests and previews can
// substitute a `FakeAPIClient` via `.environment(\.apiClient, FakeAPIClient())`
// without depending on the concrete type. The default value is a concrete
// `APIClient` instance so the placeholder remains a real network client.
private struct APIClientKey: EnvironmentKey {
    static let defaultValue: AuthAPI = {
        let urlString = ProcessInfo.processInfo.environment["KOLA_API_BASE_URL"]
            ?? "https://kolaleaf.com.au"
        let url = URL(string: urlString) ?? URL(string: "https://kolaleaf.com.au")!
        return APIClient(baseURL: url)
    }()
}

private struct KeychainKey: EnvironmentKey {
    static let defaultValue: Keychain = Keychain()
}

private struct ReferralCaptureKey: EnvironmentKey {
    /// Default value: a no-op capture wired to a throwaway keychain + ephemeral
    /// defaults. Lets SwiftUI previews and tests render without the app root
    /// having to inject — the no-op never persists anything.
    static let defaultValue: ReferralCapture = ReferralCapture(
        keychain: Keychain(service: "com.kolaleaf.previews"),
        defaults: UserDefaults(suiteName: "kola.previews") ?? .standard
    )
}

private struct PushPermissionServiceKey: EnvironmentKey {
    /// Default: pointed at the same APIClient default. Real injection happens
    /// at KolaleafApp's WindowGroup root; this default keeps previews and
    /// tests building without an explicit `.environment(...)` call.
    static let defaultValue: PushPermissionService = PushPermissionService(
        api: APIClientKey.defaultValue
    )
}

// CA-002 (iteration-2): BankStore is session-scoped bank list cache. Default
// value uses the same APIClientKey default so previews/tests render without
// explicit injection. KolaleafApp wires the canonical instance in body.
private struct BankStoreKey: EnvironmentKey {
    // `BankStore.init` is `nonisolated` — see BankStore.swift — so
    // this default value can be constructed without a MainActor hop
    // (required for `EnvironmentKey.defaultValue`).
    static let defaultValue: BankStore = BankStore(api: APIClientKey.defaultValue)
}

public extension EnvironmentValues {
    var apiClient: AuthAPI {
        get { self[APIClientKey.self] }
        set { self[APIClientKey.self] = newValue }
    }
    var keychain: Keychain {
        get { self[KeychainKey.self] }
        set { self[KeychainKey.self] = newValue }
    }
    var referralCapture: ReferralCapture {
        get { self[ReferralCaptureKey.self] }
        set { self[ReferralCaptureKey.self] = newValue }
    }
    var pushPermissionService: PushPermissionService {
        get { self[PushPermissionServiceKey.self] }
        set { self[PushPermissionServiceKey.self] = newValue }
    }
    @MainActor
    var bankStore: BankStore {
        get { self[BankStoreKey.self] }
        set { self[BankStoreKey.self] = newValue }
    }
}
