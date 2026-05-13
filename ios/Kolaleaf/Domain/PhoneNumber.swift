// PhoneNumber.swift  (Phase 11A-3 · phone-first onboarding)
//
// E.164 normalisation + validation matching the backend contract
// at src/lib/auth/phone.ts and the Zod regex used by the wizard
// schemas (/api/v1/auth/send-code, /verify-code, /login):
//
//     ^\+\d{7,15}$
//
// The shared regex is documented as a "placeholder regex-only
// implementation" — see src/lib/auth/phone.ts for the rationale and
// the libphonenumber upgrade path. Until that lands, this client-
// side validator matches the server exactly so a number the user
// types either passes both sides or fails the client side first.
//
// CountryDialCode lives here too so the picker can show a curated
// set: AU primary (corridor source), NG secondary (corridor
// destination), plus a small whitelist of likely-Australian-resident
// origin countries. The list will grow alongside corridor expansion.

import Foundation

/// Curated dial-code entry. `flag` is a country-flag emoji
/// (rendered via system font); `dialCode` carries the leading "+".
/// `name` is shown in the picker list.
public struct CountryDialCode: Sendable, Hashable, Identifiable {
    public let isoCode: String      // ISO 3166-1 alpha-2 — stable picker id
    public let name: String
    public let dialCode: String     // e.g. "+61"
    public let flag: String         // emoji

    public var id: String { isoCode }

    public init(isoCode: String, name: String, dialCode: String, flag: String) {
        self.isoCode = isoCode
        self.name = name
        self.dialCode = dialCode
        self.flag = flag
    }
}

public enum CountryDialCodes {

    /// Wave 1 curated list. AU is the default — every signup begins
    /// from an AU-resident number per AUSTRAC. NG sits next so the
    /// corridor destination's diaspora numbers are reachable when
    /// we open up dual-residency support. The remaining entries are
    /// common origin countries for the Australian Nigerian-Australian
    /// community per ABS migration data; safe defaults that don't
    /// open Wave 1 to global signup.
    public static let supported: [CountryDialCode] = [
        .init(isoCode: "AU", name: "Australia",      dialCode: "+61",  flag: "🇦🇺"),
        .init(isoCode: "NG", name: "Nigeria",        dialCode: "+234", flag: "🇳🇬"),
        .init(isoCode: "NZ", name: "New Zealand",    dialCode: "+64",  flag: "🇳🇿"),
        .init(isoCode: "GB", name: "United Kingdom", dialCode: "+44",  flag: "🇬🇧"),
        .init(isoCode: "US", name: "United States",  dialCode: "+1",   flag: "🇺🇸"),
        .init(isoCode: "ZA", name: "South Africa",   dialCode: "+27",  flag: "🇿🇦"),
    ]

    /// Default selected when the picker opens for the first time.
    /// Hard-coded to AU — the corridor source country anchors the
    /// AUSTRAC-eligible signup path.
    public static let `default`: CountryDialCode = supported[0]

    /// Look up a curated entry by dial code. Used when re-hydrating
    /// a saved phone number into the picker selection.
    public static func first(matchingDialCode dialCode: String) -> CountryDialCode? {
        supported.first { $0.dialCode == dialCode }
    }
}

/// E.164-validated phone number. Construct via `parse(...)` so the
/// type-system guarantees the value matches the server contract.
public struct PhoneNumber: Sendable, Hashable {
    /// E.164 string with leading "+". Never contains spaces, dashes,
    /// or parens — those are stripped at parse time.
    public let e164: String

    private init(_ value: String) { self.e164 = value }

    /// Error states callers surface in the UI.
    public enum ParseError: Error, Equatable, Sendable {
        /// Empty input or whitespace only.
        case empty
        /// Format does not match `^\+\d{7,15}$` after stripping.
        case malformed
    }

    /// Parse a `+DIAL_CODE` plus a user-typed local number into
    /// E.164. Strips spaces, dashes, and parens; collapses redundant
    /// `+` if the user typed it; enforces the 7-15 digit length.
    ///
    /// Examples (dial=+61):
    ///   "0400 000 000"   → +61400000000
    ///   "+61 400 000 000" → +61400000000
    ///   "400-000-000"    → +61400000000
    public static func parse(
        dialCode: String,
        localNumber raw: String
    ) -> Result<PhoneNumber, ParseError> {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .failure(.empty) }
        let stripped = trimmed
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")

        // Reconcile dial-code prefix. The user may have typed the
        // dial code into the local number (e.g. "+61400…") or used
        // their country's national prefix (e.g. "0400…" for AU).
        // We honour the picker's dialCode as the source of truth.
        let digitsOnly = stripped.hasPrefix("+")
            ? String(stripped.dropFirst())
            : stripped
        let dialDigits = dialCode.hasPrefix("+")
            ? String(dialCode.dropFirst())
            : dialCode
        let withoutDialPrefix = digitsOnly.hasPrefix(dialDigits)
            ? String(digitsOnly.dropFirst(dialDigits.count))
            : digitsOnly
        // Strip the national trunk prefix `0` for AU/NZ/GB convention
        // when the rest of the number is the right length.
        let withoutTrunk = withoutDialPrefix.hasPrefix("0")
            ? String(withoutDialPrefix.dropFirst())
            : withoutDialPrefix
        let candidate = "+" + dialDigits + withoutTrunk

        let pattern = "^\\+\\d{7,15}$"
        guard candidate.range(of: pattern, options: .regularExpression) != nil else {
            return .failure(.malformed)
        }
        return .success(PhoneNumber(candidate))
    }

    /// Direct parse from a string the user typed (or pasted) that
    /// already includes a leading `+` and country code. Use when the
    /// UI doesn't separate dial code from local digits (e.g. SignIn
    /// where the user types the whole identifier into one field).
    public static func parseE164(_ raw: String) -> Result<PhoneNumber, ParseError> {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .failure(.empty) }
        let stripped = trimmed
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
        let pattern = "^\\+\\d{7,15}$"
        guard stripped.range(of: pattern, options: .regularExpression) != nil else {
            return .failure(.malformed)
        }
        return .success(PhoneNumber(stripped))
    }
}
