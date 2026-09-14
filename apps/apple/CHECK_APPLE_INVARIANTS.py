#!/usr/bin/env python3
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent
errors: list[str] = []


def read(relative: str) -> str:
    path = root / relative
    if not path.is_file():
        errors.append(f"missing required file: {relative}")
        return ""
    return path.read_text(encoding="utf-8")


iphone_project = read("iphone/project.yml")
watch_project = read("watch/project.yml")
shared_wire = read("Shared/WatchWire.swift")
catalog_wire = read("Shared/WatchCatalogWire.swift")
phone_bridge = read("iphone/Sources/WatchBridge.swift")
watch_remote = read("watch/Sources/WatchRemoteModel.swift")
watch_views = read("watch/Sources/WatchProductViews.swift")
watch_discovery = read("watch/Sources/WatchDiscoveryV2.swift")
connection = read("iphone/Sources/ConnectionModel.swift")
api_client = read("iphone/Sources/WaxloomAPI.swift")
player = read("iphone/Sources/NativePlayer.swift")
product_views = read("iphone/Sources/ProductViews.swift")
catalog_service = read("iphone/Sources/WatchCatalogService.swift")
workflow = (root.parent.parent / ".github/workflows/apple-native.yml").read_text(encoding="utf-8")


def require(text: str, token: str, label: str) -> None:
    if token not in text:
        errors.append(f"{label}: missing {token!r}")


def forbid(text: str, token: str, label: str) -> None:
    if token in text:
        errors.append(f"{label}: forbidden {token!r}")


# Product identity / Apple capabilities.
require(iphone_project, "PRODUCT_BUNDLE_IDENTIFIER: com.rzbck.waxloom", "iPhone bundle id")
require(watch_project, "PRODUCT_BUNDLE_IDENTIFIER: com.rzbck.waxloom.watchkitapp", "Watch bundle id")
require(watch_project, "WKCompanionAppBundleIdentifier: com.rzbck.waxloom", "Watch companion relationship")
require(watch_project, "WKRunsIndependentlyOfCompanionApp: false", "Watch must remain companion")
require(iphone_project, "UIBackgroundModes:", "Background audio declaration")
require(iphone_project, "- audio", "Background audio mode")

for text, label in [
    (iphone_project, "iPhone project"),
    (watch_project, "Watch project"),
    (connection, "native connection layer"),
    (api_client, "native API client"),
]:
    forbid(text, "NSAllowsArbitraryLoads", f"{label} ATS")
    forbid(text, "NSExceptionAllowsInsecureHTTPLoads", f"{label} ATS")
    forbid(text, "http://", f"{label} cleartext URL")

require(connection, 'components.scheme?.lowercased() == "https"', "HTTPS-only endpoint")
require(connection, "private var connectionCheckInFlight = false", "Single-flight server connection state")
require(connection, "if connectionCheckInFlight { return }", "Duplicate connection suppression")
require(connection, "URLSessionConfiguration.ephemeral", "Private health-check session")
require(connection, ".reloadIgnoringLocalAndRemoteCacheData", "Health check bypasses stale caches")
require(connection, "configuration.waitsForConnectivity = true", "Health check waits for Tailscale connectivity")

# Playback authority / Watch -> iPhone background-wake protocol.
require(shared_wire, 'static let commandTTL: TimeInterval = 8', "Watch command expiry")
require(shared_wire, "sessionID: String", "Watch session identity")
require(shared_wire, "revision: Int64", "Watch authority revision")
require(shared_wire, "seekBackward15", "Watch seek backward")
require(shared_wire, "seekForward15", "Watch seek forward")
require(phone_bridge, "recentAcknowledgements", "Exact command acknowledgement replay")
require(phone_bridge, "acknowledgement(for: playbackMessage)", "Inline playback acknowledgement")
require(phone_bridge, "replyHandler(payload)", "Playback acknowledgement uses original request reply")
forbid(phone_bridge, "message.sessionID != currentSnapshot.sessionID", "Watch controls must not be dropped on session snapshot lag")
forbid(phone_bridge, "message.revision != currentSnapshot.revision", "Watch controls must not be dropped on revision lag")
require(watch_remote, "UUID().uuidString", "Unique Watch control token")
require(watch_remote, "pendingToken == nil", "No queued overlapping Watch commands")
require(watch_remote, "WCSession.default.sendMessage(payload) { [weak self] reply in", "Watch command direct request/reply")
forbid(watch_remote, "WCSession.default.isReachable", "Watch must not preflight isReachable before background wake")
require(watch_remote, 'discoveryCacheKey = "waxloom.watch.discovery.cache.v1"', "Watch Discovery offline cache")
require(watch_remote, "cachedDiscovery(token:", "Watch Discovery cache fallback")

