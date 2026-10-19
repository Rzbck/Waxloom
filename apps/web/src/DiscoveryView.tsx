import { useEffect, useMemo, useRef, useState } from "react";
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
const BROWSER_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
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
  window.dispatchEvent(new Event("waxloom:discovery-taste"));
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
    const stamp = (value as DiscoveryFeedResponse & { _cached_at?: number })._cached_at;
    if (!stamp || Date.now() - stamp > BROWSER_CACHE_AGE_MS || stamp > Date.now() + 60000) return null;
    return value;
  } catch {
    return null;
  }
}

function storeBrowserFeed(value: DiscoveryFeedResponse) {
  if (!value.profile || value.external.items.length === 0) return;
  try {
    window.localStorage.setItem(BROWSER_CACHE_KEY, JSON.stringify({ ...value, _cached_at: Date.now() }));
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
    candidate,
  };
}

function DiscoveryTrackCard({
  candidate, currentPreviewMbid, playing, phase, onPlay, onQuickAdd,
}: {
  candidate: DiscoveryCandidate;
  currentPreviewMbid: string | null;
  playing: boolean;
  phase?: ReturnType<typeof downloadPhase>;
  onPlay: (candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
}) {
  const isPlaying = currentPreviewMbid === candidate.recording_mbid && playing;
  const [coverFailed, setCoverFailed] = useState(false);
  const coverId = candidate.release_mbid && /^[0-9a-f-]{36}$/i.test(candidate.release_mbid) ? candidate.release_mbid : null;
  const cover = coverId && !coverFailed ? `https://coverartarchive.org/release/${encodeURIComponent(coverId)}/front-250` : null;
  const busy = phase === "queued" || phase === "searching" || phase === "downloading";
  const complete = phase === "indexed" || phase === "existing";
  const status = busy ? "Downloading" : complete ? "Saved" : phase === "failed" ? "Retry download" : "Download";
  return (
    <article className="discovery-cover-card">
      <button className="discovery-cover-art" type="button"
        onClick={() => onPlay(candidate)}
        onPointerEnter={() => api.prefetchYoutubePreview(candidate.artist, candidate.title)}
        title={`Play ${candidate.artist} - ${candidate.title}`}
        aria-label={`Play ${candidate.title}`}>
        {cover ? <img src={cover} loading="lazy" alt="" onError={() => setCoverFailed(true)} /> : (
          <span className="discovery-cover-fallback" aria-hidden="true">{candidate.artist.slice(0, 2).toUpperCase()}</span>
        )}
        <span className={isPlaying ? "discovery-cover-play is-playing" : "discovery-cover-play"} aria-hidden="true">
          {isPlaying ? "Ⅱ" : "▶"}
        </span>
      </button>
      <button type="button"
        className={`discovery-cover-quick-download ${busy ? "is-working" : ""} ${complete ? "is-complete" : ""} ${phase === "failed" ? "is-failed" : ""}`}
        aria-label={`${status} ${candidate.title}`} title={`${status}: ${candidate.title}`}
        disabled={busy || complete} onClick={() => onQuickAdd(candidate)}>
        <span aria-hidden="true">{complete ? "✓" : busy ? "…" : phase === "failed" ? "↻" : "↓"}</span>
      </button>
      <div className="discovery-cover-copy">
        <strong title={candidate.title}>{candidate.title}</strong>
        <small title={candidate.artist}>{candidate.artist}</small>
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [followRequest, setFollowRequest] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  if (items.length === 0) return <p className="muted">Preparing musical discoveries.</p>;

  const candidate = items[Math.min(selectedIndex, items.length - 1)] ?? items[0];
  const phase = downloadPhase(candidate.recording_mbid);
  const busy = phase === "queued" || phase === "searching" || phase === "downloading";
  const complete = phase === "indexed" || phase === "existing";
  const liked = taste[candidate.recording_mbid]?.value ?? candidate.feedback ?? 0;
  return (
    <section className="discovery-cover-shelf" aria-label="All Discovery recommendations">
      <div className="waxloom-discovery-vinyl">
        <VinylRack count={items.length} contentKey={items[0]?.recording_mbid}
          label="Discover tracks. Tap cover to play a preview, or choose actions below."
          variant="discovery"
          records={items.map((item) => ({ title: item.title, artist: item.artist }))}
          followIndex={items.findIndex((item) => item.recording_mbid === currentPreviewMbid)}
          followRequest={followRequest}
          onSelectionChange={(index) => { setSelectedIndex(index); setOptionsOpen(false); }}>
          {items.map((item) => (
            <div key={item.recording_mbid} className="waxloom-vinyl-sleeve waxloom-vinyl-sleeve--discovery">
              <DiscoveryTrackCard candidate={item}
                currentPreviewMbid={currentPreviewMbid} playing={playing}
                phase={downloadPhase(item.recording_mbid)}
                onPlay={(track) => { setFollowRequest((value) => value + 1); onPlayQueue(items, track); }}
                onQuickAdd={onQuickAdd} />
            </div>
          ))}
        </VinylRack>
        <div className="waxloom-vinyl-context">
          <button type="button" className="waxloom-vinyl-context-trigger"
            aria-label={`Options for ${candidate.title}`}
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((value) => !value)}>
            <span aria-hidden="true">···</span> {busy ? "Downloading…" : complete ? "Saved · Options" : "Options"}
          </button>
        </div>
        {optionsOpen && (
          <div className="waxloom-vinyl-context-panel" role="group" aria-label={`Actions for ${candidate.title}`}>
            <button type="button" disabled={busy || complete}
              onClick={() => { onQuickAdd(candidate); setOptionsOpen(false); }}>
              {complete ? "✓ In library" : busy ? "Downloading…" : phase === "failed" ? "↻ Retry download" : "+ Download"}
            </button>
            <button type="button" aria-pressed={liked === 1}
              onClick={() => { onFeedback(candidate, liked === 1 ? 0 : 1); setOptionsOpen(false); }}>
              {liked === 1 ? "✓ Liked" : "♡ More like this"}
            </button>
            <button type="button" aria-pressed={liked === -1}
              onClick={() => { onFeedback(candidate, liked === -1 ? 0 : -1); setOptionsOpen(false); }}>
              {liked === -1 ? "✓ Less like this" : "↓ Less like this"}
            </button>
            {candidate.source === "youtube_dig" && (
              <button type="button" disabled={rejectingMbid === candidate.recording_mbid}
                onClick={() => { onBadSource(candidate); setOptionsOpen(false); }}>
                Not music / bad source
              </button>
            )}
          </div>
        )}
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
  const [refreshing, setRefreshing] = useState(false);
  const refreshFromRef = useRef<string | null>(null);
  const downloads = useDownloads();

  // Read status while waiting for a manually requested refresh, but never
  // silently replace the crate when the server rotates its feed.
  useEffect(() => {
    let cancelled = false;
    const readFeed = async () => {
      try {
        const value = await api.discoveryFeed();
        if (cancelled) return;
        setFeedStatus(value.status);
        if (value.profile && value.external.items.length > 0) {
          const version = `${value.rotation_id ?? ""}:${value.generated_at ?? ""}`;
          if (!bundle || (refreshing && version !== refreshFromRef.current && value.status === "ready")) {
            storeBrowserFeed(value);
            setBundle(value);
            if (refreshing) {
              setRefreshing(false);
              setNotice("New Discovery selection is ready.");
            }
          }
        } else if (value.error) {
          setError(value.error);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Discovery feed is unavailable.");
      }
    };
    void readFeed();
    // Initial-feed recovery and explicitly requested refresh only.
    if (!bundle || refreshing) {
      const timer = window.setInterval(() => { void readFeed(); }, 5_000);
      return () => { cancelled = true; window.clearInterval(timer); };
    }
    return () => { cancelled = true; };
  }, [Boolean(bundle), refreshing]);

  useEffect(() => {
    const onTaste = () => setTaste(readTaste());
    window.addEventListener("waxloom:discovery-taste", onTaste);
    window.addEventListener("storage", onTaste);
    return () => {
      window.removeEventListener("waxloom:discovery-taste", onTaste);
      window.removeEventListener("storage", onTaste);
    };
  }, []);

  // Once displayed, changing taste never shuffles or removes covers mid-listen.
  // Fresh ranking is applied when a newly requested Discovery feed is accepted.
  const recommendations = useMemo(
    () => diversify(activeCandidates(bundle?.external.items ?? [], readTaste()), 3),
    [bundle],
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
      refreshFromRef.current = `${bundle?.rotation_id ?? ""}:${bundle?.generated_at ?? ""}`;
      await api.refreshDiscoveryFeed();
      setRefreshing(true);
      setFeedStatus("refreshing");
      setNotice("Preparing new discoveries. Your current tracks stay in place until the new selection is ready.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not queue a Discovery refresh.");
    }
  }

  function playDiscoveryQueue(items: DiscoveryCandidate[], candidate: DiscoveryCandidate) {
    const queue = items.map(asPreviewTrack);
    const index = Math.max(0, items.findIndex((item) => item.recording_mbid === candidate.recording_mbid));
    player.playPreviewTracks(queue, index, onImportCandidate);
  }

  function updateFeedback(candidate: DiscoveryCandidate, value: -1 | 0 | 1) {
    const next = { ...readTaste() };
    if (value === 0) delete next[candidate.recording_mbid];
    else next[candidate.recording_mbid] = {
      value, artist: candidate.artist, tags: candidate.tags ?? [],
    };
    writeTaste(next);
    setTaste(next);

    setNotice(value > 0
      ? "Taste updated — Waxloom will favor nearby artists and tags."
      : value < 0
        ? "Taste updated — Waxloom will show less from this musical neighbourhood."
        : "Taste feedback cleared.");

    void api.discoveryFeedback(candidate, value)
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the bad-source report.");
      setBundle(bundle);
      if (bundle) storeBrowserFeed(bundle);
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
          <button className="secondary-action" type="button" disabled={refreshing} onClick={() => void requestBackgroundRefresh()} title="Replace the current selection with new suggestions when ready">↻ New music</button>
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
