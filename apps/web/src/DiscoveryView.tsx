import { useEffect, useMemo, useState } from "react";

import { api } from "./api";
import { usePlayer } from "./Player";
import type {
  DiscoveryCandidate,
  DiscoveryFeedResponse,
  PlaylistSummary,
  PreviewTrack,
} from "./types";

import "./discovery.css";

type ArtistGroup = {
  key: string;
  artist: string;
  items: DiscoveryCandidate[];
  bestRank: number;
  bestUnderground: number;
};

type TasteEntry = {
  value: -1 | 1;
  artist: string;
  tags: string[];
};

type TasteState = Record<string, TasteEntry>;

const BROWSER_CACHE_KEY = "waxloom.discovery.feed.v2";
const TASTE_KEY = "waxloom.discovery.taste.v1";

function scorePercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function folded(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function readTaste(): TasteState {
  try {
    const raw = window.localStorage.getItem(TASTE_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw) as TasteState;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeTaste(value: TasteState): void {
  try {
    window.localStorage.setItem(TASTE_KEY, JSON.stringify(value));
  } catch {
    // Taste storage is a local convenience layer.
  }
}

function tasteAdjustment(candidate: DiscoveryCandidate, taste: TasteState): number {
  const exact = taste[candidate.recording_mbid]?.value ?? candidate.feedback ?? 0;
  if (exact < 0) return -10;

  let adjustment = exact > 0 ? 0.24 : 0;
  const artist = folded(candidate.artist);
  let artistSignal = 0;
  const tagSignals = new Map<string, number>();

  for (const entry of Object.values(taste)) {
    if (folded(entry.artist) === artist) artistSignal += entry.value;
    for (const tag of entry.tags) {
      const key = folded(tag);
      tagSignals.set(key, (tagSignals.get(key) ?? 0) + entry.value);
    }
  }

  adjustment += Math.max(-0.3, Math.min(0.18, artistSignal * 0.06));
  let tags = 0;
  for (const tag of candidate.tags ?? []) tags += tagSignals.get(folded(tag)) ?? 0;
  adjustment += Math.max(-0.2, Math.min(0.12, tags * 0.025));
  return adjustment;
}

function groupCandidates(items: DiscoveryCandidate[], taste: TasteState): ArtistGroup[] {
  const groups = new Map<string, ArtistGroup>();
  const sorted = [...items]
    .filter((candidate) => (taste[candidate.recording_mbid]?.value ?? candidate.feedback ?? 0) >= 0)
    .sort((a, b) => (b.rank + tasteAdjustment(b, taste)) - (a.rank + tasteAdjustment(a, taste)));

  for (const candidate of sorted) {
    const key = folded(candidate.artist) || candidate.recording_mbid;
    const adjustedRank = candidate.rank + tasteAdjustment(candidate, taste);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(candidate);
      existing.bestRank = Math.max(existing.bestRank, adjustedRank);
      existing.bestUnderground = Math.max(existing.bestUnderground, candidate.underground);
    } else {
      groups.set(key, {
        key,
        artist: candidate.artist,
        items: [candidate],
        bestRank: adjustedRank,
        bestUnderground: candidate.underground,
      });
    }
  }

  for (const group of groups.values()) {
    group.items.sort((a, b) => (b.rank + tasteAdjustment(b, taste)) - (a.rank + tasteAdjustment(a, taste)));
  }
  return [...groups.values()].sort((a, b) => b.bestRank - a.bestRank);
}

function readBrowserFeed(): DiscoveryFeedResponse | null {
  try {
    const raw = window.localStorage.getItem(BROWSER_CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as DiscoveryFeedResponse;
    if (!value?.profile || !Array.isArray(value?.external?.items)) return null;
    return value;
  } catch {
    return null;
  }
}

function storeBrowserFeed(value: DiscoveryFeedResponse) {
  if (!value.profile || value.external.items.length === 0) return;
  try {
    window.localStorage.setItem(BROWSER_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Browser storage is only a convenience cache.
  }
}

function formatFeedTime(value: string | null | undefined): string {
  if (!value) return "preparing first feed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "feed ready";
  return `updated ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function asPreviewTrack(candidate: DiscoveryCandidate): PreviewTrack {
  return {
    id: `preview:${candidate.recording_mbid}`,
    recording_mbid: candidate.recording_mbid,
    title: candidate.title,
    artist: candidate.artist,
    release: candidate.release,
  };
}

function ArtistGroupCard({
  group,
  currentPreviewMbid,
  playing,
  taste,
  onPlay,
  onQuickAdd,
  onFeedback,
}: {
  group: ArtistGroup;
  currentPreviewMbid: string | null;
  playing: boolean;
  taste: TasteState;
  onPlay: (candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
  onFeedback: (candidate: DiscoveryCandidate, value: -1 | 0 | 1) => void;
}) {
  return (
    <article className="artist-discovery-card">
      <header className="artist-discovery-head">
        <div>
          <p>{group.artist}</p>
          <span>{group.items.length} track{group.items.length > 1 ? "s" : ""} · swipe inside</span>
        </div>
        <b>{scorePercent(group.bestRank)}</b>
      </header>

      <div className="artist-track-stack" aria-label={`${group.artist} suggestions`}>
        {group.items.map((candidate) => {
          const currentFeedback = taste[candidate.recording_mbid]?.value ?? candidate.feedback ?? 0;
          const isPlaying = currentPreviewMbid === candidate.recording_mbid && playing;
          return (
            <article className="discovery-track-tile" key={candidate.recording_mbid}>
              <div className="artist-track-copy">
                <strong>{candidate.title}</strong>
                <span>{candidate.release || candidate.reason || "Outside your library"}</span>
              </div>

              <div className="discovery-track-primary-actions">
                <button
                  className={isPlaying ? "compact-action compact-action-playing" : "compact-action"}
                  type="button"
                  onPointerEnter={() => api.prefetchYoutubePreview(candidate.artist, candidate.title)}
                  onPointerDown={() => api.prefetchYoutubePreview(candidate.artist, candidate.title)}
                  onClick={() => onPlay(candidate)}
                  title={isPlaying ? "Playing in Waxloom" : "Play in Waxloom"}
                >
                  <span className={isPlaying ? "css-pause-mark" : "css-play-mark"} aria-hidden="true" />
                </button>
                <button className="compact-action compact-action-add" type="button" onClick={() => onQuickAdd(candidate)} title="Download + add to playlist">+</button>
              </div>

              <div className="taste-actions" aria-label="Tune recommendations">
                <button
                  className={currentFeedback === 1 ? "taste-chip taste-chip-active" : "taste-chip"}
                  type="button"
                  onClick={() => onFeedback(candidate, currentFeedback === 1 ? 0 : 1)}
                  title="More like this"
                >
                  Like
                </button>
                <button
                  className={currentFeedback === -1 ? "taste-chip taste-chip-less-active" : "taste-chip"}
                  type="button"
                  onClick={() => onFeedback(candidate, currentFeedback === -1 ? 0 : -1)}
                  title="Show less like this"
                >
                  Less
                </button>
              </div>

              <small className="track-tile-tags">{candidate.tags?.slice(0, 3).join(" · ") || candidate.source || "recommendation"}</small>
            </article>
          );
        })}
      </div>

      <footer className="artist-discovery-foot">
        <span>Swipe tracks ← →</span>
        <span>{group.items.length} in this artist tile</span>
      </footer>
    </article>
  );
}

function DiscoveryRail({
  eyebrow,
  title,
  subtitle,
  groups,
  currentPreviewMbid,
  playing,
  taste,
  onPlayQueue,
  onQuickAdd,
  onFeedback,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  groups: ArtistGroup[];
  currentPreviewMbid: string | null;
  playing: boolean;
  taste: TasteState;
  onPlayQueue: (items: DiscoveryCandidate[], candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
  onFeedback: (candidate: DiscoveryCandidate, value: -1 | 0 | 1) => void;
}) {
  if (groups.length === 0) return null;
  const railItems = groups.flatMap((group) => group.items);

  return (
    <section className="discovery-rail-section">
      <div className="section-toolbar discovery-rail-toolbar">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>
        </div>
      </div>
      <div className="artist-discovery-rail" aria-label={`${title} carousel`}>
        {groups.map((group) => (
          <ArtistGroupCard
            key={group.key}
            group={group}
            currentPreviewMbid={currentPreviewMbid}
            playing={playing}
            taste={taste}
            onPlay={(candidate) => onPlayQueue(railItems, candidate)}
            onQuickAdd={onQuickAdd}
            onFeedback={onFeedback}
          />
        ))}
      </div>
    </section>
  );
}

export function DiscoveryView({ onImportCandidate }: { onImportCandidate: (candidate: DiscoveryCandidate) => void }) {
  const player = usePlayer();
  const [bundle, setBundle] = useState<DiscoveryFeedResponse | null>(() => readBrowserFeed());
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [feedStatus, setFeedStatus] = useState<string>(bundle?.status ?? "starting");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quickTarget, setQuickTarget] = useState<DiscoveryCandidate | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [taste, setTaste] = useState<TasteState>(() => readTaste());

  async function readFeed() {
    try {
      const value = await api.discoveryFeed();
      setFeedStatus(value.status);
      if (value.profile && value.external.items.length > 0) {
        setBundle(value);
        storeBrowserFeed(value);
      }
      if (value.error && !bundle) setError(value.error);
    } catch (caught) {
      if (!bundle) setError(caught instanceof Error ? caught.message : "Discovery feed is unavailable.");
    }
  }

  useEffect(() => {
    let cancelled = false;

    void api.playlists()
      .then((payload) => {
        if (!cancelled) setPlaylists(payload.items);
      })
      .catch(() => undefined);

    void readFeed();
    const timer = window.setInterval(() => {
      if (!cancelled) void readFeed();
    }, 30_000);

    const onFocus = () => {
      if (!cancelled) void readFeed();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const rails = useMemo(() => {
    const groups = groupCandidates(bundle?.external.items ?? [], taste);
    const closest = groups.slice(0, 10);
    const used = new Set(closest.map((group) => group.key));
    const underground = [...groups]
      .filter((group) => !used.has(group.key) && group.items.some((item) => item.source === "listenbrainz"))
      .sort((a, b) => b.bestUnderground - a.bestUnderground || b.bestRank - a.bestRank)
      .slice(0, 10);
    underground.forEach((group) => used.add(group.key));
    const deep = groups
      .filter((group) => !used.has(group.key) && group.items.some((item) => item.source === "musicbrainz_catalog"))
      .slice(0, 10);
    return { closest, underground, deep, totalArtists: groups.length };
  }, [bundle, taste]);

  useEffect(() => {
    const warm = rails.closest.flatMap((group) => group.items.slice(0, 1)).slice(0, 4);
    const timers = warm.map((candidate, index) => window.setTimeout(() => {
      api.prefetchYoutubePreview(candidate.artist, candidate.title);
    }, 300 + index * 650));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [bundle?.rotation_id]);

  async function requestBackgroundRefresh() {
    setNotice(null);
    setError(null);
    try {
      await api.refreshDiscoveryFeed();
      setFeedStatus("refreshing");
      setNotice("A fresh recommendation pool is being prepared in the background. The current feed stays usable.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not queue a Discovery refresh.");
    }
  }

  function playDiscoveryQueue(items: DiscoveryCandidate[], candidate: DiscoveryCandidate) {
    const queue = items.map(asPreviewTrack);
    const index = Math.max(0, items.findIndex((item) => item.recording_mbid === candidate.recording_mbid));
    player.playPreviewTracks(queue, index);
  }

  function updateFeedback(candidate: DiscoveryCandidate, value: -1 | 0 | 1) {
    setTaste((current) => {
      const next = { ...current };
      if (value === 0) delete next[candidate.recording_mbid];
      else {
        next[candidate.recording_mbid] = {
          value,
          artist: candidate.artist,
          tags: candidate.tags ?? [],
        };
      }
      writeTaste(next);
      return next;
    });

    setNotice(value > 0
      ? "Taste updated — Waxloom will favor nearby artists and tags."
      : value < 0
        ? "Taste updated — Waxloom will show less from this musical neighbourhood."
        : "Taste feedback cleared.");

    void api.discoveryFeedback(candidate, value)
      .then(() => readFeed())
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not persist Discovery feedback.");
      });
  }

  async function addToPlaylist(playlist: PlaylistSummary) {
    if (!quickTarget) return;
    const candidate = quickTarget;
    const authKey = "waxloom.authorizedMediaImports";
    let authorized = window.localStorage.getItem(authKey) === "true";
    if (!authorized) {
      authorized = window.confirm(
        "Waxloom can automatically search for a matching YouTube source, download it and add it to this playlist. Confirm that you are authorized to save the media you import this way.",
      );
      if (!authorized) return;
      window.localStorage.setItem(authKey, "true");
    }

    setImporting(candidate.recording_mbid);
    setError(null);
    setNotice(null);
    try {
      const search = await api.youtubeSearch(candidate.artist, candidate.title);
      const best = search.items[0];
      if (!best || best.score < 80) {
        setQuickTarget(null);
        setNotice("The automatic source match was ambiguous. Choose the source manually before importing.");
        onImportCandidate(candidate);
        return;
      }
      const result = await api.youtubeImport(candidate.artist, candidate.title, best.url, playlist.id, true);
      setNotice(
        result.status === "already_local"
          ? `Already local — added the existing track to “${playlist.name}”.`
          : result.playlist_added
            ? `Downloaded and added to “${playlist.name}”.`
            : "Downloaded. Navidrome is still indexing it; playlist insertion may follow after the scan.",
      );
      setQuickTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Automatic import failed.");
    } finally {
      setImporting(null);
    }
  }

  const tasteLikes = Object.values(taste).filter((entry) => entry.value > 0).length;
  const tasteLess = Object.values(taste).filter((entry) => entry.value < 0).length;
  const currentPreviewMbid = player.currentPreview?.recording_mbid ?? null;

  return (
    <div className="discovery-layout discovery-auto-layout">
      <section className="panel discovery-profile-panel discovery-profile-compact">
        <div className="section-toolbar">
          <div>
            <p className="eyebrow">Always-on Discovery · outside your library</p>
            <h2>Your feed is prepared before you get here.</h2>
            <p className="muted">Swipe the shelves like a phone. Tracks stay inside fixed-size artist tiles, previews use the global Waxloom player, and Like/Less tunes future rotations.</p>
          </div>
          <button className="secondary-action" type="button" onClick={() => void requestBackgroundRefresh()}>Refresh in background</button>
        </div>

        <div className="discovery-feed-status">
          <span className={`feed-dot feed-dot-${feedStatus}`} />
          <strong>{feedStatus === "ready" ? "Feed ready" : feedStatus === "refreshing" ? "Refreshing behind the scenes" : "Preparing feed in background"}</strong>
          <span>{formatFeedTime(bundle?.generated_at)}</span>
          {bundle?.external.pool_count ? <span>{bundle.external.pool_count} candidates in pool</span> : null}
          {bundle?.rotation_seconds ? <span>rotates every {Math.round(bundle.rotation_seconds / 60)} min</span> : null}
          {(tasteLikes + tasteLess) > 0 && <span>{tasteLikes} liked · {tasteLess} less</span>}
        </div>

        {bundle?.profile && (
          <div className="profile-stat-grid profile-stat-grid-library">
            <div><strong>{bundle.profile.library_tracks}</strong><span>library tracks</span></div>
            <div><strong>{bundle.profile.library_albums}</strong><span>albums</span></div>
            <div><strong>{bundle.profile.library_artists}</strong><span>artists</span></div>
            <div><strong>{bundle.profile.library_genres}</strong><span>genres</span></div>
            <div><strong>{bundle.profile.representative_seeds}</strong><span>smart anchors</span></div>
          </div>
        )}

        {!bundle && <div className="discovery-building discovery-building-passive">First feed is being prepared by Waxloom in the background. You can leave Discovery; it will continue working.</div>}
        {error && <div className="state-card state-card-error">{error}</div>}
        {notice && <div className="state-card state-card-success">{notice}</div>}
      </section>

      {bundle && (
        <>
          <DiscoveryRail
            eyebrow={`Best matches · ${rails.totalArtists} artists in this rotation`}
            title="Closest to your collection"
            subtitle="Swipe artist tiles horizontally. Each tile has its own swipeable track deck."
            groups={rails.closest}
            currentPreviewMbid={currentPreviewMbid}
            playing={player.playing}
            taste={taste}
            onPlayQueue={playDiscoveryQueue}
            onQuickAdd={setQuickTarget}
            onFeedback={updateFeedback}
          />
          <DiscoveryRail
            eyebrow="Dig deeper"
            title="More underground"
            subtitle="Less obvious ListenBrainz matches from the persistent pool."
            groups={rails.underground}
            currentPreviewMbid={currentPreviewMbid}
            playing={player.playing}
            taste={taste}
            onPlayQueue={playDiscoveryQueue}
            onQuickAdd={setQuickTarget}
            onFeedback={updateFeedback}
          />
          <DiscoveryRail
            eyebrow="Catalogue exploration"
            title="Deep cuts from neighbouring artists"
            subtitle="MusicBrainz catalogue paths reached through AudioMuse neighbours."
            groups={rails.deep}
            currentPreviewMbid={currentPreviewMbid}
            playing={player.playing}
            taste={taste}
            onPlayQueue={playDiscoveryQueue}
            onQuickAdd={setQuickTarget}
            onFeedback={updateFeedback}
          />

          <details className="discovery-details">
            <summary>Feed details</summary>
            <p>{bundle.profile?.library_tracks ?? 0} tracks · {bundle.profile?.library_albums ?? 0} albums · {bundle.profile?.library_artists ?? 0} artists · {bundle.profile?.representative_seeds ?? 0} diversified anchors.</p>
            <p>Generated {bundle.generated_at ?? "not yet"} · next background rebuild {bundle.next_refresh_at ?? "pending"} · rotation #{bundle.rotation_id ?? "-"}.</p>
          </details>
        </>
      )}

      {quickTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setQuickTarget(null)}>
          <section className="modal discovery-playlist-modal" role="dialog" aria-modal="true" aria-label="Download and add to playlist" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><p className="eyebrow">Download + add</p><h3>{quickTarget.artist} — {quickTarget.title}</h3></div>
              <button className="icon-button" type="button" onClick={() => setQuickTarget(null)}>×</button>
            </div>
            <p className="muted">Choose the destination playlist. Waxloom uses the highest-confidence source automatically; ambiguous matches fall back to manual source selection.</p>
            <div className="modal-list">
              {playlists.map((playlist) => (
                <button className="modal-list-item" type="button" key={playlist.id} disabled={importing === quickTarget.recording_mbid} onClick={() => void addToPlaylist(playlist)}>
                  <strong>{playlist.name}</strong><span>{playlist.songCount ?? 0} tracks</span>
                </button>
              ))}
            </div>
            <button className="secondary-action" type="button" onClick={() => { setQuickTarget(null); onImportCandidate(quickTarget); }}>Choose source manually →</button>
          </section>
        </div>
      )}
    </div>
  );
}
