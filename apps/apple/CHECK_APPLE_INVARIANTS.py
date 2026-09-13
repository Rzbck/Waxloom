#!/usr/bin/env python3
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent


def read(relative: str) -> str:
    path = root / relative
    if not path.is_file():
        errors.append(f"missing required file: {relative}")
        return ""
    return path.read_text(encoding="utf-8")


errors: list[str] = []

iphone_project = read("iphone/project.yml")
watch_project = read("watch/project.yml")
shared_wire = read("Shared/WatchWire.swift")
phone_bridge = read("iphone/Sources/WatchBridge.swift")
watch_remote = read("watch/Sources/WatchRemoteModel.swift")
connection = read("iphone/Sources/ConnectionModel.swift")
workflow = (root.parent.parent / ".github/workflows/apple-native.yml").read_text(encoding="utf-8")


def require(text: str, token: str, label: str) -> None:
    if token not in text:
        errors.append(f"{label}: missing {token!r}")


def forbid(text: str, token: str, label: str) -> None:
    if token in text:
        errors.append(f"{label}: forbidden {token!r}")


require(iphone_project, "PRODUCT_BUNDLE_IDENTIFIER: com.rzbck.waxloom", "iPhone bundle id")
require(watch_project, "PRODUCT_BUNDLE_IDENTIFIER: com.rzbck.waxloom.watchkitapp", "Watch bundle id")
require(watch_project, "WKCompanionAppBundleIdentifier: com.rzbck.waxloom", "Watch companion relationship")
require(watch_project, "WKRunsIndependentlyOfCompanionApp: false", "Watch must remain companion")
require(iphone_project, "UIBackgroundModes:", "Background audio declaration")
require(iphone_project, "- audio", "Background audio mode")

for text, label in [(iphone_project, "iPhone project"), (watch_project, "Watch project"), (connection, "native connection layer")]:
    forbid(text, "NSAllowsArbitraryLoads", f"{label} ATS")
    forbid(text, "NSExceptionAllowsInsecureHTTPLoads", f"{label} ATS")
    forbid(text, "http://", f"{label} cleartext URL")

require(connection, 'components.scheme?.lowercased() == "https"', "HTTPS-only endpoint")
require(shared_wire, 'static let commandTTL: TimeInterval = 8', "Watch command expiry")
require(shared_wire, "sessionID: String", "Watch session identity")
require(shared_wire, "revision: Int64", "Watch authority revision")
require(phone_bridge, "message.sessionID != currentSnapshot.sessionID", "Phone session stale rejection")
require(phone_bridge, "message.revision != currentSnapshot.revision", "Phone revision stale rejection")
require(phone_bridge, "recentAcknowledgements", "Exact command acknowledgement replay")
require(watch_remote, "UUID().uuidString", "Unique Watch control token")
require(watch_remote, "pendingToken == nil", "No queued overlapping Watch commands")
require(watch_remote, "WCSession.default.isReachable", "Immediate-only Watch controls")

require(workflow, "runs-on: macos-26", "Pinned macOS/Xcode builder family")
require(workflow, "CODE_SIGNING_ALLOWED=NO", "Unsigned CI build")
require(workflow, "watch_companion_integrated_in_ipa", "Companion artifact metadata")
require(workflow, "shasum -a 256", "Artifact SHA-256")
require(workflow, "github.sha", "Exact SHA artifact identity")

uses = [line.strip().split("uses:", 1)[1].strip() for line in workflow.splitlines() if line.strip().startswith("uses:")]
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
    if path.is_file() and path.name != "CHECK_APPLE_INVARIANTS.py" and path.suffix.lower() in {".swift", ".yml", ".yaml", ".py", ".ps1", ".plist", ".md"}
)
for marker in ["-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----"]:
    if marker in text_blob:
        errors.append(f"private key marker found in apps/apple: {marker}")

if errors:
    print("APPLE NATIVE INVARIANTS: BLOCKED", file=sys.stderr)
    for error in errors:
        print(f" - {error}", file=sys.stderr)
    raise SystemExit(1)

print("APPLE NATIVE INVARIANTS: PASS")
