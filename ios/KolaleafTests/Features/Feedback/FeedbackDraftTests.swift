// FeedbackDraftTests.swift  (Phase 12 · shake-to-report)

import XCTest
@testable import Kolaleaf

final class FeedbackDraftTests: XCTestCase {

    func test_makeDraft_usesPrivacyPreservingDiagnostics() throws {
        let draft = FeedbackDraftFactory.make(
            source: .shake,
            environment: FeedbackEnvironment(
                appVersion: "1.2.3",
                build: "45",
                osVersion: "iOS 18.6",
                deviceModel: "iPhone"
            ),
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        XCTAssertEqual(draft.subject, "Kolaleaf app report")
        XCTAssertTrue(draft.body.contains("Source: Shake gesture"))
        XCTAssertTrue(draft.body.contains("App version: 1.2.3 (45)"))
        XCTAssertTrue(draft.body.contains("No screenshots, logs, account details, transfer IDs, phone numbers, or email addresses were attached automatically."))
        XCTAssertFalse(draft.body.contains("@"))
        XCTAssertFalse(draft.body.localizedCaseInsensitiveContains("payid"))
    }

    func test_mailtoURL_encodesSubjectAndBodyForSupportAddress() throws {
        let draft = FeedbackDraft(
            source: .shake,
            createdAt: Date(timeIntervalSince1970: 0),
            subject: "Kolaleaf app report",
            body: "Line 1\nLine 2"
        )

        let url = try XCTUnwrap(FeedbackDraftFactory.mailtoURL(for: draft))
        XCTAssertEqual(url.scheme, "mailto")
        XCTAssertTrue(url.absoluteString.hasPrefix("mailto:support@kolaleaf.com?"))
        XCTAssertTrue(url.absoluteString.contains("subject=Kolaleaf%20app%20report"))
        XCTAssertTrue(url.absoluteString.contains("body=Line%201%0ALine%202"))
    }
}
