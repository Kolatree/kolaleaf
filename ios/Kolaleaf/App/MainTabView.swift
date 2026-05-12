// MainTabView.swift  (Phase 4 · U33 → Phase 8 · U55–U60)
// Top-level destination after the user has cleared KYC and PostKYC.
// Owns nothing more than:
//   • the tab selection (read/write through `AppState.selectedTab`)
//   • a per-tab `NavigationStack` so push/pop history is independent
//     per tab — switching tabs preserves where the user was inside
//     each one. This is iOS' native expectation; using a single shared
//     stack would lose the current tab's path on every switch.
//
// Phase 8 lights up the Activity / Recipients / Account tabs with
// real screens (U55–U60). The Send tab continues to own its own
// NavigationStack inside SendTabRoot (touched only by Phase 4 + 7).
//
// Why not `TabView`? The Vectors design system specifies a custom
// frosted-glass bottom bar (`BottomTabBar`) with a particular
// active-state colour and animation. SwiftUI's `TabView` doesn't
// expose enough of the chrome to match without forcing the entire
// app into UIKit's UITabBarController. A hand-rolled bar over a
// per-tab NavigationStack is both simpler and lets us hit the
// design tokens exactly.

import SwiftUI

public struct MainTabView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.apiClient) private var apiClient

    // Per-tab navigation paths. We hold them at MainTabView level so a
    // tab switch doesn't reset the destination stack of any tab —
    // matches native iOS UITabBarController behaviour. SendTabRoot
    // owns its own path internally; we only thread the other three.
    @State private var activityPath: [ActivityDestination] = []
    @State private var recipientsPath: [RecipientsDestination] = []
    @State private var accountPath: [AccountDestination] = []
    @State private var helpPath: [HelpDestination] = []

    public init() {}

    public var body: some View {
        @Bindable var appState = appState
        VStack(spacing: 0) {
            content(for: appState.selectedTab)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            BottomTabBar(selection: $appState.selectedTab)
        }
        .background(KolaColors.surface.ignoresSafeArea())
    }

    /// Each tab root owns its OWN NavigationStack so push history is
    /// preserved independently. Switching from Send → Recipients →
    /// Send returns the user to whatever screen they had pushed
    /// inside Send. SendTabRoot wraps itself in NavigationStack;
    /// the other three NavigationStacks are owned here so we can
    /// route in/out of TransactionDetail / MyPayID / Refer / Help /
    /// Statements from any tab without spinning a new stack per
    /// switch.
    @ViewBuilder
    private func content(for tab: RootTab) -> some View {
        switch tab {
        case .send:
            SendTabRoot()
        case .activity:
            NavigationStack(path: $activityPath) {
                ActivityTabView()
                    .navigationDestination(for: ActivityDestination.self) { destination in
                        switch destination {
                        case .detail(let transferId):
                            TransactionDetailView(api: apiClient, transferId: transferId)
                        }
                    }
            }
        case .recipients:
            NavigationStack(path: $recipientsPath) {
                RecipientsTabView(path: $recipientsPath)
                    .navigationDestination(for: RecipientsDestination.self) { destination in
                        switch destination {
                        case .addRecipient:
                            AddRecipientView(
                                vm: AddRecipientViewModel(api: apiClient),
                                onCreated: { _ in
                                    if !recipientsPath.isEmpty {
                                        recipientsPath.removeLast()
                                    }
                                }
                            )
                        case .send:
                            // Hopping to the Send tab pre-filled is a
                            // Phase 8 placeholder (the SendView pre-fill
                            // hook lands when SendCoordinator grows a
                            // public seed path in iteration 2). For
                            // v1 we route the user back to the Send tab
                            // root; the existing flow honours the most
                            // recently used recipient.
                            sendTabRedirect
                        }
                    }
            }
        case .account:
            NavigationStack(path: $accountPath) {
                AccountView(path: $accountPath)
                    .navigationDestination(for: AccountDestination.self) { destination in
                        switch destination {
                        case .myPayID:
                            MyPayIDView(api: apiClient)
                        case .security:
                            TabPlaceholderView(title: "Security & 2FA")
                        case .refer:
                            ReferView()
                        case .help:
                            HelpView(path: $helpPath)
                                .navigationDestination(for: HelpDestination.self) { destination in
                                    switch destination {
                                    case .transactionDetail(let id):
                                        TransactionDetailView(
                                            api: apiClient, transferId: id
                                        )
                                    }
                                }
                        case .statements:
                            StatementsView()
                        }
                    }
            }
        }
    }

    /// Stub view that nudges the user back to the Send tab. When the
    /// SendCoordinator grows a `seed(with:)` entry point, this turns
    /// into a real pre-filled push.
    private var sendTabRedirect: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Tap Send to start a new transfer")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KolaColors.surface)
    }
}

/// Placeholder retained for the still-unfinished Security & 2FA tab
/// (Phase 11 / U73–U75 lands the real screen). Activity / Recipients /
/// Account no longer fall through to this — they're wired in Phase 8.
struct TabPlaceholderView: View {
    let title: String

    var body: some View {
        VStack(spacing: KolaSpacing.m) {
            Text(title)
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Coming soon")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KolaColors.surface)
    }
}
