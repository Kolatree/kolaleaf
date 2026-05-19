// SecurityMenuView.swift  (Phase 11)
//
// Account-tab security surface. Phase 11 now includes the Face ID
// launch lock plus real TOTP/SMS 2FA setup, verification, backup-code
// display, backup-code rotation, and disabling 2FA.

import Observation
import SwiftUI
import UIKit

public struct SecurityMenuView: View {
    @Bindable private var controller: BiometricUnlockController
    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @State private var vm: SecurityMenuViewModel?

    public init(controller: BiometricUnlockController) {
        self.controller = controller
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let vm {
                    SecurityMenuContent(vm: vm, controller: controller)
                } else {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(KolaColors.trustGreen)
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
        .task {
            if vm == nil { vm = SecurityMenuViewModel(api: apiClient) }
            await vm?.load()
        }
    }
}

private struct SecurityMenuContent: View {
    @Bindable var vm: SecurityMenuViewModel
    @Bindable var controller: BiometricUnlockController
    @Environment(\.keychain) private var keychain
    @AppStorage(NotificationPreferenceKeys.newDeviceAlerts)
    private var newDeviceAlertsEnabled = true
    @AppStorage(NotificationPreferenceKeys.transferPushAlerts)
    private var transferPushAlertsEnabled = true
    @State private var passcodeConfigured = false
    @State private var passcodeSheet: AppPasscodeSheet?

    var body: some View {
        List {
            Section("Sign-in") {
                Toggle(isOn: faceIDToggleBinding) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Require Face ID or app passcode")
                            .font(KolaFont.row)
                        Text("Locks Kolaleaf whenever you open the app.")
                            .font(KolaFont.tagline)
                            .foregroundStyle(.secondary)
                    }
                }
                .tint(KolaColors.greenLight)
                .accessibilityIdentifier("security.faceIDToggle")

                Button {
                    passcodeSheet = .set
                } label: {
                    securityRow(
                        title: passcodeConfigured ? "Change app passcode" : "Set app passcode",
                        subtitle: passcodeConfigured
                        ? "Used when Face ID is unavailable."
                        : "Create a 6-digit fallback for app unlock.",
                        systemImage: "keyboard.badge.ellipsis"
                    )
                }

                if passcodeConfigured {
                    Button(role: .destructive) {
                        Task { await removePasscode() }
                    } label: {
                        securityRow(
                            title: "Remove app passcode",
                            subtitle: "Turns off the app lock until you set a new passcode.",
                            systemImage: "keyboard.badge.eye",
                            destructive: true
                        )
                    }
                }
            }

