// AccountViewModel.swift  (Phase 8 · U60)
// Drives the Account-tab landing screen.
//   • Profile header: displayName / fullName / email + initials avatar.
//   • KYC status badge derived from `MeResponse.kycStatus`.
//   • Menu rows that route to MyPayID / Security & 2FA / Refer / Help /
//     Statements / Sign out.
//
// Sign-out is destructive — the View shows a confirmation alert
// before invoking `signOut()`. The actual logout call lives at the
// AppState layer (clearForLogout) so the VM just exposes the hook.

import Foundation
import Observation

@MainActor
@Observable
public final class AccountViewModel {

    public struct Profile: Equatable, Sendable {
        public let displayName: String
        public let email: String?
        public let kycStatus: KycStatus
        public let initials: String

        public init(
            displayName: String,
            email: String?,
            kycStatus: KycStatus,
            initials: String
        ) {
            self.displayName = displayName
            self.email = email
            self.kycStatus = kycStatus
            self.initials = initials
        }
    }

    public enum State: Equatable {
        case idle
        case loading
        case loaded(Profile)
        case sessionExpired
        case failed(String)
    }

    public private(set) var state: State = .idle

    private let api: AuthAPI

    public init(api: AuthAPI) {
        self.api = api
    }

    public func load() async {
        state = .loading
        let result = await api.send(AccountEndpoints.Me())
        switch result {
        case .success(let me):
            let name = me.displayName
                ?? me.fullName
                ?? me.primaryEmail?.email
                ?? "Your account"
            state = .loaded(Profile(
                displayName: name,
                email: me.primaryEmail?.email,
                kycStatus: me.kycStatus,
                initials: Self.computeInitials(name)
            ))
        case .failure(let err):
            switch err {
            case .unauthorized:
                state = .sessionExpired
            default:
                state = .failed(err.errorDescription
                                ?? "Couldn't load your account.")
            }
        }
    }

    /// Initials from a full name. Falls back to "?" so the avatar
    /// layout doesn't shift on bad data.
    static func computeInitials(_ name: String) -> String {
        let parts = name.split(separator: " ", omittingEmptySubsequences: true)
        if parts.isEmpty { return "?" }
        if parts.count == 1 {
            return String(parts[0].prefix(2)).uppercased()
        }
        return "\(parts[0].prefix(1))\(parts[1].prefix(1))".uppercased()
    }

    /// Human-readable label for the KYC badge. Delegates to
    /// `KycStatus.displayLabel` (Iter-2 N16/N17) so every surface
    /// shares the same copy.
    public static func kycLabel(_ status: KycStatus) -> String {
        status.displayLabel
    }
}
