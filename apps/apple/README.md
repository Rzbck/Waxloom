# Waxloom Apple

Native SwiftUI iPhone app with an embedded watchOS companion.

## Build model

Development can stay on Windows. GitHub Actions runs the native compile on macOS/Xcode and produces an **unsigned exact-SHA IPA** containing the Watch companion.

Local signing/install remains outside GitHub. Use the existing iLoader flow on the downloaded IPA; never commit certificates, provisioning profiles, Apple private keys or signed IPAs.

## Exact-SHA iLoader sync

From the dedicated Waxloom iPhone worktree:

```powershell
.\apps\apple\UPDATE_APPLE_NATIVE.ps1 -OpenFolder
```

The script refuses a dirty/wrong-branch worktree, fast-forwards only this branch, resolves or dispatches the exact current-HEAD macOS/Xcode build, downloads only `waxloom-apple-companion-<exact SHA>`, verifies metadata + embedded Watch + IPA SHA-256, and writes the candidate under ignored `artifacts/apple/<short SHA>/`.

CI assembly is not physical validation. A candidate becomes hardware-validated only after installing and testing that exact SHA on the real iPhone + Apple Watch.

## Network/security

The native app accepts an HTTPS Waxloom server endpoint. The intended deployment is a private Tailscale MagicDNS/Serve HTTPS name. There is no broad ATS cleartext exception, and Navidrome/AudioMuse/YouTube credentials remain on the Waxloom server.

The saved endpoint reconnects automatically on launch. Health validation is single-flight and idempotent for an already validated endpoint, so a manual `Connect securely` tap cannot race the automatic reconnect and overwrite a successful state. Health checks use an ephemeral no-cache URLSession, wait for connectivity, and retry only transient transport/HTTP failures.

## Discovery preview playback

Discovery previews use the Waxloom server's rolling temporary cache rather than resolving a fresh provider stream on every tap. The native player constructs `AVPlayerItem(url:)` directly from the byte-range capable Waxloom cache endpoint and calls `playImmediately(atRate:)` without pre-play seek, playability loading, or duration loading. Stale concurrent selections are rejected, and non-secret native stage traces (`preview_tap`, `preview_item_set`, `preview_play_called`, `preview_progress`, `preview_no_progress`, `preview_item_failed`) are sent to the existing Waxloom runtime logger for physical-device diagnosis without an Xcode console.

## Watch control contract

The iPhone is the playback authority. Watch commands are immediate-only and include a UUID token, playback session ID, authority revision and 8-second expiry. The iPhone returns explicit acknowledgements and rejects stale, expired or mismatched commands.
