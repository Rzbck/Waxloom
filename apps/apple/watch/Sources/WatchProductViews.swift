import SwiftUI

struct WatchProductRootView: View {
    @ObservedObject var remote: WatchRemoteModel
    @State private var selectedPage = 0

    var body: some View {
        NavigationStack {
            TabView(selection: $selectedPage) {
                WatchNowPlayingDashboard(remote: remote).tag(0)
                WatchBrowseDashboard(remote: remote).tag(1)
                WatchStatusDashboard(remote: remote).tag(2)
            }
            .tabViewStyle(.page)
            .background(Color.black)
        }
    }
}

private struct WatchNowPlayingDashboard: View {
    @ObservedObject var remote: WatchRemoteModel

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                WaxloomMark(lineWidth: 5)
                    .frame(width: 28, height: 20)
                Text("WAXLOOM")
                    .font(.system(size: 9, weight: .black))
                    .tracking(1.5)
                Spacer()
                Circle()
                    .fill(remote.phoneReachable ? Color.green : Color.orange)
                    .frame(width: 7, height: 7)
            }

            Spacer(minLength: 0)

            Text(remote.snapshot.title)
                .font(.headline.weight(.black))
                .lineLimit(1)
                .minimumScaleFactor(0.65)
            Text(remote.snapshot.artist)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            VStack(spacing: 3) {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.10))
                        Capsule()
                            .fill(WatchProductStyle.accent)
                            .frame(width: proxy.size.width * progressFraction)
                    }
                }
                .frame(height: 4)
                HStack {
                    Text(watchTime(remote.snapshot.elapsedSeconds))
                    Spacer()
                    Text(watchTime(remote.snapshot.durationSeconds))
                }
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.secondary)
            }

            HStack(spacing: 7) {
                WatchRoundControl(symbol: "backward.fill", enabled: canSend) { remote.send(.previous) }
                WatchRoundControl(
                    symbol: remote.snapshot.isPlaying ? "pause.fill" : "play.fill",
                    enabled: canSend,
                    prominent: true
                ) { remote.send(.playPause) }
                WatchRoundControl(symbol: "forward.fill", enabled: canSend) { remote.send(.next) }
            }

            HStack(spacing: 12) {
                Button { remote.send(.seekBackward15) } label: {
                    Label("15", systemImage: "gobackward.15").labelStyle(.iconOnly)
                }
                Button { remote.send(.seekForward15) } label: {
                    Label("15", systemImage: "goforward.15").labelStyle(.iconOnly)
                }
            }
            .font(.system(size: 15, weight: .bold))
            .buttonStyle(.plain)
            .foregroundStyle(canSend ? WatchProductStyle.accent : .secondary)
            .disabled(!canSend)
        }
        .padding(.horizontal, 4)
    }

    private var canSend: Bool {
        remote.phoneReachable && remote.pendingCommand == nil && remote.snapshot.sessionID != "idle"
    }

    private var progressFraction: CGFloat {
        guard remote.snapshot.durationSeconds > 0 else { return 0 }
        return CGFloat(max(0, min(1, remote.snapshot.elapsedSeconds / remote.snapshot.durationSeconds)))
    }
}

private struct WatchBrowseDashboard: View {
    @ObservedObject var remote: WatchRemoteModel
    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        ScrollView {
            VStack(spacing: 7) {
                HStack {
                    Text("BROWSE")
                        .font(.system(size: 9, weight: .black))
                        .foregroundStyle(.secondary)
                    Spacer()
                    if remote.catalogBusy { ProgressView().controlSize(.mini) }
                    else { Image(systemName: "chevron.left.slash.chevron.right").font(.system(size: 9)).foregroundStyle(.tertiary) }
                }

                LazyVGrid(columns: columns, spacing: 6) {
                    WatchMenuLink(remote: remote, title: "Albums", symbol: "square.stack.fill", route: .albums)
                    WatchMenuLink(remote: remote, title: "Artists", symbol: "person.2.fill", route: .artists)
                    WatchMenuLink(remote: remote, title: "Favorites", symbol: "heart.fill", route: .favorites)
                    WatchMenuLink(remote: remote, title: "Playlists", symbol: "music.note.list", route: .playlists)
                    WatchMenuLink(remote: remote, title: "Discovery", symbol: "sparkles", route: .discovery)

                    NavigationLink {
                        WatchSearchView(remote: remote)
                    } label: {
                        WatchMenuTile(title: "Search", symbol: "magnifyingglass")
                    }
                    .buttonStyle(.plain)

                    NavigationLink {
                        WatchImportsView(remote: remote)
                    } label: {
                        WatchMenuTile(title: "Imports", symbol: "arrow.down.circle.fill")
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 3)
        }
    }
}

private struct WatchStatusDashboard: View {
    @ObservedObject var remote: WatchRemoteModel

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                WaxloomBrandLockup(compact: true)
                Spacer()
            }

