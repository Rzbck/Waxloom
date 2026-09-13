# Waxloom — current AI handoff

Date: 2026-09-13

## Repository state

- Repository: `Rzbck/Waxloom` (public).
- Published `main`: `e44183afe9b82c23f6fe77943faec1a1fb7773b0`.
- PR #9 / validated Discovery stack was promoted to `main` after owner authorization.
- Post-merge GitHub `Public repository security gate` = PASS.
- Post-merge GitHub `Windows build gate` = PASS.
- Current chantier: `feat/iphone-app-20260913`.
- Branch point: published `main` `e44183afe9b82c23f6fe77943faec1a1fb7773b0`.
- Dedicated Windows worktree created by owner: `E:\_Project\_WAXLOOM_WORKTREES\iphone-app-20260913`.
- At chantier creation the worktree was CLEAN at `e44183a`.

## USER VALIDATED baseline carried into native work

The owner validated the Discovery source-quality + preview-control behavior before promotion:

- YouTube Dig bad-source `X` is aligned with Play/Add/Like/Less and remains separate from musical `Less` feedback;
- switching Discovery preview A -> B starts B at `0:00`;
- the active Discovery track toggles Play/Pause;
- resume continues from the paused position;
- newly selected preview tracks start at `0:00`;
- Discovery preview playback remains separate from the persisted Navidrome queue.

These semantics must be preserved by the native iPhone player.

## Native iPhone + Apple Watch chantier

The owner wants a real native Waxloom iPhone app plus companion Watch app, not a WKWebView wrapper.

Architecture/process audit completed against `Rzbck/ios-godot-lab`, including its iPhone Lab V2 build/sideload workflow and the current native `apps/watch-sensor-lab` iPhone/Watch implementation.

Canonical native design document:

`docs/IOS_NATIVE_ARCHITECTURE.md`

Key decisions:

- pure SwiftUI iPhone + watchOS client; no Godot runtime in Waxloom;
- reuse Waxloom's existing HTTP API instead of duplicating Navidrome/AudioMuse/ListenBrainz/YouTube provider logic in Swift;
- iPhone native player is the single live native-playback authority;
- Watch is a presentation/control companion and communicates with iPhone through WatchConnectivity;
- Watch player commands use exact UUID tokens + base revision/session checks + explicit acknowledgements; stale/delayed Play/Pause/Next commands must never execute later;
- state uses `updateApplicationContext`; immediate controls use `sendMessage`; durable/file transports are reserved for semantics that are safe to deliver later;
- native audio uses AVFoundation/MediaPlayer with background audio, Now Playing and system remote commands;
- native UI keeps Waxloom's dark/violet visual identity and product information architecture while using native SwiftUI controls;
- exact-SHA unsigned iPhone+Watch IPA artifacts are built on GitHub Actions macOS using checked-in XcodeGen specs;
- physical iPhone/Watch validation remains separate from CI build success.

## Tailscale / native network security

Current Waxloom development runtime binds API/Vite to the active Tailscale interface when available. The API currently has no dedicated native-client authentication layer.

Native direction:

- keep Waxloom private to the tailnet; never use Funnel for the app;
- prefer stable MagicDNS + HTTPS/Tailscale Serve rather than broad iOS cleartext ATS exceptions;
- use least-privilege Tailscale Grants for the Waxloom service;
- do not embed Tailscale auth keys or provider credentials in the app;
- if Tailscale Serve identity/app-capability headers are used for authorization, the backend path must not remain directly reachable in a way that permits header spoofing;
- use a non-sensitive Tailscale machine name before enabling public-CA HTTPS because the certificate FQDN is recorded in Certificate Transparency.

Any network-launcher refactor must preserve the already USER VALIDATED desktop/mobile-web path and be tested as its own runtime tranche.

## Native security invariants

- public repo: never commit `.env`, credentials, cookies, provider tokens, signing certificates, provisioning profiles, Apple passwords, Team IDs tied to private setup, device UDIDs, pairing files, private DBs, media or user library data;
- provider credentials remain server-side;
- request only minimum Apple capabilities; first native music tranche needs background audio, not HealthKit/location/motion/microphone;
- CI builds unsigned; local sideload/signing remains outside GitHub;
- exact candidate claims require exact SHA attribution;
- 1 active chantier = 1 branch = 1 dedicated worktree;
- no force-push, destructive reset, blind clean or shared-history rewrite.

## Existing API surface to reuse

The current backend already exposes the native client's core product surface:

- health/integration state;
- albums/artists/song detail/search/random library;
- Favorites/starred;
- playlists CRUD;
- persisted Navidrome queue;
- Discovery feed/status/feedback;
- YouTube preview resolution/import;
- audio stream with HTTP Range forwarding;
- cover-art proxy.

Native Codable DTOs should mirror these contracts. Avoid a second source of truth.

## NEXT TEST / implementation order

1. Add `apps/apple` native SwiftUI/XcodeGen scaffold and shared DTO/control protocol.
2. Add pinned exact-SHA macOS CI that builds unsigned iPhone + embedded Watch companion and verifies product invariants.
3. Add a fail-closed Windows exact-artifact updater modeled on the proven iOS lab workflow.
4. Implement secure Waxloom endpoint configuration and `/api/health` handshake over Tailscale.
5. Then implement native navigation/library before the audio engine and Watch controls.

Do not claim native app validation until the exact built IPA is installed and tested on the real iPhone/Watch.

## Rollback / checkpoints

- Published baseline / native branch point: `e44183afe9b82c23f6fe77943faec1a1fb7773b0`.
- Previously USER VALIDATED Discovery runtime candidate: `a2cec448319178144b457e98081e572d1c985a29`.
- Published rollback uses revert/new commit only; never rewrite shared history.
