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

    /// 4-lens review fix (type-design-analyzer #17): internal init
    /// so only `CountryDialCodes.supported` can mint entries. A
    /// `CountryDialCode(dialCode: "garbage", ...)` minted at a call
    /// site would silently never match anything via
    /// `first(matchingDialCode:)`. The curated list is now the
    /// type's universe; broaden via the (currently nil) failable
    /// init path when external construction becomes useful.
    internal init(isoCode: String, name: String, dialCode: String, flag: String) {
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

    /// 4-lens review fix (type-design-analyzer #15): regex lifted
    /// to one constant so `parse(...)` and `parseE164(...)` can't
    /// drift. Mirrors the backend Zod regex at
    /// `src/lib/schemas/common.ts PhoneE164` and the helper guard
    /// in `src/lib/auth/pending-phone-verification.ts` byte-for-byte.
    private static let e164Pattern = "^\\+\\d{7,15}$"

    /// 4-lens review fix (type-design-analyzer #15): only strip a
    /// leading `0` for countries whose national format uses a `0`
    /// trunk prefix. AU, NZ, GB, ZA all do; NG / US / most others
    /// do not. Without this list, the parser would silently drop a
    /// digit from a NG number like `08012345678` (which is a 11-
    /// digit local that does NOT have a trunk-0 to strip) and
    /// produce an invalid 7-digit E.164.
    private static let trunkPrefixDialCodes: Set<String> = [
        "+61",  // Australia
        "+64",  // New Zealand
        "+44",  // United Kingdom
        "+27",  // South Africa
    ]

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
        // 4-lens review fix (type-design-analyzer #15): only strip
        // the national trunk prefix `0` for countries that use one.
        // Universal stripping silently dropped a digit from numbers
        // like NG `08012345678` where the leading `0` is a real
        // digit, not a trunk indicator.
        let withoutTrunk: String
        if Self.trunkPrefixDialCodes.contains(dialCode),
           withoutDialPrefix.hasPrefix("0") {
            withoutTrunk = String(withoutDialPrefix.dropFirst())
        } else {
            withoutTrunk = withoutDialPrefix
        }
        let candidate = "+" + dialDigits + withoutTrunk

        guard candidate.range(of: Self.e164Pattern, options: .regularExpression) != nil else {
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
        guard stripped.range(of: Self.e164Pattern, options: .regularExpression) != nil else {
            return .failure(.malformed)
        }
        return .success(PhoneNumber(stripped))
    }

    // MARK: - Display projection

    /// Per-corridor grouping table for `displayFormatted`. Each entry
    /// is `(dialCode, groupSizes)` where `groupSizes` describes how
    /// to split the **local** portion (everything after the dial
    /// code) into space-separated runs.
    ///
    /// AU `+61`: 3-3-3 (e.g. `400 000 000`)
    /// NZ `+64`: 2-3-4 (e.g. `21 123 4567`)
    /// GB `+44`: 4-6  (e.g. `7700 900123` — UK mobile shape)
    /// US/CA `+1`: 3-3-4 (e.g. `415 555 0123`)
    /// NG `+234`: 3-3-4 (e.g. `801 234 5678`)
    /// ZA `+27`: 2-3-4 (e.g. `82 123 4567`)
    private static let displayGroups: [(dialCode: String, groups: [Int])] = [
        ("+61",  [3, 3, 3]),
        ("+64",  [2, 3, 4]),
        ("+44",  [4, 6]),
        ("+234", [3, 3, 4]),
        ("+27",  [2, 3, 4]),
        ("+1",   [3, 3, 4]),
    ]

    /// Human display projection — e.g. `+61 400 000 000`.
    ///
    /// **Use at the View layer; do NOT use in network DTOs (use `.e164`).**
    /// Single source of truth for human-display of a phone number
    /// across the app; do not re-implement grouping at the View layer.
    /// Defaults to grouped-3 (`"+999 123 456 78"`) for any dial code
    /// not in the per-corridor table above. The grouping is purely
    /// cosmetic — round-tripping through `parse(...)` recovers the
    /// same `.e164`.
    public var displayFormatted: String {
        // Find the entry whose dial code is a prefix of e164. Order
        // longest-first so `+234` wins over `+2` if both existed.
        let entry = Self.displayGroups
            .sorted { $0.dialCode.count > $1.dialCode.count }
            .first { e164.hasPrefix($0.dialCode) }

        guard let entry else {
            // Unknown corridor: fall back to grouped-3 over the
            // post-`+` digits. We can't isolate the dial code without
            // a libphonenumber-class lookup, so we group the entire
            // digit run including the country code digits.
            let digits = String(e164.dropFirst())
            return "+" + Self.group(digits, into: [3, 3, 3, 3, 3])
        }

        let local = String(e164.dropFirst(entry.dialCode.count))
        return entry.dialCode + " " + Self.group(local, into: entry.groups)
    }

    /// Insert single-space separators into `digits` according to
    /// `groups` (left-aligned). If `digits` is longer than the sum
    /// of `groups`, any overflow is appended after the last group
    /// (no trailing space). If shorter, the format truncates to the
    /// digits available.
    private static func group(_ digits: String, into groups: [Int]) -> String {
        var remaining = Substring(digits)
        var parts: [String] = []
        for size in groups {
            if remaining.isEmpty { break }
            let take = min(size, remaining.count)
            parts.append(String(remaining.prefix(take)))
            remaining = remaining.dropFirst(take)
        }
        if !remaining.isEmpty {
            // Overflow — append to the last part so we don't lose digits.
            if parts.isEmpty {
                parts.append(String(remaining))
            } else {
                parts[parts.count - 1] += String(remaining)
            }
        }
        return parts.joined(separator: " ")
    }
}
