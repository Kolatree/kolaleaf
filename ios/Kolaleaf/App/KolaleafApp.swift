// KolaleafApp.swift  (Phase 0 · U8 / Phase 1 root)
// @main entry. Initialises shared singletons and installs the RootCoordinator.
//
// r2-review fixes · 2026-05-09:
//   • #3 (correctness): scenePhase .active calls shouldForceReauth() BEFORE markForegrounded
//     so the foreground-idle path is reachable.
//   • #9 (security): force-logout clears the private cookie jar regardless of the network
//     call's outcome, so the local cookie can't be replayed if /auth/logout fails.
//   • #14 (swift-ios): preferredColorScheme(.dark) removed from the WindowGroup root —
//     it was forcing dark on system sheets/alerts. Wallpaper carries the dark surface;
//     system UI now follows user preference.

import SwiftUI

@main
struct KolaleafApp: App {
    @State private var appState = AppState()
    @State private var apiClient: APIClient
    @State private var keychain: Keychain
    @State private var referralCapture: ReferralCapture
    @State private var pushPermissionService: PushPermissionService
    /// CA-002 (iteration-2): session-scoped bank list cache. Wired here
    /// so a sheet re-open (or NavigationStack re-mount) doesn't refetch.
    @State private var bankStore: BankStore
    /// Phase 8 iter-2 (P1): the production SwiftData stack. Constructed
    /// once at app launch and threaded into every feature via
    /// `\.swiftDataStack`. The EnvironmentKey default is an in-memory
    /// stack so previews/tests don't crash; production callers always
    /// receive THIS instance because the WindowGroup `.environment`
    /// modifier wins over the default.
    @State private var swiftDataStack: SwiftDataStack
    /// Phase 8 iter-2 (P5): one SyncService for the whole app, sharing
    /// the same SwiftData writer with every feature. Foreground scene
    /// phase triggers a refresh through this instance so Activity and
    /// Recipients stay coherent.
    @State private var syncService: SyncService

    @Environment(\.scenePhase) private var scenePhase
    /// Phase 2 review fix (P1, adversarial adv-003): wire APNs callbacks so
    /// the device token actually reaches PushPermissionService.register().
    @UIApplicationDelegateAdaptor(PushNotificationDelegate.self) private var pushDelegate

    init() {
        // ReferralCapture (U91) shares the same Keychain instance used elsewhere.
        // Build both in init so the wiring is single-source-of-truth.
        let kc = Keychain()
        _keychain = State(initialValue: kc)
        _referralCapture = State(initialValue: ReferralCapture(keychain: kc))
        // PushPermissionService is wired against the same APIClient instance
        // so backend POST /account/push-tokens shares the session cookie jar.
        // Constructed in init for the same single-source-of-truth reason.
        let initialClient = Self.makeAPIClient()
        _apiClient = State(initialValue: initialClient)
        let pps = PushPermissionService(api: initialClient)
        _pushPermissionService = State(initialValue: pps)
        // CA-002 (iteration-2): canonical BankStore wired against the
        // same APIClient so it shares the session cookie jar.
        _bankStore = State(initialValue: BankStore(api: initialClient))
        // Phase 8 iter-2 (P1 + P5): production SwiftData stack and the
        // single SyncService that writes through it. Both live for the
        // process lifetime so a tab switch doesn't drop the cache or
        // race against a half-constructed writer.
        let stack = SwiftDataStack(inMemory: false)
        _swiftDataStack = State(initialValue: stack)
        _syncService = State(initialValue: SyncService(api: initialClient, stack: stack))
        // Bind the AppDelegate so APNs device-token callbacks reach the
        // service. Done in init so the binding is in place before the first
        // `registerForRemoteNotifications()` call.
        Task { @MainActor in PushNotificationDelegate.bind(pps) }
    }

    private static func makeAPIClient() -> APIClient {
        let urlString = ProcessInfo.processInfo.environment["KOLA_API_BASE_URL"]
            ?? "https://www.kolaleaf.com"
        guard let url = URL(string: urlString) else {
            fatalError("KOLA_API_BASE_URL is invalid: \(urlString)")
        }
        return APIClient(baseURL: url)
    }

