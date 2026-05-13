// SecurityMenuView.swift  (Phase 11 · slim — Face ID only)
//
// Screen 35 from the design spec. Phase 11's full surface (Face ID
// + TOTP + SMS + alert toggles + limits incentive footer) trims to
// just the Face ID toggle for this iter; the remaining rows render
// as disabled "Coming soon" rows so the IA is recognisable when the
// authenticator/2FA work lands.

import SwiftUI

public struct SecurityMenuView: View {
    @Bindable private var controller: BiometricUnlockController
    @Environment(\.dismiss) private var dismiss

    public init(controller: BiometricUnlockController) {
        self.controller = controller
    }

    public var body: some View {
        NavigationStack {
            List {
                Section("Sign-in") {
                    Toggle(isOn: $controller.faceIDUnlockEnabled) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Require Face ID to open Kolaleaf")
                                .font(KolaFont.row)
                            Text("Asks for Face ID every time you open the app.")
                                .font(KolaFont.tagline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .tint(KolaColors.greenLight)
                    .accessibilityIdentifier("security.faceIDToggle")
                }

                Section("Two-factor (coming soon)") {
                    comingSoonRow(
                        title: "Authenticator app",
                        subtitle: "Pair an authenticator like 1Password or Google Authenticator."
                    )
                    comingSoonRow(
                        title: "SMS codes",
                        subtitle: "Receive a 6-digit code by text every sign-in."
                    )
                }

                Section("Alerts (coming soon)") {
                    comingSoonRow(
                        title: "Sign-in notifications",
                        subtitle: "Get an email when your account is accessed from a new device."
                    )
                    comingSoonRow(
                        title: "Transfer notifications",
                        subtitle: "Get alerts on every successful or failed transfer."
                    )
                }
            }
            .navigationTitle("Security")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func comingSoonRow(title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                    .font(KolaFont.row)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("Coming soon")
                    .font(KolaFont.tagline)
                    .padding(.horizontal, KolaSpacing.s)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(.secondary.opacity(0.15))
                    )
                    .foregroundStyle(.secondary)
            }
            Text(subtitle)
                .font(KolaFont.tagline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
