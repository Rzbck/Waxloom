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

        bridge.telemetryHandler = { component, event, detail in
            Task {
                await WaxloomClientTelemetry.shared.emit(
                    component: component,
                    event: event,
                    detail: detail
                )
            }
        }

        Task {
            await WaxloomClientTelemetry.shared.emit(
                component: "app",
                event: "process_init"
            )
        }

        bridge.coldStartCommandHandler = { command, expectedSessionID in
            guard let baseURL = connection.baseURL else {
                return .unavailable
            }

            // WatchConnectivity can wake the iPhone app in the background. The
            // SwiftUI scene may not have reached its normal restore task yet, so
            // recover the persisted library queue directly before applying the
            // Watch command.
            player.setBaseURL(baseURL)
            await player.restoreQueue(baseURL: baseURL)

            let restoredSessionID: String
            if let song = player.currentSong {
                restoredSessionID = "song:\(song.id)"
            } else if let preview = player.currentPreview {
                restoredSessionID = "preview:\(preview.recordingMbid)"
            } else {
                restoredSessionID = "idle"
            }

            guard restoredSessionID == expectedSessionID else {
                await WaxloomClientTelemetry.shared.emit(
                    component: "watch_bridge",
                    event: "cold_start_session_mismatch",
                    detail: "expected=\(expectedSessionID) restored=\(restoredSessionID)"
                )
                return .sessionMismatch
            }

            switch command {
            case .playPause:
                player.toggle()
            case .next:
                await player.next()
            case .previous:
                await player.previous()
            case .seekBackward15:
                player.skip(by: -15)
            case .seekForward15:
                player.skip(by: 15)
            }
            return .accepted
        }

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
            .modifier(
                WaxloomTelemetryLifecycleModifier(
                    baseURL: connection.baseURL
                )
            )
        }
    }
}
