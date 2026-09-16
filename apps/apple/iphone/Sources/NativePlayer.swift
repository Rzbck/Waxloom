import AVFoundation
import Foundation
import MediaPlayer

@MainActor
final class NativePlayerModel: NSObject, ObservableObject {
    enum Mode: Equatable {
        case idle
        case library
        case preview
    }

    @Published private(set) var mode: Mode = .idle
    @Published private(set) var currentSong: WaxloomSong?
    @Published private(set) var currentPreview: WaxloomDiscoveryCandidate?
    @Published private(set) var isPlaying = false
    @Published private(set) var elapsedSeconds: Double = 0
    @Published private(set) var durationSeconds: Double = 0
    @Published private(set) var errorMessage: String?

    private let player = AVPlayer()
    private weak var watchBridge: PhoneWatchBridge?
    private var baseURL: URL?
    private var libraryQueue: [WaxloomSong] = []
    private var libraryIndex = 0
    private var previewQueue: [WaxloomDiscoveryCandidate] = []
    private var previewIndex = 0
    private var previewLoadGeneration: Int64 = 0
    private var revision: Int64 = 0
    private var periodicObserver: Any?
    private var lastWatchProgressBucket = -1
    private var lastQueuePersistBucket = -1
    private var lastPreviewProgressTraceID: String?
    private var currentTasteFeedback = 0

    var queue: [WaxloomSong] { libraryQueue }
    var queueIndex: Int { libraryIndex }

    init(watchBridge: PhoneWatchBridge) {
        self.watchBridge = watchBridge
        super.init()
        configureAudioSession()
        configureRemoteCommands()
        configureObservation()
        watchBridge.commandHandler = { [weak self] command in
            guard let self else { return .unavailable }
            return self.handleWatchCommand(command)
        }
        publishSnapshot()
    }

    deinit {
        if let periodicObserver {
            player.removeTimeObserver(periodicObserver)
        }
        NotificationCenter.default.removeObserver(self)
    }

    func setBaseURL(_ value: URL?) {
        baseURL = value
    }

