import SwiftUI

@main
struct WaxloomApp: App {
    @StateObject private var connection: ConnectionModel
    @StateObject private var watchBridge: PhoneWatchBridge
    @StateObject private var player: NativePlayerModel

    init() {
        let bridge = PhoneWatchBridge()
        _connection = StateObject(wrappedValue: ConnectionModel())
        _watchBridge = StateObject(wrappedValue: bridge)
        _player = StateObject(wrappedValue: NativePlayerModel(watchBridge: bridge))
    }

    var body: some Scene {
        WindowGroup {
            RootView(connection: connection, watchBridge: watchBridge, player: player)
                .preferredColorScheme(.dark)
        }
    }
}

private struct RootView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var watchBridge: PhoneWatchBridge
    @ObservedObject var player: NativePlayerModel

    var body: some View {
        TabView {
            NavigationStack {
                HomeView(connection: connection, watchBridge: watchBridge, player: player)
            }
            .tabItem { Label("Home", systemImage: "house.fill") }

            NavigationStack {
                LibraryView(connection: connection, player: player)
            }
            .tabItem { Label("Library", systemImage: "square.stack.fill") }

            NavigationStack {
                DiscoveryNativeView(connection: connection, player: player)
            }
            .tabItem { Label("Discovery", systemImage: "sparkles") }

            NavigationStack {
                SettingsView(connection: connection, watchBridge: watchBridge)
            }
            .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(WaxloomTheme.accent)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if player.mode != .idle {
                MiniPlayer(player: player)
            }
        }
        .task {
            await connection.connectSavedIfNeeded()
            player.setBaseURL(connection.baseURL)
        }
        .onChange(of: connection.serverURLText) { _, _ in
            player.setBaseURL(connection.baseURL)
        }
    }
}

