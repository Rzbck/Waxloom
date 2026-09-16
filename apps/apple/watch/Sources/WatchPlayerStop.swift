import Foundation

extension WatchRemoteModel {
    func stopPlayback() async -> WatchCatalogResponse {
        WatchTelemetryStore.record(
            event: "stop_tap",
            detail: "session=\(snapshot.sessionID)"
        )

        let response = await catalog(
            WatchCatalogRequest(action: .stop)
        )

        WatchTelemetryStore.record(
            event: "stop_result",
            detail: "ok=\(response.ok ? 1 : 0) status=\(response.status ?? "none")"
        )
        return response
    }
}
