import Foundation

struct WaxloomSong: Codable, Identifiable, Hashable {
    let id: String
    var title: String?
    var artist: String?
    var artistId: String?
    var album: String?
    var albumId: String?
    var coverArt: String?
    var duration: Double?
    var track: Int?
    var discNumber: Int?
    var year: Int?
    var genre: String?
    var suffix: String?
    var starred: String?
    var musicBrainzId: String?
}

struct WaxloomAlbum: Codable, Identifiable, Hashable {
    let id: String
    var name: String?
    var title: String?
    var album: String?
    var artist: String?
    var artistId: String?
    var coverArt: String?
    var songCount: Int?
    var duration: Double?
    var year: Int?
    var genre: String?
    var starred: String?
    var song: [WaxloomSong]?

    var displayTitle: String { name ?? title ?? album ?? "Album" }
}

struct WaxloomArtist: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var coverArt: String?
    var albumCount: Int?
    var starred: String?
    var album: [WaxloomAlbum]?
}

struct WaxloomPlaylistSummary: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var songCount: Int?
    var duration: Double?
    var owner: String?
    var `public`: Bool?
    var changed: String?
    var coverArt: String?
}

struct WaxloomPlaylistDetail: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var songCount: Int?
    var duration: Double?
    var owner: String?
    var `public`: Bool?
    var changed: String?
    var coverArt: String?
    var entry: [WaxloomSong]?
}

struct WaxloomSearchResults: Codable {
    var artists: [WaxloomArtist]
    var albums: [WaxloomAlbum]
    var songs: [WaxloomSong]
}

struct WaxloomPlayQueue: Codable {
    var current: String?
    var position: Double?
    var entry: [WaxloomSong]?
}

struct WaxloomListResponse<T: Codable>: Codable {
    var items: [T]
    var count: Int
}

struct WaxloomDiscoveryCandidate: Codable, Identifiable, Hashable {
    var recordingMbid: String
    var artist: String
    var title: String
    var release: String?
    var releaseMbid: String?
    var similarity: Double
    var underground: Double
    var rank: Double
    var tags: [String]
    var musicbrainzUrl: String?
    var source: String?
    var reason: String?
    var feedback: Int?

    var id: String { recordingMbid }
}

struct WaxloomDiscoveryResponse: Codable {
    var items: [WaxloomDiscoveryCandidate]
    var count: Int
    var poolCount: Int?
}

struct WaxloomDiscoveryFeedResponse: Codable {
    var status: String
    var generatedAt: String?
    var nextRefreshAt: String?
    var rotationId: Int?
    var external: WaxloomDiscoveryResponse
}

struct WaxloomYouTubeCandidate: Codable, Identifiable, Hashable {
    var title: String
    var url: String
    var uploader: String?
    var channel: String?
    var duration: Double?
    var thumbnail: String?
    var score: Double
    var previewUrl: String?
    var previewExt: String?
    var musicConfidence: Double?

    var id: String { url }
}

struct WaxloomYouTubeRuntime: Codable {
    struct Status: Codable {
        var ffmpeg: Bool
        var node: Bool
        var ytDlp: Bool
        var downloadQuality: String?
    }

    var status: Status
    var libraryConfigured: Bool

    var ready: Bool { status.ytDlp && libraryConfigured }
}

struct WaxloomImportResult: Codable {
    var status: String
    var relativePath: String?
    var audioFormat: String?
    var song: WaxloomSong?
    var playlistAdded: Bool?
    var playlistPending: Bool?
}

enum WaxloomAPIError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case http(Int, String)
    case missingPreview

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "Waxloom server is not configured."
        case .invalidResponse:
            return "Waxloom returned an invalid response."
        case .http(let status, let message):
            return "Waxloom HTTP \(status): \(message)"
        case .missingPreview:
            return "No playable preview source was found."
        }
    }
}

enum WaxloomAPI {
    static let sourceRejectTag = "__waxloom_source:not_music__"

    static func albums(baseURL: URL, type: String = "newest", size: Int = 80, offset: Int = 0) async throws -> [WaxloomAlbum] {
        let response: WaxloomListResponse<WaxloomAlbum> = try await request(
            baseURL: baseURL,
            path: "/api/library/albums",
            query: ["type": type, "size": String(size), "offset": String(offset)]
        )
        return response.items
    }

    static func artists(baseURL: URL) async throws -> [WaxloomArtist] {
        let response: WaxloomListResponse<WaxloomArtist> = try await request(
            baseURL: baseURL,
            path: "/api/library/artists"
        )
        return response.items
    }

    static func randomSongs(baseURL: URL, size: Int = 40) async throws -> [WaxloomSong] {
        let response: WaxloomListResponse<WaxloomSong> = try await request(
            baseURL: baseURL,
            path: "/api/library/random",
            query: ["size": String(size)]
        )
        return response.items
    }

