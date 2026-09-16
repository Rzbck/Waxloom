import SwiftUI

@main
struct WaxloomWatchApp: App {
    @StateObject private var remote = WatchRemoteModel()

    var body: some Scene {
        WindowGroup {
            WatchProductRootShell(remote: remote)
                .preferredColorScheme(.dark)
        }
    }
}
