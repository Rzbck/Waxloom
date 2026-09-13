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
            self?.handle(message)
        }
    }

    private func handle(_ message: WaxloomWatchMessage) {
        guard message.kind == .command, let token = message.token else { return }

        if let previous = recentAcknowledgements[token] {
            sendAcknowledgement(previous)
            return
        }

        let now = Date().timeIntervalSince1970
        let age = now - message.timestamp
        let result: PlaybackCommandResult

        if age < -5 || age > WaxloomWatchCodec.commandTTL {
            result = .expired
        } else if message.sessionID != currentSnapshot.sessionID {
            result = .sessionMismatch
        } else if message.revision != currentSnapshot.revision {
            result = .staleRevision
        } else if let command = message.command {
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
        sendAcknowledgement(acknowledgement)
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

        receive(message)
        replyHandler(["ok": true])
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