    var body: some Scene {
        WindowGroup {
            RootCoordinator()
                .environment(appState)
                .environment(\.apiClient, apiClient)
                .environment(\.keychain, keychain)
                .environment(\.referralCapture, referralCapture)
                .environment(\.pushPermissionService, pushPermissionService)
                .environment(\.bankStore, bankStore)
                .environment(\.swiftDataStack, swiftDataStack)
                .environment(\.syncService, syncService)
                .task { await wireAPIClientHooks() }
                // ADV-P10A-C1 (Phase 10A iter-2): handle the
                // `kolaleaf://` scheme registered in project.yml. The
                // Live Activity surfaces deep-link into the app via
                // `kolaleaf://transfer/<id>`; routing logic lives in
                // `DeepLinkRouter.handle(_:appState:)`.
                .onOpenURL { url in
                    DeepLinkRouter.handle(url, appState: appState)
                }
        }
        .onChange(of: scenePhase) { _, newPhase in
            handleScenePhase(newPhase)
        }
    }

    // MARK: - App lifecycle

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .background:
            appState.markBackgrounded()
        case .active:
            // r2 fix #3: compute reauth FIRST, then mark foreground. Otherwise
            // markForegrounded() clears lastBackgroundedAt and the check is unreachable.
            let needsReauth = appState.shouldForceReauth()
            appState.markForegrounded()
            if needsReauth && appState.hasActiveSession {
                Task { await forceReauth() }
            } else if appState.hasActiveSession {
                // Phase 8 iter-2 (P5): refresh the SwiftData mirror on
                // every foreground hop so Activity + Recipients reflect
                // changes a different device (or web) made while the
                // app was suspended. Idempotent — upserts only.
                Task { await syncService.syncAll() }
            }
        case .inactive:
            // Scene resigning active — switcher snapshot moment. SwitcherBlur installs the overlay.
            break
        @unknown default:
            break
        }
    }

    private func wireAPIClientHooks() async {
        // Bump idle clock on every successful API call (U76b).
        await apiClient.setSuccessHook { [appState] in
            await appState.bumpInteraction()
        }
    }

    private func forceReauth() async {
        // r2 fix #9: clear local credentials FIRST so a stale cookie cannot be replayed
        // even if /auth/logout fails (offline, 5xx, captive portal). The network call
        // is best-effort.
        try? await keychain.delete(forKey: KeychainKeys.sessionToken)
        try? await keychain.delete(forKey: KeychainKeys.currentUserId)
        // P3 fix (Phase 1 review): also clear referral state so logout is total.
        // Pasteboard one-shot flag clears so the next install-fresh user gets
        // their own referral capture window; keychain referral token vanishes
        // alongside the session token.
        try? await keychain.delete(forKey: KeychainKeys.referralToken)
        UserDefaults.standard.removeObject(forKey: "kola.referralPasteboardScanned")
        await apiClient.clearCookies()
        appState.clearForLogout()
        // Phase 8 iter-2 (P2): wipe the SwiftData mirror so the next
        // sign-in (potentially a different user on the same device)
        // cannot see the previous user's cached recipients/transfers.
        // Failure is logged in DEBUG but never blocks logout — a stale
        // cache on a logged-out app surfaces only as a one-frame
        // flicker on next sign-in (the live fetch overwrites within ms).
        try? swiftDataStack.deleteAll()
        // Phase 8 iter-2 (P4): drop the bank-list cache too so the
        // next session refetches `/banks` against the new user's
        // session. Comments on BankStore.reset() previously claimed
        // logout invoked this — that wiring lives here.
        bankStore.reset()

        // Best-effort network revoke. Note: the local cookie is already gone, so this
        // request goes out cookie-less and the backend will return 401 — that's fine,
        // we use it to instruct the backend session row to delete if the cookie was
        // still on a different store.
        _ = await apiClient.send(AuthEndpoints.Logout())
    }
}

// `RootCoordinator` is defined in `App/RootCoordinator.swift` (U15).
