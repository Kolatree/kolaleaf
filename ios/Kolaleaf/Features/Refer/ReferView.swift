// ReferView.swift  (Phase 8 · U57)
// Screen 28 — Refer a friend.
//   • Gift-card hero with the referral code.
//   • Copy code button (UIPasteboard, 120s expiration, localOnly).
//   • WhatsApp / Copy / Share row.
//   • Earned / joined / pending stats card.

import SwiftUI
import UIKit

public struct ReferView: View {

    @Environment(\.apiClient) private var apiClient
    @State private var vm: ReferViewModel?
    @State private var showCopied: Bool = false

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(spacing: KolaSpacing.card) {
                switch vm?.state {
                case .none, .idle, .loading:
                    loadingState
                case .loaded:
                    heroCard
                    actionsRow
                    statsCard
                case .sessionExpired:
                    Text("Session expired")
                        .font(KolaFont.section)
                case .failed(let message):
                    Text(message)
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.textSecondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.vertical, KolaSpacing.xxl)
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationTitle("Refer a friend")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if vm == nil {
                vm = ReferViewModel(api: apiClient)
            }
            await vm?.load()
        }
        .overlay(alignment: .bottom) {
            if showCopied {
                Text("Copied")
                    .font(KolaFont.cta)
                    .padding(.horizontal, KolaSpacing.xl)
                    .padding(.vertical, KolaSpacing.s)
                    .background(KolaColors.trustGreen)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
                    .padding(.bottom, KolaSpacing.xxl)
                    .transition(.opacity)
            }
        }
    }

    // MARK: - Cards

    private var heroCard: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Give $10, get $10")
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Share your code with friends. They get $10 off their first transfer; you get $10 when they send.")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
                .multilineTextAlignment(.center)
            codeBox
        }
        .padding(KolaSpacing.card)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg)
                .fill(KolaColors.cream)
        )
    }

    private var codeBox: some View {
        let code = vm?.code ?? "—"
        return HStack {
            Text(code)
                .font(KolaFont.amountSmall)
                .kerning(KolaKerning.amount)
                .foregroundStyle(KolaColors.textPrimary)
            Spacer()
            Button(action: copyCode) {
                Text("Copy")
                    .font(KolaFont.cta)
                    .foregroundStyle(KolaColors.trustGreen)
            }
            .disabled(vm?.code == nil)
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.vertical, KolaSpacing.m)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cta)
                .fill(KolaColors.Card.background)
        )
    }

    private var actionsRow: some View {
        // Iter-2 (N8): every CTA stays hidden until a real code loads.
        // Iter-1 showed the Share button against a placeholder string
        // ("Hey, try the app…") which let users send a code-less
        // invite with no attribution.
        HStack(spacing: KolaSpacing.s) {
            shareButton
            if vm?.code != nil, let text = vm?.shareText {
                ShareLink(item: text) {
                    actionLabel(title: "Share", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var shareButton: some View {
        let whats = vm?.whatsAppURL
        let universal = vm?.universalShareURL
        Button {
            guard let whats else { return }
            // Try the deep link first; iOS surfaces the universal
            // fallback automatically when WhatsApp isn't installed
            // (the universal URL is also safe to open in Safari).
            if UIApplication.shared.canOpenURL(whats) {
                UIApplication.shared.open(whats)
            } else if let universal {
                UIApplication.shared.open(universal)
            }
        } label: {
            actionLabel(title: "WhatsApp", systemImage: "message.fill")
        }
        .buttonStyle(.plain)
        .disabled(vm?.whatsAppURL == nil)
    }

    private func actionLabel(title: String, systemImage: String) -> some View {
        HStack(spacing: KolaSpacing.xs) {
            Image(systemName: systemImage)
            Text(title).font(KolaFont.cta)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, KolaSpacing.m)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cta)
                .fill(KolaColors.surfaceSoft)
        )
        .foregroundStyle(KolaColors.textPrimary)
    }

    private var statsCard: some View {
        let stats = vm?.stats ?? .empty
        return HStack {
            stat(label: "Earned", value: "$\(stats.earned)")
            Divider()
            stat(label: "Joined", value: "\(stats.joined)")
            Divider()
            stat(label: "Pending", value: "\(stats.pending)")
        }
        .padding(KolaSpacing.card)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.card)
                .fill(KolaColors.Card.background)
        )
    }

    private func stat(label: String, value: String) -> some View {
        VStack(spacing: KolaSpacing.xxs) {
            Text(value)
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text(label)
                .font(KolaFont.fieldLabel)
                .textCase(.uppercase)
                .kerning(KolaKerning.label)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var loadingState: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .tint(KolaColors.trustGreen)
            .frame(maxWidth: .infinity, minHeight: 200)
    }

    // MARK: - Actions

    private func copyCode() {
        guard let code = vm?.code, !code.isEmpty else { return }
        UIPasteboard.general.setItems(
            [[UIPasteboard.typeAutomatic: code]],
            options: [
                .expirationDate: Date().addingTimeInterval(120),
                .localOnly: true,
            ]
        )
        withAnimation { showCopied = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            withAnimation { showCopied = false }
        }
    }
}
