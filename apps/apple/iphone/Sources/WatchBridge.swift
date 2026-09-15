import Foundation
import WatchConnectivity

final class PhoneWatchBridge: NSObject, ObservableObject {
    @Published private(set) var watchReachable = false
    @Published private(set) var watchInstalled = false

    var commandHandler: ((PlaybackCommand) -> PlaybackCommandResult)?
    var catalogHandler: (@MainActor (WatchCatalogRequest) async -> WatchCatalogResponse)?

    private var currentSnapshot = PlaybackSnapshot.idle

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        watchReachable = session.isReachable
        watchInstalled = session.isWatchAppInstalled
    }

    // Playback state has one transport and one semantic: latest state wins.
    // `interactive` remains in the signature so existing player call sites do not
    // need to care which WCSession transport is used.
    func publish(_ snapshot: PlaybackSnapshot, interactive: Bool = true) {
        _ = interactive
        currentSnapshot = snapshot
        guard
            WCSession.isSupported(),
            let payload = WaxloomWatchCodec.payload(.snapshot(snapshot))
        else {
            return
        }

        try? WCSession.default.updateApplicationContext(payload)
    }

    private func handlePlaybackCommand(
        _ message: WaxloomWatchMessage,
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        Task { @MainActor [weak self] in
            guard let self, message.kind == .command, let token = message.token else {
                replyHandler(["ok": false])
                return
            }

            let now = Date().timeIntervalSince1970
            let age = now - message.timestamp
            let startingRevision = self.currentSnapshot.revision
            let result: PlaybackCommandResult

            if age < -5 || age > WaxloomWatchCodec.commandTTL {
                result = .expired
            } else if message.sessionID != self.currentSnapshot.sessionID {
                result = .sessionMismatch
            } else if message.revision != self.currentSnapshot.revision {
                result = .staleRevision
            } else if let command = message.command {
                result = self.commandHandler?(command) ?? .unavailable
                if result == .accepted, command == .next || command == .previous {
                    await self.waitForSnapshotAdvance(after: startingRevision)
                }
            } else {
                result = .unsupported
            }

            let acknowledgement = WaxloomWatchMessage.acknowledgement(
                token: token,
                result: result,
                snapshot: self.currentSnapshot
            )
            replyHandler(WaxloomWatchCodec.payload(acknowledgement) ?? ["ok": false])
        }
    }

    @MainActor
    private func waitForSnapshotAdvance(after revision: Int64) async {
        let deadline = Date().addingTimeInterval(1.5)
        while currentSnapshot.revision <= revision, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    private func handleCatalog(
        _ request: WatchCatalogRequest,
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let now = Date().timeIntervalSince1970
        let age = now - request.timestamp
        guard age >= -5, age <= WatchCatalogCodec.requestTTL else {
            if let payload = WatchCatalogCodec.payload(
                WatchCatalogResponse.failure(token: request.token, message: "Request expired")
            ) {
                replyHandler(payload)
            }
            return
        }

        Task { @MainActor [weak self] in
            let response: WatchCatalogResponse
            if let handler = self?.catalogHandler {
                response = await handler(request)
            } else {
                response = .failure(token: request.token, message: "Waxloom iPhone service unavailable")
            }
            if let payload = WatchCatalogCodec.payload(response) {
                replyHandler(payload)
            }
        }
    }
}

extension PhoneWatchBridge: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.watchReachable = session.isReachable
            self.watchInstalled = session.isWatchAppInstalled
            if activationState == .activated {
                self.publish(self.currentSnapshot)
            }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
            self?.watchReachable = session.isReachable
        }
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
            self?.watchInstalled = session.isWatchAppInstalled
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        // New playback commands always use request/reply. Ignore uncorrelated
        // messages here instead of creating a second acknowledgement channel.
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        if let request = WatchCatalogCodec.request(from: message) {
            handleCatalog(request, replyHandler: replyHandler)
            return
        }

        if let command = WaxloomWatchCodec.message(from: message), command.kind == .command {
            handlePlaybackCommand(command, replyHandler: replyHandler)
            return
        }

        replyHandler(["ok": false])
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
