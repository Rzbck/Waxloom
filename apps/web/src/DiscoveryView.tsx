import { useEffect, useMemo, useState } from "react";

import { api } from "./api";
import { usePlayer } from "./Player";
import type {
  DiscoveryCandidate,
  DiscoveryFeedResponse,
  PreviewTrack,
} from "./types";

import "./discovery.css";

type TasteEntry = {
  value: -1 | 1;
  artist: string;
  tags: string[];
};

type TasteState = Record<string, TasteEntry>;
type ShelfKey = "closest" | "underground" | "deep";

const BROWSER_CACHE_KEY = "waxloom.discovery.feed.v4";
const TASTE_KEY = "waxloom.discovery.taste.v1";
const SHELF_PAGE_SIZE = 12;
const SHELF_TARGET_SIZE = 20;

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

function activeCandidates(items: DiscoveryCandidate[], taste: TasteState): DiscoveryCandidate[] {
  return [...items]
    .filter((candidate) => (taste[candidate.recording_mbid]?.value ?? candidate.feedback ?? 0) >= 0)
    .sort((a, b) => (b.rank + tasteAdjustment(b, taste)) - (a.rank + tasteAdjustment(a, taste)));
}

function diversify(items: DiscoveryCandidate[], maxPerArtist = 2): DiscoveryCandidate[] {
  const counts = new Map<string, number>();
  const output: DiscoveryCandidate[] = [];
  for (const candidate of items) {
    const artist = folded(candidate.artist) || candidate.recording_mbid;
    const current = counts.get(artist) ?? 0;
    if (current >= maxPerArtist) continue;
    counts.set(artist, current + 1);
    output.push(candidate);
  }
  return output;
}

