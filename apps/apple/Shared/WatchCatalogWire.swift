import Foundation

enum WatchCatalogKind: String, Codable, CaseIterable {
    case song
    case album
    case artist
    case playlist
    case discovery
    case youtube
}

enum WatchCatalogRoute: String, Codable, CaseIterable {
    case albums
    case artists
    case playlists
    case favorites
    case discovery
    case search
    case album
    case artist
    case playlist
    case imports
}

enum WatchCatalogAction: String, Codable {
    case load
    case play
    case toggleStar
    case discoveryFeedback
    case badSource
    case createPlaylist
    case deletePlaylist
    case addToPlaylist
    case removeFromPlaylist
    case youtubeSearch
    case youtubeImport
}

struct WatchCatalogItem: Codable, Identifiable, Hashable {
    var id: String
    var kind: WatchCatalogKind
    var title: String
    var subtitle: String?
    var detail: String?
    var coverArt: String?
    var duration: Double?
    var starred: Bool = false
    var section: String?

    // Discovery / external source fields.
    var recordingMbid: String?
    var source: String?
    var tags: [String] = []
    var rank: Double?
    var feedback: Int?

    // YouTube/import fields.
    var sourceURL: String?
    var previewURL: String?
    var thumbnailURL: String?
    var score: Double?
}

struct WatchCatalogRequest: Codable {
    static let currentSchema = 1

    var schema = Self.currentSchema
    var token: String = UUID().uuidString
    var timestamp: TimeInterval = Date().timeIntervalSince1970
    var action: WatchCatalogAction
    var route: WatchCatalogRoute?
    var id: String?
    var secondaryID: String?
    var query: String?
    var artist: String?
    var title: String?
    var value: Int?
    var index: Int?
    var authorized: Bool?
    var item: WatchCatalogItem?
    var items: [WatchCatalogItem]?
}

struct WatchCatalogResponse: Codable {
    static let currentSchema = 1

    var schema = Self.currentSchema
    var token: String
    var ok: Bool
    var title: String
    var subtitle: String?
    var status: String?
    var message: String?
    var items: [WatchCatalogItem] = []
    var runtimeReady: Bool?

    static func success(
        token: String,
        title: String,
        subtitle: String? = nil,
        status: String? = nil,
        message: String? = nil,
        items: [WatchCatalogItem] = [],
        runtimeReady: Bool? = nil
    ) -> Self {
        Self(
            token: token,
            ok: true,
            title: title,
            subtitle: subtitle,
            status: status,
            message: message,
            items: items,
            runtimeReady: runtimeReady
        )
    }

    static func failure(token: String, message: String) -> Self {
        Self(token: token, ok: false, title: "Waxloom", message: message)
    }
}

enum WatchCatalogCodec {
    static let payloadType = "waxloom_catalog_wire_v1"
    static let dataKey = "data"
    static let requestTTL: TimeInterval = 20

    static func payload(_ request: WatchCatalogRequest) -> [String: Any]? {
        guard let data = try? JSONEncoder().encode(request) else { return nil }
        return ["type": payloadType, dataKey: data]
    }

    static func payload(_ response: WatchCatalogResponse) -> [String: Any]? {
        guard let data = try? JSONEncoder().encode(response) else { return nil }
        return ["type": payloadType, dataKey: data]
    }

    static func request(from payload: [String: Any]) -> WatchCatalogRequest? {
        guard
            payload["type"] as? String == payloadType,
            let data = payload[dataKey] as? Data,
            let value = try? JSONDecoder().decode(WatchCatalogRequest.self, from: data),
            value.schema == WatchCatalogRequest.currentSchema
        else {
            return nil
        }
        return value
    }

    static func response(from payload: [String: Any]) -> WatchCatalogResponse? {
        guard
            payload["type"] as? String == payloadType,
            let data = payload[dataKey] as? Data,
            let value = try? JSONDecoder().decode(WatchCatalogResponse.self, from: data),
            value.schema == WatchCatalogResponse.currentSchema
        else {
            return nil
        }
        return value
    }
}
