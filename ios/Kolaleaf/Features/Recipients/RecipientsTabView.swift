// RecipientsTabView.swift  (Phase 8 · U56)
// Screen 27 — Recipients tab landing screen.
//   • Search field across name + bank.
//   • "Most sent to" pinned strip (top 3).
//   • All-recipients list with long-press context menu (Send / Edit / Delete).
//   • Tap a row → push SendView pre-filled with the recipient (wired
//     by the parent NavigationStack via a callback).
//   • Empty state with "Add recipient" CTA.

import SwiftUI

public struct RecipientsTabView: View {

    @Environment(\.apiClient) private var apiClient
    @Environment(\.swiftDataStack) private var stack
    @Environment(\.syncService) private var injectedSync

    @State private var vm: RecipientsViewModel?
    /// Routed to the parent NavigationStack via the bound destination
    /// values declared on `RecipientsDestination`.
    @Binding private var path: [RecipientsDestination]

    public init(path: Binding<[RecipientsDestination]>) {
        self._path = path
    }

    public var body: some View {
        VStack(spacing: 0) {
            switch vm?.state {
            case .none, .idle, .loading:
                loadingState
            case .loaded(let recipients):
                loadedContent(recipients: recipients)
            case .sessionExpired:
                sessionExpiredState
            case .failed(let message):
                failedState(message: message)
            }
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationTitle("Recipients")
        .navigationBarTitleDisplayMode(.large)
        .task {
            if vm == nil {
                // Iter-2 (P5): reuse the app-root SyncService when
                // injected so cache writes don't fan out to multiple
                // contexts. Falls back to a local instance for
                // previews + tests that don't wire the environment.
                let sync = injectedSync
                    ?? SyncService(api: apiClient, stack: stack)
                vm = RecipientsViewModel(api: apiClient, sync: sync)
            }
            await vm?.load()
        }
    }

    // MARK: - Loaded

    @ViewBuilder
    private func loadedContent(recipients: [Recipient]) -> some View {
        let searchBinding = Binding<String>(
            get: { vm?.searchText ?? "" },
            set: { vm?.searchText = $0 }
        )

        ScrollView {
            VStack(alignment: .leading, spacing: KolaSpacing.card) {
                searchField(text: searchBinding)

                if recipients.isEmpty {
                    emptyState
                } else {
                    if let pinned = vm?.pinnedRecipients, !pinned.isEmpty,
                       (vm?.searchText.isEmpty ?? true) {
                        pinnedStrip(recipients: pinned)
                    }
                    fullList(recipients: vm?.filteredRecipients ?? recipients)
                }
            }
            .padding(.top, KolaSpacing.xl)
            .padding(.bottom, KolaSpacing.homeIndicator)
        }
        .refreshable { await vm?.refresh() }
    }

    private func searchField(text: Binding<String>) -> some View {
        HStack(spacing: KolaSpacing.s) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(KolaColors.textSecondary)
            TextField("Search name or bank", text: text)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
        .padding(KolaSpacing.m)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cta)
                .fill(KolaColors.surfaceSoft)
        )
        .padding(.horizontal, KolaSpacing.xl)
    }

    @ViewBuilder
    private func pinnedStrip(recipients: [Recipient]) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Most sent to")
                .font(KolaFont.fieldLabel)
                .textCase(.uppercase)
                .kerning(KolaKerning.label)
                .foregroundStyle(KolaColors.textSecondary)
                .padding(.horizontal, KolaSpacing.xl)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: KolaSpacing.m) {
                    ForEach(recipients) { recipient in
                        pinnedCard(recipient: recipient)
                    }
                }
                .padding(.horizontal, KolaSpacing.xl)
            }
        }
    }

    private func pinnedCard(recipient: Recipient) -> some View {
        Button {
            path.append(.send(recipient.id))
        } label: {
            VStack(spacing: KolaSpacing.xs) {
                avatarCircle(initials: recipient.initials)
                Text(recipient.fullName)
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(width: 96)
            .padding(KolaSpacing.m)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.card)
                    .fill(KolaColors.Card.background)
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func fullList(recipients: [Recipient]) -> some View {
        VStack(spacing: KolaSpacing.s) {
            ForEach(recipients) { recipient in
                row(recipient: recipient)
            }
        }
        .padding(.horizontal, KolaSpacing.xl)
    }

    private func row(recipient: Recipient) -> some View {
        Button {
            path.append(.send(recipient.id))
        } label: {
            HStack(spacing: KolaSpacing.m) {
                avatarCircle(initials: recipient.initials)
                VStack(alignment: .leading, spacing: KolaSpacing.xxs) {
                    Text(recipient.fullName)
                        .font(KolaFont.rowTotal)
                        .foregroundStyle(KolaColors.textPrimary)
                    Text("\(recipient.bankName) · \(recipient.accountNumber)")
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.textSecondary)
                }
                Spacer()
            }
            .padding(KolaSpacing.l)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.card)
                    .fill(KolaColors.Card.background)
            )
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                path.append(.send(recipient.id))
            } label: {
                Label("Send", systemImage: "paperplane.fill")
            }
            Button(role: .destructive) {
                Task { await vm?.delete(recipient) }
            } label: {
                Label("Delete", systemImage: "trash.fill")
            }
        }
    }

    private func avatarCircle(initials: String) -> some View {
        Circle()
            .fill(KolaColors.trustGreen.opacity(0.12))
            .frame(width: 40, height: 40)
            .overlay(
                Text(initials)
                    .font(KolaFont.rowTotal)
                    .foregroundStyle(KolaColors.trustGreen)
            )
    }

    // MARK: - Empty

    private var emptyState: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("No recipients yet")
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Add a recipient to send your first transfer.")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                path.append(.addRecipient)
            } label: {
                Text("Add recipient")
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, KolaSpacing.m)
                    .background(KolaColors.trustGreen)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: KolaRadius.cta))
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.top, KolaSpacing.s)
        }
        .padding(.top, KolaSpacing.xxxl)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Other states

    private var loadingState: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .tint(KolaColors.trustGreen)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var sessionExpiredState: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Session expired")
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Sign in to manage recipients.")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func failedState(message: String) -> some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Couldn't load recipients")
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text(message)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, KolaSpacing.xl)
            Button("Try again") {
                Task { await vm?.refresh() }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Navigation destination

public enum RecipientsDestination: Hashable {
    case addRecipient
    case send(String)  // recipientId; Phase 8 wires to SendView pre-filled.
}
