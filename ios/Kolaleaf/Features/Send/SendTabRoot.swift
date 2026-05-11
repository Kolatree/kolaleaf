// SendTabRoot.swift  (Phase 4 · U35)
// Root view for the Send tab. Inspects the recipient list and renders
// either the empty-state CTA (Phase 4) or the populated send-amount
// surface (Phase 6 · U41 · not built yet).
//
// On first appear we hit `GET /api/v1/recipients`. The list is held
// locally so navigating away and back doesn't refetch unnecessarily;
// the AddRecipient flow tells us when to refresh via the `onCreated`
// callback (push-down rather than pull-down — fewer races).
//
// Navigation uses a `path: [SendDestination]` array so EmptySendView's
// CTA can call `path.append(.addRecipient)` without coupling the
// destination view to the routing decision. Same pattern as
// `OnboardingCoordinator`.

import SwiftUI

public struct SendTabRoot: View {
    @Environment(\.apiClient) private var apiClient
    @State private var recipients: [Recipient] = []
    @State private var isLoading: Bool = true
    @State private var path: [SendDestination] = []

    public init() {}

    public var body: some View {
        // The NavigationStack lives here (not in MainTabView) because
        // SendTabRoot owns the destination state (`path`). Each tab
        // root in MainTabView owns its own stack so push history is
        // preserved across tab switches.
        NavigationStack(path: $path) {
            rootContent
                .navigationDestination(for: SendDestination.self) { destination in
                    switch destination {
                    case .addRecipient:
                        AddRecipientView(
                            vm: AddRecipientViewModel(api: apiClient),
                            onCreated: { newRecipient in
                                // Optimistic prepend — backend ordering
                                // is createdAt desc.
                                recipients.insert(newRecipient, at: 0)
                                path.removeAll()
                            }
                        )
                    }
                }
        }
        .task { await loadRecipientsIfNeeded() }
    }

    @ViewBuilder
    private var rootContent: some View {
        if isLoading {
            loadingState
        } else if recipients.isEmpty {
            EmptySendView(
                onAddRecipient: { path.append(.addRecipient) }
            )
        } else {
            populatedPlaceholder
        }
    }

    // MARK: - States

    private var loadingState: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .tint(KolaColors.trustGreen)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KolaColors.surface)
    }

    private var populatedPlaceholder: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Send")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
            Text("\(recipients.count) recipient(s) loaded")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
            Text("Phase 6 / U41 fills this in.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KolaColors.surface)
    }

    // MARK: - Loaders

    private func loadRecipientsIfNeeded() async {
        // .task fires on every appear; only hit the network once per
        // tab activation (recipients reset to [] when isLoading goes
        // back to true, which we don't do today — first-load only).
        guard isLoading else { return }
        let result = await apiClient.send(RecipientsEndpoints.List())
        switch result {
        case .success(let response):
            recipients = response.recipients
        case .failure:
            // First-load failure: leave list empty. The empty-state
            // CTA is still useful — the user can add a recipient now
            // and we'll re-fetch on next focus. A polish pass in
            // Phase 6 will surface a retry banner.
            recipients = []
        }
        isLoading = false
    }
}

// SendTabRoot lives inside the per-tab NavigationStack owned by
// MainTabView; this destination value is the discriminator the stack
// uses to push child screens.
enum SendDestination: Hashable {
    case addRecipient
}
