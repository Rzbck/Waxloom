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

    private var pendingToken: String?
    private var playbackQueuesByItemID: [String: [WatchCatalogItem]] = [:]
    private let discoveryCacheKey = "waxloom.watch.discovery.cache.v1"

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

        // Do not preflight isReachable here. A live message originating from the
        // active Watch can wake the companion iOS app in the background. Gating
        // on isReachable prevented exactly that wake-up and made controls depend
        // on the iPhone app already being open.
        WCSession.default.sendMessage(payload) { [weak self] reply in
            DispatchQueue.main.async {
                guard let self, self.pendingToken == token else { return }
                guard
                    let acknowledgement = WaxloomWatchCodec.message(from: reply),
                    acknowledgement.kind == .acknowledgement,
                    acknowledgement.token == token
                else {
                    self.pendingToken = nil
                    self.pendingCommand = nil
                    self.lastResult = .unsupported
                    return
                }
                self.phoneReachable = true
                self.apply(acknowledgement)
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

        DispatchQueue.main.asyncAfter(deadline: .now() + WaxloomWatchCodec.commandTTL) { [weak self] in
            guard self?.pendingToken == token else { return }
            self?.pendingToken = nil
            self?.pendingCommand = nil
            self?.lastResult = .expired
        }
    }

    func load(route: WatchCatalogRoute, id: String? = nil, query: String? = nil) async -> WatchCatalogResponse {
        let request = WatchCatalogRequest(
            action: .load,
            route: route,
            id: id,
            query: query
        )
        let response = await catalog(request)

        if response.ok {
            rememberPlaybackQueues(response.items)
            if route == .discovery {
                cacheDiscovery(response)
            }
            return response
        }

        if route == .discovery, let cached = cachedDiscovery(token: request.token) {
            rememberPlaybackQueues(cached.items)
            return cached
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
            return .failure(token: request.token, message: "iPhone bridge unavailable")
        }

        DispatchQueue.main.async { [weak self] in
            self?.catalogBusy = true
            self?.catalogMessage = nil
        }

        // Same rule as playback commands: attempt the live message even if the
        // last isReachable sample is false, so watchOS can wake iOS in background.
        let response: WatchCatalogResponse = await withCheckedContinuation { continuation in
            WCSession.default.sendMessage(payload) { [weak self] reply in
                let decoded = WatchCatalogCodec.response(from: reply)
                    ?? .failure(token: request.token, message: "Invalid iPhone response")
                DispatchQueue.main.async {
                    self?.phoneReachable = decoded.ok || self?.phoneReachable == true
                }
                continuation.resume(returning: decoded)
            } errorHandler: { [weak self] error in
                DispatchQueue.main.async {
                    self?.phoneReachable = false
                }
                continuation.resume(
                    returning: .failure(token: request.token, message: error.localizedDescription)
                )
            }
        }

        DispatchQueue.main.async { [weak self] in
            self?.catalogBusy = false
            self?.catalogMessage = response.ok ? response.message : response.message ?? "Request failed"
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

    private func cacheDiscovery(_ response: WatchCatalogResponse) {
        guard let data = try? JSONEncoder().encode(response) else { return }
        UserDefaults.standard.set(data, forKey: discoveryCacheKey)
    }

    private func cachedDiscovery(token: String) -> WatchCatalogResponse? {
        guard
            let data = UserDefaults.standard.data(forKey: discoveryCacheKey),
            var response = try? JSONDecoder().decode(WatchCatalogResponse.self, from: data),
            !response.items.isEmpty
        else {
            return nil
        }
        response.token = token
        response.ok = true
        response.title = "Discovery"
        response.status = "cached"
        response.message = "Cached Discovery — iPhone currently unavailable"
        return response
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
                applySnapshot(incoming)
            }

        case .acknowledgement:
            guard let token = message.token, token == pendingToken else { return }
            pendingToken = nil
            pendingCommand = nil
            lastResult = message.result
            if let incoming = message.snapshot {
                applySnapshot(incoming)
            }

        case .command:
            break
        }
    }

    private func applySnapshot(_ incoming: PlaybackSnapshot) {
        if
            incoming.sessionID == snapshot.sessionID,
            incoming.revision < snapshot.revision
        {
            return
        }
        snapshot = incoming
    }
}

extension WatchRemoteModel: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async { [weak self] in
            // Activated means the Watch is allowed to attempt a live message.
            // The first send will decide whether the iPhone is actually available.
            self?.phoneReachable = activationState == .activated
        }

        if activationState == .activated {
            receive(session.receivedApplicationContext)
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
            // A false sample can simply mean that iOS is suspended. Do not use it
            // to disable controls, because a Watch-originated sendMessage can wake
            // the companion app. A true sample is still useful positive evidence.
            if session.isReachable {
                self?.phoneReachable = true
            }
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        receive(message)
    }

    func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        receive(applicationContext)
    }
}
