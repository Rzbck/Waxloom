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
    private var revision: Int64 = 0
    private var periodicObserver: Any?
    private var lastWatchProgressBucket = -1
    private var lastQueuePersistBucket = -1

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

    private func startLibrarySong(
        _ song: WaxloomSong,
        baseURL: URL,
        autoplay: Bool = true,
        startPosition: Double = 0,
        scrobble: Bool = true
    ) {
        let url = WaxloomAPI.streamURL(baseURL: baseURL, songID: song.id)
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        let position = max(0, startPosition)
        player.seek(to: CMTime(seconds: position, preferredTimescale: 600))

        mode = .library
        currentSong = song
        currentPreview = nil
        elapsedSeconds = position
        durationSeconds = song.duration ?? 0
        errorMessage = nil
        lastWatchProgressBucket = -1
        lastQueuePersistBucket = -1
        revision += 1

        if autoplay {
            player.play()
            isPlaying = true
        } else {
            player.pause()
            isPlaying = false
        }
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

    private func startPreview(_ candidate: WaxloomDiscoveryCandidate, baseURL: URL) async {
        let url = discoveryPreviewURL(baseURL: baseURL, recordingMbid: candidate.recordingMbid)
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        await player.seek(to: .zero)

        mode = .preview
        currentPreview = candidate
        currentSong = nil
        elapsedSeconds = 0
        durationSeconds = 0
        errorMessage = nil
        lastWatchProgressBucket = -1
        lastQueuePersistBucket = -1
        revision += 1

        player.play()
        isPlaying = true
        updateNowPlaying()
        publishSnapshot()
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
        } catch {
            errorMessage = "Audio session: \(error.localizedDescription)"
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
                durationSeconds: durationSeconds
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
