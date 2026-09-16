# Discovery playback cache contract

Discovery playback spans three independently rotating pieces of state: the Watch catalog cache, the iPhone preview queue, and the server preview cache. Their lifetimes must remain compatible.

- The Watch Discovery catalog is cache-first for fast re-entry, but an authoritative cached response may be reused for at most 10 minutes.
- A cache written by an older build without a freshness timestamp is treated as expired.
- The server retains previews removed from the active rotation for 2 hours so a queue already started on iPhone can continue through normal `Next`/`Previous` navigation.
- The server feed may keep rotating normally; extending preview retention must not freeze or pin Discovery ranking.
- Explicit refresh, feedback, bad-source actions, and imports still invalidate the Watch Discovery catalog cache.

The important invariant is: a track that is still legitimately reachable from the Watch UI or from an already-started Discovery queue must not become a server-side 404 merely because the background Discovery rotation advanced.
