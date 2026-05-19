// LocalizationCatalogTests.swift  (Phase 12 · U81)
// Guards the v1 localization scaffold without pretending unreviewed
// compliance-sensitive translations are production-ready.

import XCTest

final class LocalizationCatalogTests: XCTestCase {

    func test_catalogDeclaresRequiredV1Locales() throws {
        let catalog = try loadCatalog()
        XCTAssertEqual(catalog.sourceLanguage, "en")

        for key in requiredKeys {
            let entry = try XCTUnwrap(catalog.strings[key], "Missing localization key: \(key)")
            XCTAssertEqual(Set(entry.localizations.keys), requiredLocales, key)
        }
    }

    func test_nonEnglishLocalesAreExplicitlyMarkedNeedsReview() throws {
        let catalog = try loadCatalog()
        for (key, entry) in catalog.strings {
            for locale in ["yo", "ig", "ha"] {
                let unit = try XCTUnwrap(entry.localizations[locale]?.stringUnit, "\(key) \(locale)")
                XCTAssertEqual(unit.state, "needs_review", "\(key) \(locale)")
                XCTAssertFalse(unit.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    func test_preferencesKeysHaveEnglishTranslations() throws {
        let catalog = try loadCatalog()
        for key in requiredKeys.filter({ $0.hasPrefix("preferences.") }) {
            let unit = try XCTUnwrap(catalog.strings[key]?.localizations["en"]?.stringUnit)
            XCTAssertEqual(unit.state, "translated", key)
            XCTAssertFalse(unit.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private let requiredLocales: Set<String> = ["en", "yo", "ig", "ha"]

    private let requiredKeys: [String] = [
        "Account",
        "Get started",
        "Preferences",
        "Security & 2FA",
        "Send money home with care.",
        "Send your AUD",
        "Sign out",
        "Verify your identity",
        "preferences.language.footer",
        "preferences.language.system",
        "preferences.language.system.subtitle",
        "preferences.language.title",
        "preferences.title"
    ]

    private func loadCatalog() throws -> Catalog {
        let data = try Data(contentsOf: catalogURL())
        return try JSONDecoder().decode(Catalog.self, from: data)
    }

    private func catalogURL() -> URL {
        iosRoot()
            .appendingPathComponent("Kolaleaf/Resources/Localizable.xcstrings")
    }

    private func iosRoot() -> URL {
        var url = URL(fileURLWithPath: #filePath)
        while url.path != "/" {
            let candidate = url
                .deletingLastPathComponent()
                .appendingPathComponent("project.yml")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate.deletingLastPathComponent()
            }
            url.deleteLastPathComponent()
        }
        XCTFail("Unable to locate ios/project.yml from #filePath")
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    }
}

private struct Catalog: Decodable {
    let sourceLanguage: String
    let strings: [String: CatalogEntry]
}

private struct CatalogEntry: Decodable {
    let localizations: [String: CatalogLocalization]
}

private struct CatalogLocalization: Decodable {
    let stringUnit: CatalogStringUnit
}

private struct CatalogStringUnit: Decodable {
    let state: String
    let value: String
}