# Full Watch product requests remain request/reply. A Watch-originated live
# message is allowed to wake the iOS companion; do not gate it on isReachable.
require(catalog_wire, 'payloadType = "waxloom_catalog_wire_v1"', "Watch catalog protocol")
require(catalog_wire, "requestTTL: TimeInterval = 20", "Watch catalog request expiry")
for action in (
    "load", "play", "seek", "toggleStar", "discoveryFeedback", "badSource", "refreshDiscovery",
    "createPlaylist", "deletePlaylist", "addToPlaylist", "removeFromPlaylist",
    "youtubeSearch", "youtubeImport",
):
    require(catalog_wire, f"case {action}", f"Watch catalog action {action}")

require(phone_bridge, "didReceiveMessage message: [String: Any],", "Watch catalog reply channel")
require(phone_bridge, "WatchCatalogCodec.request", "Watch catalog request decode")
require(watch_remote, "sendMessage(payload)", "Immediate Watch catalog transport")
for forbidden_transport in ("transferUserInfo", "transferFile"):
    forbid(watch_remote, forbidden_transport, "Watch mutation transport")

# Full Watch navigation/product surface.
for route in (".albums", ".artists", ".favorites", ".playlists", ".discovery", ".search", ".imports"):
    require(watch_views, route, f"Watch route {route}")
for feature in (
    "WatchPlaylistDetailView", "WatchNewPlaylistView", "WatchSearchView",
    "WatchImportsView", "WatchImportCandidateView", "WatchItemActionsView",
):
    require(watch_views, feature, f"Watch feature {feature}")
require(watch_views, "remote.rejectBadSource", "Watch bad-source action")
require(watch_views, "remote.discoveryFeedback", "Watch Discovery feedback")
require(watch_views, "remote.youtubeImport", "Watch authorized import")
require(
    watch_views,
    "WatchDiscoveryDashboard",
    "Watch dedicated Discovery dashboard",
)
require(
    watch_views,
    '@AppStorage("waxloom.authorizedMediaImports.v1")',
    "Watch persistent import authorization",
)
require(
    watch_views,
    "beginQuickImport(item)",
    "Watch Discovery one-tap import",
)
require(
    watch_views,
    "sources.items.max",
    "Watch automatic best-source selection",
)
require(
    watch_views,
    "guard (best.score ?? 0) >= 80 else",
    "Watch ambiguous-source fallback threshold",
)
require(
    watch_views,
    "manualImportItem = item",
    "Watch manual-source fallback",
)
require(
    watch_views,
    "items.removeAll {",
    "Watch imported Discovery candidate immediate removal",
)

# iPhone product surface and media semantics.
for feature in (
    "ProductAlbumsView", "ProductArtistsView", "ProductPlaylistsView", "ProductFavoritesView",
    "ProductSearchView", "ProductDiscoveryView", "ProductImportsView", "ProductNowPlayingView",
):
    require(product_views, feature, f"iPhone feature {feature}")

# Cross-device behavioral parity. These checks deliberately compare semantics,
# not pixel layout: starting the same content from iPhone or Watch must create
# the same kind of queue and expose the same mutation/control capabilities.
require(catalog_wire, "var items: [WatchCatalogItem]?", "Watch playback queue transport")
require(watch_remote, "private var playbackQueuesByItemID", "Watch remembers loaded playback queues")
require(watch_remote, "rememberPlaybackQueues(response.items)", "Watch records list queues after load")
require(watch_remote, "items: queue", "Watch sends playback queue with Play")
if catalog_service.count("let requestedQueue = (request.items ?? [])") < 2:
    errors.append("iPhone/Watch playback parity: song and Discovery gateway paths must both consume Watch queues")
require(catalog_service, "player.play(song: song, queue: queue, baseURL: baseURL)", "Watch library playback preserves iPhone queue semantics")
require(catalog_service, "player.playPreview(candidate: candidate, queue: queue, baseURL: baseURL)", "Watch Discovery playback preserves iPhone queue semantics")
require(product_views, "ProductSongRow(connection: connection, player: player, song: song, queue: songs)", "iPhone list playback carries the visible song queue")
require(product_views, "player.playPreview(candidate: candidate, queue: queue, baseURL: base)", "iPhone Discovery playback carries its lane queue")
require(watch_discovery, "queue: shelfItems", "Watch Discovery detail receives its shelf queue")
require(watch_discovery, "remote.playDiscovery(item, queue: queue)", "Watch Discovery Play sends its shelf queue")