    func restoreQueue(baseURL: URL) async {
        guard mode == .idle else { return }
        self.baseURL = baseURL
        do {
            let saved = try await WaxloomAPI.playQueue(baseURL: baseURL)
            guard let entries = saved.entry, !entries.isEmpty else { return }
            libraryQueue = entries
            if let current = saved.current,
               let index = entries.firstIndex(where: { $0.id == current }) {
                libraryIndex = index
            } else {
                libraryIndex = 0
            }
            startLibrarySong(
                libraryQueue[libraryIndex],
                baseURL: baseURL,
                autoplay: false,
                startPosition: max(0, saved.position ?? 0),
                scrobble: false
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func play(song: WaxloomSong, queue: [WaxloomSong], baseURL: URL) {
        self.baseURL = baseURL
        previewLoadGeneration += 1
        if mode == .library, currentSong?.id == song.id {
            toggle()
            return
        }

        submitCurrentLibraryScrobble()
        libraryQueue = queue.isEmpty ? [song] : queue
        libraryIndex = max(0, libraryQueue.firstIndex(where: { $0.id == song.id }) ?? 0)
        startLibrarySong(song, baseURL: baseURL)
    }

    func playPreview(
        candidate: WaxloomDiscoveryCandidate,
        queue: [WaxloomDiscoveryCandidate],
        baseURL: URL
    ) async {
        self.baseURL = baseURL
        if mode == .preview, currentPreview?.recordingMbid == candidate.recordingMbid {
            toggle()
            return
        }

        submitCurrentLibraryScrobble()
        previewQueue = queue.isEmpty ? [candidate] : queue
        previewIndex = max(0, previewQueue.firstIndex(where: { $0.recordingMbid == candidate.recordingMbid }) ?? 0)
        await startPreview(candidate, baseURL: baseURL)
    }

    func toggle() {
        if isPlaying {
            pause()
        } else {
            resume()
        }
    }

    func pause() {
        player.pause()
        isPlaying = false
        revision += 1
        updateNowPlayingRate()
        publishSnapshot()
        persistQueue()
    }

    func resume() {
        guard player.currentItem != nil else { return }
        player.play()
        isPlaying = true
        revision += 1
        updateNowPlayingRate()
        publishSnapshot()
    }

    func seek(to seconds: Double) {
        guard player.currentItem != nil else { return }
        let bounded = max(0, durationSeconds > 0 ? min(durationSeconds, seconds) : seconds)
        player.seek(to: CMTime(seconds: bounded, preferredTimescale: 600))
        elapsedSeconds = bounded
        revision += 1
        updateNowPlayingElapsed()
        publishSnapshot()
        persistQueue()
    }

    func skip(by seconds: Double) {
        seek(to: elapsedSeconds + seconds)
    }

    func next() async {
        guard let baseURL else { return }
        switch mode {
        case .library:
            guard !libraryQueue.isEmpty else { return }
            submitCurrentLibraryScrobble()
            libraryIndex = (libraryIndex + 1) % libraryQueue.count
            startLibrarySong(libraryQueue[libraryIndex], baseURL: baseURL)
        case .preview:
            guard !previewQueue.isEmpty else { return }
            previewIndex = (previewIndex + 1) % previewQueue.count
            await startPreview(previewQueue[previewIndex], baseURL: baseURL)
        case .idle:
            break
        }
    }

    func previous() async {
        guard let baseURL else { return }
        switch mode {
        case .library:
            guard !libraryQueue.isEmpty else { return }
            submitCurrentLibraryScrobble()
            libraryIndex = (libraryIndex - 1 + libraryQueue.count) % libraryQueue.count
            startLibrarySong(libraryQueue[libraryIndex], baseURL: baseURL)
        case .preview:
            guard !previewQueue.isEmpty else { return }
            previewIndex = (previewIndex - 1 + previewQueue.count) % previewQueue.count
            await startPreview(previewQueue[previewIndex], baseURL: baseURL)
        case .idle:
            break
        }
    }

    func toggleCurrentTasteFeedback(_ requestedValue: Int) async -> Int? {
        guard mode != .idle, let baseURL else { return nil }

        let requested = max(-1, min(1, requestedValue))
        let nextValue = currentTasteFeedback == requested ? 0 : requested
        let candidate: WaxloomDiscoveryCandidate

        switch mode {
        case .preview:
            guard let currentPreview else { return nil }
            candidate = currentPreview

        case .library:
            guard let song = currentSong else { return nil }
            let rawMbid = (song.musicBrainzId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let identity = rawMbid.isEmpty ? "navidrome:\(song.id)" : rawMbid
            let tags = (song.genre ?? "")
                .split(separator: ",")
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            candidate = WaxloomDiscoveryCandidate(
                recordingMbid: identity,
                artist: song.artist ?? "Unknown artist",
                title: song.title ?? "Unknown title",
                release: song.album,
                releaseMbid: nil,
                similarity: 0,
                underground: 0,
                rank: 0,
                tags: tags,
                musicbrainzUrl: nil,
                source: "library",
                reason: "Now Playing feedback",
                feedback: currentTasteFeedback
            )

        case .idle:
            return nil
        }

        do {
            try await WaxloomAPI.discoveryFeedback(
                baseURL: baseURL,
                candidate: candidate,
                value: nextValue
            )
            currentTasteFeedback = nextValue
            if mode == .preview {
                currentPreview?.feedback = nextValue
                if previewQueue.indices.contains(previewIndex) {
                    previewQueue[previewIndex].feedback = nextValue
                }
            }
            revision += 1
            publishSnapshot()
            return nextValue
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    private func startLibrarySong(
        _ song: WaxloomSong,
        baseURL: URL,
        autoplay: Bool = true,
        startPosition: Double = 0,
        scrobble: Bool = true
    ) {
        previewLoadGeneration += 1
        let url = WaxloomAPI.streamURL(baseURL: baseURL, songID: song.id)
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        let position = max(0, startPosition)
        player.seek(to: CMTime(seconds: position, preferredTimescale: 600))

        mode = .library
        currentSong = song
        currentPreview = nil
        currentTasteFeedback = 0
        elapsedSeconds = position
        durationSeconds = song.duration ?? 0
        errorMessage = nil
        lastWatchProgressBucket = -1
        lastQueuePersistBucket = -1
        lastPreviewProgressTraceID = nil
        revision += 1

        if autoplay {
            player.play()
            isPlaying = true
        } else {
            player.pause()
            isPlaying = false
        }
        traceClient(
            "library_item_set",
            detail: "autoplay=\(autoplay ? 1 : 0) \(audioRouteSummary())"
        )
        updateNowPlaying()
        publishSnapshot()
        persistQueue()
        if scrobble {
            Task { await WaxloomAPI.scrobble(baseURL: baseURL, id: song.id, submission: false) }
        }
    }

    private func discoveryPreviewURL(baseURL: URL, recordingMbid: String) -> URL {
        baseURL
            .appendingPathComponent("api", isDirectory: true)
            .appendingPathComponent("discovery", isDirectory: true)
            .appendingPathComponent("previews", isDirectory: true)
            .appendingPathComponent(recordingMbid, isDirectory: false)
    }

    private func tracePreview(_ event: String, candidate: WaxloomDiscoveryCandidate, baseURL: URL) {
        let endpoint = baseURL
            .appendingPathComponent("api", isDirectory: true)
            .appendingPathComponent("player", isDirectory: true)
            .appendingPathComponent("trace", isDirectory: false)
        let payload: [String: Any] = [
            "event": event,
            "song_id": candidate.recordingMbid,
            "client_epoch_ms": Int(Date().timeIntervalSince1970 * 1000),
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        Task {
            _ = try? await URLSession.shared.data(for: request)
        }
    }

    private func traceClient(_ event: String, detail: String = "") {
        Task {
            await WaxloomClientTelemetry.shared.emit(
                component: "player",
                event: event,
                detail: detail
            )
        }
    }

    private func audioRouteSummary() -> String {
        let session = AVAudioSession.sharedInstance()
        let outputs = session.currentRoute.outputs
            .map { $0.portType.rawValue }
            .joined(separator: ",")
        return "route=\(outputs.isEmpty ? "none" : outputs) volume=\(String(format: "%.2f", session.outputVolume))"
    }

    private func timeControlSummary() -> String {
        switch player.timeControlStatus {
        case .paused: return "paused"
        case .waitingToPlayAtSpecifiedRate: return "waiting"
        case .playing: return "playing"
        @unknown default: return "unknown"
        }
    }

    private func startPreview(_ candidate: WaxloomDiscoveryCandidate, baseURL: URL) async {
        previewLoadGeneration += 1
        let generation = previewLoadGeneration
        let url = discoveryPreviewURL(baseURL: baseURL, recordingMbid: candidate.recordingMbid)

        // The cache endpoint is already a byte-range capable Waxloom-local media
        // source. Do not preload isPlayable/duration and do not seek before play:
        // those metadata probes can complete several HTTP Range requests while
        // AVPlayer never reaches the actual playback call on iPhone.
        mode = .preview
        currentPreview = candidate
        currentSong = nil
        currentTasteFeedback = candidate.feedback ?? 0
        elapsedSeconds = 0
        durationSeconds = 0
        errorMessage = nil
        isPlaying = false
        lastWatchProgressBucket = -1
        lastQueuePersistBucket = -1
        lastPreviewProgressTraceID = nil
        revision += 1
        updateNowPlaying()
        publishSnapshot()
        tracePreview("preview_tap", candidate: candidate, baseURL: baseURL)

        do {
            try AVAudioSession.sharedInstance().setActive(true)
            traceClient(
                "preview_audio_session",
                detail: "result=ok \(audioRouteSummary())"
            )
        } catch {
            traceClient(
                "preview_audio_session",
                detail: "result=error message=\(error.localizedDescription) \(audioRouteSummary())"
            )
        }
        guard generation == previewLoadGeneration,
              currentPreview?.recordingMbid == candidate.recordingMbid else { return }

        let item = AVPlayerItem(url: url)
        item.preferredForwardBufferDuration = 1.0
        player.automaticallyWaitsToMinimizeStalling = false
        player.replaceCurrentItem(with: item)
        tracePreview("preview_item_set", candidate: candidate, baseURL: baseURL)

        guard generation == previewLoadGeneration,
              currentPreview?.recordingMbid == candidate.recordingMbid else { return }

        player.playImmediately(atRate: 1.0)
        isPlaying = true
        revision += 1
        updateNowPlaying()
        publishSnapshot()
        tracePreview("preview_play_called", candidate: candidate, baseURL: baseURL)
        traceClient(
            "preview_play_called",
            detail: "song=\(candidate.recordingMbid) time_control=\(timeControlSummary()) \(audioRouteSummary())"
        )

        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let self,
                  generation == self.previewLoadGeneration,
                  self.currentPreview?.recordingMbid == candidate.recordingMbid,
                  self.elapsedSeconds < 0.05 else { return }
            if item.status == .failed {
                let nsError = item.error as NSError?
                let domain = nsError?.domain ?? "none"
                let code = nsError?.code ?? 0
                let message = nsError?.localizedDescription ?? "AVPlayer item failed"
                self.isPlaying = false
                self.errorMessage = "Discovery preview: \(message)"
                self.revision += 1
                self.updateNowPlaying()
                self.publishSnapshot()
                self.tracePreview("preview_item_failed", candidate: candidate, baseURL: baseURL)
                self.traceClient(
                    "preview_item_failed",
                    detail: "song=\(candidate.recordingMbid) domain=\(domain) code=\(code) message=\(message) time_control=\(self.timeControlSummary()) \(self.audioRouteSummary())"
                )
            } else {
                self.tracePreview("preview_no_progress", candidate: candidate, baseURL: baseURL)
                self.traceClient(
                    "preview_no_progress",
                    detail: "song=\(candidate.recordingMbid) item_status=\(item.status.rawValue) time_control=\(self.timeControlSummary()) wait=\(self.player.reasonForWaitingToPlay?.rawValue ?? "none") \(self.audioRouteSummary())"
                )
            }
        }
    }

    private func handleWatchCommand(_ command: PlaybackCommand) -> PlaybackCommandResult {
        guard mode != .idle else { return .stateMismatch }
        switch command {
        case .playPause:
            toggle()
        case .next:
            Task { await next() }
        case .previous:
            Task { await previous() }
        case .seekBackward15:
            skip(by: -15)
        case .seekForward15:
            skip(by: 15)
        }
        return .accepted
    }

    private func submitCurrentLibraryScrobble() {
        guard mode == .library, let song = currentSong, let baseURL else { return }
        Task { await WaxloomAPI.scrobble(baseURL: baseURL, id: song.id, submission: true) }
    }

    private func persistQueue() {
        guard mode == .library, let baseURL else { return }
        let ids = libraryQueue.map(\.id)
        let current = currentSong?.id
        let position = elapsedSeconds
        Task {
            await WaxloomAPI.savePlayQueue(
                baseURL: baseURL,
                ids: ids,
                current: current,
                position: position
            )
        }
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
            traceClient("audio_session_ready", detail: audioRouteSummary())
        } catch {
            errorMessage = "Audio session: \(error.localizedDescription)"
            traceClient(
                "audio_session_error",
                detail: "message=\(error.localizedDescription) \(audioRouteSummary())"
            )
        }
    }

    private func configureRemoteCommands() {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.isEnabled = true
        commands.pauseCommand.isEnabled = true
        commands.togglePlayPauseCommand.isEnabled = true
        commands.nextTrackCommand.isEnabled = true
        commands.previousTrackCommand.isEnabled = true
        commands.changePlaybackPositionCommand.isEnabled = true

        commands.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }
            return .success
        }
        commands.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        commands.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggle() }
            return .success
        }
        commands.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in await self?.next() }
            return .success
        }
        commands.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in await self?.previous() }
            return .success
        }
        commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(to: event.positionTime) }
            return .success
        }
    }

    private func configureObservation() {
        periodicObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                guard let self else { return }
                let seconds = time.seconds
                if seconds.isFinite { self.elapsedSeconds = max(0, seconds) }
                if let itemDuration = self.player.currentItem?.duration.seconds, itemDuration.isFinite, itemDuration > 0 {
                    self.durationSeconds = itemDuration
                }
                self.updateNowPlayingElapsed()

                if self.mode == .preview,
                   let preview = self.currentPreview,
                   self.elapsedSeconds > 0.05,
                   self.lastPreviewProgressTraceID != preview.recordingMbid,
                   let baseURL = self.baseURL {
                    self.lastPreviewProgressTraceID = preview.recordingMbid
                    self.tracePreview("preview_progress", candidate: preview, baseURL: baseURL)
                    self.traceClient(
                        "preview_progress",
                        detail: "song=\(preview.recordingMbid) time_control=\(self.timeControlSummary()) \(self.audioRouteSummary())"
                    )
                }

                if self.isPlaying {
                    let bucket = Int(self.elapsedSeconds / 5)
                    if bucket != self.lastWatchProgressBucket {
                        self.lastWatchProgressBucket = bucket
                        self.publishSnapshot(interactive: false)
                    }
                }

                if self.mode == .library {
                    let queueBucket = Int(self.elapsedSeconds / 15)
                    if queueBucket != self.lastQueuePersistBucket {
                        self.lastQueuePersistBucket = queueBucket
                        self.persistQueue()
                    }
                }
            }
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(itemDidFinish),
            name: AVPlayerItem.didPlayToEndTimeNotification,
            object: nil
        )
    }

    @objc private func itemDidFinish() {
        Task { @MainActor in await next() }
    }

    private var snapshotTitle: String {
        switch mode {
        case .library: return currentSong?.title ?? "Unknown title"
        case .preview: return currentPreview?.title ?? "Preview"
        case .idle: return "Nothing playing"
        }
    }

    private var snapshotArtist: String {
        switch mode {
        case .library: return currentSong?.artist ?? "Waxloom"
        case .preview: return currentPreview?.artist ?? "Waxloom"
        case .idle: return "Waxloom"
        }
    }

    private var snapshotSessionID: String {
        switch mode {
        case .library: return "song:\(currentSong?.id ?? "idle")"
        case .preview: return "preview:\(currentPreview?.recordingMbid ?? "idle")"
        case .idle: return "idle"
        }
    }

    private func publishSnapshot(interactive: Bool = true) {
        let artworkURL: String?
        if mode == .library, let baseURL {
            artworkURL = WaxloomAPI.coverURL(baseURL: baseURL, coverID: currentSong?.coverArt, size: 400)?.absoluteString
        } else {
            artworkURL = nil
        }

        watchBridge?.publish(
            PlaybackSnapshot(
                sessionID: snapshotSessionID,
                revision: revision,
                title: snapshotTitle,
                artist: snapshotArtist,
                artworkURL: artworkURL,
                isPlaying: isPlaying,
                elapsedSeconds: elapsedSeconds,
                durationSeconds: durationSeconds,
                feedback: currentTasteFeedback
            ),
            interactive: interactive
        )
    }

    private func updateNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: snapshotTitle,
            MPMediaItemPropertyArtist: snapshotArtist,
            MPMediaItemPropertyPlaybackDuration: durationSeconds,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsedSeconds,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
    }

    private func updateNowPlayingElapsed() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsedSeconds
        info[MPMediaItemPropertyPlaybackDuration] = durationSeconds
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updateNowPlayingRate() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsedSeconds
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