    static func album(baseURL: URL, id: String) async throws -> WaxloomAlbum {
        try await request(baseURL: baseURL, path: "/api/albums/\(encoded(id))")
    }

    static func artist(baseURL: URL, id: String) async throws -> WaxloomArtist {
        try await request(baseURL: baseURL, path: "/api/artists/\(encoded(id))")
    }

    static func song(baseURL: URL, id: String) async throws -> WaxloomSong {
        try await request(baseURL: baseURL, path: "/api/songs/\(encoded(id))")
    }

    static func search(baseURL: URL, query: String, count: Int = 40) async throws -> WaxloomSearchResults {
        try await request(
            baseURL: baseURL,
            path: "/api/search",
            query: ["q": query, "count": String(count)]
        )
    }

    static func starred(baseURL: URL) async throws -> (artists: [WaxloomArtist], albums: [WaxloomAlbum], songs: [WaxloomSong]) {
        let result: WaxloomSearchResults = try await request(baseURL: baseURL, path: "/api/starred")
        return (result.artists, result.albums, result.songs)
    }

    static func playlists(baseURL: URL) async throws -> [WaxloomPlaylistSummary] {
        let response: WaxloomListResponse<WaxloomPlaylistSummary> = try await request(
            baseURL: baseURL,
            path: "/api/playlists"
        )
        return response.items
    }

    static func playlist(baseURL: URL, id: String) async throws -> WaxloomPlaylistDetail {
        try await request(baseURL: baseURL, path: "/api/playlists/\(encoded(id))")
    }

    static func createPlaylist(baseURL: URL, name: String, songIDs: [String] = []) async throws -> WaxloomPlaylistSummary? {
        struct Body: Encodable { let name: String; let songIds: [String] }
        struct Response: Decodable { var ok: Bool; var playlist: WaxloomPlaylistSummary? }
        let response: Response = try await request(
            baseURL: baseURL,
            path: "/api/playlists",
            method: "POST",
            body: Body(name: name, songIds: songIDs)
        )
        return response.playlist
    }

    static func updatePlaylist(
        baseURL: URL,
        id: String,
        name: String? = nil,
        songIDsToAdd: [String] = [],
        songIndexesToRemove: [Int] = []
    ) async throws {
        struct Body: Encodable {
            let name: String?
            let songIdsToAdd: [String]
            let songIndexesToRemove: [Int]
        }
        let _: OKResponse = try await request(
            baseURL: baseURL,
            path: "/api/playlists/\(encoded(id))",
            method: "PATCH",
            body: Body(name: name, songIdsToAdd: songIDsToAdd, songIndexesToRemove: songIndexesToRemove)
        )
    }

    static func deletePlaylist(baseURL: URL, id: String) async throws {
        let _: OKResponse = try await request(
            baseURL: baseURL,
            path: "/api/playlists/\(encoded(id))",
            method: "DELETE"
        )
    }

    static func playQueue(baseURL: URL) async throws -> WaxloomPlayQueue {
        try await request(baseURL: baseURL, path: "/api/player/queue")
    }

    static func savePlayQueue(baseURL: URL, ids: [String], current: String?, position: Double) async {
        struct Body: Encodable { let ids: [String]; let current: String?; let position: Double }
        let _: OKResponse? = try? await request(
            baseURL: baseURL,
            path: "/api/player/queue",
            method: "PUT",
            body: Body(ids: ids, current: current, position: position)
        )
    }

    static func discoveryFeed(baseURL: URL) async throws -> WaxloomDiscoveryFeedResponse {
        try await request(baseURL: baseURL, path: "/api/discovery/feed")
    }

    static func refreshDiscoveryFeed(baseURL: URL) async throws {
        struct RefreshResponse: Decodable { var accepted: Bool? }
        let _: RefreshResponse = try await request(
            baseURL: baseURL,
            path: "/api/discovery/feed/refresh",
            method: "POST"
        )
    }

    static func youtubeRuntime(baseURL: URL) async throws -> WaxloomYouTubeRuntime {
        try await request(baseURL: baseURL, path: "/api/imports/youtube/runtime")
    }

    static func youtubeSearch(baseURL: URL, artist: String, title: String, limit: Int = 8) async throws -> [WaxloomYouTubeCandidate] {
        struct Body: Encodable {
            let artist: String
            let title: String
            let isrc: String? = nil
            let limit: Int
        }
        let response: WaxloomListResponse<WaxloomYouTubeCandidate> = try await request(
            baseURL: baseURL,
            path: "/api/imports/youtube/search",
            method: "POST",
            body: Body(artist: artist, title: title, limit: max(1, min(8, limit)))
        )
        return response.items
    }

