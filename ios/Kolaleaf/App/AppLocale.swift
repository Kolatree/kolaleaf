// AppLocale.swift  (Phase 12 · U81/U81c)
// Supported in-app language override model. The string catalog remains the
// source of copy; this type only owns persisted user preference and display.

import Foundation

public enum AppLocale: String, CaseIterable, Identifiable, Sendable {
    case system
    case english = "en"
    case yoruba = "yo"
    case igbo = "ig"
    case hausa = "ha"

    public static let storageKey = "kola.appLocale"

    public var id: String { rawValue }

    public var localeIdentifier: String? {
        switch self {
        case .system:
            return nil
        case .english, .yoruba, .igbo, .hausa:
            return rawValue
        }
    }

    public var locale: Locale {
        if let localeIdentifier {
            return Locale(identifier: localeIdentifier)
        }
        return .autoupdatingCurrent
    }

    public var displayName: String {
        switch self {
        case .system:
            return String(localized: "preferences.language.system")
        case .english:
            return "English"
        case .yoruba:
            return "Yoruba"
        case .igbo:
            return "Igbo"
        case .hausa:
            return "Hausa"
        }
    }

    public var subtitle: String {
        switch self {
        case .system:
            return String(localized: "preferences.language.system.subtitle")
        case .english:
            return "English"
        case .yoruba:
            return "Yoruba"
        case .igbo:
            return "Igbo"
        case .hausa:
            return "Hausa"
        }
    }

    public static func normalized(_ rawValue: String) -> AppLocale {
        AppLocale(rawValue: rawValue) ?? .system
    }
}
