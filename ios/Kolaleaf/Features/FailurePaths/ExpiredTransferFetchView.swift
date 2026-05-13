// ExpiredTransferFetchView.swift  (Phase 9 iter-2 · A5 / ADV-P9-W2)
// Fetch-by-id fallback for the expired-transfer screen. Used when
// `appState.activeTransfer` is missing OR carries a zero rate (the
// in-memory mirror was reaped during deep sleep / restoration and the
// real Domain Transfer must come from the server before the UI can
// render numbers the regulator would accept on a screenshot).
//
// Composition:
//   parallel-loads `GET /api/v1/transfers/:id` + `GET /api/v1/recipients`,
//   resolves the recipient by id, and hands `(Transfer, Recipient)` to
//   the parent via `onLoaded`. Falls into a retry card on either
//   failure (transfer fetch fails, recipient list fails, or recipient
//   id not in the list).

import SwiftUI

struct ExpiredTransferFetchView: View {

    let api: AuthAPI
    let transferId: String
    let onLoaded: (Transfer, Recipient) -> Void
    let onDone: () -> Void

    @State private var loadState: LoadState = .loading

    private enum LoadState: Equatable {
        case loading
        case error(String)
    }

    var body: some View {
        VStack(spacing: KolaSpacing.l) {
            switch loadState {
            case .loading:
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(KolaColors.trustGreen)
            case .error(let message):
                VStack(spacing: KolaSpacing.m) {
                    Text("Couldn't load this transfer")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(KolaColors.ink)
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(KolaColors.muted)
                        .multilineTextAlignment(.center)
                    Button("Try again") {
                        Task { await load() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(KolaColors.trustGreen)
                    Button("Done", action: onDone)
                        .buttonStyle(.bordered)
                }
                .padding(.horizontal, KolaSpacing.xl)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KolaColors.surface)
        .task { await load() }
    }

    private func load() async {
        loadState = .loading
        async let transferResult = api.send(TransfersEndpoints.Get(id: transferId))
        async let recipientsResult = api.send(RecipientsEndpoints.List())

        let (transferOutcome, recipientsOutcome) = await (transferResult, recipientsResult)

        switch transferOutcome {
        case .failure(let err):
            loadState = .error(err.errorDescription ?? "Couldn't load the transfer.")
            return
        case .success(let envelope):
            let transfer: Transfer
            do {
                transfer = try envelope.transfer.toDomain()
            } catch {
                loadState = .error("Couldn't read this transfer.")
                return
            }
            switch recipientsOutcome {
            case .failure(let err):
                loadState = .error(err.errorDescription ?? "Couldn't load the recipient.")
            case .success(let response):
                guard let recipient = response.recipients.first(where: { $0.id == transfer.recipientId }) else {
                    loadState = .error("This recipient is no longer available.")
                    return
                }
                onLoaded(transfer, recipient)
            }
        }
    }
}
