import Foundation

enum PlaybackCommand: String, Codable, CaseIterable {
    case playPause = "play_pause"
    case next
    case previous
    case seekBackward15 = "seek_backward_15"
    case seekForward15 = "seek_forward_15"
}

enum PlaybackCommandResult: String, Codable {
    case accepted
    case expired
    case sessionMismatch = "session_mismatch"
    case staleRevision = "stale_revision"
    case stateMismatch = "state_mismatch"
    case unsupported
    case unavailable
}

struct PlaybackSnapshot: Codable, Equatable {
    var sessionID: String
    var revision: Int64
    var title: String
    var artist: String
    var artworkURL: String?
    var isPlaying: Bool
    var elapsedSeconds: Double
    var durationSeconds: Double

    static let idle = PlaybackSnapshot(
        sessionID: "idle",
        revision: 0,
        title: "Nothing playing",
        artist: "Waxloom",
        artworkURL: nil,
        isPlaying: false,
        elapsedSeconds: 0,
        durationSeconds: 0
    )
}

struct WaxloomWatchMessage: Codable {
    enum Kind: String, Codable {
        case snapshot
        case command
        case acknowledgement
    }

    static let currentSchema = 1

    var schema = Self.currentSchema
    var kind: Kind
    var timestamp: TimeInterval
    var sessionID: String
    var revision: Int64
    var token: String?
    var command: PlaybackCommand?
    var result: PlaybackCommandResult?
    var snapshot: PlaybackSnapshot?

    static func snapshot(_ snapshot: PlaybackSnapshot) -> Self {
        Self(
            kind: .snapshot,
            timestamp: Date().timeIntervalSince1970,
            sessionID: snapshot.sessionID,
            revision: snapshot.revision,
            snapshot: snapshot
        )
    }

    static func command(
        _ command: PlaybackCommand,
        token: String,
        snapshot: PlaybackSnapshot
    ) -> Self {
        Self(
            kind: .command,
            timestamp: Date().timeIntervalSince1970,
            sessionID: snapshot.sessionID,
            revision: snapshot.revision,
            token: token,
            command: command,
            snapshot: nil
        )
    }

    static func acknowledgement(
        token: String,
        result: PlaybackCommandResult,
        snapshot: PlaybackSnapshot
    ) -> Self {
        Self(
            kind: .acknowledgement,
            timestamp: Date().timeIntervalSince1970,
            sessionID: snapshot.sessionID,
            revision: snapshot.revision,
            token: token,
            command: nil,
            result: result,
            snapshot: snapshot
        )
    }
}

enum WaxloomWatchCodec {
    static let payloadType = "waxloom_player_wire_v1"
    static let payloadDataKey = "data"
    static let commandTTL: TimeInterval = 8

    static func encode(_ message: WaxloomWatchMessage) -> Data? {
        try? JSONEncoder().encode(message)
    }

    static func decode(_ data: Data) -> WaxloomWatchMessage? {
        guard
            let message = try? JSONDecoder().decode(WaxloomWatchMessage.self, from: data),
            message.schema == WaxloomWatchMessage.currentSchema
        else {
            return nil
        }
        return message
    }

    static func payload(_ message: WaxloomWatchMessage) -> [String: Any]? {
        guard let data = encode(message) else { return nil }
        return [
            "type": payloadType,
            payloadDataKey: data,
        ]
    }

    static func message(from payload: [String: Any]) -> WaxloomWatchMessage? {
        guard
            payload["type"] as? String == payloadType,
            let data = payload[payloadDataKey] as? Data
        else {
            return nil
        }
        return decode(data)
    }
}
