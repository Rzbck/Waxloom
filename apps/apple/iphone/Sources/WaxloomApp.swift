import SwiftUI

@main
struct WaxloomApp: App {
    @StateObject private var connection = ConnectionModel()
    @StateObject private var watchBridge = PhoneWatchBridge()

    var body: some Scene {
        WindowGroup {
            RootView(connection: connection, watchBridge: watchBridge)
                .preferredColorScheme(.dark)
        }
    }
}

private struct RootView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var watchBridge: PhoneWatchBridge

    var body: some View {
        TabView {
            NavigationStack {
                HomeView(connection: connection, watchBridge: watchBridge)
            }
            .tabItem { Label("Home", systemImage: "house.fill") }

            NavigationStack {
                PlaceholderView(eyebrow: "LIBRARY", title: "Your music", copy: "Albums, artists, favourites and playlists will use the existing Waxloom API.")
            }
            .tabItem { Label("Library", systemImage: "square.stack.fill") }

            NavigationStack {
                PlaceholderView(eyebrow: "DISCOVERY", title: "Find something new", copy: "The native Discovery surface will preserve the validated Like, Less and bad-source behaviours.")
            }
            .tabItem { Label("Discovery", systemImage: "sparkles") }

            NavigationStack {
                SettingsView(connection: connection, watchBridge: watchBridge)
            }
            .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(WaxloomTheme.accent)
    }
}

private struct HomeView: View {
    @ObservedObject var connection: ConnectionModel
    @ObservedObject var watchBridge: PhoneWatchBridge

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
                    detail: watchBridge.watchInstalled ? (watchBridge.watchReachable ? "Companion connected" : "Companion installed · not reachable") : "Companion not installed",
                    symbol: "applewatch"
                )
                playerCard
            }
            .padding(20)
        }
        .background(WaxloomTheme.background.ignoresSafeArea())
        .navigationTitle("")
        .toolbar(.hidden, for: .navigationBar)
    }

    private var playerCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("NOW PLAYING")
                .font(.caption2.weight(.bold))
                .tracking(1.8)
                .foregroundStyle(.secondary)
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: 12)
                    .fill(WaxloomTheme.artwork)
                    .frame(width: 68, height: 68)
                    .overlay {
                        Image(systemName: "waveform")
                            .font(.title2)
                            .foregroundStyle(WaxloomTheme.accent)
                    }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Player foundation ready").font(.headline)
                    Text("AVFoundation playback comes in the next slice.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .waxloomCard()
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

private struct ConnectionCard: View {
    @ObservedObject var connection: ConnectionModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("WAXLOOM SERVER")
                        .font(.caption2.weight(.bold))
                        .tracking(1.8)
                        .foregroundStyle(.secondary)
                    Text(connection.statusText).font(.headline)
                }
                Spacer()
                Circle()
                    .fill(connection.isConnected ? Color.green : Color.secondary.opacity(0.45))
                    .frame(width: 9, height: 9)
            }

            if let health = connection.health {
                Text("API \(health.version)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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

            if !connection.isConnected {
                Text("Configure the private Tailscale HTTPS address in Settings.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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
                Text("Only HTTPS endpoints are accepted. No broad ATS cleartext exception is present in the app.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Apple Watch") {
                LabeledContent("Installed", value: watchBridge.watchInstalled ? "Yes" : "No")
                LabeledContent("Reachable", value: watchBridge.watchReachable ? "Yes" : "No")
            }

            Section("Build") {
                LabeledContent("SHA", value: BuildInfo.gitSHA)
                Text("The GitHub artifact and local iLoader candidate are tied to the exact Git commit.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .scrollContentBackground(.hidden)
        .background(WaxloomTheme.background)
        .navigationTitle("Settings")
    }
}

private struct PlaceholderView: View {
    let eyebrow: String
    let title: String
    let copy: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(eyebrow)
                    .font(.caption.weight(.bold))
                    .tracking(2)
                    .foregroundStyle(.secondary)
                Text(title).font(.largeTitle.bold())
                Text(copy).foregroundStyle(.secondary).lineSpacing(4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .background(WaxloomTheme.background.ignoresSafeArea())
        .navigationTitle("")
        .toolbar(.hidden, for: .navigationBar)
    }
}

private enum WaxloomTheme {
    static let background = Color(red: 0.04, green: 0.04, blue: 0.055)
    static let panel = Color(red: 0.075, green: 0.07, blue: 0.09)
    static let artwork = Color(red: 0.14, green: 0.10, blue: 0.17)
    static let accent = Color(red: 0.64, green: 0.42, blue: 0.84)
}

private extension View {
    func waxloomCard() -> some View {
        padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WaxloomTheme.panel)
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color.white.opacity(0.07), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}
