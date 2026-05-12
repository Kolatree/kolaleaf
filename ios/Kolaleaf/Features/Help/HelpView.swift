// HelpView.swift  (Phase 8 · U58)
// Screen 29 — Help / live chat landing.
//   • Search-style placeholder header.
//   • 4 quick-help cards in a 2×2 grid.
//   • Recent transfer row (deep-links to TransactionDetail).
//   • Chat CTA at the bottom.

import SwiftUI

public struct HelpView: View {

    @Environment(\.apiClient) private var apiClient
    @State private var vm: HelpViewModel?
    /// When non-nil, the View pushes TransactionDetailView for the
    /// matching transfer id. Owned by the parent NavigationStack
    /// via the bound destination value.
    @Binding private var path: [HelpDestination]

    public init(path: Binding<[HelpDestination]>) {
        self._path = path
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KolaSpacing.card) {
                searchHeader
                quickHelpGrid
                if let recentId = vm?.recentTransferId {
                    recentTransferRow(id: recentId)
                }
                chatCTA
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.vertical, KolaSpacing.xxl)
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationTitle("Help")
        .navigationBarTitleDisplayMode(.large)
        .task {
            if vm == nil {
                vm = HelpViewModel(api: apiClient)
            }
            await vm?.load()
        }
    }

    // MARK: - Sections

    private var searchHeader: some View {
        // Phase 8 ships search as a visual placeholder — the live
        // search backend lands later. The non-functional field still
        // anchors the design.
        HStack(spacing: KolaSpacing.s) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(KolaColors.textSecondary)
            Text("Search help articles")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
            Spacer()
        }
        .padding(KolaSpacing.m)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cta)
                .fill(KolaColors.surfaceSoft)
        )
    }

    private var quickHelpGrid: some View {
        let columns = [
            GridItem(.flexible(), spacing: KolaSpacing.m),
            GridItem(.flexible(), spacing: KolaSpacing.m),
        ]
        return LazyVGrid(columns: columns, spacing: KolaSpacing.m) {
            ForEach(vm?.quickHelpCards ?? []) { card in
                Button { vm?.openQuickHelp(card) } label: {
                    VStack(alignment: .leading, spacing: KolaSpacing.s) {
                        Text(card.title)
                            .font(KolaFont.rowTotal)
                            .foregroundStyle(KolaColors.textPrimary)
                            .multilineTextAlignment(.leading)
                        Text(card.subtitle)
                            .font(KolaFont.row)
                            .foregroundStyle(KolaColors.textSecondary)
                            .multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(KolaSpacing.l)
                    .background(
                        RoundedRectangle(cornerRadius: KolaRadius.card)
                            .fill(KolaColors.Card.background)
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func recentTransferRow(id: String) -> some View {
        Button { path.append(.transactionDetail(id)) } label: {
            HStack {
                VStack(alignment: .leading, spacing: KolaSpacing.xxs) {
                    Text("Recent transfer")
                        .font(KolaFont.fieldLabel)
                        .textCase(.uppercase)
                        .kerning(KolaKerning.label)
                        .foregroundStyle(KolaColors.textSecondary)
                    Text("View status and details")
                        .font(KolaFont.rowTotal)
                        .foregroundStyle(KolaColors.textPrimary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(KolaColors.textSecondary)
            }
            .padding(KolaSpacing.l)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.card)
                    .fill(KolaColors.Card.background)
            )
        }
        .buttonStyle(.plain)
    }

    private var chatCTA: some View {
        Button { vm?.openChatCTA() } label: {
            HStack(spacing: KolaSpacing.s) {
                Image(systemName: "bubble.left.fill")
                Text("Chat with support")
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, KolaSpacing.m)
            .background(KolaColors.trustGreen)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: KolaRadius.cta))
        }
        .buttonStyle(.plain)
    }
}

public enum HelpDestination: Hashable {
    case transactionDetail(String)
}
