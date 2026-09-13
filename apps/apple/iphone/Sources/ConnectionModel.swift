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

    init() {
        serverURLText = UserDefaults.standard.string(forKey: Self.serverKey) ?? ""
    }

    var isConnected: Bool {
        if case .connected = state { return true }
        return false
    }

    var statusText: String {
        switch state {
        case .idle:
            return "Server not configured"
        case .connecting:
            return "Connecting…"
        case .connected:
            return "Connected"
        case .failed(let message):
            return message
        }
    }

    func connect() async {
        state = .connecting
        health = nil

        do {
            let baseURL = try secureBaseURL(from: serverURLText)
            let healthURL = baseURL
                .appendingPathComponent("api", isDirectory: true)
                .appendingPathComponent("health", isDirectory: false)

            var request = URLRequest(url: healthURL)
            request.httpMethod = "GET"
            request.timeoutInterval = 10
            request.cachePolicy = .reloadIgnoringLocalCacheData

            let (data, response) = try await URLSession.shared.data(for: request)
            guard
                let http = response as? HTTPURLResponse,
                (200..<300).contains(http.statusCode)
            else {
                throw ConnectionError.invalidResponse
            }

            let decoded = try JSONDecoder().decode(WaxloomHealth.self, from: data)
            guard decoded.status == "ok" else {
                throw ConnectionError.serverNotReady
            }

            serverURLText = baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            UserDefaults.standard.set(serverURLText, forKey: Self.serverKey)
            health = decoded
            state = .connected
        } catch {
            state = .failed(error.localizedDescription)
        }
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
        case invalidResponse
        case serverNotReady

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "Enter a valid Waxloom HTTPS address."
            case .httpsRequired:
                return "HTTPS is required. Use the private Tailscale HTTPS endpoint."
            case .invalidResponse:
                return "Waxloom did not return a valid health response."
            case .serverNotReady:
                return "Waxloom is reachable but not ready."
            }
        }
    }
}
