// PreferencesView.swift  (Phase 12 · U81c)
// Account preferences surface. Starts with the locale override required for
// localization QA; more preferences can grow here without bloating AccountView.

import SwiftUI

public struct PreferencesView: View {
    @AppStorage(AppLocale.storageKey) private var selectedLocaleRaw = AppLocale.system.rawValue

    public init() {}

    public var body: some View {
        List {
            Section {
                Picker(selection: $selectedLocaleRaw) {
                    ForEach(AppLocale.allCases) { locale in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(locale.displayName)
                            Text(locale.subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .tag(locale.rawValue)
                    }
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("preferences.language.title")
                            Text(selectedLocale.displayName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "globe")
                    }
                }
                .pickerStyle(.navigationLink)
            } footer: {
                Text("preferences.language.footer")
            }
        }
        .navigationTitle("preferences.title")
    }

    private var selectedLocale: AppLocale {
        AppLocale.normalized(selectedLocaleRaw)
    }
}

#Preview {
    NavigationStack {
        PreferencesView()
    }
}
