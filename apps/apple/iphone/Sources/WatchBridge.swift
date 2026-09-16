import Foundation
import WatchConnectivity

final class PhoneWatchBridge: NSObject, ObservableObject {
    @Published private(set) var watchReachable = false
    @Published private(set) var watchInstalled = false

    var commandHandler: ((PlaybackCommand) -> PlaybackCommandResult)?
    var coldStartCommandHandler: (@MainActor (PlaybackCommand, PlaybackSnapshot) async -> PlaybackCommandResult)?
    var catalogHandler: (@MainActor (WatchCatalogRequest) async -> WatchCatalogResponse)?
    var telemetryHandler: ((String, String, String) -> Void)?

    private var currentSnapshot = PlaybackSnapshot.idle
    private var recentCommandResults: [String: (timestamp: TimeInterval, result: PlaybackCommandResult)] = [:]

    private static let recentCommandTTL: TimeInterval = 30

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        watchReachable = session.isReachable
        watchInstalled = session.isWatchAppInstalled
    }

    private func trace(_ event: String, detail: String = "") {
        telemetryHandler?("watch_bridge", event, detail)
    }

    private func cachedResult(token: String) -> PlaybackCommandResult? {
        let now = Date().timeIntervalSince1970
        recentCommandResults = recentCommandResults.filter {
            now - $0.value.timestamp <= Self.recentCommandTTL
        }
        return recentCommandResults[token]?.result
    }

    private func rememberResult(token: String, result: PlaybackCommandResult) {
        recentCommandResults[token] = (
            timestamp: Date().timeIntervalSince1970,
            result: result
        )
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

            if let cached = self.cachedResult(token: token) {
                self.trace(
                    "command_duplicate",
                    detail: "command=\(message.command?.rawValue ?? "unknown") result=\(cached.rawValue)"
                )
                let acknowledgement = WaxloomWatchMessage.acknowledgement(
                    token: token,
                    result: cached,
                    snapshot: self.currentSnapshot
                )
                replyHandler(WaxloomWatchCodec.payload(acknowledgement) ?? ["ok": false])
                return
            }

            let now = Date().timeIntervalSince1970
            let age = now - message.timestamp
            let coldStart = self.currentSnapshot.sessionID == "idle"
            let startingRevision = self.currentSnapshot.revision
            let result: PlaybackCommandResult

            self.trace(
                "command_received",
                detail: "command=\(message.command?.rawValue ?? "unknown") cold=\(coldStart ? 1 : 0) age_ms=\(Int(age * 1000)) session=\(message.sessionID)"
            )

            if age < -5 || age > WaxloomWatchCodec.commandTTL {
                result = .expired
            } else if !coldStart, message.sessionID != self.currentSnapshot.sessionID {
                result = .sessionMismatch
            } else if !coldStart, message.revision != self.currentSnapshot.revision {
                result = .staleRevision
            } else if let command = message.command {
                if coldStart {
                    self.trace(
                        "command_cold_start",
                        detail: "command=\(command.rawValue) session=\(message.sessionID)"
                    )
                    let origin = message.snapshot ?? PlaybackSnapshot(
                        sessionID: message.sessionID,
                        revision: message.revision,
                        title: "",
                        artist: "",
                        artworkURL: nil,
                        isPlaying: false,
                        elapsedSeconds: 0,
                        durationSeconds: 0,
                        feedback: nil
                    )
                    result = await self.coldStartCommandHandler?(command, origin) ?? .unavailable
                } else {
                    result = self.commandHandler?(command) ?? .unavailable
                    if result == .accepted, command == .next || command == .previous {
                        await self.waitForSnapshotAdvance(after: startingRevision)
                    }
                }
            } else {
                result = .unsupported
            }

            self.rememberResult(token: token, result: result)
            self.trace(
                "command_result",
                detail: "command=\(message.command?.rawValue ?? "unknown") result=\(result.rawValue) session=\(self.currentSnapshot.sessionID)"
            )

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
            trace(
                "catalog_expired",
                detail: "action=\(request.action.rawValue) age_ms=\(Int(age * 1000))"
            )
            if let payload = WatchCatalogCodec.payload(
                WatchCatalogResponse.failure(token: request.token, message: "Request expired")
            ) {
                replyHandler(payload)
            }
            return
        }

        if request.action == .play, request.item?.kind == .discovery {
            DiscoverySessionStore.save(request: request)
        }

        trace(
            "catalog_received",
            detail: "action=\(request.action.rawValue) route=\(request.route?.rawValue ?? "none")"
        )

        Task { @MainActor [weak self] in
            let response: WatchCatalogResponse
            if let handler = self?.catalogHandler {
                response = await handler(request)
            } else {
                response = .failure(token: request.token, message: "Waxloom iPhone service unavailable")
            }
            self?.trace(
                "catalog_result",
                detail: "action=\(request.action.rawValue) ok=\(response.ok ? 1 : 0) status=\(response.status ?? "none")"
            )
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
        trace(
            "activation",
            detail: "state=\(activationState.rawValue) reachable=\(session.isReachable ? 1 : 0) error=\(error == nil ? "none" : "present")"
        )
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
        trace(
            "reachability",
            detail: "reachable=\(session.isReachable ? 1 : 0)"
        )
        DispatchQueue.main.async { [weak self] in
            self?.watchReachable = session.isReachable
        }
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        trace(
            "watch_state",
            detail: "installed=\(session.isWatchAppInstalled ? 1 : 0)"
        )
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

        trace("message_unsupported")
        replyHandler(["ok": false])
    }

    func sessionDidBecomeInactive(_ session: WCSession) {
        trace("session_inactive")
    }

    func sessionDidDeactivate(_ session: WCSession) {
        trace("session_deactivated")
        session.activate()
    }
}
