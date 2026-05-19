// FeedbackReportView.swift  (Phase 12 · shake-to-report)

import SwiftUI

public struct FeedbackReportView: View {
    private let draft: FeedbackDraft

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var mailOpenFailed = false

    public init(draft: FeedbackDraft) {
        self.draft = draft
    }

    public var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: KolaSpacing.card) {
                VStack(alignment: .leading, spacing: KolaSpacing.s) {
                    Text("Report a problem")
                        .font(KolaFont.section)
                        .foregroundStyle(KolaColors.textPrimary)
                    Text("Kolaleaf will open an editable email draft. Add only the details you want support to review.")
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: KolaSpacing.xs) {
                    Text("Diagnostics")
                        .font(KolaFont.fieldLabel)
                        .textCase(.uppercase)
                        .kerning(KolaKerning.label)
                        .foregroundStyle(KolaColors.textSecondary)
                    Text("No screenshot, logs, account details, transfer IDs, phone numbers, or email addresses are attached automatically.")
                        .font(KolaFont.row)
                        .foregroundStyle(KolaColors.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(KolaSpacing.l)
                .background(
                    RoundedRectangle(cornerRadius: KolaRadius.card)
                        .fill(KolaColors.Card.background)
                )

                Button {
                    openMailDraft()
                } label: {
                    Label("Open email draft", systemImage: "envelope.fill")
                        .font(KolaFont.cta)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KolaSpacing.m)
                }
                .buttonStyle(.plain)
                .background(KolaColors.trustGreen)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: KolaRadius.cta))

                Spacer(minLength: 0)
            }
            .padding(KolaSpacing.xl)
            .background(KolaColors.surface.ignoresSafeArea())
            .navigationTitle("Support")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .alert("Couldn't open email", isPresented: $mailOpenFailed) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Email support at \(FeedbackDraftFactory.supportAddress).")
            }
        }
    }

    private func openMailDraft() {
        guard let url = FeedbackDraftFactory.mailtoURL(for: draft) else {
            mailOpenFailed = true
            return
        }
        openURL(url) { accepted in
            if accepted {
                dismiss()
            } else {
                mailOpenFailed = true
            }
        }
    }
}

#Preview {
    FeedbackReportView(
        draft: FeedbackDraftFactory.make(
            source: .shake,
            environment: FeedbackEnvironment(
                appVersion: "1.0",
                build: "1",
                osVersion: "iOS 18.6",
                deviceModel: "iPhone"
            )
        )
    )
}
