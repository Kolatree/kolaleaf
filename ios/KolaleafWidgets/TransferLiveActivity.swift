// TransferLiveActivity.swift  (Phase 10A · U70)
// Wires the three SwiftUI surfaces (LockScreenCard,
// DynamicIslandExpanded, DynamicIslandCompact) into the
// `ActivityConfiguration` API so iOS can present the live activity
// on the lock screen, in the Dynamic Island, and in the minimal
// pill state.
//
// All copy and styling decisions live inside the surface views —
// this file is structural only.

import ActivityKit
import SwiftUI
import WidgetKit

public struct TransferLiveActivity: Widget {

    public init() {}

    public var body: some WidgetConfiguration {
        ActivityConfiguration(for: KolaleafTransferAttributes.self) { context in
            // Lock-screen / banner presentation.
            LockScreenCard(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(KolaColors.surface)
                .activitySystemActionForegroundColor(KolaColors.ink)
        } dynamicIsland: { context in
            let expanded = DynamicIslandExpanded(
                attributes: context.attributes,
                state: context.state
            )
            let compact = DynamicIslandCompact(
                attributes: context.attributes,
                state: context.state
            )
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { expanded.leadingRegion }
                DynamicIslandExpandedRegion(.trailing) { expanded.trailingRegion }
                DynamicIslandExpandedRegion(.bottom) { expanded.bottomRegion }
            } compactLeading: {
                compact.leading
            } compactTrailing: {
                compact.trailing
            } minimal: {
                // Multi-app DI compression — show K mark only.
                KolaMark(size: 18, tint: LiveActivityStyle.tint(for: context.state.state))
            }
            .keylineTint(KolaColors.trustGreen)
            // ADV-P10A-C2 / API-1007: percent-encode the transferId.
            .widgetURL(TransferDeepLink.url(forTransferId: context.attributes.transferId))
        }
    }
}
