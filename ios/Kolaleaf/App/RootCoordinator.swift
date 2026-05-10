// RootCoordinator.swift  (Phase 1 · U15)
// Top-level router that picks one of four destinations based on AppState.
//
// Routing matrix:
//
//   hasActiveSession  | kycStatus       | destination
//   ------------------+-----------------+----------------------------------
//   false             | (any)           | OnboardingCoordinator (Welcome)
//   true              | .approved       | MainTabView (placeholder, Phase 8)
//   true              | .underReview    | KYCUnderReviewPlaceholder
//   true              | other / unknown | OnboardingCoordinator (resume at KYC intro)
//
// The full MainTabView lands in Phase 8 (U33). For now the post-auth /
// approved-kyc branch shows a placeholder so the app launches cleanly.
// `RootRoute` is pulled out as a pure value so it's unit-testable without
// constructing a SwiftUI view graph (see RootCoordinatorTests).

import SwiftUI

/// Pure routing decision. Side-effect free — tests assert against this enum.
public enum RootRoute: Equatable, Sendable {
    case onboardingWelcome
    case onboardingResumeAtKYC
    case kycUnderReview
    case mainTab
}

public enum RootRouter {
    public static func route(hasActiveSession: Bool, kycStatus: KycStatus) -> RootRoute {
        guard hasActiveSession else { return .onboardingWelcome }
        switch kycStatus {
        case .approved:    return .mainTab
        case .underReview: return .kycUnderReview
        default:           return .onboardingResumeAtKYC
        }
    }
}

public struct RootCoordinator: View {
    @Environment(AppState.self) private var appState

    public init() {}

    public var body: some View {
        let route = RootRouter.route(
            hasActiveSession: appState.hasActiveSession,
            kycStatus: appState.kycStatus
        )
        switch route {
        case .onboardingWelcome:
            OnboardingCoordinator(startAt: .welcome)
        case .onboardingResumeAtKYC:
            OnboardingCoordinator(startAt: .kycIntro)
        case .kycUnderReview:
            KYCUnderReviewPlaceholder()
        case .mainTab:
            MainTabPlaceholder()
        }
    }
}

// MARK: - Placeholder destinations (replaced by real screens in later phases)

/// Phase 8 (U33) replaces this with the real MainTabView.
struct MainTabPlaceholder: View {
    var body: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Kolaleaf")
                .font(KolaFont.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
            Text("Main app coming up")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
        }
        .kolaWallpaper()
    }
}

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
