// BankBrand.swift  (Phase 5 · CA-003)
// Value type representing the visual identity for a single bank.
// Created so callers (BankRow, future picker callsites, the resolved-
// name card) can ask one question — "what's this bank's brand?" —
// rather than each maintaining their own substring-matching colour
// table.
//
// The brand store itself lives on `BankStore` (session-scoped) so
// the lookup can grow a remote-tinted source later (e.g. the backend
// returns a brand colour with the bank list) without callers having
// to change.

import SwiftUI

public struct BankBrand: Sendable, Equatable {
    public let code: String
    public let name: String
    public let color: Color

    public init(code: String, name: String, color: Color) {
        self.code = code
        self.name = name
        self.color = color
    }
}
