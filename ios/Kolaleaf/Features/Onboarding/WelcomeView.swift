// WelcomeView.swift  (Phase 1 · U16 — rebrand pass Phase 0.6)
// Screen 01 — first impression. Vectors brand: Trust Green primary, white
// surface, Hope Gold accents on the trust line, AUSTRAC compliance signal
// preserved. The Phase 0 coded "K" badge is replaced with the official
// `LogoPrimary` SVG asset; the wordmark uses `WordmarkPrimary` so the
// supplied vector is the source of truth (per Vectors §2 logo usage rules).
//
// On appear, kicks off the same fire-and-forget pasteboard scan via
// ReferralCapture (U91) so a WhatsApp-shared token is captured before the
// user signs up. Pre-auth screen — does NOT call `bumpInteraction()`.

import SwiftUI

public struct WelcomeView: View {
    /// Tapped "Get started" — route to email signup.
    public var onGetStarted: () -> Void
    /// Tapped "Sign in" — route to login.
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
            // Top: official logomark + wordmark
            VStack(spacing: KolaSpacing.l) {
                logoMark
                wordmark
            }
            .padding(.top, KolaSpacing.xxxl)

            Spacer(minLength: KolaSpacing.card)

            // Middle hero: pitch + subtitle
            VStack(spacing: KolaSpacing.m) {
                pitch
                subtitle
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, KolaSpacing.card)

            Spacer(minLength: KolaSpacing.card)

            // Bottom: CTAs + trust strip
            VStack(spacing: KolaSpacing.m) {
                primaryCTA
                secondaryCTA
                trustStrip.padding(.top, KolaSpacing.s)
            }
            .padding(.horizontal, KolaSpacing.card)
            .padding(.bottom, KolaSpacing.xxxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .kolaWallpaper()
        .task {
            await scanPasteboardOnce()
        }
    }

    // MARK: - Pieces

    /// Vectors-supplied primary logomark (leaf glyph). Asset catalog stores
    /// the SVG with `preserves-vector-representation: true` so it scales
    /// without raster artifacts at any size.
    private var logoMark: some View {
        Image("LogoPrimary")
            .resizable()
            .renderingMode(.original)
            .aspectRatio(contentMode: .fit)
            .frame(width: 76, height: 76)
            .accessibilityHidden(true)
    }

    /// Vectors-supplied primary wordmark — the official `Kolaleaf` lockup.
    private var wordmark: some View {
        Image("WordmarkPrimary")
            .resizable()
            .renderingMode(.original)
            .aspectRatio(contentMode: .fit)
            .frame(height: 32)
            .accessibilityLabel("Kolaleaf")
    }

    /// Hero copy from Vectors §8 hero recommendation.
    private var pitch: some View {
        Text("Send money home with care.")
            .font(KolaFont.headline)
            .kerning(KolaKerning.headline)
            .foregroundStyle(KolaColors.ink)
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var subtitle: some View {
        Text("Kolaleaf helps Africans abroad support loved ones quickly, securely, and affordably.")
            .font(KolaFont.tagline)
            .foregroundStyle(KolaColors.muted)
            .lineSpacing(2)
            .frame(maxWidth: 320)
    }

    /// Primary CTA — Trust Green filled pill (Vectors §6 button-primary spec).
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
            .background(KolaColors.trustGreen)
            .clipShape(RoundedRectangle(cornerRadius: KolaRadius.pill))
            .shadow(color: KolaColors.trustGreen.opacity(0.18), radius: 12, x: 0, y: 8)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Get started, sign up for an account")
        .accessibilityAddTraits(.isButton)
    }

    /// Secondary CTA — white pill with `neutral.200` border + Trust-Green
    /// label (Vectors §6 button-secondary spec).
    private var secondaryCTA: some View {
        Button(action: onSignIn) {
            Text("I already have an account")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.trustGreen)
                .frame(maxWidth: .infinity)
                .frame(minHeight: KolaSpacing.hitTarget)
                .padding(.vertical, KolaSpacing.m)
                .background(Color.white)
                .overlay(
                    RoundedRectangle(cornerRadius: KolaRadius.pill)
                        .stroke(KolaColors.border, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: KolaRadius.pill))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Sign in, returning user")
        .accessibilityAddTraits(.isButton)
    }

    /// AUSTRAC compliance signal preserved (Kolaleaf is the licensed entity).
    /// Hope Gold accent reserved for the regulatory reference per the
    /// 70/20/10 colour ratio: gold = 10% accent moments only.
    private var trustStrip: some View {
        HStack(spacing: KolaSpacing.s) {
            Text("AUSTRAC-registered remittance provider")
                .foregroundStyle(KolaColors.muted)
            Text("·")
                .foregroundStyle(KolaColors.hopeGold)
            Text("AUSTRAC Registered")
                .foregroundStyle(KolaColors.muted)
        }
        .font(KolaFont.trust)
        .kerning(KolaKerning.label)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Registered Australian money transmitter, AUSTRAC Registered")
    }

    // MARK: - Pasteboard one-shot

    private func scanPasteboardOnce() async {
        // Fire-and-forget: a missing referralCapture (e.g., previews without
        // injection) returns silently. The injection key has a sane default.
        _ = await referralCapture.captureFromPasteboardIfNotConsumed()
    }
}

// MARK: - Environment injection

// Note: `\.referralCapture` EnvironmentKey lives in App/Environment+Kola.swift
// alongside `\.apiClient`, `\.keychain`, and `\.pushPermissionService`.
