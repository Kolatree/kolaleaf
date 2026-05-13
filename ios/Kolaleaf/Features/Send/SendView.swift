// SendView.swift  (Phase 6 · U46 + U47 → iter-2)
// Assembled Send screen. Composes:
//   • RecipientChip + RecipientPickerSheet (U42) — top of screen
//   • amount stack (large display + NGN preview + rate footer) — middle
//   • FrostedNumpad (U41) — keypad
//   • SlidePill (U43 + U44) — bottom, fires Face ID + transfer create
//
// Iter-2 closes:
//   • C6 / ADV-P6-C4 — navigation forward via consumeLastCreated().
//   • W5 / CA-001 — navigation payload is the Domain `Transfer`.
//   • W15 / API-006 — bind(appState:) is retained internally by the
//     view-model but call-sites no longer hand-roll the call.
//   • W21 / ADV-P6-W4 — `.sessionExpired` triggers onSessionExpired.

import SwiftUI

public struct SendView: View {

    @Environment(AppState.self) private var appState
    @State private var vm: SendViewModel
    @State private var pickerOpen: Bool = false

    private let recipients: [Recipient]
    private let initialRecipient: Recipient?
    private let onAddRecipient: () -> Void
    private let onCreated: (Transfer) -> Void
    private let onSessionExpired: () -> Void

