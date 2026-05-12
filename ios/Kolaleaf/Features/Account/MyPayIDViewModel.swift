// MyPayIDViewModel.swift  (Phase 7 · U53 → iter-2 C3 / ADV-P7-C2)
// View model for Account → My PayID & bank (Screen 25).
//
// Money-path correctness (C3 / ADV-P7-C2): email is NOT a PayID.
// Iter-1 derived the display handle from `me.primaryEmail`, which
// risked routing money to a non-PayID identifier. Iter-2 removes
// that path entirely. Until the backend exposes an allocated PayID
// handle on `/account/me`, the screen always surfaces `.unavailable`
// with the BSB+account fallback card.
//
// QR generation lives in `Design/Primitives/QRCodeRenderer.swift`
// (W2 / OO-004). Fallback BSB/account is part of the `.unavailable`
// state payload (S3 / CA-006) so a per-user backend allocation is a
// one-line swap.

import Foundation
import Observation
import UIKit

@MainActor
@Observable
public final class MyPayIDViewModel {

    public enum State: Equatable {
        case idle
        case loading
        /// Backend allocated a PayID handle for this user.
        case allocated(PayIDHandle, fallback: FallbackBankAccount)
        /// User has no allocated PayID — render the "coming soon" card
        /// + the BSB/account fallback. `reason` is the user-facing
        /// copy displayed in the unavailable card.
        case unavailable(reason: String, fallback: FallbackBankAccount)
        case failed(String)
    }

    /// Static fallback BSB/account placeholder. Per-user allocation
    /// arrives in a Wave 1.5 Monoova feature; until then every user
    /// sees the same shared treasury BSB.
    public struct FallbackBankAccount: Equatable, Sendable {
        public let bsb: String
        public let accountNumber: String

        public init(bsb: String, accountNumber: String) {
            self.bsb = bsb
            self.accountNumber = accountNumber
        }
    }

    public private(set) var state: State = .idle

    /// Static placeholder consumed when no per-user allocation exists.
    /// Held on the VM (not the state) so unavailable + allocated
    /// constructors share the same instance.
    public static let defaultFallbackBankAccount = FallbackBankAccount(
        bsb: "123-456",
        accountNumber: "0000 0000"
    )

    /// User-facing copy for the "coming soon" card. Kept short so the
    /// View can render without truncation.
    public static let unavailableReason =
        "Your PayID will be available shortly."

    private let api: AuthAPI

    public init(api: AuthAPI) {
        self.api = api
    }

    public func load() async {
        state = .loading
        let result = await api.send(AccountEndpoints.Me())
        switch result {
        case .success:
            // Backend doesn't expose an allocated handle yet. Until it
            // does, every successful load lands on `.unavailable` —
            // NEVER derive a PayID from email (Iter-1 bug; money-path
            // safety: emails aren't PayIDs).
            state = .unavailable(
                reason: Self.unavailableReason,
                fallback: Self.defaultFallbackBankAccount
            )
        case .failure(let err):
            state = .failed(err.errorDescription ?? "Couldn't load PayID.")
        }
    }

    /// Build the AusPayNet `payid:` URI for a given handle. Used by
    /// the QR rasteriser and the Share sheet so both encode the same
    /// payload. Internal — tests pull it via `@testable import`.
    func qrPayload(for handle: PayIDHandle) -> String {
        "payid:\(handle.value)"
    }

    /// Render the QR code for a PayID handle as a UIImage. Delegates
    /// to the shared `QRCodeRenderer` (W2 / OO-004).
    public func qrImage(for handle: PayIDHandle) -> UIImage? {
        QRCodeRenderer.image(for: qrPayload(for: handle))
    }
}
