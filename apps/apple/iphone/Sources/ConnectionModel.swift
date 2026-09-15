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
    private static let passiveConnectWait: TimeInterval = 6

    private struct ConnectionFlight {
        let id: UUID
        let endpoint: String
        let task: Task<Void, Never>
    }

    private final class ConnectionWaitGate {
        private let lock = NSLock()
        private var finished = false

        func finish(_ continuation: CheckedContinuation<Void, Never>) {
            lock.lock()
            guard !finished else {
                lock.unlock()
                return
            }
            finished = true
            lock.unlock()
            continuation.resume()
        }
    }

    private var connectionFlight: ConnectionFlight?
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

    // Automatic/background callers should not inherit the full transport retry
    // budget. The shared connection flight keeps running, but this caller regains
    // control after a short bounded wait. Explicit user Connect still calls
    // `connect()` and awaits the complete check.
    func connectSavedIfNeeded() async {
        guard !serverURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard !isConnected else { return }

        let gate = ConnectionWaitGate()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            Task { @MainActor [weak self] in
                if let self {
                    await self.connect()
                }
                gate.finish(continuation)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.passiveConnectWait) {
                gate.finish(continuation)
            }
        }
    }

    func connect() async {
        let requestedURL: URL
        do {
            requestedURL = try secureBaseURL(from: serverURLText)
        } catch {
            health = nil
            connectedServerURL = nil
            state = .failed(error.localizedDescription)
            return
        }

        let endpoint = canonicalString(requestedURL)

        if isConnected, connectedServerURL == endpoint {
            return
        }

        // Every caller requesting the same endpoint awaits the exact same task.
        // If another endpoint is currently being checked, wait for that flight to
        // settle first, then re-evaluate this endpoint instead of racing it.
        if let active = connectionFlight {
            await active.task.value
            if isConnected, connectedServerURL == endpoint {
                return
            }
            if active.endpoint == endpoint {
                return
            }
        }

        let flightID = UUID()
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.performConnection(baseURL: requestedURL, endpoint: endpoint)
        }
        connectionFlight = ConnectionFlight(id: flightID, endpoint: endpoint, task: task)

        await task.value

        // A waiter for another endpoint may already have installed the next
        // flight. Never clear a newer task when this older caller resumes.
        if connectionFlight?.id == flightID {
            connectionFlight = nil
        }
    }

    private func performConnection(baseURL: URL, endpoint: String) async {
        guard isCurrentEndpoint(endpoint) else { return }

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

                    // A stale request must never overwrite a URL edited while the
                    // network request was in flight.
                    guard isCurrentEndpoint(endpoint) else {
                        settleStaleFlight(endpoint: endpoint)
                        return
                    }

                    serverURLText = endpoint
                    UserDefaults.standard.set(endpoint, forKey: Self.serverKey)
                    connectedServerURL = endpoint
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
            guard isCurrentEndpoint(endpoint) else {
                settleStaleFlight(endpoint: endpoint)
                return
            }
            connectedServerURL = nil
            health = nil
            state = .failed(error.localizedDescription)
        }
    }

    private func settleStaleFlight(endpoint: String) {
        guard connectionFlight?.endpoint == endpoint else { return }
        connectedServerURL = nil
        health = nil
        state = .idle
    }

    private func isCurrentEndpoint(_ endpoint: String) -> Bool {
        guard let current = try? secureBaseURL(from: serverURLText) else { return false }
        return canonicalString(current) == endpoint
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