            WatchStatusRow(
                symbol: "iphone",
                title: "iPhone",
                value: remote.phoneReachable ? "Connected" : "Not reachable",
                ready: remote.phoneReachable
            )
            WatchStatusRow(
                symbol: "play.fill",
                title: "Player",
                value: remote.snapshot.sessionID == "idle" ? "Idle" : remote.snapshot.isPlaying ? "Playing" : "Paused",
                ready: remote.snapshot.sessionID != "idle"
            )
            WatchStatusRow(
                symbol: "square.grid.2x2.fill",
                title: "Full app",
                value: remote.phoneReachable ? "Browse ready" : "Open iPhone app",
                ready: remote.phoneReachable
            )

            Spacer(minLength: 0)
            Text(String(BuildInfo.gitSHA.prefix(12)))
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 4)
    }
}

private struct WatchMenuLink: View {
    @ObservedObject var remote: WatchRemoteModel
    let title: String
    let symbol: String
    let route: WatchCatalogRoute

    var body: some View {
        NavigationLink {
            WatchCatalogListView(remote: remote, route: route, title: title)
        } label: {
            WatchMenuTile(title: title, symbol: symbol)
        }
        .buttonStyle(.plain)
    }
}

private struct WatchMenuTile: View {
    let title: String
    let symbol: String

    var body: some View {
        VStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(WatchProductStyle.accent)
            Text(title)
                .font(.system(size: 9, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, minHeight: 51)
        .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(Color.white.opacity(0.06), lineWidth: 1)
        }
    }
}

private struct WatchCatalogListView: View {
    @ObservedObject var remote: WatchRemoteModel
    let route: WatchCatalogRoute
    let id: String?
    let title: String
    let containerItem: WatchCatalogItem?
    @State private var response: WatchCatalogResponse?
    @State private var loading = false

    init(
        remote: WatchRemoteModel,
        route: WatchCatalogRoute,
        id: String? = nil,
        title: String,
        containerItem: WatchCatalogItem? = nil
    ) {
        self.remote = remote
        self.route = route
        self.id = id
        self.title = title
        self.containerItem = containerItem
    }

