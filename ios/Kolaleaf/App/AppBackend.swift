// AppBackend.swift
// Central backend selection for the native app.

import Foundation

public enum AppBackend {
    /// Hosted Railway backend exposed through the production custom domain.
    /// TestFlight and normal iPhone installs do not receive launch-time
    /// environment variables, so this is the app's canonical fallback.
    public static let hostedBaseURLString = "https://www.kolaleaf.com"

    public static var baseURL: URL {
        let urlString = ProcessInfo.processInfo.environment["KOLA_API_BASE_URL"]
            ?? hostedBaseURLString
        guard let url = URL(string: urlString) else {
            fatalError("KOLA_API_BASE_URL is invalid: \(urlString)")
        }
        return url
    }

    public static var fallbackBaseURL: URL {
        URL(string: hostedBaseURLString)!
    }
}
