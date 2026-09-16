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

        bridge.watchTelemetryHandler = { events in
            await WaxloomClientTelemetry.shared.configure(baseURL: connection.baseURL)
            for row in events {
                await WaxloomClientTelemetry.shared.emit(
                    component: "watch",
                    event: row.event,
                    detail: row.detail,
                    clientEpochMs: Int(row.timestamp * 1000)
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

            let expectedSessionID = originSnapshot.sessionID
            player.setBaseURL(baseURL)

            if expectedSessionID.hasPrefix("preview:") {
                guard
                    let stored = DiscoverySessionStore.load(
                        expectedSessionID: expectedSessionID
                    )
                else {
                    await WaxloomClientTelemetry.shared.emit(
                        component: "watch_bridge",
                        event: "cold_start_discovery_missing",
                        detail: "session=\(expectedSessionID)"
                    )
                    return .sessionMismatch
                }

                let prefix = "preview:"
                let currentID = String(
                    expectedSessionID.dropFirst(prefix.count)
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
                    detail: "command=\(command.rawValue) session=\(expectedSessionID) items=\(items.count)"
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
            if request.action == .nowPlayingFeedback {
                let desired = max(-1, min(1, request.value ?? 0))

                let actualSessionID: String
                if let preview = player.currentPreview {
                    actualSessionID = "preview:\(preview.recordingMbid)"
                } else if let song = player.currentSong {
                    actualSessionID = "song:\(song.id)"
                } else {
                    actualSessionID = "idle"
                }

                if let expectedSessionID = request.id,
                   expectedSessionID != actualSessionID {
                    return .failure(
                        token: request.token,
                        message: "Now Playing changed before feedback was applied"
                    )
                }

                // Discovery preview feedback exposes its current value on the
                // candidate. Avoid invoking the legacy toggle path at all when
                // the requested final state is already applied. This makes a
                // replayed WatchConnectivity request idempotent.
                if player.mode == .preview,
                   (player.currentPreview?.feedback ?? 0) == desired {
                    return .success(
                        token: request.token,
                        title: desired > 0 ? "Liked" : desired < 0 ? "Less like this" : "Feedback cleared",
                        value: desired
                    )
                }

                guard var applied = await player.toggleCurrentTasteFeedback(desired) else {
                    return .failure(
                        token: request.token,
                        message: "Nothing playing or feedback unavailable"
                    )
                }

                // NativePlayer's historical API toggles when the requested value
                // is already active. Converge to the exact requested state before
                // replying so retries cannot leave Like/Dislike inverted.
                if applied != desired {
                    guard let corrected = await player.toggleCurrentTasteFeedback(desired) else {
                        return .failure(
                            token: request.token,
                            message: "Feedback could not reach the requested state"
                        )
                    }
                    applied = corrected
                }

                guard applied == desired else {
                    return .failure(
                        token: request.token,
                        message: "Feedback state mismatch"
                    )
                }

                return .success(
                    token: request.token,
                    title: applied > 0 ? "Liked" : applied < 0 ? "Less like this" : "Feedback cleared",
                    value: applied
                )
            }

            return await WatchCatalogService.handle(
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