            twoFactorSection
            alertSection
        }
        .overlay {
            if case .loading = vm.state {
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(KolaColors.trustGreen)
            }
        }
        .task { await refreshPasscodeConfigured() }
        .refreshable { await vm.load() }
        .sheet(item: $vm.activeSheet) { sheet in
            switch sheet {
            case .totpSetup(let session):
                TotpSetupSheet(vm: vm, session: session)
            case .smsSetup(let session):
                SmsSetupSheet(vm: vm, session: session)
            case .backupCodes(let set):
                BackupCodesSheet(vm: vm, codeSet: set)
            case .verifyAction(let action):
                VerifySecurityActionSheet(vm: vm, action: action)
            }
        }
        .sheet(item: $passcodeSheet) { _ in
            AppPasscodeSetupSheet { passcode in
                try await AppPasscodeService(keychain: keychain).setPasscode(passcode)
                controller.setFaceIDUnlockEnabled(true)
                await refreshPasscodeConfigured()
            }
        }
    }

    private var faceIDToggleBinding: Binding<Bool> {
        Binding(
            get: { controller.faceIDUnlockEnabled },
            set: { enabled in
                if enabled, !passcodeConfigured {
                    passcodeSheet = .set
                    return
                }
                controller.setFaceIDUnlockEnabled(enabled)
            }
        )
    }

    private func refreshPasscodeConfigured() async {
        passcodeConfigured = await AppPasscodeService(keychain: keychain).isConfigured()
    }

    private func removePasscode() async {
        await AppPasscodeService(keychain: keychain).clear()
        controller.setFaceIDUnlockEnabled(false)
        await refreshPasscodeConfigured()
    }

    @ViewBuilder
    private var twoFactorSection: some View {
        Section("Two-factor") {
            switch vm.state {
            case .idle, .loading:
                loadingRow
            case .failed(let message):
                errorRow(message)
            case .sessionExpired:
                errorRow("Your session expired. Please sign in again.")
            case .loaded(let profile):
                if profile.method == .none {
                    Button {
                        Task { await vm.startTotpSetup() }
                    } label: {
                        securityRow(
                            title: "Authenticator app",
                            subtitle: "Use a 6-digit code from 1Password, Google Authenticator, or iCloud Keychain.",
                            systemImage: "lock.rotation"
                        )
                    }
                    .disabled(vm.isWorking)

                    Button {
                        Task { await vm.startSmsSetup() }
                    } label: {
                        securityRow(
                            title: "SMS codes",
                            subtitle: profile.smsSubtitle,
                            systemImage: "message.badge.shield.half.filled"
                        )
                    }
                    .disabled(vm.isWorking || !profile.canEnableSMS)
                } else {
                    statusRow(profile)
                    Button {
                        vm.requestBackupCodeRegeneration()
                    } label: {
                        securityRow(
                            title: "Regenerate backup codes",
                            subtitle: "Old backup codes stop working immediately.",
                            systemImage: "key.horizontal.fill"
                        )
                    }
                    .disabled(vm.isWorking)

                    Button(role: .destructive) {
                        vm.requestDisableTwoFactor()
                    } label: {
                        securityRow(
                            title: "Turn off two-factor",
                            subtitle: "Requires a current authenticator code or backup code.",
                            systemImage: "lock.open.fill",
                            destructive: true
                        )
                    }
                    .disabled(vm.isWorking)
                }

                if let error = vm.errorMessage {
                    Text(error)
                        .font(KolaFont.tagline)
                        .foregroundStyle(KolaColors.coral)
                        .accessibilityLabel("Security error: \(error)")
                }
            }
        }
    }

    private var alertSection: some View {
        Section("Alerts") {
            Toggle(isOn: $newDeviceAlertsEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("New-device sign-in alerts")
                        .font(KolaFont.row)
                    Text("Warns you when this account opens on a device we have not seen before.")
                        .font(KolaFont.tagline)
                        .foregroundStyle(.secondary)
                }
            }
            .tint(KolaColors.greenLight)

            Toggle(isOn: $transferPushAlertsEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Transfer notifications")
                        .font(KolaFont.row)
                    Text("Allows push alerts for successful, delayed, or failed transfers.")
                        .font(KolaFont.tagline)
                        .foregroundStyle(.secondary)
                }
            }
            .tint(KolaColors.greenLight)
        }
    }

    private var loadingRow: some View {
        HStack {
            ProgressView()
                .progressViewStyle(.circular)
            Text("Loading security settings")
                .font(KolaFont.row)
                .foregroundStyle(.secondary)
        }
    }

    private func errorRow(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text(message)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.coral)
            Button("Try again") {
                Task { await vm.load() }
            }
            .font(KolaFont.cta)
        }
    }

    private func statusRow(_ profile: SecurityMenuViewModel.Profile) -> some View {
        HStack(spacing: KolaSpacing.m) {
            Image(systemName: profile.method == .totp ? "lock.rotation" : "message.badge.shield.half.filled")
                .foregroundStyle(KolaColors.trustGreen)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(profile.methodLabel)
                    .font(KolaFont.row)
                Text("\(profile.backupCodesRemaining) backup codes remaining")
                    .font(KolaFont.tagline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(KolaColors.trustGreen)
        }
        .accessibilityElement(children: .combine)
    }

    private func securityRow(
        title: String,
        subtitle: String,
        systemImage: String,
        destructive: Bool = false
    ) -> some View {
        HStack(spacing: KolaSpacing.m) {
            Image(systemName: systemImage)
                .frame(width: 26)
                .foregroundStyle(destructive ? KolaColors.coral : KolaColors.trustGreen)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(KolaFont.row)
                    .foregroundStyle(destructive ? KolaColors.coral : KolaColors.textPrimary)
                Text(subtitle)
                    .font(KolaFont.tagline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }

}

private enum AppPasscodeSheet: Identifiable {
    case set

    var id: String { "set" }
}

private struct AppPasscodeSetupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var passcode = ""
    @State private var confirmPasscode = ""
    @State private var errorMessage: String?
    @State private var isSaving = false
    @FocusState private var focusedField: Field?

    let onSave: (String) async throws -> Void

    private enum Field {
        case passcode
        case confirm
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("6-digit passcode", text: $passcode)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .focused($focusedField, equals: .passcode)
                        .onChange(of: passcode) { _, newValue in
                            passcode = AppPasscodeService.normalized(newValue)
                            errorMessage = nil
                        }

                    SecureField("Confirm passcode", text: $confirmPasscode)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .focused($focusedField, equals: .confirm)
                        .onChange(of: confirmPasscode) { _, newValue in
                            confirmPasscode = AppPasscodeService.normalized(newValue)
                            errorMessage = nil
                        }
                } footer: {
                    Text("This passcode stays on this device and unlocks Kolaleaf when Face ID is unavailable.")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(KolaFont.tagline)
                            .foregroundStyle(KolaColors.coral)
                            .accessibilityLabel("Passcode error: \(errorMessage)")
                    }
                }
            }
            .navigationTitle("App passcode")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving" : "Save") {
                        Task { await save() }
                    }
                    .disabled(isSaving)
                }
            }
            .task { focusedField = .passcode }
        }
    }

    private func save() async {
        guard AppPasscodeService.isValid(passcode) else {
            errorMessage = "Enter a 6-digit passcode."
            focusedField = .passcode
            return
        }
        guard passcode == confirmPasscode else {
            errorMessage = "The passcodes do not match."
            confirmPasscode = ""
            focusedField = .confirm
            return
        }

        isSaving = true
        defer { isSaving = false }
        do {
            try await onSave(passcode)
            dismiss()
        } catch {
            errorMessage = "Couldn't save the app passcode. Please try again."
        }
    }
}

