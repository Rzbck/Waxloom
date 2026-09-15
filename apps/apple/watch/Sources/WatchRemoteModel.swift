import Foundation
import WatchConnectivity

final class WatchRemoteModel: NSObject, ObservableObject {
    @Published private(set) var snapshot = PlaybackSnapshot.idle
    @Published private(set) var phoneReachable = false
    @Published private(set) var pendingCommand: PlaybackCommand?
    @Published private(set) var lastResult: PlaybackCommandResult?
    @Published private(set) var catalogBusy = false
    @Published private(set) var catalogMessage: String?
    @Published private(set) var catalogRevision = 0

    private static let commandReplyTimeout: TimeInterval = 3
    private static let catalogCachePrefix = "waxloom.watch.catalog.cache.v2"

    private var pendingToken: String?
    private var lastSnapshotTimestamp: TimeInterval = 0
    private var catalogRequestCount = 0
    private var playbackQueuesByItemID: [String: [WatchCatalogItem]] = [:]

    override init() {
        super.init()
        activate()
    }

    func send(_ command: PlaybackCommand) {
        guard
            WCSession.isSupported(),
            WCSession.default.activationState == .activated,
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

        // Do not gate a Watch-originated command on isReachable. A live message
        // may wake the companion iPhone app from suspension/background. The
        // correlated reply or the bounded local timeout decides availability.
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
                guard let self, self.pendingToken == token else { return }
                guard decoded.kind == .acknowledgement, decoded.token == token else {
                    self.pendingToken = nil
                    self.pendingCommand = nil
                    self.lastResult = .unsupported
                    return
                }
                self.phoneReachable = true
                self.pendingToken = nil
                self.pendingCommand = nil
                self.apply(decoded)
            }
        } errorHandler: { [weak self] _ in
            DispatchQueue.main.async {
                guard self?.pendingToken == token else { return }
                self?.pendingToken = nil
                self?.pendingCommand = nil
                self?.lastResult = .unavailable
                self?.phoneReachable = false
            }
        }

        // Never freeze the controls for transport retry/command TTL budgets.
        // Late replies are ignored by the per-command token.
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.commandReplyTimeout) { [weak self] in
            guard self?.pendingToken == token else { return }
            self?.pendingToken = nil
            self?.pendingCommand = nil
            self?.lastResult = .unavailable
        }
    }

    func load(route: WatchCatalogRoute, id: String? = nil, query: String? = nil) async -> WatchCatalogResponse {
        let response = await catalog(
            WatchCatalogRequest(
                action: .load,
                route: route,
                id: id,
                query: query
            )
        )
        if response.ok {
            rememberPlaybackQueues(response.items)
        }
        return response
    }

    func refreshDiscovery() async -> WatchCatalogResponse {
        registerMutation(
            await catalog(
                WatchCatalogRequest(
                    action: .refreshDiscovery,
                    route: .discovery
                )
            )
        )
    }

    func play(_ item: WatchCatalogItem) async -> WatchCatalogResponse {
        let queue = playbackQueuesByItemID[item.id] ?? [item]
        return await catalog(
            WatchCatalogRequest(
                action: .play,
                item: item,
                items: queue
            )
        )
    }

    func playDiscovery(_ item: WatchCatalogItem, queue: [WatchCatalogItem]) async -> WatchCatalogResponse {
        await catalog(
            WatchCatalogRequest(
                action: .play,
                item: item,
                items: queue
            )
        )
    }

    func seek(to position: Double) async -> WatchCatalogResponse {
        await catalog(
            WatchCatalogRequest(
                action: .seek,
                position: max(0, position)
            )
        )
    }

    func toggleStar(_ item: WatchCatalogItem) async -> WatchCatalogResponse {
        registerMutation(
            await catalog(WatchCatalogRequest(action: .toggleStar, item: item))
        )
    }

    func discoveryFeedback(_ item: WatchCatalogItem, value: Int) async -> WatchCatalogResponse {
        registerMutation(
            await catalog(WatchCatalogRequest(action: .discoveryFeedback, value: value, item: item))
        )
    }

    func setBadSource(_ item: WatchCatalogItem, rejected: Bool) async -> WatchCatalogResponse {
        registerMutation(
            await catalog(
                WatchCatalogRequest(
                    action: .badSource,
                    value: rejected ? 1 : 0,
                    item: item
                )
            )
        )
    }

    func rejectBadSource(_ item: WatchCatalogItem) async -> WatchCatalogResponse {
        await setBadSource(item, rejected: true)
    }

    func createPlaylist(name: String) async -> WatchCatalogResponse {
        registerMutation(
            await catalog(WatchCatalogRequest(action: .createPlaylist, query: name))
        )
    }

    func deletePlaylist(id: String) async -> WatchCatalogResponse {
        registerMutation(
            await catalog(WatchCatalogRequest(action: .deletePlaylist, id: id))
        )
    }

    func addToPlaylist(playlistID: String, songID: String) async -> WatchCatalogResponse {
        registerMutation(
            await catalog(
                WatchCatalogRequest(
                    action: .addToPlaylist,
                    id: playlistID,
                    secondaryID: songID
                )
            )
        )
    }

    func removeFromPlaylist(playlistID: String, index: Int) async -> WatchCatalogResponse {
        registerMutation(
            await catalog(
                WatchCatalogRequest(
                    action: .removeFromPlaylist,
                    id: playlistID,
                    index: index
                )
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
        registerMutation(
            await catalog(
                WatchCatalogRequest(
                    action: .youtubeImport,
                    artist: artist,
                    title: title,
                    authorized: authorized,
                    item: item
                )
            )
        )
    }

    func catalog(_ request: WatchCatalogRequest) async -> WatchCatalogResponse {
        guard
            WCSession.isSupported(),
            WCSession.default.activationState == .activated,
            let payload = WatchCatalogCodec.payload(request)
        else {
            if let cached = cachedCatalogResponse(for: request) {
                return cached
            }
            return .failure(token: request.token, message: "iPhone bridge unavailable")
        }

        await MainActor.run {
            catalogRequestCount += 1
            catalogBusy = true
            catalogMessage = nil
        }

        // As with playback commands, do not preflight isReachable. sendMessage
        // itself is allowed to wake the iPhone companion when watchOS can do so.
        let response: WatchCatalogResponse = await withCheckedContinuation { continuation in
            WCSession.default.sendMessage(payload) { [weak self] reply in
                let decoded = WatchCatalogCodec.response(from: reply)
                    ?? .failure(token: request.token, message: "Invalid iPhone response")
                DispatchQueue.main.async {
                    if decoded.ok {
                        self?.phoneReachable = true
                    }
                }
                continuation.resume(returning: decoded)
            } errorHandler: { [weak self] error in
                let fallback = self?.cachedCatalogResponse(for: request)
                DispatchQueue.main.async {
                    self?.phoneReachable = false
                }
                continuation.resume(
                    returning: fallback
                        ?? .failure(token: request.token, message: error.localizedDescription)
                )
            }
        }

        if response.ok, response.status != "cached" {
            cacheCatalogResponse(response, for: request)
        }

        await MainActor.run {
            catalogRequestCount = max(0, catalogRequestCount - 1)
            catalogBusy = catalogRequestCount > 0
            catalogMessage = response.ok ? response.message : response.message ?? "Request failed"
        }
        return response
    }

    private func registerMutation(_ response: WatchCatalogResponse) -> WatchCatalogResponse {
        guard response.ok else { return response }
        DispatchQueue.main.async { [weak self] in
            self?.catalogRevision &+= 1
        }
        return response
    }

    private func rememberPlaybackQueues(_ items: [WatchCatalogItem]) {
        let songs = items.filter { $0.kind == .song }
        for item in songs {
            playbackQueuesByItemID[item.id] = songs
        }

        let discovery = items.filter { $0.kind == .discovery }
        for item in discovery {
            playbackQueuesByItemID[item.id] = discovery
        }
    }

    private func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        phoneReachable = session.activationState == .activated
    }

    private func receive(_ payload: [String: Any]) {
        guard let message = WaxloomWatchCodec.message(from: payload) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.phoneReachable = true
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
            // Activation means a Watch-originated live message may be attempted.
            // A send failure is stronger evidence that the iPhone is unavailable.
            self?.phoneReachable = activationState == .activated
        }

        if activationState == .activated {
            receive(session.receivedApplicationContext)
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
            // A false reachability sample often means iOS is suspended. Do not
            // disable controls on that sample; a live message may wake the phone.
            if session.isReachable {
                self?.phoneReachable = true
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
