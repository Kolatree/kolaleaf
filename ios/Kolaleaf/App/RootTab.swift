// RootTab.swift  (Phase 4 · U33 — renamed from Tab in Iteration 2)
// The four primary destinations rendered by `MainTabView`.
//
// Lives in `App/` (next to `AppState`) because the active tab is a
// piece of global UI state — the BottomTabBar reads it, deep links
// will write it, and a future StoreKit / push handler may need to
// switch tabs from outside the view tree. Keeping it here means no
// feature module owns the cross-cutting type.
//
// `String` raw value lets us key analytics + DeepLink router strings
// off the same source. `CaseIterable` is used by `MainTabView` to
// build the BottomTabBar items list without repeating the order.
//
// Iteration 2 / API-102 fix: renamed from `Tab` to `RootTab` because
// SwiftUI introduced its own public `Tab` type on iOS 18+
// (`SwiftUI.Tab`). The collision forced every test file to qualify
// every reference with `Kolaleaf.Tab` and made it unsafe to import
// SwiftUI without a manual disambiguation pass. `RootTab` is also
// more descriptive — these are the root-level destinations.
//
// Iteration 2 / API-103 + CA-003 fix: the icon and label tables
// previously lived in BottomTabBar's switches. They moved here so
// the enum is the single source of truth for "what is each tab
// called and what does it look like" — the BottomTabBar shrinks to a
// pure ForEach over `RootTab.allCases`.
//
// Iteration 2 / API-110 fix: rawValues are pinned with explicit
// assignments so an accidental rename of a case does not silently
// break the `UserDefaults` key under `kola.selectedTab`. A test pins
// each rawValue.

import Foundation

public enum RootTab: String, CaseIterable, Sendable, Hashable {
    case send       = "send"
    case activity   = "activity"
    case recipients = "recipients"
    case account    = "account"

    /// SF Symbol name for the bottom-tab icon. Selected variant uses
    /// the `.fill` form. Centralised here so a future visual tweak
    /// (e.g. swapping `paperplane.fill` for `arrow.up.right.circle`)
    /// is a single-file edit.
    public func systemIcon(selected: Bool) -> String {
        switch self {
        case .send:       return selected ? "paperplane.fill"         : "paperplane"
        case .activity:   return selected ? "clock.fill"              : "clock"
        case .recipients: return selected ? "person.2.fill"           : "person.2"
        case .account:    return selected ? "person.crop.circle.fill" : "person.crop.circle"
        }
    }

    /// User-facing label rendered under the icon and read by
    /// VoiceOver. Wave 1 ships English-only; later locales should add
    /// a String-Catalog lookup here.
    public var label: String {
        switch self {
        case .send:       return "Send"
        case .activity:   return "Activity"
        case .recipients: return "Recipients"
        case .account:    return "Account"
        }
    }
}
