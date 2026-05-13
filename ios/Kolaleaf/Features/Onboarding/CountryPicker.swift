// CountryPicker.swift  (Phase 11A-4 · phone-first onboarding)
//
// Modal-sheet picker over CountryDialCodes.supported. Used by
// PhoneEntryView (and later SignInView) to let the user pick the
// dial code prefix before typing their local number.
//
// Layout: search-free list — Wave 1 ships ~6 countries so a flat
// list is the right ergonomic. When the curated list grows past a
// dozen, swap to .searchable.

import SwiftUI

public struct CountryPicker: View {
    @Binding private var selection: CountryDialCode
    @Environment(\.dismiss) private var dismiss

    public init(selection: Binding<CountryDialCode>) {
        self._selection = selection
    }

    public var body: some View {
        NavigationStack {
            List(CountryDialCodes.supported) { country in
                Button {
                    selection = country
                    dismiss()
                } label: {
                    HStack(spacing: KolaSpacing.m) {
                        Text(country.flag)
                            .font(.system(size: 26))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(country.name)
                                .font(KolaFont.row)
                                .foregroundStyle(.primary)
                            Text(country.dialCode)
                                .font(KolaFont.tagline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if country.id == selection.id {
                            Image(systemName: "checkmark")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(KolaColors.greenLight)
                                .accessibilityLabel("Selected")
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .navigationTitle("Country code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