@MainActor
@Observable
public final class SecurityMenuViewModel {
    public struct Profile: Equatable, Sendable {
        public let method: TwoFactorMethodKind
        public let hasVerifiedPhone: Bool
        public let phoneMasked: String?
        public let backupCodesRemaining: Int

        public var methodLabel: String {
            switch method {
            case .none: return "Two-factor is off"
            case .totp: return "Authenticator app enabled"
            case .sms: return "SMS codes enabled"
            }
        }

        public var canEnableSMS: Bool { hasVerifiedPhone }

        public var smsSubtitle: String {
            if let phoneMasked, hasVerifiedPhone {
                return "Send sign-in codes to \(phoneMasked)."
            }
            return "Verify a phone number before enabling SMS codes."
        }
    }

    public enum State: Equatable {
        case idle
        case loading
        case loaded(Profile)
        case sessionExpired
        case failed(String)
    }

    public private(set) var state: State = .idle
    public private(set) var isWorking = false
    public var errorMessage: String?
    public var activeSheet: SecuritySheet?

    private let api: AuthAPI

    public init(api: AuthAPI) {
        self.api = api
    }

    public func load() async {
        state = .loading
        errorMessage = nil

        let result = await api.send(AccountEndpoints.Me())
        switch result {
        case .success(let me):
            state = .loaded(Self.profile(from: me))
        case .failure(let error):
            if error == .unauthorized {
                state = .sessionExpired
            } else {
                state = .failed(APIErrorPresenter.userFacingMessage(
                    for: error,
                    fallback: "Couldn't load security settings."
                ))
            }
        }
    }

    public func startTotpSetup() async {
        await perform {
            let result = await api.send(AccountEndpoints.SetupTwoFactor(method: .totp))
            switch result {
            case .success(let response):
                guard response.method == .totp,
                      let secret = response.secret,
                      let uri = response.otpauthUri else {
                    errorMessage = "Authenticator setup did not return a valid QR code."
                    return
                }
                activeSheet = .totpSetup(TotpSetupSession(secret: secret, otpauthUri: uri))
            case .failure(let error):
                errorMessage = message(for: error)
            }
        }
    }

