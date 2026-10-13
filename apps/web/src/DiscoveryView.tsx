import { useEffect, useMemo, useState } from "react";
import { downloadPhase, enqueueDiscoveryDownload, useDownloads } from "./downloadQueue";
import { VinylRack } from "./VinylRack";

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


const BROWSER_CACHE_KEY = "waxloom.discovery.feed.v4";
const TASTE_KEY = "waxloom.discovery.taste.v1";
const SOURCE_REJECT_TAG = "__waxloom_source:not_music__";
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
  phase,
  rejecting,
  taste,
  onPlay,
  onQuickAdd,
  onFeedback,
  onBadSource,
}: {
  candidate: DiscoveryCandidate;
  currentPreviewMbid: string | null;
  playing: boolean;
  phase?: ReturnType<typeof downloadPhase>;
  rejecting: boolean;
  taste: TasteState;
  onPlay: (candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
  onFeedback: (candidate: DiscoveryCandidate, value: -1 | 0 | 1) => void;
  onBadSource: (candidate: DiscoveryCandidate) => void;
}) {
  const currentFeedback = taste[candidate.recording_mbid]?.value ?? candidate.feedback ?? 0;
  const isPlaying = currentPreviewMbid === candidate.recording_mbid && playing;
  const canRejectSource = candidate.source === "youtube_dig";
  const [coverFailed, setCoverFailed] = useState(false);
  const coverId = candidate.release_mbid && /^[0-9a-f-]{36}$/i.test(candidate.release_mbid) ? candidate.release_mbid : null;
  const cover = coverId && !coverFailed ? `https://coverartarchive.org/release/${encodeURIComponent(coverId)}/front-250` : null;
  const working = phase === "queued" || phase === "searching" || phase === "downloading";
  return (
    <article className="discovery-cover-card">
      <button
        className="discovery-cover-art"
        type="button"
        onClick={() => onPlay(candidate)}
        onPointerEnter={() => api.prefetchYoutubePreview(candidate.artist, candidate.title)}
        title={`Play ${candidate.artist} — ${candidate.title}`}
        aria-label={`Play ${candidate.title}`}
      >
        {cover ? <img src={cover} loading="lazy" alt="" onError={() => setCoverFailed(true)} /> : (
          <span className="discovery-cover-fallback" aria-hidden="true">{candidate.artist.slice(0, 2).toUpperCase()}</span>
        )}
        <span className={isPlaying ? "discovery-cover-play is-playing" : "discovery-cover-play"} aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
      </button>
      <div className="discovery-cover-copy">
        <strong title={candidate.title}>{candidate.title}</strong>
        <small title={candidate.artist}>{candidate.artist}</small>
      </div>
      <div className="discovery-cover-actions">
        <button
          className={`discovery-cover-download ${working ? "is-working" : ""} ${phase === "indexed" || phase === "existing" ? "is-complete" : ""}`}
          type="button"
          disabled={working || phase === "indexed" || phase === "existing"}
          title={phase === "failed" ? "Retry download" : phase === "downloading" ? "Downloading and indexing" : phase === "queued" ? "Queued" : phase === "indexed" ? "Saved in library" : "Download into library"}
          aria-label={`Download ${candidate.title} to library`}
          onClick={() => onQuickAdd(candidate)}
        >{phase === "indexed" || phase === "existing" ? "✓" : working ? "◌" : phase === "failed" ? "!" : "+"}</button>
        <button className={currentFeedback === 1 ? "discovery-cover-vote discovery-cover-like is-liked" : "discovery-cover-vote discovery-cover-like"}
          type="button" aria-label={`More like ${candidate.title}`} title="More like this"
          onClick={() => onFeedback(candidate, currentFeedback === 1 ? 0 : 1)}>Like</button>
        <button className={currentFeedback === -1 ? "discovery-cover-vote discovery-cover-less is-less" : "discovery-cover-vote discovery-cover-less"}
          type="button" aria-label={`Less like ${candidate.title}`} title="Show less like this"
          onClick={() => onFeedback(candidate, currentFeedback === -1 ? 0 : -1)}>Less</button>
        {canRejectSource ? <button className="discovery-cover-reject" type="button" disabled={rejecting}
          aria-label={`Report ${candidate.title} as non-music`} title="Not music / bad source"
          onClick={() => onBadSource(candidate)}>×</button> : <span className="discovery-cover-action-space" aria-hidden="true" />}
      </div>
    </article>
  );
}

