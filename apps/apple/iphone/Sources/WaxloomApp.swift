import SwiftUI

@main
struct WaxloomApp: App {
    @StateObject private var connection: ConnectionModel
    @StateObject private var watchBridge: PhoneWatchBridge
    @StateObject private var player: NativePlayerModel

    init() {
        let connection = ConnectionModel()
        let bridge = PhoneWatchBridge()
        let player = NativePlayerModel(watchBridge: bridge)

        bridge.catalogHandler = { request in
            await WatchCatalogService.handle(
                request,
                connection: connection,
                player: player
            )
        }

        _connection = StateObject(wrappedValue: connection)
        _watchBridge = StateObject(wrappedValue: bridge)
        _player = StateObject(wrappedValue: player)
    }

    var body: some Scene {
        WindowGroup {
            WaxloomProductRootView(
                connection: connection,
                watchBridge: watchBridge,
                player: player
            )
            .preferredColorScheme(.dark)
        }
    }
}
