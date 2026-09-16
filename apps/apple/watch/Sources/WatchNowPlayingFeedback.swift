import Foundation

extension WatchRemoteModel {
    func nowPlayingFeedback(_ value: Int) async -> WatchCatalogResponse {
        await catalog(
            WatchCatalogRequest(
                action: .nowPlayingFeedback,
                value: max(-1, min(1, value))
            )
        )
    }
}
