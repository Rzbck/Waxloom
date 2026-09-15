import Foundation
import WatchConnectivity

final class WatchRemoteModel: NSObject, ObservableObject {
    @Published private(set) var snapshot = PlaybackSnapshot.idle
    @Published private(set) var phoneReachable = false
    @Published private(set) var pendingCommand: PlaybackCommand?
    @Published private(set) var lastResult: PlaybackCommandResult?
    @Published private(set) var catalogBusy = false
    @Published private(set) var catalogMessage: String?

    private static let commandReplyTimeout: TimeInterval = 3
    private static let catalogCachePrefix = "waxloom.watch.catalog.cache.v2"

    private var pendingToken: String?
    private var lastSnapshotTimestamp: TimeInterval = 0
    private var catalogRequestCount = 0

    override init() {
        super.init()
        activate()
    }

    func send(_ command: PlaybackCommand) {
        guard
            WCSession.isSupported(),
            WCSession.default.activationState == .activated,
            WCSession.default.isReachable,
            pendingToken == nil
        else {
            lastResult = .unavailable
            return
        }

        let token = UUID().uuidString
        let message = WaxloomWatchMessage.command(command, token: token, snapshot: snapshot)
        guard let payload = WaxloomWatchCodec.payload(message) else {
            lastResult = .unsupported
            return
        }

        pendingToken = token
        pendingCommand = command
        lastResult = nil

        // One request, one correlated reply. There is no second acknowledgement
        // message that can be delayed, lost, or reordered independently.
        WCSession.default.sendMessage(payload) { [weak self] reply in
            guard let decoded = WaxloomWatchCodec.message(from: reply) else {
                DispatchQueue.main.async {
                    guard self?.pendingToken == token else { return }
                    self?.pendingToken = nil
                    self?.pendingCommand = nil
                    self?.lastResult = .unsupported
                }
                return
            }

            DispatchQueue.main.async {
                guard self?.pendingToken == token else { return }
                self?.pendingToken = nil
                self?.pendingCommand = nil
                self?.apply(decoded)
            }
        } errorHandler: { [weak self] _ in
            DispatchQueue.main.async {
                guard self?.pendingToken == token else { return }
                self?.pendingToken = nil
                self?.pendingCommand = nil
                self?.lastResult = .unavailable
            }
        }

        // A live transport failure must never freeze all controls for the old
        // eight-second command TTL. Late replies are simply ignored by token.
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.commandReplyTimeout) { [weak self] in
            guard self?.pendingToken == token else { return }
            self?.pendingToken = nil
            self?.pendingCommand = nil
            self?.lastResult = .unavailable
        }
    }

    func load(route: WatchCatalogRoute, id: String? = nil, query: String? = nil) async -> WatchCatalogResponse {
        await catalog(
            WatchCatalogRequest(
                action: .load,
                route: route,
                id: id,
                query: query
            )
        )
    }

    func play(_ item: WatchCatalogItem) async -> WatchCatalogResponse {
        await catalog(WatchCatalogRequest(action: .play, item: item))
    }

    func toggleStar(_ item: WatchCatalogItem) async -> WatchCatalogResponse {
        await catalog(WatchCatalogRequest(action: .toggleStar, item: item))
    }

    func discoveryFeedback(_ item: WatchCatalogItem, value: Int) async -> WatchCatalogResponse {
        await catalog(WatchCatalogRequest(action: .discoveryFeedback, value: value, item: item))
    }

    func rejectBadSource(_ item: WatchCatalogItem) async -> WatchCatalogResponse {
        await catalog(WatchCatalogRequest(action: .badSource, item: item))
    }

    func createPlaylist(name: String) async -> WatchCatalogResponse {
        await catalog(WatchCatalogRequest(action: .createPlaylist, query: name))
    }

    func deletePlaylist(id: String) async -> WatchCatalogResponse {
        await catalog(WatchCatalogRequest(action: .deletePlaylist, id: id))
    }

    func addToPlaylist(playlistID: String, songID: String) async -> WatchCatalogResponse {
        await catalog(
            WatchCatalogRequest(
                action: .addToPlaylist,
                id: playlistID,
                secondaryID: songID
            )
        )
    }

    func removeFromPlaylist(playlistID: String, index: Int) async -> WatchCatalogResponse {
        await catalog(
            WatchCatalogRequest(
                action: .removeFromPlaylist,
                id: playlistID,
                index: index
            )
        )
    }

    func youtubeSearch(artist: String, title: String) async -> WatchCatalogResponse {
        await catalog(
            WatchCatalogRequest(
                action: .youtubeSearch,
                artist: artist,
                title: title
            )
        )
    }

    func youtubeImport(
        item: WatchCatalogItem,
        artist: String,
        title: String,
        authorized: Bool
    ) async -> WatchCatalogResponse {
        await catalog(
            WatchCatalogRequest(
                action: .youtubeImport,
                artist: artist,
                title: title,
                authorized: authorized,
                item: item
            )
        )
    }

    func catalog(_ request: WatchCatalogRequest) async -> WatchCatalogResponse {
        guard
            WCSession.isSupported(),
            WCSession.default.activationState == .activated,
            WCSession.default.isReachable,
            let payload = WatchCatalogCodec.payload(request)
        else {
            if let cached = cachedCatalogResponse(for: request) {
                return cached
            }
            return .failure(token: request.token, message: "iPhone live link unavailable")
        }

        await MainActor.run {
            catalogRequestCount += 1
            catalogBusy = true
            catalogMessage = nil
        }

        let response: WatchCatalogResponse = await withCheckedContinuation { continuation in
            WCSession.default.sendMessage(payload) { reply in
                let decoded = WatchCatalogCodec.response(from: reply)
                    ?? .failure(token: request.token, message: "Invalid iPhone response")
                continuation.resume(returning: decoded)
            } errorHandler: { error in
                continuation.resume(
                    returning: .failure(token: request.token, message: error.localizedDescription)
                )
            }
        }

        if response.ok {
            cacheCatalogResponse(response, for: request)
        }

        await MainActor.run {
            catalogRequestCount = max(0, catalogRequestCount - 1)
            catalogBusy = catalogRequestCount > 0
            catalogMessage = response.ok ? response.message : response.message ?? "Request failed"
        }
        return response
    }

    private func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        phoneReachable = session.isReachable
    }

    private func receive(_ payload: [String: Any]) {
        guard let message = WaxloomWatchCodec.message(from: payload) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.apply(message)
        }
    }

    private func apply(_ message: WaxloomWatchMessage) {
        switch message.kind {
        case .snapshot:
            if let incoming = message.snapshot {
                applySnapshot(incoming, timestamp: message.timestamp)
            }

        case .acknowledgement:
            lastResult = message.result
            if let incoming = message.snapshot {
                applySnapshot(incoming, timestamp: message.timestamp)
            }

        case .command:
            break
        }
    }

    private func applySnapshot(_ incoming: PlaybackSnapshot, timestamp: TimeInterval) {
        // Revision is monotonic only for one iPhone player process. Timestamp is
        // the cross-session ordering key, so an old application-context delivery
        // cannot replace a newer track simply because sessionID changed.
        if timestamp < lastSnapshotTimestamp {
            return
        }
        if timestamp == lastSnapshotTimestamp, incoming.revision < snapshot.revision {
            return
        }
        lastSnapshotTimestamp = timestamp
        snapshot = incoming
    }

    private func catalogCacheKey(for request: WatchCatalogRequest) -> String? {
        guard request.action == .load, let route = request.route else { return nil }
        switch route {
        case .search, .imports:
            return nil
        default:
            let id = request.id ?? "root"
            return "\(Self.catalogCachePrefix).\(route.rawValue).\(id)"
        }
    }

    private func cachedCatalogResponse(for request: WatchCatalogRequest) -> WatchCatalogResponse? {
        guard
            let key = catalogCacheKey(for: request),
            let data = UserDefaults.standard.data(forKey: key),
            var cached = try? JSONDecoder().decode(WatchCatalogResponse.self, from: data)
        else {
            return nil
        }
        cached.token = request.token
        cached.status = "cached"
        return cached
    }

    private func cacheCatalogResponse(_ response: WatchCatalogResponse, for request: WatchCatalogRequest) {
        guard
            let key = catalogCacheKey(for: request),
            let data = try? JSONEncoder().encode(response)
        else {
            return
        }
        UserDefaults.standard.set(data, forKey: key)
    }
}

extension WatchRemoteModel: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.phoneReachable = session.isReachable
        }

        if activationState == .activated {
            receive(session.receivedApplicationContext)
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
            self?.phoneReachable = session.isReachable
            if !session.isReachable {
                self?.pendingToken = nil
                self?.pendingCommand = nil
            }
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        // Kept for rolling-version compatibility. New playback snapshots use
        // application context and new command acknowledgements are replies.
        receive(message)
    }

    func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        receive(applicationContext)
    }
}