function DiscoveryShelf({
  items, currentPreviewMbid, playing, rejectingMbid, taste, onPlayQueue, onQuickAdd, onFeedback, onBadSource,
}: {
  items: DiscoveryCandidate[];
  currentPreviewMbid: string | null;
  playing: boolean;
  rejectingMbid: string | null;
  taste: TasteState;
  onPlayQueue: (items: DiscoveryCandidate[], candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
  onFeedback: (candidate: DiscoveryCandidate, value: -1 | 0 | 1) => void;
  onBadSource: (candidate: DiscoveryCandidate) => void;
}) {
  if (items.length === 0) return <p className="muted">Preparing musical discoveries…</p>;
  const renderTrack = (candidate: DiscoveryCandidate) => (
    <DiscoveryTrackCard
      key={candidate.recording_mbid} candidate={candidate}
      currentPreviewMbid={currentPreviewMbid} playing={playing}
      phase={downloadPhase(candidate.recording_mbid)}
      rejecting={rejectingMbid === candidate.recording_mbid} taste={taste}
      onPlay={(track) => onPlayQueue(items, track)}
      onQuickAdd={onQuickAdd} onFeedback={onFeedback} onBadSource={onBadSource}
    />
  );
  return (
    <section className="discovery-cover-shelf" aria-label="All Discovery recommendations">
      <div className="waxloom-discovery-vinyl">
        <VinylRack count={items.length} contentKey={items[0]?.recording_mbid} label="Discover tracks in the vinyl crate" variant="discovery"
          records={items.map((item) => ({title:item.title, artist:item.artist}))}>
          {items.map((candidate) => (
            <div key={candidate.recording_mbid} className="waxloom-vinyl-sleeve waxloom-vinyl-sleeve--discovery">
              {renderTrack(candidate)}
            </div>
          ))}
        </VinylRack>
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
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [taste, setTaste] = useState<TasteState>(() => readTaste());
  const downloads = useDownloads();

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

  // Show every available recommendation at once in a horizontal, two-row
  // viewport. No source labels, mood tabs, More tracks, or page pagination.
  const recommendations = useMemo(
    () => diversify(activeCandidates(bundle?.external.items ?? [], taste), 3),
    [bundle, taste],
  );

  useEffect(() => {
    const source = bundle?.external.items ?? [];
    if (source.length === 0) return;

    const seen = new Set<string>();
    const ordered: DiscoveryCandidate[] = [];
    for (const candidate of [...recommendations, ...source]) {
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

  async function rejectBadSource(candidate: DiscoveryCandidate) {
    if (rejecting || candidate.source !== "youtube_dig") return;

    setRejecting(candidate.recording_mbid);
    setError(null);
    setNotice(null);

    // Remove it immediately from both the rendered state and browser cache.
    // The backend persists the source rejection separately from musical taste.
    setBundle((current) => {
      if (!current) return current;
      const items = current.external.items.filter((item) => item.recording_mbid !== candidate.recording_mbid);
      const next: DiscoveryFeedResponse = {
        ...current,
        external: {
          ...current.external,
          items,
          count: items.length,
        },
      };
      storeBrowserFeed(next);
      return next;
    });

    const sourceFeedback: DiscoveryCandidate = {
      ...candidate,
      tags: [
        SOURCE_REJECT_TAG,
        ...(candidate.tags ?? []).filter((tag) => tag !== SOURCE_REJECT_TAG).slice(0, 11),
      ],
    };

    try {
      await api.discoveryFeedback(sourceFeedback, -1);
      setNotice("Bad source removed — this does not change your musical taste, and this video will stay excluded.");
      await readFeed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the bad-source report.");
      await readFeed();
    } finally {
      setRejecting(null);
    }
  }

  function addToLibrary(candidate: DiscoveryCandidate) {
    const enqueued = enqueueDiscoveryDownload(candidate, onImportCandidate);
    if (enqueued) setNotice(null);
  }

  const tasteLikes = Object.values(taste).filter((entry) => entry.value > 0).length;
  const tasteLess = Object.values(taste).filter((entry) => entry.value < 0).length;
  const currentPreviewMbid = player.currentPreview?.recording_mbid ?? null;

  return (
    <div className="discovery-layout discovery-fit-page">
      <header className="discovery-fit-header">
        <div>
          <strong>Discovery</strong>
          <span>{recommendations.length} tracks · {feedStatus === "ready" ? "ready" : feedStatus} · {formatFeedTime(bundle?.generated_at)}</span>
        </div>
        <div className="discovery-fit-controls">
          {downloads.some((item) => ["queued", "searching", "downloading"].includes(item.phase))
            ? <small>{downloads.filter((item) => ["queued", "searching", "downloading"].includes(item.phase)).length} downloading</small> : null}
          <button className="secondary-action" type="button" onClick={() => void requestBackgroundRefresh()} title="Prepare fresh suggestions in the background">↻ New music</button>
        </div>
      </header>
      {error && <div className="discovery-fit-message is-error">{error}</div>}
      {notice && <div className="discovery-fit-message">{notice}</div>}
      {bundle ? (
        <DiscoveryShelf items={recommendations}
          currentPreviewMbid={currentPreviewMbid} playing={player.playing}
          rejectingMbid={rejecting} taste={taste}
          onPlayQueue={playDiscoveryQueue} onQuickAdd={addToLibrary}
          onFeedback={updateFeedback}
          onBadSource={(candidate) => void rejectBadSource(candidate)} />
      ) : <div className="discovery-fit-message">Preparing the first discoveries…</div>}
    </div>
  );
}
