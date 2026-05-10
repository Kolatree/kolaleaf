// SumsubPreWarmView.swift  (Phase 2 · U22a)
// Transition shell shown for ~700 ms after the user taps "Start verification"
// on KYC intro and before the Sumsub presenter mounts. Masks the cold-start
// latency of the WKWebView load so the user sees forward motion instead of a
// dead pause.
//
// The shell is informational only — no async work, no API calls. The parent
// coordinator triggers `onPrepared` after the timer elapses (or earlier, when
// the Sumsub session is ready); the view itself just renders.

import SwiftUI

public struct SumsubPreWarmView: View {
    /// Fired after the pre-warm timer elapses. Coordinator pushes the
    /// Sumsub presenter route.
    public var onPrepared: () -> Void
    /// In tests, override to 0 so the assertion path doesn't sleep.
    public var dwellSeconds: Double

    public init(dwellSeconds: Double = 0.7, onPrepared: @escaping () -> Void) {
        self.dwellSeconds = dwellSeconds
        self.onPrepared = onPrepared
    }

    public var body: some View {
        VStack(spacing: KolaSpacing.xl) {
            Spacer()

            ZStack {
                Circle()
                    .stroke(KolaColors.greenLight.opacity(0.18), lineWidth: 6)
                    .frame(width: 96, height: 96)
                ProgressView()
                    .progressViewStyle(.circular)
                    .controlSize(.large)
                    .tint(KolaColors.greenLight)
            }
            .accessibilityHidden(true)

            VStack(spacing: KolaSpacing.s) {
                Text("Preparing verification")
                    .font(KolaFont.headline)
                    .kerning(KolaKerning.headline)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                Text("Get your ID and a well-lit spot ready.")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, KolaSpacing.xl)
            .accessibilityElement(children: .combine)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .kolaWallpaper()
        .navigationBarBackButtonHidden(true)
        .task { await dwell() }
    }

    private func dwell() async {
        let nanos = UInt64(max(0, dwellSeconds) * 1_000_000_000)
        try? await Task.sleep(nanoseconds: nanos)
        onPrepared()
    }
}
