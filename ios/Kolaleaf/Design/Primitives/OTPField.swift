// OTPField.swift  (Phase 1 · U18)
// Reusable N-digit OTP input. Auto-advance on type, backspace-into-previous,
// SMS autofill via a hidden `.oneTimeCode` TextField, error state with optional
// shake. Logic lives in OTPFieldModel for unit-testability without ViewInspector.

import SwiftUI

/// Mutable state machine that backs `OTPField`. Public-internal so the View body
/// reads/writes the same slots that tests assert on.
@MainActor
public final class OTPFieldModel: ObservableObject {

    /// Per-box single-digit string. Always exactly `length` elements.
    @Published public var digits: [String]

    /// `nil` means no box is focused (entry complete or initial state).
    @Published public var focusedIndex: Int?

    /// True after `setError(true)` until the next input event.
    @Published public private(set) var isError: Bool = false

    public let length: Int
    private let onComplete: (String) -> Void

    /// Builds a model with `length` empty boxes. `onComplete` fires every time the
    /// boxes fully fill (and again after a reset + refill).
    public init(length: Int = 6, onComplete: @escaping (String) -> Void) {
        precondition(length > 0, "OTPFieldModel length must be positive")
        self.length = length
        self.digits = Array(repeating: "", count: length)
        self.onComplete = onComplete
    }

    /// Concatenated value of all boxes (may be shorter than `length`).
    public var value: String { digits.joined() }

    /// True iff every box has a digit.
    public var isComplete: Bool { digits.allSatisfy { !$0.isEmpty } }

    /// Move focus to the first empty slot (or 0 if all are empty).
    public func beginEditing() {
        focusedIndex = digits.firstIndex(where: { $0.isEmpty }) ?? 0
    }

    /// Accept a single keystroke. Non-digits are silently rejected.
    /// Multi-char strings consume only the first digit (UIKit `shouldChangeCharactersIn` quirk).
    public func input(_ raw: String) {
        guard let digit = raw.first(where: { $0.isASCII && $0.isNumber }) else { return }
        if isError { isError = false }

        let idx = focusedIndex ?? digits.firstIndex(where: { $0.isEmpty }) ?? (length - 1)
        guard idx < length else { return }

        digits[idx] = String(digit)

        if idx + 1 < length {
            focusedIndex = idx + 1
        } else {
            focusedIndex = nil
            fireCompletionIfReady()
        }
    }

    /// Distribute pasted text across boxes. Strips non-digits, truncates to `length`.
    /// Used both by paste and by the hidden `.oneTimeCode` SMS autofill capture.
    public func paste(_ raw: String) {
        if isError { isError = false }
        let cleaned = raw.unicodeScalars
            .filter { CharacterSet.decimalDigits.contains($0) }
            .map { String($0) }
            .prefix(length)

        for (i, ch) in cleaned.enumerated() { digits[i] = ch }
        for i in cleaned.count..<length { digits[i] = "" }

        if isComplete {
            focusedIndex = nil
            fireCompletionIfReady()
        } else {
            focusedIndex = cleaned.count
        }
    }

    /// Backspace key. Two cases:
    /// 1. Current box has content → clear it in place, focus stays.
    /// 2. Current box is empty   → move focus to the previous box AND clear it.
    public func backspace() {
        if isError { isError = false }
        let idx = focusedIndex ?? (length - 1)
        guard idx >= 0, idx < length else { return }

        if !digits[idx].isEmpty {
            digits[idx] = ""
            focusedIndex = idx
            return
        }
        // Empty current box: jump back.
        if idx == 0 { return }
        let prev = idx - 1
        digits[prev] = ""
        focusedIndex = prev
    }

    /// Toggle the error highlight. Cleared automatically on the next input event.
    public func setError(_ on: Bool) {
        isError = on
    }

    /// Wipe all digits + error state, return focus to box 0.
    public func reset() {
        digits = Array(repeating: "", count: length)
        isError = false
        focusedIndex = 0
        completionFiredForCurrentValue = false
    }

    // MARK: - Completion latch
    //
    // Without a latch, every keystroke past the last box would re-fire onComplete.
    // The latch resets when `reset()` runs OR when any digit is cleared, so a
    // user who corrects a mistake and refills gets a second callback.

    private var completionFiredForCurrentValue = false

    private func fireCompletionIfReady() {
        guard isComplete, !completionFiredForCurrentValue else { return }
        completionFiredForCurrentValue = true
        onComplete(value)
    }
}

