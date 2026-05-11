// EmptySendView.swift  (Phase 4 · U35)
// First-send empty state: shown when the user has no recipients
// saved. The CTA pushes the AddRecipient flow on top of the Send
// tab's NavigationStack.
//
// Visual:
//   • Centered illustration symbol (SF Symbol, scaled hopeGold) so
//     we don't ship an asset for a screen that will be re-designed
//     once the AU→NG corridor lands proper artwork.
//   • Headline + subhead that reads as a friendly, not-empty
//     prompt — the regulatory weight ("AUSTRAC requires a
//     verified recipient") lives on AddRecipient itself; Send Tab's
//     empty state stays warm.
//   • Single primary CTA on the trustGreen colour. No secondary —
//     there's nothing else for the user to do here.

import SwiftUI

public struct EmptySendView: View {
    private let onAddRecipient: () -> Void

    public init(onAddRecipient: @escaping () -> Void) {
        self.onAddRecipient = onAddRecipient
    }

    public var body: some View {
        VStack(spacing: KolaSpacing.card) {
            Spacer()
            illustration
            heading
            cta
            Spacer()
            Spacer() // weight the layout above center for visual balance
        }
        .padding(.horizontal, KolaSpacing.xxxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KolaColors.surface.ignoresSafeArea())
    }

    private var illustration: some View {
        ZStack {
            Circle()
                .fill(KolaColors.cream)
                .frame(width: 120, height: 120)
            Image(systemName: "paperplane.fill")
                .font(.system(size: 48, weight: .semibold))
                .foregroundStyle(KolaColors.trustGreen)
                .rotationEffect(.degrees(-15))
        }
        .accessibilityHidden(true)
    }

    private var heading: some View {
        VStack(spacing: KolaSpacing.s) {
            Text("Send your first transfer")
                .font(KolaFont.pageTitle)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
                .multilineTextAlignment(.center)
            Text("Add a recipient to send Naira home in seconds.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
                .multilineTextAlignment(.center)
        }
    }

    private var cta: some View {
        Button(action: onAddRecipient) {
            Text("Add a recipient")
                .font(KolaFont.cta)
                .kerning(KolaKerning.cta)
                .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
                .foregroundStyle(.white)
                .background(
                    RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                        .fill(KolaColors.trustGreen)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add a recipient")
        .accessibilityHint("Opens the add-recipient form")
    }
}
