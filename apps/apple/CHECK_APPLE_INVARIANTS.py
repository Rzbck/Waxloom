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

# Existing exact-token playback authority protocol.
require(shared_wire, 'static let commandTTL: TimeInterval = 8', "Watch command expiry")
require(shared_wire, "sessionID: String", "Watch session identity")
require(shared_wire, "revision: Int64", "Watch authority revision")
require(shared_wire, "seekBackward15", "Watch seek backward")
require(shared_wire, "seekForward15", "Watch seek forward")
require(phone_bridge, "message.sessionID != currentSnapshot.sessionID", "Phone session stale rejection")
require(phone_bridge, "message.revision != currentSnapshot.revision", "Phone revision stale rejection")
require(phone_bridge, "recentAcknowledgements", "Exact command acknowledgement replay")
require(watch_remote, "UUID().uuidString", "Unique Watch control token")
require(watch_remote, "pendingToken == nil", "No queued overlapping Watch commands")
require(watch_remote, "WCSession.default.isReachable", "Immediate-only Watch controls")

# Full Watch product requests must remain immediate request/reply, never delayed mutation transport.
require(catalog_wire, 'payloadType = "waxloom_catalog_wire_v1"', "Watch catalog protocol")
require(catalog_wire, "requestTTL: TimeInterval = 20", "Watch catalog request expiry")
for action in (
    "load", "play", "toggleStar", "discoveryFeedback", "badSource",
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

# iPhone product surface and media semantics.
for feature in (
    "ProductAlbumsView", "ProductArtistsView", "ProductPlaylistsView", "ProductFavoritesView",
    "ProductSearchView", "ProductDiscoveryView", "ProductImportsView", "ProductNowPlayingView",
):
    require(product_views, feature, f"iPhone feature {feature}")
require(player, "restoreQueue", "Native queue restore")
require(player, "savePlayQueue", "Native queue persistence")
require(player, "MPNowPlayingInfoCenter", "System Now Playing")
require(player, "MPRemoteCommandCenter", "System remote commands")
require(player, "changePlaybackPositionCommand", "System seek")
require(player, "await player.seek(to: .zero)", "Preview switch starts at zero")
require(player, "currentPreview?.recordingMbid == candidate.recordingMbid", "Same preview pause/resume")

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
require(api_client, "value: feedbackValue", "Bad-source encoded feedback value")

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
