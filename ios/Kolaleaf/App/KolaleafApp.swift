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
    @State private var deviceAttestationService: DeviceAttestationService
    @State private var pushPermissionService: PushPermissionService
    @State private var analyticsService: AnalyticsService
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
    /// Phase 10C iter-1 · CA-2007: one LiveActivityService for the
    /// whole process, owning the `transferId → ActivityKit UUID` map
    /// and the start / apply / end lifecycle for transfer Live
    /// Activities. Constructed in init so the WindowGroup body can
    /// inject it via Environment and call `reconcileOnLaunch()` on
    /// cold start (ADV-P10B-C3). `forceReauth()` ends every in-flight
    /// activity BEFORE clearing cookies so a logged-out user can't
    /// leave activities rendering on the lock screen for the next
    /// user of a shared device (ADV-P10B-C10).
    @State private var liveActivityService: LiveActivityService
    /// Phase 11 · Face ID unlock: per-process biometric lock state.
    /// Persists the "require Face ID at launch" preference and
    /// drives BiometricLockView when the user comes back to a
    /// foreground after backgrounding the app.
    @State private var biometricUnlock: BiometricUnlockController
    private let appPasscodeService: AppPasscodeService
    @State private var activeFeedbackDraft: FeedbackDraft?
    private let biometricsService: any BiometricsService = LABiometricsService()
    @AppStorage(AppLocale.storageKey) private var appLocaleRawValue = AppLocale.system.rawValue

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Phase 2 review fix (P1, adversarial adv-003): wire APNs callbacks so
    /// the device token actually reaches PushPermissionService.register().
    @UIApplicationDelegateAdaptor(PushNotificationDelegate.self) private var pushDelegate

    init() {
        // ReferralCapture (U91) shares the same Keychain instance used elsewhere.
        // Build both in init so the wiring is single-source-of-truth.
        let kc = Keychain()
        _keychain = State(initialValue: kc)
        appPasscodeService = AppPasscodeService(keychain: kc)
        _referralCapture = State(initialValue: ReferralCapture(keychain: kc))
        // PushPermissionService is wired against the same APIClient instance
        // so backend POST /account/push-tokens shares the session cookie jar.
        // Constructed in init for the same single-source-of-truth reason.
        let initialClient = Self.makeAPIClient()
        _apiClient = State(initialValue: initialClient)
        _deviceAttestationService = State(initialValue: DeviceAttestationService(
            api: initialClient,
            keychain: kc
        ))
        let pps = PushPermissionService(api: initialClient)
        _pushPermissionService = State(initialValue: pps)
        _analyticsService = State(initialValue: AnalyticsService(api: initialClient))
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
        // Phase 10C iter-1 · CA-2007: single LiveActivityService for the
        // whole process. `api` is wired so `reconcileOnLaunch()` can
        // refetch each survivor activity's current backend status
        // (ADV-P10B-C3) and end ones that advanced to a terminal state
        // while the app was suspended.
        _liveActivityService = State(initialValue: LiveActivityService(api: initialClient))
        // Phase 11 · Face ID unlock: preference + per-session unlock
        // flag. Reads `kola.faceIDUnlockEnabled` from .standard at
        // init so the value is available before the first body render.
        _biometricUnlock = State(initialValue: BiometricUnlockController())
        // Bind the AppDelegate so APNs device-token callbacks reach the
        // service. Done in init so the binding is in place before the first
        // `registerForRemoteNotifications()` call.
        Task { @MainActor in PushNotificationDelegate.bind(pps) }
    }

    private static func makeAPIClient() -> APIClient {
        APIClient(baseURL: AppBackend.baseURL)
    }

    var body: some Scene {
        WindowGroup {
            rootContent
                .environment(appState)
                .environment(\.apiClient, apiClient)
                .environment(\.keychain, keychain)
                .environment(\.referralCapture, referralCapture)
                .environment(\.pushPermissionService, pushPermissionService)
                .environment(\.analyticsService, appState.hasActiveSession ? analyticsService : nil)
                .environment(\.bankStore, bankStore)
                .environment(\.swiftDataStack, swiftDataStack)
                .environment(\.syncService, syncService)
                .environment(\.liveActivityService, liveActivityService)
                .environment(\.biometricUnlock, biometricUnlock)
                .environment(\.locale, AppLocale.normalized(appLocaleRawValue).locale)
                .id(appLocaleRawValue)
                .shakeToReport(activeDraft: $activeFeedbackDraft)
                .sheet(item: $activeFeedbackDraft) { draft in
                    FeedbackReportView(draft: draft)
                }
                .task { await wireAPIClientHooks() }
                // Phase 11.5: after a session exists, register the
                // current App Attest key with the backend. The backend
                // returns a user-facing alert only when this is a new
                // device relative to prior authenticated devices.
                .task(id: appState.currentUser?.id) {
                    await configureBiometricUnlockForSession()
                    await registerDeviceAttestationForSession()
                    if appState.hasActiveSession {
                        await analyticsService.flush()
                    }
                }
                // Phase 10C iter-1 · CA-2007 + ADV-P10B-C3: reconcile
                // the persisted `transferId → activityId` map against
                // `Activity.activities` on cold start. Drops stale
                // entries the OS killed while we were suspended and
                // re-fetches each survivor's backend status so a
                // transfer that completed-while-suspended ends instead
                // of staying frozen on the lock screen. Idempotent —
                // a `.task` on the WindowGroup body fires once per
                // process lifetime.
                .task { await liveActivityService.reconcileOnLaunch() }
                .task {
                    if appState.hasActiveSession {
                        await analyticsService.flush()
                    }
                }
                // Handle both the `kolaleaf://` custom scheme and the
                // scoped HTTPS universal-link routes declared in AASA.
                .onOpenURL { url in
                    Task {
                        await DeepLinkRouter.handle(
                            url,
                            appState: appState,
                            referralCapture: referralCapture
                        )
                    }
                }
        }
        .onChange(of: scenePhase) { _, newPhase in
            handleScenePhase(newPhase)
        }
    }

    private func registerDeviceAttestationForSession() async {
        guard appState.hasActiveSession else { return }
        let result = await deviceAttestationService.registerCurrentDevice()
        if case .success(let response) = result,
           response.shouldAlert,
           let alert = response.alert,
           NotificationPreferenceKeys.newDeviceAlertsEnabled() {
            appState.showNewDeviceAlert(title: alert.title, message: alert.message)
        }
    }

    private func configureBiometricUnlockForSession() async {
        guard appState.hasActiveSession else { return }
        let passcodeConfigured = await appPasscodeService.isConfigured()
        if biometricUnlock.faceIDUnlockEnabled, !passcodeConfigured {
            biometricUnlock.resetPrePasscodeLock()
        }
    }

    // MARK: - Root content w/ Face ID gate
    //
    // Phase 11 · Face ID unlock. The gate overlays RootCoordinator
    // when `shouldShowGate(...)` is true. We compose it as a ZStack
    // inside the WindowGroup so the RootCoordinator's NavigationStack
    // lifecycle is unaffected — the views behind the gate stay in
    // memory and resume cleanly once Face ID succeeds.
    @ViewBuilder
    private var rootContent: some View {
        // iter-2 review fix (API-404): the gate composition now lives
        // on `BiometricUnlockController.shouldShowGate(hasActiveSession:)`
        // — the caller threads the session flag once and the controller
        // composes against its own state. Keeps `rootContent` a single
        // boolean read and removes the two-non-independent-args footgun
        // that had us passing `appState.hasActiveSession` to both
        // arguments of the prior static method.
        let shouldGate = biometricUnlock.shouldShowGate(
            hasActiveSession: appState.hasActiveSession
        )
        ZStack {
            RootCoordinator()
            if shouldGate {
                BiometricLockView(
                    controller: biometricUnlock,
                    service: biometricsService,
                    passcodeService: appPasscodeService,
                    onSignOut: {
                        Task { await forceReauth() }
                    }
                )
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .animation(KolaMotion.fade(reduce: reduceMotion), value: shouldGate)
    }

    // MARK: - App lifecycle

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .background:
            appState.markBackgrounded()
            // Phase 11 · Face ID unlock: re-lock on background so the
            // next foreground entry re-presents the gate (when the
            // preference is on). `.inactive` is handled below — the
            // OS fires it for control-center pulls / notification
            // banners / multitasker switches, all of which expose
            // the screen contents to a bystander.
            biometricUnlock.lockForBackground()
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
            if appState.hasActiveSession {
                Task { await analyticsService.flush() }
            }
        case .inactive:
            // Scene resigning active — switcher snapshot moment.
            // SwitcherBlur installs the overlay. 4-lens review fix
            // (silent-failure-hunter #5): also re-lock on .inactive
            // so a control-center pull / notification banner /
            // multitasker peek that never reaches .background can't
            // leak an unlocked session to a bystander.
            biometricUnlock.lockForBackground()
        @unknown default:
            break
        }
    }

    private func wireAPIClientHooks() async {
        // Bump idle clock on every successful USER-origin API call (U76b
        // → split in U76b4). System-origin calls (push-token sync, 5s
        // fallback polls) deliberately do NOT bump the idle clock so
        // background traffic can't mask a walked-away user.
        await apiClient.setUserSuccessHook { [appState] in
            await appState.bumpInteraction()
        }
        await apiClient.setSystemSuccessHook { /* intentionally no-op */ }
    }

    private func forceReauth() async {
        // Phase 10C iter-1 · ADV-P10B-C10: end every in-flight Live
        // Activity BEFORE we destroy keychain / cookies. The OS keeps
        // Live Activities running until we explicitly dismiss them or
        // their 8-hour wall-clock TTL elapses — on a shared device,
        // the next user logging in could otherwise see the previous
        // user's transfer surfaces stranded on the lock screen.
        // `endAllActivities()` cancels every pending grace timer up
        // front so a COMPLETED-grace dismissal can't race the
        // immediate ends issued here. Backend revocation of the
        // per-activity APNS tokens is a backend concern — see the
        // `// TODO(ADV-P10B-C10-backend)` marker in `PushTokenSync.swift`.
        //
        // Phase 10C iter-2 · ADV-P10C-W5: race `endAllActivities()`
        // against a 2-second budget so an ActivityKit hang (observed
        // on iOS 18.0–18.1 betas) cannot block the keychain / cookie
        // wipe. If we miss the dismissal window, surfaces TTL out at
        // the 8-hour boundary at worst — far better than leaving the
        // user holding a valid session on a shared device.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await liveActivityService.endAllActivities() }
            group.addTask { try? await Task.sleep(nanoseconds: 2_000_000_000) }
            _ = await group.next()
            group.cancelAll()
        }
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
        // Phase 11 · Face ID unlock: drop the per-session unlock flag
        // so a fresh sign-in for a different user doesn't inherit
        // the prior owner's unlocked state.
        biometricUnlock.clearForLogout()
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
