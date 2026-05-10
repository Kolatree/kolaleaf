// AustralianStatePicker.swift  (Phase 3 · U30)
// Reusable AU state controls. The Phase 1 Registration screen had this
// inline; pulling it into its own file lets the PostKYC ConfirmAddress
// screen — and any future Recipient/KYC backfill surfaces — share the
// same picker without copy-paste.
//
// API-003 fix: previously a single `AustralianStatePicker(isReadOnly:)`
// view that branched internally between an interactive menu and a
// read-only label. That coupled the display mode (interactive vs label)
// to a business predicate ("does the user still live at the prefilled
// address?") inside a UI primitive. Now split into:
//
//   • `AustralianStatePicker(selection:)` — always interactive. Takes a
//     binding because it mutates state.
//   • `AustralianStateLabel(state:)` — read-only. Takes a value because
//     it can never mutate.
//
// Call sites pick the right view based on their own predicate
// (`vm.isAtPrefilledAddress` in ConfirmAddress).

import SwiftUI

/// Interactive AU state dropdown. Use whenever the user can change the
/// selection. For read-only display, use `AustralianStateLabel`.
public struct AustralianStatePicker: View {
    @Binding var selection: AUState

    public init(selection: Binding<AUState>) {
        self._selection = selection
    }

    public var body: some View {
        Picker("State", selection: $selection) {
            ForEach(AUState.allCases, id: \.self) { state in
                Text(state.rawValue).tag(state)
            }
        }
        .pickerStyle(.menu)
        .tint(KolaColors.greenLight)
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.vertical, KolaSpacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kolaFrosted(.card)
        .accessibilityLabel("State")
    }
}

/// Read-only AU state display. Renders the rawValue as plain text inside
/// the same frosted-card chrome the Picker uses, so swapping the two
/// controls in/out doesn't shift layout.
public struct AustralianStateLabel: View {
    public let state: AUState

    public init(state: AUState) {
        self.state = state
    }

    public var body: some View {
        Text(state.rawValue)
            .font(KolaFont.row)
            .foregroundStyle(KolaColors.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.vertical, KolaSpacing.l)
            .kolaFrosted(.card)
    }
}
