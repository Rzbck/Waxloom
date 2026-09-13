import Foundation

@MainActor
enum WatchCatalogService {
    static func handle(
        _ request: WatchCatalogRequest,
        connection: ConnectionModel,
        player: NativePlayerModel
    ) async -> WatchCatalogResponse {
        await connection.connectSavedIfNeeded()
        guard connection.isConnected, let baseURL = connection.baseURL else {
            return .failure(token: request.token, message: "Connect Waxloom on iPhone first")
        }

        do {
            switch request.action {
            case .load:
                return try await load(request, baseURL: baseURL)

            case .play:
                guard let item = request.item else {
                    return .failure(token: request.token, message: "Missing media item")
                }
                switch item.kind {
                case .song:
                    let song = try await WaxloomAPI.song(baseURL: baseURL, id: item.id)
                    player.play(song: song, queue: [song], baseURL: baseURL)
                    return .success(token: request.token, title: "Playing", message: song.title ?? "Track")

                case .discovery:
                    let candidate = discoveryCandidate(from: item)
                    await player.playPreview(candidate: candidate, queue: [candidate], baseURL: baseURL)
                    return .success(token: request.token, title: "Preview", message: candidate.title)

                default:
                    return .failure(token: request.token, message: "Open this item first")
                }

            case .toggleStar:
                guard let item = request.item else {
                    return .failure(token: request.token, message: "Missing item")
                }
                try await WaxloomAPI.setStarred(baseURL: baseURL, id: item.id, starred: !item.starred)
                var updated = item
                updated.starred.toggle()
                return .success(token: request.token, title: updated.starred ? "Favorited" : "Favorite removed", items: [updated])

            case .discoveryFeedback:
                guard let item = request.item else {
                    return .failure(token: request.token, message: "Missing Discovery item")
                }
                let value = max(-1, min(1, request.value ?? 0))
                try await WaxloomAPI.discoveryFeedback(
                    baseURL: baseURL,
                    candidate: discoveryCandidate(from: item),
                    value: value
                )
                return .success(token: request.token, title: value > 0 ? "Liked" : value < 0 ? "Less like this" : "Feedback cleared")

            case .badSource:
                guard let item = request.item else {
                    return .failure(token: request.token, message: "Missing Discovery item")
                }
                try await WaxloomAPI.discoveryFeedback(
                    baseURL: baseURL,
                    candidate: discoveryCandidate(from: item),
                    value: 0,
                    badSource: true
                )
                return .success(token: request.token, title: "Source rejected", message: "Marked bad / non-music without changing musical taste")

            case .createPlaylist:
                let name = (request.query ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else {
                    return .failure(token: request.token, message: "Playlist name required")
                }
                let created = try await WaxloomAPI.createPlaylist(baseURL: baseURL, name: name)
                return .success(
                    token: request.token,
                    title: "Playlist created",
                    items: created.map { [playlistItem($0)] } ?? []
                )

            case .deletePlaylist:
                guard let id = request.id else {
                    return .failure(token: request.token, message: "Playlist missing")
                }
                try await WaxloomAPI.deletePlaylist(baseURL: baseURL, id: id)
                return .success(token: request.token, title: "Playlist deleted")

            case .addToPlaylist:
                guard let playlistID = request.id, let songID = request.secondaryID else {
                    return .failure(token: request.token, message: "Playlist or track missing")
                }
                try await WaxloomAPI.updatePlaylist(
                    baseURL: baseURL,
                    id: playlistID,
                    songIDsToAdd: [songID]
                )
                return .success(token: request.token, title: "Added to playlist")

            case .removeFromPlaylist:
                guard let playlistID = request.id, let index = request.index else {
                    return .failure(token: request.token, message: "Playlist entry missing")
                }
                try await WaxloomAPI.updatePlaylist(
                    baseURL: baseURL,
                    id: playlistID,
                    songIndexesToRemove: [index]
                )
                return .success(token: request.token, title: "Removed from playlist")

            case .youtubeSearch:
                let artist = (request.artist ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                let title = (request.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !artist.isEmpty, !title.isEmpty else {
                    return .failure(token: request.token, message: "Artist and track are required")
                }
                let runtime = try await WaxloomAPI.youtubeRuntime(baseURL: baseURL)
                guard runtime.ready else {
                    return .failure(token: request.token, message: "Import runtime is not ready")
                }
                let candidates = try await WaxloomAPI.youtubeSearch(baseURL: baseURL, artist: artist, title: title)
                return .success(
                    token: request.token,
                    title: "Import sources",
                    subtitle: "\(artist) — \(title)",
                    items: candidates.map(youtubeItem),
                    runtimeReady: runtime.ready
                )

            case .youtubeImport:
                guard
                    request.authorized == true,
                    let item = request.item,
                    let sourceURL = item.sourceURL,
                    let artist = request.artist,
                    let title = request.title
                else {
                    return .failure(token: request.token, message: "Authorization and source are required")
                }
                let result = try await WaxloomAPI.youtubeImport(
                    baseURL: baseURL,
                    artist: artist,
                    title: title,
                    sourceURL: sourceURL,
                    playlistID: request.secondaryID,
                    authorized: true
                )
                return .success(
                    token: request.token,
                    title: "Import complete",
                    status: result.status,
                    message: result.status == "already_local" ? "Already in your library" : "Saved to your library"
                )
            }
        } catch {
            return .failure(token: request.token, message: error.localizedDescription)
        }
    }

    private static func load(_ request: WatchCatalogRequest, baseURL: URL) async throws -> WatchCatalogResponse {
        guard let route = request.route else {
            return .failure(token: request.token, message: "Missing route")
        }

        switch route {
        case .albums:
            let values = try await WaxloomAPI.albums(baseURL: baseURL, type: "newest", size: 80)
            return .success(token: request.token, title: "Albums", items: values.map(albumItem))

        case .artists:
            let values = try await WaxloomAPI.artists(baseURL: baseURL)
            return .success(token: request.token, title: "Artists", items: values.map(artistItem))

        case .playlists:
            let values = try await WaxloomAPI.playlists(baseURL: baseURL)
            return .success(token: request.token, title: "Playlists", items: values.map(playlistItem))

        case .favorites:
            let values = try await WaxloomAPI.starred(baseURL: baseURL)
            let artists = values.artists.map { value -> WatchCatalogItem in
                var item = artistItem(value); item.section = "Artists"; return item
            }
            let albums = values.albums.map { value -> WatchCatalogItem in
                var item = albumItem(value); item.section = "Albums"; return item
            }
            let songs = values.songs.map { value -> WatchCatalogItem in
                var item = songItem(value); item.section = "Songs"; return item
            }
            return .success(token: request.token, title: "Favorites", items: songs + albums + artists)

        case .discovery:
            let feed = try await WaxloomAPI.discoveryFeed(baseURL: baseURL)
            let items = feed.external.items
                .filter { ($0.feedback ?? 0) >= 0 }
                .sorted { $0.rank > $1.rank }
                .map(discoveryItem)
            return .success(token: request.token, title: "Discovery", status: feed.status, items: items)

        case .search:
            let query = (request.query ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty else {
                return .success(token: request.token, title: "Search", message: "Dictate or type a search")
            }
            let values = try await WaxloomAPI.search(baseURL: baseURL, query: query)
            let songs = values.songs.map { value -> WatchCatalogItem in
                var item = songItem(value); item.section = "Songs"; return item
            }
            let albums = values.albums.map { value -> WatchCatalogItem in
                var item = albumItem(value); item.section = "Albums"; return item
            }
            let artists = values.artists.map { value -> WatchCatalogItem in
                var item = artistItem(value); item.section = "Artists"; return item
            }
            return .success(token: request.token, title: "Search", subtitle: query, items: songs + albums + artists)

        case .album:
            guard let id = request.id else { return .failure(token: request.token, message: "Album missing") }
            let value = try await WaxloomAPI.album(baseURL: baseURL, id: id)
            return .success(
                token: request.token,
                title: value.displayTitle,
                subtitle: value.artist,
                items: (value.song ?? []).map(songItem)
            )

        case .artist:
            guard let id = request.id else { return .failure(token: request.token, message: "Artist missing") }
            let value = try await WaxloomAPI.artist(baseURL: baseURL, id: id)
            return .success(
                token: request.token,
                title: value.name,
                items: (value.album ?? []).map(albumItem)
            )

        case .playlist:
            guard let id = request.id else { return .failure(token: request.token, message: "Playlist missing") }
            let value = try await WaxloomAPI.playlist(baseURL: baseURL, id: id)
            return .success(
                token: request.token,
                title: value.name,
                subtitle: "\(value.songCount ?? value.entry?.count ?? 0) tracks",
                items: (value.entry ?? []).enumerated().map { index, song in
                    var item = songItem(song)
                    item.detail = "#\(index + 1)"
                    return item
                }
            )

        case .imports:
            let runtime = try await WaxloomAPI.youtubeRuntime(baseURL: baseURL)
            return .success(
                token: request.token,
                title: "Imports",
                status: runtime.ready ? "ready" : "blocked",
                message: runtime.ready ? "Search an authorized source" : "yt-dlp or music library unavailable",
                runtimeReady: runtime.ready
            )
        }
    }

    private static func songItem(_ value: WaxloomSong) -> WatchCatalogItem {
        WatchCatalogItem(
            id: value.id,
            kind: .song,
            title: value.title ?? "Unknown title",
            subtitle: value.artist ?? "Unknown artist",
            detail: value.album,
            coverArt: value.coverArt,
            duration: value.duration,
            starred: !(value.starred ?? "").isEmpty
        )
    }

    private static func albumItem(_ value: WaxloomAlbum) -> WatchCatalogItem {
        WatchCatalogItem(
            id: value.id,
            kind: .album,
            title: value.displayTitle,
            subtitle: value.artist,
            detail: value.songCount.map { "\($0) tracks" },
            coverArt: value.coverArt,
            duration: value.duration,
            starred: !(value.starred ?? "").isEmpty
        )
    }

    private static func artistItem(_ value: WaxloomArtist) -> WatchCatalogItem {
        WatchCatalogItem(
            id: value.id,
            kind: .artist,
            title: value.name,
            detail: value.albumCount.map { "\($0) albums" },
            coverArt: value.coverArt,
            starred: !(value.starred ?? "").isEmpty
        )
    }

    private static func playlistItem(_ value: WaxloomPlaylistSummary) -> WatchCatalogItem {
        WatchCatalogItem(
            id: value.id,
            kind: .playlist,
            title: value.name,
            subtitle: value.owner,
            detail: value.songCount.map { "\($0) tracks" },
            coverArt: value.coverArt,
            duration: value.duration
        )
    }

    private static func discoveryItem(_ value: WaxloomDiscoveryCandidate) -> WatchCatalogItem {
        WatchCatalogItem(
            id: value.recordingMbid,
            kind: .discovery,
            title: value.title,
            subtitle: value.artist,
            detail: value.reason,
            starred: value.feedback == 1,
            recordingMbid: value.recordingMbid,
            source: value.source,
            tags: value.tags,
            rank: value.rank,
            feedback: value.feedback
        )
    }

    private static func youtubeItem(_ value: WaxloomYouTubeCandidate) -> WatchCatalogItem {
        WatchCatalogItem(
            id: value.url,
            kind: .youtube,
            title: value.title,
            subtitle: value.channel ?? value.uploader,
            duration: value.duration,
            sourceURL: value.url,
            previewURL: value.previewUrl,
            thumbnailURL: value.thumbnail,
            score: value.score
        )
    }

    private static func discoveryCandidate(from item: WatchCatalogItem) -> WaxloomDiscoveryCandidate {
        WaxloomDiscoveryCandidate(
            recordingMbid: item.recordingMbid ?? item.id,
            artist: item.subtitle ?? "Unknown artist",
            title: item.title,
            release: nil,
            releaseMbid: nil,
            similarity: 0,
            underground: 0,
            rank: item.rank ?? 0,
            tags: item.tags,
            musicbrainzUrl: nil,
            source: item.source,
            reason: item.detail,
            feedback: item.feedback
        )
    }
}