    public init(
        recipients: [Recipient],
        initialRecipient: Recipient?,
        api: AuthAPI,
        biometrics: BiometricsService = LABiometricsService(),
        prefill: SendPrefill? = nil,
        onAddRecipient: @escaping () -> Void,
        onCreated: @escaping (Transfer) -> Void,
        onSessionExpired: @escaping () -> Void = {}
    ) {
        // Phase 9 · U63: when an expired-transfer re-quote arrives,
        // honour the prefill — pick the matching recipient out of the
        // list and seed the AmountStore with the original AUD amount
        // (rounded to whole cents). Falls back to `initialRecipient`
        // when the prefilled recipient id isn't in the list (e.g.
        // deleted between the original send and the re-quote).
        let resolvedRecipient: Recipient? = {
            if let prefill,
               let match = recipients.first(where: { $0.id == prefill.recipientId }) {
                return match
            }
            return initialRecipient
        }()
        self.recipients = recipients
        self.initialRecipient = resolvedRecipient
        self.onAddRecipient = onAddRecipient
        self.onCreated = onCreated
        self.onSessionExpired = onSessionExpired
        let amountStore: AmountStore = {
            guard let prefill else { return AmountStore() }
            // SendPrefill carries cents directly (B2 / OO-902 / API-902);
            // the producer (ExpiredTransferViewModel) does the
            // Decimal→Int conversion at the boundary.
            return AmountStore(cents: prefill.cents)
        }()
        let model = SendViewModel(
            api: api,
            biometrics: biometrics,
            amountStore: amountStore
        )
        model.selectedRecipient = resolvedRecipient
        _vm = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: KolaSpacing.l) {
            recipientHeader
            amountStack
            Spacer(minLength: KolaSpacing.s)
            FrostedNumpad { key in
                handle(key: key)
            }
            slidePill
            errorBanner
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.l)
        .padding(.bottom, KolaSpacing.homeIndicator)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KolaColors.surface.ignoresSafeArea())
        .task {
            vm.bind(appState: appState)
            if vm.selectedRecipient == nil {
                vm.selectedRecipient = initialRecipient
            }
            await vm.loadRate()
        }
        .sheet(isPresented: $pickerOpen) {
            RecipientPickerSheet(
                recipients: recipients,
                selectedRecipientId: vm.selectedRecipient?.id,
                onSelect: { vm.selectedRecipient = $0 },
                onAddNew: onAddRecipient
            )
            .presentationDetents([.large])
        }
        // C6 / ADV-P6-C4: pull the transfer through the consume gate
        // on the in-flight → idle edge.
        .onChange(of: vm.isSubmittingTransfer) { _, nowSubmitting in
            guard !nowSubmitting else { return }
            if let transfer = vm.consumeLastCreated() {
                onCreated(transfer)
            }
        }
        .onChange(of: vm.lastError == .sessionExpired) { _, expired in
            if expired { onSessionExpired() }
        }
    }

    // MARK: - Sub-views

    @ViewBuilder
    private var recipientHeader: some View {
        if let recipient = vm.selectedRecipient {
            RecipientChip(recipient: recipient) {
                pickerOpen = true
            }
        } else {
            Button(action: { pickerOpen = true }) {
                Text("Pick a recipient")
                    .font(KolaFont.rowValue)
                    .foregroundStyle(KolaColors.trustGreen)
                    .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
                    .background(
                        RoundedRectangle(cornerRadius: KolaRadius.pill, style: .continuous)
                            .strokeBorder(KolaColors.trustGreen, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Pick a recipient")
        }
    }

    private var amountStack: some View {
        VStack(spacing: KolaSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: KolaSpacing.xs) {
                Text("$")
                    .font(KolaFont.amountLarge)
                    .foregroundStyle(KolaColors.textSecondary)
                Text(vm.amountStore.displayString)
                    .font(KolaFont.amountLarge)
                    .kerning(KolaKerning.amount)
                    .foregroundStyle(KolaColors.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
            }
            rateLine
            ngnPreviewLine
            if vm.isRateStale && vm.rateEffectiveAt != nil {
                staleRateBanner
            }
        }
    }

    @ViewBuilder
    private var rateLine: some View {
        if let rate = vm.customerRate {
            Text("1 AUD = \(Self.formatRate(rate)) NGN")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        } else if vm.isLoadingRateInFlight {
            Text("Loading rate…")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
    }

    @ViewBuilder
    private var ngnPreviewLine: some View {
        if let ngn = vm.ngnPreview {
            Text("≈ \(Self.formatNGN(ngn)) NGN")
                .font(KolaFont.ngnAccent)
                .foregroundStyle(KolaColors.trustGreen)
        } else {
            Text(" ")
                .font(KolaFont.ngnAccent)
        }
    }

    private var staleRateBanner: some View {
        Button(action: { Task { await vm.loadRate() } }) {
            HStack(spacing: KolaSpacing.s) {
                Image(systemName: "exclamationmark.triangle.fill")
                Text("Rate is out of date. Tap to refresh.")
                    .font(KolaFont.tagline)
            }
            .foregroundStyle(KolaColors.warning)
            .padding(.horizontal, KolaSpacing.m)
            .padding(.vertical, KolaSpacing.s)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.chip, style: .continuous)
                    .fill(KolaColors.warning.opacity(0.10))
            )
        }
        .buttonStyle(.plain)
        .accessibilityHint("Reloads the latest exchange rate")
    }

    private var slidePill: some View {
        SlidePill(
            isEnabled: vm.canSubmit,
            onConfirm: {
                Task { await vm.confirmAndSubmit() }
            }
        )
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let err = vm.lastError {
            VStack(spacing: KolaSpacing.xs) {
                Text(err.message)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .multilineTextAlignment(.center)
                if err == .sessionExpired || err == .biometricsLockedOut {
                    Button("Sign in again") { onSessionExpired() }
                        .font(KolaFont.cta)
                        .foregroundStyle(KolaColors.trustGreen)
                }
            }
            .padding(.horizontal, KolaSpacing.m)
            .padding(.vertical, KolaSpacing.s)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.chip, style: .continuous)
                    .fill(KolaColors.coral.opacity(0.08))
            )
            .accessibilityIdentifier("send.error")
        }
    }

    // MARK: - Handlers

    private func handle(key: NumpadKey) {
        switch key {
        case .digit(let d): vm.amountStore.append(d)
        case .delete:        vm.amountStore.delete()
        }
    }

    // MARK: - Formatting

    private static func formatRate(_ d: Decimal) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 2
        f.minimumFractionDigits = 2
        f.locale = Locale(identifier: "en_AU")
        return f.string(from: NSDecimalNumber(decimal: d)) ?? "\(d)"
    }

    private static func formatNGN(_ d: Decimal) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.locale = Locale(identifier: "en_NG")
        return f.string(from: NSDecimalNumber(decimal: d)) ?? "\(d)"
    }
}
