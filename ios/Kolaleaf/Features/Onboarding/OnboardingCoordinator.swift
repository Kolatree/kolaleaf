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
}

@MainActor
public struct OnboardingCoordinator: View {

    public enum Entry { case welcome, kycIntro }

    @Environment(AppState.self) private var appState
    @Environment(\.apiClient) private var apiClient
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
                    appState.kycStatus = .notStarted
                    path.append(OnboardingTransition.fromRegistrationDetails())
                }
            ))

        case .kycIntro:
            KYCIntroView(vm: KYCIntroViewModel(
                api: apiClient,
                onAccessToken: { _ in
                    // Phase 2 (U24a/b) replaces this with the Sumsub hand-off.
                    // For now: KYC route stays on KYCIntro until the SDK lands.
                }
            ))
        }
    }
}
