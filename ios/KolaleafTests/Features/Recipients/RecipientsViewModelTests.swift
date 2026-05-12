// RecipientsViewModelTests.swift  (Phase 8 · U56)
// Covers:
//   • Happy path: load() populates from /recipients.
//   • Search: typing filters by name + bank substring.
//   • Pinned strip: top 3 of natural order (createdAt desc fallback).
//   • Delete: optimistic remove + revert on failure.
//   • Empty state: zero recipients render correctly.
//   • Session expired: unauthorized → .sessionExpired.

import XCTest
@testable import Kolaleaf

@MainActor
final class RecipientsViewModelTests: XCTestCase {

    private var api: FakeAPIClient!

    override func setUp() async throws {
        try await super.setUp()
        api = FakeAPIClient()
    }

    override func tearDown() async throws {
        api = nil
        try await super.tearDown()
    }

    private func fixture(id: String, name: String, bank: String = "GTBank") -> Recipient {
        Recipient(
            id: id, fullName: name, bankName: bank,
            bankCode: "058", accountNumber: "0123456789"
        )
    }

    func test_load_happyPath_populatesState() async {
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [
                fixture(id: "r1", name: "Mary Adekunle"),
                fixture(id: "r2", name: "John Okafor"),
            ])
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded, got \(vm.state)")
        }
        XCTAssertEqual(rows.count, 2)
    }

    // MARK: - Search

    func test_search_byName_filtersCaseInsensitive() async {
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [
                fixture(id: "r1", name: "Mary Adekunle"),
                fixture(id: "r2", name: "Maryam Okafor"),
                fixture(id: "r3", name: "John Smith"),
            ])
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        vm.searchText = "mary"
        let filtered = vm.filteredRecipients

        XCTAssertEqual(Set(filtered.map(\.id)), Set(["r1", "r2"]))
    }

    func test_search_byBankName_filters() async {
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [
                fixture(id: "r1", name: "Mary", bank: "GTBank"),
                fixture(id: "r2", name: "John", bank: "First Bank"),
            ])
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        vm.searchText = "first"
        XCTAssertEqual(vm.filteredRecipients.map(\.id), ["r2"])
    }

    func test_search_empty_returnsFullList() async {
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [
                fixture(id: "r1", name: "Mary"),
                fixture(id: "r2", name: "John"),
            ])
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        vm.searchText = "   "  // whitespace-only
        XCTAssertEqual(vm.filteredRecipients.count, 2)
    }

    // MARK: - Pinned

    func test_pinned_returnsTopThreeInNaturalOrder() async {
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [
                fixture(id: "r1", name: "Mary"),
                fixture(id: "r2", name: "John"),
                fixture(id: "r3", name: "Sade"),
                fixture(id: "r4", name: "Adam"),
                fixture(id: "r5", name: "Eve"),
            ])
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        let pinned = vm.pinnedRecipients
        XCTAssertEqual(pinned.map(\.id), ["r1", "r2", "r3"])
    }

    func test_pinned_fewerThanThree_returnsAll() async {
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [
                fixture(id: "r1", name: "Mary"),
            ])
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        XCTAssertEqual(vm.pinnedRecipients.map(\.id), ["r1"])
    }

    // MARK: - Delete

    func test_delete_happyPath_removesFromList() async {
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [
                fixture(id: "r1", name: "Mary"),
                fixture(id: "r2", name: "John"),
            ])
        )
        await api.stageSuccess(
            RecipientsEndpoints.Delete.self,
            EmptyResponse()
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        let ok = await vm.delete(fixture(id: "r1", name: "Mary"))

        XCTAssertTrue(ok)
        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(rows.map(\.id), ["r2"])
    }

    func test_delete_failure_revertsList() async {
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [
                fixture(id: "r1", name: "Mary"),
                fixture(id: "r2", name: "John"),
            ])
        )
        await api.stageFailure(
            RecipientsEndpoints.Delete.self,
            .server(status: 500, message: "boom")
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        let ok = await vm.delete(fixture(id: "r1", name: "Mary"))

        XCTAssertFalse(ok)
        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(rows.count, 2, "List must revert when DELETE fails")
        XCTAssertNotNil(vm.lastError)
    }

    // MARK: - Empty

    func test_load_empty_setsLoadedWithEmptyArray() async {
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [])
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertTrue(rows.isEmpty)
        XCTAssertTrue(vm.pinnedRecipients.isEmpty)
    }

    // MARK: - Session expired

    func test_load_unauthorized_setsSessionExpired() async {
        await api.stageFailure(
            RecipientsEndpoints.List.self,
            .unauthorized
        )
        let vm = RecipientsViewModel(api: api)
        await vm.load()

        XCTAssertEqual(vm.state, .sessionExpired)
    }
}
