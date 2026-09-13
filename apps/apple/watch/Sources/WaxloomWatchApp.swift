import SwiftUI

@main
struct WaxloomWatchApp: App {
    @StateObject private var remote = WatchRemoteModel()

    var body: some Scene {
        WindowGroup {
            WatchPlayerView(remote: remote)
        }
    }
}

private struct WatchPlayerView: View {
    @ObservedObject var remote: WatchRemoteModel

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.purple.opacity(0.22))
                    .frame(height: 118)
                    .overlay {
                        Image(systemName: "waveform")
                            .font(.system(size: 34, weight: .semibold))
                            .foregroundStyle(.purple)
                    }

                VStack(spacing: 2) {
                    Text(remote.snapshot.title)
                        .font(.headline)
                        .lineLimit(1)
                    Text(remote.snapshot.artist)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 18) {
                    commandButton(.previous, symbol: "backward.fill")
                    commandButton(
                        .playPause,
                        symbol: remote.snapshot.isPlaying ? "pause.fill" : "play.fill"
                    )
                    commandButton(.next, symbol: "forward.fill")
                }

                Text(remote.phoneReachable ? "iPhone connected" : "Open Waxloom on iPhone")
                    .font(.caption2)
                    .foregroundStyle(remote.phoneReachable ? .green : .secondary)

                if let pending = remote.pendingCommand {
                    Text("Sending \(pending.rawValue)…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if let result = remote.lastResult, result != .accepted {
                    Text(result.rawValue)
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }

                Text(BuildInfo.gitSHA)
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 6)
        }
    }

    private func commandButton(_ command: PlaybackCommand, symbol: String) -> some View {
        Button {
            remote.send(command)
        } label: {
            Image(systemName: symbol)
                .font(.headline)
                .frame(width: 38, height: 38)
        }
        .buttonStyle(.plain)
        .background(Color.white.opacity(0.08))
        .clipShape(Circle())
        .disabled(!remote.phoneReachable || remote.pendingCommand != nil)
    }
}
