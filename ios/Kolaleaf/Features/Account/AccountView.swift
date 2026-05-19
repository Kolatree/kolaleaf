// AccountView.swift  (Phase 8 · U60)
// Account-tab landing screen. Wires the navigation destinations
// declared by `AccountDestination` (My PayID, Security & 2FA, Refer,
// Help, Statements, Preferences). Sign-out is a destructive alert that calls into
// `AppState.clearForLogout()` then revokes server-side via
// `AuthEndpoints.Logout`.

import SwiftUI

public struct AccountView: View {

    @Environment(\.apiClient) private var apiClient
    @Environment(AppState.self) private var appState
    /// Phase 8 iter-2 (P2 + P4): logout must wipe the SwiftData mirror
    /// and the bank-list cache so the next sign-in (potentially a
    /// different user) doesn't see the previous session's data. The
    /// stack + store are injected at KolaleafApp.body.
    @Environment(\.swiftDataStack) private var swiftDataStack
    @Environment(\.bankStore) private var bankStore

    @State private var vm: AccountViewModel?
    @State private var confirmSignOut: Bool = false

    @Binding private var path: [AccountDestination]

    public init(path: Binding<[AccountDestination]>) {
        self._path = path
    }

    public var body: some View {
        VStack(spacing: 0) {
            switch vm?.state {
            case .none, .idle, .loading:
                loadingState
            case .loaded(let profile):
                loadedContent(profile: profile)
            case .sessionExpired:
                Text("Session expired")
                    .font(KolaFont.section)
            case .failed(let message):
                failedState(message: message)
            }
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.large)
        .alert("Sign out?",
               isPresented: $confirmSignOut) {
            Button("Cancel", role: .cancel) {}
            Button("Sign out", role: .destructive) {
                Task { await performSignOut() }
            }
        } message: {
            Text("You'll need to sign in again to send money.")
        }
        .task {
            if vm == nil { vm = AccountViewModel(api: apiClient) }
            await vm?.load()
        }
    }

    private func loadedContent(profile: AccountViewModel.Profile) -> some View {
        ScrollView {
            VStack(spacing: KolaSpacing.card) {
                profileHeader(profile: profile)
                kycBadge(status: profile.kycStatus)
                menuList
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.vertical, KolaSpacing.xxl)
        }
    }

    private func profileHeader(profile: AccountViewModel.Profile) -> some View {
        VStack(spacing: KolaSpacing.s) {
            Circle()
                .fill(KolaColors.trustGreen.opacity(0.12))
                .frame(width: 64, height: 64)
                .overlay(
                    Text(profile.initials)
                        .font(KolaFont.section)
                        .foregroundStyle(KolaColors.trustGreen)
                )
            Text(profile.displayName)
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            if let email = profile.email {
                Text(email)
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.textSecondary)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func kycBadge(status: KycStatus) -> some View {
        let label = AccountViewModel.kycLabel(status)
        let (bg, fg) = badgeColors(for: status)
        return HStack(spacing: KolaSpacing.xs) {
            Image(systemName: badgeIcon(for: status))
            Text(label)
                .font(KolaFont.chip)
        }
        .padding(.horizontal, KolaSpacing.m)
        .padding(.vertical, KolaSpacing.xs)
        .background(bg)
        .foregroundStyle(fg)
        .clipShape(Capsule())
    }

    private func badgeColors(for status: KycStatus) -> (Color, Color) {
        switch status {
        case .verified: return (KolaColors.leafGreen.opacity(0.18), KolaColors.leafGreen)
        case .pending, .inReview: return (KolaColors.warning.opacity(0.18), KolaColors.warning)
        case .rejected: return (KolaColors.coral.opacity(0.18), KolaColors.coral)
        case .unknown: return (KolaColors.surfaceSoft, KolaColors.textSecondary)
        }
    }

    private func badgeIcon(for status: KycStatus) -> String {
        switch status {
        case .verified: return "checkmark.seal.fill"
        case .pending, .inReview: return "clock.fill"
        case .rejected: return "exclamationmark.triangle.fill"
        case .unknown: return "questionmark.circle.fill"
        }
    }

    private var menuList: some View {
        VStack(spacing: KolaSpacing.s) {
            menuRow("My PayID", systemImage: "creditcard.fill") {
                path.append(.myPayID)
            }
            menuRow("Security & 2FA", systemImage: "lock.shield.fill") {
                path.append(.security)
            }
            menuRow("Refer a friend", systemImage: "gift.fill") {
                path.append(.refer)
            }
            menuRow("Help", systemImage: "questionmark.bubble.fill") {
                path.append(.help)
            }
            menuRow("Statements & tax", systemImage: "doc.text.fill") {
                path.append(.statements)
            }
            menuRow("Preferences", systemImage: "slider.horizontal.3") {
                path.append(.preferences)
            }
            menuRow("Sign out", systemImage: "rectangle.portrait.and.arrow.right",
                    destructive: true) {
                confirmSignOut = true
            }
        }
    }

    private func menuRow(
        _ title: String,
        systemImage: String,
        destructive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: KolaSpacing.m) {
                Image(systemName: systemImage)
                    .frame(width: 24)
                    .foregroundStyle(
                        destructive ? KolaColors.coral : KolaColors.trustGreen
                    )
                Text(title)
                    .font(KolaFont.rowTotal)
                    .foregroundStyle(
                        destructive ? KolaColors.coral : KolaColors.textPrimary
                    )
                Spacer()
                if !destructive {
                    Image(systemName: "chevron.right")
                        .foregroundStyle(KolaColors.textSecondary)
                }
            }
            .padding(KolaSpacing.l)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.card)
                    .fill(KolaColors.Card.background)
            )
        }
        .buttonStyle(.plain)
    }

    private var loadingState: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .tint(KolaColors.trustGreen)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func failedState(message: String) -> some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Couldn't load your account")
                .font(KolaFont.section)
            Text(message)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, KolaSpacing.xl)
            Button("Try again") { Task { await vm?.load() } }
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Sign out

    private func performSignOut() async {
        // Mirrors `KolaleafApp.forceReauth()` — clear local state
        // first so a stale cookie can never be replayed even if the
        // network revoke fails. The full sequence (keychain + cookies
        // + analytics) lives at the app-root level; here we trigger
        // the AppState transition and best-effort revoke.
        appState.clearForLogout()
        // Phase 8 iter-2 (P2 + P4): wipe per-user caches alongside
        // the AppState reset so the next sign-in (potentially a
        // different user) starts from a cold store.
        try? swiftDataStack.deleteAll()
        bankStore.reset()
        _ = await apiClient.send(AuthEndpoints.Logout())
    }
}

public enum AccountDestination: Hashable {
    case myPayID
    case security
    case refer
    case help
    case statements
    case preferences
}
