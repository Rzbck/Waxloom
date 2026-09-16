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
    private static let immediateRetryDelayNanoseconds: UInt64 = 200_000_000
    private static let catalogCachePrefix = "waxloom.watch.catalog.cache.v2"
    private static let discoveryCacheMaxAge: TimeInterval = 10 * 60

    private enum CatalogTransportResult {
        case response(WatchCatalogResponse)
        case failure(String)
    }

    private var pendingToken: String?
    private var lastSnapshotTimestamp: TimeInterval = 0
    private var catalogRequestCount = 0
    private var playbackQueuesByItemID: [String: [WatchCatalogItem]] = [:]

    override init() {
        super.init()
        activate()
    }

    func send(_ command: PlaybackCommand) {
        guard WCSession.isSupported(), pendingToken == nil else {
            lastResult = .unavailable
            return
        }
        guard WCSession.default.activationState == .activated else {
            WCSession.default.activate()
            lastResult = .unavailable
            return
        }

        let originSnapshot = snapshot
        let token = UUID().uuidString
        let message = WaxloomWatchMessage.command(
            command,
            token: token,
            snapshot: originSnapshot
        )
        guard let payload = WaxloomWatchCodec.payload(message) else {
            lastResult = .unsupported
            return
        }

        pendingToken = token
        pendingCommand = command
        lastResult = nil
        sendPlaybackAttempt(
            payload: payload,
            token: token,
            command: command,
            originSnapshot: originSnapshot,
            retried: false
        )

        DispatchQueue.main.asyncAfter(deadline: .now() + Self.commandReplyTimeout) { [weak self] in
            guard self?.pendingToken == token else { return }
            self?.pendingToken = nil
            self?.pendingCommand = nil
            self?.lastResult = .unavailable
            self?.phoneReachable = false
        }
    }

    private func sendPlaybackAttempt(
        payload: [String: Any],
        token: String,
        command: PlaybackCommand,
        originSnapshot: PlaybackSnapshot,
        retried: Bool
    ) {
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

                let result = decoded.result ?? .unsupported
                if self.shouldRecoverPreview(result: result, snapshot: originSnapshot) {
                    self.pendingToken = nil
                    self.pendingCommand = nil
                    self.phoneReachable = true
                    Task { [weak self] in
                        await self?.recoverPreviewCommand(
                            command,
                            originSnapshot: originSnapshot,
                            fallbackResult: result
                        )
                    }
                    return
                }

                self.phoneReachable = true
                self.pendingToken = nil
                self.pendingCommand = nil
                self.apply(decoded)
            }
        } errorHandler: { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.pendingToken == token else { return }

                if !retried {
                    WCSession.default.activate()
                    DispatchQueue.main.asyncAfter(
                        deadline: .now() + Double(Self.immediateRetryDelayNanoseconds) / 1_000_000_000
                    ) { [weak self] in
                        guard let self, self.pendingToken == token else { return }
                        self.sendPlaybackAttempt(
                            payload: payload,
                            token: token,
                            command: command,
                            originSnapshot: originSnapshot,
                            retried: true
                        )
                    }
                    return
                }

                self.pendingToken = nil
                self.pendingCommand = nil
                self.lastResult = .unavailable
                self.phoneReachable = false
            }
        }
    }

    private func shouldRecoverPreview(
        result: PlaybackCommandResult,
        snapshot: PlaybackSnapshot
    ) -> Bool {
        guard snapshot.sessionID.hasPrefix("preview:") else { return false }
        switch result {
        case .sessionMismatch, .stateMismatch, .unavailable:
            return true
        default:
            return false
        }
    }

    private func recoverPreviewCommand(
        _ command: PlaybackCommand,
        originSnapshot: PlaybackSnapshot,
        fallbackResult: PlaybackCommandResult
    ) async {
        let prefix = "preview:"
        guard originSnapshot.sessionID.hasPrefix(prefix) else {
            await MainActor.run { lastResult = fallbackResult }
            return
        }

        let currentID = String(originSnapshot.sessionID.dropFirst(prefix.count))
        guard
            let queue = playbackQueuesByItemID[currentID],
            !queue.isEmpty,
            let currentIndex = queue.firstIndex(where: { $0.id == currentID })
        else {
            await MainActor.run {
                lastResult = fallbackResult
                catalogMessage = "Discovery recovery queue unavailable"
            }
            return
        }

        let response: WatchCatalogResponse
        switch command {
        case .next:
            let target = queue[(currentIndex + 1) % queue.count]
            response = await playDiscovery(target, queue: queue)

        case .previous:
            let target = queue[(currentIndex - 1 + queue.count) % queue.count]
            response = await playDiscovery(target, queue: queue)

        case .playPause:
            response = await playDiscovery(queue[currentIndex], queue: queue)

        case .seekBackward15, .seekForward15:
            let restore = await playDiscovery(queue[currentIndex], queue: queue)
            guard restore.ok else {
                await MainActor.run {
                    lastResult = fallbackResult
                    catalogMessage = restore.message ?? "Discovery recovery failed"
                }
                return
            }
            let delta = command == .seekBackward15 ? -15.0 : 15.0
            response = await seek(to: max(0, originSnapshot.elapsedSeconds + delta))
        }

        await MainActor.run {
            phoneReachable = response.ok
            lastResult = response.ok ? .accepted : fallbackResult
            if !response.ok {
                catalogMessage = response.message ?? "Discovery recovery failed"
            }
        }
    }

    func load(route: WatchCatalogRoute, id: String? = nil, query: String? = nil) async -> WatchCatalogResponse {
        let request = WatchCatalogRequest(
            action: .load,
            route: route,
            id: id,
            query: query
        )

        if route == .discovery, let cached = cachedCatalogResponse(for: request) {
            rememberPlaybackQueues(cached.items)
            return cached
        }

        let response = await catalog(request)
        if response.ok {
            rememberPlaybackQueues(response.items)
        }
        return response
    }

    func refreshDiscovery() async -> WatchCatalogResponse {
        let response = await catalog(
            WatchCatalogRequest(
                action: .refreshDiscovery,
                route: .discovery
            )
        )
        if response.ok {
            invalidateDiscoveryCache()
        }
        return registerMutation(response)
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
        let response = await catalog(
            WatchCatalogRequest(action: .discoveryFeedback, value: value, item: item)
        )
        if response.ok {
            invalidateDiscoveryCache()
        }
        return registerMutation(response)
    }

    func setBadSource(_ item: WatchCatalogItem, rejected: Bool) async -> WatchCatalogResponse {
        let response = await catalog(
            WatchCatalogRequest(
                action: .badSource,
                value: rejected ? 1 : 0,
                item: item
            )
        )
        if response.ok {
            invalidateDiscoveryCache()
        }
        return registerMutation(response)
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
        let response = await catalog(
            WatchCatalogRequest(
                action: .youtubeImport,
                artist: artist,
                title: title,
                authorized: authorized,
                item: item
            )
        )
        if response.ok {
            invalidateDiscoveryCache()
        }
        return registerMutation(response)
    }

    func catalog(_ request: WatchCatalogRequest) async -> WatchCatalogResponse {
        guard WCSession.isSupported() else {
            return cachedCatalogResponse(for: request)
                ?? .failure(token: request.token, message: "iPhone bridge unavailable")
        }
        guard WCSession.default.activationState == .activated else {
            WCSession.default.activate()
            return cachedCatalogResponse(for: request)
                ?? .failure(token: request.token, message: "iPhone bridge unavailable")
        }
        guard let payload = WatchCatalogCodec.payload(request) else {
            return .failure(token: request.token, message: "Invalid Watch request")
        }

        await MainActor.run {
            catalogRequestCount += 1
            catalogBusy = true
            catalogMessage = nil
        }

        var transport = await catalogAttempt(payload: payload, request: request)
        if case .failure = transport {
            WCSession.default.activate()
            try? await Task.sleep(nanoseconds: Self.immediateRetryDelayNanoseconds)
            transport = await catalogAttempt(payload: payload, request: request)
        }

        let response: WatchCatalogResponse
        switch transport {
        case .response(let value):
            response = value
            await MainActor.run { phoneReachable = true }
        case .failure(let message):
            response = cachedCatalogResponse(for: request)
                ?? .failure(token: request.token, message: message)
            await MainActor.run { phoneReachable = false }
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

    private func catalogAttempt(
        payload: [String: Any],
        request: WatchCatalogRequest
    ) async -> CatalogTransportResult {
        await withCheckedContinuation {
            (continuation: CheckedContinuation<CatalogTransportResult, Never>) in
            WCSession.default.sendMessage(payload) { reply in
                let decoded = WatchCatalogCodec.response(from: reply)
                    ?? .failure(token: request.token, message: "Invalid iPhone response")
                continuation.resume(returning: .response(decoded))
            } errorHandler: { error in
                continuation.resume(returning: .failure(error.localizedDescription))
            }
        }
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

    private func catalogCacheStoredAtKey(_ key: String) -> String {
        "\(key).storedAt"
    }

    private func invalidateDiscoveryCache() {
        let request = WatchCatalogRequest(action: .load, route: .discovery)
        guard let key = catalogCacheKey(for: request) else { return }
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: key)
        defaults.removeObject(forKey: catalogCacheStoredAtKey(key))
    }

    private func cachedCatalogResponse(for request: WatchCatalogRequest) -> WatchCatalogResponse? {
        guard let key = catalogCacheKey(for: request) else { return nil }

        let defaults = UserDefaults.standard
        if request.route == .discovery {
            let storedAt = defaults.double(forKey: catalogCacheStoredAtKey(key))
            let age = Date().timeIntervalSince1970 - storedAt
            guard storedAt > 0, age >= 0, age <= Self.discoveryCacheMaxAge else {
                defaults.removeObject(forKey: key)
                defaults.removeObject(forKey: catalogCacheStoredAtKey(key))
                return nil
            }
        }

        guard
            let data = defaults.data(forKey: key),
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

        let defaults = UserDefaults.standard
        defaults.set(data, forKey: key)
        if request.route == .discovery {
            defaults.set(Date().timeIntervalSince1970, forKey: catalogCacheStoredAtKey(key))
        }
    }
}

extension WatchRemoteModel: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.phoneReachable = activationState == .activated
        }

        if activationState == .activated {
            receive(session.receivedApplicationContext)
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
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
