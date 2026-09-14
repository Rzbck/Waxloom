import Foundation
import WatchConnectivity

final class PhoneWatchBridge: NSObject, ObservableObject {
    @Published private(set) var watchReachable = false
    @Published private(set) var watchInstalled = false

    var commandHandler: ((PlaybackCommand) -> PlaybackCommandResult)?
    var catalogHandler: (@MainActor (WatchCatalogRequest) async -> WatchCatalogResponse)?

    private var currentSnapshot = PlaybackSnapshot.idle
    private var recentAcknowledgements: [String: WaxloomWatchMessage] = [:]
    private var acknowledgementOrder: [String] = []

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        watchReachable = session.isReachable
        watchInstalled = session.isWatchAppInstalled
    }

    func publish(_ snapshot: PlaybackSnapshot, interactive: Bool = true) {
        currentSnapshot = snapshot
        guard
            WCSession.isSupported(),
            let payload = WaxloomWatchCodec.payload(.snapshot(snapshot))
        else {
            return
        }

        let session = WCSession.default
        try? session.updateApplicationContext(payload)
        if interactive, session.activationState == .activated, session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
    }

    private func receive(_ payload: [String: Any]) {
        guard let message = WaxloomWatchCodec.message(from: payload) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, let acknowledgement = self.acknowledgement(for: message) else { return }
            self.sendAcknowledgement(acknowledgement)
        }
    }

    private func acknowledgement(for message: WaxloomWatchMessage) -> WaxloomWatchMessage? {
        guard message.kind == .command, let token = message.token else { return nil }

        if let previous = recentAcknowledgements[token] {
            return previous
        }

        let now = Date().timeIntervalSince1970
        let age = now - message.timestamp
        let result: PlaybackCommandResult

        if age < -5 || age > WaxloomWatchCodec.commandTTL {
            result = .expired
        } else if let command = message.command {
            // The token + TTL already protect against duplicate/delayed commands.
            // Do not reject Next/Previous simply because the Watch missed a newer
            // snapshot revision while iOS was suspended. That made a valid button
            // tap look accepted on the Watch but perform no transport action.
            result = commandHandler?(command) ?? .unavailable
        } else {
            result = .unsupported
        }

        let acknowledgement = WaxloomWatchMessage.acknowledgement(
            token: token,
            result: result,
            snapshot: currentSnapshot
        )
        remember(acknowledgement, token: token)
        return acknowledgement
    }

    private func remember(_ message: WaxloomWatchMessage, token: String) {
        recentAcknowledgements[token] = message
        acknowledgementOrder.append(token)
        while acknowledgementOrder.count > 12 {
            let removed = acknowledgementOrder.removeFirst()
            recentAcknowledgements.removeValue(forKey: removed)
        }
    }

    private func sendAcknowledgement(_ message: WaxloomWatchMessage) {
        guard
            let payload = WaxloomWatchCodec.payload(message),
            WCSession.default.activationState == .activated,
            WCSession.default.isReachable
        else {
            return
        }
        WCSession.default.sendMessage(payload, replyHandler: nil, errorHandler: nil)
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
        receive(message)
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

        if let playbackMessage = WaxloomWatchCodec.message(from: message) {
            DispatchQueue.main.async { [weak self] in
                guard
                    let self,
                    let acknowledgement = self.acknowledgement(for: playbackMessage),
                    let payload = WaxloomWatchCodec.payload(acknowledgement)
                else {
                    replyHandler(["ok": false])
                    return
                }
                // Reply on the same Watch -> iPhone request. This remains reliable
                // even when the iOS app was just background-woken for the message;
                // it no longer requires a second iPhone -> Watch live message.
                replyHandler(payload)
            }
            return
        }

        replyHandler(["ok": false])
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
