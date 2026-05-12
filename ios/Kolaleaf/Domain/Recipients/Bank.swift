// Bank.swift  (Phase 5 · CA-202 — iteration 3)
// Domain value-type for a Nigerian bank. The recipient subdomain owns
// the language of "what is a bank" — name, code, identity — so callers
// in `Features/Recipients`, `Domain/Services/BankStore`, and the
// BanksEndpoints DTOs all reach into one canonical home.
//
// Iter-3 move: previously this struct lived alongside the
// `BanksListResponse` wire DTO in `Networking/DTOs/BankDTOs.swift`. Two
// problems with that placement:
//   • Coupling. Every Domain caller had to import a Networking file
//     to type a parameter as `Bank`.
//   • Reverse coupling. The Networking layer is supposed to depend on
//     Domain, not vice versa.
// Domain/Recipients/ now houses the recipient ubiquitous language:
//   - `Bank` (this file) — the value type.
//   - `BankBrand` — the visual identity for one bank.
//   - `BankBrandTable` — the brand-colour lookup.
//   - `NubanRules` — account-number validation.
//   - `ResolveErrorMapper` — APIError → ResolveState mapping.
//
// `Bank` itself is `Identifiable` + `Hashable` so SwiftUI's
// `ForEach(banks)` works without a lookup-key helper. The id is the
// `code` because that is what the backend treats as the stable primary
// key for resolve calls.

import Foundation

public struct Bank: Codable, Identifiable, Hashable, Sendable {
    public let code: String
    public let name: String

    public var id: String { code }

    public init(code: String, name: String) {
        self.code = code
        self.name = name
    }
}
