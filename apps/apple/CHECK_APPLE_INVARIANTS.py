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


def require(text: str, token: str, label: str) -> None:
    if token not in text:
        errors.append(f"{label}: missing {token!r}")


def forbid(text: str, token: str, label: str) -> None:
    if token in text:
        errors.append(f"{label}: forbidden {token!r}")


iphone_project = read("iphone/project.yml")
watch_project = read("watch/project.yml")
shared_wire = read("Shared/WatchWire.swift")
catalog_wire = read("Shared/WatchCatalogWire.swift")
phone_bridge = read("iphone/Sources/WatchBridge.swift")
watch_remote = read("watch/Sources/WatchRemoteModel.swift")
watch_views = read("watch/Sources/WatchProductViews.swift")
connection = read("iphone/Sources/ConnectionModel.swift")
api_client = read("iphone/Sources/WaxloomAPI.swift")
player = read("iphone/Sources/NativePlayer.swift")
product_views = read("iphone/Sources/ProductViews.swift")
catalog_service = read("iphone/Sources/WatchCatalogService.swift")
workflow = (root.parent.parent / ".github/workflows/apple-native.yml").read_text(encoding="utf-8")

# Product identity / Apple capabilities.
require(iphone_project, "PRODUCT_BUNDLE_IDENTIFIER: com.rzbck.waxloom", "iPhone bundle id")
require(watch_project, "PRODUCT_BUNDLE_IDENTIFIER: com.rzbck.waxloom.watchkitapp", "Watch bundle id")
require(watch_project, "WKCompanionAppBundleIdentifier: com.rzbck.waxloom", "Watch companion relationship")
require(watch_project, "WKRunsIndependentlyOfCompanionApp: false", "Watch companion packaging")
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
require(connection, "private struct ConnectionFlight", "Shared connection flight")
require(connection, "await active.task.value", "Concurrent callers await active connection")
require(connection, "connectionFlight?.id == flightID", "Old waiter cannot clear newer connection")
require(connection, "guard isCurrentEndpoint(endpoint) else { return }", "Stale endpoint result rejection")
require(connection, "URLSessionConfiguration.ephemeral", "Private health-check session")
require(connection, ".reloadIgnoringLocalAndRemoteCacheData", "Health check bypasses stale caches")
require(connection, "configuration.waitsForConnectivity = true", "Health check waits for connectivity")
forbid(connection, "connectionCheckInFlight", "Return-instead-of-await connection anti-pattern")

# Playback authority: state and commands have intentionally different transports.
require(shared_wire, 'static let commandTTL: TimeInterval = 2', "Immediate Watch command expiry")
require(shared_wire, "sessionID: String", "Watch session identity")
require(shared_wire, "revision: Int64", "Watch authority revision")
require(shared_wire, "seekBackward15", "Watch seek backward")
require(shared_wire, "seekForward15", "Watch seek forward")

# Latest playback state is delivered only as application context. Do not duplicate
# the same state through live sendMessage, which creates cross-channel reordering.
require(phone_bridge, "updateApplicationContext(payload)", "Latest-state Watch synchronization")
forbid(phone_bridge, "recentAcknowledgements", "Legacy separate acknowledgement cache")
forbid(phone_bridge, "sendAcknowledgement", "Legacy second acknowledgement message")
require(watch_remote, "didReceiveApplicationContext", "Watch receives latest playback state")
require(watch_remote, "lastSnapshotTimestamp", "Cross-track stale snapshot ordering")
require(watch_remote, "timestamp < lastSnapshotTimestamp", "Old snapshot rejection")

# Immediate controls use one request and its correlated reply.
require(phone_bridge, "handlePlaybackCommand", "Phone correlated playback command handler")
require(phone_bridge, "replyHandler(WaxloomWatchCodec.payload(acknowledgement)", "Playback acknowledgement reply")
require(phone_bridge, "waitForSnapshotAdvance", "Next/previous waits for resulting snapshot")
require(watch_remote, "WCSession.default.sendMessage(payload) { [weak self] reply in", "Watch correlated command request")
require(watch_remote, "commandReplyTimeout", "Bounded live command UI lock")
require(watch_remote, "pendingToken == nil", "No overlapping immediate playback commands")
require(watch_remote, "WCSession.default.isReachable", "Immediate playback controls require live peer")
forbid(watch_remote, "DispatchQueue.main.asyncAfter(deadline: .now() + WaxloomWatchCodec.commandTTL", "Eight-second UI command lock")

