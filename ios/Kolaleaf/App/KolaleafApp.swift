// KolaleafApp.swift  (Phase 0 · U8 / Phase 1 root)
// @main entry. Initialises shared singletons (AppState, APIClient, Keychain) and
// installs the RootCoordinator. Coordinator branches by AppState; this file stays minimal.

import SwiftUI

@main
struct KolaleafApp: App {
    @State private var appState = AppState()
    @State private var apiClient: APIClient = {
        let url = URL(string: ProcessInfo.processInfo.environment["KOLA_API_BASE_URL"]
                      ?? "https://kolaleaf.com.au")!
        return APIClient(baseURL: url)
    }()
    @State private var keychain = Keychain()

    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootCoordinator()
                .environment(appState)
                .environment(\.apiClient, apiClient)
                .environment(\.keychain, keychain)
                .preferredColorScheme(.dark)  // Variant C is dark-on-gradient by design
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
            appState.markForegrounded()
            // Re-auth check fires here per U76b. RootCoordinator reacts to AppState changes.
            if appState.shouldForceReauth() && appState.hasActiveSession {
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
        await apiClient.setSuccessHook { [weak appState] in
            await MainActor.run { appState?.bumpInteraction() }
        }
    }

    private func forceReauth() async {
        // Clear local state — the network call to /auth/logout is best-effort.
        let result = await apiClient.send(AuthEndpoints.Logout())
        if case .failure = result {
            // Even if logout call fails, drop local state. Backend session may have already expired.
        }
        try? await keychain.delete(forKey: KeychainKeys.sessionToken)
        try? await keychain.delete(forKey: KeychainKeys.currentUserId)
        await MainActor.run { appState.clearForLogout() }
    }
}

/// Placeholder root view until Phase 1 (U15) lands. Routes by hasActiveSession to either
/// a Welcome stub (unauth) or a "Main app" stub (auth). Replaced by real RootCoordinator
/// in Phase 1.
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
            // Replaced by WelcomeView in Phase 1 (U16).
            VStack {
                Text("Kola")
                    .font(KolaFont.headline)
                + Text("leaf")
                    .font(KolaFont.headline)
                    .foregroundStyle(KolaColors.greenLight)
                Text("Send to Nigeria · Welcome stub")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                    .padding(.top, KolaSpacing.s)
            }
            .kolaWallpaper()
        }
    }
}
