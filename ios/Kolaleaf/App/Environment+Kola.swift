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
        APIClient(baseURL: AppBackend.baseURL)
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

private struct AnalyticsServiceKey: EnvironmentKey {
    /// Nil by default so SwiftUI can read environment defaults from a
    /// nonisolated context. Production injects the process-scoped
    /// service from `KolaleafApp`.
    static let defaultValue: AnalyticsService? = nil
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

// Phase 8 iter-2 (P5): a single SyncService instance is constructed at
// KolaleafApp's body and threaded through the environment so every
// feature shares one SwiftData writer. Default is `nil` — features
// fall back to a local instance when the env hasn't been wired
// (previews, tests), matching the AuthAPI placeholder pattern.
private struct SyncServiceKey: EnvironmentKey {
    static let defaultValue: SyncService? = nil
}

// Phase 10C iter-1 · CA-2007: a single LiveActivityService instance is
// constructed at KolaleafApp's init and threaded through the environment
// so transfer flows can drive start / apply / end against a shared
// activity store. Default is `nil` — features that read the env
// without an injected service must no-op (matches the SyncService
// pattern). The production wire-up calls `reconcileOnLaunch()` once
// per cold start from the WindowGroup body.
private struct LiveActivityServiceKey: EnvironmentKey {
    static let defaultValue: LiveActivityService? = nil
}

// Phase 11 · Face ID unlock: a single BiometricUnlockController
// instance owned by KolaleafApp drives the lock state across the
// entire WindowGroup. Nil default keeps previews / tests rendering
// without explicit injection.
private struct BiometricUnlockKey: EnvironmentKey {
    static let defaultValue: BiometricUnlockController? = nil
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
    var analyticsService: AnalyticsService? {
        get { self[AnalyticsServiceKey.self] }
        set { self[AnalyticsServiceKey.self] = newValue }
    }
    @MainActor
    var bankStore: BankStore {
        get { self[BankStoreKey.self] }
        set { self[BankStoreKey.self] = newValue }
    }
    /// Phase 8 iter-2 (P5): app-root SyncService. Nil when not
    /// injected — features fall back to a local SyncService.
    @MainActor
    var syncService: SyncService? {
        get { self[SyncServiceKey.self] }
        set { self[SyncServiceKey.self] = newValue }
    }
    /// Phase 10C iter-1 · CA-2007: app-root LiveActivityService. Nil
    /// when not injected — feature code must guard against the
    /// optional so previews/tests can render without ActivityKit.
    @MainActor
    var liveActivityService: LiveActivityService? {
        get { self[LiveActivityServiceKey.self] }
        set { self[LiveActivityServiceKey.self] = newValue }
    }
    /// Phase 11 · Face ID unlock controller. Nil for previews/tests.
    @MainActor
    var biometricUnlock: BiometricUnlockController? {
        get { self[BiometricUnlockKey.self] }
        set { self[BiometricUnlockKey.self] = newValue }
    }
}