    public func enableTotp(session: TotpSetupSession, code: String) async {
        let trimmed = Self.trimmed(code)
        guard !trimmed.isEmpty else {
            errorMessage = "Enter the 6-digit code from your authenticator app."
            return
        }

        await perform {
            let body = EnableTwoFactorBody(method: .totp, secret: session.secret, code: trimmed)
            let result = await api.send(AccountEndpoints.EnableTwoFactor(body))
            switch result {
            case .success(let response):
                applyEnabled(method: .totp, backupCount: response.backupCodes.count)
                activeSheet = .backupCodes(BackupCodeSet(codes: response.backupCodes, context: .enabled))
            case .failure(let error):
                errorMessage = message(for: error)
            }
        }
    }

    public func startSmsSetup() async {
        guard currentProfile?.canEnableSMS == true else {
            errorMessage = "Verify a phone number before enabling SMS codes."
            return
        }

        await perform {
            let result = await api.send(AccountEndpoints.SetupTwoFactor(method: .sms))
            switch result {
            case .success(let response):
                guard response.method == .sms, let challengeId = response.challengeId else {
                    errorMessage = "SMS setup did not return a challenge."
                    return
                }
                activeSheet = .smsSetup(SmsSetupSession(
                    challengeId: challengeId,
                    phoneMasked: currentProfile?.phoneMasked
                ))
            case .failure(let error):
                errorMessage = message(for: error)
            }
        }
    }

    public func enableSms(session: SmsSetupSession, code: String) async {
        let trimmed = Self.trimmed(code)
        guard !trimmed.isEmpty else {
            errorMessage = "Enter the SMS code."
            return
        }

        await perform {
            let body = EnableTwoFactorBody(method: .sms, challengeId: session.challengeId, code: trimmed)
            let result = await api.send(AccountEndpoints.EnableTwoFactor(body))
            switch result {
            case .success(let response):
                applyEnabled(method: .sms, backupCount: response.backupCodes.count)
                activeSheet = .backupCodes(BackupCodeSet(codes: response.backupCodes, context: .enabled))
            case .failure(let error):
                errorMessage = message(for: error)
            }
        }
    }

    public func requestBackupCodeRegeneration() {
        guard let profile = currentProfile, profile.method != .none else { return }
        errorMessage = nil
        activeSheet = .verifyAction(SecurityVerificationAction(kind: .regenerateBackupCodes, method: profile.method))
    }

    public func requestDisableTwoFactor() {
        guard let profile = currentProfile, profile.method != .none else { return }
        errorMessage = nil
        activeSheet = .verifyAction(SecurityVerificationAction(kind: .disableTwoFactor, method: profile.method))
    }

    public func confirm(action: SecurityVerificationAction, code: String) async {
        let trimmed = Self.trimmed(code)
        guard !trimmed.isEmpty else {
            errorMessage = "Enter a current code or backup code."
            return
        }

        await perform {
            switch action.kind {
            case .regenerateBackupCodes:
                let result = await api.send(AccountEndpoints.RegenerateBackupCodes(
                    VerifyTwoFactorBody(code: trimmed)
                ))
                switch result {
                case .success(let response):
                    applyBackupCount(response.backupCodes.count)
                    activeSheet = .backupCodes(BackupCodeSet(codes: response.backupCodes, context: .regenerated))
                case .failure(let error):
                    errorMessage = message(for: error)
                }
            case .disableTwoFactor:
                let result = await api.send(AccountEndpoints.DisableTwoFactor(
                    VerifyTwoFactorBody(code: trimmed)
                ))
                switch result {
                case .success:
                    applyDisabled()
                    activeSheet = nil
                case .failure(let error):
                    errorMessage = message(for: error)
                }
            }
        }
    }

    public func dismissSheet() {
        activeSheet = nil
        errorMessage = nil
    }

    private var currentProfile: Profile? {
        if case .loaded(let profile) = state { return profile }
        return nil
    }

