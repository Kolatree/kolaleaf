// LaunchAssetsTests.swift  (Phase 12 · app icon / launch)
// Source-level checks for App Store-facing launch and icon assets.

import UIKit
import XCTest
@testable import Kolaleaf

final class LaunchAssetsTests: XCTestCase {

    func test_projectWiresLogoIntoLaunchScreen() throws {
        let projectYAML = try String(contentsOf: iosRoot().appendingPathComponent("project.yml"))

        XCTAssertTrue(projectYAML.contains("UILaunchScreen:"))
        XCTAssertTrue(projectYAML.contains("UIColorName: launchBackground"))
        XCTAssertTrue(projectYAML.contains("UIImageName: LogoPrimary"))
        XCTAssertTrue(projectYAML.contains("UIImageRespectsSafeAreaInsets: true"))
    }

    func test_appIconIsMarketingSizeSquarePNG() throws {
        let iconURL = assetCatalogRoot()
            .appendingPathComponent("AppIcon.appiconset/AppIcon-1024.png")
        let image = try XCTUnwrap(UIImage(contentsOfFile: iconURL.path))
        let cgImage = try XCTUnwrap(image.cgImage)

        XCTAssertEqual(cgImage.width, 1024)
        XCTAssertEqual(cgImage.height, 1024)
    }

    func test_logoPrimaryIsPreservedVectorAsset() throws {
        let contents = try assetContents("LogoPrimary.imageset")

        let images = try XCTUnwrap(contents["images"] as? [[String: Any]])
        XCTAssertEqual(images.first?["filename"] as? String, "logoprimary.svg")

        let properties = try XCTUnwrap(contents["properties"] as? [String: Any])
        XCTAssertEqual(properties["preserves-vector-representation"] as? Bool, true)
    }

    func test_launchBackgroundMatchesCreamToken() throws {
        let contents = try assetContents("launchBackground.colorset")
        let colors = try XCTUnwrap(contents["colors"] as? [[String: Any]])
        let color = try XCTUnwrap(colors.first?["color"] as? [String: Any])
        let components = try XCTUnwrap(color["components"] as? [String: String])

        XCTAssertEqual(components["red"], "1.000")
        XCTAssertEqual(components["green"], "0.973")
        XCTAssertEqual(components["blue"], "0.937")
        XCTAssertEqual(components["alpha"], "1.000")
    }

    private func assetContents(_ name: String) throws -> [String: Any] {
        let url = assetCatalogRoot()
            .appendingPathComponent(name)
            .appendingPathComponent("Contents.json")
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func assetCatalogRoot() -> URL {
        iosRoot()
            .appendingPathComponent("Kolaleaf/Resources/Assets.xcassets")
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
