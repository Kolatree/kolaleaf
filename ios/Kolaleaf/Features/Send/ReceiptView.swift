// ReceiptView.swift  (Phase 7 · U50 → iter-2 W7/W11/W12/S6)
// Done · share · revisit screen. The terminal step in the Send flow.
//
// Layout: big checkmark, "Money's home", amount sent + received,
// recipient summary card, Share + Send-Another CTAs.
//
// Iter-2 fixes:
//   • W7 / ADV-P7-W1: cache the rendered share image once per appear.
//     ShareLink(item:preview:) was rendering twice on every refresh.
//   • W11 / ADV-P7-W5: share image defaults to first-name-only ("To
//     Adaobi"). A "Show full name" toggle (off by default) lets the
//     user override per share — full last-name is never the default
//     because the share is one tap from a public WhatsApp Status.
//   • W12 / ADV-P7-W6: checkmark badge swaps to a plane glyph for
//     NGN_SENT so we don't celebrate "money's home" before it arrives.
//   • S6 / ADV-P7-S1: send-another button disables after first tap.

import SwiftUI
import UIKit

public struct ReceiptView: View {

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.analyticsService) private var analyticsService
    @State private var vm: ReceiptViewModel
    @State private var checkScale: CGFloat = 0.6
    @State private var checkOpacity: Double = 0.0
    /// W7: cached share image. Rebuilt only when `useFullName` flips.
    @State private var cachedShareImage: Image?
    /// W11: default to first-name-only on the share image.
    @State private var useFullNameOnShare: Bool = false

    public init(vm: ReceiptViewModel) {
        _vm = State(initialValue: vm)
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: KolaSpacing.card) {
                checkmarkBadge
                headlineBlock
                amountBlock
                summaryCard
                shareNameToggle
                ctaStack
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.top, KolaSpacing.xxl)
            .padding(.bottom, KolaSpacing.homeIndicator)
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .onAppear {
            animateCheck()
            rebuildShareImage()
        }
        .task {
            await analyticsService?.track(
                .transferCompleted,
                properties: ["screen": .string("receipt")]
            )
        }
        .onChange(of: useFullNameOnShare) { _, _ in
            rebuildShareImage()
        }
    }

    // MARK: - Subviews

    /// W12: glyph + colour reflect the actual status. NGN_SENT means
    /// "in motion" (plane); COMPLETED means "landed" (checkmark).
    private var checkmarkBadge: some View {
        let isCompleted = vm.transfer.status == .completed
        return ZStack {
            Circle()
                .fill(isCompleted ? KolaColors.trustGreen : KolaColors.hopeGold)
                .frame(width: 96, height: 96)
            Image(systemName: isCompleted ? "checkmark" : "paperplane.fill")
                .font(.system(size: 44, weight: .bold))
                .foregroundStyle(.white)
        }
        .scaleEffect(checkScale)
        .opacity(checkOpacity)
        .accessibilityLabel(isCompleted ? "Transfer completed" : "Transfer in motion")
    }

    private var headlineBlock: some View {
        VStack(spacing: KolaSpacing.xs) {
            Text(vm.headline)
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
                .multilineTextAlignment(.center)
            Text("To \(vm.recipientName)")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var amountBlock: some View {
        VStack(spacing: KolaSpacing.xs) {
            Text(vm.sendAmountText)
                .font(KolaFont.amountLarge)
                .kerning(KolaKerning.amount)
                .foregroundStyle(KolaColors.textPrimary)
                .accessibilityIdentifier("receipt.amount.sent")
            Text(vm.receivedAmountText)
                .font(KolaFont.ngnAccent)
                .foregroundStyle(KolaColors.leafGreen)
                .accessibilityIdentifier("receipt.amount.received")
        }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            summaryRow(label: "Recipient", value: vm.recipientName)
            divider
            summaryRow(label: "Bank", value: vm.recipientBankLine)
            divider
            summaryRow(label: "Sent", value: vm.sendAmountText)
            divider
            summaryRow(label: "Received", value: vm.receivedAmountText)
            divider
            summaryRow(label: "Rate", value: vm.savingsLineCopy)
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

    private var divider: some View {
        Rectangle()
            .fill(KolaColors.border)
            .frame(height: 1)
    }

    private func summaryRow(label: String, value: String) -> some View {
        HStack(alignment: .center) {
            Text(label)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
            Spacer(minLength: KolaSpacing.s)
            Text(value)
                .font(KolaFont.rowValue)
                .foregroundStyle(KolaColors.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }

    /// W11: opt-in toggle for revealing the recipient's full name on
    /// the share image. Default off — the share is one tap from a
    /// public WhatsApp Status and we don't want to leak a last name
    /// by default.
    private var shareNameToggle: some View {
        Toggle(isOn: $useFullNameOnShare) {
            Text("Include full name on share image")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .tint(KolaColors.trustGreen)
        .padding(.horizontal, KolaSpacing.s)
    }

    private var ctaStack: some View {
        VStack(spacing: KolaSpacing.s) {
            shareButton
            sendAnotherButton
        }
    }

    /// W7: hands the CACHED image to ShareLink. Both the item and the
    /// preview reference the same `Image` so the rasterised UIImage
    /// renders exactly once.
    @ViewBuilder
    private var shareButton: some View {
        if let image = cachedShareImage {
            ShareLink(
                item: image,
                preview: SharePreview("Kolaleaf receipt", image: image)
            ) {
                HStack(spacing: KolaSpacing.s) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 16, weight: .semibold))
                    Text("Share receipt")
                        .font(KolaFont.cta)
                        .kerning(KolaKerning.cta)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
                .background(
                    RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                        .fill(KolaColors.kolaGreen)
                )
            }
            .buttonStyle(.plain)
            .simultaneousGesture(TapGesture().onEnded {
                Task {
                    await analyticsService?.track(
                        .receiptShared,
                        properties: [
                            "screen": .string("receipt"),
                            "method": .string("share_sheet"),
                        ]
                    )
                }
            })
        }
    }

    /// S6: disabled after first tap. The VM also debounces; the
    /// visual disable is for the user-visible affordance.
    private var sendAnotherButton: some View {
        Button(action: { vm.sendAnother() }) {
            Text("Send another")
                .font(KolaFont.cta)
                .kerning(KolaKerning.cta)
                .foregroundStyle(
                    vm.didSendAnother
                        ? KolaColors.mutedDisabled
                        : KolaColors.trustGreen
                )
                .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
                .background(
                    RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                        .strokeBorder(
                            vm.didSendAnother
                                ? KolaColors.mutedDisabled
                                : KolaColors.trustGreen,
                            lineWidth: 1
                        )
                )
        }
        .buttonStyle(.plain)
        .disabled(vm.didSendAnother)
    }

    // MARK: - Helpers

    /// W7: build the UIImage once and cache as SwiftUI Image. Called
    /// onAppear and again when `useFullNameOnShare` flips.
    private func rebuildShareImage() {
        let renderer = ShareReceiptRenderer.whatsApp
        let uiImage = renderer.render(
            transfer: vm.transfer,
            recipient: vm.recipient,
            useFullName: useFullNameOnShare
        )
        cachedShareImage = Image(uiImage: uiImage)
    }

    private func animateCheck() {
        if reduceMotion {
            checkScale = 1.0
            checkOpacity = 1.0
            return
        }
        withAnimation(.spring(response: 0.5, dampingFraction: 0.65)) {
            checkScale = 1.0
            checkOpacity = 1.0
        }
    }
}
