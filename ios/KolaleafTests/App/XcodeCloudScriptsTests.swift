// XcodeCloudScriptsTests.swift  (Phase 12 · Xcode Cloud prep)
// Guards the repo-side Xcode Cloud bootstrap needed by XcodeGen.

import Foundation
import XCTest
@testable import Kolaleaf

final class XcodeCloudScriptsTests: XCTestCase {

    func test_postCloneScriptExistsAndIsExecutable() throws {
        let scriptURL = ciScriptsRoot().appendingPathComponent("ci_post_clone.sh")
        XCTAssertTrue(FileManager.default.fileExists(atPath: scriptURL.path))

        let attributes = try FileManager.default.attributesOfItem(atPath: scriptURL.path)
        let permissions = try XCTUnwrap(attributes[.posixPermissions] as? NSNumber).intValue
        XCTAssertNotEqual(permissions & 0o111, 0, "Xcode Cloud only respects the shebang when the script is executable")
    }

    func test_postCloneScriptInstallsAndRunsXcodeGen() throws {
        let script = try String(
            contentsOf: ciScriptsRoot().appendingPathComponent("ci_post_clone.sh")
        )

        XCTAssertTrue(script.hasPrefix("#!/bin/zsh"))
        XCTAssertTrue(script.contains("brew install xcodegen"))
        XCTAssertTrue(script.contains("xcodegen generate"))
        XCTAssertTrue(script.contains("set -euo pipefail"))
    }

    private func ciScriptsRoot() -> URL {
        iosRoot().appendingPathComponent("ci_scripts")
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
