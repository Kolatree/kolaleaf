// ShareReceiptRenderer.swift  (Phase 7 · U51 → iter-2 W4/W11/W9/S1/S4/S7)
// Renders a 1080×1920 portrait PNG of the transfer receipt for
// WhatsApp Status share. The image carries:
//   • Kolaleaf wordmark + leaf glyph
//   • Recipient first name (W11 — full name only via opt-in toggle)
//   • Send amount in AUD + received amount in NGN (or `—` if unset)
//   • Date (transfer.completedAt when present, else Date())
//   • Tagline "Sent in X · best rate" (timing placeholder)
//
// What it MUST NOT carry (privacy/PII):
//   • The user's own PayID / bank account
//   • The user's full name (one-tap public share)
//   • The transfer id (database row identifier — could be probed)
//   • The recipient's last name (W11 default — opt-in only)
//
// Iter-2 fixes:
//   • W4 / CA-003: moved to Design/Primitives (was Features/Send).
//   • W11 / ADV-P7-W5: `useFullName` parameter; default false.
//   • W9 / ADV-P7-W3: `—` for nil/zero-rate NGN instead of `₦0`.
//   • S1 / OO-006: DEBUG `assertionFailure` on ImageRenderer.uiImage
//     == nil (release keeps the blank fallback so the share sheet
//     never crashes a user mid-share).
//   • S4 / API-004: struct-with-config instead of enum-namespace.
//     `.whatsApp` is the canonical aspect; future aspects (square,
//     story-9:16-cropped) add static instances without API churn.
//   • S7 / ADV-P7-S2: `transfer.completedAt ?? Date()` instead of
//     baking in render-time.
//   • C2 / OO-001: AUD/NGN via shared `AmountFormatter`.

import SwiftUI
import UIKit

@MainActor
public struct ShareReceiptRenderer {

    /// Canvas aspect for a single render. S4 / API-004 — surfaced so
    /// future aspects (square, story-9:16-cropped) add another static
    /// instance without API churn.
    public struct Aspect: Equatable, Sendable {
        public let width: CGFloat
        public let height: CGFloat
        public init(width: CGFloat, height: CGFloat) {
            self.width = width
            self.height = height
        }
        /// WhatsApp Status — 1080×1920, 9:16.
        public static let portrait1080x1920 = Aspect(width: 1080, height: 1920)
    }

    public let aspect: Aspect

    public init(aspect: Aspect = .portrait1080x1920) {
        self.aspect = aspect
    }

    /// Canonical WhatsApp Status renderer. Call sites read
    /// `ShareReceiptRenderer.whatsApp.render(...)`.
    public static let whatsApp = ShareReceiptRenderer(aspect: .portrait1080x1920)

    // MARK: - Back-compat shims

    /// Iter-1 `targetWidth`/`targetHeight` surface, preserved so the
    /// existing snapshot test continues to read the canvas dimensions
    /// off the type rather than the instance.
    public static let targetWidth: CGFloat = Aspect.portrait1080x1920.width
    public static let targetHeight: CGFloat = Aspect.portrait1080x1920.height

    /// Render the receipt to UIImage. Pure function — no global state.
    ///
    /// - Parameter useFullName: when false (default), the recipient's
    ///   first name only appears on the image. W11 / ADV-P7-W5.
    public func render(
        transfer: Transfer,
        recipient: Recipient,
        useFullName: Bool = false
    ) -> UIImage {
        let view = ShareReceiptCard(
            aspect: aspect,
            transfer: transfer,
            recipient: recipient,
            useFullName: useFullName
        )
        .frame(width: aspect.width, height: aspect.height)
        let renderer = ImageRenderer(content: view)
        // Render at 1x — we already lay out at the final 1080×1920
        // pixel canvas. Scale 3x would balloon the export to 3240×5760,
        // which WhatsApp resizes anyway.
        renderer.scale = 1.0
        guard let img = renderer.uiImage else {
            // S1 / OO-006: in DEBUG, surface the impossible-case loud
            // so a regression is caught at dev time. Release keeps the
            // blank-canvas fallback so the share sheet never crashes
            // a user mid-share.
            assertionFailure(
                "ShareReceiptRenderer.uiImage was nil; fixed-frame SwiftUI tree cannot fail layout"
            )
            return Self.fallback(size: CGSize(width: aspect.width, height: aspect.height))
        }
        return img
    }

    /// Truncates a name to the first 32 characters with an ellipsis,
    /// so long imports render cleanly inside the card.
    /// Exposed for unit tests.
    public static func truncatedName(_ name: String, limit: Int = 32) -> String {
        guard name.count > limit else { return name }
        return name.prefix(limit - 1) + "…"
    }