private struct HomeView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var watchBridge: PhoneWatchBridge
    @ObservedObject var player: NativePlayerModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("WAXLOOM")
                    .font(.caption.weight(.bold))
                    .tracking(2.2)
                    .foregroundStyle(.secondary)
                Text("Your music,\nnative on iPhone.")
                    .font(.system(size: 42, weight: .bold, design: .rounded))
                    .tracking(-1.6)

                ConnectionCard(connection: connection)

                statusCard(
                    title: "Apple Watch",
                    detail: watchBridge.watchInstalled
                        ? (watchBridge.watchReachable ? "Companion connected" : "Installed · open the Watch app to control playback")
                        : "Companion not installed",
                    symbol: "applewatch"
                )

                VStack(alignment: .leading, spacing: 12) {
                    Text("NOW PLAYING")
                        .font(.caption2.weight(.bold))
                        .tracking(1.8)
                        .foregroundStyle(.secondary)
                    HStack(spacing: 14) {
                        ArtworkTile(url: currentCoverURL, size: 74)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(currentTitle).font(.headline).lineLimit(2)
                            Text(currentArtist)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Button { player.toggle() } label: {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.title3.weight(.bold))
                                .frame(width: 46, height: 46)
                                .background(WaxloomTheme.accent.opacity(0.18), in: Circle())
                        }
                        .buttonStyle(.plain)
                        .disabled(player.mode == .idle)
                    }
                }
                .waxloomCard()
            }
            .padding(20)
        }
        .background(WaxloomTheme.background.ignoresSafeArea())
        .navigationTitle("")
        .toolbar(.hidden, for: .navigationBar)
    }

    private var currentTitle: String {
        player.currentSong?.title ?? player.currentPreview?.title ?? "Nothing playing"
    }

    private var currentArtist: String {
        player.currentSong?.artist ?? player.currentPreview?.artist ?? "Choose something from Library or Discovery"
    }

    private var currentCoverURL: URL? {
        guard let base = connection.baseURL else { return nil }
        return WaxloomAPI.coverURL(baseURL: base, coverID: player.currentSong?.coverArt, size: 500)
    }

    private func statusCard(title: String, detail: String, symbol: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(WaxloomTheme.accent)
                .frame(width: 42, height: 42)
                .background(WaxloomTheme.artwork)
                .clipShape(RoundedRectangle(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .waxloomCard()
    }
}

private struct LibraryView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var albums: [WaxloomAlbum] = []
    @State private var randomSongs: [WaxloomSong] = []
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                pageHeader("LIBRARY", "Your collection")

                if !connection.isConnected {
                    disconnectedCard
                } else if loading && albums.isEmpty {
                    ProgressView("Loading your library…")
                        .frame(maxWidth: .infinity, minHeight: 180)
                }

                if !albums.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("ALBUMS").sectionLabel()
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                            ForEach(albums) { album in
                                NavigationLink {
                                    AlbumDetailView(connection: connection, player: player, seed: album)
                                } label: {
                                    VStack(alignment: .leading, spacing: 8) {
                                        ArtworkTile(
                                            url: connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: album.coverArt, size: 500) },
                                            size: nil
                                        )
                                        .aspectRatio(1, contentMode: .fit)
                                        Text(album.displayTitle)
                                            .font(.subheadline.weight(.semibold))
                                            .lineLimit(1)
                                        Text(album.artist ?? "Unknown artist")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                if !randomSongs.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("MIX IT UP").sectionLabel()
                        ForEach(randomSongs.prefix(20)) { song in
                            SongRow(song: song, connection: connection, isPlaying: player.currentSong?.id == song.id && player.isPlaying) {
                                guard let base = connection.baseURL else { return }
                                player.play(song: song, queue: randomSongs, baseURL: base)
                            }
                        }
                    }
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .waxloomCard()
                }
            }
            .padding(18)
        }
        .background(WaxloomTheme.background.ignoresSafeArea())
        .navigationTitle("Library")
        .task(id: connection.isConnected) {
            if connection.isConnected { await load() }
        }
        .refreshable { await load() }
    }

    private var disconnectedCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Connect Waxloom first", systemImage: "network.slash")
                .font(.headline)
            Text("Settings → Waxloom server")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .waxloomCard()
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        loading = true
        defer { loading = false }
        do {
            async let loadedAlbums = WaxloomAPI.albums(baseURL: base, type: "newest", size: 60)
            async let loadedSongs = WaxloomAPI.randomSongs(baseURL: base, size: 40)
            albums = try await loadedAlbums
            randomSongs = try await loadedSongs
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct AlbumDetailView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    let seed: WaxloomAlbum
    @State private var album: WaxloomAlbum?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                ArtworkTile(
                    url: connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: seed.coverArt, size: 900) },
                    size: nil
                )
                .aspectRatio(1, contentMode: .fit)
                .frame(maxWidth: 330)

                VStack(spacing: 4) {
                    Text(seed.displayTitle).font(.title2.bold()).multilineTextAlignment(.center)
                    Text(seed.artist ?? "Unknown artist").foregroundStyle(.secondary)
                }

                if let songs = album?.song, !songs.isEmpty {
                    VStack(spacing: 4) {
                        ForEach(songs) { song in
                            SongRow(song: song, connection: connection, isPlaying: player.currentSong?.id == song.id && player.isPlaying) {
                                guard let base = connection.baseURL else { return }
                                player.play(song: song, queue: songs, baseURL: base)
                            }
                        }
                    }
                } else if error == nil {
                    ProgressView()
                }

                if let error { Text(error).font(.footnote).foregroundStyle(.orange) }
            }
            .padding(18)
        }
        .background(WaxloomTheme.background.ignoresSafeArea())
        .navigationTitle(seed.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        do {
            album = try await WaxloomAPI.album(baseURL: base, id: seed.id)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct DiscoveryNativeView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var player: NativePlayerModel
    @State private var candidates: [WaxloomDiscoveryCandidate] = []
    @State private var status = "starting"
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                pageHeader("DISCOVERY", "Outside your library")

                HStack(spacing: 8) {
                    Circle()
                        .fill(status == "ready" ? Color.green : Color.orange)
                        .frame(width: 8, height: 8)
                    Text(status == "ready" ? "Feed ready" : status.capitalized)
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.plain)
                }
                .foregroundStyle(.secondary)

                if !connection.isConnected {
                    Text("Connect Waxloom in Settings first.")
                        .waxloomCard()
                } else if loading && candidates.isEmpty {
                    ProgressView("Loading Discovery…")
                        .frame(maxWidth: .infinity, minHeight: 180)
                }

                ForEach(candidates) { candidate in
                    discoveryCard(candidate)
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .waxloomCard()
                }
            }
            .padding(18)
        }
        .background(WaxloomTheme.background.ignoresSafeArea())
        .navigationTitle("Discovery")
        .task(id: connection.isConnected) {
            if connection.isConnected { await load() }
        }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func discoveryCard(_ candidate: WaxloomDiscoveryCandidate) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(candidate.title).font(.headline).lineLimit(2)
                    Text(candidate.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text("\(Int(max(0, min(1, candidate.rank)) * 100))%")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(WaxloomTheme.accent)
            }

            HStack(spacing: 10) {
                compactAction(
                    symbol: player.currentPreview?.recordingMbid == candidate.recordingMbid && player.isPlaying ? "pause.fill" : "play.fill",
                    label: "Play"
                ) {
                    guard let base = connection.baseURL else { return }
                    Task { await player.playPreview(candidate: candidate, queue: candidates, baseURL: base) }
                }

                compactAction(symbol: candidate.feedback == 1 ? "heart.fill" : "heart", label: "Like") {
                    Task { await feedback(candidate, value: candidate.feedback == 1 ? 0 : 1) }
                }

                compactAction(symbol: "hand.thumbsdown", label: "Less") {
                    Task { await feedback(candidate, value: candidate.feedback == -1 ? 0 : -1) }
                }

                if candidate.source == "youtube_dig" {
                    Spacer(minLength: 0)
                    Button {
                        Task { await rejectBadSource(candidate) }
                    } label: {
                        Image(systemName: "xmark.circle")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.orange)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Bad or non-music source")
                }
            }

            if let reason = candidate.reason, !reason.isEmpty {
                Text(reason).font(.caption2).foregroundStyle(.tertiary).lineLimit(2)
            }
        }
        .waxloomCard()
    }

    private func compactAction(symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol)
                Text(label)
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(Color.white.opacity(0.07), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        guard let base = connection.baseURL else { return }
        loading = true
        defer { loading = false }
        do {
            let feed = try await WaxloomAPI.discoveryFeed(baseURL: base)
            status = feed.status
            candidates = feed.external.items
                .filter { ($0.feedback ?? 0) >= 0 }
                .sorted { $0.rank > $1.rank }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func feedback(_ candidate: WaxloomDiscoveryCandidate, value: Int) async {
        guard let base = connection.baseURL else { return }
        do {
            try await WaxloomAPI.discoveryFeedback(baseURL: base, candidate: candidate, value: value)
            if let index = candidates.firstIndex(where: { $0.recordingMbid == candidate.recordingMbid }) {
                if value < 0 {
                    candidates.remove(at: index)
                } else {
                    candidates[index].feedback = value
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func rejectBadSource(_ candidate: WaxloomDiscoveryCandidate) async {
        guard candidate.source == "youtube_dig", let base = connection.baseURL else { return }
        candidates.removeAll { $0.recordingMbid == candidate.recordingMbid }
        do {
            try await WaxloomAPI.discoveryFeedback(baseURL: base, candidate: candidate, value: -1, badSource: true)
        } catch {
            self.error = error.localizedDescription
            await load()
        }
    }
}

private struct SongRow: View {
    let song: WaxloomSong
    @ObservedObject var connection: ConnectionModel
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ArtworkTile(
                    url: connection.baseURL.flatMap { WaxloomAPI.coverURL(baseURL: $0, coverID: song.coverArt, size: 180) },
                    size: 48
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(song.title ?? "Unknown title").font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(song.artist ?? "Unknown artist").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .foregroundStyle(isPlaying ? WaxloomTheme.accent : .secondary)
                    .frame(width: 30)
            }
            .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
    }
}

private struct ArtworkTile: View {
    let url: URL?
    let size: CGFloat?

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    default: artworkFallback
                    }
                }
            } else {
                artworkFallback
            }
        }
        .frame(width: size, height: size)
        .frame(maxWidth: size == nil ? .infinity : nil)
        .background(WaxloomTheme.artwork)
        .clipShape(RoundedRectangle(cornerRadius: size == nil ? 16 : 10, style: .continuous))
        .clipped()
    }

    private var artworkFallback: some View {
        ZStack {
            WaxloomTheme.artwork
            Image(systemName: "waveform")
                .foregroundStyle(WaxloomTheme.accent)
                .font(.title2)
        }
    }
}

