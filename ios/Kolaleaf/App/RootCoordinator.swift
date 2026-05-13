// RootCoordinator.swift  (Phase 1 · U15 · extended in Phase 4 · U33)
// Top-level router that picks one of five destinations based on AppState.
//
// Routing matrix (Phase 4):
//
//   hasActiveSession  | kycStatusLoaded | kycStatus  | postKYCComplete | destination
//   ------------------+-----------------+------------+-----------------+----------------------------
//   false             | (any)           | (any)      | (any)           | OnboardingCoordinator (Welcome)
//   true              | false           | (any)      | (any)           | .loading shell           [ADV-008/CA-006]
//   true              | true            | .verified  | false           | PostKYCCoordinator
//   true              | true            | .verified  | true            | MainTabView
//   true              | true            | .inReview  | (any)           | KYCUnderReviewPlaceholder
//   true              | true            | other      | (any)           | OnboardingCoordinator (resume at KYC intro)
//
// `RootRoute` is pulled out as a pure value so it's unit-testable
// without constructing a SwiftUI view graph (see RootCoordinatorTests).
//
// Phase 4 / U33 wire-up: PostKYCCoordinator's `onPostKYCComplete`
// callback flips `appState.hasCompletedPostKYC = true`, which
// re-renders RootCoordinator and routes to MainTabView. The
// completion flag is persisted (see AppState.swift) so a cold launch
// after PostKYC saved doesn't loop the user back through Confirm
// Profile.
//
// ADV-007: on session establishment we kick off
// `appState.refreshPostKYCStateFromServer(api:)` so the cached
// PostKYC flag (UserDefaults — iCloud-backed) gets reconciled with
// the server row. Defends against cross-user state leak via iCloud
// Restore.

import SwiftUI

/// Pure routing decision. Side-effect free — tests assert against this enum.
public enum RootRoute: Equatable, Sendable {
    case onboardingWelcome
    case onboardingResumeAtKYC
    case kycUnderReview
    /// Phase 4: rendered when the user has cleared KYC but hasn't
    /// finished Confirm Profile + Confirm Address yet.
    case postKYC
    case mainTab
    /// ADV-008 / CA-006: rendered while the app is reconciling the
    /// session's `kycStatus` against the server. Prevents the
    /// `.unknown` initial value from flickering through
    /// `.onboardingResumeAtKYC` for a verified user on cold launch.
    case loading
    /// Bootstrap call (`/account/me`) exhausted retries after sign-in.
    /// Wins over `.loading` so the user sees a recoverable error UI
    /// with Retry + Sign-out actions rather than a forever-spinning
    /// shell.
    case bootstrapError(message: String)
}

public enum RootRouter {
    public static func route(
        hasActiveSession: Bool,
        kycStatusLoaded: Bool,
        kycStatus: KycStatus,
        hasCompletedPostKYC: Bool,
        bootstrapError: String? = nil
    ) -> RootRoute {
        guard hasActiveSession else { return .onboardingWelcome }
        // Bootstrap-error wins over loading: a `/account/me` failure
        // chain leaves `kycStatusLoaded == false` and would otherwise
        // strand the user on the spinner. Surface a recoverable UI
        // instead.
        if let message = bootstrapError { return .bootstrapError(message: message) }
        // ADV-008 / CA-006: gate authenticated routing on a known
        // server-derived kycStatus. Without this, the `.unknown`
        // initial value collapses with `.pending`/`.rejected` into
        // `.onboardingResumeAtKYC` and a verified user sees a
        // one-frame KYC-intro flicker on cold launch.
        guard kycStatusLoaded else { return .loading }
        switch kycStatus {
        case .verified:
            return hasCompletedPostKYC ? .mainTab : .postKYC
        case .inReview:
            return .kycUnderReview
        case .pending, .rejected, .unknown:
            return .onboardingResumeAtKYC
        }
    }
}

public struct RootCoordinator: View {
    @Environment(AppState.self) private var appState
    @Environment(\.apiClient) private var apiClient

    public init() {}