# Physical Watch Discovery Next/Previous must not rely solely on the queue sent
# over WCSession. The iPhone rebuilds the active shelf from the authoritative
# current feed, so a truncated/single-item transport cannot make Next loop the
# same preview forever.
require(
    catalog_service,
    "let authoritativeDiscoveryItems = discoveryItems(feed.external.items)",
    "Watch Discovery authoritative queue rebuild",
)
require(
    catalog_service,
    "let authoritativeShelf = authoritativeDiscoveryItems.filter",
    "Watch Discovery authoritative shelf selection",
)
require(
    catalog_service,
    "if authoritativeShelf.contains(where: { $0.id == item.id })",
    "Watch Discovery authoritative shelf preferred over transported queue",
)
require(
    catalog_service,
    "queueItems = authoritativeShelf",
    "Watch Discovery Next/Previous uses rebuilt shelf queue",
)

# Precise seek parity: the iPhone slider and Watch slider must both reach the
# native player's arbitrary seek(to:) path, while +/-15 remains available.
require(catalog_wire, "var position: Double?", "Watch precise seek payload")
require(watch_remote, "func seek(to position: Double)", "Watch precise seek transport")
require(watch_views, "Slider(", "Watch precise seek UI")
require(watch_views, "remote.seek(to: target)", "Watch precise seek action")
require(catalog_service, "case .seek:", "Watch gateway precise seek")
require(catalog_service, "player.seek(to: max(0, position))", "Watch precise seek reaches native player")
require(product_views, "Slider(", "iPhone precise seek UI")
require(product_views, "player.seek(to: $0)", "iPhone precise seek action")

# Discovery refresh is a product action, not an iPhone-only convenience.
require(product_views, "WaxloomAPI.refreshDiscoveryFeed", "iPhone Discovery refresh")
require(catalog_service, "case .refreshDiscovery:", "Watch gateway Discovery refresh")
require(watch_remote, "func refreshDiscovery()", "Watch Discovery refresh transport")
require(watch_discovery, "remote.refreshDiscovery()", "Watch Discovery refresh UI")

# Player controls exposed by iPhone must remain remotely equivalent on Watch.
for control in ("playPause", "next", "previous", "seekBackward15", "seekForward15"):
    require(shared_wire, control, f"Cross-device player control {control}")
require(watch_views, "remote.send(.next)", "Watch next-track control")
require(watch_views, "remote.send(.previous)", "Watch previous-track control")
require(watch_views, "remote.send(.seekBackward15)", "Watch seek-back control")
require(watch_views, "remote.send(.seekForward15)", "Watch seek-forward control")
require(player, "case .next:", "iPhone player accepts Watch next")
require(player, "case .previous:", "iPhone player accepts Watch previous")
require(player, "case .seekBackward15:", "iPhone player accepts Watch seek back")
require(player, "case .seekForward15:", "iPhone player accepts Watch seek forward")

# Mutating product actions present on iPhone must have Watch equivalents.
parity_pairs = (
    ("WaxloomAPI.setStarred", "remote.toggleStar", "favorite toggle"),
    ("WaxloomAPI.createPlaylist", "remote.createPlaylist", "playlist create"),
    ("WaxloomAPI.deletePlaylist", "remote.deletePlaylist", "playlist delete"),
    ("songIDsToAdd", "remote.addToPlaylist", "playlist add track"),
    ("songIndexesToRemove", "remote.removeFromPlaylist", "playlist remove track"),
    ("WaxloomAPI.search", "route: .search", "library search"),
    ("WaxloomAPI.discoveryFeedback", "remote.discoveryFeedback", "Discovery feedback"),
    ("WaxloomAPI.refreshDiscoveryFeed", "remote.refreshDiscovery", "Discovery feed refresh"),
    ("WaxloomAPI.youtubeSearch", "remote.youtubeSearch", "authorized source search"),
    ("WaxloomAPI.youtubeImport", "remote.youtubeImport", "authorized media import"),
)
for iphone_token, watch_token, label in parity_pairs:
    require(product_views, iphone_token, f"iPhone {label}")
    require(watch_views + "\n" + watch_discovery, watch_token, f"Watch {label}")

# Watch mutation refresh contract. List/detail views must reload after writes,
# and album/artist favorite UI must use the updated local state rather than the
# immutable navigation seed.
require(watch_remote, "@Published private(set) var catalogRevision", "Watch catalog mutation revision")
require(watch_remote, "registerMutation(", "Watch successful mutations bump revision")
if watch_views.count(".task(id: remote.catalogRevision)") < 4:
    errors.append("Watch mutation refresh: expected catalogRevision-driven reloads for catalog, playlist, picker and search")
