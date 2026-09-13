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

The owner also USER VALIDATED the native private-network path on real hardware:

- Tailscale Serve HTTPS `/api/health` returned the expected Waxloom JSON from iPhone Safari;
- the native iPhone app has reached `/api/health`, albums, artists, playlists, queue, cover, stream and scrobble endpoints through the private HTTPS path;
- server/API/Tailscale connectivity is therefore no longer the active blocker.

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
- private HTTPS endpoint configuration with reconnect on launch;
- compact mini-player is inset inside each tab so Home/Browse/Discovery/Search/More remains visible and tappable during playback.

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

- Native HTTPS/Tailscale transport: `USER VALIDATED` on real iPhone.
- Native complete product tranche: `IMPLEMENTED / NOT USER VALIDATED` until the current exact-SHA IPA is exercised across the full iPhone + Watch surface.
- Playback navigation regression: source fix moves the mini-player into each tab's safe-area inset and keeps the tab bar explicitly visible; exact-SHA hardware validation is still required.
- Connection-state regression: server logs proved that the iPhone successfully reached and used Waxloom while Settings could still show `Waxloom did not return a valid health response`. This was an app-side concurrent health-check/state race, not a Tailscale failure. The connection model is now single-flight/idempotent for the already validated endpoint, uses an ephemeral no-cache URLSession, waits for connectivity, retries transient transport/5xx errors, and reports exact HTTP status for real failures. Exact-SHA hardware validation is still required.
- GitHub compile/package/security results must be recorded only against the final exact branch HEAD after the product-invariant gate update.
- Earlier successful candidate SHAs are not substitutes for the final exact-head hardware test.

## NEXT TEST

On the final exact-SHA artifact:

1. install iPhone + embedded Watch companion through iLoader;
2. launch Waxloom with the already-saved private HTTPS endpoint and confirm it reconnects automatically without needing a manual Connect tap;
3. if `Connect securely` is tapped while auto-connect is running or after success, confirm it cannot overwrite a successful connection state;
4. start a library track and verify the compact mini-player appears above — never over — the Home/Browse/Discovery/Search/More tab bar and all five tabs remain tappable while playback continues;
5. validate Albums, Artists, Favorites, Playlists, Search, Discovery and Imports on iPhone;
6. validate AVPlayer playback, seek, queue restore/persist, background/system controls and validated Discovery preview semantics;
7. open Watch and validate compact horizontal navigation;
8. from Watch validate browse/search, play, favorites, playlist CRUD/add/remove, Discovery feedback/bad-source, imports and transport controls;
9. confirm stale/offline Watch actions fail instead of executing later.

Only after this physical test can the exact candidate be labeled `USER VALIDATED`.

## Rollback / checkpoints

- Published baseline / native branch point: `e44183afe9b82c23f6fe77943faec1a1fb7773b0`.
- Previously USER VALIDATED Discovery runtime candidate: `a2cec448319178144b457e98081e572d1c985a29`.
- Published rollback uses revert/new commit only; never rewrite shared history.

## Discovery rolling preview cache

Runtime implementation commit: `42a15562d239f88ee719d80fc99b8e6438d550f6`.

The server now maintains a bounded rolling cache for the currently visible Discovery rotation:

- current visible Discovery candidates are warmed in the background, with two concurrent media jobs;
- cache lives in `%LOCALAPPDATA%\Waxloom\discovery-preview-cache`, outside the repo and music library;
- source-quality media is retained temporarily and non-native playback formats get an M4A playback derivative;
- browser and native iPhone previews receive the Waxloom-local private HTTPS preview URL through the existing YouTube preview/search contract;
- negative Discovery feedback or source rejection evicts that item immediately;
- rotation changes evict stale entries and only current feed items remain;
- import authorization remains required; when the selected source matches a cached item, the cached source-quality file is promoted to the library instead of downloaded again;
- cache hard cap is 6 GiB, and failed sources back off before retry.

Validation state: `IMPLEMENTED / CI GREEN / NOT USER VALIDATED`.

Physical next test:

1. restart the hidden Waxloom scheduled task on the new branch head;
2. query `/api/discovery/previews/status` and watch `ready` rise toward `active`;
3. verify cached browser/iPhone preview starts quickly;
4. verify Less/X removes that item from the active cache;
5. verify feed rotation removes stale files;
6. verify adding a cached matching source promotes locally without a second source download.
