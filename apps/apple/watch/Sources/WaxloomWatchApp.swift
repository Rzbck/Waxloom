import SwiftUI

@main
struct WaxloomWatchApp: App {
    @StateObject private var remote = WatchRemoteModel()

    var body: some Scene {
        WindowGroup {
            WatchRootView(remote: remote)
        }
    }
}

private struct WatchRootView: View {
    @ObservedObject var remote: WatchRemoteModel
    @State private var selectedPage = 0

    var body: some View {
        TabView(selection: $selectedPage) {
            WatchNowPlayingPage(remote: remote).tag(0)
            WatchControlsPage(remote: remote).tag(1)
            WatchStatusPage(remote: remote).tag(2)
        }
        .tabViewStyle(.page)
        .background(Color.black)
    }
}

private struct WatchNowPlayingPage: View {
    @ObservedObject var remote: WatchRemoteModel

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Circle()
                    .fill(remote.phoneReachable ? Color.green : Color.orange)
                    .frame(width: 7, height: 7)
                WaxloomBrandLockup(compact: true)
                    .scaleEffect(0.84, anchor: .leading)
                Spacer()
                if !remote.phoneReachable {
                    Image(systemName: "iphone.slash")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.orange)
                }
            }

            Spacer(minLength: 0)

            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [WaxloomWatchStyle.accent.opacity(0.30), Color.purple.opacity(0.08)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                WaxloomMark(lineWidth: 10)
                    .frame(width: 72, height: 50)
                    .opacity(remote.snapshot.sessionID == "idle" ? 0.72 : 1)
            }
            .frame(height: 68)

            VStack(spacing: 2) {
                Text(remote.snapshot.title)
                    .font(.headline.weight(.black))
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
                Text(remote.snapshot.artist)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }

            progress

            Text("← commandes · état →")
                .font(.system(size: 8, weight: .medium))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
        .padding(.horizontal, 4)
    }

    private var progress: some View {
        VStack(spacing: 3) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.10))
                    Capsule()
                        .fill(WaxloomWatchStyle.accent)
                        .frame(width: proxy.size.width * progressFraction)
                }
            }
            .frame(height: 4)

            HStack {
                Text(formatTime(remote.snapshot.elapsedSeconds))
                Spacer()
                Text(formatTime(remote.snapshot.durationSeconds))
            }
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
        }
    }

    private var progressFraction: CGFloat {
        guard remote.snapshot.durationSeconds > 0 else { return 0 }
        return CGFloat(max(0, min(1, remote.snapshot.elapsedSeconds / remote.snapshot.durationSeconds)))
    }
}

private struct WatchControlsPage: View {
    @ObservedObject var remote: WatchRemoteModel

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text("COMMANDES")
                    .font(.system(size: 9, weight: .black))
                    .foregroundStyle(.secondary)
                Spacer()
                if remote.pendingCommand != nil {
                    ProgressView()
                        .controlSize(.mini)
                } else {
                    Image(systemName: remote.phoneReachable ? "iphone.radiowaves.left.and.right" : "iphone.slash")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(remote.phoneReachable ? Color.green : Color.orange)
                }
            }

            HStack(spacing: 8) {
                WatchControlButton(
                    symbol: "backward.fill",
                    title: "Préc.",
                    accent: .cyan,
                    enabled: canSend
                ) { remote.send(.previous) }

                WatchControlButton(
                    symbol: remote.snapshot.isPlaying ? "pause.fill" : "play.fill",
                    title: remote.snapshot.isPlaying ? "Pause" : "Lire",
                    accent: WaxloomWatchStyle.accent,
                    enabled: canSend,
                    prominent: true
                ) { remote.send(.playPause) }

                WatchControlButton(
                    symbol: "forward.fill",
                    title: "Suiv.",
                    accent: .mint,
                    enabled: canSend
                ) { remote.send(.next) }
            }
            .frame(maxHeight: .infinity)

            VStack(spacing: 2) {
                Text(remote.snapshot.title)
                    .font(.caption.weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let result = remote.lastResult, result != .accepted {
                    Text(statusLabel(result))
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.orange)
                        .lineLimit(1)
                } else {
                    Text(remote.phoneReachable ? "Contrôle direct iPhone" : "Ouvre Waxloom sur l’iPhone")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 4)
    }

    private var canSend: Bool {
        remote.phoneReachable && remote.pendingCommand == nil
    }
}

private struct WatchStatusPage: View {
    @ObservedObject var remote: WatchRemoteModel

    var body: some View {
        VStack(spacing: 9) {
            HStack {
                Text("ÉTAT")
                    .font(.system(size: 9, weight: .black))
                    .foregroundStyle(.secondary)
                Spacer()
                WaxloomMark(lineWidth: 6)
                    .frame(width: 28, height: 20)
            }

            WatchStatusRow(
                symbol: "iphone",
                title: "iPhone",
                value: remote.phoneReachable ? "Connecté" : "Non joignable",
                ready: remote.phoneReachable
            )

            WatchStatusRow(
                symbol: remote.snapshot.isPlaying ? "play.fill" : "pause.fill",
                title: "Lecture",
                value: remote.snapshot.isPlaying ? "En cours" : "En pause",
                ready: remote.snapshot.sessionID != "idle"
            )

            WatchStatusRow(
                symbol: "arrow.triangle.2.circlepath",
                title: "Révision",
                value: "#\(remote.snapshot.revision)",
                ready: true
            )

            Spacer(minLength: 0)

            Text(String(BuildInfo.gitSHA.prefix(8)))
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 4)
    }
}

private struct WatchControlButton: View {
    let symbol: String
    let title: String
    let accent: Color
    let enabled: Bool
    var prominent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: prominent ? 27 : 20, weight: .black))
                Text(title)
                    .font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(enabled ? accent : Color.secondary.opacity(0.55))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(
                enabled ? accent.opacity(prominent ? 0.23 : 0.12) : Color.white.opacity(0.04),
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(enabled ? accent.opacity(0.26) : Color.clear, lineWidth: 1)
            }
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
        HStack(spacing: 9) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(ready ? WaxloomWatchStyle.accent : Color.orange)
                .frame(width: 30, height: 30)
                .background((ready ? WaxloomWatchStyle.accent : Color.orange).opacity(0.11), in: Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                Text(value).font(.caption.weight(.semibold)).lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 8)
        .frame(height: 45)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
    }
}

private enum WaxloomWatchStyle {
    static let accent = Color(red: 0.68, green: 0.43, blue: 0.92)
}

private func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds > 0 else { return "0:00" }
    let whole = Int(seconds)
    return String(format: "%d:%02d", whole / 60, whole % 60)
}

private func statusLabel(_ result: PlaybackCommandResult) -> String {
    switch result {
    case .accepted: return "OK"
    case .expired: return "Commande expirée"
    case .sessionMismatch: return "Lecture changée"
    case .staleRevision: return "État mis à jour"
    case .stateMismatch: return "Rien à contrôler"
    case .unsupported: return "Non pris en charge"
    case .unavailable: return "iPhone non joignable"
    }
}
