import Foundation
import WatchConnectivity

struct WatchTelemetryEvent: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var timestamp: TimeInterval = Date().timeIntervalSince1970
    var event: String
    var detail: String
}

enum WatchTelemetryStore {
    static let payloadType = "waxloom_watch_trace_v1"
    static let dataKey = "data"

    private static let key = "waxloom.watch.telemetry.pending.v1"
    private static let maxEvents = 120
    private static let maxBatch = 24
    private static let maxDetailLength = 240

    static func record(event: String, detail: String = "") {
        var values = allPending()
        values.append(
            WatchTelemetryEvent(
                event: clean(event, limit: 48),
                detail: clean(detail, limit: maxDetailLength)
            )
        )
        if values.count > maxEvents {
            values.removeFirst(values.count - maxEvents)
        }
        save(values)
        flushPending()
    }

    static func flushPending() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else {
            session.activate()
            return
        }

        let batch = Array(allPending().prefix(maxBatch))
        guard !batch.isEmpty, let data = try? JSONEncoder().encode(batch) else { return }

        // Telemetry is deliberately separated from playback/catalog mutations.
        // transferUserInfo may arrive later; it can never replay a user action.
        session.transferUserInfo([
            "type": payloadType,
            dataKey: data,
        ])
        remove(ids: Set(batch.map(\.id)))
    }

    static func decode(_ payload: [String: Any]) -> [WatchTelemetryEvent]? {
        guard
            payload["type"] as? String == payloadType,
            let data = payload[dataKey] as? Data
        else {
            return nil
        }
        return try? JSONDecoder().decode([WatchTelemetryEvent].self, from: data)
    }

    private static func allPending() -> [WatchTelemetryEvent] {
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let decoded = try? JSONDecoder().decode([WatchTelemetryEvent].self, from: data)
        else {
            return []
        }
        return Array(decoded.suffix(maxEvents))
    }

    private static func remove(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        save(allPending().filter { !ids.contains($0.id) })
    }

    private static func save(_ values: [WatchTelemetryEvent]) {
        guard let data = try? JSONEncoder().encode(values) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    private static func clean(_ value: String, limit: Int) -> String {
        String(
            value
                .replacingOccurrences(of: "\r", with: " ")
                .replacingOccurrences(of: "\n", with: " ")
                .split(whereSeparator: { $0.isWhitespace })
                .joined(separator: " ")
                .prefix(limit)
        )
    }
}
