// BiometricLockView.swift  (Phase 11 · Face ID unlock)
//
// Full-screen gate shown when `BiometricUnlockController.isLocked`
// is true. Auto-prompts on appear, then re-prompts on a "Try again"
// CTA. If the device has no enrolled biometrics or hardware, the
// gate degrades to a "Sign in again" path that funnels through
// `forceReauth` — never a permanent block.

import SwiftUI

public struct BiometricLockView: View {
    @Bindable private var controller: BiometricUnlockController
    private let service: any BiometricsService
    private let passcodeService: AppPasscodeService
    /// Surfaced when the user chooses "Sign out" instead of retrying
    /// the biometric prompt — e.g. their face changed, they sold the
    /// phone, etc. The host wires this to `KolaleafApp.forceReauth`.
    private let onSignOut: () -> Void

    @State private var lastResult: BiometricsResult?
    @State private var isAuthenticating: Bool = false
    @State private var isPasscodeConfigured: Bool = false
    @State private var passcode: String = ""
    @State private var passcodeError: String?
    @State private var isCheckingPasscode: Bool = false
    @FocusState private var passcodeFocused: Bool

    public init(
        controller: BiometricUnlockController,
        service: any BiometricsService,
        passcodeService: AppPasscodeService,
        onSignOut: @escaping () -> Void
    ) {
        self.controller = controller
        self.service = service
        self.passcodeService = passcodeService
        self.onSignOut = onSignOut
    }

    public var body: some View {
        ZStack(alignment: .top) {
            VStack(alignment: .center, spacing: KolaSpacing.card) {
                Spacer()
                logo
                heading
                errorBanner
                passcodeFallback
                Spacer()
                tryAgainButton
                if showSignOut {
                    signOutLink
                }
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.bottom, KolaSpacing.homeIndicator)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .kolaWallpaper()
        .sensitiveScreen()
        .task {
            isPasscodeConfigured = await passcodeService.isConfigured()
            await authenticateIfIdle()
        }
    }

    // MARK: - Subviews

    private var logo: some View {
        VStack(spacing: KolaSpacing.s) {
            Image(systemName: "faceid")
                .font(.system(size: 64, weight: .light))
                .foregroundStyle(KolaColors.whiteOnGradient)
                .accessibilityHidden(true)
            Text("Kolaleaf")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
        }
    }

    private var heading: some View {
        VStack(spacing: KolaSpacing.s) {
            Text("Locked")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
            Text("Use Face ID to unlock the app.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .multilineTextAlignment(.center)
        }
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let message = bannerMessage {
            Text(message)
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.coral)
                .multilineTextAlignment(.center)
                .padding(.horizontal, KolaSpacing.l)
                .accessibilityLabel("Error: \(message)")
        }
    }

    private var tryAgainButton: some View {
        Button {
            Task { await authenticate() }
        } label: {
            HStack(spacing: KolaSpacing.s) {
                if isAuthenticating {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                }
                Text(retryLabel)
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
            }
            .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                    .fill(KolaColors.greenLight)
            )
        }
        .disabled(isAuthenticating)
    }

    @ViewBuilder
    private var passcodeFallback: some View {
        if isPasscodeConfigured {
            VStack(alignment: .leading, spacing: KolaSpacing.s) {
                Text("App passcode")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.whiteOnGradientMuted)
                SecureField("6-digit passcode", text: $passcode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .focused($passcodeFocused)
                    .onChange(of: passcode) { _, newValue in
                        passcode = AppPasscodeService.normalized(newValue)
                        passcodeError = nil
                        if passcode.count == 6 {
                            Task { await verifyPasscode() }
                        }
                    }
                    .padding(.horizontal, KolaSpacing.m)
                    .frame(minHeight: KolaSpacing.hitTarget + 6)
                    .background(
                        RoundedRectangle(cornerRadius: KolaRadius.card, style: .continuous)
                            .fill(Color.white.opacity(0.92))
                    )
                    .foregroundStyle(KolaColors.textPrimary)
                    .disabled(isCheckingPasscode)

                if let passcodeError {
                    Text(passcodeError)
                        .font(KolaFont.tagline)
                        .foregroundStyle(KolaColors.coral)
                        .accessibilityLabel("Passcode error: \(passcodeError)")
                }
            }
            .padding(.top, KolaSpacing.m)
            .task { passcodeFocused = true }
        }
    }

    private var signOutLink: some View {
        Button(action: onSignOut) {
            Text("Sign out instead")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .underline()
        }
        .buttonStyle(.plain)
        .accessibilityHint("Sign out and return to the welcome screen")
    }

    // MARK: - Behaviour

    private var bannerMessage: String? {
        guard isPasscodeConfigured else {
            if lastResult == nil { return nil }
            return "App passcode is not set up. Sign out and sign in again to continue."
        }
        guard let lastResult else { return nil }
        switch lastResult {
        case .success:        return nil
        case .userCancel:     return "Face ID cancelled. Tap Try again to unlock."
        case .userFallback:   return "Face ID skipped. Tap Try again to unlock."
        case .authFailed:     return "Face ID didn't match. Try again."
        case .lockedOut:      return "Too many failed attempts. Sign out and back in to retry."
        case .notEnrolled:    return "Face ID isn't set up on this device. Sign out to continue without it."
        case .noHardware:     return "Face ID is disabled. Sign out to continue without it."
        case .unknownError:   return "Couldn't run Face ID. Try again or sign out."
        }
    }

    private var retryLabel: String {
        guard let lastResult else { return "Unlock" }
        if case .lockedOut = lastResult { return "Unlock" }
        return "Try again"
    }

    private var showSignOut: Bool {
        guard isPasscodeConfigured else { return lastResult != nil }
        guard let lastResult else { return false }
        switch lastResult {
        case .lockedOut, .notEnrolled, .noHardware, .unknownError:
            return true
        default:
            return false
        }
    }

    private func authenticateIfIdle() async {
        guard !isAuthenticating, lastResult == nil else { return }
        await authenticate()
    }

    private func authenticate() async {
        isAuthenticating = true
        defer { isAuthenticating = false }
        lastResult = await controller.unlock(using: service)
    }

    private func verifyPasscode() async {
        guard passcode.count == 6, !isCheckingPasscode else { return }
        isCheckingPasscode = true
        defer { isCheckingPasscode = false }
        switch await passcodeService.verify(passcode) {
        case .success:
            controller.unlockWithVerifiedPasscode()
        case .invalid:
            passcode = ""
            passcodeError = "That passcode did not match."
        case .notConfigured:
            passcode = ""
            passcodeError = "Set an app passcode from Security settings first."
            isPasscodeConfigured = false
        case .unavailable:
            passcode = ""
            passcodeError = "Couldn't check the app passcode. Try Face ID or sign out."
        }
    }
}
