import SwiftUI

struct WaxloomProductRootView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var watchBridge: PhoneWatchBridge
    @ObservedObject var player: NativePlayerModel
    @State private var restoredQueue = false

    var body: some View {
        TabView {
            NavigationStack {
                ProductHomeView(connection: connection, watchBridge: watchBridge, player: player)
            }
            .productMiniPlayerInset(connection: connection, player: player)
            .tabItem { Label("Home", systemImage: "house.fill") }

            NavigationStack {
                ProductBrowseView(connection: connection, player: player)
            }
            .productMiniPlayerInset(connection: connection, player: player)
            .tabItem { Label("Browse", systemImage: "square.grid.2x2.fill") }

            NavigationStack {
                ProductDiscoveryView(connection: connection, player: player)
            }
            .productMiniPlayerInset(connection: connection, player: player)
            .tabItem { Label("Discovery", systemImage: "sparkles") }

            NavigationStack {
                ProductSearchView(connection: connection, player: player)
            }
            .productMiniPlayerInset(connection: connection, player: player)
            .tabItem { Label("Search", systemImage: "magnifyingglass") }

            NavigationStack {
                ProductMoreView(connection: connection, watchBridge: watchBridge, player: player)
            }
            .productMiniPlayerInset(connection: connection, player: player)
            .tabItem { Label("More", systemImage: "ellipsis.circle.fill") }
        }
        .tint(ProductTheme.accent)
        .toolbarBackground(ProductTheme.background, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .task {
            await connection.connectSavedIfNeeded()
            player.setBaseURL(connection.baseURL)
            await restoreQueueIfNeeded()
        }
        .onChange(of: connection.isConnected) { _, connected in
            guard connected else { return }
            player.setBaseURL(connection.baseURL)
            Task { await restoreQueueIfNeeded() }
        }
        .onChange(of: connection.serverURLText) { _, _ in
            player.setBaseURL(connection.baseURL)
        }
    }

    private func restoreQueueIfNeeded() async {
        guard !restoredQueue, connection.isConnected, let baseURL = connection.baseURL else { return }
        restoredQueue = true
        await player.restoreQueue(baseURL: baseURL)
    }
}

private struct ProductHomeView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var watchBridge: PhoneWatchBridge
    @ObservedObject var player: NativePlayerModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                WaxloomBrandLockup()
                    .padding(.bottom, 4)

                Text("Good music\ngoes further.")
                    .font(.system(size: 42, weight: .bold, design: .rounded))
                    .tracking(-1.5)

                Text("Stream · Discover · Control")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ProductTheme.accent)

                ProductConnectionCard(connection: connection)

                HStack(spacing: 12) {
                    ProductStatusTile(
                        symbol: "applewatch",
                        title: "Watch",
                        value: watchBridge.watchInstalled
                            ? (watchBridge.watchReachable ? "Connected" : "Installed")
                            : "Not installed",
                        ready: watchBridge.watchInstalled
                    )
                    ProductStatusTile(
                        symbol: "network",
                        title: "Server",
                        value: connection.isConnected ? "Online" : "Offline",
                        ready: connection.isConnected
                    )
                }

                ProductNowPlayingCard(connection: connection, player: player)
            }
            .padding(18)
        }
        .background(ProductTheme.background.ignoresSafeArea())
        .navigationBarHidden(true)
    }
}

private struct ProductBrowseView: View {
    enum Section: String, CaseIterable, Identifiable {
        case albums = "Albums"
        case artists = "Artists"
        case playlists = "Playlists"
        case favorites = "Favorites"
        var id: String { rawValue }
    }

    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var section: Section = .albums

