// KYCIntroView.swift  (Phase 1 · U22)
// Screen 06: 3-step preview before the Sumsub WebSDK / native SDK hand-off.

import SwiftUI

public struct KYCIntroView: View {
    @State private var vm: KYCIntroViewModel
    @State private var rationaleExpanded: Bool = false
    @Environment(\.dismiss) private var dismiss

    /// Fired when the user picks "Maybe later" instead of starting
    /// verification. The parent (OnboardingCoordinator) flips
    /// `appState.kycSkipped = true` so RootRouter routes to MainTab.
    /// Backend enforces KYC at transfer-processing time — a deferred
    /// user can browse and prepare a transfer; the actual ledger
    /// movement is gated until verification clears.
    private let onSkip: (() -> Void)?

    public init(vm: KYCIntroViewModel, onSkip: (() -> Void)? = nil) {
        self._vm = State(initialValue: vm)
        self.onSkip = onSkip
    }

    public var body: some View {
        ZStack(alignment: .top) {
            ScrollView {
                content
            }
        }
        .kolaWallpaper()
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { backButton }
        }
    }

    private var backButton: some View {
        Button {
            dismiss()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(KolaColors.whiteOnGradient)
                .hitTarget44()
        }
        .accessibilityLabel("Back")
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.card) {
            heading
            stepsList
            rationaleLink
            if let error = vm.errorMessage {
                Text(error)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(error)")
            }
            startButton
            if onSkip != nil { skipButton }
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xxxl)
        .padding(.bottom, KolaSpacing.homeIndicator)
    }

    private var skipButton: some View {
        Button {
            onSkip?()
        } label: {
            Text("Maybe later")
                .font(KolaFont.cta)
                .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
        }
        .accessibilityHint("Skip verification for now. You'll be asked again before sending money.")
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Verify your identity")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .accessibilityAddTraits(.isHeader)
            Text("AUSTRAC requires this for every Australian remittance customer. It usually takes a few minutes.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, KolaSpacing.l)
    }

    private var stepsList: some View {
        VStack(spacing: KolaSpacing.m) {
            stepCard(number: 1, icon: "doc.text.viewfinder",
                     title: "Photo of your ID",
                     subtitle: "Driver's licence, passport, or Medicare card.")
            stepCard(number: 2, icon: "person.crop.circle.badge.checkmark",
                     title: "Quick selfie",
                     subtitle: "We match it to the photo on your ID.")
            stepCard(number: 3, icon: "house",
                     title: "Proof of address",
                     subtitle: "Recent bank statement or utility bill.")
        }
    }

    private func stepCard(number: Int, icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: KolaSpacing.m) {
            ZStack {
                Circle()
                    .fill(KolaColors.greenLight.opacity(0.16))
                    .frame(width: 44, height: 44)
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(KolaColors.greenLight)
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Step \(number)")
                    .font(KolaFont.fieldLabel)
                    .kerning(KolaKerning.label)
                    .textCase(.uppercase)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
                Text(title)
                    .font(KolaFont.rowValue)
                    .foregroundStyle(KolaColors.whiteOnGradient)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.vertical, KolaSpacing.l)
        .kolaFrosted(.card)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(number). \(title). \(subtitle)")
    }

    private var rationaleLink: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Button {
                rationaleExpanded.toggle()
            } label: {
                HStack {
                    Text(rationaleExpanded ? "Hide details" : "Why we ask")
                        .font(KolaFont.cta)
                        .foregroundStyle(KolaColors.greenLight)
                    Image(systemName: rationaleExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(KolaColors.greenLight)
                        .accessibilityHidden(true)
                }
            }
            .accessibilityHint(rationaleExpanded ? "Collapse the rationale" : "Show why we ask for identity verification")
            if rationaleExpanded {
                Text("Kolaleaf is registered with AUSTRAC as a money-transfer business. Verifying your identity is required by Australian law for every transfer. Your documents are processed by our third party regulated identity provider.")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var startButton: some View {
        Button {
            Task { await vm.startVerification() }
        } label: {
            HStack(spacing: KolaSpacing.s) {
                if vm.isFetchingToken {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                }
                Text("Start verification")
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
            }
            .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                    .fill(vm.isFetchingToken ? Color.white.opacity(0.18) : KolaColors.greenLight)
            )
        }
        .disabled(vm.isFetchingToken)
        .accessibilityLabel(vm.isFetchingToken ? "Starting verification" : "Start verification")
        .accessibilityHint("Begin the 3-step identity verification flow")
    }
}
