import SwiftUI

struct WatchProductRootShell: View {
    @ObservedObject var remote: WatchRemoteModel
    @State private var clearing = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            WatchProductRootView(remote: remote)

            if remote.snapshot.sessionID != "idle" {
                Button {
                    guard !clearing else { return }
                    clearing = true
                    Task {
                        _ = await remote.stopPlayback()
                        await MainActor.run {
                            clearing = false
                        }
                    }
                } label: {
                    Group {
                        if clearing {
                            ProgressView()
                                .controlSize(.mini)
                        } else {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 14, weight: .bold))
                        }
                    }
                    .frame(width: 28, height: 28)
                    .foregroundStyle(Color.secondary)
                    .background(.black.opacity(0.62), in: Circle())
                }
                .buttonStyle(WatchTapPulseStyle(strength: 0.84))
                .disabled(clearing)
                .accessibilityLabel("Stop and clear player")
                .padding(.top, 2)
                .padding(.trailing, 2)
                .zIndex(20)
            }
        }
    }
}
