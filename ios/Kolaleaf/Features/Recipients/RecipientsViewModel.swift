// RecipientsViewModel.swift  (Phase 8 · U56)
// Drives the Recipients tab. Owns:
//   • The full recipients list (`GET /api/v1/recipients`).
//   • Search text — filters by fullName + bankName substring.
//   • The "Most sent to" pinned strip (top 3, see note below).
//   • Delete (long-press menu) via DELETE /api/v1/recipients/:id.
//
// TODO(backend): the row shape doesn't currently carry a
// `sendCount` / `lastUsedAt` field. Without it, the "Most sent to"
// strip falls back to the natural list order (backend already returns
// `createdAt desc` — newer recipients first). When the backend adds
// `sendCount` or `lastUsedAt`, sort by it here.
//
// Offline-first: the VM paints from the SwiftData cache on first
// appearance and races a network refresh. A failed refresh leaves
// the cached list visible.

import Foundation
import Observation

@MainActor
@Observable
public final class RecipientsViewModel {

    public enum State: Equatable {
        case idle
        case loading
        case loaded([Recipient])
        case sessionExpired
        case failed(String)
    }

    public private(set) var state: State = .idle
    /// Most-recently-deleted recipient id while the network request is
    /// in flight. Used to optimistically remove the row from the UI;
    /// reverted if the DELETE fails.
    public private(set) var inFlightDeleteIds: Set<String> = []
    public private(set) var lastError: String?

    public var searchText: String = ""

    private let api: AuthAPI
    private let sync: SyncService?

    public init(api: AuthAPI, sync: SyncService? = nil) {
        self.api = api
        self.sync = sync
    }

    /// First-load entry point. Paints cached rows immediately, then
    /// fetches fresh data in the background.
    public func load() async {
        if let sync, case .idle = state {
            let cached = sync.cachedRecipients()
            if !cached.isEmpty {
                state = .loaded(cached)
            }
        }
        if case .idle = state { state = .loading }
        await refresh()
    }

    /// Pull-to-refresh entry point.
    public func refresh() async {
        let result = await api.send(RecipientsEndpoints.List())
        switch result {
        case .success(let response):
            sync?.upsertRecipients(response.recipients)
            state = .loaded(response.recipients)
        case .failure(let err):
            switch err {
            case .unauthorized:
                state = .sessionExpired
            default:
                // Keep cached rows visible on a network failure.
                if case .loaded = state { return }
                state = .failed(err.errorDescription
                                ?? "Couldn't load recipients.")
            }
        }
    }

    // MARK: - Search

    /// Recipients filtered by the current search text. Search matches
    /// against fullName + bankName (case-insensitive substring).
    public var filteredRecipients: [Recipient] {
        let all = loadedRecipients()
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return all }
        return all.filter {
            $0.fullName.localizedCaseInsensitiveContains(query)
                || $0.bankName.localizedCaseInsensitiveContains(query)
        }
    }

    /// Top-3 of the recipients list for the "Most sent to" pinned
    /// strip. TODO(backend): when `sendCount` is available, sort by
    /// it; for now we use natural order (createdAt desc).
    public var pinnedRecipients: [Recipient] {
        Array(loadedRecipients().prefix(3))
    }

    // MARK: - Delete

    /// Long-press → Delete. Optimistic: removes the row immediately
    /// and reverts on failure. Returns true on confirmed success.
    @discardableResult
    public func delete(_ recipient: Recipient) async -> Bool {
        guard !inFlightDeleteIds.contains(recipient.id) else { return false }
        inFlightDeleteIds.insert(recipient.id)
        defer { inFlightDeleteIds.remove(recipient.id) }

        // Optimistic removal.
        let snapshot = loadedRecipients()
        let optimistic = snapshot.filter { $0.id != recipient.id }
        state = .loaded(optimistic)

        let result = await api.send(RecipientsEndpoints.Delete(id: recipient.id))
        switch result {
        case .success:
            // Phase 8 iter-2 (P3): drop the cached row so a foreground
            // re-sync (or cold launch before the next server fetch)
            // doesn't resurrect the deleted recipient. Without this,
            // the row reappears for one frame after launch and then
            // disappears when /recipients returns.
            sync?.removeCachedRecipient(id: recipient.id)
            return true
        case .failure(let err):
            // Revert and surface the error.
            state = .loaded(snapshot)
            lastError = err.errorDescription
                ?? "Couldn't delete recipient. Please try again."
            return false
        }
    }

    /// Clear a previously-displayed error banner.
    public func clearError() { lastError = nil }

    // MARK: - Private

    private func loadedRecipients() -> [Recipient] {
        if case .loaded(let rows) = state { return rows }
        return []
    }
}
