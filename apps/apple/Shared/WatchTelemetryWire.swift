import Foundation

struct WatchTelemetryEvent: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var timestamp: TimeInterval = Date().timeIntervalSince1970
    var event: String
    var detail: String
}

enum WatchTelemetryCodec {
    static let payloadType = "waxloom_watch_trace_v1"
    static let dataKey = "data"

    static func payload(_ events: [WatchTelemetryEvent]) -> [String: Any]? {
        guard !events.isEmpty, let data = try? JSONEncoder().encode(events) else {
            return nil
        }
        return [
            "type": payloadType,
            dataKey: data,
        ]
    }

    static func events(from payload: [String: Any]) -> [WatchTelemetryEvent]? {
        guard
            payload["type"] as? String == payloadType,
            let data = payload[dataKey] as? Data
        else {
            return nil
        }
        return try? JSONDecoder().decode([WatchTelemetryEvent].self, from: data)
    }
}