function fillShelf(
  primary: DiscoveryCandidate[],
  fallback: DiscoveryCandidate[],
  used: Set<string>,
  target = SHELF_TARGET_SIZE,
): DiscoveryCandidate[] {
  const output: DiscoveryCandidate[] = [];
  const append = (candidate: DiscoveryCandidate) => {
    if (used.has(candidate.recording_mbid) || output.some((item) => item.recording_mbid === candidate.recording_mbid)) return;
    output.push(candidate);
  };

  for (const candidate of diversify(primary, 2)) {
    append(candidate);
    if (output.length >= target) break;
  }
  if (output.length < target) {
    for (const candidate of diversify(fallback, 2)) {
      append(candidate);
      if (output.length >= target) break;
    }
  }

  output.forEach((candidate) => used.add(candidate.recording_mbid));
  return output;
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

function DiscoveryTrackCard({
  candidate,
  currentPreviewMbid,
  playing,
  importing,
  taste,
  onPlay,
  onQuickAdd,
  onFeedback,
}: {
  candidate: DiscoveryCandidate;
  currentPreviewMbid: string | null;
  playing: boolean;
  importing: boolean;
  taste: TasteState;
  onPlay: (candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
  onFeedback: (candidate: DiscoveryCandidate, value: -1 | 0 | 1) => void;
}) {
  const currentFeedback = taste[candidate.recording_mbid]?.value ?? candidate.feedback ?? 0;
  const isPlaying = currentPreviewMbid === candidate.recording_mbid && playing;

  return (
    <article className="discovery-song-card">
      <div className="discovery-song-copy">
        <strong title={candidate.title}>{candidate.title}</strong>
        <span title={candidate.artist}>{candidate.artist}</span>
      </div>
      <b className="discovery-song-score">{scorePercent(candidate.rank)}</b>
      <button
        className={isPlaying ? "compact-action compact-action-play compact-action-playing" : "compact-action compact-action-play"}
        type="button"
        onPointerEnter={() => api.prefetchYoutubePreview(candidate.artist, candidate.title)}
        onPointerDown={() => api.prefetchYoutubePreview(candidate.artist, candidate.title)}
        onClick={() => onPlay(candidate)}
        title={isPlaying ? "Playing in Waxloom" : "Play in Waxloom"}
        aria-label={isPlaying ? `Playing ${candidate.title}` : `Play ${candidate.title}`}
      >
        <span className={isPlaying ? "css-pause-mark" : "css-play-mark"} aria-hidden="true" />
      </button>
      <button
        className="compact-action compact-action-add"
        type="button"
        disabled={importing}
        onClick={() => onQuickAdd(candidate)}
        title={importing ? "Adding to library…" : "Add to library"}
        aria-label={`Add ${candidate.title} to library`}
      >+</button>
      <button
        className={currentFeedback === 1 ? "taste-chip taste-chip-like taste-chip-active" : "taste-chip taste-chip-like"}
        type="button"
        onClick={() => onFeedback(candidate, currentFeedback === 1 ? 0 : 1)}
        title="More like this"
        aria-label={`More like ${candidate.title}`}
      >Like</button>
      <button
        className={currentFeedback === -1 ? "taste-chip taste-chip-less taste-chip-less-active" : "taste-chip taste-chip-less"}
        type="button"
        onClick={() => onFeedback(candidate, currentFeedback === -1 ? 0 : -1)}
        title="Show less like this"
        aria-label={`Less like ${candidate.title}`}
      >Less</button>
    </article>
  );
}

function DiscoveryShelf({
  eyebrow,
  title,
  items,
  page,
  onNextPage,
  currentPreviewMbid,
  playing,
  importingMbid,
  taste,
  onPlayQueue,
  onQuickAdd,
  onFeedback,
}: {
  eyebrow: string;
  title: string;
  items: DiscoveryCandidate[];
  page: number;
  onNextPage: () => void;
  currentPreviewMbid: string | null;
  playing: boolean;
  importingMbid: string | null;
  taste: TasteState;
  onPlayQueue: (items: DiscoveryCandidate[], candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
  onFeedback: (candidate: DiscoveryCandidate, value: -1 | 0 | 1) => void;
}) {
  if (items.length === 0) return null;
  const pageCount = Math.max(1, Math.ceil(items.length / SHELF_PAGE_SIZE));
  const normalizedPage = page % pageCount;
  const start = normalizedPage * SHELF_PAGE_SIZE;
  const visible = items.slice(start, start + SHELF_PAGE_SIZE);

  return (
    <section className="discovery-rail-section discovery-track-shelf">
      <div className="section-toolbar discovery-rail-toolbar discovery-track-toolbar">
        <div>
          <p className="eyebrow">{eyebrow} · {items.length} tracks</p>
          <h2>{title}</h2>
        </div>
        {pageCount > 1 && (
          <button className="secondary-action discovery-more-tracks" type="button" onClick={onNextPage}>
            More tracks <span>{normalizedPage + 1}/{pageCount}</span>
          </button>
        )}
      </div>
      <div className="discovery-track-grid" aria-label={`${title} tracks`}>
        {visible.map((candidate) => (
          <DiscoveryTrackCard
            key={candidate.recording_mbid}
            candidate={candidate}
            currentPreviewMbid={currentPreviewMbid}
            playing={playing}
            importing={importingMbid === candidate.recording_mbid}
            taste={taste}
            onPlay={(track) => onPlayQueue(items, track)}
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
  const [feedStatus, setFeedStatus] = useState<string>(bundle?.status ?? "starting");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [taste, setTaste] = useState<TasteState>(() => readTaste());
  const [shelfPages, setShelfPages] = useState<Record<ShelfKey, number>>({ closest: 0, underground: 0, deep: 0 });

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
    const ranked = activeCandidates(bundle?.external.items ?? [], taste);
    const used = new Set<string>();

    const closestPool = ranked.filter((candidate) => candidate.source !== "youtube_dig");
    const closest = fillShelf(closestPool, closestPool, used);

    const youtubeDigPrimary = [...ranked]
      .filter((candidate) => candidate.source === "youtube_dig")
      .sort((a, b) => (b.underground + b.rank * 0.25) - (a.underground + a.rank * 0.25));
    const rareMetadataFallback = [...ranked]
      .filter((candidate) => candidate.source === "listenbrainz" && candidate.underground >= 0.82)
      .sort((a, b) => (b.underground + b.rank * 0.15) - (a.underground + a.rank * 0.15));
    const underground = fillShelf(youtubeDigPrimary, rareMetadataFallback, used, 28);

    const deepPrimary = ranked.filter((candidate) => candidate.source === "musicbrainz_catalog");
    const deep = fillShelf(deepPrimary, closestPool, used);

    return { closest, underground, deep, totalTracks: ranked.length };
  }, [bundle, taste]);

  useEffect(() => {
    setShelfPages({ closest: 0, underground: 0, deep: 0 });
  }, [bundle?.rotation_id, bundle?.generated_at]);

  useEffect(() => {
    const source = bundle?.external.items ?? [];
    if (source.length === 0) return;

    const seen = new Set<string>();
    const ordered: DiscoveryCandidate[] = [];
    for (const candidate of [...rails.closest, ...rails.underground, ...rails.deep, ...source]) {
      if (seen.has(candidate.recording_mbid)) continue;
      seen.add(candidate.recording_mbid);
      ordered.push(candidate);
    }

    const timer = window.setTimeout(() => {
      void api.prewarmYoutubePreviews(ordered.slice(0, 60), 2);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [bundle?.rotation_id, bundle?.generated_at]);

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

  async function addToLibrary(candidate: DiscoveryCandidate) {
    if (importing) return;

    const authKey = "waxloom.authorizedMediaImports";
    let authorized = window.localStorage.getItem(authKey) === "true";
    if (!authorized) {
      authorized = window.confirm(
        "Waxloom can download this music source into your local library. Confirm that you are authorized to save the media you import this way.",
      );
      if (!authorized) return;
      window.localStorage.setItem(authKey, "true");
    }

    setImporting(candidate.recording_mbid);
    setError(null);
    setNotice(`Adding ${candidate.artist} — ${candidate.title} to your library…`);

    try {
      const search = await api.youtubeSearch(candidate.artist, candidate.title, undefined, 1);
      const best = search.items[0];
      if (!best || best.score < 80) {
        setNotice("The automatic source match was ambiguous. Choose the music source manually before importing.");
        onImportCandidate(candidate);
        return;
      }

      const result = await api.youtubeImport(candidate.artist, candidate.title, best.url, null, true);
      setNotice(
        result.status === "already_local"
          ? "Already in your local library — no duplicate was downloaded."
          : result.status === "imported"
            ? `Added to your library: ${result.relative_path ?? `${candidate.artist} / Singles`}.`
            : `Downloaded to your library: ${result.relative_path ?? `${candidate.artist} / Singles`}. Navidrome is still indexing it.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Library import failed.");
      setNotice(null);
    } finally {
      setImporting(null);
    }
  }

  const tasteLikes = Object.values(taste).filter((entry) => entry.value > 0).length;
  const tasteLess = Object.values(taste).filter((entry) => entry.value < 0).length;
  const currentPreviewMbid = player.currentPreview?.recording_mbid ?? null;

  function nextShelfPage(key: ShelfKey) {
    setShelfPages((current) => ({ ...current, [key]: current[key] + 1 }));
  }

  return (
    <div className="discovery-layout discovery-auto-layout">
      <section className="panel discovery-profile-panel discovery-profile-compact">
        <div className="section-toolbar">
          <div>
            <p className="eyebrow">Always-on Discovery · outside your library</p>
            <h2>Your feed is ready before you arrive.</h2>
            <p className="muted">Track-first recommendations, diversified across artists. Preview sources warm quietly in the background.</p>
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
          <DiscoveryShelf
            eyebrow={`Best matches · ${rails.totalTracks} tracks in this rotation`}
            title="Closest to your collection"
            items={rails.closest}
            page={shelfPages.closest}
            onNextPage={() => nextShelfPage("closest")}
            currentPreviewMbid={currentPreviewMbid}
            playing={player.playing}
            importingMbid={importing}
            taste={taste}
            onPlayQueue={playDiscoveryQueue}
            onQuickAdd={(candidate) => void addToLibrary(candidate)}
            onFeedback={updateFeedback}
          />
          <DiscoveryShelf
            eyebrow="YouTube dig · music-verified · low exposure / high engagement"
            title="More underground"
            items={rails.underground}
            page={shelfPages.underground}
            onNextPage={() => nextShelfPage("underground")}
            currentPreviewMbid={currentPreviewMbid}
            playing={player.playing}
            importingMbid={importing}
            taste={taste}
            onPlayQueue={playDiscoveryQueue}
            onQuickAdd={(candidate) => void addToLibrary(candidate)}
            onFeedback={updateFeedback}
          />
          <DiscoveryShelf
            eyebrow="Catalogue exploration"
            title="Deep cuts"
            items={rails.deep}
            page={shelfPages.deep}
            onNextPage={() => nextShelfPage("deep")}
            currentPreviewMbid={currentPreviewMbid}
            playing={player.playing}
            importingMbid={importing}
            taste={taste}
            onPlayQueue={playDiscoveryQueue}
            onQuickAdd={(candidate) => void addToLibrary(candidate)}
            onFeedback={updateFeedback}
          />
        </>
      )}
    </div>
  );
}
