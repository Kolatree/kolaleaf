// WidgetCookieIsolationTests.swift  (Phase 10C iter-1 · ADV-P10B-C9)
//
// `APIClient`'s cookie jar lives in the App Group container
// `group.com.kolaleaf.shared`. The widget extension declares the same
// App Group in its entitlements file (`KolaleafWidgets.entitlements`)
// because removing the group would force an App Store re-review of the
// entitlement profile — we keep it reserved for future shared state.
//
// That choice creates a theoretical privacy surface: a future widget
// code change could call `HTTPCookieStorage.sharedCookieStorage(
// forGroupContainerIdentifier: "group.com.kolaleaf.shared")` from
// inside the widget process and read the same session cookies the
// main app holds.
//
// This test mechanically prevents that. If any Swift source file in
// `KolaleafWidgets/` references `URLSession`, `URLRequest`,
// `HTTPCookieStorage`, or `URLSessionConfiguration`, the build fails —
// the widget cannot make HTTP calls, so even if it could read the
// cookies (which it can, today, via the App Group) it has no API to
// use them.
//
// Coupled with the comment in `APIClient.swift`, this is our ADV-C9
// mitigation: option (a) per-app-only cookie store via mechanical
// enforcement of widget purity, rather than the heavier option (b)
// per-call user-binding token.

import XCTest

final class WidgetCookieIsolationTests: XCTestCase {

    /// Symbols whose presence in widget code would create a path to
    /// read or use the session cookie. Each one is a Foundation
    /// networking entry point; without any of them the widget is a
    /// pure renderer of `KolaleafTransferAttributes.ContentState`.
    private static let forbiddenSymbols: [String] = [
        "URLSession",
        "URLRequest",
        "HTTPCookieStorage",
        "URLSessionConfiguration"
    ]

    func test_widgetTargetReferencesNoNetworkingSymbols() throws {
        let widgetDir = try Self.locateWidgetDirectory()
        let files = try Self.swiftFiles(in: widgetDir)
        XCTAssertFalse(files.isEmpty,
                       "Could not enumerate any widget Swift files under \(widgetDir.path) — test setup is broken")

        var offenders: [(file: String, symbol: String)] = []
        for url in files {
            // ADV-P10C-W2: strip line- and block-comments before
            // scanning so a future widget file with documentation like
            // `// We do NOT use URLSession here` doesn't false-positive
            // the build. The threat model cares about reachable code,
            // not prose mentioning the symbol.
            let raw = try String(contentsOf: url, encoding: .utf8)
            let code = Self.stripComments(from: raw)
            for symbol in Self.forbiddenSymbols where code.contains(symbol) {
                offenders.append((file: url.lastPathComponent, symbol: symbol))
            }
        }

        XCTAssertTrue(
            offenders.isEmpty,
            "Widget Swift files must not reference Foundation networking " +
            "symbols (ADV-P10B-C9). Offending references: " +
            offenders.map { "\($0.file) → \($0.symbol)" }.joined(separator: ", ")
        )
    }

    // MARK: - Helpers

    /// Resolve `…/ios/KolaleafWidgets/` from this file's path. `#filePath`
    /// is stable across local builds and CI because Xcode anchors test
    /// sources at their on-disk location.
    private static func locateWidgetDirectory() throws -> URL {
        // #filePath → …/ios/KolaleafTests/Security/WidgetCookieIsolationTests.swift
        // Walk up three components: Security/, KolaleafTests/, ios/anchored.
        let here = URL(fileURLWithPath: #filePath)
        let iosRoot = here
            .deletingLastPathComponent()  // Security/
            .deletingLastPathComponent()  // KolaleafTests/
            .deletingLastPathComponent()  // ios/
        let widgets = iosRoot.appendingPathComponent("KolaleafWidgets", isDirectory: true)
        guard FileManager.default.fileExists(atPath: widgets.path) else {
            throw NSError(
                domain: "WidgetCookieIsolationTests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Widget directory not found at \(widgets.path)"]
            )
        }
        return widgets
    }

    /// Strip Swift `//` line comments and `/* */` block comments
    /// (non-nested — Swift technically allows nesting but it is so
    /// rare in production code that the false-negative is acceptable).
    /// String literals containing `//` or `/*` will be over-stripped;
    /// also acceptable — a literal containing "URLSession" isn't a
    /// networking call.
    private static func stripComments(from source: String) -> String {
        var result = source
        while let range = result.range(of: #"/\*[\s\S]*?\*/"#, options: .regularExpression) {
            result.removeSubrange(range)
        }
        while let range = result.range(of: "//[^\n]*", options: .regularExpression) {
            result.removeSubrange(range)
        }
        return result
    }

    /// Enumerate every `.swift` file at any depth under `dir`.
    private static func swiftFiles(in dir: URL) throws -> [URL] {
        guard let enumerator = FileManager.default.enumerator(
            at: dir,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        var result: [URL] = []
        for case let url as URL in enumerator where url.pathExtension == "swift" {
            result.append(url)
        }
        return result
    }
}
