// MyPayIDView.swift  (Phase 7 · U53 — Screen 25)
// Account → My PayID & bank. Shows the user's standing PayID handle
// (the inverse of the transfer-time PayID, which lives on individual
// Transfer rows), with copy / QR / share affordances and a BSB +
// account fallback for friends paying through Kolaleaf.

import SwiftUI
import UIKit

public struct MyPayIDView: View {

    @State private var vm: MyPayIDViewModel
    @State private var showCopied: Bool = false
    @State private var copyAckCounter: UInt = 0

    public init(api: AuthAPI) {
        _vm = State(initialValue: MyPayIDViewModel(api: api))
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: KolaSpacing.card) {
                header
                switch vm.state {
                case .idle, .loading:
                    loadingCard
                case .allocated(let handle, let fallback):
                    payIDCard(handle: handle.value)
                    qrCard(handle: handle)
                    fallbackBankCard(fallback: fallback)
                case .unavailable(let reason, let fallback):
                    unavailableCard(reason: reason)
                    fallbackBankCard(fallback: fallback)
                case .failed(let message):
                    failedCard(message: message)
                }
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.top, KolaSpacing.xxl)
            .padding(.bottom, KolaSpacing.homeIndicator)
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationTitle("PayID & bank")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
        .task(id: copyAckCounter) {
            guard showCopied else { return }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled {
                showCopied = false
            }
        }
    }

    // MARK: - Subviews

    private var header: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Your PayID")
                .font(KolaFont.pageTitle)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
            // Iter-2 C3: copy intentionally non-committal until backend
            // allocates a real PayID. Iter-1 promised "Friends can send
            // AUD" while the screen rendered the user's email — a
            // money-misroute risk.
            Text("Your PayID is how friends send you AUD.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var loadingCard: some View {
        VStack(spacing: KolaSpacing.m) {
            ProgressView()
                .progressViewStyle(.circular)
                .tint(KolaColors.trustGreen)
            Text("Loading PayID…")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(KolaSpacing.card)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .fill(Color.white)
        )
        .overlay(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .strokeBorder(KolaColors.border, lineWidth: 1)
        )
    }

    private func payIDCard(handle: String) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("PayID")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            Text(handle)
                .font(KolaFont.rowTotal)
                .foregroundStyle(KolaColors.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .accessibilityIdentifier("mypayid.handle")
            HStack(spacing: KolaSpacing.s) {
                Button(action: { copy(handle: handle) }) {
                    Label(
                        showCopied ? "Copied" : "Copy",
                        systemImage: showCopied ? "checkmark" : "doc.on.doc"
                    )
                    .font(KolaFont.cta)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
                    .background(
                        RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                            .fill(KolaColors.trustGreen)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showCopied ? "PayID copied" : "Copy PayID")

                ShareLink(item: handle) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(KolaFont.cta)
                        .foregroundStyle(KolaColors.trustGreen)
                        .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
                        .background(
                            RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                                .strokeBorder(KolaColors.trustGreen, lineWidth: 1)
                        )
                }
                .accessibilityLabel("Share PayID")
            }
        }
        .padding(KolaSpacing.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .fill(Color.white)
        )
        .overlay(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .strokeBorder(KolaColors.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func qrCard(handle: PayIDHandle) -> some View {
        if let qr = vm.qrImage(for: handle) {
            VStack(spacing: KolaSpacing.s) {
                Text("Scan to pay")
                    .font(KolaFont.fieldLabel)
                    .kerning(KolaKerning.label)
                    .textCase(.uppercase)
                    .foregroundStyle(KolaColors.textSecondary)
                Image(uiImage: qr)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 200, height: 200)
                    .accessibilityLabel("QR code for PayID \(handle.value)")
            }
            .padding(KolaSpacing.card)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                    .fill(Color.white)
            )
            .overlay(
                RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                    .strokeBorder(KolaColors.border, lineWidth: 1)
            )
        }
    }

    private func fallbackBankCard(fallback: MyPayIDViewModel.FallbackBankAccount) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Or bank transfer")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            HStack {
                Text("BSB")
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.textSecondary)
                Spacer()
                Text(fallback.bsb)
                    .font(KolaFont.rowValue)
                    .foregroundStyle(KolaColors.textPrimary)
            }
            Rectangle().fill(KolaColors.border).frame(height: 1)
            HStack {
                Text("Account")
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.textSecondary)
                Spacer()
                Text(fallback.accountNumber)
                    .font(KolaFont.rowValue)
                    .foregroundStyle(KolaColors.textPrimary)
            }
            Text("Coming soon — per-user accounts will replace these placeholders.")
                .font(KolaFont.timestamp)
                .foregroundStyle(KolaColors.textSecondary)
                .padding(.top, KolaSpacing.xs)
        }
        .padding(KolaSpacing.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .fill(Color.white)
        )
        .overlay(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .strokeBorder(KolaColors.border, lineWidth: 1)
        )
    }

    private func unavailableCard(reason: String) -> some View {
        // Iter-2 C3 / ADV-P7-C2: copy is intentionally non-actionable —
        // there is no user step to take. The previous "Add a verified
        // email to claim a Kolaleaf PayID" copy implied the email IS
        // the PayID, which is a money-misroute risk.
        KolaErrorCard(
            tint: KolaColors.info,
            iconSystemName: "envelope.badge.fill",
            title: "PayID coming soon",
            message: reason,
            retry: nil
        )
    }

    private func failedCard(message: String) -> some View {
        KolaErrorCard(
            tint: KolaColors.coral,
            iconSystemName: "exclamationmark.triangle.fill",
            title: "Couldn't load PayID",
            message: message,
            retry: KolaErrorCard.RetryAction(
                label: "Try again",
                hint: "Reloads your PayID",
                perform: { Task { await vm.load() } }
            )
        )
    }

    // MARK: - Helpers

    private func copy(handle: String) {
        // Same expirationDate + localOnly contract as
        // PayIDInstructionsView (Phase 6 iter-2 W19): the clipboard
        // entry self-destructs in 2 min so the handle doesn't linger
        // and get pasted into a stranger's chat.
        UIPasteboard.general.setItems(
            [[UIPasteboard.typeAutomatic: handle]],
            options: [
                .expirationDate: Date().addingTimeInterval(120),
                .localOnly: true,
            ]
        )
        showCopied = true
        copyAckCounter &+= 1
    }
}
