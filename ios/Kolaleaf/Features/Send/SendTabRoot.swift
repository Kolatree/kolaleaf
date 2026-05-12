// SendTabRoot.swift  (Phase 4 · U35 + Phase 6 · U41-U49)
// Root view for the Send tab. Inspects the recipient list and renders
// either the empty-state CTA (Phase 4) or the populated Send screen
// (Phase 6 · U46).
//
// Routing forward to PayIDInstructions (U48) and the processing
// timeline (U49) happens via the per-tab NavigationStack `path`.
// The transfer object captured at create time rides the destination
// payload so child screens get the correct transferId / status.

import SwiftUI

public struct SendTabRoot: View {
    @Environment(\.apiClient) private var apiClient
    @Environment(AppState.self) private var appState
    @State private var recipients: [Recipient] = []
    @State private var isLoading: Bool = true
    @State private var path: [SendDestination] = []

    public init() {}

    public var body: some View {
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
                                path.removeLast()
                            }
                        )
                    case .payIdInstructions(let transferId, let initialStatus):
                        PayIDInstructionsView(
                            api: apiClient,
                            transferId: transferId,
                            onContinue: {
                                path.append(.processingTimeline(transferId, initialStatus))
                            }
                        )
                    case .processingTimeline(let transferId, let initialStatus):
                        ProcessingTimelineView(
                            api: apiClient,
                            transferId: transferId,
                            initialStatus: initialStatus,
                            appState: appState
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
            SendView(
                recipients: recipients,
                initialRecipient: recipients.first,
                api: apiClient,
                onAddRecipient: { path.append(.addRecipient) },
                onCreated: { transfer in
                    path.append(.payIdInstructions(transfer.id, transfer.status))
                },
                onSessionExpired: {
                    // Phase 5's session-expired flow already lives in
                    // RootCoordinator; mirroring it here is a one-line
                    // bridge: clear the transfer stack so the next
                    // post-login enter re-loads recipients.
                    path.removeAll()
                }
            )
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
// W9 / CA-005 (iter-2): destinations carry just the id + initial
// status so navigation values don't fan out the entire wire DTO into
// the SwiftUI path. Both screens own their own polling/refresh.
enum SendDestination: Hashable {
    case addRecipient
    case payIdInstructions(String, TransferStatus)
    case processingTimeline(String, TransferStatus)
}
