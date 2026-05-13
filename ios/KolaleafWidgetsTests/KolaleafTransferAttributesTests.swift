// KolaleafTransferAttributesTests.swift  (Phase 10A · U66)
// Round-trip Codable + decode-with-defaults guards on the
// ActivityKit attributes shared between the app and the widget.
//
// These tests run in the WIDGET test target so the same import
// boundary the live-activity push pipeline uses is exercised.
//
// iter-2 hardening (ADV-P10A-C4/C5, API-1001, ADV-P10A-W1/W6, S1, S4,
// API-1003): adds tolerant-decode coverage for unknown states, the
// schema-version field, negative etaSeconds, ISO-8601 dates, the
// stageLabel cap, the legacy "failed" rawValue mapping, and a
// parameterised descriptor smoke test across all cases.

// Widget sources are compiled directly into this test bundle (see project.yml),
// so the symbols are addressable without `@testable import KolaleafWidgets`.
import XCTest
import SwiftUI

final class KolaleafTransferAttributesTests: XCTestCase {

    // MARK: - ContentState round-trip

    func test_contentState_roundTripsThroughJSON() throws {
        let original = KolaleafTransferAttributes.ContentState(
            state: .processingNGN,
            etaSeconds: 240,
            lastUpdate: Date(timeIntervalSince1970: 1_700_000_000),
            stageLabel: "Confirming AUD…"
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(
            KolaleafTransferAttributes.ContentState.self,
            from: data
        )
        XCTAssertEqual(decoded, original)
    }

    /// A push payload that omits `stageLabel` (e.g. an early server build)
    /// MUST decode without throwing — the field defaults to an empty string.
    /// This guards push-driven updates against breaking the widget.
    func test_contentState_decodes_whenStageLabelMissing_defaultsToEmpty() throws {
        let json = """
        {
          "state": "awaiting_aud",
          "etaSeconds": 540,
          "lastUpdate": "2023-11-14T22:13:20Z"
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(
            KolaleafTransferAttributes.ContentState.self,
            from: json
        )
        XCTAssertEqual(decoded.state, .awaitingAUD)
        XCTAssertEqual(decoded.etaSeconds, 540)
        XCTAssertEqual(decoded.stageLabel, "")
    }

    // MARK: - Wire-evolution tolerant decode (iter-2)

    /// A push payload carrying a `state` value the shipped widget binary
    /// does not recognise MUST decode as `.unknown` rather than throw,
    /// so a future backend band can't brick live activities in the wild.
    func test_contentState_decodes_unknownState_asDotUnknown() throws {
        let json = """
        {
          "state": "future_case",
          "etaSeconds": 0,
          "lastUpdate": "2023-11-14T22:13:20Z"
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(
            KolaleafTransferAttributes.ContentState.self,
            from: json
        )
        XCTAssertEqual(decoded.state, .unknown)
    }

    /// lastUpdate is pinned to ISO-8601 string on the wire — encode/decode
    /// must agree on that strategy.
    func test_contentState_decodes_lastUpdate_asISO8601String() throws {
        let json = """
        {
          "state": "processing_ngn",
          "etaSeconds": 30,
          "lastUpdate": "2023-11-14T22:13:20Z",
          "stageLabel": "x"
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(
            KolaleafTransferAttributes.ContentState.self,
            from: json
        )
        XCTAssertEqual(decoded.lastUpdate, Date(timeIntervalSince1970: 1_700_000_000))
        // Round-trip back through encode to confirm the ISO-8601 string survives.
        let reencoded = try JSONEncoder().encode(decoded)
        let s = String(data: reencoded, encoding: .utf8) ?? ""
        XCTAssertTrue(s.contains("2023-11-14T22:13:20Z"), "encoded form should hold ISO-8601 string, got: \(s)")
    }

    /// Negative `etaSeconds` (server clock skew or a busted job) clamps to 0
    /// at the decode boundary — the widget never renders a negative timer.
    func test_contentState_decodes_negativeEtaSeconds_asZero() throws {
        let json = """
        {
          "state": "awaiting_aud",
          "etaSeconds": -3600,
          "lastUpdate": "2023-11-14T22:13:20Z"
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(
            KolaleafTransferAttributes.ContentState.self,
            from: json
        )
        XCTAssertEqual(decoded.etaSeconds, 0)
    }

    /// A payload without `v` (schema version) decodes with v == 1.
    func test_contentState_decodes_missingV_asOne() throws {
        let json = """
        {
          "state": "awaiting_aud",
          "etaSeconds": 60,
          "lastUpdate": "2023-11-14T22:13:20Z"
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(
            KolaleafTransferAttributes.ContentState.self,
            from: json
        )
        XCTAssertEqual(decoded.v, 1)
    }

    /// The legacy "failed" rawValue maps to `.failedRetry` for the
    /// API-1003 split — older backend builds keep working.
    func test_contentState_decodes_legacyFailed_asFailedRetry() throws {
        let json = """
        {
          "state": "failed",
          "etaSeconds": 0,
          "lastUpdate": "2023-11-14T22:13:20Z"
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(
            KolaleafTransferAttributes.ContentState.self,
            from: json
        )
        XCTAssertEqual(decoded.state, .failedRetry)
    }

    /// A verbose `stageLabel` clamps to the first 48 characters so a
    /// future server-side message can't push the amount column off
    /// the compact lock-screen layout.
    func test_contentState_clampsStageLabel_to48Chars() throws {
        let long = String(repeating: "x", count: 200)
        let json = """
        {
          "state": "processing_ngn",
          "etaSeconds": 30,
          "lastUpdate": "2023-11-14T22:13:20Z",
          "stageLabel": "\(long)"
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(
            KolaleafTransferAttributes.ContentState.self,
            from: json
        )
        XCTAssertEqual(decoded.stageLabel.count, 48)
    }

    // MARK: - LiveActivityState wire format

    /// The wire string for each band is part of the contract with the
    /// backend's APNS payload. Lock the snake_case mapping.
    func test_liveActivityState_rawValues_areStable() {
        XCTAssertEqual(LiveActivityState.awaitingAUD.rawValue,    "awaiting_aud")
        XCTAssertEqual(LiveActivityState.processingNGN.rawValue,  "processing_ngn")
        XCTAssertEqual(LiveActivityState.completed.rawValue,      "completed")
        XCTAssertEqual(LiveActivityState.floatPaused.rawValue,    "float_paused")
        XCTAssertEqual(LiveActivityState.failedRetry.rawValue,    "failed_retry")
        XCTAssertEqual(LiveActivityState.needsAction.rawValue,    "needs_action")
        XCTAssertEqual(LiveActivityState.unknown.rawValue,        "_unknown")
    }

    /// ADV-P10A-S4: every case must resolve to a non-empty descriptor.
    /// Acts as a backstop against forgetting a switch arm when adding
    /// a new state.
    @MainActor
    func test_liveActivityState_allCasesHaveDescriptor() {
        for state in LiveActivityState.allCases {
            let desc = LiveActivityStyle.descriptor(for: state, recipientName: "Test")
            XCTAssertFalse(desc.headline.isEmpty, "headline empty for \(state)")
            XCTAssertFalse(desc.glyph.isEmpty,    "glyph empty for \(state)")
        }
    }

    // MARK: - Static attributes

    func test_attributes_initialiserAssignsAllFields() {
        let attrs = KolaleafTransferAttributes(
            transferId: "tx_123",
            recipientName: "Folasade",
            recipientCurrency: "NGN",
            audAmount: "$100.00 AUD",
            ngnAmount: "₦70,000 NGN",
            exchangeRate: "1 AUD = 700 NGN"
        )
        XCTAssertEqual(attrs.transferId,        "tx_123")
        XCTAssertEqual(attrs.recipientName,     "Folasade")
        XCTAssertEqual(attrs.recipientCurrency, "NGN")
        XCTAssertEqual(attrs.audAmount,         "$100.00 AUD")
        XCTAssertEqual(attrs.ngnAmount,         "₦70,000 NGN")
        XCTAssertEqual(attrs.exchangeRate,      "1 AUD = 700 NGN")
    }

    // MARK: - Lock-screen privacy redaction (Phase 11.5 · U7c)

    func test_lockScreenPrivacy_redactsWhenEnvironmentRequestsRedaction() {
        XCTAssertTrue(LockScreenPrivacy.shouldRedact(
            redactionReasons: .placeholder,
            isLuminanceReduced: false
        ))
    }

    func test_lockScreenPrivacy_redactsWhenLuminanceReduced() {
        XCTAssertTrue(LockScreenPrivacy.shouldRedact(
            redactionReasons: [],
            isLuminanceReduced: true
        ))
    }

    func test_lockScreenPrivacy_doesNotRedactWithoutPrivacySignals() {
        XCTAssertFalse(LockScreenPrivacy.shouldRedact(
            redactionReasons: [],
            isLuminanceReduced: false
        ))
    }

    func test_redactedAccessibilityCopy_excludesAmountsAndRecipient() {
        let label = LockScreenRedactedCopy.accessibilityLabel(
            state: .processingNGN,
            etaSeconds: 240
        )

        XCTAssertTrue(label.contains("Transfer in progress"))
        XCTAssertFalse(label.contains("$100"))
        XCTAssertFalse(label.contains("NGN"))
        XCTAssertFalse(label.contains("Folasade"))
    }

    func test_redactedAccessibilityCopy_usesFallbackWhenEtaUnavailable() {
        let label = LockScreenRedactedCopy.accessibilityLabel(
            state: .needsAction,
            etaSeconds: 0
        )

        XCTAssertTrue(label.contains("Open Kolaleaf for details"))
        XCTAssertFalse(label.contains("— remaining"))
    }
}