    var body: some View {
        List {
            if let containerItem, containerItem.kind == .album || containerItem.kind == .artist {
                Button {
                    Task { await toggleContainerStar(containerItem) }
                } label: {
                    Label(containerItem.starred ? "Remove favorite" : "Favorite", systemImage: containerItem.starred ? "heart.fill" : "heart")
                }
            }

            if route == .playlists {
                NavigationLink {
                    WatchNewPlaylistView(remote: remote)
                } label: {
                    Label("New playlist", systemImage: "plus.circle.fill")
                }
            }

            if loading {
                HStack { Spacer(); ProgressView(); Spacer() }
            }

            ForEach(Array((response?.items ?? []).enumerated()), id: \.element.id) { index, item in
                destinationRow(item: item, index: index)
            }

            if let message = response?.message, !(response?.ok ?? true) {
                Text(message).font(.caption2).foregroundStyle(.orange)
            }

            if response?.items.isEmpty == true, !loading, response?.message == nil {
                Text("Nothing here yet.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle(response?.title ?? title)
        .task { await load() }
    }

    @ViewBuilder
    private func destinationRow(item: WatchCatalogItem, index: Int) -> some View {
        switch item.kind {
        case .album:
            NavigationLink {
                WatchCatalogListView(remote: remote, route: .album, id: item.id, title: item.title, containerItem: item)
            } label: { WatchCatalogRow(item: item) }

        case .artist:
            NavigationLink {
                WatchCatalogListView(remote: remote, route: .artist, id: item.id, title: item.title, containerItem: item)
            } label: { WatchCatalogRow(item: item) }

        case .playlist:
            NavigationLink {
                WatchPlaylistDetailView(remote: remote, playlist: item)
            } label: { WatchCatalogRow(item: item) }

        case .song, .discovery:
            NavigationLink {
                WatchItemActionsView(
                    remote: remote,
                    item: item,
                    playlistID: route == .playlist ? id : nil,
                    playlistIndex: route == .playlist ? index : nil
                )
            } label: { WatchCatalogRow(item: item) }

        case .youtube:
            WatchCatalogRow(item: item)
        }
    }

    private func load() async {
        loading = true
        response = await remote.load(route: route, id: id)
        loading = false
    }

    private func toggleContainerStar(_ item: WatchCatalogItem) async {
        let result = await remote.toggleStar(item)
        if result.ok, let updated = result.items.first {
            var current = response
            current?.message = updated.starred ? "Favorited" : "Favorite removed"
            response = current
        }
    }
}

private struct WatchPlaylistDetailView: View {
    @ObservedObject var remote: WatchRemoteModel
    let playlist: WatchCatalogItem
    @Environment(\.dismiss) private var dismiss
    @State private var response: WatchCatalogResponse?
    @State private var loading = false
    @State private var message: String?

    var body: some View {
        List {
            NavigationLink {
                WatchPlaylistAddView(remote: remote, playlistID: playlist.id)
            } label: {
                Label("Add tracks", systemImage: "plus.circle")
            }

            ForEach(Array((response?.items ?? []).enumerated()), id: \.element.id) { index, item in
                NavigationLink {
                    WatchItemActionsView(remote: remote, item: item, playlistID: playlist.id, playlistIndex: index)
                } label: { WatchCatalogRow(item: item) }
            }

            Button(role: .destructive) {
                Task {
                    let result = await remote.deletePlaylist(id: playlist.id)
                    if result.ok { dismiss() } else { message = result.message }
                }
            } label: {
                Label("Delete playlist", systemImage: "trash")
            }

            if let message { Text(message).font(.caption2).foregroundStyle(.orange) }
        }
        .navigationTitle(playlist.title)
        .task { await load() }
    }

    private func load() async {
        loading = true
        response = await remote.load(route: .playlist, id: playlist.id)
        loading = false
    }
}

private struct WatchItemActionsView: View {
    @ObservedObject var remote: WatchRemoteModel
    @State var item: WatchCatalogItem
    let playlistID: String?
    let playlistIndex: Int?
    @Environment(\.dismiss) private var dismiss
    @State private var message: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Image(systemName: item.kind == .discovery ? "sparkles" : "music.note")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(WatchProductStyle.accent)
                    .frame(width: 54, height: 54)
                    .background(WatchProductStyle.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))

                Text(item.title)
                    .font(.headline.bold())
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if let subtitle = item.subtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }

                Button {
                    Task { message = (await remote.play(item)).message ?? "Playing on iPhone" }
                } label: {
                    Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(WatchProductStyle.accent)

                if item.kind == .song {
                    Button {
                        Task {
                            let result = await remote.toggleStar(item)
                            if let updated = result.items.first { item = updated }
                            message = result.message ?? result.title
                        }
                    } label: {
                        Label(item.starred ? "Favorited" : "Favorite", systemImage: item.starred ? "heart.fill" : "heart")
                    }
                    .buttonStyle(.bordered)

                    NavigationLink {
                        WatchPlaylistPickerView(remote: remote, songID: item.id)
                    } label: {
                        Label("Add to playlist", systemImage: "text.badge.plus")
                    }

                    if let playlistID, let playlistIndex {
                        Button(role: .destructive) {
                            Task {
                                let result = await remote.removeFromPlaylist(playlistID: playlistID, index: playlistIndex)
                                if result.ok { dismiss() } else { message = result.message }
                            }
                        } label: {
                            Label("Remove from playlist", systemImage: "minus.circle")
                        }
                    }
                }

                if item.kind == .discovery {
                    HStack(spacing: 6) {
                        Button {
                            Task { message = (await remote.discoveryFeedback(item, value: 1)).title }
                        } label: { Image(systemName: "heart.fill") }
                        .tint(.pink)

                        Button {
                            Task { message = (await remote.discoveryFeedback(item, value: -1)).title }
                        } label: { Image(systemName: "hand.thumbsdown.fill") }
                        .tint(.orange)
                    }
                    .buttonStyle(.bordered)

                    if item.source == "youtube_dig" {
                        Button(role: .destructive) {
                            Task { message = (await remote.rejectBadSource(item)).message ?? "Source rejected" }
                        } label: {
                            Label("Bad source", systemImage: "xmark.circle")
                        }
                    }

                    NavigationLink {
                        WatchImportsView(remote: remote, seedArtist: item.subtitle ?? "", seedTitle: item.title)
                    } label: {
                        Label("Import", systemImage: "arrow.down.circle")
                    }
                }

                if let message {
                    Text(message).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Track")
    }
}

private struct WatchPlaylistPickerView: View {
    @ObservedObject var remote: WatchRemoteModel
    let songID: String
    @State private var items: [WatchCatalogItem] = []
    @State private var message: String?

    var body: some View {
        List {
            ForEach(items) { playlist in
                Button {
                    Task {
                        let result = await remote.addToPlaylist(playlistID: playlist.id, songID: songID)
                        message = result.message ?? result.title
                    }
                } label: {
                    WatchCatalogRow(item: playlist)
                }
                .buttonStyle(.plain)
            }
            if let message { Text(message).font(.caption2).foregroundStyle(.secondary) }
        }
        .navigationTitle("Add to")
        .task { items = (await remote.load(route: .playlists)).items }
    }
}

private struct WatchPlaylistAddView: View {
    @ObservedObject var remote: WatchRemoteModel
    let playlistID: String
    @State private var query = ""
    @State private var items: [WatchCatalogItem] = []
    @State private var message: String?

    var body: some View {
        List {
            TextField("Search", text: $query)
            Button("Find tracks") { Task { await search() } }
            ForEach(items.filter { $0.kind == .song }) { song in
                Button {
                    Task {
                        let result = await remote.addToPlaylist(playlistID: playlistID, songID: song.id)
                        message = result.message ?? result.title
                    }
                } label: { WatchCatalogRow(item: song) }
                    .buttonStyle(.plain)
            }
            if let message { Text(message).font(.caption2).foregroundStyle(.secondary) }
        }
        .navigationTitle("Add tracks")
    }

    private func search() async {
        let response = await remote.load(route: .search, query: query)
        items = response.items
        message = response.ok ? nil : response.message
    }
}

private struct WatchNewPlaylistView: View {
    @ObservedObject var remote: WatchRemoteModel
    @State private var name = ""
    @State private var message: String?

    var body: some View {
        VStack(spacing: 10) {
            TextField("Name", text: $name)
            Button {
                Task {
                    let result = await remote.createPlaylist(name: name)
                    message = result.ok ? "Created" : result.message
                    if result.ok { name = "" }
                }
            } label: {
                Label("Create", systemImage: "plus.circle.fill")
            }
            .buttonStyle(.borderedProminent)
            .tint(WatchProductStyle.accent)
            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if let message { Text(message).font(.caption2).foregroundStyle(.secondary) }
            Spacer()
        }
        .navigationTitle("New playlist")
    }
}

private struct WatchSearchView: View {
    @ObservedObject var remote: WatchRemoteModel
    @State private var query = ""
    @State private var response: WatchCatalogResponse?
    @State private var loading = false

    var body: some View {
        List {
            TextField("Search Waxloom", text: $query)
            Button {
                Task { await search() }
            } label: {
                Label("Search", systemImage: "magnifyingglass")
            }
            .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if loading { ProgressView() }

            ForEach(Array((response?.items ?? []).enumerated()), id: \.element.id) { _, item in
                searchDestination(item)
            }

            if let message = response?.message, response?.ok == false {
                Text(message).font(.caption2).foregroundStyle(.orange)
            }
        }
        .navigationTitle("Search")
    }

    @ViewBuilder
    private func searchDestination(_ item: WatchCatalogItem) -> some View {
        switch item.kind {
        case .album:
            NavigationLink { WatchCatalogListView(remote: remote, route: .album, id: item.id, title: item.title, containerItem: item) } label: { WatchCatalogRow(item: item) }
        case .artist:
            NavigationLink { WatchCatalogListView(remote: remote, route: .artist, id: item.id, title: item.title, containerItem: item) } label: { WatchCatalogRow(item: item) }
        case .song, .discovery:
            NavigationLink { WatchItemActionsView(remote: remote, item: item, playlistID: nil, playlistIndex: nil) } label: { WatchCatalogRow(item: item) }
        case .playlist:
            NavigationLink { WatchPlaylistDetailView(remote: remote, playlist: item) } label: { WatchCatalogRow(item: item) }
        case .youtube:
            WatchCatalogRow(item: item)
        }
    }

    private func search() async {
        loading = true
        response = await remote.load(route: .search, query: query)
        loading = false
    }
}

private struct WatchImportsView: View {
    @ObservedObject var remote: WatchRemoteModel
    let seedArtist: String
    let seedTitle: String
    @State private var artist: String
    @State private var title: String
    @State private var candidates: [WatchCatalogItem] = []
    @State private var runtimeReady = false
    @State private var loading = false
    @State private var message: String?

    init(remote: WatchRemoteModel, seedArtist: String = "", seedTitle: String = "") {
        self.remote = remote
        self.seedArtist = seedArtist
        self.seedTitle = seedTitle
        _artist = State(initialValue: seedArtist)
        _title = State(initialValue: seedTitle)
    }

    var body: some View {
        List {
            TextField("Artist", text: $artist)
            TextField("Track", text: $title)

            Button {
                Task { await search() }
            } label: {
                Label("Find source", systemImage: "magnifyingglass")
            }
            .disabled(!runtimeReady || artist.trimmingCharacters(in: .whitespaces).isEmpty || title.trimmingCharacters(in: .whitespaces).isEmpty)

            if loading { ProgressView() }

            ForEach(candidates) { candidate in
                NavigationLink {
                    WatchImportCandidateView(remote: remote, item: candidate, artist: artist, title: title)
                } label: { WatchCatalogRow(item: candidate) }
            }

            Text(runtimeReady ? "Import runtime ready" : "Import runtime unavailable")
                .font(.caption2)
                .foregroundStyle(runtimeReady ? Color.green : Color.orange)

            if let message { Text(message).font(.caption2).foregroundStyle(.secondary) }
        }
        .navigationTitle("Imports")
        .task {
            let status = await remote.load(route: .imports)
            runtimeReady = status.runtimeReady == true
            message = status.message
            if runtimeReady && !seedArtist.isEmpty && !seedTitle.isEmpty { await search() }
        }
    }

    private func search() async {
        loading = true
        let result = await remote.youtubeSearch(artist: artist, title: title)
        candidates = result.items
        message = result.ok ? nil : result.message
        loading = false
    }
}

private struct WatchImportCandidateView: View {
    @ObservedObject var remote: WatchRemoteModel
    let item: WatchCatalogItem
    let artist: String
    let title: String
    @State private var authorized = false
    @State private var message: String?
    @State private var importing = false

    var body: some View {
        ScrollView {
            VStack(spacing: 9) {
                Image(systemName: "play.rectangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(WatchProductStyle.accent)
                Text(item.title).font(.headline).multilineTextAlignment(.center).lineLimit(3)
                if let subtitle = item.subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                if let score = item.score { Text("Match \(Int(score.rounded()))%").font(.caption2).foregroundStyle(WatchProductStyle.accent) }

                Toggle("Authorized", isOn: $authorized)
                    .font(.caption)

                Button {
                    Task {
                        importing = true
                        let result = await remote.youtubeImport(item: item, artist: artist, title: title, authorized: authorized)
                        message = result.message ?? result.title
                        importing = false
                    }
                } label: {
                    if importing { ProgressView() }
                    else { Label("Import", systemImage: "arrow.down.circle.fill") }
                }
                .buttonStyle(.borderedProminent)
                .tint(WatchProductStyle.accent)
                .disabled(!authorized || importing)

                if let message { Text(message).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center) }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Source")
    }
}

private struct WatchCatalogRow: View {
    let item: WatchCatalogItem

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(item.starred ? Color.pink : WatchProductStyle.accent)
                .frame(width: 28, height: 28)
                .background(WatchProductStyle.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 1) {
                if let section = item.section {
                    Text(section.uppercased()).font(.system(size: 7, weight: .black)).foregroundStyle(.tertiary)
                }
                Text(item.title).font(.caption.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.75)
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 2)
            if let rank = item.rank {
                Text("\(Int(max(0, min(1, rank)) * 100))")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var symbol: String {
        switch item.kind {
        case .song: return "music.note"
        case .album: return "square.stack.fill"
        case .artist: return "person.fill"
        case .playlist: return "music.note.list"
        case .discovery: return "sparkles"
        case .youtube: return "play.rectangle.fill"
        }
    }
}

private struct WatchRoundControl: View {
    let symbol: String
    let enabled: Bool
    var prominent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: prominent ? 23 : 17, weight: .black))
                .foregroundStyle(enabled ? Color.white : Color.secondary)
                .frame(width: prominent ? 54 : 42, height: prominent ? 54 : 42)
                .background(
                    enabled ? WatchProductStyle.accent.opacity(prominent ? 0.95 : 0.18) : Color.white.opacity(0.04),
                    in: Circle()
                )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

private struct WatchStatusRow: View {
    let symbol: String
    let title: String
    let value: String
    let ready: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(ready ? WatchProductStyle.accent : Color.orange)
                .frame(width: 28, height: 28)
                .background((ready ? WatchProductStyle.accent : Color.orange).opacity(0.11), in: Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 8, weight: .bold)).foregroundStyle(.secondary)
                Text(value).font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.75)
            }
            Spacer()
        }
        .padding(.horizontal, 7)
        .frame(height: 41)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private enum WatchProductStyle {
    static let accent = Color(red: 0.68, green: 0.34, blue: 0.98)
}

private func watchTime(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds > 0 else { return "0:00" }
    let value = Int(seconds)
    return String(format: "%d:%02d", value / 60, value % 60)
}
