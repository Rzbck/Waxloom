import Foundation

extension WatchRemoteModel {
    func nowPlayingFeedback(_ value: Int) async -> WatchCatalogResponse {
        let response = await catalog(
            WatchCatalogRequest(
                action: .nowPlayingFeedback,
                value: max(-1, min(1, value))
            )
        )

        // A Now Playing taste mutation changes the Discovery annotation on the
        // server. Refresh the cached Discovery payload immediately so returning
        // to Browse cannot resurrect a stale heart/thumb state for up to the
        // normal Discovery cache TTL.
        if response.ok {
            _ = await catalog(
                WatchCatalogRequest(
                    action: .load,
                    route: .discovery
                )
            )
        }

        return response
    }
}
