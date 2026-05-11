// MainTabView.swift  (Phase 4 · U33)
// Top-level destination after the user has cleared KYC and PostKYC.
// Owns nothing more than:
//   • the tab selection (read/write through `AppState.selectedTab`)
//   • a per-tab `NavigationStack` so push/pop history is independent
//     per tab — switching tabs preserves where the user was inside
//     each one. This is iOS' native expectation; using a single shared
//     stack would lose the current tab's path on every switch.
//
// Phase 4 ships only the Send tab in finished form (Empty + Add
// Recipient flow). Activity / Recipients / Account each render a
// placeholder; Phases 6–8 fill them in.
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
    /// inside Send. SendTabRoot wraps itself in NavigationStack
    /// because it owns the path state for the AddRecipient push;
    /// placeholders use a wrapping stack because they have no path
    /// state to own.
    @ViewBuilder
    private func content(for tab: RootTab) -> some View {
        switch tab {
        case .send:
            SendTabRoot()
        case .activity:
            NavigationStack { TabPlaceholderView(title: "Activity") }
        case .recipients:
            NavigationStack { TabPlaceholderView(title: "Recipients") }
        case .account:
            NavigationStack { TabPlaceholderView(title: "Account") }
        }
    }
}

/// Placeholder for the not-yet-built tabs. Mirrors the visual weight
/// of the destination screens so layout doesn't visibly snap when
/// Phases 6–8 ship.
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
