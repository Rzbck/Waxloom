# Waxloom — AI session log

### 2026-09-12 — bootstrap / Windows launcher / public-repo workflow
HEAD before: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
USER VALIDATED: `configure.ps1` detected Navidrome/library/AudioMuse and wrote ignored local `.env` without displaying the AudioMuse token.
USER VALIDATED: runtime candidate `1d774b5a87d8646d1dd30baea2745d8e4ac88dc9` reached API ready, UI ready/browser rendering, and clean Ctrl+C shutdown from the dedicated worktree.
AUTOMATED GATE PASS: public-repository security gate, PowerShell parser, API install/import, web build, direct Node/Vite smoke.
DECISION: adopt SIGNAL-style branch/worktree/handoff discipline; normal development remains off `main`.
OWNER POLICY: GitHub branch protection/rulesets are optional, not a promotion blocker. Do not push/merge to `main` by default; explicit owner `push/merge to main` authorizes promotion after security/build/diff gates.
SECURITY: repository is public; fail-closed tracked-secret gate and CI gate remain mandatory.
ROLLBACK / BASE: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

### 2026-09-12 — functional Navidrome playlists UI
BRANCH: `feat/navidrome-playlists-ui-20260912` / PR #2.
OWNER FEEDBACK: initial browser UI was a visual shell and dead controls were unacceptable.
IMPLEMENTED: real navigation, real `/api/playlists`, real playlist detail/tracks, visible loading/error/retry states.
USER VALIDATED: owner confirmed real Navidrome playlists render in Waxloom.
SECURITY: frontend only calls Waxloom `/api/*`; Navidrome credentials remain server-side.

### 2026-09-12 — Navidrome core library + global player
OWNER REQUIREMENT: Waxloom must become the primary Navidrome music client, not a playlist viewer. Player/library/search/favorites/queue must live inside Waxloom before Discovery/Imports are treated as the main differentiator.
BRANCH: `feat/navidrome-core-player-20260912`, stacked on the playlist branch.
PR: #3 targeting `feat/navidrome-playlists-ui-20260912`.
IMPLEMENTATION COMMIT: `2393ef8f808c7f84f66b2ccce12c938b376cf6f3`; later handoff/log commits are documentation-only unless otherwise noted.
IMPLEMENTED / NOT USER VALIDATED: Home newest/random; Albums browse/detail; Artists browse/detail; global search; Favorites; playlist CRUD/add/remove; server-side stream + cover proxy; global audio player; seek/volume/prev/next/shuffle/repeat; persistent Navidrome queue; scrobble now-playing/submission.
AUTOMATED GATE PASS ON IMPLEMENTATION COMMIT: security, PowerShell parse, Python API install/compile/import, npm install, React/TypeScript/Vite production build, direct Node/Vite HTTP smoke.
SECURITY: browser never receives Navidrome password/auth parameters; stream/cover remain server-side proxied.
SCOPE BOUNDARY: admin/users, shares, radio management, podcasts, bookmarks/audiobooks, jukebox hardware, smart-playlist authoring remain separate parity tranches; see `docs/NAVIDROME_CORE_SCOPE.md`.
NEXT: exact-head real-library runtime gate for PR #3, then continue immediately with Waxloom Discovery/AudioMuse/Imports rather than stopping at Navidrome parity.
