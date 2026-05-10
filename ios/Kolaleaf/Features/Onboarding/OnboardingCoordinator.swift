// OnboardingCoordinator.swift  (Phase 1 · U23)
// NavigationStack-driven flow controller for screens 01-06.
//
// Two entry points:
//   • .welcome — fresh launch, no session
//   • .kycIntro — session exists but KYC isn't approved (resumed onboarding)
//
// Routes are pure values driven onto a `NavigationPath`. The coordinator owns
// nothing more than the path and a closure that constructs the right view for
// each route, so the actual navigation logic is unit-testable without a
// SwiftUI host (see OnboardingCoordinatorTests).

import SwiftUI

/// Pure value type representing one stop in the onboarding flow.
public enum OnboardingRoute: Hashable, Sendable {
    case welcome
    case signIn
    case emailEntry
    case emailOTP(email: String)
    case registrationDetails(email: String)
    case kycIntro
    /// Phase 2 · U22a — pre-warm shell shown briefly before mounting Sumsub.
    case kycPreWarm(session: KYCSession)
    /// Phase 2 · U24 — Sumsub presenter (WKWebView fallback at v1 ship; native
    /// SDK once the SwiftPM package is added post-signing).
    case kycSumsub(session: KYCSession)
    /// Phase 2 · U25 — polling screen after Sumsub dismisses.
    case kycProcessing
    /// Phase 2 · U26 — REJECTED state with retry CTA.
    case kycSoftRejection
    /// Phase 2 · U27 — IN_REVIEW state, waiting on human reviewer.
    case kycUnderReview
}

extension KYCSession: Hashable {
    public func hash(into hasher: inout Hasher) {
        // Phase 2 review fix (P3, swift-ios-008): omit `accessToken` from
        // the hash. If OnboardingRoute is later made Codable for state
        // restoration, the bearer secret would otherwise end up in the
        // persisted NavigationPath. `applicantId` + `verificationUrl`
        // already disambiguate per-session.
        hasher.combine(applicantId)
        hasher.combine(verificationUrl)
    }
}

/// Pure transition rules — what happens on each event from a given route.
/// Tested in isolation; SwiftUI views invoke these via the coordinator.
public enum OnboardingTransition {

    /// Welcome → either Sign-in or Email entry, by user choice.
    public static func fromWelcome(action: WelcomeAction) -> OnboardingRoute {
        switch action {
        case .signIn:    return .signIn
        case .register:  return .emailEntry
        }
    }

    public enum WelcomeAction { case signIn, register }

    /// Email entry → Email OTP with the normalised email.
    public static func fromEmailEntry(codeSentTo email: String) -> OnboardingRoute {
        .emailOTP(email: email)
    }

    /// Email OTP verified → registration details (collect name + password + AU address).
    public static func fromEmailOTP(verifiedEmail email: String) -> OnboardingRoute {
        .registrationDetails(email: email)
    }

    /// Sign-in 202 → bounce to OTP for the given email so the user can verify.
    public static func fromSignInVerificationRequired(email: String) -> OnboardingRoute {
        .emailOTP(email: email)
    }

    /// Registration completed → KYC intro.
    public static func fromRegistrationDetails() -> OnboardingRoute {
        .kycIntro
    }

    /// KYC intro got a fresh Sumsub session → mount the pre-warm shell.
    public static func fromKYCIntro(sessionFetched session: KYCSession) -> OnboardingRoute {
        .kycPreWarm(session: session)
    }

    /// Pre-warm timer elapsed → present Sumsub.
    public static func fromKYCPreWarm(session: KYCSession) -> OnboardingRoute {
        .kycSumsub(session: session)
    }

    /// Sumsub dismissed → route via SumsubBridge decision.
    public static func fromSumsubResult(
        _ result: SumsubResult,
        currentStatus: KycStatus
    ) -> OnboardingRoute {
        let decision = SumsubBridge.decide(result: result, currentStatus: currentStatus)
        switch decision.nextRoute {
        case .processing:     return .kycProcessing
        case .verified:       return .kycProcessing  // single hop, view detects terminal immediately
        case .retryFromIntro: return .kycIntro
        }
    }

    /// Polling resolved → route by terminal state. Note that `.verified`
    /// and `.unauthorized` are NOT mapped here — the OnboardingCoordinator
    /// handles those via `appState.kycStatus = .verified` (hands off to
    /// RootCoordinator's MainTab) and `appState.clearForLogout()`
    /// (hands off to the welcome screen) respectively, since both require
    /// AppState mutation that an OnboardingRoute can't express.
    public static func fromKYCProcessing(_ terminal: KYCProcessingViewModel.Terminal) -> OnboardingRoute? {
        switch terminal {
        case .rejected:     return .kycSoftRejection
        case .timedOut:     return .kycUnderReview
        case .verified, .unauthorized: return nil
        }
    }
}

@MainActor
public struct OnboardingCoordinator: View {

    public enum Entry { case welcome, kycIntro }

    @Environment(AppState.self) private var appState
    @Environment(\.apiClient) private var apiClient
    @Environment(\.pushPermissionService) private var pushPermissionService
    @State private var path: [OnboardingRoute]

    private let entry: Entry

    public init(startAt entry: Entry) {
        self.entry = entry
        // The root view is implied by `entry`; intermediate stops live in `path`.
        // For .kycIntro entry we push it directly so back-stack pops to nothing.
        self._path = State(initialValue: [])
    }

    public var body: some View {
        NavigationStack(path: $path) {
            rootView
                .navigationDestination(for: OnboardingRoute.self) { route in
                    destination(for: route)
                }
        }
    }

