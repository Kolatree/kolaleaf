// ShakeToReport.swift  (Phase 12 · shake-to-report)

import SwiftUI

public extension View {
    func shakeToReport(activeDraft: Binding<FeedbackDraft?>) -> some View {
        modifier(ShakeToReportModifier(activeDraft: activeDraft))
    }
}

private struct ShakeToReportModifier: ViewModifier {
    @Binding var activeDraft: FeedbackDraft?

    func body(content: Content) -> some View {
        content.background(
            ShakeDetector {
                activeDraft = FeedbackDraftFactory.make(source: .shake)
            }
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        )
    }
}

#if canImport(UIKit)
private struct ShakeDetector: UIViewControllerRepresentable {
    let onShake: @MainActor () -> Void

    func makeUIViewController(context: Context) -> ShakeResponderViewController {
        ShakeResponderViewController(onShake: onShake)
    }

    func updateUIViewController(
        _ uiViewController: ShakeResponderViewController,
        context: Context
    ) {
        uiViewController.onShake = onShake
    }
}

@MainActor
private final class ShakeResponderViewController: UIViewController {
    var onShake: @MainActor () -> Void

    init(onShake: @escaping @MainActor () -> Void) {
        self.onShake = onShake
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var canBecomeFirstResponder: Bool { true }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    override func viewWillDisappear(_ animated: Bool) {
        resignFirstResponder()
        super.viewWillDisappear(animated)
    }

    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        guard motion == .motionShake else { return }
        onShake()
    }
}
#else
private struct ShakeDetector: View {
    let onShake: @MainActor () -> Void
    var body: some View { EmptyView() }
}
#endif
