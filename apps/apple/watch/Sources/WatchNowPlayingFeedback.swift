import Foundation

extension WatchRemoteModel {
    func nowPlayingFeedback(_ value: Int) async -> WatchCatalogResponse {
        let response = await catalog(
            WatchCatalogRequest(
                action: .nowPlayingFeedback,
                value: max(-1, min(1, value))
            )
        )

        guard response.ok else { return response }

        // Now Playing taste feedback changes the server-side Discovery
        // annotation. Drop the old cached payload before trying to fetch the
        // authoritative one so a failed follow-up request cannot resurrect a
        // stale heart/thumb state on the next Browse visit.
        let defaults = UserDefaults.standard
        let discoveryCacheKey = "waxloom.watch.catalog.cache.v2.discovery.root"
        defaults.removeObject(forKey: discoveryCacheKey)
        defaults.removeObject(forKey: "\(discoveryCacheKey).storedAt")

        _ = await catalog(
            WatchCatalogRequest(
                action: .load,
                route: .discovery
            )
        )

        return response
    }
}
