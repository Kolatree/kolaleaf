// DynamicIslandExpanded.swift  (Phase 10A · U68)
// Long-press / push-priority expanded Dynamic Island composition.
//
// Splits into three regions to satisfy ActivityKit's
// `DynamicIslandExpandedRegion(.leading|.trailing|.bottom)` API:
//   • leadingRegion  — header (mark + Kolaleaf)
//   • trailingRegion — elapsed time stamp ("12m")
//   • bottomRegion   — amount row + timeline + stage + actions
//
// One file = one View struct. The DSL composition lives in
// `TransferLiveActivity.swift` (U70).
//
// `now` is injected (default `Date()`) so the snapshot suite can pin
// the elapsed badge — see ADV-P10A-C6.

import SwiftUI

@MainActor
struct DynamicIslandExpanded {
    let attributes: KolaleafTransferAttributes
    let state: KolaleafTransferAttributes.ContentState
    var now: Date = Date()

    // MARK: - Leading region (header)

    @ViewBuilder
    var leadingRegion: some View {
        HStack(spacing: 6) {
            KolaMark(size: 16, tint: LiveActivityStyle.tint(for: state.state))
            Text(LiveActivityCopyLint.assertNotForbidden("Kolaleaf"))
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(KolaColors.ink)
            Spacer(minLength: 0)
        }
        .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Trailing region (elapsed badge)

    @ViewBuilder
    var trailingRegion: some View {
        let elapsed = LiveActivityFormat.elapsed(since: state.lastUpdate, now: now)
        Text(elapsed)
            .font(.system(size: 11, weight: .semibold).monospacedDigit())
            .foregroundColor(KolaColors.muted)
            .accessibilityLabel("Updated \(elapsed) ago")
    }

    // MARK: - Bottom region (amounts + timeline + stage + actions)

    @ViewBuilder
    var bottomRegion: some View {
        let descriptor = LiveActivityStyle.descriptor(
            for: state.state,
            recipientName: attributes.recipientName
        )
        let tint = descriptor.tint
        VStack(alignment: .leading, spacing: 8) {
            // Amount row + FX rate caption
            HStack(spacing: 8) {
                Text(attributes.audAmount)
                    .font(.system(size: 14, weight: .semibold).monospacedDigit())
                    .foregroundColor(KolaColors.ink)
                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(KolaColors.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text(attributes.ngnAmount)
                        .font(.system(size: 14, weight: .semibold).monospacedDigit())
                        .foregroundColor(KolaColors.trustGreen)
                    // ADV-P10A-W7: surface exchangeRate.
                    Text(attributes.exchangeRate)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundColor(KolaColors.muted)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(LiveActivityAccessibility.amountLabel(
                aud: attributes.audAmount,
                ngn: attributes.ngnAmount
            ))

            // Mini timeline
            LiveActivityProgressBar(state: state.state)
                .frame(height: 4)

            // Stage line
            HStack(spacing: 6) {
                Image(systemName: descriptor.glyph)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(tint)
                Text(LiveActivityCopyLint.assertNotForbidden(
                    state.stageLabel.isEmpty ? attributes.recipientName : state.stageLabel
                ))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(KolaColors.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }

            // Action row — both deep-link the host app via `kolaleaf://`.
            // ADV-P10A-C2 / W8 / API-1007: percent-encode the
            // transferId so a slash / question mark / space in an
            // exotic id does not produce a malformed URL or a nil.
            HStack(spacing: 8) {
                Link(destination: TransferDeepLink.url(forTransferId: attributes.transferId)) {
                    Text("View detail")
                        .font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(tint.opacity(0.15))
                        )
                        .foregroundColor(tint)
                }
                Link(destination: TransferDeepLink.appRoot) {
                    Text("Open Kolaleaf")
                        .font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(KolaColors.border, lineWidth: 1)
                        )
                        .foregroundColor(KolaColors.ink)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - Deep-link URL builders (shared with TransferLiveActivity)

/// Centralised deep-link factory so the percent-encoding contract is
/// applied consistently and the unit tests (`DeepLinkURLTests`) can
/// reach a single resolver. The string-literal `kolaleaf://` fallback
/// is intentionally `URL(string:)!` — the literal is known-safe.
enum TransferDeepLink {
    /// Bare app deep-link. Foregrounds the app on tap; no routing.
    static let appRoot: URL = URL(string: "kolaleaf://")!

    /// `kolaleaf://transfer/<percent-encoded transferId>`. Returns the
    /// app root URL when the transferId fails to encode (defensive — we
    /// never crash on widget input).
    ///
    /// The character set is `.urlPathAllowed` minus `/` and `?`: the
    /// transferId must be a single path segment, so a slash inside an
    /// id becomes `%2F` and a `?` becomes `%3F` instead of leaking
    /// into URL.host / URL.query slots respectively.
    static func url(forTransferId transferId: String) -> URL {
        let encoded = transferId.addingPercentEncoding(
            withAllowedCharacters: pathSegmentAllowed
        ) ?? transferId
        return URL(string: "kolaleaf://transfer/\(encoded)") ?? appRoot
    }

    /// `.urlPathAllowed` minus the path-segment delimiters (`/` `?`).
    private static let pathSegmentAllowed: CharacterSet = {
        var s = CharacterSet.urlPathAllowed
        s.remove(charactersIn: "/?")
        return s
    }()
}