// MARK: - View

/// Six-digit OTP input. Backed by `OTPFieldModel`; tests target the model directly.
public struct OTPField: View {
    @ObservedObject var model: OTPFieldModel
    public var disabled: Bool = false

    @FocusState private var focusedBox: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Wrap an existing model. Use this form when the parent view needs a binding
    /// to the value (e.g., wires it into a ViewModel).
    public init(model: OTPFieldModel, disabled: Bool = false) {
        self.model = model
        self.disabled = disabled
    }

    public var body: some View {
        ZStack(alignment: .topLeading) {
            // Hidden one-time-code field. Catches SMS autofill from iOS keyboard
            // and forwards the full code to the visible boxes via `paste()`.
            // Sized to zero so it never receives taps; .accessibilityHidden keeps
            // it out of VoiceOver.
            TextField("", text: bridgeBinding)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .frame(width: 0, height: 0)
                .opacity(0.001)
                .accessibilityHidden(true)
                .disabled(disabled)

            HStack(spacing: KolaSpacing.s) {
                ForEach(0..<model.length, id: \.self) { i in
                    box(index: i)
                }
            }
            .modifier(ShakeEffect(amount: model.isError && !reduceMotion ? 1 : 0))
            .animation(model.isError && !reduceMotion
                       ? .default
                       : .none,
                       value: model.isError)
        }
        .onAppear { syncFocusFromModel() }
        .onChange(of: model.focusedIndex) { _, new in focusedBox = new }
        .onChange(of: focusedBox) { _, new in
            if model.focusedIndex != new { model.focusedIndex = new }
        }
    }

    // MARK: - Pieces

    @ViewBuilder
    private func box(index i: Int) -> some View {
        let isFocused = focusedBox == i
        let stroke = model.isError
            ? KolaColors.coral
            : (isFocused ? KolaColors.greenLight : KolaColors.Frosted.border)

        TextField("", text: digitBinding(at: i))
            .keyboardType(.numberPad)
            .multilineTextAlignment(.center)
            .font(KolaFont.amountSmall)
            .foregroundStyle(KolaColors.whiteOnGradient)
            .focused($focusedBox, equals: i)
            .frame(minWidth: KolaSpacing.hitTarget,
                   minHeight: KolaSpacing.hitTarget)
            .padding(.vertical, KolaSpacing.xs)
            .background(KolaColors.Frosted.background)
            .overlay(
                RoundedRectangle(cornerRadius: KolaRadius.chip)
                    .stroke(stroke, lineWidth: isFocused ? 1.5 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: KolaRadius.chip))
            .disabled(disabled)
            .accessibilityLabel(Text("Digit \(i + 1) of \(model.length)"))
    }

    // MARK: - Bindings

    /// Bridges the hidden one-time-code TextField to `model.paste(_:)`. The
    /// TextField sets its own text on autofill; we read on every set and forward.
    private var bridgeBinding: Binding<String> {
        Binding(
            get: { "" }, // always empty so the field stays invisible to subsequent autofill
            set: { newValue in
                guard !newValue.isEmpty else { return }
                model.paste(newValue)
            }
        )
    }

    /// Per-box binding. SwiftUI calls `set` with the full string after a keystroke;
    /// we route to `input()` (single char) or `backspace()` (cleared field).
    private func digitBinding(at i: Int) -> Binding<String> {
        Binding(
            get: { model.digits[i] },
            set: { newValue in
                let prev = model.digits[i]
                if newValue.count > 1 {
                    // User pasted into a single box; treat as full paste.
                    model.paste(newValue)
                    return
                }
                if newValue.isEmpty {
                    if !prev.isEmpty {
                        // Cleared by user — keep the slot empty; backspace handler will
                        // run on the next deletion if needed.
                        model.digits[i] = ""
                    } else {
                        model.backspace()
                    }
                    return
                }
                model.input(newValue)
            }
        )
    }

    private func syncFocusFromModel() {
        if focusedBox != model.focusedIndex { focusedBox = model.focusedIndex }
    }
}

// MARK: - Shake effect

/// Horizontal shake used for the error state. `prefersReducedMotion` callers
/// pass `amount: 0` to skip the animation.
private struct ShakeEffect: GeometryEffect {
    var amount: CGFloat = 0
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }
    func effectValue(size: CGSize) -> ProjectionTransform {
        let dx = sin(amount * .pi * 4) * 6
        return ProjectionTransform(CGAffineTransform(translationX: dx, y: 0))
    }
}
