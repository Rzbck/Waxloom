import Foundation

struct WaxloomHealth: Codable {
    let status: String
    let version: String
    let integrations: [String: Bool]
}

enum WaxloomConnectionState: Equatable {
    case idle
    case connecting
    case connected
    case failed(String)
}

@MainActor
final class ConnectionModel: ObservableObject {
    @Published var serverURLText: String
    @Published private(set) var state: WaxloomConnectionState = .idle
    @Published private(set) var health: WaxloomHealth?

    private static let serverKey = "waxloom.server.https"
    private var connectionCheckInFlight = false
    private var connectedServerURL: String?

    init() {
        serverURLText = UserDefaults.standard.string(forKey: Self.serverKey) ?? ""
    }

    var isConnected: Bool {
        if case .connected = state { return true }
        return false
    }

    var baseURL: URL? {
        try? secureBaseURL(from: serverURLText)
    }

    var statusText: String {
        switch state {
        case .idle:
            return serverURLText.isEmpty ? "Server not configured" : "Saved server ready"
        case .connecting:
            return "Connecting…"
        case .connected:
            return "Connected"
        case .failed(let message):
            return message
        }
    }

    func connectSavedIfNeeded() async {
        guard !serverURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard !isConnected else { return }
        await connect()
    }

    func connect() async {
        let baseURL: URL
        do {
            baseURL = try secureBaseURL(from: serverURLText)
        } catch {
            health = nil
            state = .failed(error.localizedDescription)
            return
        }

        let canonicalURL = canonicalString(baseURL)

        // The root view reconnects automatically on launch. If the user taps
        // Connect at the same time, do not start a second health request that
        // can race the successful automatic connection and overwrite its state.
        if connectionCheckInFlight { return }

        // Once this exact endpoint has been validated, repeated taps on
        // "Connect securely" are intentionally idempotent.
        if isConnected, connectedServerURL == canonicalURL { return }

        connectionCheckInFlight = true
        defer { connectionCheckInFlight = false }

        state = .connecting
        health = nil

        let healthURL = baseURL
            .appendingPathComponent("api", isDirectory: true)
            .appendingPathComponent("health", isDirectory: false)

        var request = URLRequest(url: healthURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = true
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 20
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }

        do {
            var lastTransportError: Error?

            for attempt in 0..<3 {
                do {
                    let (data, response) = try await session.data(for: request)
                    guard let http = response as? HTTPURLResponse else {
                        throw ConnectionError.invalidResponse(statusCode: nil)
                    }

                    guard (200..<300).contains(http.statusCode) else {
                        let error = ConnectionError.invalidResponse(statusCode: http.statusCode)
                        if attempt < 2, Self.isTransient(statusCode: http.statusCode) {
                            try await Task.sleep(for: .milliseconds(350 * (attempt + 1)))
                            continue
                        }
                        throw error
                    }

                    let decoded: WaxloomHealth
                    do {
                        decoded = try JSONDecoder().decode(WaxloomHealth.self, from: data)
                    } catch {
                        throw ConnectionError.invalidHealthPayload
                    }

                    guard decoded.status == "ok" else {
                        throw ConnectionError.serverNotReady
                    }

                    serverURLText = canonicalURL
                    UserDefaults.standard.set(canonicalURL, forKey: Self.serverKey)
                    connectedServerURL = canonicalURL
                    health = decoded
                    state = .connected
                    return
                } catch let error as ConnectionError {
                    throw error
                } catch {
                    lastTransportError = error
                    if attempt < 2 {
                        try await Task.sleep(for: .milliseconds(350 * (attempt + 1)))
                        continue
                    }
                }
            }

            if let lastTransportError {
                throw lastTransportError
            }
            throw ConnectionError.invalidResponse(statusCode: nil)
        } catch {
            connectedServerURL = nil
            health = nil
            state = .failed(error.localizedDescription)
        }
    }

    private func canonicalString(_ url: URL) -> String {
        url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private static func isTransient(statusCode: Int) -> Bool {
        statusCode == 408 || statusCode == 425 || statusCode == 429 || (500...504).contains(statusCode)
    }

    private func secureBaseURL(from raw: String) throws -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, var components = URLComponents(string: trimmed) else {
            throw ConnectionError.invalidURL
        }

        guard components.scheme?.lowercased() == "https" else {
            throw ConnectionError.httpsRequired
        }
        guard
            let host = components.host,
            !host.isEmpty,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil
        else {
            throw ConnectionError.invalidURL
        }

        guard components.path.isEmpty || components.path == "/" else {
            throw ConnectionError.invalidURL
        }

        components.scheme = "https"
        components.path = ""
        guard let url = components.url else {
            throw ConnectionError.invalidURL
        }
        return url
    }

    enum ConnectionError: LocalizedError {
        case invalidURL
        case httpsRequired
        case invalidResponse(statusCode: Int?)
        case invalidHealthPayload
        case serverNotReady

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "Enter a valid Waxloom HTTPS address."
            case .httpsRequired:
                return "HTTPS is required. Use the private Tailscale HTTPS endpoint."
            case .invalidResponse(let statusCode):
                if let statusCode {
                    return "Waxloom health check returned HTTP \(statusCode)."
                }
                return "Waxloom did not return a valid health response."
            case .invalidHealthPayload:
                return "Waxloom health response was not valid JSON."
            case .serverNotReady:
                return "Waxloom is reachable but not ready."
            }
        }
    }
}
