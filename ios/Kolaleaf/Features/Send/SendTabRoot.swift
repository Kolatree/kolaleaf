// SendTabRoot.swift  (Phase 4 · U35 + Phase 6 · U41-U49 + Phase 7 iter-2 C1
//                      + Phase 9 · U62/U63/U64 + Phase 9 iter-2 A1-A5/B1/B7/B8/C5)
// Root view for the Send tab. Inspects the recipient list and renders
// either the empty-state CTA (Phase 4) or the populated Send screen
// (Phase 6 · U46).
//
// Phase 9 iter-2 changes:
//   • A1 / API-901: cancel branch dispatches on typed APIError; the
//     CancelTransferView ships a Domain `Transfer?` payload through
//     `onCancelled` (B8) so we mirror it into AppState directly.
//   • A2 / ADV-P9-C2: floatPaused → terminal failure (.ngnFailed /
//     .needsManual / .refunded) routes via `handleTerminal` which
//     bubbles a tab-switch up to MainTabView (no silent dead-end).
//   • A3 / CA-903: floatPausedDestination calls handleTerminal +
//     `path.removeLast()` instead of reimplementing routing inline.
//     The processing-timeline poller is the only thing that can race
//     a happy-path push; A3's collapse drops one frame at a time so
//     `path.removeAll()` in handleTerminal wipes any duplicate frame.
//   • A4 / CA-901: SendTabRoot does NOT mutate `appState.selectedTab`;
//     terminal cancel + sad-path land on Activity via the
//     `onTabSwitchRequested` callback wired by MainTabView.
//   • A5 / CA-902 + ADV-P9-W2: `deriveRate` is gone. The expired
//     destination reads `exchangeRate` from `ActiveTransfer`; if the
//     mirror is missing OR the rate is 0 it fetches the transfer
//     freshly via TransfersEndpoints.Get(id:).
//   • B1 / OO-901: `loadTerminalContext` factors the Transfer + Recipient
//     composition shared by handleTerminal / expiredDestination /
//     floatPausedDestination / receiptDestination.
//   • B7 / CA-904: re-quote prefill is a SendDestination case
//     (`.requoteSend(SendPrefill)`) — no ambient `pendingPrefill` state.
//   • B8 / ADV-P9-S3: cancel response transfer is threaded into
//     AppState; `stubTransfer` removed.

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

    /// CA-901: terminal-state routing that requires switching the
    /// active tab (cancel-success, sad-path landings) bubbles up
    /// through this callback. MainTabView wires it to
    /// `appState.selectedTab = .activity` — that's the only surface
    /// allowed to mutate inter-tab routing.
    private let onTabSwitchRequested: (RootTab) -> Void

    public init(onTabSwitchRequested: @escaping (RootTab) -> Void = { _ in }) {
        self.onTabSwitchRequested = onTabSwitchRequested
    }

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
                            },
                            // Phase 9 · U62: hatch into the cancel
                            // screen. Reachable while AWAITING_AUD —
                            // cancellation past that returns 409 and
                            // the cancel screen renders the .tooLate
                            // branch.
                            onCancelRequested: {
                                path.append(.cancelTransfer(transferId: transferId))
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
                    case .cancelTransfer(let transferId):
                        CancelTransferView(
                            api: apiClient,
                            transferId: transferId,
                            onCancelled: { cancelledTransfer in
                                // B8 / ADV-P9-S3: thread the real
                                // Domain Transfer into the coordinator
                                // + AppState mirror. nil → .gone (404)
                                // so we drop the mirror.
                                if let cancelledTransfer {
                                    coordinator.advanceFromProcessingSadPath(
                                        transfer: cancelledTransfer
                                    )
                                    appState.activeTransfer = ActiveTransfer(
                                        id: cancelledTransfer.id,
                                        status: cancelledTransfer.status,
                                        audAmount: cancelledTransfer.sendAmount,
                                        ngnAmount: cancelledTransfer.receiveAmount ?? 0,
                                        recipientId: cancelledTransfer.recipientId,
                                        exchangeRate: cancelledTransfer.exchangeRate
                                    )
                                } else {
                                    appState.activeTransfer = nil
                                }
                                path.removeAll()
                                // A4 / CA-901: bubble up to
                                // MainTabView; SendTabRoot doesn't
                                // own selectedTab.
                                onTabSwitchRequested(.activity)
                            },
                            onTrackTransfer: { _ in
                                // 409 cancel_too_late — pop back to
                                // the processing timeline so the user
                                // can track the AUD that just arrived.
                                if !path.isEmpty {
                                    path.removeLast()
                                }
                            },
                            onDismiss: {
                                if !path.isEmpty {
                                    path.removeLast()
                                }
                            }
                        )
                    case .expiredTransfer(let transferId):
                        expiredDestination(transferId: transferId)
                    case .floatPaused(let transferId):
                        floatPausedDestination(transferId: transferId)
                    case .requoteSend(let prefill):
                        // B7 / CA-904: prefill rides the destination
                        // payload, never ambient state. One push, one
                        // prefill — no chance of leaking to a later
                        // visit.
                        SendView(
                            recipients: recipients,
                            initialRecipient: recipients.first(
                                where: { $0.id == prefill.recipientId }
                            ) ?? recipients.first,
                            api: apiClient,
                            prefill: prefill,
                            onAddRecipient: { path.append(.addRecipient) },
                            onCreated: { transfer in
                                coordinator.advanceFromSending(transfer: transfer)
                                path.append(.payIdInstructions(transfer.id, transfer.status))
                            },
                            onSessionExpired: {
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
        if let context = loadTerminalContext(transferId: transferId, recipientId: recipientId) {
            ReceiptView(vm: ReceiptViewModel(
                transfer: context.transfer,
                recipient: context.recipient,
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

    // MARK: - Terminal status routing (C1 + Phase 9 + iter-2 A2/A3)

    private func handleTerminal(transferId: String, status: TransferStatus) {
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
            exchangeRate: appState.activeTransfer?.exchangeRate ?? 0,
            fee: 0
        )
        if let recipient,
           status == .completed || status == .ngnSent {
            coordinator.advanceFromProcessingHappy(transfer: transfer, recipient: recipient)
            // A3 / ADV-P9-W9: wipe the stack so a still-polling
            // ProcessingTimelineView frame can't push a SECOND receipt
            // when its own next poll sees the same terminal state.
            path.removeAll()
            path.append(.receipt(transferId: transferId, recipientId: recipient.id))
            return
        }
        coordinator.advanceFromProcessingSadPath(transfer: transfer)
        switch status {
        case .cancelled:
            // Coordinator-initiated cancel (e.g. backend timed out the
            // 24h AWAITING_AUD window into CANCELLED): land on Activity.
            path.removeAll()
            onTabSwitchRequested(.activity)
        case .expired:
            path.append(.expiredTransfer(transferId: transferId))
        case .floatInsufficient:
            path.append(.floatPaused(transferId: transferId))
        case .ngnFailed, .ngnRetry, .needsManual, .refunded:
            // A2 / ADV-P9-C2: terminal failure routes to Activity so
            // the user isn't stranded. The Activity tab surfaces the
            // detail screen — operational follow-up lives there.
            path.removeAll()
            onTabSwitchRequested(.activity)
        default:
            // Mid-flight statuses shouldn't reach here (timeline only
            // calls onTerminal for terminal states), but if they do,
            // pop to root rather than strand the user.
            path.removeAll()
        }
    }

    // MARK: - Phase 9 destinations

    @ViewBuilder
    private func expiredDestination(transferId: String) -> some View {
        // A5 / CA-902 + ADV-P9-W2: prefer the AppState mirror; fall
        // back to a fresh Get when missing OR when the locked rate
        // hasn't been mirrored yet (rate == 0). The fallback view
        // owns its own load + error UX.
        if let context = loadTerminalContext(
            transferId: transferId,
            recipientId: appState.activeTransfer?.recipientId
        ),
        context.transfer.exchangeRate > 0 {
            let expiredTransfer = Transfer(
                id: context.transfer.id,
                userId: context.transfer.userId,
                recipientId: context.transfer.recipientId,
                corridorId: context.transfer.corridorId,
                status: .expired,
                sendAmount: context.transfer.sendAmount,
                receiveAmount: context.transfer.receiveAmount,
                exchangeRate: context.transfer.exchangeRate,
                fee: context.transfer.fee
            )
            ExpiredTransferView(
                api: apiClient,
                expiredTransfer: expiredTransfer,
                recipient: context.recipient,
                onRequote: { prefill in
                    // B7: push a `.requoteSend(prefill)` destination
                    // so the prefill rides the navigation stack and
                    // is consumed exactly once.
                    if !path.isEmpty {
                        path.removeLast()
                    }
                    path.append(.requoteSend(prefill))
                },
                onDone: {
                    path.removeAll()
                }
            )
        } else {
            ExpiredTransferFetchView(
                api: apiClient,
                transferId: transferId,
                onLoaded: { transfer, recipient in
                    onRequoteFromExpired(transfer: transfer, recipient: recipient)
                },
                onDone: { path.removeAll() }
            )
        }
    }

    @ViewBuilder
    private func floatPausedDestination(transferId: String) -> some View {
        let active = appState.activeTransfer
        let recipientId = active?.recipientId ?? ""
        let recipient = recipients.first(where: { $0.id == recipientId })
        FloatPausedView(
            api: apiClient,
            transferId: transferId,
            recipientName: recipient?.fullName ?? "Recipient",
            audAmount: active?.audAmount ?? 0,
            onResume: { newStatus in
                // A3 / CA-903: route through handleTerminal so all
                // terminal routing decisions live in one place. Pop
                // our own frame first (so the navigation stack
                // doesn't grow indefinitely on a happy resume).
                if !path.isEmpty {
                    path.removeLast()
                }
                handleTerminal(transferId: transferId, status: newStatus)
            }
        )
    }

    /// Helper used by the expired-fetch fallback: routes a freshly-
    /// loaded transfer + recipient into the re-quote destination.
    private func onRequoteFromExpired(transfer: Transfer, recipient: Recipient) {
        let prefill = SendPrefill(
            recipientId: recipient.id,
            cents: SendPrefill.cents(forAud: transfer.sendAmount)
        )
        if !path.isEmpty {
            path.removeLast()
        }
        path.append(.requoteSend(prefill))
    }

    // MARK: - Terminal-context composition (B1 / OO-901)

    /// Bundle of the live Transfer + Recipient needed by the terminal
    /// destinations. Resolves the recipient from the recipients list
    /// (falling back to a placeholder when deleted mid-flow) and
    /// composes a Domain `Transfer` from the AppState mirror. Returns
    /// nil only when AppState's `activeTransfer` is missing OR the
    /// transferId doesn't match the mirror — callers fall back to a
    /// fetch-by-id flow.
    private struct TerminalContext {
        let transfer: Transfer
        let recipient: Recipient
    }

    private func loadTerminalContext(
        transferId: String,
        recipientId: String? = nil
    ) -> TerminalContext? {
        guard let active = appState.activeTransfer,
              active.id == transferId else {
            return nil
        }
        let resolvedRecipientId = recipientId ?? active.recipientId
        let recipient = recipients.first(where: { $0.id == resolvedRecipientId })
            ?? Recipient(
                id: resolvedRecipientId,
                fullName: "Recipient",
                bankName: "",
                bankCode: "",
                accountNumber: ""
            )
        let transfer = Transfer(
            id: active.id,
            userId: "",
            recipientId: active.recipientId,
            corridorId: "",
            status: active.status,
            sendAmount: active.audAmount,
            receiveAmount: active.ngnAmount == 0 ? nil : active.ngnAmount,
            exchangeRate: active.exchangeRate,
            fee: 0
        )
        return TerminalContext(transfer: transfer, recipient: recipient)
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
// Phase 9 iter-2 (API-908 / B7 / CA-904): all single-string cases
// pick up explicit argument labels; `requoteSend` carries the prefill
// payload directly.
enum SendDestination: Hashable {
    case addRecipient
    case payIdInstructions(String, TransferStatus)
    case processingTimeline(String, TransferStatus)
    /// Phase 7 iter-2 C1 / ADV-P7-C1: terminal happy-path destination.
    case receipt(transferId: String, recipientId: String)
    /// Phase 9 · U62: user-initiated cancel destination.
    case cancelTransfer(transferId: String)
    /// Phase 9 · U63: 24h AWAITING_AUD window expired.
    case expiredTransfer(transferId: String)
    /// Phase 9 · U64: FLOAT_INSUFFICIENT pause screen.
    case floatPaused(transferId: String)
    /// Phase 9 iter-2 · B7 / CA-904: re-quote SendView push. Prefill
    /// rides the destination payload — no ambient state.
    case requoteSend(SendPrefill)
}