    static func youtubePreview(baseURL: URL, artist: String, title: String) async throws -> WaxloomYouTubeCandidate {
        let candidates = try await youtubeSearch(baseURL: baseURL, artist: artist, title: title, limit: 1)
        guard let best = candidates.first, best.previewUrl != nil else {
            throw WaxloomAPIError.missingPreview
        }
        return best
    }

    static func youtubeImport(
        baseURL: URL,
        artist: String,
        title: String,
        sourceURL: String,
        playlistID: String? = nil,
        authorized: Bool
    ) async throws -> WaxloomImportResult {
        struct Body: Encodable {
            let artist: String
            let title: String
            let sourceUrl: String
            let playlistId: String?
            let authorized: Bool
        }
        return try await request(
            baseURL: baseURL,
            path: "/api/imports/youtube",
            method: "POST",
            body: Body(
                artist: artist,
                title: title,
                sourceUrl: sourceURL,
                playlistId: playlistID,
                authorized: authorized
            )
        )
    }

    static func discoveryFeedback(baseURL: URL, candidate: WaxloomDiscoveryCandidate, value: Int, badSource: Bool = false) async throws {
        struct Body: Encodable {
            let recordingMbid: String
            let artist: String
            let title: String
            let tags: [String]
            let value: Int
        }
        var tags = candidate.tags
        if badSource {
            tags.removeAll { $0 == sourceRejectTag }
            tags.insert(sourceRejectTag, at: 0)
            tags = Array(tags.prefix(12))
        }
        let _: OKResponse = try await request(
            baseURL: baseURL,
            path: "/api/discovery/feedback",
            method: "POST",
            body: Body(
                recordingMbid: candidate.recordingMbid,
                artist: candidate.artist,
                title: candidate.title,
                tags: tags,
                value: value
            )
        )
    }

    static func setStarred(baseURL: URL, id: String, starred: Bool) async throws {
        struct Body: Encodable { let id: String; let starred: Bool }
        let _: OKResponse = try await request(
            baseURL: baseURL,
            path: "/api/starred",
            method: "PUT",
            body: Body(id: id, starred: starred)
        )
    }

    static func scrobble(baseURL: URL, id: String, submission: Bool) async {
        struct Body: Encodable { let id: String; let submission: Bool }
        let _: OKResponse? = try? await request(
            baseURL: baseURL,
            path: "/api/scrobble",
            method: "POST",
            body: Body(id: id, submission: submission)
        )
    }

    static func streamURL(baseURL: URL, songID: String) -> URL {
        baseURL
            .appendingPathComponent("api", isDirectory: true)
            .appendingPathComponent("media", isDirectory: true)
            .appendingPathComponent("stream", isDirectory: true)
            .appendingPathComponent(songID, isDirectory: false)
    }

    static func coverURL(baseURL: URL, coverID: String?, size: Int = 500) -> URL? {
        guard let coverID, !coverID.isEmpty else { return nil }
        var url = baseURL
            .appendingPathComponent("api", isDirectory: true)
            .appendingPathComponent("media", isDirectory: true)
            .appendingPathComponent("cover", isDirectory: true)
            .appendingPathComponent(coverID, isDirectory: false)
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "size", value: String(size))]
        url = components?.url ?? url
        return url
    }

    private struct OKResponse: Codable { var ok: Bool? }

    private static func encoded(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private static func request<Response: Decodable>(
        baseURL: URL,
        path: String,
        query: [String: String] = [:],
        method: String = "GET"
    ) async throws -> Response {
        try await request(baseURL: baseURL, path: path, query: query, method: method, bodyData: nil)
    }

    private static func request<Response: Decodable, Body: Encodable>(
        baseURL: URL,
        path: String,
        query: [String: String] = [:],
        method: String,
        body: Body
    ) async throws -> Response {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return try await request(
            baseURL: baseURL,
            path: path,
            query: query,
            method: method,
            bodyData: encoder.encode(body)
        )
    }

    private static func request<Response: Decodable>(
        baseURL: URL,
        path: String,
        query: [String: String],
        method: String,
        bodyData: Data?
    ) async throws -> Response {
        guard baseURL.scheme?.lowercased() == "https" else {
            throw WaxloomAPIError.invalidBaseURL
        }

        let cleanPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        var url = baseURL.appendingPathComponent(cleanPath)
        if !query.isEmpty {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
            guard let queryURL = components?.url else { throw WaxloomAPIError.invalidBaseURL }
            url = queryURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let bodyData {
            request.httpBody = bodyData
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw WaxloomAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"] as? String
                ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw WaxloomAPIError.http(http.statusCode, message)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw WaxloomAPIError.invalidResponse
        }
    }
}
