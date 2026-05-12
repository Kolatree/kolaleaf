// Recipient+Initials.swift  (Phase 6 iter-2 · S4 / OO-009)
// Single source of truth for the "avatar initials" computation used
// by RecipientChip and RecipientPickerSheet. Previously duplicated
// in both views; consolidating here means a name-parsing tweak
// updates one place.

import Foundation

public extension Recipient {
    /// Two-letter initials. Falls back to "??" for empty names so
    /// the avatar layout doesn't shift on bad data.
    var initials: String {
        let parts = fullName.split(separator: " ", omittingEmptySubsequences: true)
        if parts.isEmpty { return "??" }
        if parts.count == 1 {
            return String(parts[0].prefix(2)).uppercased()
        }
        return "\(parts[0].prefix(1))\(parts[1].prefix(1))".uppercased()
    }
}