private struct MiniPlayer: View {
    @ObservedObject var player: NativePlayerModel

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(player.currentSong?.title ?? player.currentPreview?.title ?? "Waxloom")
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text(player.currentSong?.artist ?? player.currentPreview?.artist ?? "")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Button { Task { await player.previous() } } label: { Image(systemName: "backward.fill") }
            Button { player.toggle() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .frame(width: 34, height: 34)
                    .background(WaxloomTheme.accent.opacity(0.18), in: Circle())
            }
            Button { Task { await player.next() } } label: { Image(systemName: "forward.fill") }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .frame(height: 58)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) { Divider().opacity(0.25) }
    }
}

private struct ConnectionCard: View {
    @ObservedObject var connection: ConnectionModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("WAXLOOM SERVER").font(.caption2.weight(.bold)).tracking(1.8).foregroundStyle(.secondary)
                    Text(connection.statusText).font(.headline)
                }
                Spacer()
                Circle()
                    .fill(connection.isConnected ? Color.green : Color.secondary.opacity(0.45))
                    .frame(width: 9, height: 9)
            }
            if let health = connection.health {
                Text("API \(health.version)").font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    ForEach(health.integrations.keys.sorted(), id: \.self) { key in
                        Text(key)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(health.integrations[key] == true ? WaxloomTheme.accent.opacity(0.18) : Color.secondary.opacity(0.12))
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .waxloomCard()
    }
}

