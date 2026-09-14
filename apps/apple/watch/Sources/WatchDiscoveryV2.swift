import SwiftUI

private enum WatchDiscoveryShelfV2: String, CaseIterable, Identifiable {
    case closest = "Closest"
    case underground = "Underground"
    case deepCuts = "Deep cuts"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .closest: return "scope"
        case .underground: return "waveform.path.ecg"
        case .deepCuts: return "diamond.fill"
        }
    }
}

private enum WatchDiscoveryImportOutcomeV2 {
    case success(String)
    case manual(String)
    case failure(String)
}

private func watchDiscoveryQuickImportV2(
    remote: WatchRemoteModel,
    item: WatchCatalogItem
) async -> WatchDiscoveryImportOutcomeV2 {
    let artist = (item.subtitle ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let title = item.title
        .trimmingCharacters(in: .whitespacesAndNewlines)

    guard !artist.isEmpty, !title.isEmpty else {
        return .failure("Artist or track name is missing.")
    }

    let sources = await remote.youtubeSearch(artist: artist, title: title)
    guard sources.ok else {
        return .failure(sources.message ?? "Source search failed.")
    }

    guard let best = sources.items.max(by: {
        ($0.score ?? 0) < ($1.score ?? 0)
    }) else {
        return .manual("No automatic source found.")
    }

    guard (best.score ?? 0) >= 80 else {
        return .manual("Automatic match is ambiguous.")
    }

    let result = await remote.youtubeImport(
        item: best,
        artist: artist,
        title: title,
        authorized: true
    )

    guard result.ok else {
        return .failure(result.message ?? "Import failed.")
    }

    switch result.status {
    case "already_local":
        return .success("Already in your library.")
    case "imported":
        return .success("Added to your library.")
    default:
        return .success(result.message ?? "Saved. Navidrome is indexing it.")
    }
}

struct WatchDiscoveryDashboardV2: View {
    @ObservedObject var remote: WatchRemoteModel

    @AppStorage("waxloom.authorizedMediaImports.v1")
    private var importAuthorized = false

    @State private var selectedShelf = WatchDiscoveryShelfV2.closest
    @State private var items: [WatchCatalogItem] = []
    @State private var loading = false
    @State private var importingID: String?
    @State private var pendingAuthorizationItem: WatchCatalogItem?
    @State private var manualImportItem: WatchCatalogItem?
    @State private var message: String?

    var body: some View {
        Group {
            if loading && items.isEmpty {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Loading Discovery…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                TabView(selection: $selectedShelf) {
                    ForEach(WatchDiscoveryShelfV2.allCases) { shelf in
                        shelfPage(shelf)
                            .tag(shelf)
                    }
                }
                .tabViewStyle(.page)
            }
        }
        .navigationTitle("Discovery")
        .task { await load() }
        .navigationDestination(item: $manualImportItem) { item in
            WatchDiscoveryManualSourceV2(
                remote: remote,
                item: item
            ) { importedMessage in
                items.removeAll { $0.id == item.id }
                message = importedMessage
            }
        }
        .alert(
            "Authorized media import",
            isPresented: Binding(
                get: { pendingAuthorizationItem != nil },
                set: { shown in
                    if !shown { pendingAuthorizationItem = nil }
                }
            )
        ) {
            Button("Cancel", role: .cancel) {
                pendingAuthorizationItem = nil
            }
            Button("Confirm & import") {
                guard let item = pendingAuthorizationItem else { return }
                pendingAuthorizationItem = nil
                importAuthorized = true
                Task { await quickImport(item) }
            }
        } message: {
            Text("Confirm that you are authorized to save media you import into your local library.")
        }
    }

    @ViewBuilder
    private func shelfPage(_ shelf: WatchDiscoveryShelfV2) -> some View {
        let shelfItems = visibleItems(for: shelf)

        List {
            HStack(spacing: 6) {
                Image(systemName: shelf.symbol)
                    .foregroundStyle(WatchDiscoveryStyleV2.accent)
                Text(shelf.rawValue.uppercased())
                    .font(.system(size: 9, weight: .black))
                Spacer()
                Button {
                    Task { await refreshFeed() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(WatchDiscoveryStyleV2.accent)
                }
                .buttonStyle(.plain)
                .disabled(loading)
                .accessibilityLabel("Generate new Discovery feed")
                Text("\(shelfItems.count)")
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if let message {
                Text(message)
                    .font(.system(size: 8))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            ForEach(shelfItems) { item in
                HStack(spacing: 5) {
                    NavigationLink {
                        WatchDiscoveryItemActionsV2(
                            remote: remote,
                            item: item,
                            queue: shelfItems,
                            onUpdate: { updated in
                                if let index = items.firstIndex(where: { $0.id == updated.id }) {
                                    items[index] = updated
                                }
                            },
                            onImported: {
                                items.removeAll { $0.id == item.id }
                            }
                        )
                    } label: {
                        WatchDiscoveryRowV2(item: item)
                    }
                    .buttonStyle(.plain)

                    Button {
                        beginQuickImport(item)
                    } label: {
                        Group {
                            if importingID == item.id {
                                ProgressView()
                                    .controlSize(.mini)
                            } else {
                                Image(systemName: "plus")
                                    .font(.system(size: 14, weight: .black))
                            }
                        }
                        .frame(width: 30, height: 30)
                        .foregroundStyle(WatchDiscoveryStyleV2.accent)
                        .background(
                            WatchDiscoveryStyleV2.accent.opacity(0.14),
                            in: Circle()
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(importingID != nil)
                    .accessibilityLabel("Add to library")
                }
            }

            if shelfItems.isEmpty && !loading {
                Text("No tracks in this shelf yet.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func visibleItems(for shelf: WatchDiscoveryShelfV2) -> [WatchCatalogItem] {
        items.filter { item in
            let section = item.section ?? WatchDiscoveryShelfV2.closest.rawValue
            return section == shelf.rawValue
        }
    }

    private func load() async {
        loading = true
        let result = await remote.load(route: .discovery)
        items = result.items
        message = result.ok ? nil : result.message
        loading = false
    }

    private func refreshFeed() async {
        guard !loading else { return }
        loading = true
        message = nil
        let result = await remote.refreshDiscovery()
        guard result.ok else {
            message = result.message ?? "Could not refresh Discovery."
            loading = false
            return
        }
        await load()
    }

    private func beginQuickImport(_ item: WatchCatalogItem) {
        guard importingID == nil else { return }
        message = nil

        if importAuthorized {
            Task { await quickImport(item) }
        } else {
            pendingAuthorizationItem = item
        }
    }

    private func quickImport(_ item: WatchCatalogItem) async {
        guard importingID == nil else { return }
        importingID = item.id
        message = nil
        defer { importingID = nil }

        switch await watchDiscoveryQuickImportV2(remote: remote, item: item) {
        case .success(let text):
            items.removeAll { $0.id == item.id }
            message = text
        case .manual(let text):
            message = "\(text) Choose the source manually."
            manualImportItem = item
        case .failure(let text):
            message = text
        }
    }
}

struct WatchDiscoveryItemActionsV2: View {
    @ObservedObject var remote: WatchRemoteModel
    @State var item: WatchCatalogItem

    let queue: [WatchCatalogItem]
    let onUpdate: (WatchCatalogItem) -> Void
    let onImported: () -> Void

    @AppStorage("waxloom.authorizedMediaImports.v1")
    private var importAuthorized = false

    @State private var importing = false
    @State private var addedToLibrary = false
    @State private var showingAuthorization = false
    @State private var manualImportItem: WatchCatalogItem?
    @State private var sourceRejected = false
    @State private var message: String?

    var body: some View {
        VStack(spacing: 4) {
            Spacer(minLength: 0)

            Image(systemName: "sparkles")
                .font(.system(size: 18, weight: .black))
                .foregroundStyle(WatchDiscoveryStyleV2.accent)
                .frame(width: 28, height: 28)
                .background(
                    WatchDiscoveryStyleV2.accent.opacity(0.13),
                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                )

            Text(item.title)
                .font(.system(size: 12, weight: .bold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.65)

            if let subtitle = item.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }

            HStack(spacing: 5) {
                WatchDiscoveryActionButtonV2(
                    symbol: isCurrentAndPlaying ? "pause.fill" : "play.fill",
                    active: isCurrentAndPlaying,
                    tint: WatchDiscoveryStyleV2.accent
                ) {
                    togglePlayback()
                }

                WatchDiscoveryActionButtonV2(
                    symbol: addedToLibrary ? "checkmark" : "plus",
                    active: addedToLibrary,
                    busy: importing,
                    tint: .green,
                    enabled: !addedToLibrary && !importing
                ) {
                    beginQuickImport()
                }

                WatchDiscoveryActionButtonV2(
                    symbol: currentFeedback == 1 ? "heart.fill" : "heart",
                    active: currentFeedback == 1,
                    tint: .pink
                ) {
                    Task { await toggleFeedback(1) }
                }

                WatchDiscoveryActionButtonV2(
                    symbol: currentFeedback == -1 ? "hand.thumbsdown.fill" : "hand.thumbsdown",
                    active: currentFeedback == -1,
                    tint: .orange
                ) {
                    Task { await toggleFeedback(-1) }
                }
            }

            HStack(spacing: 6) {
                Text((item.section ?? "Discovery").uppercased())
                    .font(.system(size: 7, weight: .black))
                    .foregroundStyle(WatchDiscoveryStyleV2.accent)

                if let rank = item.rank {
                    Text("\(Int(max(0, min(1, rank)) * 100))%")
                        .font(.system(size: 7, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)

                if item.source == "youtube_dig" {
                    Button {
                        Task { await toggleBadSource() }
                    } label: {
                        Image(systemName: sourceRejected ? "arrow.uturn.backward.circle.fill" : "xmark.circle")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(sourceRejected ? Color.green : Color.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(sourceRejected ? "Undo bad source" : "Bad source")
                }
            }
            .padding(.horizontal, 3)

            if let message {
                Text(message)
                    .font(.system(size: 7.5))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
        .navigationTitle("Discovery")
        .navigationDestination(item: $manualImportItem) { candidate in
            WatchDiscoveryManualSourceV2(
                remote: remote,
                item: candidate
            ) { importedMessage in
                addedToLibrary = true
                message = importedMessage
                onImported()
            }
        }
        .alert("Authorized media import", isPresented: $showingAuthorization) {
            Button("Cancel", role: .cancel) {}
            Button("Confirm & import") {
                importAuthorized = true
                Task { await quickImport() }
            }
        } message: {
            Text("Confirm that you are authorized to save media you import into your local library.")
        }
    }

    private var currentFeedback: Int {
        item.feedback ?? (item.starred ? 1 : 0)
    }

    private var isCurrentTrack: Bool {
        guard remote.snapshot.sessionID != "idle" else { return false }
        guard remote.snapshot.title.caseInsensitiveCompare(item.title) == .orderedSame else { return false }
        if let artist = item.subtitle, !artist.isEmpty {
            return remote.snapshot.artist.caseInsensitiveCompare(artist) == .orderedSame
        }
        return true
    }

    private var isCurrentAndPlaying: Bool {
        isCurrentTrack && remote.snapshot.isPlaying
    }

    private func togglePlayback() {
        if isCurrentTrack {
            remote.send(.playPause)
            return
        }

        Task {
            let result = await remote.playDiscovery(item, queue: queue)
            message = result.message ?? result.title
        }
    }

    private func beginQuickImport() {
        guard !addedToLibrary, !importing else { return }
        message = nil

        if importAuthorized {
            Task { await quickImport() }
        } else {
            showingAuthorization = true
        }
    }

    private func quickImport() async {
        guard !addedToLibrary, !importing else { return }
        importing = true
        defer { importing = false }

        switch await watchDiscoveryQuickImportV2(remote: remote, item: item) {
        case .success(let text):
            addedToLibrary = true
            message = text
            onImported()
        case .manual(let text):
            message = "\(text) Choose the source manually."
            manualImportItem = item
        case .failure(let text):
            message = text
        }
    }

    private func toggleFeedback(_ target: Int) async {
        let nextValue = currentFeedback == target ? 0 : target
        let result = await remote.discoveryFeedback(item, value: nextValue)

        guard result.ok else {
            message = result.message ?? "Could not save feedback."
            return
        }

        item.feedback = nextValue
        item.starred = nextValue == 1
        onUpdate(item)
        message = result.title
    }

    private func toggleBadSource() async {
        let next = !sourceRejected
        let result = await remote.setBadSource(item, rejected: next)

        guard result.ok else {
            message = result.message ?? "Could not update source."
            return
        }

        sourceRejected = next
        message = result.message ?? result.title
    }
}

private struct WatchDiscoveryManualSourceV2: View {
    @ObservedObject var remote: WatchRemoteModel
    let item: WatchCatalogItem
    let onImported: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var candidates: [WatchCatalogItem] = []
    @State private var loading = false
    @State private var importingID: String?
    @State private var message: String?

    var body: some View {
        List {
            if loading {
                HStack { Spacer(); ProgressView(); Spacer() }
            }

            ForEach(candidates) { candidate in
                Button {
                    Task { await importCandidate(candidate) }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(candidate.title)
                            .font(.caption.weight(.semibold))
                            .lineLimit(2)
                        HStack {
                            Text(candidate.subtitle ?? "YouTube")
                                .font(.system(size: 8))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            Spacer()
                            if importingID == candidate.id {
                                ProgressView().controlSize(.mini)
                            } else if let score = candidate.score {
                                Text("\(Int(score.rounded()))%")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundStyle(WatchDiscoveryStyleV2.accent)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(importingID != nil)
            }

            if let message {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Choose source")
        .task { await load() }
    }

    private func load() async {
        loading = true
        let result = await remote.youtubeSearch(
            artist: item.subtitle ?? "",
            title: item.title
        )
        candidates = result.items
        message = result.ok ? nil : result.message
        loading = false
    }

    private func importCandidate(_ candidate: WatchCatalogItem) async {
        guard importingID == nil else { return }
        importingID = candidate.id
        defer { importingID = nil }

        let result = await remote.youtubeImport(
            item: candidate,
            artist: item.subtitle ?? "",
            title: item.title,
            authorized: true
        )

        guard result.ok else {
            message = result.message ?? "Import failed."
            return
        }

        let text = result.status == "already_local"
            ? "Already in your library."
            : "Added to your library."
        onImported(text)
        dismiss()
    }
}

private struct WatchDiscoveryRowV2: View {
    let item: WatchCatalogItem

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "sparkles")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(item.feedback == 1 ? Color.pink : WatchDiscoveryStyleV2.accent)
                .frame(width: 26, height: 26)
                .background(
                    WatchDiscoveryStyleV2.accent.opacity(0.10),
                    in: RoundedRectangle(cornerRadius: 8)
                )

            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 8.5))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 2)

            if let rank = item.rank {
                Text("\(Int(max(0, min(1, rank)) * 100))")
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct WatchDiscoveryActionButtonV2: View {
    let symbol: String
    let active: Bool
    var busy = false
    let tint: Color
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if busy {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: symbol)
                        .font(.system(size: 14, weight: .black))
                }
            }
            .frame(width: 31, height: 31)
            .foregroundStyle(active ? Color.white : tint)
            .background(
                active ? tint : tint.opacity(0.13),
                in: Circle()
            )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.55)
    }
}

private enum WatchDiscoveryStyleV2 {
    static let accent = Color(red: 0.68, green: 0.34, blue: 0.98)
}