    /// Iter-1 static-render shim. Preserved so existing call sites
    /// + snapshot tests keep compiling during the S4 / API-004
    /// migration to struct-with-config. New code MUST use
    /// `ShareReceiptRenderer.whatsApp.render(...)`.
    public static func render(transfer: Transfer, recipient: Recipient) -> UIImage {
        whatsApp.render(transfer: transfer, recipient: recipient)
    }

    private static func fallback(size: CGSize) -> UIImage {
        UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
        }
    }
}

// MARK: - Render tree

/// The SwiftUI view that becomes the share image. Internal to the
/// renderer surface — outside of the share flow, the receipt is
/// drawn by `ReceiptView`.
struct ShareReceiptCard: View {
    let aspect: ShareReceiptRenderer.Aspect
    let transfer: Transfer
    // TODO(CA): W1 / OO-003 — `Recipient` is a DTO doubling as a
    // domain type. Migrate to DomainRecipient when the Transfer-style
    // split lands.
    let recipient: Recipient
    let useFullName: Bool

    private var sendAmountText: String {
        // C2 / OO-001: shared formatter.
        AmountFormatter.aud(transfer.sendAmount)
    }

    private var receiveAmountText: String {
        // W9 / ADV-P7-W3: refuse to render `₦0` when both the explicit
        // receive amount AND the exchange rate are missing. The dash
        // signals "data not in yet" instead of a settled zero.
        if let received = transfer.receiveAmount {
            return AmountFormatter.ngn(received)
        }
        let rate = transfer.exchangeRate
        guard rate > 0 else { return "—" }
        return AmountFormatter.ngn(transfer.sendAmount * rate)
    }

    private var dateText: String {
        // S7 / ADV-P7-S2: prefer the server timestamp; fall back to
        // `Date()` if the backend hasn't shipped completedAt yet.
        let date = transfer.completedAt ?? Date()
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy"
        return f.string(from: date)
    }

    /// W11 / ADV-P7-W5: first-name-only by default. Caller's opt-in
    /// toggle in `ReceiptView` flips this back to full name.
    private var displayRecipientName: String {
        let name = useFullName ? recipient.fullName : recipient.firstName
        return ShareReceiptRenderer.truncatedName(name)
    }

    var body: some View {
        ZStack {
            LinearGradient(
                stops: KolaColors.wallpaperStops,
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(spacing: 64) {
                Spacer().frame(height: 80)
                brand
                amounts
                Spacer().frame(height: 24)
                recipientLine
                Spacer()
                footer
                Spacer().frame(height: 80)
            }
            .padding(.horizontal, 96)
            .frame(width: aspect.width, height: aspect.height)
        }
        .frame(width: aspect.width, height: aspect.height)
        // ImageRenderer respects `colorScheme` from the environment;
        // pin to light so the share image is consistent regardless of
        // the user's system theme.
        .environment(\.colorScheme, .light)
    }

    private var brand: some View {
        HStack(spacing: 16) {
            Circle()
                .fill(KolaColors.trustGreen)
                .frame(width: 56, height: 56)
                .overlay(
                    Image(systemName: "leaf.fill")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(.white)
                )
            Text("Kolaleaf")
                .font(.system(size: 48, weight: .bold))
                .foregroundStyle(KolaColors.kolaGreen)
        }
    }

    private var amounts: some View {
        VStack(spacing: 24) {
            Text(sendAmountText)
                .font(.system(size: 96, weight: .heavy))
                .foregroundStyle(KolaColors.textPrimary)
                .accessibilityIdentifier("share.amount.sent")
            Text("became")
                .font(.system(size: 32, weight: .regular))
                .foregroundStyle(KolaColors.textSecondary)
            Text(receiveAmountText)
                .font(.system(size: 84, weight: .heavy))
                .foregroundStyle(KolaColors.leafGreen)
                .accessibilityIdentifier("share.amount.received")
        }
    }

    private var recipientLine: some View {
        VStack(spacing: 12) {
            Text("To")
                .font(.system(size: 32, weight: .regular))
                .foregroundStyle(KolaColors.textSecondary)
            Text(displayRecipientName)
                .font(.system(size: 56, weight: .bold))
                .foregroundStyle(KolaColors.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .accessibilityIdentifier("share.recipient.name")
        }
    }

    private var footer: some View {
        VStack(spacing: 16) {
            Text(dateText)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(KolaColors.textSecondary)
            Text("Sent through Kolaleaf · best available rate")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(KolaColors.hopeGold)
        }
    }
}