    private func perform(_ operation: () async -> Void) async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        await operation()
    }

    private static func profile(from me: MeResponse) -> Profile {
        let method = TwoFactorMethodKind(rawValue: me.twoFactorMethod ?? "NONE") ?? .none
        return Profile(
            method: method,
            hasVerifiedPhone: me.hasVerifiedPhone,
            phoneMasked: me.phoneMasked,
            backupCodesRemaining: me.backupCodesRemaining
        )
    }

    private func applyEnabled(method: TwoFactorMethodKind, backupCount: Int) {
        let profile = currentProfile
        state = .loaded(Profile(
            method: method,
            hasVerifiedPhone: profile?.hasVerifiedPhone ?? false,
            phoneMasked: profile?.phoneMasked,
            backupCodesRemaining: backupCount
        ))
    }

    private func applyBackupCount(_ count: Int) {
        guard let profile = currentProfile else { return }
        state = .loaded(Profile(
            method: profile.method,
            hasVerifiedPhone: profile.hasVerifiedPhone,
            phoneMasked: profile.phoneMasked,
            backupCodesRemaining: count
        ))
    }

    private func applyDisabled() {
        guard let profile = currentProfile else { return }
        state = .loaded(Profile(
            method: .none,
            hasVerifiedPhone: profile.hasVerifiedPhone,
            phoneMasked: profile.phoneMasked,
            backupCodesRemaining: 0
        ))
    }

    private func message(for error: APIError) -> String {
        APIErrorPresenter.userFacingMessage(for: error, fallback: "Security change failed.")
    }

    private static func trimmed(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public enum SecuritySheet: Identifiable, Equatable {
    case totpSetup(TotpSetupSession)
    case smsSetup(SmsSetupSession)
    case backupCodes(BackupCodeSet)
    case verifyAction(SecurityVerificationAction)

    public var id: String {
        switch self {
        case .totpSetup: return "totpSetup"
        case .smsSetup: return "smsSetup"
        case .backupCodes(let set): return "backupCodes-\(set.id)"
        case .verifyAction(let action): return "verify-\(action.kind.rawValue)"
        }
    }
}

public struct TotpSetupSession: Equatable, Sendable {
    public let secret: String
    public let otpauthUri: String
}

public struct SmsSetupSession: Equatable, Sendable {
    public let challengeId: String
    public let phoneMasked: String?
}

public struct BackupCodeSet: Identifiable, Equatable, Sendable {
    public enum Context: String, Sendable {
        case enabled
        case regenerated
    }

    public let id = UUID()
    public let codes: [String]
    public let context: Context
}

public struct SecurityVerificationAction: Equatable, Sendable {
    public enum Kind: String, Sendable {
        case regenerateBackupCodes
        case disableTwoFactor
    }

    public let kind: Kind
    public let method: TwoFactorMethodKind
}

private struct TotpSetupSheet: View {
    @Bindable var vm: SecurityMenuViewModel
    let session: TotpSetupSession
    @State private var code = ""
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KolaSpacing.card) {
                    Text("Scan this QR code with your authenticator app, then enter the 6-digit code it shows.")
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.textSecondary)

                    if let image = QRCodeRenderer.image(for: session.otpauthUri) {
                        Image(uiImage: image)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: 240)
                            .frame(maxWidth: .infinity)
                            .accessibilityLabel("Authenticator setup QR code")
                    }

                    VStack(alignment: .leading, spacing: KolaSpacing.s) {
                        Text("Setup key")
                            .font(KolaFont.tagline)
                            .foregroundStyle(.secondary)
                        Text(session.secret)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                            .privacySensitive()
                        Button(copied ? "Copied" : "Copy setup key") {
                            copy(session.secret)
                            copied = true
                        }
                        .font(KolaFont.cta)
                    }

                    verificationField(placeholder: "123456")

                    if let error = vm.errorMessage {
                        Text(error)
                            .font(KolaFont.tagline)
                            .foregroundStyle(KolaColors.coral)
                    }
                }
                .padding(KolaSpacing.xl)
            }
            .navigationTitle("Authenticator app")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { vm.dismissSheet() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await vm.enableTotp(session: session, code: code) }
                    } label: {
                        if vm.isWorking {
                            ProgressView()
                                .progressViewStyle(.circular)
                        } else {
                            Text("Enable")
                        }
                    }
                    .disabled(vm.isWorking || code.isEmpty)
                }
            }
        }
        .sensitiveScreen()
    }

    private func verificationField(placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Verification code")
                .font(KolaFont.tagline)
                .foregroundStyle(.secondary)
            TextField(placeholder, text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(KolaFont.row)
                .padding(KolaSpacing.m)
                .background(RoundedRectangle(cornerRadius: KolaRadius.card).fill(KolaColors.surfaceSoft))
                .privacySensitive()
        }
    }
}

