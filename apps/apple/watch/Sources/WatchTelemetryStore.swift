import Foundation

enum WatchTelemetryStore {
    private static let key = "waxloom.watch.telemetry.pending.v1"
    private static let maxEvents = 120
    private static let maxDetailLength = 240

    static func append(event: String, detail: String = "") {
        var values = pending()
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
    }

    static func pending(limit: Int = 40) -> [WatchTelemetryEvent] {
        Array(pending().prefix(max(1, min(limit, maxEvents))))
    }

    static func remove(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        save(pending().filter { !ids.contains($0.id) })
    }

    private static func pending() -> [WatchTelemetryEvent] {
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let decoded = try? JSONDecoder().decode([WatchTelemetryEvent].self, from: data)
        else {
            return []
        }
        return Array(decoded.suffix(maxEvents))
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