    public var body: some View {
        let route = RootRouter.route(
            hasActiveSession: appState.hasActiveSession,
            kycStatusLoaded: appState.kycStatusLoaded,
            kycStatus: appState.kycStatus,
            hasCompletedPostKYC: appState.hasCompletedPostKYC,
            bootstrapError: appState.bootstrapError
        )
        Group {
            switch route {
            case .onboardingWelcome:
                OnboardingCoordinator(startAt: .welcome)
            case .onboardingResumeAtKYC:
                OnboardingCoordinator(startAt: .kycIntro)
            case .kycUnderReview:
                KYCUnderReviewPlaceholder()
            case .postKYC:
                // Phase 4 / U33: PostKYCCoordinator's terminal handler
                // sets `hasCompletedPostKYC = true`, which re-renders
                // this body and routes us to MainTabView.
                // OO-006: bind the closure to the AppState method
                // rather than to the persisted-flag setter directly.
                PostKYCCoordinator(onPostKYCComplete: appState.handlePostKYCComplete)
            case .mainTab:
                MainTabView()
            case .loading:
                LoadingShell()
            case .bootstrapError(let message):
                BootstrapErrorView(
                    message: message,
                    onRetry: {
                        appState.clearBootstrapError()
                        Task { await appState.refreshPostKYCStateFromServer(api: apiClient) }
                    },
                    onSignOut: { appState.clearForLogout() }
                )
            }
        }
        // ADV-007: refresh the PostKYC + kycStatus from the server
        // on every session-identity change. Keyed on `currentUser?.id`
        // so a logout/login (or restore-from-iCloud cold launch with a
        // stale flag) immediately reconciles against the server row.
        .task(id: appState.currentUser?.id) {
            guard appState.hasActiveSession else { return }
            await appState.refreshPostKYCStateFromServer(api: apiClient)
        }
    }
}

// MARK: - Placeholder destinations (replaced by real screens in later phases)

/// Shown when KYC is in human review. Phase 2 (U24c+) will replace with the
/// real "we're checking your documents" screen.
struct KYCUnderReviewPlaceholder: View {
    var body: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Verifying your identity")
                .font(KolaFont.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
            Text("We'll let you know within 24 hours.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .multilineTextAlignment(.center)
        }
        .padding(KolaSpacing.l)
        .kolaWallpaper()
    }
}

/// ADV-008 / CA-006: quiet shell rendered while the session's
/// `kycStatus` is still being resolved against the server. Sits on
/// the same Card.background surface used by post-auth screens so the
/// transition into PostKYC / MainTab doesn't flash a different
/// background.
struct LoadingShell: View {
    var body: some View {
        ZStack {
            KolaColors.Card.background.ignoresSafeArea()
            ProgressView().tint(KolaColors.trustGreen)
        }
    }
}

/// Shown when the post-login bootstrap call (`/account/me`) exhausts
/// retries. The user gets to either retry the same call or sign out
/// and try again clean. Without this, a single network blip during
/// sign-in stranded the user on `LoadingShell` forever (the
/// `.task(id:)` only re-fires on identity change).
struct BootstrapErrorView: View {
    let message: String
    let onRetry: () -> Void
    let onSignOut: () -> Void

    var body: some View {
        ZStack {
            KolaColors.Card.background.ignoresSafeArea()
            VStack(spacing: KolaSpacing.l) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 44, weight: .regular))
                    .foregroundStyle(KolaColors.muted)
                Text("Couldn't finish signing in")
                    .font(KolaFont.headline)
                    .foregroundStyle(KolaColors.ink)
                Text(message)
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, KolaSpacing.l)
                VStack(spacing: KolaSpacing.s) {
                    Button("Try again", action: onRetry)
                        .font(KolaFont.row)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(KolaColors.primary)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    Button("Sign out", action: onSignOut)
                        .font(KolaFont.row)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .foregroundStyle(KolaColors.muted)
                }
                .padding(.horizontal, KolaSpacing.l)
            }
            .padding(KolaSpacing.l)
        }
    }
}