private struct SmsSetupSheet: View {
    @Bindable var vm: SecurityMenuViewModel
    let session: SmsSetupSession
    @State private var code = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: KolaSpacing.card) {
                Text(session.phoneMasked.map { "Enter the SMS code sent to \($0)." } ?? "Enter the SMS code we sent.")
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.textSecondary)
                TextField("123456", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .font(KolaFont.row)
                    .padding(KolaSpacing.m)
                    .background(RoundedRectangle(cornerRadius: KolaRadius.card).fill(KolaColors.surfaceSoft))
                    .privacySensitive()
                if let error = vm.errorMessage {
                    Text(error)
                        .font(KolaFont.tagline)
                        .foregroundStyle(KolaColors.coral)
                }
                Spacer()
            }
            .padding(KolaSpacing.xl)
            .navigationTitle("SMS codes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { vm.dismissSheet() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Enable") {
                        Task { await vm.enableSms(session: session, code: code) }
                    }
                    .disabled(vm.isWorking || code.isEmpty)
                }
            }
        }
        .sensitiveScreen()
    }
}

private struct BackupCodesSheet: View {
    @Bindable var vm: SecurityMenuViewModel
    let codeSet: BackupCodeSet
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KolaSpacing.card) {
                    Text(title)
                        .font(KolaFont.section)
                    Text("Save these somewhere private. Each backup code works once if you lose access to your authenticator or phone.")
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.textSecondary)

                    VStack(alignment: .leading, spacing: KolaSpacing.s) {
                        ForEach(codeSet.codes, id: \.self) { code in
                            Text(code)
                                .font(.system(.body, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 2)
                        }
                    }
                    .padding(KolaSpacing.m)
                    .background(RoundedRectangle(cornerRadius: KolaRadius.card).fill(KolaColors.surfaceSoft))
                    .privacySensitive()

                    Button(copied ? "Copied" : "Copy backup codes") {
                        copy(codeSet.codes.joined(separator: "\n"))
                        copied = true
                    }
                    .font(KolaFont.cta)
                }
                .padding(KolaSpacing.xl)
            }
            .navigationTitle("Backup codes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { vm.dismissSheet() }
                }
            }
        }
        .sensitiveScreen()
    }

    private var title: String {
        switch codeSet.context {
        case .enabled: return "Two-factor is enabled"
        case .regenerated: return "New backup codes"
        }
    }
}

private struct VerifySecurityActionSheet: View {
    @Bindable var vm: SecurityMenuViewModel
    let action: SecurityVerificationAction
    @State private var code = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: KolaSpacing.card) {
                Text(prompt)
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.textSecondary)
                TextField("Code or backup code", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .textContentType(.oneTimeCode)
                    .font(KolaFont.row)
                    .padding(KolaSpacing.m)
                    .background(RoundedRectangle(cornerRadius: KolaRadius.card).fill(KolaColors.surfaceSoft))
                    .privacySensitive()

                if let error = vm.errorMessage {
                    Text(error)
                        .font(KolaFont.tagline)
                        .foregroundStyle(KolaColors.coral)
                }
                Spacer()
            }
            .padding(KolaSpacing.xl)
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { vm.dismissSheet() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action.kind == .disableTwoFactor ? "Turn off" : "Continue") {
                        Task { await vm.confirm(action: action, code: code) }
                    }
                    .disabled(vm.isWorking || code.isEmpty)
                }
            }
        }
        .sensitiveScreen()
    }

    private var navTitle: String {
        switch action.kind {
        case .regenerateBackupCodes: return "Regenerate codes"
        case .disableTwoFactor: return "Turn off 2FA"
        }
    }

    private var prompt: String {
        switch action.method {
        case .totp:
            return "Enter a current authenticator code or any unused backup code."
        case .sms:
            return "Enter any unused backup code. SMS challenge changes are not used for this action."
        case .none:
            return "Enter a verification code."
        }
    }
}

@MainActor
private func copy(_ value: String) {
    UIPasteboard.general.setItems(
        [[UIPasteboard.typeAutomatic: value]],
        options: [
            .localOnly: true,
            .expirationDate: Date().addingTimeInterval(120),
        ]
    )
}
