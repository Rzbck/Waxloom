import Foundation
import SwiftUI
import UIKit

private struct WaxloomClientTraceEvent: Codable, Identifiable {
    var id: String = UUID().uuidString
    var component: String
    var event: String
    var detail: String
    var clientEpochMs: Int

    enum CodingKeys: String, CodingKey {
        case component
        case event
        case detail
        case clientEpochMs = "client_epoch_ms"
        case id
    }
}

actor WaxloomClientTelemetry {
    static let shared = WaxloomClientTelemetry()

    private static let storageKey = "waxloom.client.telemetry.pending.v1"
    private static let maxPending = 240

    private var baseURL: URL?
    private var pending: [WaxloomClientTraceEvent]
    private var flushing = false

    private init() {
        if
            let data = UserDefaults.standard.data(forKey: Self.storageKey),
            let decoded = try? JSONDecoder().decode([WaxloomClientTraceEvent].self, from: data)
        {
            pending = Array(decoded.suffix(Self.maxPending))
        } else {
            pending = []
        }
    }

    func configure(baseURL: URL?) async {
        self.baseURL = baseURL
        await flush()
    }

    func emit(component: String, event: String, detail: String = "") async {
        let row = WaxloomClientTraceEvent(
            component: clean(component, limit: 32),
            event: clean(event, limit: 48),
            detail: clean(detail, limit: 300),
            clientEpochMs: Int(Date().timeIntervalSince1970 * 1000)
        )
        pending.append(row)
        if pending.count > Self.maxPending {
            pending.removeFirst(pending.count - Self.maxPending)
        }
        persist()
        await flush()
    }

    private func clean(_ value: String, limit: Int) -> String {
        String(
            value
                .replacingOccurrences(of: "\r", with: " ")
                .replacingOccurrences(of: "\n", with: " ")
                .split(whereSeparator: { $0.isWhitespace })
                .joined(separator: " ")
                .prefix(limit)
        )
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(pending) else { return }
        UserDefaults.standard.set(data, forKey: Self.storageKey)
    }

    private func flush() async {
        guard !flushing, let baseURL else { return }
        flushing = true
        defer { flushing = false }

        let endpoint = baseURL
            .appendingPathComponent("api", isDirectory: true)
            .appendingPathComponent("client", isDirectory: true)
            .appendingPathComponent("trace", isDirectory: false)

        while let first = pending.first {
            guard let body = try? JSONEncoder().encode(first) else {
                pending.removeFirst()
                persist()
                continue
            }

            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.timeoutInterval = 4
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body

            do {
                let (_, response) = try await URLSession.shared.data(for: request)
                guard
                    let http = response as? HTTPURLResponse,
                    (200..<300).contains(http.statusCode)
                else {
                    return
                }
                guard pending.first?.id == first.id else { continue }
                pending.removeFirst()
                persist()
            } catch {
                return
            }
        }
    }
}

struct WaxloomTelemetryLifecycleModifier: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    let baseURL: URL?

    func body(content: Content) -> some View {
        content
            .task(id: baseURL?.absoluteString ?? "none") {
                await WaxloomClientTelemetry.shared.configure(baseURL: baseURL)
                await WaxloomClientTelemetry.shared.emit(
                    component: "app",
                    event: "telemetry_attached",
                    detail: "thermal=\(Self.thermalState())"
                )
            }
            .onChange(of: scenePhase) { _, phase in
                Task {
                    await WaxloomClientTelemetry.shared.emit(
                        component: "app",
                        event: "scene_phase",
                        detail: Self.sceneName(phase)
                    )
                }
            }
            .onReceive(
                NotificationCenter.default.publisher(
                    for: ProcessInfo.thermalStateDidChangeNotification
                )
            ) { _ in
                Task {
                    await WaxloomClientTelemetry.shared.emit(
                        component: "app",
                        event: "thermal_state",
                        detail: Self.thermalState()
                    )
                }
            }
            .onReceive(
                NotificationCenter.default.publisher(
                    for: UIApplication.didReceiveMemoryWarningNotification
                )
            ) { _ in
                Task {
                    await WaxloomClientTelemetry.shared.emit(
                        component: "app",
                        event: "memory_warning"
                    )
                }
            }
    }

    private static func sceneName(_ phase: ScenePhase) -> String {
        switch phase {
        case .active: return "active"
        case .inactive: return "inactive"
        case .background: return "background"
        @unknown default: return "unknown"
        }
    }

    private static func thermalState() -> String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }
}
