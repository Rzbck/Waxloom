# Waxloom native iPhone + Apple Watch architecture

Date: 2026-09-13

## Goal

Build a real native SwiftUI Waxloom client for iPhone plus a companion watchOS app while keeping the existing Waxloom backend as the single provider/orchestration layer.

The native clients must preserve Waxloom semantics and visual identity without embedding the web UI. Navidrome, AudioMuse, ListenBrainz, YouTube/provider credentials and local library state remain server-side.

## Audited reference implementation

The architecture/process audit used `Rzbck/ios-godot-lab`, especially the current `apps/watch-sensor-lab` work and the earlier iPhone Lab V2 workflow. Reusable lessons:

- native SwiftUI iPhone + native watchOS targets generated from checked-in XcodeGen YAML;
- Windows development with macOS/Xcode compilation on GitHub Actions;
- exact-SHA unsigned IPA artifacts with build metadata and SHA-256 verification;
- no Apple signing certificate, provisioning profile, Team ID, UDID, password or sideload credential in GitHub;
- one chantier = one branch = one dedicated worktree;
- physical iPhone/Watch validation is distinct from CI build success;
- embedded Watch app bundle invariants are checked before packaging;
- WatchConnectivity uses the correct transport for each semantic: latest state, immediate command, queued durable data or file transfer;
- stale/duplicate control commands are rejected with session/revision/token checks and explicit acknowledgements;
- build-time patching used by the lab is a temporary validation technique and must NOT become the Waxloom architecture. Waxloom ships checked-in final Swift sources.

## Product authority model

### Server

Waxloom API remains authoritative for library/provider data, persisted Navidrome queue state, Discovery feed/feedback, playlists, imports and media proxying.

### iPhone

The native iPhone player is the single live playback authority for the native product. It owns:

- AVPlayer/AVQueuePlayer state;
- current item and queue position;
- seek position and play/pause state;
- AVAudioSession;
- lock-screen / Control Center Now Playing state;
- remote command handling;
- scrobble timing;
- synchronization of current playback state to Apple Watch.

The iPhone persists the compatible Navidrome queue through the existing Waxloom API. Discovery preview playback remains transient and must not be persisted/scrobbled as a Navidrome library queue item.

### Apple Watch

The Watch is a control/presentation companion, not a second Waxloom backend and not an independent Navidrome client.

Initial Watch scope:

- current title / artist / playback state;
- play / pause;
- previous / next;
- optional Like/Less for Discovery only after the player protocol is proven;
- connectivity status.

The Watch talks to the iPhone through WatchConnectivity. It does not need provider credentials, the Waxloom server URL or direct Tailscale access for the initial architecture.

## WatchConnectivity protocol

Use a versioned Codable envelope shared by iPhone and Watch.

State snapshots:

- sent with `updateApplicationContext`;
- contain schema version, session/player revision, track identity, title, artist, duration, position, playing state and queue indices;
- newest snapshot replaces older queued state.

Interactive commands:

- sent with `sendMessage` only when reachable;
- each command carries a UUID token, player/session identifier, base revision and timestamp;
- iPhone rejects expired, duplicate, stale-revision, track/session-mismatch and state-mismatch commands;
- iPhone returns/publishes an explicit acknowledgement for the exact token;
- do not queue delayed Play/Pause/Next commands with `transferUserInfo`, because executing stale transport controls later is unsafe.

Durable non-time-critical events may use `transferUserInfo` later. Artwork may use `transferFile` later if needed.

## Existing Waxloom API surface to reuse

The web client already proves the API surface required by the native app:

- `/api/health`;
- library albums, artists, random songs, song/album/artist detail and search;
- starred state;
- playlists CRUD;
- `/api/player/queue` read/write;
- Discovery feed, status, refresh and feedback;
- YouTube preview candidate resolution and import;
- `/api/media/stream/{song_id}` with HTTP Range forwarding;
- `/api/media/cover/{cover_id}`.

Swift Codable DTOs should mirror these server contracts. Do not duplicate Navidrome/AudioMuse/ListenBrainz logic in Swift.

## Native audio

Use Apple media APIs rather than a web view:

- `AVAudioSession` category `.playback`;
- `UIBackgroundModes = audio` only;
- AVPlayer/AVQueuePlayer for Waxloom media URLs;
- `MPNowPlayingInfoCenter` for Lock Screen / Control Center metadata;
- `MPRemoteCommandCenter` for play/pause/previous/next/seek commands;
- interruption and route-change handling;
- artwork cache sized for native UI/Now Playing.

Do not request microphone, HealthKit, motion, location or unrelated background modes.

## Discovery playback parity

