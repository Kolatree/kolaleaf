// DeepLinkURLTests.swift  (Phase 10A iter-2 · ADV-P10A-C2 + W8 + API-1007)
//
// Locks the percent-encoding contract on the `kolaleaf://transfer/{id}`
// deep-link builder. The widget cannot afford a force-unwrap on a
// transferId string we received from a wire payload, so the resolver
// in `TransferDeepLink` MUST produce a valid URL for every input we
// might plausibly see (slashes, query separators, spaces, non-ASCII).

import XCTest

@MainActor
final class DeepLinkURLTests: XCTestCase {

    func test_urlForTransferId_handlesSlash() {
        let url = TransferDeepLink.url(forTransferId: "tx/2026/0001")
        XCTAssertEqual(url.scheme, "kolaleaf")
        // A slash in the path component must be percent-encoded so the
        // host stays "transfer" and the id survives intact.
        XCTAssertEqual(url.absoluteString, "kolaleaf://transfer/tx%2F2026%2F0001")
    }

    func test_urlForTransferId_handlesQuestionMark() {
        let url = TransferDeepLink.url(forTransferId: "tx?nope")
        // The "?" must not be read as the query separator.
        XCTAssertEqual(url.absoluteString, "kolaleaf://transfer/tx%3Fnope")
        XCTAssertNil(url.query)
    }

    func test_urlForTransferId_handlesSpace() {
        let url = TransferDeepLink.url(forTransferId: "tx 1")
        XCTAssertEqual(url.absoluteString, "kolaleaf://transfer/tx%201")
    }

    func test_urlForTransferId_handlesUnicode() {
        let url = TransferDeepLink.url(forTransferId: "tx_😀")
        XCTAssertEqual(url.scheme, "kolaleaf")
        XCTAssertTrue(url.absoluteString.hasPrefix("kolaleaf://transfer/tx_"))
        XCTAssertNotEqual(url.absoluteString, "kolaleaf://", "should not collapse to the bare app-root URL")
    }

    func test_appRoot_isBareScheme() {
        XCTAssertEqual(TransferDeepLink.appRoot.absoluteString, "kolaleaf://")
    }
}
