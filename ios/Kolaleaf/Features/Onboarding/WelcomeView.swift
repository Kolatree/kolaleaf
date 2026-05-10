// WelcomeView.swift  (Phase 1 · U16)
// Screen 01 from variant-C-journey: brand introduction with two CTAs and an
// AUSTRAC trust strip at the foot. Wallpaper via `.kolaWallpaper()`.
//
// On appear, kicks off a fire-and-forget pasteboard scan via ReferralCapture
// (U91) so a WhatsApp-shared token is captured before the user signs up.
//
// Pre-auth screen — does NOT call AppState.bumpInteraction().

import SwiftUI

public struct WelcomeView: View {
    /// Tapped "Get started" — route to phone signup (U17).
    public var onGetStarted: () -> Void
    /// Tapped "I already have an account" — route to login (U21).
    public var onSignIn: () -> Void

    @Environment(\.referralCapture) private var referralCapture
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(onGetStarted: @escaping () -> Void,
                onSignIn: @escaping () -> Void) {
        self.onGetStarted = onGetStarted
        self.onSignIn = onSignIn
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Top: logo mark + wordmark
            VStack(spacing: KolaSpacing.xl) {
                logoMark
                wordmark
            }
            .padding(.top, KolaSpacing.xxxl)

            Spacer(minLength: KolaSpacing.card)

            // Middle hero: pitch + subtitle
            VStack(spacing: KolaSpacing.s) {
                pitch
                subtitle
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, KolaSpacing.card)

            Spacer(minLength: KolaSpacing.card)

            // Bottom: CTAs + trust strip
            VStack(spacing: KolaSpacing.s) {
                primaryCTA
                secondaryCTA
                trustStrip.padding(.top, KolaSpacing.s)
            }
            .padding(.horizontal, KolaSpacing.card)
            .padding(.bottom, KolaSpacing.xxxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .kolaWallpaper()
        .task { await scanPasteboardOnce() }
    }

    // MARK: - Pieces

    private var logoMark: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22)
                .fill(LinearGradient(
                    colors: [KolaColors.greenLight, KolaColors.green],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .frame(width: 76, height: 76)
                .shadow(color: .black.opacity(0.22), radius: 15, x: 0, y: 12)
                .overlay(
                    RoundedRectangle(cornerRadius: 22)
                        .stroke(Color.white.opacity(0.25), lineWidth: 2)
                )

            Text("K")
                .font(.system(size: 36, weight: .black))
                .foregroundStyle(KolaColors.ink)
        }
        .accessibilityHidden(true)
    }

    private var wordmark: some View {
        (Text("Kola")
            .foregroundStyle(KolaColors.whiteOnGradient)
         + Text("leaf")
            .foregroundStyle(KolaColors.greenLight))
            .font(KolaFont.headline)
            .kerning(KolaKerning.headline)
            .accessibilityLabel("Kolaleaf")
    }

    private var pitch: some View {
        (Text("Send to Nigeria.\nIn ")
            .foregroundStyle(KolaColors.whiteOnGradient)
         + Text("minutes.")
            .foregroundStyle(KolaColors.greenLight))
            .font(KolaFont.headline)
            .kerning(KolaKerning.headline)
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var subtitle: some View {
        Text("Better rates than WorldRemit. AUSTRAC registered. Trusted by Nigerian-Australians since 2019.")
            .font(KolaFont.tagline)
            .foregroundStyle(KolaColors.whiteOnGradientMuted)
            .lineSpacing(2)
            .frame(maxWidth: 320)
    }

    private var primaryCTA: some View {
        Button(action: onGetStarted) {
            HStack(spacing: KolaSpacing.s) {
                Text("Get started")
                Text("→")
            }
            .font(KolaFont.cta)
            .kerning(KolaKerning.cta)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(minHeight: KolaSpacing.hitTarget)
            .padding(.vertical, KolaSpacing.l)
            .background(
                LinearGradient(
                    colors: [KolaColors.greenLight, KolaColors.green],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: KolaRadius.card))
            .shadow(color: KolaColors.green.opacity(0.35), radius: 9, x: 0, y: 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Get started, sign up for an account")
        .accessibilityAddTraits(.isButton)
    }

    private var secondaryCTA: some View {
        Button(action: onSignIn) {
            Text("I already have an account")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .frame(maxWidth: .infinity)
                .frame(minHeight: KolaSpacing.hitTarget)
                .padding(.vertical, KolaSpacing.m)
                .background(KolaColors.Frosted.background)
                .overlay(
                    RoundedRectangle(cornerRadius: KolaRadius.card)
                        .stroke(KolaColors.Frosted.border, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: KolaRadius.card))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Sign in, returning user")
        .accessibilityAddTraits(.isButton)
    }

    private var trustStrip: some View {
        Text("Licensed AU money transmitter · AUSTRAC RG 105")
            .font(KolaFont.trust)
            .kerning(KolaKerning.label)
            .foregroundStyle(KolaColors.whiteOnGradientMuted)
            .accessibilityLabel("Licensed Australian money transmitter, AUSTRAC reference RG 105")
    }

    // MARK: - Pasteboard one-shot

    private func scanPasteboardOnce() async {
        // Fire-and-forget: a missing referralCapture (e.g., previews without injection)
        // returns silently. The injection key has a sane default below.
        _ = await referralCapture.captureFromPasteboardIfNotConsumed()
    }
}

// MARK: - Environment injection

// Note: `\.referralCapture` EnvironmentKey lives in App/Environment+Kola.swift
// alongside `\.apiClient` and `\.keychain`. The preview-friendly default value
// is defined there.
