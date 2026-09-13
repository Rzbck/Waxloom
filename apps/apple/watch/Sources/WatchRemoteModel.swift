import Foundation
import WatchConnectivity

final class WatchRemoteModel: NSObject, ObservableObject {
    @Published private(set) var snapshot = PlaybackSnapshot.idle
    @Published private(set) var phoneReachable = false
    @Published private(set) var pendingCommand: PlaybackCommand?
    @Published private(set) var lastResult: PlaybackCommandResult?
    @Published private(set) var catalogBusy = false
    @Published private(set) var catalogMessage: String?

    private var pendingToken: String?

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

        WCSession.default.sendMessage(payload, replyHandler: nil) { [weak self] _ in
            DispatchQueue.main.async {
                guard self?.pendingToken == token else { return }
                self?.pendingToken = nil
                self?.pendingCommand = nil
                self?.lastResult = .unavailable
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
            return .failure(token: request.token, message: "iPhone not reachable")
        }

        DispatchQueue.main.async { [weak self] in
            self?.catalogBusy = true
            self?.catalogMessage = nil
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

        DispatchQueue.main.async { [weak self] in
            self?.catalogBusy = false
            self?.catalogMessage = response.ok ? response.message : response.message ?? "Request failed"
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
                self?.catalogBusy = false
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