# Catalog stays an iPhone gateway until direct Watch -> private Tailscale HTTPS is
# physically proven. Reads remain useful from a bounded local latest-value cache.
require(catalog_wire, 'payloadType = "waxloom_catalog_wire_v1"', "Watch catalog protocol")
require(catalog_wire, "requestTTL: TimeInterval = 20", "Watch catalog request expiry")
for action in (
    "load", "play", "toggleStar", "discoveryFeedback", "badSource",
    "createPlaylist", "deletePlaylist", "addToPlaylist", "removeFromPlaylist",
    "youtubeSearch", "youtubeImport",
):
    require(catalog_wire, f"case {action}", f"Watch catalog action {action}")

require(phone_bridge, "WatchCatalogCodec.request", "Watch catalog request decode")
require(watch_remote, "sendMessage(payload)", "Immediate Watch catalog gateway")
require(watch_remote, "catalogRequestCount", "Overlapping catalog busy accounting")
require(watch_remote, "cachedCatalogResponse", "Offline Watch catalog read cache")
require(watch_remote, "cacheCatalogResponse", "Successful Watch catalog cache write")
require(watch_remote, 'cached.status = "cached"', "Cached response is explicit")
for forbidden_transport in ("transferUserInfo", "transferFile"):
    forbid(watch_remote, forbidden_transport, "Watch mutation transport")

# Full Watch product surface remains available while the transport is refactored.
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
require(watch_views, "WatchDiscoveryDashboard", "Watch dedicated Discovery dashboard")
require(watch_views, '@AppStorage("waxloom.authorizedMediaImports.v1")', "Watch persistent import authorization")
require(watch_views, "beginQuickImport(item)", "Watch Discovery one-tap import")
require(watch_views, "sources.items.max", "Watch automatic best-source selection")
require(watch_views, "guard (best.score ?? 0) >= 80 else", "Watch ambiguous-source fallback threshold")
require(watch_views, "manualImportItem = item", "Watch manual-source fallback")
require(watch_views, "items.removeAll {", "Watch imported Discovery immediate removal")

# iPhone product surface and media semantics.
for feature in (
    "ProductAlbumsView", "ProductArtistsView", "ProductPlaylistsView", "ProductFavoritesView",
    "ProductSearchView", "ProductDiscoveryView", "ProductImportsView", "ProductNowPlayingView",
):
    require(product_views, feature, f"iPhone feature {feature}")

require(product_views, '@AppStorage("waxloom.authorizedMediaImports.v1")', "Persistent authorized-import acknowledgement")
if product_views.count('@AppStorage("waxloom.authorizedMediaImports.v1")') < 2:
    errors.append("iPhone direct import: authorization must be shared by Discovery and manual Imports")
require(product_views, "beginQuickImport(candidate)", "Discovery one-tap import action")
require(product_views, "limit: 1", "Discovery automatic best-source lookup")
require(product_views, "if best.score < 80", "Discovery ambiguous-source fallback threshold")
require(product_views, "manualImportCandidate = candidate", "Discovery manual-source fallback")
require(product_views, "sourceURL: best.url", "Discovery direct import selected source")
require(product_views, "candidates.removeAll {", "Imported Discovery immediate removal")

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

mini_player_insets = product_views.count(".productMiniPlayerInset(connection: connection, player: player)")
if mini_player_insets < 5:
    errors.append(f"iPhone playback navigation: expected mini-player inset on 5 tabs, found {mini_player_insets}")
require(product_views, ".toolbarBackground(.visible, for: .tabBar)", "Visible iPhone tab bar during playback")
forbid(product_views, '.tint(ProductTheme.accent)\n        .safeAreaInset(edge: .bottom', "Root TabView mini-player overlay")

# Bad source remains separate from musical taste on both clients.
require(product_views, "badSource: true", "iPhone bad-source marker")
require(catalog_service, "badSource: true", "Watch bad-source marker")
require(api_client, 'sourceRejectTag = "__waxloom_source:not_music__"', "Bad-source persistence tag")
require(api_client, "let feedbackValue = badSource ? -1 : value", "Bad-source negative is source-only")
require(api_client, "value: feedbackValue", "Bad-source encoded feedback value")

# Server API adapters remain centralized in the iPhone client for this tranche.
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
