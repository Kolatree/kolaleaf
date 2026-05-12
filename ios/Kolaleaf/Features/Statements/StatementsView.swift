// StatementsView.swift  (Phase 8 · U59)
// Screen 30 — Statements & Tax.
//   • FY rollup card with prev/next chevrons.
//   • Monthly statement rows with PDF / CSV affordances.
//   • Empty state when the FY has zero transfers.

import SwiftUI

public struct StatementsView: View {

    @Environment(\.apiClient) private var apiClient
    @State private var vm: StatementsViewModel?
    /// Toast banner driven by PDF / CSV taps.
    @State private var banner: String?

    public init() {}

    public var body: some View {
        VStack(spacing: 0) {
            switch vm?.state {
            case .none, .idle, .loading:
                loadingState
            case .loaded(let rollup, let rows):
                loadedContent(rollup: rollup, rows: rows)
            case .sessionExpired:
                Text("Session expired")
                    .font(KolaFont.section)
                    .padding()
            case .failed(let message):
                failedState(message: message)
            }
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationTitle("Statements & Tax")
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .bottom) {
            if let banner {
                Text(banner)
                    .font(KolaFont.row)
                    .padding(.horizontal, KolaSpacing.xl)
                    .padding(.vertical, KolaSpacing.s)
                    .background(KolaColors.inkSubtle)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
                    .padding(.bottom, KolaSpacing.xxl)
                    .transition(.opacity)
            }
        }
        .task {
            if vm == nil { vm = StatementsViewModel(api: apiClient) }
            await vm?.load()
        }
    }

    private func loadedContent(
        rollup: Decimal, rows: [StatementsViewModel.MonthlyRow]
    ) -> some View {
        ScrollView {
            VStack(spacing: KolaSpacing.card) {
                fyRollupCard(rollup: rollup)
                if rows.isEmpty {
                    emptyState
                } else {
                    monthList(rows: rows)
                }
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.vertical, KolaSpacing.xxl)
        }
    }

    private func fyRollupCard(rollup: Decimal) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            HStack {
                Button {
                    Task { await vm?.shiftFY(by: -1) }
                } label: {
                    Image(systemName: "chevron.left")
                        .foregroundStyle(KolaColors.textPrimary)
                }
                Spacer()
                Text(fyLabel)
                    .font(KolaFont.section)
                    .foregroundStyle(KolaColors.textPrimary)
                Spacer()
                Button {
                    Task { await vm?.shiftFY(by: 1) }
                } label: {
                    Image(systemName: "chevron.right")
                        .foregroundStyle(KolaColors.textPrimary)
                }
            }
            Text(AmountFormatter.aud(rollup))
                .font(KolaFont.amountMedium)
                .kerning(KolaKerning.amount)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Total sent during this financial year")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(KolaSpacing.card)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg)
                .fill(KolaColors.Card.background)
        )
    }

    private var fyLabel: String {
        let start = vm?.fyStartYear ?? 2025
        return "FY \(start)–\(start + 1)"
    }

    private func monthList(rows: [StatementsViewModel.MonthlyRow]) -> some View {
        VStack(spacing: KolaSpacing.s) {
            ForEach(rows) { row in
                monthRow(row: row)
            }
        }
    }

    private func monthRow(row: StatementsViewModel.MonthlyRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: KolaSpacing.xxs) {
                Text(row.displayName)
                    .font(KolaFont.rowTotal)
                    .foregroundStyle(KolaColors.textPrimary)
                Text("\(row.transferCount) transfers · \(AmountFormatter.aud(row.total))")
                    .font(KolaFont.row)
                    .foregroundStyle(KolaColors.textSecondary)
            }
            Spacer()
            Button {
                presentToast("PDF available shortly")
            } label: {
                Text("PDF")
                    .font(KolaFont.chip)
                    .padding(.horizontal, KolaSpacing.m)
                    .padding(.vertical, KolaSpacing.xs)
                    .background(KolaColors.surfaceSoft)
                    .clipShape(Capsule())
                    .foregroundStyle(KolaColors.textPrimary)
            }
            .buttonStyle(.plain)
            Button {
                presentToast("CSV available shortly")
            } label: {
                Text("CSV")
                    .font(KolaFont.chip)
                    .padding(.horizontal, KolaSpacing.m)
                    .padding(.vertical, KolaSpacing.xs)
                    .background(KolaColors.surfaceSoft)
                    .clipShape(Capsule())
                    .foregroundStyle(KolaColors.textPrimary)
            }
            .buttonStyle(.plain)
        }
        .padding(KolaSpacing.l)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.card)
                .fill(KolaColors.Card.background)
        )
    }

    // MARK: - Other states

    private var emptyState: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("No transfers this FY")
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Once you send money this FY, monthly statements will appear here.")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, KolaSpacing.xxxl)
        .frame(maxWidth: .infinity)
    }

    private var loadingState: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .tint(KolaColors.trustGreen)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func failedState(message: String) -> some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Couldn't load statements")
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text(message)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, KolaSpacing.xl)
            Button("Try again") {
                Task { await vm?.load() }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func presentToast(_ text: String) {
        withAnimation { banner = text }
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            withAnimation { banner = nil }
        }
    }
}
