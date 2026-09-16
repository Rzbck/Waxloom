import Foundation

extension WatchRemoteModel {
    func nowPlayingFeedback(_ value: Int) async -> WatchCatalogResponse {
        let requested = max(-1, min(1, value))
        WatchTelemetryStore.record(
            event: "feedback_request",
            detail: "requested=\(requested) session=\(snapshot.sessionID)"
        )

        let response = await catalog(
            WatchCatalogRequest(
                action: .nowPlayingFeedback,
                value: requested
            )
        )

        WatchTelemetryStore.record(
            event: "feedback_result",
            detail: "requested=\(requested) ok=\(response.ok ? 1 : 0) value=\(response.value ?? 99)"
        )

        guard response.ok else { return response }

        // Now Playing taste feedback changes the server-side Discovery
        // annotation. Drop the old cached payload immediately. Refreshing that
        // payload is deliberately asynchronous so the heart/thumb UI is not
        // blocked behind a second WatchConnectivity round-trip.
        let defaults = UserDefaults.standard
        let discoveryCacheKey = "waxloom.watch.catalog.cache.v2.discovery.root"
        defaults.removeObject(forKey: discoveryCacheKey)
        defaults.removeObject(forKey: "\(discoveryCacheKey).storedAt")

        Task { [weak self] in
            guard let self else { return }
            _ = await self.catalog(
                WatchCatalogRequest(
                    action: .load,
                    route: .discovery
                )
            )
        }

        return response
    }
}
