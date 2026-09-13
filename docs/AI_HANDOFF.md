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
- background audio + MPNowPlayingInfoCenter / MPRemoteCommandCenter;
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

Validation state:

- web cached Discovery playback is `USER VALIDATED` on the Windows host;
- cache endpoint transport to the iPhone is `USER VALIDATED`: repeated physical iPhone taps produced `GET /api/discovery/previews/<recording>` requests and the server returned byte-range `206` responses in roughly 2–6 ms;
- the `de8b3ced...` iPhone candidate still produced no audible Discovery playback despite successful fast `206` delivery, so server/cache/Tailscale are not the active blocker.

Native playback diagnosis/fix:

- first native fix removed the awaited remote zero-seek before playback, but the implementation still awaited `AVURLAsset.load(.isPlayable)` and then `AVURLAsset.load(.duration)` before calling `playImmediately`;
- the second physical test again showed several successful Range probes per tap but no audio, strongly localizing the remaining stall to those pre-play metadata loads;
- commit `a4ee68a86157ce674b2469e60696762f306f6dcf` now constructs `AVPlayerItem(url:)` directly from the Waxloom cached media endpoint, reactivates the audio session, replaces the item, and calls `playImmediately(atRate:)` without any pre-play seek, playability load, or duration load;
- `automaticallyWaitsToMinimizeStalling` is disabled for this already-local cached source and a short preferred forward buffer is used;
- the native player now posts non-secret stage traces to the existing `/api/player/trace` logger (`preview_tap`, `preview_item_set`, `preview_play_called`, `preview_progress`, `preview_no_progress`, `preview_item_failed`) so the Windows runtime log can diagnose the exact AVPlayer stage without an Xcode console;
- invariant commit `fa2426663fd5b76c902ea7761fdde97f60a6f34d` requires this direct cached-item path and forbids reintroducing pre-play `asset.load(.isPlayable)`, `asset.load(.duration)`, or awaited zero-seek;
- this second native fix is `IMPLEMENTED / NOT USER VALIDATED`; its exact Apple build is running and must succeed before iLoader installation.

Physical next test:

1. install the exact final branch-head IPA after CI succeeds;
2. run the runtime log viewer and filter for `PLAYER|PREVIEW|/api/discovery/previews/`;
3. tap one ready Discovery track once;
4. expected trace is `preview_tap -> preview_item_set -> preview_play_called -> preview_progress`, plus the media `206` responses;
5. if playback still fails, `preview_no_progress` or `preview_item_failed` will identify the next native stage directly in the Windows log;
6. once single-tap playback works, validate A -> B starts B at 0:00, same-track pause/resume preserves position, and previous/next start new previews at 0:00.

## Runtime log / web identity

- Waxloom runtime now writes a bounded rotating local log under `%LOCALAPPDATA%\Waxloom\logs\waxloom-runtime.log`.
- `scripts/WATCH_WAXLOOM_LOG.ps1` follows that log live without stopping the hidden Waxloom server when the viewer is closed.
- logs record request path/status/timing and preview/stream identifiers only; secrets, auth headers, cookies and request bodies must not be logged.
- the web app now has a Waxloom favicon in `apps/web/public/favicon.svg`, wired from `apps/web/index.html`.

## Windows service topology / automatic startup

The local Waxloom host now has a defined service layout. Keep this operational topology in mind in future sessions, but do not publish private hostnames, local IPs, credentials, personal paths, or machine-specific secrets in the public repository.

- Docker Desktop is the container runtime for the auxiliary self-hosted services currently used on the machine.
- AudioMuse runs as Docker containers with persistent PostgreSQL/Redis volumes and `unless-stopped` restart policies.
- Immich is also Docker-managed and its core containers use automatic restart policies; it is independent from Waxloom but shares the same Docker Desktop runtime.
- Navidrome is not Docker-managed in the current setup; it runs through a Windows Scheduled Task and remains the library/streaming authority used by Waxloom.
- Waxloom API + web + private HTTPS bridge are started by the hidden Windows Scheduled Task `Waxloom Native Server` at user logon. The task runs the canonical `apps/apple/START_WAXLOOM_NATIVE.ps1` launcher with no browser and no visible terminal.
- The scheduled Waxloom task was USER VALIDATED while running: task state `Running`, API/web/bridge listeners active, and private HTTPS `/api/health` returned `status=ok`.
- A full cold reboot/logon validation is still required before calling the whole automatic-start chain USER VALIDATED across reboot.
- Tailscale Serve remains private/tailnet-only; never replace it with Funnel for Waxloom.
- Future service cleanup may relocate old deployment folders, but must preserve Docker volumes/data and avoid changing working service state merely for cosmetic organization.