require(watch_views, "@State private var containerStarred: Bool", "Watch album/artist favorite local state")
require(watch_views, "requestItem.starred = containerStarred", "Watch album/artist toggle uses current state")
require(watch_views, "containerStarred = updated.starred", "Watch album/artist favorite state refresh")

# Automatic API parity gate. Any new server-backed product behavior wired into
# the iPhone UI must also be represented in the Watch gateway, unless it is a
# presentation-only helper explicitly listed here. This turns future iPhone API
# additions into a CI failure instead of a silent Watch feature gap.
iphone_product_api_calls = set(re.findall(r"WaxloomAPI\.([A-Za-z0-9_]+)", product_views))
watch_gateway_api_calls = set(re.findall(r"WaxloomAPI\.([A-Za-z0-9_]+)", catalog_service))
presentation_only_api_calls = {"coverURL"}
missing_watch_api_parity = sorted(
    iphone_product_api_calls
    - watch_gateway_api_calls
    - presentation_only_api_calls
)
if missing_watch_api_parity:
    errors.append(
        "iPhone/Watch API parity missing in WatchCatalogService: "
        + ", ".join(missing_watch_api_parity)
    )

# Discovery feedback/source rejection must be reversible on BOTH devices.
require(
    product_views,
    "candidate.feedback == -1 ? 0 : -1",
    "iPhone Less toggle semantics",
)
require(
    product_views,
    "@State private var rejectedSourceMbids: Set<String> = []",
    "iPhone bad-source reversible state",
)
require(
    product_views,
    "let nextRejected = !rejected",
    "iPhone bad-source toggle semantics",
)
require(
    product_views,
    "value: nextRejected ? 1 : 0",
    "iPhone bad-source reject/undo transport",
)
require(
    product_views,
    "candidates[index].feedback = value",
    "iPhone feedback keeps candidate available for undo",
)
forbid(
    product_views,
    "if value < 0 { candidates.remove(at: index) }",
    "iPhone Less must remain undoable",
)
forbid(
    product_views,
    "private func rejectBadSource(",
    "iPhone bad-source action must be a toggle",
)
require(watch_discovery, "let nextValue = currentFeedback == target ? 0 : target", "Watch Like/Less toggle semantics")
require(watch_discovery, "let next = !sourceRejected", "Watch bad-source undo state")
require(watch_discovery, "remote.setBadSource(item, rejected: next)", "Watch bad-source reversible action")

# Discovery import UX: automatic match/import first, manual picker only
# when the automatic source score is genuinely ambiguous.
require(
    product_views,
    '@AppStorage("waxloom.authorizedMediaImports.v1")',
    "Persistent authorized-import acknowledgement",
)
if product_views.count(
    '@AppStorage("waxloom.authorizedMediaImports.v1")'
) < 2:
    errors.append(
        "iPhone direct import: authorization must be shared by Discovery and manual Imports"
    )
require(
    product_views,
    "beginQuickImport(candidate)",
    "Discovery one-tap import action",
)
require(
    product_views,
    "limit: 1",
    "Discovery automatic best-source lookup",
)
require(
    product_views,
    "if best.score < 80",
    "Discovery ambiguous-source fallback threshold",
)
require(
    product_views,
    "manualImportCandidate = candidate",
    "Discovery manual-source fallback",
)
require(
    product_views,
    "sourceURL: best.url",
    "Discovery direct import selected source",
)
require(
    product_views,
    "candidates.removeAll {",
    "Imported Discovery candidate immediate removal",
)
require(player, "restoreQueue", "Native queue restore")
require(player, "savePlayQueue", "Native queue persistence")
require(player, "MPNowPlayingInfoCenter", "System Now Playing")
require(player, "MPRemoteCommandCenter", "System remote commands")
require(player, "changePlaybackPositionCommand", "System seek")
require(player, "currentPreview?.recordingMbid == candidate.recordingMbid", "Same preview pause/resume")
require(player, '.appendingPathComponent("discovery", isDirectory: true)', "Discovery preview local cache route")
require(player, '.appendingPathComponent("previews", isDirectory: true)', "Discovery preview cache media endpoint")
require(player, "let item = AVPlayerItem(url: url)", "Discovery preview direct cached media item")
require(player, "player.playImmediately(atRate: 1.0)", "Discovery preview immediate start")
require(player, 'tracePreview("preview_play_called"', "Discovery preview native playback trace")
require(player, "previewLoadGeneration", "Discovery preview stale-load rejection")
forbid(player, "WaxloomAPI.youtubePreview(", "Discovery preview click-time source resolution")
forbid(player, "await player.seek(to: .zero)", "Blocking Discovery seek before playback")
forbid(player, "asset.load(.isPlayable)", "Blocking Discovery isPlayable preload")
forbid(player, "asset.load(.duration)", "Blocking Discovery duration preload")

