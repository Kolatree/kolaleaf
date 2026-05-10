// SumsubWebView.swift  (Phase 2 · U24b / U24-fallback)
// WKWebView wrapper that hosts the Sumsub WebSDK. R16 config:
//   • `WKWebsiteDataStore.nonPersistent()` — cookies/localStorage do not
//     persist across sessions; the Sumsub session URL carries its own token.
//   • Camera + microphone permission allowlisted to *.sumsub.com origins
//     only — iOS-level permission was granted via Info.plist, but cross-
//     origin iframes inside the WebView must not silently inherit it.
//   • JS bridge `kola` listens for terminal events from the Sumsub main
//     frame only; subframes cannot spoof verdicts.
//   • Cookie isolation: the Sumsub view never shares cookies with the
//     authenticated APIClient cookie jar — `nonPersistent` data store +
//     no inherited storage achieves this.
//
// This is the *fallback* path. The native `IdensicMobileSDK` (U24a) will
// supersede this once the SwiftPM package is added at signing time. The
// presenter (U24c) chooses between native and fallback based on a feature
// flag that defaults OFF at v1 ship.

import SwiftUI
import WebKit

// MARK: - Coordinator

/// Bridges Sumsub WebSDK terminal events + WKWebView lifecycle into a
/// single-shot `onResult` callback. The coordinator holds the callback
/// directly (no Continuation indirection) and uses `didResolve` to enforce
/// one-and-only-one delivery — the first terminal event wins.
@MainActor
public final class SumsubWebViewCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {

    public typealias ResultHandler = @MainActor (SumsubResult) -> Void

    private var onResult: ResultHandler?
    private var didResolve: Bool = false

    public func bind(_ onResult: @escaping ResultHandler) {
        self.onResult = onResult
        self.didResolve = false
    }

    /// Delivers `result` exactly once. Subsequent calls are no-ops so a
    /// duplicate Sumsub event (onApplicantSubmitted followed by
    /// onApplicantStatusChanged) cannot push two routes onto the path.
    public func resolve(_ result: SumsubResult) {
        guard !didResolve, let handler = onResult else { return }
        didResolve = true
        handler(result)
    }

    public var isResolved: Bool { didResolve }

    // MARK: - WKScriptMessageHandler (P0 fix: main-frame guard)

    public func userContentController(_ controller: WKUserContentController,
                                      didReceive message: WKScriptMessage) {
        guard message.name == "kola" else { return }
        // Phase 2 review fix (P0, security SEC-001 / correctness CR-1):
        // reject events from any frame other than the main Sumsub document
        // — analytics iframes / regional partner SDKs / a/b harnesses must
        // not be able to spoof a `verdict("GREEN")` payload.
        guard message.frameInfo.isMainFrame else { return }

        guard let payload = message.body as? [String: Any],
              let event = payload["event"] as? String else { return }

        switch event {
        case "submitted":
            resolve(.submitted)
        case "statusChanged":
            let answer = (payload["answer"] as? String) ?? "UNKNOWN"
            resolve(.verdict(answer: answer))
        case "error":
            let code = (payload["code"] as? String) ?? "sumsub_web_error"
            let msg  = (payload["message"] as? String) ?? "Verification couldn't finish."
            resolve(.failed(code: code, message: msg))
        default:
            break
        }
    }

    // MARK: - WKNavigationDelegate (P0 fix: surface load failures)

    public func webView(_ webView: WKWebView,
                        didFailProvisionalNavigation navigation: WKNavigation!,
                        withError error: Error) {
        resolve(.failed(code: "webview_load_failed",
                        message: error.localizedDescription))
    }

    public func webView(_ webView: WKWebView,
                        didFail navigation: WKNavigation!,
                        withError error: Error) {
        resolve(.failed(code: "webview_navigation_failed",
                        message: error.localizedDescription))
    }

    // MARK: - WKUIDelegate (camera/mic — P1 fix: origin allowlist)

    public func webView(_ webView: WKWebView,
                        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                        initiatedByFrame frame: WKFrameInfo,
                        type: WKMediaCaptureType,
                        decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        // Phase 2 review fix (P1, security SEC-002): the Info.plist usage
        // descriptions authorize the *app* to access camera/mic, but inside
        // a WKWebView a cross-origin iframe can still request capture if
        // the delegate blanket-grants. Restrict to *.sumsub.com over HTTPS.
        let host = origin.host.lowercased()
        let isHttps = origin.protocol.lowercased() == "https"
        let isSumsub = host == "sumsub.com"
            || host.hasSuffix(".sumsub.com")
            || host == "api.sumsub.com"
        if isHttps && isSumsub {
            decisionHandler(.grant)
        } else {
            decisionHandler(.deny)
        }
    }
}

// MARK: - SwiftUI representable

public struct SumsubWebView: UIViewControllerRepresentable {
    public let session: KYCSession
    public let onResult: @MainActor (SumsubResult) -> Void

