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

        bridge.coldStartCommandHandler = { command, originSnapshot in
            guard let baseURL = connection.baseURL else {
                return .unavailable
            }

            player.setBaseURL(baseURL)

            if originSnapshot.sessionID.hasPrefix("preview:") {
                guard
                    let stored = DiscoverySessionStore.load(
                        expectedSessionID: originSnapshot.sessionID
                    )
                else {
                    await WaxloomClientTelemetry.shared.emit(
                        component: "watch_bridge",
                        event: "cold_start_discovery_missing",
                        detail: "session=\(originSnapshot.sessionID)"
                    )
                    return .sessionMismatch
                }

                let prefix = "preview:"
                let currentID = String(
                    originSnapshot.sessionID.dropFirst(prefix.count)
                )
                let items = stored.items
                guard
                    let currentIndex = items.firstIndex(where: { $0.id == currentID })
                else {
                    return .sessionMismatch
                }

                let queue = DiscoverySessionStore.queue(from: stored)

                func candidate(at index: Int) -> WaxloomDiscoveryCandidate {
                    DiscoverySessionStore.candidate(from: items[index])
                }

                switch command {
                case .next:
                    let index = (currentIndex + 1) % items.count
                    await player.playPreview(
                        candidate: candidate(at: index),
                        queue: queue,
                        baseURL: baseURL
                    )

                case .previous:
                    let index = (currentIndex - 1 + items.count) % items.count
                    await player.playPreview(
                        candidate: candidate(at: index),
                        queue: queue,
                        baseURL: baseURL
                    )

                case .playPause:
                    await player.playPreview(
                        candidate: candidate(at: currentIndex),
                        queue: queue,
                        baseURL: baseURL
                    )
                    if originSnapshot.isPlaying {
                        player.pause()
                    }

                case .seekBackward15, .seekForward15:
                    await player.playPreview(
                        candidate: candidate(at: currentIndex),
                        queue: queue,
                        baseURL: baseURL
                    )
                    let delta = command == .seekBackward15 ? -15.0 : 15.0
                    player.seek(to: max(0, originSnapshot.elapsedSeconds + delta))
                    if !originSnapshot.isPlaying {
                        player.pause()
                    }
                }

                await WaxloomClientTelemetry.shared.emit(
                    component: "watch_bridge",
                    event: "cold_start_discovery_restored",
                    detail: "command=\(command.rawValue) session=\(originSnapshot.sessionID) items=\(items.count)"
                )
                return .accepted
            }

            // Library playback already has a server-persisted play queue. Restore
            // it before applying the Watch command, while using the Watch snapshot
            // to preserve play/pause and seek intent across the process restart.
            await player.restoreQueue(baseURL: baseURL)

            let restoredSessionID: String
            if let song = player.currentSong {
                restoredSessionID = "song:\(song.id)"
            } else if let preview = player.currentPreview {
                restoredSessionID = "preview:\(preview.recordingMbid)"
            } else {
                restoredSessionID = "idle"
            }

            guard restoredSessionID == originSnapshot.sessionID else {
                await WaxloomClientTelemetry.shared.emit(
                    component: "watch_bridge",
                    event: "cold_start_session_mismatch",
                    detail: "expected=\(originSnapshot.sessionID) restored=\(restoredSessionID)"
                )
                return .sessionMismatch
            }

            switch command {
            case .playPause:
                if originSnapshot.isPlaying {
                    player.pause()
                } else {
                    player.resume()
                }

            case .next:
                await player.next()

            case .previous:
                await player.previous()

            case .seekBackward15, .seekForward15:
                let delta = command == .seekBackward15 ? -15.0 : 15.0
                player.seek(to: max(0, originSnapshot.elapsedSeconds + delta))
                if originSnapshot.isPlaying {
                    player.resume()
                } else {
                    player.pause()
                }
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
