import SwiftUI

@main
struct WaxloomWatchApp: App {
    @StateObject private var remote = WatchRemoteModel()

    var body: some Scene {
        WindowGroup {
            WatchProductRootView(remote: remote)
                .preferredColorScheme(.dark)
        }
    }
}
