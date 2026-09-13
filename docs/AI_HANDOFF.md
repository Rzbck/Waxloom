# Waxloom — current AI handoff

Date: 2026-09-13

## Repository state

- Repository: `Rzbck/Waxloom` (public).
- Published `main`: `e44183afe9b82c23f6fe77943faec1a1fb7773b0`.
- Current chantier: `feat/iphone-app-20260913`.
- Branch point: published `main` `e44183afe9b82c23f6fe77943faec1a1fb7773b0`.
- Dedicated Windows worktree: `E:\_Project\_WAXLOOM_WORKTREES\iphone-app-20260913`.
- PR #10 remains draft/open. No promotion to `main` is authorized by this handoff.

## USER VALIDATED baseline carried into native work

The owner validated these Discovery semantics on the published web product and they remain mandatory native behavior:

- direct YouTube Dig bad-source `X` is separate from musical `Less` feedback;
- bad-source removes the candidate and persists source rejection without incrementing musical dislike;
- switching preview A -> B starts B at `0:00`;
- tapping the active preview toggles pause/resume and resumes from its paused position;
- next/previous/new preview starts at `0:00`;
- Discovery preview playback remains separate from the persisted Navidrome queue.

## Native iPhone + Apple Watch implementation

Canonical architecture: `docs/IOS_NATIVE_ARCHITECTURE.md`.

The native tranche now implements a real SwiftUI product rather than a web wrapper or player-only prototype.

### iPhone product surface

- Home / server and Watch state;
- Albums + album details + favorites;
- Artists + artist details + favorites;
- Playlists list/create/delete/detail/add/remove tracks;
- Favorites across songs/albums/artists;
- Search across songs/albums/artists;
- Discovery feed, preview playback, Like, Less, bad-source rejection, refresh and import entry;
- authorized YouTube source search/import through the Waxloom server;
- native AVPlayer library playback and transient Discovery previews;
- full Now Playing with seek, +/-15 seconds, previous/play-pause/next, current-track favorite and queue;
- background audio + MPNowPlayingInfoCenter + MPRemoteCommandCenter;
- server queue restore/persistence and library-only scrobble behavior;
- private HTTPS endpoint configuration with reconnect on launch.

### Apple Watch product surface

The Watch is no longer only a transport remote. It uses the iPhone as the authenticated/private Waxloom API gateway and provides:

- compact horizontal page navigation inspired by the already-proven sports app UI;
- Now Playing progress, previous/play-pause/next and +/-15 second controls;
- Albums / Artists / Favorites / Playlists / Discovery browsing;
- Search from the Watch;
- album/artist/playlist drill-down;
- launch song or Discovery preview on the iPhone player from the Watch;
- song/album/artist favorite actions;
- playlist create/delete/add/remove operations;
- Discovery Like/Less and separate bad-source rejection;
- authorized YouTube source search/import;
- connection/status/build page.

Catalog mutations and browse actions use immediate `WatchConnectivity.sendMessage` request/reply. They are not queued for delayed execution. Player controls keep exact token + session + revision + TTL validation and acknowledgements.

## Tailscale / native network security

Current physical-test endpoint is configured locally by the owner through Tailscale Serve HTTPS. No private endpoint, `.env`, provider credential, Tailscale auth key, signing secret, Apple certificate/profile or device pairing material is committed.

Native security direction remains:

- tailnet-only; never Funnel for Waxloom;
- HTTPS / MagicDNS / Tailscale Serve;
- provider credentials remain server-side;
- Watch uses iPhone as gateway rather than receiving provider credentials;
- CI remains unsigned; signing/install stays local through iLoader.

## Build / sideload contract

- XcodeGen source of truth;
- GitHub Actions `macos-26` / Xcode native build;
- iOS 17 + watchOS 10;
- iPhone bundle `com.rzbck.waxloom`;
- Watch bundle `com.rzbck.waxloom.watchkitapp`;
- companion embedded in `Payload/Waxloom.app/Watch/...`;
- exact commit SHA stamped into the product and artifact metadata;
- unsigned IPA + SHA-256 artifact;
- local exact-SHA retrieval via `apps/apple/UPDATE_APPLE_NATIVE.ps1`;
- local signing/install with the existing iLoader flow;
- physical hardware validation is separate from CI success.

## Validation vocabulary / current state

- Native complete product tranche: `IMPLEMENTED / NOT USER VALIDATED` until the final exact-SHA IPA is installed on the real iPhone + Watch.
- GitHub compile/package/security results must be recorded only against the final exact branch HEAD after the product-invariant gate update.
- Earlier successful candidate SHAs are not substitutes for the final exact-head hardware test.

## NEXT TEST

On the final exact-SHA artifact:

1. install iPhone + embedded Watch companion through iLoader;
2. confirm saved private HTTPS endpoint reconnects;
3. validate Albums, Artists, Favorites, Playlists, Search, Discovery and Imports on iPhone;
4. validate AVPlayer playback, seek, queue restore/persist, background/system controls and validated Discovery preview semantics;
5. open Watch and validate compact horizontal navigation;
6. from Watch validate browse/search, play, favorites, playlist CRUD/add/remove, Discovery feedback/bad-source, imports and transport controls;
7. confirm stale/offline Watch actions fail instead of executing later.

Only after this physical test can the exact candidate be labeled `USER VALIDATED`.

## Rollback / checkpoints

- Published baseline / native branch point: `e44183afe9b82c23f6fe77943faec1a1fb7773b0`.
- Previously USER VALIDATED Discovery runtime candidate: `a2cec448319178144b457e98081e572d1c985a29`.
- Published rollback uses revert/new commit only; never rewrite shared history.
