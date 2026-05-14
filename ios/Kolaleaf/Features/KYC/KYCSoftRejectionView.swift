// KYCSoftRejectionView.swift  (Phase 2 · U26)
// Screen 08: recoverable rejection — "we couldn't verify, please retry."
//
// Wave 1 backend exposes a single REJECTED status with no soft/hard split,
// so iOS treats every REJECTED as retry-eligible at v1 ship. The retry CTA
// calls `POST /api/v1/kyc/retry` (which itself rejects with 409 if no
// longer eligible — that response routes the user to a "contact support"
// hard-rejection variant).
//
// `kycRejectionReasons` display is a backend follow-up: `/kyc/status`
// currently returns only `{ status, applicantId }`. When the route adds
// `rejectionReasons: [string]`, the `reasons` parameter on this view is
// already wired and ready.

import SwiftUI

public struct KYCSoftRejectionView: View {
    /// Reasons surfaced by the backend, when available. Empty array shows
    /// generic copy.
    public let reasons: [String]
    public let onContactSupport: () -> Void

    @State private var vm: KYCSoftRejectionViewModel

    public init(vm: KYCSoftRejectionViewModel,
                reasons: [String] = [],
                onContactSupport: @escaping () -> Void) {
        self._vm = State(initialValue: vm)
        self.reasons = reasons
        self.onContactSupport = onContactSupport
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.card) {
            heading
            reasonsList
            if let err = vm.inlineError {
                Text(err)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .accessibilityLabel("Error: \(err)")
            }
            Spacer()
            retryButton
            supportButton
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xxxl)
        .padding(.bottom, KolaSpacing.homeIndicator)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .kolaWallpaper()
        .navigationBarBackButtonHidden(true)
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Let's try that again")
                .font(KolaFont.headline)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .accessibilityAddTraits(.isHeader)
            Text("We couldn't verify your identity from the documents you sent.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.whiteOnGradientMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, KolaSpacing.l)
    }

    @ViewBuilder
    private var reasonsList: some View {
        if reasons.isEmpty {
            VStack(alignment: .leading, spacing: KolaSpacing.s) {
                bullet("Make sure your ID is in clear focus and well-lit.")
                bullet("All four corners of the document should be visible.")
                bullet("Match your selfie face-on, no sunglasses or hats.")
            }
        } else {
            VStack(alignment: .leading, spacing: KolaSpacing.s) {
                ForEach(reasons, id: \.self) { reason in
                    bullet(friendlyMessage(forCode: reason))
                }
            }
        }
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: KolaSpacing.s) {
            Text("•")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.greenLight)
                .accessibilityHidden(true)
            Text(text)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button {
            Task { await vm.retry() }
        } label: {
            HStack(spacing: KolaSpacing.s) {
                if vm.isSubmitting {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                }
                Text("Try again")
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
            }
            .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                    .fill(vm.isSubmitting ? Color.white.opacity(0.18) : KolaColors.greenLight)
            )
        }
        .disabled(vm.isSubmitting)
        .accessibilityLabel(vm.isSubmitting ? "Retrying" : "Try again")
        .accessibilityHint("Restart the identity verification flow with new documents")
    }

    private var supportButton: some View {
        Button(action: onContactSupport) {
            Text("Contact support")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.whiteOnGradient)
                .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
        }
        .accessibilityHint("Open the help centre in a web view")
    }

    /// Maps known Sumsub rejection codes to friendly copy. Unknown codes
    /// surface as themselves — better than a flat "please retake" since the
    /// human reviewer can correlate.
    private func friendlyMessage(forCode code: String) -> String {
        switch code.uppercased() {
        case "BLURRED_PHOTO":          return "Your photo was too blurry. Please retake in better light."
        case "WRONG_DOC_TYPE":         return "The document type didn't match what we asked for."
        case "EXPIRED_DOC":            return "The document you sent has expired."
        case "INCONSISTENT_PROFILE":   return "Some details didn't match between documents."
        case "SELFIE_MISMATCH":        return "Your selfie didn't match the photo on your ID."
        default:                       return code
        }
    }
}
