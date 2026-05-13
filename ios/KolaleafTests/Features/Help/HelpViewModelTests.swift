// HelpViewModelTests.swift  (Phase 8 · U58)
// Covers:
//   • Happy path: load() pulls most-recent transfer from /transfers.
//   • Quick-help cards: 4 cards with stable IDs + deep-link URLs.
//   • openQuickHelp: routes through WebOpener with the card's URL.
//   • openChatCTA: routes through WebOpener with /help URL.
//   • Network failure: loaded with nil recent (still usable).
//   • Session expired: unauthorized → .sessionExpired.

import XCTest
@testable import Kolaleaf

@MainActor
final class HelpViewModelTests: XCTestCase {

    /// Fake opener that records the URL instead of launching it.
    final class RecordingOpener: WebOpener, @unchecked Sendable {
        private(set) var openedURLs: [URL] = []
        func open(_ url: URL) { openedURLs.append(url) }
    }

    func test_quickHelpCards_hasFourStableIds() {
        let vm = HelpViewModel(api: FakeAPIClient(), opener: RecordingOpener())
        XCTAssertEqual(vm.quickHelpCards.count, 4)
        let ids = vm.quickHelpCards.map(\.id)
        XCTAssertEqual(Set(ids).count, 4, "IDs must be unique")
        XCTAssertEqual(ids,
                       ["transfer-status", "limits-fees", "kyc", "security"])
    }

    func test_load_happyPath_extractsRecentTransfer() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "t1", status: .completed),
            ], nextCursor: nil)
        )
        let vm = HelpViewModel(api: api, opener: RecordingOpener())
        await vm.load()

        XCTAssertEqual(vm.recentTransferId, "t1")
    }

    func test_load_emptyList_recentIsNil() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [], nextCursor: nil)
        )
        let vm = HelpViewModel(api: api, opener: RecordingOpener())
        await vm.load()

        XCTAssertNil(vm.recentTransferId)
    }

    func test_openQuickHelp_callsOpenerWithCardURL() async {
        let opener = RecordingOpener()
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [], nextCursor: nil)
        )
        let vm = HelpViewModel(api: api, opener: opener)
        await vm.load()

        let card = vm.quickHelpCards[0]
        vm.openQuickHelp(card)

        XCTAssertEqual(opener.openedURLs, [card.url])
    }

    func test_openChatCTA_callsOpenerWithHelpURL() async {
        let opener = RecordingOpener()
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [], nextCursor: nil)
        )
        let vm = HelpViewModel(api: api, opener: opener)
        await vm.load()

        vm.openChatCTA()

        XCTAssertEqual(opener.openedURLs.first?.absoluteString,
                       "https://www.kolaleaf.com/help")
    }

    func test_load_unauthorized_setsSessionExpired() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            TransfersEndpoints.List.self,
            .unauthorized
        )
        let vm = HelpViewModel(api: api, opener: RecordingOpener())
        await vm.load()

        XCTAssertEqual(vm.state, .sessionExpired)
    }

    func test_load_networkFailure_loadsWithoutRecent() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            TransfersEndpoints.List.self,
            .transport("offline")
        )
        let vm = HelpViewModel(api: api, opener: RecordingOpener())
        await vm.load()

        // We should still render — help articles work without network.
        XCTAssertNil(vm.recentTransferId)
    }
}
