// QRCodeRenderer.swift  (Phase 7 iter-2 · W2 / OO-004)
// Shared QR-generation primitive. Iter-1 buried the CIFilter pipeline
// inside `MyPayIDViewModel`; lifting it to a Design primitive lets
// future surfaces (e.g. share-receipt QR, deep-link tickets) reuse
// the same correction-level / scaling choices without re-deriving
// them.
//
// CIContext is process-wide and expensive to instantiate (it lazily
// links Metal/CoreVideo on first call); cached at file scope so each
// `image(for:)` invocation hits the cached pipeline.

import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

public enum QRCodeRenderer {

    /// Cached Core Image context. Safe to share across MainActor and
    /// background-thread callers; `CIContext` is thread-safe per Apple's
    /// CoreImage programming guide.
    private static let context = CIContext()

    /// Render `payload` to a UIImage QR code. Returns nil on Core Image
    /// failures (very rare — typically only on out-of-memory).
    ///
    /// - Parameters:
    ///   - payload: UTF-8 string to encode. Caller decides URI scheme
    ///     (e.g. `payid:ada@example.com`).
    ///   - scale: pixel multiplier applied to the CIImage output before
    ///     rasterisation. Default 10x keeps the QR crisp on @3x retina
    ///     screens after the View resizes it to ~200pt.
    public static func image(
        for payload: String,
        scale: CGFloat = 10
    ) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        // High error-correction so the QR survives WhatsApp's recompression
        // when the user screenshots/shares the screen.
        filter.correctionLevel = "H"
        guard let output = filter.outputImage else { return nil }
        let transform = CGAffineTransform(scaleX: scale, y: scale)
        let scaled = output.transformed(by: transform)
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else {
            return nil
        }
        return UIImage(cgImage: cg)
    }
}
