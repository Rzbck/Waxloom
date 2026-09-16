import Foundation

@MainActor
private final class WatchFeedbackCoordinator {
    static let shared = WatchFeedbackCoordinator()

    private weak var remote: WatchRemoteModel?
    private var sessionID = "idle"
    private var desiredValue = 0
    private var confirmedValue = 0
    private var workerRunning = false
    private var generation = 0
    private var lastObservedRevision: Int64 = -1

    func enqueue(
        remote: WatchRemoteModel,
        tappedValue: Int
    ) -> WatchCatalogResponse {
        let snapshot = remote.snapshot
        let tapped = max(-1, min(1, tappedValue))
        let observed = max(-1, min(1, snapshot.feedback ?? 0))
        let identityChanged = self.remote.map { $0 !== remote } ?? true
        let sessionChanged = sessionID != snapshot.sessionID

        if identityChanged || sessionChanged {
            self.remote = remote
            sessionID = snapshot.sessionID
            desiredValue = observed
            confirmedValue = observed
            lastObservedRevision = snapshot.revision
            generation &+= 1
            workerRunning = false
        } else if !workerRunning, snapshot.revision > lastObservedRevision {
            // Accept an authoritative external change only while no local
            // feedback mutation is in flight. During a local mutation, the
            // optimistic desired value remains the source of truth for taps.
            desiredValue = observed
            confirmedValue = observed
            lastObservedRevision = snapshot.revision
        }

        let before = desiredValue
        let desired = before == tapped ? 0 : tapped
        desiredValue = desired
        invalidateDiscoveryCache()

        WatchTelemetryStore.record(
            event: "feedback_tap",
            detail: "tapped=\(tapped) before=\(before) desired=\(desired) busy=\(workerRunning ? 1 : 0) session=\(snapshot.sessionID)"
        )

        if workerRunning {
            WatchTelemetryStore.record(
                event: "feedback_coalesced",
                detail: "desired=\(desired) session=\(snapshot.sessionID)"
            )
        } else {
            workerRunning = true
            let workerGeneration = generation
            let workerSessionID = sessionID

            Task { @MainActor [weak self, weak remote] in
                guard let self, let remote else { return }
                await self.drain(
                    remote: remote,
                    workerGeneration: workerGeneration,
                    workerSessionID: workerSessionID
                )
            }
        }

        // Return the user's intended state immediately so the Watch UI updates
        // on the first tap and releases its local feedbackBusy gate. The worker
        // below serializes/coalesces the real mutations and sends only the most
        // recent desired state.
        return .success(
            token: UUID().uuidString,
            title: Self.title(for: desired),
            status: "optimistic",
            value: desired
        )
    }

    private func drain(
        remote: WatchRemoteModel,
        workerGeneration: Int,
        workerSessionID: String
    ) async {
        // Tiny debounce lets rapid tap sequences collapse before the first
        // WatchConnectivity round-trip starts.
        try? await Task.sleep(nanoseconds: 120_000_000)

        while workerGeneration == generation,
              sessionID == workerSessionID,
              remote.snapshot.sessionID == workerSessionID {
            let target = desiredValue

            WatchTelemetryStore.record(
                event: "feedback_request",
                detail: "requested=\(target) session=\(workerSessionID)"
            )

            let response = await remote.catalog(
                WatchCatalogRequest(
                    action: .nowPlayingFeedback,
                    id: workerSessionID,
                    value: target
                )
            )

            guard workerGeneration == generation,
                  sessionID == workerSessionID else {
                return
            }

            WatchTelemetryStore.record(
                event: "feedback_result",
                detail: "requested=\(target) ok=\(response.ok ? 1 : 0) value=\(response.value ?? 99) session=\(workerSessionID)"
            )

            if response.ok {
                confirmedValue = max(-1, min(1, response.value ?? target))
            } else if desiredValue == target {
                // Keep the coordinator internally honest after a failed final
                // request. A later authoritative snapshot/tap will resync the UI.
                desiredValue = confirmedValue
            }

            if desiredValue != target {
                WatchTelemetryStore.record(
                    event: "feedback_coalesced",
                    detail: "applied=\(response.value ?? 99) next=\(desiredValue) session=\(workerSessionID)"
                )
                try? await Task.sleep(nanoseconds: 80_000_000)
                continue
            }

            workerRunning = false

            guard response.ok else {
                WatchTelemetryStore.record(
                    event: "feedback_failed",
                    detail: "desired=\(target) session=\(workerSessionID) message=\(response.message ?? "unknown")"
                )
                return
            }

            invalidateDiscoveryCache()

            // Refresh Discovery only after the final coalesced mutation has
            // settled. This must never sit on the tap/UI critical path.
            Task { @MainActor [weak remote] in
                guard let remote,
                      remote.snapshot.sessionID == workerSessionID else { return }
                _ = await remote.catalog(
                    WatchCatalogRequest(
                        action: .load,
                        route: .discovery
                    )
                )
            }
            return
        }

        if workerGeneration == generation {
            workerRunning = false
        }
    }

    private func invalidateDiscoveryCache() {
        let defaults = UserDefaults.standard
        let key = "waxloom.watch.catalog.cache.v2.discovery.root"
        defaults.removeObject(forKey: key)
        defaults.removeObject(forKey: "\(key).storedAt")
    }

    private static func title(for value: Int) -> String {
        if value > 0 { return "Liked" }
        if value < 0 { return "Less like this" }
        return "Feedback cleared"
    }
}

extension WatchRemoteModel {
    func nowPlayingFeedback(_ value: Int) async -> WatchCatalogResponse {
        await WatchFeedbackCoordinator.shared.enqueue(
            remote: self,
            tappedValue: value
        )
    }
}
