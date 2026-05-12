// SendTabRoot.swift  (Phase 4 · U35 + Phase 6 · U41-U49 + Phase 7 iter-2 C1)
// Root view for the Send tab. Inspects the recipient list and renders
// either the empty-state CTA (Phase 4) or the populated Send screen
// (Phase 6 · U46).
//
// Routing forward to PayIDInstructions (U48), the processing
// timeline (U49), and the receipt (U50) happens via the per-tab
// NavigationStack `path`. The transfer object captured at create
// time rides the destination payload so child screens get the
// correct transferId / status.
//
// Phase 7 iter-2 C1 / ADV-P7-C1 wiring:
//   • Adds `.receipt(transferId, recipientId)` destination.
//   • ProcessingTimelineView receives an `onTerminal` callback that
//     looks up the live recipient + transfer, asks the SendCoordinator
//     to route, and pushes the corresponding destination.
//   • Sad-path terminal statuses pop back to root (Send) for now —
//     the placeholder sad-path screens land in a later phase.

import SwiftUI

public struct SendTabRoot: View {
    @Environment(\.apiClient) private var apiClient
    @Environment(AppState.self) private var appState
    @State private var recipients: [Recipient] = []
    @State private var isLoading: Bool = true
    @State private var path: [SendDestination] = []
    /// C1: SendCoordinator state is the source of truth for terminal
    /// routing. The View mirrors it to the navigation `path`.
    @State private var coordinator = SendCoordinatorState()

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
                            appState: appState,
                            onTerminal: { id, status in
                                handleTerminal(transferId: id, status: status)
                            }
                        )
                    case .receipt(let transferId, let recipientId):
                        receiptDestination(
                            transferId: transferId,
                            recipientId: recipientId
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
                    coordinator.advanceFromSending(transfer: transfer)
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

    // MARK: - Receipt destination

    @ViewBuilder
    private func receiptDestination(
        transferId: String,
        recipientId: String
    ) -> some View {
        // Look up the recipient. The recipients list is the source of
        // truth (it was loaded at tab-enter); a missing id means the
        // recipient was deleted mid-flow, in which case we fall back
        // to a minimal placeholder so the share/summary still renders.
        let recipient = recipients.first(where: { $0.id == recipientId })
            ?? Recipient(
                id: recipientId,
                fullName: "Recipient",
                bankName: "",
                bankCode: "",
                accountNumber: ""
            )
        // The transfer payload lives on AppState.activeTransfer (mirrored
        // by ProcessingTimelineViewModel each poll). Compose a Domain
        // Transfer from the mirror so the receipt has the latest
        // amount/status without re-fetching.
        if let active = appState.activeTransfer,
           active.id == transferId {
            let transfer = Transfer(
                id: active.id,
                userId: "",
                recipientId: active.recipientId,
                corridorId: "",
                status: active.status,
                sendAmount: active.audAmount,
                receiveAmount: active.ngnAmount == 0 ? nil : active.ngnAmount,
                exchangeRate: 0,
                fee: 0
            )
            ReceiptView(vm: ReceiptViewModel(
                transfer: transfer,
                recipient: recipient,
                onSendAnother: { _ in
                    coordinator.sendAnother()
                    path.removeAll()
                }
            ))
        } else {
            // Defensive: appState was cleared between the terminal
            // status and the destination push. Pop back to root.
            Color.clear.onAppear { path.removeAll() }
        }
    }

    // MARK: - Terminal status routing (C1)

    private func handleTerminal(transferId: String, status: TransferStatus) {
        // Find the recipient associated with the active transfer so
        // we can hand it to the SendCoordinator's happy-path branch.
        let recipientId = appState.activeTransfer?.recipientId
        let recipient = recipientId.flatMap { id in
            recipients.first(where: { $0.id == id })
        }
        // Compose a minimal Domain Transfer for the coordinator. Status
        // is the only field that drives routing; amounts/rates flow
        // through ReceiptView via AppState.activeTransfer.
        let transfer = Transfer(
            id: transferId,
            userId: "",
            recipientId: recipientId ?? "",
            corridorId: "",
            status: status,
            sendAmount: appState.activeTransfer?.audAmount ?? 0,
            receiveAmount: appState.activeTransfer?.ngnAmount,
            exchangeRate: 0,
            fee: 0
        )
        if let recipient,
           status == .completed || status == .ngnSent {
            coordinator.advanceFromProcessingHappy(transfer: transfer, recipient: recipient)
            path.append(.receipt(transferId: transferId, recipientId: recipient.id))
        } else {
            coordinator.advanceFromProcessingSadPath(transfer: transfer)
            // Sad-path placeholder screens land in Phase 8 (per the
            // plan's U62/U63/U64). For Phase 7 we pop to root so the
            // user isn't stranded on the processing screen.
            path.removeAll()
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
    /// Phase 7 iter-2 C1 / ADV-P7-C1: terminal happy-path destination.
    /// Carries the transferId + recipientId so the receipt screen can
    /// look up both records from `recipients` + `AppState.activeTransfer`.
    case receipt(transferId: String, recipientId: String)
}