    // MARK: - Root view by entry

    @ViewBuilder
    private var rootView: some View {
        switch entry {
        case .welcome:
            WelcomeView(
                onGetStarted: { path.append(.emailEntry) },
                onSignIn:     { path.append(.signIn) }
            )
        case .kycIntro:
            destination(for: .kycIntro)
        }
    }

    // MARK: - Destinations

    @ViewBuilder
    private func destination(for route: OnboardingRoute) -> some View {
        switch route {
        case .welcome:
            // Defensive: pushing welcome onto the stack is a no-op shape;
            // we never expect to land here, but render the same view.
            WelcomeView(
                onGetStarted: { path.append(.emailEntry) },
                onSignIn:     { path.append(.signIn) }
            )

        case .signIn:
            SignInView(vm: SignInViewModel(
                api: apiClient,
                onSignedIn: { result in
                    // P0 fix (Phase 1 review): when requires2FA is true the backend has
                    // NOT issued a session cookie — it issued a pendingTwoFactorCookie
                    // and is waiting for /auth/verify-2fa. If we set currentUser here,
                    // RootCoordinator routes the user into the authenticated graph but
                    // every protected request returns 401 — the user gets trapped on
                    // KYC intro with no recovery path. Surface a clear message and
                    // leave the session unset until U73-U75 (Phase 11) lands the
                    // 2FA challenge UI.
                    if result.requires2FA {
                        appState.pendingTwoFactor = PendingTwoFactor(
                            method: result.twoFactorMethod ?? "TOTP",
                            blockedReason: "Two-factor sign-in arrives in a later release. Please use the web app for now."
                        )
                        return
                    }
                    appState.currentUser = result.user
                },
                onVerificationRequired: { email in
                    path.append(OnboardingTransition.fromSignInVerificationRequired(email: email))
                }
            ))

        case .emailEntry:
            EmailEntryView(vm: EmailEntryViewModel(
                api: apiClient,
                onCodeSent: { email in
                    path.append(OnboardingTransition.fromEmailEntry(codeSentTo: email))
                }
            ))

        case .emailOTP(let email):
            EmailOTPView(vm: EmailOTPViewModel(
                email: email,
                api: apiClient,
                onVerified: {
                    path.append(OnboardingTransition.fromEmailOTP(verifiedEmail: email))
                }
            ))

        case .registrationDetails(let email):
            RegistrationDetailsView(vm: RegistrationDetailsViewModel(
                email: email,
                api: apiClient,
                onRegistered: { user in
                    appState.currentUser = user
                    appState.kycStatus = .pending
                    path.append(OnboardingTransition.fromRegistrationDetails())
                }
            ))

        case .kycIntro:
            KYCIntroView(vm: KYCIntroViewModel(
                api: apiClient,
                onAccessToken: { session in
                    path.append(OnboardingTransition.fromKYCIntro(sessionFetched: session))
                }
            ))

        case .kycPreWarm(let session):
            SumsubPreWarmView(onPrepared: {
                path.append(OnboardingTransition.fromKYCPreWarm(session: session))
            })

        case .kycSumsub(let session):
            SumsubPresenter(session: session) { result in
                // Phase 2 review fix (P0, correctness CR-2): do NOT mutate
                // `appState.kycStatus` here. RootCoordinator routes on that
                // value at every render; flipping it mid-flow unmounts the
                // OnboardingCoordinator subtree before `path.append` plays
                // out. Status flips happen only at terminal resolution
                // (KYCProcessingView's onTerminal handler) where the
                // RootCoordinator hand-off is the desired effect.
                let next = OnboardingTransition.fromSumsubResult(
                    result, currentStatus: appState.kycStatus
                )
                path.append(next)
            }

        case .kycProcessing:
            KYCProcessingView(
                vm: KYCProcessingViewModel(api: apiClient),
                onTerminal: { [appState] terminal in
                    switch terminal {
                    case .verified:
                        // RootCoordinator routes .verified → MainTab. Setting
                        // kycStatus tears down the OnboardingCoordinator —
                        // intentional, this IS the hand-off.
                        appState.kycStatus = .verified
                    case .rejected:
                        // Stay inside OnboardingCoordinator's stack; push the
                        // soft-rejection retry screen. AppState stays at its
                        // pre-poll value so RootCoordinator doesn't re-route.
                        path.append(.kycSoftRejection)
                    case .timedOut:
                        // Cap reached or transient unauthorized — show the
                        // generic under-review wait screen.
                        path.append(.kycUnderReview)
                    case .unauthorized:
                        // Phase 2 review fix (P1, correctness CR-6): force
                        // re-auth instead of trapping the user behind a
                        // wait-state screen.
                        appState.clearForLogout()
                    }
                }
            )

        case .kycSoftRejection:
            KYCSoftRejectionView(
                vm: KYCSoftRejectionViewModel(
                    api: apiClient,
                    onRetryReady: { session in
                        path.append(OnboardingTransition.fromKYCIntro(sessionFetched: session))
                    }
                ),
                onContactSupport: {
                    // Phase 11.5 / U76e wires the deep-link to web help.
                    // Until then this is a no-op.
                }
            )

        case .kycUnderReview:
            KYCUnderReviewView(
                onNotifyMe: { [pushPermissionService] in
                    Task { _ = await pushPermissionService.promptIfNeeded() }
                },
                onTalkToSupport: {
                    // See onContactSupport above.
                }
            )
        }
    }
}
