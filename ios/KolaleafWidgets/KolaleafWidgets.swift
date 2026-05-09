// KolaleafWidgets.swift  (Phase 10 stub · U65)
// Widget Extension @main bundle. Empty in Phase 0; populated when Phase 10 implements
// the TransferLiveActivity ActivityConfiguration.

import WidgetKit
import SwiftUI

@main
struct KolaleafWidgetsBundle: WidgetBundle {
    var body: some Widget {
        // TransferLiveActivity()  // wired in Phase 10 (U70)
        StubWidget()
    }
}

/// Placeholder widget so the extension target builds in Phase 0. Replaced in Phase 10.
struct StubWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.kolaleaf.app.stub", provider: StubProvider()) { entry in
            Text("Kolaleaf").font(.caption).padding()
        }
        .configurationDisplayName("Kolaleaf")
        .description("Placeholder — replaced by Live Activities in Phase 10.")
        .supportedFamilies([.systemSmall])
    }
}

private struct StubProvider: TimelineProvider {
    func placeholder(in context: Context) -> StubEntry { StubEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (StubEntry) -> Void) {
        completion(StubEntry(date: Date()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<StubEntry>) -> Void) {
        completion(Timeline(entries: [StubEntry(date: Date())], policy: .never))
    }
}

private struct StubEntry: TimelineEntry { let date: Date }
