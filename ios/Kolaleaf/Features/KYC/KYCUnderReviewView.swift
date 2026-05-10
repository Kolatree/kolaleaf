// KYCUnderReviewView.swift  (Phase 2 · U27)
// Screen 09: KYC has been bumped to human review. The user stays here until
// the backend webhook flips kycStatus to verified or rejected. CTA registers
// the device for an APNS notification so we can ping when review completes;
// "Talk to support" opens the web help deep-link.

import SwiftUI

public struct KYCUnderReviewView: View {

    public let onNotifyMe: () -> Void
    public let onTalkToSupport: () -> Void

    @State private var notifyRequested: Bool = false

    public init(onNotifyMe: @escaping () -> Void,
                onTalkToSupport: @escaping () -> Void) {
        self.onNotifyMe = onNotifyMe
        self.onTalkToSupport = onTalkToSupport
    }

    public var body: some View {
        VStack(spacing: KolaSpacing.xl) {
            Spacer()
            badge
            heading
            etaCard
            Spacer()
            notifyButton
            supportButton
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.bottom, KolaSpacing.homeIndicator)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .kolaWallpaper()
        .navigationBarBackButtonHidden(true)
    }

    private var badge: some View {
        ZStack {
            Circle()
                .fill(KolaColors.greenLight.opacity(0.18))
                .frame(width: 88, height: 88)
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(KolaColors.greenLight)
        }
        .accessibilityHidden(true)
    }

    private var heading: some View {
        VStack(spacing: KolaSpacing.s) {
            Text("Under review")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
            Text("A human reviewer is taking a closer look at your documents.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, KolaSpacing.xl)
    }

    private var etaCard: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Typical wait")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
            Text("Under 24 hours")
                .font(KolaFont.rowValue)
                .foregroundStyle(KolaColors.whiteOnGradient)
            Text("We'll let you know as soon as it's done.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.vertical, KolaSpacing.l)
        .kolaFrosted(.card)
    }

    private var notifyButton: some View {
        Button {
            notifyRequested = true
            onNotifyMe()
        } label: {
            HStack(spacing: KolaSpacing.s) {
                Image(systemName: notifyRequested ? "bell.badge.fill" : "bell")
                    .font(.system(size: 18, weight: .semibold))
                Text(notifyRequested ? "We'll let you know" : "Notify me when done")
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
            }
            .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                    .fill(notifyRequested ? Color.white.opacity(0.18) : KolaColors.greenLight)
            )
        }
        .disabled(notifyRequested)
        .animation(KolaMotion.softFade, value: notifyRequested)
    }

    private var supportButton: some View {
        Button(action: onTalkToSupport) {
            Text("Talk to support")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
        }
    }
}