    public init(session: KYCSession,
                onResult: @escaping @MainActor (SumsubResult) -> Void) {
        self.session = session
        self.onResult = onResult
    }

    public func makeUIViewController(context: Context) -> UIViewController {
        // Bind the coordinator's terminal-event handler before mounting.
        // Phase 2 review fix (P0, correctness CR-1 / swift-ios-001): the
        // coordinator now owns the callback directly — the abandoned
        // CheckedContinuation pattern is gone.
        context.coordinator.bind(onResult)
        return SumsubWebViewController(
            session: session,
            coordinator: context.coordinator
        )
    }

    public func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}

    public func makeCoordinator() -> SumsubWebViewCoordinator {
        SumsubWebViewCoordinator()
    }
}

// MARK: - View controller

/// Owns the WKWebView and applies R16 config. The coordinator owns terminal
/// resolution; this controller drives load + viewDidDisappear cancellation.
final class SumsubWebViewController: UIViewController {

    private let session: KYCSession
    private let coordinator: SumsubWebViewCoordinator
    private var webView: WKWebView?

    init(session: KYCSession, coordinator: SumsubWebViewCoordinator) {
        self.session = session
        self.coordinator = coordinator
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func willMove(toParent parent: UIViewController?) {
        super.willMove(toParent: parent)
        // Phase 2 review fix (P1, security SEC-003 / swift-ios-002):
        // detach the script message handler so the coordinator is not
        // retained beyond the WKWebView's lifetime. WKWebView's
        // userContentController strongly retains every handler registered
        // via `add(_:name:)`. Done here (not in deinit) because deinit is
        // a nonisolated context and WKWebView's mutators are @MainActor.
        // `parent == nil` means the controller is being removed from its
        // parent (sheet dismiss / pop). Idempotent — multiple calls are
        // safe; the second is a no-op.
        if parent == nil { cleanupWebView() }
    }

    private func cleanupWebView() {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "kola")
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
    }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let userContent = WKUserContentController()
        userContent.add(coordinator, name: "kola")
        userContent.addUserScript(Self.sumsubBridgeScript())
        config.userContentController = userContent

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.navigationDelegate = coordinator
        wv.uiDelegate = coordinator
        wv.allowsBackForwardNavigationGestures = false
        wv.scrollView.bounces = false
        view = wv
        webView = wv
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let url = URL(string: session.verificationUrl) else {
            // Phase 2 review fix (P2, swift-ios-006): mark resolved so the
            // viewDidDisappear path doesn't deliver a second .cancelled.
            coordinator.resolve(.failed(
                code: "invalid_url",
                message: "Verification URL is malformed."
            ))
            return
        }
        webView?.load(URLRequest(url: url))
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        // Only emit cancelled if no terminal event won the race. The
        // coordinator's `isResolved` latch is single-shot.
        if !coordinator.isResolved {
            coordinator.resolve(.cancelled)
        }
    }

    /// Phase 2 review fix (P0, security SEC-001): inject the bridge into
    /// the main frame only so subframes cannot post fake terminal events.
    /// Combined with the `frameInfo.isMainFrame` guard in the message
    /// handler this gives defense-in-depth — a stray subframe injection
    /// (via a CSP error or future shared-process-pool refactor) still
    /// can't reach `userContentController(_:didReceive:)`.
    private static func sumsubBridgeScript() -> WKUserScript {
        let js = """
        (function() {
          if (window.__kolaSumsubBridgeInstalled) return;
          window.__kolaSumsubBridgeInstalled = true;
          function post(payload) {
            try {
              window.webkit.messageHandlers.kola.postMessage(payload);
            } catch (_) {}
          }
          // Origin allowlist: only accept events whose source is the same
          // top-level Sumsub frame. e.origin is set by the browser and not
          // forgeable by page JS.
          var ALLOWED = /^https:\\/\\/(?:[a-z0-9-]+\\.)?sumsub\\.com$/i;
          window.addEventListener('message', function(e) {
            if (!e || !e.data) return;
            if (typeof e.origin === 'string' && !ALLOWED.test(e.origin)) return;
            var d = e.data;
            if (typeof d.type !== 'string') return;
            if (d.type === 'idCheck.onApplicantSubmitted') {
              post({ event: 'submitted' });
            } else if (d.type === 'idCheck.onApplicantStatusChanged') {
              var ans = (d.payload && d.payload.reviewAnswer) || 'UNKNOWN';
              post({ event: 'statusChanged', answer: ans });
            } else if (d.type === 'idCheck.onError') {
              var code = (d.payload && d.payload.code) || 'sumsub_web_error';
              var msg  = (d.payload && d.payload.message) || '';
              post({ event: 'error', code: code, message: msg });
            }
          });
        })();
        """
        return WKUserScript(
            source: js,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
    }
}