private struct SettingsView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var watchBridge: PhoneWatchBridge

    var body: some View {
        Form {
            Section("Waxloom server") {
                TextField("https://waxloom.your-tailnet.ts.net", text: $connection.serverURLText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button {
                    Task { await connection.connect() }
                } label: {
                    HStack {
                        if case .connecting = connection.state { ProgressView() }
                        Text("Connect securely")
                    }
                }
                .disabled(connection.serverURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                LabeledContent("Server", value: connection.isConnected ? "Connected" : "Not connected")
                Text("The saved HTTPS endpoint reconnects automatically when Waxloom launches.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Apple Watch") {
                LabeledContent("Installed", value: watchBridge.watchInstalled ? "Yes" : "No")
                LabeledContent("Reachable", value: watchBridge.watchReachable ? "Yes" : "No")
                Text("Reachable refers to live iPhone ↔ Watch messaging, not to the Waxloom server.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Build") {
                LabeledContent("SHA", value: BuildInfo.gitSHA)
            }
        }
        .scrollContentBackground(.hidden)
        .background(WaxloomTheme.background)
        .navigationTitle("Settings")
    }
}

private func pageHeader(_ eyebrow: String, _ title: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(eyebrow).font(.caption.weight(.bold)).tracking(2).foregroundStyle(.secondary)
        Text(title).font(.largeTitle.bold())
    }
}

private enum WaxloomTheme {
    static let background = Color(red: 0.04, green: 0.04, blue: 0.055)
    static let panel = Color(red: 0.075, green: 0.07, blue: 0.09)
    static let artwork = Color(red: 0.14, green: 0.10, blue: 0.17)
    static let accent = Color(red: 0.64, green: 0.42, blue: 0.84)
}

private extension Text {
    func sectionLabel() -> some View {
        font(.caption.weight(.bold)).tracking(1.8).foregroundStyle(.secondary)
    }
}

private extension View {
    func waxloomCard() -> some View {
        padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WaxloomTheme.panel)
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color.white.opacity(0.07), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}
