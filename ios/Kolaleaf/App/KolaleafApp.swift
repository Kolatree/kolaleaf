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
    @State private var apiClient: APIClient = {
        let urlString = ProcessInfo.processInfo.environment["KOLA_API_BASE_URL"]
            ?? "https://kolaleaf.com.au"
        guard let url = URL(string: urlString) else {
            fatalError("KOLA_API_BASE_URL is invalid: \(urlString)")
        }
        return APIClient(baseURL: url)
    }()
    @State private var keychain: Keychain
    @State private var referralCapture: ReferralCapture

    @Environment(\.scenePhase) private var scenePhase

    init() {
        // ReferralCapture (U91) shares the same Keychain instance used elsewhere.
        // Build both in init so the wiring is single-source-of-truth.
        let kc = Keychain()
        _keychain = State(initialValue: kc)
        _referralCapture = State(initialValue: ReferralCapture(keychain: kc))
    }

    var body: some Scene {
        WindowGroup {
            RootCoordinator()
                .environment(appState)
                .environment(\.apiClient, apiClient)
                .environment(\.keychain, keychain)
                .environment(\.referralCapture, referralCapture)
                .task { await wireAPIClientHooks() }
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
        await apiClient.clearCookies()
        appState.clearForLogout()

        // Best-effort network revoke. Note: the local cookie is already gone, so this
        // request goes out cookie-less and the backend will return 401 — that's fine,
        // we use it to instruct the backend session row to delete if the cookie was
        // still on a different store.
        _ = await apiClient.send(AuthEndpoints.Logout())
    }
}

/// Phase 1 root view. Routes by `hasActiveSession`. The post-auth branch is a
/// transient stub until U33 (MainTabView) lands; the unauth branch shows the
/// real `WelcomeView` (U16). The full coordinator (U15) takes over in a follow-up.
struct RootCoordinator: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        if appState.hasActiveSession {
            // Replaced by MainTabView in Phase 4 (U33).
            VStack {
                Text("Kolaleaf")
                    .font(KolaFont.headline)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                Text("Phase 1 root coming up")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
            }
            .kolaWallpaper()
        } else {
            WelcomeView(
                onGetStarted: { /* wired to phone signup in U17 */ },
                onSignIn: { /* wired to login in U21 */ }
            )
        }
    }
}
