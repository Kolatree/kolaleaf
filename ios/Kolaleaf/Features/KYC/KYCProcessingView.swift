// KYCProcessingView.swift  (Phase 2 · U25)
// Screen 07: orbit spinner + 3-step list. Polls the server until KYC
// resolves to verified / rejected / timed-out, then notifies the parent
// coordinator.

import SwiftUI

public struct KYCProcessingView: View {
    @State private var vm: KYCProcessingViewModel
    @State private var rotation: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    public var onTerminal: (KYCProcessingViewModel.Terminal) -> Void

    public init(vm: KYCProcessingViewModel,
                onTerminal: @escaping (KYCProcessingViewModel.Terminal) -> Void) {
        self._vm = State(initialValue: vm)
        self.onTerminal = onTerminal
    }

    public var body: some View {
        VStack(spacing: KolaSpacing.xl) {
            Spacer()
            spinner
            heading
            stepsList
            if let err = vm.lastError {
                Text(err)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, KolaSpacing.xl)
                    .accessibilityLabel("Status: \(err)")
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .kolaWallpaper()
        .navigationBarBackButtonHidden(true)
        .onAppear {
            vm.start()
            // Phase 2 review fix (swift-ios-004): kick off the rotation
            // animation from the top-level body.onAppear so it's not
            // triggered from within a recomputed subview.
            guard !reduceMotion else {
                rotation = 0
                return
            }
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                rotation = 360
            }
        }
        .onDisappear { vm.stop() }
        // Phase 2 review fix (P1, reliability rel-1 / performance perf-1):
        // pause polling on background, resume on foreground. Without this
        // the loop hammers the backend at 3 s while the user is away.
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background, .inactive: vm.pause()
            case .active:                vm.resume()
            @unknown default:            break
            }
        }
        .onChange(of: vm.terminal) { _, terminal in
            if let t = terminal { onTerminal(t) }
        }
    }

    private var spinner: some View {
        ZStack {
            Circle()
                .stroke(KolaColors.greenLight.opacity(0.18), lineWidth: 6)
                .frame(width: 120, height: 120)
            Circle()
                .trim(from: 0, to: 0.18)
                .stroke(KolaColors.greenLight, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .frame(width: 120, height: 120)
                .rotationEffect(.degrees(rotation))
        }
        .accessibilityLabel("Verification in progress")
    }

    private var heading: some View {
        VStack(spacing: KolaSpacing.s) {
            Text("Reviewing your details")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .accessibilityAddTraits(.isHeader)
            Text("This usually takes 30 seconds.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .multilineTextAlignment(.center)
    }

    private var stepsList: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.m) {
            stepRow("Documents received", isComplete: true)
            stepRow("Identity match", isComplete: vm.pollAttempts > 1)
            stepRow("Compliance check", isComplete: false)
        }
        .padding(.horizontal, KolaSpacing.xl)
    }

    private func stepRow(_ title: String, isComplete: Bool) -> some View {
        HStack(spacing: KolaSpacing.m) {
            Image(systemName: isComplete ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(isComplete ? KolaColors.greenLight : KolaColors.whiteOnGradientMuted)
                .accessibilityHidden(true)
            Text(title)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(isComplete ? "complete" : "in progress")")
    }
}
