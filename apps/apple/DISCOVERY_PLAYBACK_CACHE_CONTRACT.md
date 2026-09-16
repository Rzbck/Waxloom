# Discovery playback cache contract

Discovery playback spans three independently rotating pieces of state: the Watch catalog cache, the iPhone preview queue, and the server preview cache. Their lifetimes must remain compatible.

- The Watch Discovery catalog is cache-first for fast re-entry, but an authoritative cached response may be reused for at most 10 minutes.
- A cache written by an older build without a freshness timestamp is treated as expired.
- The server retains previews removed from the active rotation for 2 hours so a queue already started on iPhone can continue through normal `Next`/`Previous` navigation.
- Retained preview state is persisted and restored across API container restarts; the first deployment also migrates already-playable cache entries into one grace window before the normal feed reconcile trims active items back out of `recent`.
- The server feed may keep rotating normally; extending preview retention must not freeze or pin Discovery ranking.
- Explicit refresh, feedback, bad-source actions, and imports invalidate or replace the Watch Discovery catalog cache.
- Now Playing taste feedback must refresh the cached Discovery payload before the user returns to Browse, so a persisted Like/Dislike cannot visually revert to stale feedback state.
- A Discovery `+` import must prefer the verified source already backing the playable preview. Re-running a fuzzy YouTube search is a fallback only when no usable cached preview source remains.
- Retained queue items inside the 2-hour grace window remain eligible for identity-based cached-source import, even after they leave the active rotation.
- Debugging must correlate client-originated playback traces, server HTTP receipt, structured server decision traces, and final result. Cache counters alone are not sufficient evidence of success or failure.
- `scripts/TRACE_WATCH_DISCOVERY.ps1` is the standard evidence collector for physical Watch/iPhone testing, while `scripts/CHECK_DISCOVERY_RUNTIME_HOOKS.py` verifies cached-source reuse, retained identity lookup, restart persistence, and persisted feedback without network access.

The important invariants are:

1. A track that is still legitimately reachable from the Watch UI or from an already-started Discovery queue must not become a server-side 404 merely because the background Discovery rotation advanced or the API container restarted.
2. If a Discovery preview is already playable, importing it must reuse that verified source whenever possible instead of asking the user to identify the same source again.
3. Persisted taste feedback must survive navigation away from and back to Discovery without a stale Watch cache masking the stored value.
