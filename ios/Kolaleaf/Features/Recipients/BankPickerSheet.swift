// BankPickerSheet.swift  (Phase 4 · U37)
// Modal sheet for picking a bank during Add Recipient. Loads
// `GET /api/v1/banks?country=NG` on first appear, holds the list in
// local `@State` so re-opening the sheet within a session doesn't
// refetch, and supports client-side filtering by name + code.
//
// API-105: the sheet now takes `Binding<Bank?>` so it owns the
// selected-value write directly. Eliminates the prior
// `(value, callback)` pair where the callback's only job was to
// flip the same value back into the parent VM. The parent passes
// `$vm.selectedBank`; the sheet's row tap writes through the binding
// and dismisses. One source of truth, no redundant ceremony.

import SwiftUI

public struct BankPickerSheet: View {
    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss

    @State private var banks: [Bank] = []
    @State private var query: String = ""
    @State private var loadingState: LoadingState = .loading
    @Binding private var selection: Bank?

    /// Injection seam used by tests: an explicit list of banks
    /// short-circuits the network load so the test doesn't have to
    /// stand up a FakeAPIClient just to render the picker. When
    /// `injectedBanks` is nil the sheet hits the live API.
    private let injectedBanks: [Bank]?

    enum LoadingState: Equatable {
        case loading
        case loaded
        case failed
    }

    public init(selection: Binding<Bank?>) {
        self._selection = selection
        self.injectedBanks = nil
    }

    init(selection: Binding<Bank?>, injectedBanks: [Bank]) {
        self._selection = selection
        self.injectedBanks = injectedBanks
    }

    public var body: some View {
        NavigationStack {
            content
                .navigationTitle("Choose bank")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Cancel") { dismiss() }
                    }
                }
                .searchable(text: $query, prompt: "Search banks")
        }
        .presentationDetents([.large])
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch loadingState {
        case .loading:
            ProgressView().tint(KolaColors.trustGreen)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed:
            failedState
        case .loaded:
            list
        }
    }

    private var failedState: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Couldn't load banks")
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Check your connection and try again.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
            Button("Retry") {
                Task { await load() }
            }
            .font(KolaFont.cta)
            .foregroundStyle(KolaColors.trustGreen)
        }
        .padding(KolaSpacing.card)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(filteredBanks) { bank in
                    Button {
                        selection = bank
                        dismiss()
                    } label: {
                        BankRow(bank: bank, isSelected: bank.code == selection?.code)
                    }
                    .buttonStyle(.plain)
                    Divider()
                        .background(KolaColors.border)
                        .padding(.leading, KolaSpacing.card + 24)
                }
            }
        }
        .background(KolaColors.surface)
    }

    // MARK: - Filtering

    /// Filter exposed to tests as well. Pure function on the current
    /// banks list + query.
    var filteredBanks: [Bank] {
        BankPickerSheet.filter(banks: banks, query: query)
    }

    /// Pure filter — case-insensitive prefix/contains match on name OR
    /// code. Extracted as a static so tests can exercise it without
    /// constructing the View. `nonisolated` so synchronous test
    /// suites can call it without hopping to MainActor.
    nonisolated static func filter(banks: [Bank], query: String) -> [Bank] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return banks }
        return banks.filter {
            $0.name.lowercased().contains(trimmed) ||
            $0.code.lowercased().contains(trimmed)
        }
    }

    // MARK: - Load

    private func load() async {
        if let injected = injectedBanks {
            banks = injected
            loadingState = .loaded
            return
        }
        // Re-fetch is gated to avoid wiping a loaded list on a second
        // .task fire (e.g. sheet re-appears after a presentationDetent
        // change). On retry from the failed state the user calls load
        // explicitly which sets state back to .loading first.
        if loadingState == .loaded && !banks.isEmpty { return }
        loadingState = .loading

        let result = await apiClient.send(BanksEndpoints.List(country: "NG"))
        switch result {
        case .success(let response):
            banks = response.banks
            loadingState = .loaded
        case .failure:
            loadingState = .failed
        }
    }
}