# Playback UI must never cover the bottom tab navigation.
mini_player_insets = product_views.count(".productMiniPlayerInset(connection: connection, player: player)")
if mini_player_insets < 5:
    errors.append(f"iPhone playback navigation: expected mini-player inset on 5 tabs, found {mini_player_insets}")
require(product_views, ".toolbarBackground(.visible, for: .tabBar)", "Visible iPhone tab bar during playback")
forbid(
    product_views,
    '.tint(ProductTheme.accent)\n        .safeAreaInset(edge: .bottom',
    "Root TabView mini-player overlay",
)

# Bad source must stay separate from musical Less on both iPhone and Watch gateway.
# The backend deliberately interprets sourceRejectTag + -1 as a source-rejection row,
# outside the musical taste table; tagged 0 removes a rejection.
require(product_views, "badSource: true", "iPhone bad-source marker")
require(catalog_service, "badSource: true", "Watch bad-source marker")
require(api_client, 'sourceRejectTag = "__waxloom_source:not_music__"', "Bad-source persistence tag")
require(api_client, "let feedbackValue = badSource ? -1 : value", "Bad-source negative is source-only")
require(
    api_client,
    "let persistedValue = badSource && value == 0 ? 0 : feedbackValue",
    "Bad-source rejection can be undone",
)
require(api_client, "value: persistedValue", "Bad-source encoded feedback value")

# Deliberate platform exception: server endpoint editing/connection setup stays
# iPhone-only because watchOS is a companion and never owns provider/server
# credentials. This is architecture, not a product-parity gap.
require(watch_project, "WKRunsIndependentlyOfCompanionApp: false", "Server-settings parity exception requires companion architecture")

# Full server API adapters stay centralized in the iPhone client.
for function in (
    "static func artists", "static func search", "static func playlists", "static func playlist",
    "static func createPlaylist", "static func updatePlaylist", "static func deletePlaylist",
    "static func playQueue", "static func discoveryFeed", "static func youtubeSearch",
    "static func youtubeImport", "static func setStarred",
):
    require(api_client, function, f"Native API {function}")

# CI artifact contract.
require(workflow, "runs-on: macos-26", "Pinned macOS/Xcode builder family")
require(workflow, "CODE_SIGNING_ALLOWED=NO", "Unsigned CI build")
require(workflow, "watch_companion_integrated_in_ipa", "Companion artifact metadata")
require(workflow, "shasum -a 256", "Artifact SHA-256")
require(workflow, "github.sha", "Exact SHA artifact identity")

uses = [
    line.strip().split("uses:", 1)[1].strip()
    for line in workflow.splitlines()
    if line.strip().startswith("uses:")
]
for value in uses:
    if not re.search(r"@[0-9a-f]{40}(?:\s|$)", value):
        errors.append(f"workflow action is not pinned to a 40-char commit SHA: {value}")

forbidden_suffixes = {".ipa", ".mobileprovision", ".p12", ".p8", ".cer", ".key", ".pem", ".xcarchive"}
for path in root.rglob("*"):
    if path.is_file() and path.suffix.lower() in forbidden_suffixes:
        errors.append(f"signing/build artifact must not be tracked under apps/apple: {path.relative_to(root)}")

text_blob = "\n".join(
    path.read_text(encoding="utf-8", errors="ignore")
    for path in root.rglob("*")
    if path.is_file()
    and path.name != "CHECK_APPLE_INVARIANTS.py"
    and path.suffix.lower() in {".swift", ".yml", ".yaml", ".py", ".ps1", ".plist", ".md"}
)
private_key_markers = [
    "-----BEGIN " + prefix + "PRIVATE KEY-----"
    for prefix in ("", "RSA ", "EC ")
]
for marker in private_key_markers:
    if marker in text_blob:
        errors.append(f"private key marker found in apps/apple: {marker}")

if errors:
    print("APPLE NATIVE INVARIANTS: BLOCKED", file=sys.stderr)
    for error in errors:
        print(f" - {error}", file=sys.stderr)
    raise SystemExit(1)

print("APPLE NATIVE INVARIANTS: PASS")