    var body: some View {
        VStack(spacing: 0) {
            Picker("Browse", selection: $section) {
                ForEach(Section.allCases) { value in
                    Text(value.rawValue).tag(value)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            Group {
                switch section {
                case .albums:
                    ProductAlbumsView(connection: connection, player: player)
                case .artists:
                    ProductArtistsView(connection: connection, player: player)
                case .playlists:
                    ProductPlaylistsView(connection: connection, player: player)
                case .favorites:
                    ProductFavoritesView(connection: connection, player: player)
                }
            }
        }
        .background(ProductTheme.background.ignoresSafeArea())
        .navigationTitle("Browse")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ProductAlbumsView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var albums: [WaxloomAlbum] = []
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            if !connection.isConnected {
                ProductDisconnectedCard()
            } else if loading && albums.isEmpty {
                ProgressView("Loading albums…")
                    .frame(maxWidth: .infinity, minHeight: 240)
            } else {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                    ForEach(albums) { album in
                        NavigationLink {
                            ProductAlbumDetailView(connection: connection, player: player, seed: album)
                        } label: {
                            ProductAlbumTile(connection: connection, album: album)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }

            ProductErrorText(error)
        }
        .task(id: connection.isConnected) { if connection.isConnected { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        loading = true
        defer { loading = false }
        do {
            albums = try await WaxloomAPI.albums(baseURL: base, type: "newest", size: 120)
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

private struct ProductArtistsView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var artists: [WaxloomArtist] = []
    @State private var error: String?

    var body: some View {
        List {
            ForEach(artists) { artist in
                NavigationLink {
                    ProductArtistDetailView(connection: connection, player: player, seed: artist)
                } label: {
                    HStack(spacing: 12) {
                        ProductArtwork(url: coverURL(artist.coverArt), size: 50, circular: true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(artist.name).font(.headline).lineLimit(1)
                            Text("\(artist.albumCount ?? 0) albums")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.orange) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .task(id: connection.isConnected) { if connection.isConnected { await load() } }
        .refreshable { await load() }
    }

    private func coverURL(_ id: String?) -> URL? {
        connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: id, size: 180) }
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        do { artists = try await WaxloomAPI.artists(baseURL: base); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

private struct ProductPlaylistsView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var playlists: [WaxloomPlaylistSummary] = []
    @State private var newName = ""
    @State private var showCreate = false
    @State private var error: String?

    var body: some View {
        List {
            ForEach(playlists) { playlist in
                NavigationLink {
                    ProductPlaylistDetailView(connection: connection, player: player, seed: playlist)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "music.note.list")
                            .font(.title3)
                            .foregroundStyle(ProductTheme.accent)
                            .frame(width: 46, height: 46)
                            .background(ProductTheme.panel, in: RoundedRectangle(cornerRadius: 12))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(playlist.name).font(.headline)
                            Text("\(playlist.songCount ?? 0) tracks")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) { Task { await remove(playlist) } } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.orange) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCreate = true } label: { Image(systemName: "plus") }
            }
        }
        .alert("New playlist", isPresented: $showCreate) {
            TextField("Playlist name", text: $newName)
            Button("Create") { Task { await create() } }
            Button("Cancel", role: .cancel) { newName = "" }
        }
        .task(id: connection.isConnected) { if connection.isConnected { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        do { playlists = try await WaxloomAPI.playlists(baseURL: base); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func create() async {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        newName = ""
        guard !name.isEmpty, let base = connection.baseURL else { return }
        do { _ = try await WaxloomAPI.createPlaylist(baseURL: base, name: name); await load() }
        catch { self.error = error.localizedDescription }
    }

    private func remove(_ playlist: WaxloomPlaylistSummary) async {
        guard let base = connection.baseURL else { return }
        do { try await WaxloomAPI.deletePlaylist(baseURL: base, id: playlist.id); await load() }
        catch { self.error = error.localizedDescription }
    }
}

private struct ProductFavoritesView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var artists: [WaxloomArtist] = []
    @State private var albums: [WaxloomAlbum] = []
    @State private var songs: [WaxloomSong] = []
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if !songs.isEmpty {
                    ProductSectionTitle("SONGS")
                    ForEach(songs) { song in
                        ProductSongRow(connection: connection, player: player, song: song, queue: songs)
                    }
                }

                if !albums.isEmpty {
                    ProductSectionTitle("ALBUMS")
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                        ForEach(albums) { album in
                            NavigationLink {
                                ProductAlbumDetailView(connection: connection, player: player, seed: album)
                            } label: { ProductAlbumTile(connection: connection, album: album) }
                                .buttonStyle(.plain)
                        }
                    }
                }

                if !artists.isEmpty {
                    ProductSectionTitle("ARTISTS")
                    ForEach(artists) { artist in
                        NavigationLink {
                            ProductArtistDetailView(connection: connection, player: player, seed: artist)
                        } label: {
                            HStack {
                                ProductArtwork(url: coverURL(artist.coverArt), size: 48, circular: true)
                                Text(artist.name).font(.headline)
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                if artists.isEmpty && albums.isEmpty && songs.isEmpty && error == nil {
                    ContentUnavailableView("No favorites yet", systemImage: "heart")
                }
                ProductErrorText(error)
            }
            .padding(16)
        }
        .task(id: connection.isConnected) { if connection.isConnected { await load() } }
        .refreshable { await load() }
    }

    private func coverURL(_ id: String?) -> URL? {
        connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: id, size: 180) }
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        do {
            let values = try await WaxloomAPI.starred(baseURL: base)
            artists = values.artists; albums = values.albums; songs = values.songs; error = nil
        } catch { self.error = error.localizedDescription }
    }
}

private struct ProductAlbumDetailView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    let seed: WaxloomAlbum
    @State private var album: WaxloomAlbum?
    @State private var starred: Bool
    @State private var error: String?

    init(connection: ConnectionModel, player: NativePlayerModel, seed: WaxloomAlbum) {
        self.connection = connection
        self.player = player
        self.seed = seed
        _starred = State(initialValue: !(seed.starred ?? "").isEmpty)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                ProductArtwork(url: coverURL, size: 280)
                Text(seed.displayTitle).font(.title2.bold()).multilineTextAlignment(.center)
                Text(seed.artist ?? "Unknown artist").foregroundStyle(.secondary)

                Button {
                    Task { await toggleStar() }
                } label: {
                    Label(starred ? "Favorited" : "Favorite", systemImage: starred ? "heart.fill" : "heart")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(ProductTheme.accent)

                if let songs = album?.song, !songs.isEmpty {
                    ForEach(songs) { song in
                        ProductSongRow(connection: connection, player: player, song: song, queue: songs)
                    }
                } else if error == nil {
                    ProgressView()
                }
                ProductErrorText(error)
            }
            .padding(18)
        }
        .background(ProductTheme.background.ignoresSafeArea())
        .navigationTitle(seed.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var coverURL: URL? {
        connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: seed.coverArt, size: 900) }
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        do { album = try await WaxloomAPI.album(baseURL: base, id: seed.id); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func toggleStar() async {
        guard let base = connection.baseURL else { return }
        do { try await WaxloomAPI.setStarred(baseURL: base, id: seed.id, starred: !starred); starred.toggle() }
        catch { self.error = error.localizedDescription }
    }
}

private struct ProductArtistDetailView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    let seed: WaxloomArtist
    @State private var artist: WaxloomArtist?
    @State private var starred: Bool
    @State private var error: String?

    init(connection: ConnectionModel, player: NativePlayerModel, seed: WaxloomArtist) {
        self.connection = connection
        self.player = player
        self.seed = seed
        _starred = State(initialValue: !(seed.starred ?? "").isEmpty)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 16) {
                    ProductArtwork(url: coverURL(seed.coverArt), size: 96, circular: true)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(seed.name).font(.title2.bold())
                        Text("\(seed.albumCount ?? 0) albums").foregroundStyle(.secondary)
                        Button { Task { await toggleStar() } } label: {
                            Label(starred ? "Favorited" : "Favorite", systemImage: starred ? "heart.fill" : "heart")
                        }
                        .buttonStyle(.bordered)
                    }
                }

                ProductSectionTitle("ALBUMS")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                    ForEach(artist?.album ?? []) { album in
                        NavigationLink {
                            ProductAlbumDetailView(connection: connection, player: player, seed: album)
                        } label: { ProductAlbumTile(connection: connection, album: album) }
                            .buttonStyle(.plain)
                    }
                }
                ProductErrorText(error)
            }
            .padding(16)
        }
        .background(ProductTheme.background.ignoresSafeArea())
        .navigationTitle(seed.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func coverURL(_ id: String?) -> URL? {
        connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: id, size: 500) }
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        do { artist = try await WaxloomAPI.artist(baseURL: base, id: seed.id); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func toggleStar() async {
        guard let base = connection.baseURL else { return }
        do { try await WaxloomAPI.setStarred(baseURL: base, id: seed.id, starred: !starred); starred.toggle() }
        catch { self.error = error.localizedDescription }
    }
}

private struct ProductPlaylistDetailView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    let seed: WaxloomPlaylistSummary
    @State private var detail: WaxloomPlaylistDetail?
    @State private var error: String?

    var body: some View {
        List {
            if let songs = detail?.entry {
                ForEach(Array(songs.enumerated()), id: \.element.id) { index, song in
                    ProductSongRow(connection: connection, player: player, song: song, queue: songs)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) { Task { await remove(index: index) } } label: {
                                Label("Remove", systemImage: "minus.circle")
                            }
                        }
                }
            }
            if let error { Text(error).foregroundStyle(.orange) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationTitle(seed.name)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    ProductAddToPlaylistView(connection: connection, playlist: seed)
                } label: { Image(systemName: "plus") }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        do { detail = try await WaxloomAPI.playlist(baseURL: base, id: seed.id); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func remove(index: Int) async {
        guard let base = connection.baseURL else { return }
        do {
            try await WaxloomAPI.updatePlaylist(baseURL: base, id: seed.id, songIndexesToRemove: [index])
            await load()
        } catch { self.error = error.localizedDescription }
    }
}

private struct ProductAddToPlaylistView: View {
    @ObservedObject var connection: ConnectionModel
    let playlist: WaxloomPlaylistSummary
    @State private var query = ""
    @State private var songs: [WaxloomSong] = []
    @State private var message: String?

    var body: some View {
        List {
            ForEach(songs) { song in
                Button {
                    Task { await add(song) }
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(song.title ?? "Unknown title")
                            Text(song.artist ?? "Unknown artist").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "plus.circle.fill").foregroundStyle(ProductTheme.accent)
                    }
                }
                .buttonStyle(.plain)
            }
            if let message { Text(message).foregroundStyle(.secondary) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationTitle("Add tracks")
        .searchable(text: $query, prompt: "Search library")
        .onSubmit(of: .search) { Task { await search() } }
    }

    private func search() async {
        guard let base = connection.baseURL, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        do { songs = try await WaxloomAPI.search(baseURL: base, query: query).songs; message = nil }
        catch { message = error.localizedDescription }
    }

    private func add(_ song: WaxloomSong) async {
        guard let base = connection.baseURL else { return }
        do {
            try await WaxloomAPI.updatePlaylist(baseURL: base, id: playlist.id, songIDsToAdd: [song.id])
            message = "Added \(song.title ?? "track")"
        } catch { message = error.localizedDescription }
    }
}

private struct ProductSearchView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var query = ""
    @State private var results = WaxloomSearchResults(artists: [], albums: [], songs: [])
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if loading { ProgressView().frame(maxWidth: .infinity) }

                if !results.songs.isEmpty {
                    ProductSectionTitle("SONGS")
                    ForEach(results.songs) { song in
                        ProductSongRow(connection: connection, player: player, song: song, queue: results.songs)
                    }
                }

                if !results.albums.isEmpty {
                    ProductSectionTitle("ALBUMS")
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                        ForEach(results.albums) { album in
                            NavigationLink {
                                ProductAlbumDetailView(connection: connection, player: player, seed: album)
                            } label: { ProductAlbumTile(connection: connection, album: album) }
                                .buttonStyle(.plain)
                        }
                    }
                }

                if !results.artists.isEmpty {
                    ProductSectionTitle("ARTISTS")
                    ForEach(results.artists) { artist in
                        NavigationLink {
                            ProductArtistDetailView(connection: connection, player: player, seed: artist)
                        } label: {
                            HStack {
                                ProductArtwork(url: connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: artist.coverArt, size: 180) }, size: 48, circular: true)
                                Text(artist.name).font(.headline)
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                if !loading && query.isEmpty {
                    ContentUnavailableView("Search Waxloom", systemImage: "magnifyingglass", description: Text("Songs, albums and artists"))
                }
                ProductErrorText(error)
            }
            .padding(16)
        }
        .background(ProductTheme.background.ignoresSafeArea())
        .navigationTitle("Search")
        .searchable(text: $query, prompt: "Search songs, albums, artists")
        .onSubmit(of: .search) { Task { await search() } }
    }

    private func search() async {
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let base = connection.baseURL, !clean.isEmpty else { return }
        loading = true
        defer { loading = false }
        do { results = try await WaxloomAPI.search(baseURL: base, query: clean); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

private struct ProductDiscoveryView: View {
    private enum Lane: String, CaseIterable, Identifiable {
        case closest = "Close"
        case underground = "Underground"
        case deep = "Deep"

        var id: String { rawValue }

        var title: String {
            switch self {
            case .closest: return "Closest to your collection"
            case .underground: return "More underground"
            case .deep: return "Deep cuts"
            }
        }

        var eyebrow: String {
            switch self {
            case .closest: return "BEST MATCHES"
            case .underground: return "YOUTUBE DIG · LOW EXPOSURE"
            case .deep: return "CATALOGUE · FARTHER MATCHES"
            }
        }

        var emptyDescription: String {
            switch self {
            case .closest: return "No close matches in this rotation yet."
            case .underground: return "No underground picks in this rotation yet."
            case .deep: return "No deep cuts in this rotation yet."
            }
        }
    }

    private struct Shelves {
        let closest: [WaxloomDiscoveryCandidate]
        let underground: [WaxloomDiscoveryCandidate]
        let deep: [WaxloomDiscoveryCandidate]
    }

    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var candidates: [WaxloomDiscoveryCandidate] = []
    @State private var status = "starting"
    @State private var loading = false
    @State private var error: String?
    @State private var lane: Lane = .closest
    @State private var importingMbid: String?
    @State private var pendingAuthorizationCandidate: WaxloomDiscoveryCandidate?
    @State private var manualImportCandidate: WaxloomDiscoveryCandidate?
    @State private var importMessage: String?
    @State private var rejectedSourceMbids: Set<String> = []
    @AppStorage("waxloom.authorizedMediaImports.v1")
    private var importAuthorized = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("DISCOVERY").font(.caption.bold()).tracking(2).foregroundStyle(.secondary)
                        Text("Outside your library").font(.title2.bold())
                    }
                    Spacer()
                    Menu {
                        Button("Reload") { Task { await load() } }
                        Button("Generate new feed") { Task { await refreshFeed() } }
                    } label: {
                        Image(systemName: "arrow.clockwise.circle.fill").font(.title2)
                    }
                }

                HStack(spacing: 7) {
                    Circle().fill(status == "ready" ? Color.green : Color.orange).frame(width: 8, height: 8)
                    Text(status == "ready" ? "Feed ready" : status.capitalized)
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text("Swipe between lanes")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .foregroundStyle(.secondary)

                Picker("Discovery lane", selection: $lane) {
                    ForEach(Lane.allCases) { value in
                        Text(value.rawValue).tag(value)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 10)

            TabView(selection: $lane) {
                ForEach(Lane.allCases) { value in
                    discoveryPage(value)
                        .tag(value)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .background(ProductTheme.background.ignoresSafeArea())
        .navigationTitle("Discovery")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $manualImportCandidate) { candidate in
            ProductImportsView(
                connection: connection,
                seedArtist: candidate.artist,
                seedTitle: candidate.title
            )
        }
        .alert(
            "Authorized media import",
            isPresented: Binding(
                get: { pendingAuthorizationCandidate != nil },
                set: { shown in
                    if !shown {
                        pendingAuthorizationCandidate = nil
                    }
                }
            )
        ) {
            Button("Cancel", role: .cancel) {
                pendingAuthorizationCandidate = nil
            }

            Button("Confirm & import") {
                guard let candidate = pendingAuthorizationCandidate else {
                    return
                }

                pendingAuthorizationCandidate = nil
                importAuthorized = true

                Task {
                    await quickImport(candidate)
                }
            }
        } message: {
            Text(
                "Waxloom can download this music source into your local library. Confirm that you are authorized to save media you import this way."
            )
        }
        .task(id: connection.isConnected) { if connection.isConnected { await load() } }
    }

    @ViewBuilder
    private func discoveryPage(_ value: Lane) -> some View {
        let items = items(for: value)

        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(value.eyebrow) · \(items.count) TRACKS")
                        .font(.caption2.bold())
                        .tracking(1.4)
                        .foregroundStyle(.secondary)
                    Text(value.title)
                        .font(.title3.bold())
                }

                if loading && candidates.isEmpty {
                    ProgressView("Loading Discovery…")
                        .frame(maxWidth: .infinity, minHeight: 180)
                } else if items.isEmpty && error == nil {
                    ContentUnavailableView(
                        value.title,
                        systemImage: "sparkles",
                        description: Text(value.emptyDescription)
                    )
                    .frame(maxWidth: .infinity, minHeight: 220)
                }

                ForEach(items) { candidate in
                    discoveryCard(candidate, queue: items)
                }

                if let importMessage {
                    Text(importMessage)
                        .font(.caption)
                        .foregroundStyle(.green)
                }

                ProductErrorText(error)
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .padding(.bottom, 18)
        }
        .refreshable { await load() }
    }

    private func discoveryCard(_ candidate: WaxloomDiscoveryCandidate, queue: [WaxloomDiscoveryCandidate]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(candidate.title).font(.headline).lineLimit(2)
                    Text(candidate.artist).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(Int(max(0, min(1, candidate.rank)) * 100))%")
                    .font(.caption.bold())
                    .foregroundStyle(ProductTheme.accent)
            }

            HStack(spacing: 8) {
                ProductCapsuleButton(
                    symbol: player.currentPreview?.recordingMbid == candidate.recordingMbid && player.isPlaying ? "pause.fill" : "play.fill",
                    label: "Play"
                ) {
                    guard let base = connection.baseURL else { return }
                    Task { await player.playPreview(candidate: candidate, queue: queue, baseURL: base) }
                }

                ProductCapsuleButton(symbol: candidate.feedback == 1 ? "heart.fill" : "heart", label: "Like") {
                    Task { await feedback(candidate, value: candidate.feedback == 1 ? 0 : 1) }
                }

                ProductCapsuleButton(
                    symbol: candidate.feedback == -1 ? "hand.thumbsdown.fill" : "hand.thumbsdown",
                    label: "Less"
                ) {
                    Task { await feedback(candidate, value: candidate.feedback == -1 ? 0 : -1) }
                }

                Button {
                    beginQuickImport(candidate)
                } label: {
                    Group {
                        if importingMbid == candidate.recordingMbid {
                            ProgressView()
                        } else {
                            Image(systemName: "plus.circle")
                        }
                    }
                    .frame(width: 36, height: 36)
                    .background(Color.white.opacity(0.07), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(importingMbid != nil)
                .accessibilityLabel(
                    importingMbid == candidate.recordingMbid
                        ? "Adding to library"
                        : "Add to library"
                )

                if candidate.source == "youtube_dig" {
                    let rejected = rejectedSourceMbids.contains(candidate.recordingMbid)
                    Button { Task { await toggleBadSource(candidate) } } label: {
                        Image(systemName: rejected ? "arrow.uturn.backward.circle.fill" : "xmark.circle")
                            .foregroundStyle(rejected ? Color.green : Color.orange)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(rejected ? "Undo bad source" : "Bad or non-music source")
                } else {
                    Color.clear
                        .frame(width: 36, height: 36)
                        .accessibilityHidden(true)
                }
            }

            if let reason = candidate.reason, !reason.isEmpty {
                Text(reason).font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .productCard()
    }

    private func beginQuickImport(
        _ candidate: WaxloomDiscoveryCandidate
    ) {
        guard importingMbid == nil else {
            return
        }

        error = nil
        importMessage = nil

        if importAuthorized {
            Task {
                await quickImport(candidate)
            }
        } else {
            pendingAuthorizationCandidate = candidate
        }
    }

    private func quickImport(
        _ candidate: WaxloomDiscoveryCandidate
    ) async {
        guard importingMbid == nil,
              let base = connection.baseURL else {
            return
        }

        importingMbid = candidate.recordingMbid
        error = nil
        importMessage = nil

        defer {
            importingMbid = nil
        }

        do {
            let matches = try await WaxloomAPI.youtubeSearch(
                baseURL: base,
                artist: candidate.artist,
                title: candidate.title,
                limit: 1
            )

            guard let best = matches.first else {
                importMessage =
                    "No automatic source was found. Choose the source manually."
                manualImportCandidate = candidate
                return
            }

            if best.score < 80 {
                importMessage =
                    "The automatic source match is ambiguous. Choose the source manually."
                manualImportCandidate = candidate
                return
            }

            let result = try await WaxloomAPI.youtubeImport(
                baseURL: base,
                artist: candidate.artist,
                title: candidate.title,
                sourceURL: best.url,
                authorized: true
            )

            // Remove it immediately. The backend also persists the import
            // exclusion so the candidate stays out of later rotations.
            candidates.removeAll {
                $0.recordingMbid == candidate.recordingMbid
            }

            switch result.status {
            case "already_local":
                importMessage =
                    "Already in your library — removed from Discovery."

            case "imported":
                importMessage =
                    "Added to your library."

            default:
                importMessage =
                    "Downloaded to your library. Navidrome is indexing it."
            }

            error = nil
        } catch {
            importMessage = nil
            self.error = error.localizedDescription
        }
    }

    private var shelves: Shelves {
        let ranked = candidates.sorted { $0.rank > $1.rank }

        var used = Set<String>()

        let listenbrainz = ranked.filter {
            $0.source == "listenbrainz"
        }

        let catalogue = ranked.filter {
            $0.source == "musicbrainz_catalog"
        }

        let otherMetadata = ranked.filter {
            $0.source != "youtube_dig"
                && $0.source != "listenbrainz"
                && $0.source != "musicbrainz_catalog"
        }

        // Deep cuts gets catalogue first, then a bounded reserve
        // of farther / rarer ListenBrainz candidates.
        let deepListenbrainz = listenbrainz.sorted {
            let leftDepth =
                $0.underground * 0.65
                + max(0.0, 1.0 - $0.rank) * 0.35

            let rightDepth =
                $1.underground * 0.65
                + max(0.0, 1.0 - $1.rank) * 0.35

            return leftDepth > rightDepth
        }

        let proportionalReserve =
            listenbrainz.count < 2
                ? 0
                : max(
                    1,
                    Int(
                        Double(listenbrainz.count) * 0.35
                    )
                )

        let catalogueShortfall =
            max(0, 6 - catalogue.count)

        let deepFallbackQuota =
            min(
                6,
                min(
                    catalogueShortfall,
                    proportionalReserve
                )
            )

        let deepFallback = Array(
            deepListenbrainz.prefix(
                deepFallbackQuota
            )
        )

        let deep = fillShelf(
            primary: catalogue,
            fallback: deepFallback,
            used: &used,
            target: 20
        )

        let closestPrimary =
            (listenbrainz + otherMetadata)
                .filter {
                    !used.contains(
                        $0.recordingMbid
                    )
                }
                .sorted {
                    $0.rank > $1.rank
                }

        let closest = fillShelf(
            primary: closestPrimary,
            fallback: closestPrimary,
            used: &used,
            target: 20
        )

        let youtubeDigPrimary = ranked
            .filter {
                $0.source == "youtube_dig"
            }
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
            used: &used,
            target: 28
        )

        return Shelves(
            closest: closest,
            underground: underground,
            deep: deep
        )
    }

    private func items(for value: Lane) -> [WaxloomDiscoveryCandidate] {
        let valueSet = shelves
        switch value {
        case .closest: return valueSet.closest
        case .underground: return valueSet.underground
        case .deep: return valueSet.deep
        }
    }

    private func diversify(_ items: [WaxloomDiscoveryCandidate], maxPerArtist: Int = 2) -> [WaxloomDiscoveryCandidate] {
        var counts: [String: Int] = [:]
        var output: [WaxloomDiscoveryCandidate] = []

        for candidate in items {
            let key = candidate.artist.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let artistKey = key.isEmpty ? candidate.recordingMbid : key
            let count = counts[artistKey, default: 0]
            if count >= maxPerArtist { continue }
            counts[artistKey] = count + 1
            output.append(candidate)
        }
        return output
    }

    private func fillShelf(
        primary: [WaxloomDiscoveryCandidate],
        fallback: [WaxloomDiscoveryCandidate],
        used: inout Set<String>,
        target: Int
    ) -> [WaxloomDiscoveryCandidate] {
        var output: [WaxloomDiscoveryCandidate] = []

        for candidate in diversify(primary) {
            if used.contains(candidate.recordingMbid) { continue }
            if output.contains(where: { $0.recordingMbid == candidate.recordingMbid }) { continue }
            output.append(candidate)
            if output.count >= target { break }
        }

        if output.count < target {
            for candidate in diversify(fallback) {
                if used.contains(candidate.recordingMbid) { continue }
                if output.contains(where: { $0.recordingMbid == candidate.recordingMbid }) { continue }
                output.append(candidate)
                if output.count >= target { break }
            }
        }

        for candidate in output {
            used.insert(candidate.recordingMbid)
        }
        return output
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        loading = true
        defer { loading = false }
        do {
            let feed = try await WaxloomAPI.discoveryFeed(baseURL: base)
            status = feed.status
            candidates = feed.external.items.filter { ($0.feedback ?? 0) >= 0 }.sorted { $0.rank > $1.rank }
            rejectedSourceMbids = rejectedSourceMbids.intersection(Set(candidates.map(\.recordingMbid)))
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func refreshFeed() async {
        guard let base = connection.baseURL else { return }
        do { try await WaxloomAPI.refreshDiscoveryFeed(baseURL: base); await load() }
        catch { self.error = error.localizedDescription }
    }

    private func feedback(_ candidate: WaxloomDiscoveryCandidate, value: Int) async {
        guard let base = connection.baseURL else { return }
        do {
            try await WaxloomAPI.discoveryFeedback(baseURL: base, candidate: candidate, value: value)
            if let index = candidates.firstIndex(where: { $0.recordingMbid == candidate.recordingMbid }) {
                candidates[index].feedback = value
            }
        } catch { self.error = error.localizedDescription }
    }

    private func toggleBadSource(_ candidate: WaxloomDiscoveryCandidate) async {
        guard candidate.source == "youtube_dig", let base = connection.baseURL else { return }
        let rejected = rejectedSourceMbids.contains(candidate.recordingMbid)
        let nextRejected = !rejected
        do {
            try await WaxloomAPI.discoveryFeedback(
                baseURL: base,
                candidate: candidate,
                value: nextRejected ? 1 : 0,
                badSource: true
            )
            if nextRejected {
                rejectedSourceMbids.insert(candidate.recordingMbid)
            } else {
                rejectedSourceMbids.remove(candidate.recordingMbid)
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct ProductMoreView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var watchBridge: PhoneWatchBridge
    @ObservedObject var player: NativePlayerModel

    var body: some View {
        List {
            Section("Tools") {
                NavigationLink {
                    ProductImportsView(connection: connection)
                } label: { Label("Authorized imports", systemImage: "arrow.down.circle.fill") }

                NavigationLink {
                    ProductSettingsView(connection: connection, watchBridge: watchBridge)
                } label: { Label("Settings", systemImage: "gearshape.fill") }
            }

            Section("Status") {
                LabeledContent("Server", value: connection.isConnected ? "Connected" : "Offline")
                LabeledContent("Watch", value: watchBridge.watchReachable ? "Reachable" : watchBridge.watchInstalled ? "Installed" : "Not installed")
                LabeledContent("Build", value: String(BuildInfo.gitSHA.prefix(12)))
            }
        }
        .scrollContentBackground(.hidden)
        .background(ProductTheme.background)
        .navigationTitle("More")
    }
}

private struct ProductImportsView: View {
    @ObservedObject var connection: ConnectionModel
    let seedArtist: String
    let seedTitle: String
    @State private var artist: String
    @State private var title: String
    @State private var runtime: WaxloomYouTubeRuntime?
    @State private var candidates: [WaxloomYouTubeCandidate] = []
    @State private var selectedURL: String?
    @AppStorage("waxloom.authorizedMediaImports.v1")
    private var authorized = false
    @State private var searching = false
    @State private var importing = false
    @State private var message: String?
    @State private var error: String?

    init(connection: ConnectionModel, seedArtist: String = "", seedTitle: String = "") {
        self.connection = connection
        self.seedArtist = seedArtist
        self.seedTitle = seedTitle
        _artist = State(initialValue: seedArtist)
        _title = State(initialValue: seedTitle)
    }

    var body: some View {
        Form {
            Section("Authorized media import") {
                TextField("Artist", text: $artist)
                TextField("Track title", text: $title)
                LabeledContent("Runtime", value: runtime?.ready == true ? "Ready" : "Unavailable")
                Button {
                    Task { await search() }
                } label: {
                    HStack { if searching { ProgressView() }; Text("Search YouTube") }
                }
                .disabled(searching || artist.trimmingCharacters(in: .whitespaces).isEmpty || title.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if !candidates.isEmpty {
                Section("Source candidates") {
                    ForEach(candidates) { candidate in
                        Button {
                            selectedURL = candidate.url
                        } label: {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(candidate.title).foregroundStyle(.primary).lineLimit(2)
                                    Text(candidate.channel ?? candidate.uploader ?? "Unknown channel")
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                                VStack {
                                    Text("\(Int(candidate.score.rounded()))%")
                                        .font(.caption.bold()).foregroundStyle(ProductTheme.accent)
                                    Image(systemName: selectedURL == candidate.url ? "checkmark.circle.fill" : "circle")
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            Section("Local library") {
                Toggle("I confirm I am authorized to save this media", isOn: $authorized)
                Button {
                    Task { await importSelected() }
                } label: {
                    HStack { if importing { ProgressView() }; Text("Download + add to library") }
                }
                .disabled(selectedURL == nil || !authorized || importing || runtime?.ready != true)
            }

            if let message { Section { Text(message).foregroundStyle(.green) } }
            if let error { Section { Text(error).foregroundStyle(.orange) } }
        }
        .scrollContentBackground(.hidden)
        .background(ProductTheme.background)
        .navigationTitle("Imports")
        .task { await inspectRuntime(); if !seedArtist.isEmpty && !seedTitle.isEmpty { await search() } }
    }

    private func inspectRuntime() async {
        guard let base = connection.baseURL else { return }
        do { runtime = try await WaxloomAPI.youtubeRuntime(baseURL: base); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func search() async {
        guard let base = connection.baseURL else { return }
        searching = true
        defer { searching = false }
        do {
            candidates = try await WaxloomAPI.youtubeSearch(baseURL: base, artist: artist, title: title)
            selectedURL = nil; message = nil; error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func importSelected() async {
        guard let base = connection.baseURL,
              let selected = candidates.first(where: { $0.url == selectedURL }), authorized else { return }
        importing = true
        defer { importing = false }
        do {
            let result = try await WaxloomAPI.youtubeImport(
                baseURL: base,
                artist: artist.trimmingCharacters(in: .whitespacesAndNewlines),
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                sourceURL: selected.url,
                authorized: true
            )
            message = result.status == "already_local" ? "Already in your library." : "Imported into your library."
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

private struct ProductSettingsView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var watchBridge: PhoneWatchBridge

    var body: some View {
        Form {
            Section("Waxloom server") {
                TextField("https://waxloom.your-tailnet.ts.net", text: $connection.serverURLText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button { Task { await connection.connect() } } label: {
                    HStack { if case .connecting = connection.state { ProgressView() }; Text("Connect securely") }
                }
                LabeledContent("Status", value: connection.statusText)
            }
            Section("Apple Watch") {
                LabeledContent("Installed", value: watchBridge.watchInstalled ? "Yes" : "No")
                LabeledContent("Reachable", value: watchBridge.watchReachable ? "Yes" : "No")
                Text("The Watch browses Waxloom through the iPhone. Provider credentials never leave the server.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Build") { LabeledContent("SHA", value: BuildInfo.gitSHA) }
        }
        .scrollContentBackground(.hidden)
        .background(ProductTheme.background)
        .navigationTitle("Settings")
    }
}

private struct ProductMiniPlayer: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var showPlayer = false

    var body: some View {
        HStack(spacing: 9) {
            Button { showPlayer = true } label: {
                HStack(spacing: 9) {
                    ProductArtwork(url: coverURL, size: 38)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title).font(.caption.weight(.semibold)).lineLimit(1)
                        Text(artist).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer(minLength: 6)
            Button { Task { await player.previous() } } label: {
                Image(systemName: "backward.fill").frame(width: 28, height: 32)
            }
            Button { player.toggle() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .frame(width: 32, height: 32)
                    .background(ProductTheme.accent.opacity(0.22), in: Circle())
            }
            Button { Task { await player.next() } } label: {
                Image(systemName: "forward.fill").frame(width: 28, height: 32)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 10)
        .frame(height: 54)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.09), lineWidth: 1)
        }
        .sheet(isPresented: $showPlayer) {
            ProductNowPlayingView(connection: connection, player: player)
        }
    }

    private var title: String { player.currentSong?.title ?? player.currentPreview?.title ?? "Waxloom" }
    private var artist: String { player.currentSong?.artist ?? player.currentPreview?.artist ?? "" }
    private var coverURL: URL? {
        guard let base = connection.baseURL else { return nil }
        return WaxloomAPI.coverURL(baseURL: base, coverID: player.currentSong?.coverArt, size: 180)
    }
}

private struct ProductNowPlayingView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @Environment(\.dismiss) private var dismiss
    @State private var starred = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    ProductArtwork(url: coverURL, size: 300)
                        .padding(.top, 16)

                    VStack(spacing: 5) {
                        Text(title).font(.title2.bold()).multilineTextAlignment(.center)
                        Text(artist).foregroundStyle(.secondary)
                        Text(player.mode == .preview ? "Discovery preview" : "Library")
                            .font(.caption.bold()).foregroundStyle(ProductTheme.accent)
                    }

                    VStack(spacing: 8) {
                        Slider(
                            value: Binding(
                                get: { min(player.elapsedSeconds, max(player.durationSeconds, player.elapsedSeconds)) },
                                set: { player.seek(to: $0) }
                            ),
                            in: 0...max(1, player.durationSeconds)
                        )
                        .tint(ProductTheme.accent)
                        HStack {
                            Text(productTime(player.elapsedSeconds))
                            Spacer()
                            Text(productTime(player.durationSeconds))
                        }
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 28) {
                        Button { player.skip(by: -15) } label: { Image(systemName: "gobackward.15").font(.title2) }
                        Button { Task { await player.previous() } } label: { Image(systemName: "backward.fill").font(.title) }
                        Button { player.toggle() } label: {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 31, weight: .black))
                                .frame(width: 72, height: 72)
                                .background(ProductTheme.accent, in: Circle())
                                .foregroundStyle(.white)
                        }
                        Button { Task { await player.next() } } label: { Image(systemName: "forward.fill").font(.title) }
                        Button { player.skip(by: 15) } label: { Image(systemName: "goforward.15").font(.title2) }
                    }
                    .buttonStyle(.plain)

                    if player.mode == .library, let song = player.currentSong {
                        Button { Task { await toggleStar(song) } } label: {
                            Label(starred ? "Favorited" : "Favorite", systemImage: starred ? "heart.fill" : "heart")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(ProductTheme.accent)
                    }

                    if player.mode == .library, !player.queue.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            ProductSectionTitle("QUEUE")
                            ForEach(player.queue) { song in
                                ProductSongRow(connection: connection, player: player, song: song, queue: player.queue)
                            }
                        }
                    }
                    ProductErrorText(error ?? player.errorMessage)
                }
                .padding(18)
            }
            .background(ProductTheme.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
            }
            .task { starred = !(player.currentSong?.starred ?? "").isEmpty }
            .onChange(of: player.currentSong?.id) { _, _ in starred = !(player.currentSong?.starred ?? "").isEmpty }
        }
        .preferredColorScheme(.dark)
    }

    private var title: String { player.currentSong?.title ?? player.currentPreview?.title ?? "Waxloom" }
    private var artist: String { player.currentSong?.artist ?? player.currentPreview?.artist ?? "" }
    private var coverURL: URL? {
        guard let base = connection.baseURL else { return nil }
        return WaxloomAPI.coverURL(baseURL: base, coverID: player.currentSong?.coverArt, size: 1000)
    }

    private func toggleStar(_ song: WaxloomSong) async {
        guard let base = connection.baseURL else { return }
        do { try await WaxloomAPI.setStarred(baseURL: base, id: song.id, starred: !starred); starred.toggle(); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

private struct ProductNowPlayingCard: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel

    var body: some View {
        HStack(spacing: 14) {
            ProductArtwork(url: coverURL, size: 78)
            VStack(alignment: .leading, spacing: 5) {
                Text("NOW PLAYING").font(.caption2.bold()).tracking(1.5).foregroundStyle(.secondary)
                Text(player.currentSong?.title ?? player.currentPreview?.title ?? "Nothing playing")
                    .font(.headline).lineLimit(2)
                Text(player.currentSong?.artist ?? player.currentPreview?.artist ?? "Choose music from Browse or Discovery")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Button { player.toggle() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .frame(width: 48, height: 48)
                    .background(ProductTheme.accent.opacity(0.20), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(player.mode == .idle)
        }
        .productCard()
    }

    private var coverURL: URL? {
        guard let base = connection.baseURL else { return nil }
        return WaxloomAPI.coverURL(baseURL: base, coverID: player.currentSong?.coverArt, size: 300)
    }
}

private struct ProductConnectionCard: View {
    @ObservedObject var connection: ConnectionModel
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: connection.isConnected ? "checkmark.shield.fill" : "network.slash")
                .foregroundStyle(connection.isConnected ? Color.green : Color.orange)
                .font(.title2)
            VStack(alignment: .leading, spacing: 3) {
                Text("WAXLOOM SERVER").font(.caption2.bold()).tracking(1.7).foregroundStyle(.secondary)
                Text(connection.statusText).font(.headline)
                if let version = connection.health?.version { Text("API \(version)").font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
        }
        .productCard()
    }
}

private struct ProductStatusTile: View {
    let symbol: String
    let title: String
    let value: String
    let ready: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: symbol).font(.title3).foregroundStyle(ready ? ProductTheme.accent : .secondary)
            Text(title).font(.caption.bold()).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold)).lineLimit(1)
        }
        .productCard()
    }
}

private struct ProductSongRow: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    let song: WaxloomSong
    let queue: [WaxloomSong]
    @State private var starred: Bool
    @State private var error: String?

    init(connection: ConnectionModel, player: NativePlayerModel, song: WaxloomSong, queue: [WaxloomSong]) {
        self.connection = connection
        self.player = player
        self.song = song
        self.queue = queue
        _starred = State(initialValue: !(song.starred ?? "").isEmpty)
    }

    var body: some View {
        HStack(spacing: 11) {
            Button {
                guard let base = connection.baseURL else { return }
                player.play(song: song, queue: queue, baseURL: base)
            } label: {
                HStack(spacing: 11) {
                    ProductArtwork(url: coverURL, size: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(song.title ?? "Unknown title").font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text(song.artist ?? "Unknown artist").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            .buttonStyle(.plain)
            Spacer()
            Button { Task { await toggleStar() } } label: {
                Image(systemName: starred ? "heart.fill" : "heart")
                    .foregroundStyle(starred ? ProductTheme.accent : .secondary)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            Image(systemName: player.currentSong?.id == song.id && player.isPlaying ? "speaker.wave.2.fill" : "play.fill")
                .foregroundStyle(player.currentSong?.id == song.id ? ProductTheme.accent : .secondary)
                .frame(width: 24)
        }
        .padding(.vertical, 4)
        .accessibilityHint(error ?? "")
    }

    private var coverURL: URL? {
        connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: song.coverArt, size: 180) }
    }

    private func toggleStar() async {
        guard let base = connection.baseURL else { return }
        do { try await WaxloomAPI.setStarred(baseURL: base, id: song.id, starred: !starred); starred.toggle(); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

private struct ProductAlbumTile: View {
    @ObservedObject var connection: ConnectionModel
    let album: WaxloomAlbum
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ProductArtwork(url: coverURL, size: nil)
                .aspectRatio(1, contentMode: .fit)
            Text(album.displayTitle).font(.subheadline.weight(.semibold)).lineLimit(1)
            Text(album.artist ?? "Unknown artist").font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
    }
    private var coverURL: URL? {
        connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: album.coverArt, size: 500) }
    }
}

private struct ProductArtwork: View {
    let url: URL?
    let size: CGFloat?
    var circular = false

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase { image.resizable().scaledToFill() }
                    else { fallback }
                }
            } else { fallback }
        }
        .frame(width: size, height: size)
        .frame(maxWidth: size == nil ? .infinity : nil)
        .background(ProductTheme.artwork)
        .clipShape(circular ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: size == nil ? 16 : 10, style: .continuous)))
        .clipped()
    }

    private var fallback: some View {
        ZStack {
            ProductTheme.artwork
            WaxloomMark(lineWidth: size != nil && size! < 60 ? 5 : 10)
                .padding(size != nil && size! < 60 ? 10 : 22)
        }
    }
}

private struct ProductSectionTitle: View {
    let value: String
    init(_ value: String) { self.value = value }
    var body: some View {
        Text(value).font(.caption.bold()).tracking(1.8).foregroundStyle(.secondary)
    }
}

private struct ProductCapsuleButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) { Image(systemName: symbol); Text(label) }
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .frame(height: 36)
                .background(Color.white.opacity(0.07), in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

private struct ProductDisconnectedCard: View {
    var body: some View {
        ContentUnavailableView("Waxloom is offline", systemImage: "network.slash", description: Text("Open More → Settings and connect the private HTTPS endpoint."))
            .padding(.top, 80)
    }
}

@ViewBuilder
private func ProductErrorText(_ error: String?) -> some View {
    if let error, !error.isEmpty {
        Text(error).font(.footnote).foregroundStyle(.orange).productCard()
    }
}

private func productTime(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds > 0 else { return "0:00" }
    let value = Int(seconds)
    return String(format: "%d:%02d", value / 60, value % 60)
}

private enum ProductTheme {
    static let background = Color(red: 0.035, green: 0.035, blue: 0.052)
    static let panel = Color(red: 0.075, green: 0.07, blue: 0.10)
    static let artwork = Color(red: 0.12, green: 0.09, blue: 0.16)
    static let accent = Color(red: 0.66, green: 0.36, blue: 0.96)
}

private extension View {
    func productMiniPlayerInset(connection: ConnectionModel, player: NativePlayerModel) -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) {
            if player.mode != .idle {
                ProductMiniPlayer(connection: connection, player: player)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 6)
            }
        }
    }

    func productCard() -> some View {
        padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ProductTheme.panel)
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.07), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