Native behavior must preserve the validated web rules:

- switching preview A -> B starts B at 0:00;
- clicking/tapping the active preview toggles pause/resume;
- resume continues from the paused position;
- Next/Previous start a newly selected preview at 0:00;
- Discovery previews never scrobble or persist into the Navidrome queue;
- direct preview URLs are transient and must be refreshed through Waxloom when expired.

## Network / Tailscale security

Target architecture is private tailnet access, never public Funnel exposure.

Preferred native endpoint:

- stable MagicDNS FQDN;
- HTTPS through Tailscale Serve;
- API/backend reachable only through the intended local proxy path where practical;
- tailnet Grants restricted to the minimum Waxloom service ports and intended identities/devices.

Reason: the current development API intentionally binds to the Tailscale interface, but the API has no dedicated native-client authentication layer and native iOS should not need broad cleartext ATS exceptions.

Tailscale HTTPS publishes the selected machine FQDN in Certificate Transparency, so use a non-sensitive machine name before enabling certificates.

A future hardening tranche may consume Tailscale Serve identity/app-capability headers, but only if the backend cannot be reached directly in a way that lets a caller spoof those headers.

Never embed Tailscale auth keys or provider secrets in the iOS app.

## UI direction

Keep the Waxloom identity from the web product:

- near-black base;
- restrained purple/violet glow and gradients;
- compact bordered cards;
- light primary controls;
- muted gray secondary typography;
- track-first Discovery;
- album art and artist identity remain primary visual anchors.

Implement with native SwiftUI navigation and controls, not a WKWebView.

Initial iPhone information architecture:

- Home;
- Albums;
- Artists;
- Playlists;
- Favorites;
- Discovery;
- Search;
- Imports where the native workflow is useful;
- persistent mini-player -> full Now Playing.

## Repository layout

Planned layout:

```text
apps/apple/
  Shared/
  iphone/
    project.yml
    Sources/
    Resources/
  watch/
    project.yml
    Sources/
    Resources/

scripts/ios/
  UPDATE_WAXLOOM_IOS.ps1

.github/workflows/
  apple-native.yml
```

Use bundle identifiers consistent with the proven lab convention, with a dedicated Waxloom namespace. The Watch bundle must declare the iPhone companion bundle, `WKApplication = true`, and `WKRunsIndependentlyOfCompanionApp = false` for the companion-first design.

## CI / artifact contract

The native workflow must:

1. check out exactly `github.sha` with persisted credentials disabled;
2. use a pinned macOS runner/toolchain policy and pinned GitHub Actions;
3. download a pinned XcodeGen release and verify its checksum;
4. run repository security + Apple product invariant checks before build;
5. generate Xcode projects from checked-in YAML;
6. build iPhone and Watch unsigned with signing disabled;
7. stamp the exact Git SHA into both products;
8. verify bundle IDs, companion ID, `WKApplication` and companion independence flags;
9. embed the Watch app into the iPhone app;
10. package an exact-SHA IPA;
11. generate build metadata and SHA-256;
12. upload only non-secret build artifacts.

The Windows updater script must be fail-closed: correct repo/branch, CLEAN worktree, FF-only, exact successful workflow run, exact artifact name, metadata SHA match and IPA SHA-256 match.

## Validation vocabulary

Keep Waxloom's existing labels:

- `USER VALIDATED`
- `AUTOMATED GATE PASS`
- `IMPLEMENTED / NOT USER VALIDATED`
- `BUG / LIMIT / BLOCKER`
- `EXPERIMENTAL / HYPOTHESIS`
- `NEXT TEST`

A CI-built IPA is never equivalent to real iPhone/Watch validation.

## Implementation order

1. Native scaffold + XcodeGen + exact-SHA CI + security/invariant checks.
2. Secure Waxloom/Tailscale connection screen and `/api/health` handshake.
3. Codable API client + native theme + navigation shell.
4. Library/Home/Albums/Artists/Search/Favorites/Playlists.
5. Native audio engine, queue, background playback, Now Playing and remote controls.
6. Discovery feed + preview playback parity + feedback/import semantics.
7. Watch companion shell and tokenized player-control protocol.
8. Exact-SHA iPhone + Watch sideload artifact, then physical hardware validation.
9. Polish/offline/error states and only then broader Watch features.

## Non-goals for the first native tranche

- no duplicated provider integrations in Swift;
- no public internet exposure;
- no Godot runtime in Waxloom;
- no HealthKit/location/motion permissions;
- no secrets in source, IPA metadata or CI;
- no independent Watch networking/backend credentials;
- no App Store/TestFlight dependency for the first physical prototype.
