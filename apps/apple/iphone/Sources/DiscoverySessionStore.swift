import Foundation

struct StoredDiscoverySession: Codable {
    var currentID: String
    var items: [WatchCatalogItem]
    var storedAt: TimeInterval
}

enum DiscoverySessionStore {
    private static let key = "waxloom.iphone.discovery.session.v1"
    private static let maxAge: TimeInterval = 2 * 60 * 60

    static func save(request: WatchCatalogRequest) {
        guard
            request.action == .play,
            let item = request.item,
            item.kind == .discovery
        else {
            return
        }

        let queue = (request.items ?? [])
            .filter { $0.kind == .discovery }
        let items = queue.contains(where: { $0.id == item.id }) ? queue : [item]
        let value = StoredDiscoverySession(
            currentID: item.id,
            items: items,
            storedAt: Date().timeIntervalSince1970
        )
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    static func load(expectedSessionID: String) -> StoredDiscoverySession? {
        let prefix = "preview:"
        guard expectedSessionID.hasPrefix(prefix) else { return nil }
        let expectedID = String(expectedSessionID.dropFirst(prefix.count))
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let value = try? JSONDecoder().decode(StoredDiscoverySession.self, from: data),
            Date().timeIntervalSince1970 - value.storedAt >= 0,
            Date().timeIntervalSince1970 - value.storedAt <= maxAge,
            value.items.contains(where: { $0.id == expectedID })
        else {
            return nil
        }
        return value
    }

    static func candidate(from item: WatchCatalogItem) -> WaxloomDiscoveryCandidate {
        WaxloomDiscoveryCandidate(
            recordingMbid: item.recordingMbid ?? item.id,
            artist: item.subtitle ?? "Unknown artist",
            title: item.title,
            release: item.detail,
            releaseMbid: nil,
            similarity: 0,
            underground: 0,
            rank: item.rank ?? 0,
            tags: item.tags,
            musicbrainzUrl: nil,
            source: item.source,
            reason: "Watch cold-start recovery",
            feedback: item.feedback
        )
    }

    static func queue(from session: StoredDiscoverySession) -> [WaxloomDiscoveryCandidate] {
        session.items.map(candidate)
    }
}
