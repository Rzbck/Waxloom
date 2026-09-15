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

            case .refreshDiscovery:
                try await WaxloomAPI.refreshDiscoveryFeed(baseURL: baseURL)
                return .success(
                    token: request.token,
                    title: "Discovery refreshed",
                    message: "Generating a new Discovery feed"
                )

            case .seek:
                guard let position = request.position else {
                    return .failure(token: request.token, message: "Missing playback position")
                }
                player.seek(to: max(0, position))
                return .success(
                    token: request.token,
                    title: "Seeked",
                    message: "Playback position updated"
                )

            case .play:
                guard let item = request.item else {
                    return .failure(token: request.token, message: "Missing media item")
                }
                switch item.kind {
                case .song:
                    let song = try await WaxloomAPI.song(baseURL: baseURL, id: item.id)
                    let requestedQueue = (request.items ?? [])
                        .filter { $0.kind == .song }
                    let queueItems = requestedQueue.contains(where: { $0.id == item.id })
                        ? requestedQueue
                        : [item]
                    var queue = queueItems.map(songFromCatalogItem)
                    if let currentIndex = queue.firstIndex(where: { $0.id == song.id }) {
                        queue[currentIndex] = song
                    }
                    player.play(song: song, queue: queue, baseURL: baseURL)
                    return .success(token: request.token, title: "Playing", message: song.title ?? "Track")

                case .discovery:
                    let candidate = discoveryCandidate(from: item)

                    let feed = try await WaxloomAPI.discoveryFeed(baseURL: baseURL)
                    let authoritativeDiscoveryItems = discoveryItems(feed.external.items)
                    let section = item.section ?? "Closest"
                    let authoritativeShelf = authoritativeDiscoveryItems.filter {
                        ($0.section ?? "Closest") == section
                    }

                    let requestedQueue = (request.items ?? [])
                        .filter { $0.kind == .discovery }
                    let queueItems: [WatchCatalogItem]
                    if authoritativeShelf.contains(where: { $0.id == item.id }) {
                        queueItems = authoritativeShelf
                    } else if requestedQueue.contains(where: { $0.id == item.id }) {
                        queueItems = requestedQueue
                    } else {
                        queueItems = [item]
                    }

                    let queue = queueItems.map(discoveryCandidate)
                    await player.playPreview(candidate: candidate, queue: queue, baseURL: baseURL)
                    return .success(
                        token: request.token,
                        title: "Preview",
                        message: "\(candidate.title) · \(queue.count) in queue"
                    )

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
                return .success(
                    token: request.token,
                    title: value > 0 ? "Liked" : value < 0 ? "Less like this" : "Feedback cleared"
                )

            case .badSource:
                guard let item = request.item else {
                    return .failure(token: request.token, message: "Missing Discovery item")
                }
                let rejected = (request.value ?? 1) != 0
                try await WaxloomAPI.discoveryFeedback(
                    baseURL: baseURL,
                    candidate: discoveryCandidate(from: item),
                    value: rejected ? -1 : 0,
                    badSource: true
                )
                return .success(
                    token: request.token,
                    title: rejected ? "Source rejected" : "Source restored",
                    message: rejected
                        ? "Marked bad / non-music without changing musical taste"
                        : "Bad-source mark removed"
                )

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
            return .success(
                token: request.token,
                title: "Discovery",
                status: feed.status,
                items: discoveryItems(feed.external.items)
            )

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

    private static func discoveryItems(_ values: [WaxloomDiscoveryCandidate]) -> [WatchCatalogItem] {
        let ranked = values
            .filter { ($0.feedback ?? 0) >= 0 }
            .sorted { $0.rank > $1.rank }

        let listenbrainz = ranked.filter { $0.source == "listenbrainz" }
        let catalogue = ranked.filter { $0.source == "musicbrainz_catalog" }
        let otherMetadata = ranked.filter {
            $0.source != "youtube_dig"
                && $0.source != "listenbrainz"
                && $0.source != "musicbrainz_catalog"
        }

        var used = Set<String>()

        func artistKey(_ item: WaxloomDiscoveryCandidate) -> String {
            item.artist
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
                .lowercased()
        }

        func fillShelf(
            primary: [WaxloomDiscoveryCandidate],
            fallback: [WaxloomDiscoveryCandidate],
            target: Int
        ) -> [WaxloomDiscoveryCandidate] {
            var output: [WaxloomDiscoveryCandidate] = []
            var localIDs = Set<String>()
            var artistCounts: [String: Int] = [:]

            func append(_ candidate: WaxloomDiscoveryCandidate) {
                guard output.count < target else { return }
                guard !used.contains(candidate.recordingMbid) else { return }
                guard !localIDs.contains(candidate.recordingMbid) else { return }

                let artist = artistKey(candidate)
                guard artistCounts[artist, default: 0] < 2 else { return }

                output.append(candidate)
                localIDs.insert(candidate.recordingMbid)
                used.insert(candidate.recordingMbid)
                artistCounts[artist, default: 0] += 1
            }

            for candidate in primary { append(candidate) }
            if output.count < target {
                for candidate in fallback { append(candidate) }
            }
            return output
        }

        let deepListenbrainz = listenbrainz.sorted { lhs, rhs in
            let leftDepth = lhs.underground * 0.65 + max(0, 1 - lhs.rank) * 0.35
            let rightDepth = rhs.underground * 0.65 + max(0, 1 - rhs.rank) * 0.35
            return leftDepth > rightDepth
        }

        let proportionalReserve = listenbrainz.count < 2
            ? 0
            : max(1, Int(Double(listenbrainz.count) * 0.35))
        let catalogueShortfall = max(0, 6 - catalogue.count)
        let deepFallbackQuota = min(6, min(catalogueShortfall, proportionalReserve))
        let deepFallback = Array(deepListenbrainz.prefix(deepFallbackQuota))

        let deep = fillShelf(
            primary: catalogue,
            fallback: deepFallback,
            target: 20
        )

        let closestPrimary = (listenbrainz + otherMetadata)
            .filter { !used.contains($0.recordingMbid) }
            .sorted { $0.rank > $1.rank }

        let closest = fillShelf(
            primary: closestPrimary,
            fallback: closestPrimary,
            target: 20
        )

        let youtubeDigPrimary = ranked
            .filter { $0.source == "youtube_dig" }
            .sorted {
                ($0.underground + $0.rank * 0.25)
                    > ($1.underground + $1.rank * 0.25)
            }

        let rareMetadataFallback = listenbrainz
            .filter {
                !used.contains($0.recordingMbid)
                    && $0.underground >= 0.82
            }
            .sorted {
                ($0.underground + $0.rank * 0.15)
                    > ($1.underground + $1.rank * 0.15)
            }

        let underground = fillShelf(
            primary: youtubeDigPrimary,
            fallback: rareMetadataFallback,
            target: 28
        )

        func mapSection(
            _ section: String,
            _ candidates: [WaxloomDiscoveryCandidate]
        ) -> [WatchCatalogItem] {
            candidates.map { candidate in
                var item = discoveryItem(candidate)
                item.section = section
                return item
            }
        }

        return mapSection("Closest", closest)
            + mapSection("Underground", underground)
            + mapSection("Deep cuts", deep)
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

    private static func songFromCatalogItem(_ item: WatchCatalogItem) -> WaxloomSong {
        WaxloomSong(
            id: item.id,
            title: item.title,
            artist: item.subtitle,
            artistId: nil,
            album: item.detail,
            albumId: nil,
            coverArt: item.coverArt,
            duration: item.duration,
            track: nil,
            discNumber: nil,
            year: nil,
            genre: nil,
            suffix: nil,
            starred: item.starred ? "watch" : nil,
            musicBrainzId: nil
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
