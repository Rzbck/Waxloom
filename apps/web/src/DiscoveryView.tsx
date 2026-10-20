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

import { useLibraryPresence, verifyLibraryPresence } from "./libraryPresence";
import "./discovery.css";

type TasteEntry = {
  value: -1 | 1;
  artist: string;
  tags: string[];
};

type TasteState = Record<string, TasteEntry>;


const BROWSER_CACHE_KEY = "waxloom.discovery.feed.v4";
const BROWSER_CACHE_AGE_MS = 2 * 60 * 1000;
const TASTE_KEY = "waxloom.discovery.taste.v1";
// Local presentation-only suppression; NEVER sent to taste feedback.
const DISMISSED_KEY = "waxloom.discovery.dismissed.v1";
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
function readDismissed(): Record<string, number> {
  try {
    const value = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || "{}") as Record<string, number>;
    if (!value || typeof value !== "object") return {};
    const now = Date.now();
    return Object.fromEntries(Object.entries(value).filter(([key, at]) =>
      key.length > 0 && typeof at === "number" && at <= now && now - at < DISMISS_TTL_MS));
  } catch { return {}; }
}
function storeDismissed(value: Record<string, number>) {
  try { window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(value)); } catch { /* optional */ }
}

const SOURCE_REJECT_TAG = "__waxloom_source:not_music__";
const SHELF_PAGE_SIZE = 12;
const SHELF_TARGET_SIZE = 20;
// A ready server snapshot can expose only a couple of M4A previews while the
// larger candidate pool is still warming. Do not lock that partial shelf.
const MIN_READY_DISCOVERIES = 12;

function readyTarget(value: DiscoveryFeedResponse): number {
  const external = value.external as typeof value.external & { pool_count?: number };
  const pool = external.pool_count;
  return Math.min(MIN_READY_DISCOVERIES, Math.max(1,
    typeof pool === "number" && pool > 0 ? pool : MIN_READY_DISCOVERIES,
  ));
}

function feedVersion(value: DiscoveryFeedResponse | null): string {
  return String(value?.rotation_id ?? "") + ":" + String(value?.generated_at ?? "");
}


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
  candidate, currentPreviewMbid, playing, phase, owned, onPlay, onQuickAdd, onDismiss,
}: {
  candidate: DiscoveryCandidate;
  currentPreviewMbid: string | null;
  playing: boolean;
  phase?: ReturnType<typeof downloadPhase>;
  owned: boolean | null;
  onPlay: (candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
  onDismiss: (candidate: DiscoveryCandidate) => void;
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
        onPointerEnter={() => api.prefetchDiscoveryAudio(candidate.recording_mbid, candidate.artist, candidate.title)}
        title={`Play ${candidate.artist} - ${candidate.title}`}
        aria-label={`Play ${candidate.title}`}>
        {cover ? <img src={cover} loading="lazy" alt="" onError={() => setCoverFailed(true)} /> : (
          <span className="discovery-cover-fallback" aria-hidden="true">{candidate.artist.slice(0, 2).toUpperCase()}</span>
        )}
        <span className={isPlaying ? "discovery-cover-play is-playing" : "discovery-cover-play"} aria-hidden="true">
          {isPlaying ? "Ⅱ" : "▶"}
        </span>
      </button>
      <button type="button" className="discovery-cover-neutral-remove"
        title={"Remove " + candidate.title + " from Discovery without changing taste"}
        aria-label={"Remove " + candidate.title + " from Discovery"}
        onClick={() => onDismiss(candidate)}>
        <span aria-hidden="true">×</span>
      </button>
      {owned === false && !complete && (
      <button type="button"
        className={`discovery-cover-quick-download ${busy ? "is-working" : ""} ${complete ? "is-complete" : ""} ${phase === "failed" ? "is-failed" : ""}`}
        aria-label={`${status} ${candidate.title}`} title={`${status}: ${candidate.title}`}
        disabled={busy} onClick={() => onQuickAdd(candidate)}>
        <span aria-hidden="true">{complete ? "✓" : busy ? "…" : phase === "failed" ? "↻" : "↓"}</span>
      </button>
      )}
      <div className="discovery-cover-copy">
        <strong title={candidate.title}>{candidate.title}</strong>
        <small title={candidate.artist}>{candidate.artist}</small>
      </div>
    </article>
  );
}

function DiscoveryShelf({
  items, currentPreviewMbid, playing, rejectingMbid, taste, ownership, onPlayQueue, onQuickAdd, onFeedback, onBadSource, onDismiss,
}: {
  items: DiscoveryCandidate[];
  currentPreviewMbid: string | null;
  playing: boolean;
  rejectingMbid: string | null;
  taste: TasteState;
  ownership: ReadonlyMap<string, "present" | "absent">;
  onPlayQueue: (items: DiscoveryCandidate[], candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
  onFeedback: (candidate: DiscoveryCandidate, value: -1 | 0 | 1) => void;
  onBadSource: (candidate: DiscoveryCandidate) => void;
  onDismiss: (candidate: DiscoveryCandidate) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [followRequest, setFollowRequest] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Do not start HTTP requests for every transient sleeve crossed by a
  // fast wheel fling. Prefetch only the final selected vinyl after settling.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const item of items.slice(selectedIndex, selectedIndex + 2)) {
        api.prefetchDiscoveryAudio(item.recording_mbid, item.artist, item.title);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [items, selectedIndex]);

  if (items.length === 0) return <p className="muted">Preparing musical discoveries.</p>;

  const candidate = items[Math.min(selectedIndex, items.length - 1)] ?? items[0];
  const phase = downloadPhase(candidate.recording_mbid);
  const busy = phase === "queued" || phase === "searching" || phase === "downloading";
  const complete = phase === "indexed" || phase === "existing";
  const mayDownload = !complete && ownership.get(candidate.recording_mbid) === "absent";
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
          onSelectionChange={(index) => {
            setSelectedIndex(index);
            setOptionsOpen(false);
          }}>
          {items.map((item) => (
            <div key={item.recording_mbid} className="waxloom-vinyl-sleeve waxloom-vinyl-sleeve--discovery">
              <DiscoveryTrackCard candidate={item}
                currentPreviewMbid={currentPreviewMbid} playing={playing}
                phase={downloadPhase(item.recording_mbid)}
                owned={ownership.get(item.recording_mbid) === undefined ? null : ownership.get(item.recording_mbid) === "present"}
                onPlay={(track) => { setFollowRequest((value) => value + 1); onPlayQueue(items, track); }}
                onQuickAdd={onQuickAdd} onDismiss={onDismiss} />
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
            {mayDownload && (
            <button type="button" disabled={busy}
              onClick={() => { onQuickAdd(candidate); setOptionsOpen(false); }}>
              {complete ? "✓ In library" : busy ? "Downloading…" : phase === "failed" ? "↻ Retry download" : "+ Download"}
            </button>
            )}
            <button type="button" aria-pressed={liked === 1}
              onClick={() => { onFeedback(candidate, liked === 1 ? 0 : 1); setOptionsOpen(false); }}>
              {liked === 1 ? "✓ Liked" : "♡ More like this"}
            </button>
            <button type="button" aria-pressed={liked === -1}
              onClick={() => { onFeedback(candidate, liked === -1 ? 0 : -1); setOptionsOpen(false); }}>
              {liked === -1 ? "✓ Less like this" : "↓ Less like this"}
            </button>
            <button type="button"
              onClick={() => { onDismiss(candidate); setOptionsOpen(false); }}>
              × Remove from Discovery (neutral)
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
  const [dismissed, setDismissed] = useState<Record<string, number>>(() => readDismissed());
  const [refreshing, setRefreshing] = useState(false);
  const refreshFromRef = useRef<string | null>(null);
  const pageRef = useRef(0);
  const downloads = useDownloads();
  const ownership = useLibraryPresence();
  const playedOnceRef = useRef(false);

  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;
  const hydrationPending = bundle !== null
    && bundle.external.items.length < readyTarget(bundle);

  // Poll only when manually refreshing or when a persisted shelf was captured
  // before its background preview downloads finished. Retain the current
  // shelf until the new one has enough independently playable previews.
  useEffect(() => {
    let cancelled = false;
    const readFeed = async () => {
      try {
        const value = await api.discoveryFeed();
        if (cancelled) return;
        setFeedStatus(value.status);
        // The backend retains its previous snapshot on refresh failure.
        // Do not leave New music disabled forever when that happens.
        if (value.error) {
          setError(value.error);
          if (refreshing) {
            setRefreshing(false);
            setNotice("New music could not refresh. Your previous tracks are still available.");
          }
          return;
        }
        if (value.profile && value.external.items.length > 0) {
          const current = bundleRef.current;
          const enough = value.external.items.length >= readyTarget(value);
          const newVersion = feedVersion(value);
          const oldVersion = feedVersion(current);
          const isFreshRefresh = refreshing && value.status === "ready"
            && value.generated_at !== refreshFromRef.current;
          if (!current) {
            // First visit can display a partial batch, but must keep
            // checking: "ready" refers to the feed, not preview readiness.
            setBundle(value);
            storeBrowserFeed(value);
          } else if (refreshing) {
            if (isFreshRefresh && enough) {
              setBundle(value);
              storeBrowserFeed(value);
              setRefreshing(false);
              setNotice("New Discovery selection is ready.");
            } else {
              setNotice("Preparing new discoveries. Your current tracks stay visible until more previews are ready.");
            }
          } else if (!playedOnceRef.current && !refreshing
              && current.generated_at !== value.generated_at && enough) {
            // A stale browser shelf may reference previews no longer cached.
            // Replace it before first Play, never disrupt a running preview.
            setBundle(value);
            storeBrowserFeed(value);
          } else if (value.generated_at === current.generated_at
              && value.external.items.some((item) => !current.external.items.some((previous) => previous.recording_mbid === item.recording_mbid))) {
            const seen = new Set(current.external.items.map((item) => item.recording_mbid));
            const extras = value.external.items.filter((item) => !seen.has(item.recording_mbid));
            const updated: DiscoveryFeedResponse = {
              ...current, external: { ...current.external,
                items: [...current.external.items, ...extras],
                count: current.external.items.length + extras.length,
              },
            };
            setBundle(updated);
            storeBrowserFeed(updated);
          }
        } else if (value.error) {
          setError(value.error);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Discovery feed is unavailable.");
      }
    };
    void readFeed();
    // Background preview preparation continues even when the page is closed.
    // Periodic inexpensive reads keep the visible reserve freshly populated.
    const timer = window.setInterval(() => { void readFeed(); }, refreshing || hydrationPending ? 5_000 : 12_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [Boolean(bundle), refreshing, hydrationPending]);

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
  const stableRecommendationsRef = useRef<{ version: string; items: DiscoveryCandidate[] } | null>(null);
  const recommendations = useMemo(() => {
    const raw = bundle?.external.items ?? [];
    const version = feedVersion(bundle);
    const ranked = diversify(activeCandidates(
      raw.filter((candidate) => dismissed[candidate.recording_mbid] === undefined), taste,
    ), 3);
    const previous = stableRecommendationsRef.current;
    if (!previous || previous.version !== version) {
      stableRecommendationsRef.current = { version, items: ranked };
      return ranked;
    }
    // New warmed previews must be appended, not jump ahead of a playing
    // cover and desynchronize the player's vinyl, title and Options.
    const allowed = new Map(ranked.map((candidate) => [candidate.recording_mbid, candidate]));
    const kept = previous.items
      .filter((item) => allowed.has(item.recording_mbid))
      .map((item) => allowed.get(item.recording_mbid) ?? item);
    const existing = new Set(kept.map((item) => item.recording_mbid));
    const byArtist = new Map<string, number>();
    for (const item of kept) {
      const artist = folded(item.artist);
      byArtist.set(artist, (byArtist.get(artist) ?? 0) + 1);
    }
    for (const item of ranked) {
      const artist = folded(item.artist);
      if (existing.has(item.recording_mbid) || (byArtist.get(artist) ?? 0) >= 3) continue;
      kept.push(item);
      existing.add(item.recording_mbid);
      byArtist.set(artist, (byArtist.get(artist) ?? 0) + 1);
    }
    stableRecommendationsRef.current = { version, items: kept };
    return kept;
  }, [bundle, taste, dismissed]);
  // Keep a small playable reserve off-screen: Less replaces its sleeve
  // immediately and New music can offer unseen tracks without a download.
  // Reserve size is based on the raw pool, not the filtered count, so
  // removing one disliked song cannot make the shelf itself shrink.
  const visibleTarget = Math.min(recommendations.length,
    Math.max(12, Math.min(SHELF_TARGET_SIZE, (bundle?.external.items.length ?? 0) - 6)));

  useEffect(() => {
    const visible = recommendations.slice(0, visibleTarget);
    verifyLibraryPresence(visible);
    // Warm only the first three audio streams via bounded HTTP byte ranges,
    // not unrelated YouTube searches when a user hovers an album cover.
    const timer = window.setTimeout(() => {
      for (const item of visible.slice(0, 3)) {
        api.prefetchDiscoveryAudio(item.recording_mbid, item.artist, item.title);
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [recommendations, visibleTarget]);

  // Provider audio is now warmed by the server independently. Running 60
  // extra YouTube searches on entering Discovery starved initial playback.

  async function requestBackgroundRefresh() {
    if (refreshing) return;
    setNotice(null);
    setError(null);
    const current = bundleRef.current;
    const displayed = new Set(recommendations.slice(0, visibleTarget)
      .map((item) => item.recording_mbid));
    try {
      // Browsing the prewarmed reserve is instant and does not re-run
      // multi-provider harvesting with every New music click.
      for (let attempt = 0; attempt < 3; attempt++) {
        const page = ++pageRef.current;
        const value = await api.discoveryFeed(page);
        const novel = value.external.items
          .slice(0, SHELF_TARGET_SIZE).filter((item) => !displayed.has(item.recording_mbid));
        if (novel.length >= Math.min(6, Math.max(1, value.external.items.length - SHELF_TARGET_SIZE))) {
          setBundle(value);
          storeBrowserFeed(value);
          setFeedStatus(value.status);
          setNotice("New music from the ready-to-play reserve.");
          return;
        }
      }
      // The finite ready-to-play reserve was exhausted. Preserve the
      // current shelf while the background provider harvest runs.
      refreshFromRef.current = current?.generated_at ?? null;
      await api.refreshDiscoveryFeed();
      setRefreshing(true);
      setFeedStatus("refreshing");
      setNotice("More music is being prepared in the background. Keep listening to your current selection.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not browse new Discovery music.");
    }
  }

  function playDiscoveryQueue(items: DiscoveryCandidate[], candidate: DiscoveryCandidate) {
    playedOnceRef.current = true;
    const queue = items.map(asPreviewTrack);
    const index = Math.max(0, items.findIndex((item) => item.recording_mbid === candidate.recording_mbid));
    player.playPreviewTracks(queue, index, onImportCandidate);
  }

  function dismissNeutral(candidate: DiscoveryCandidate) {
    const next = { ...readDismissed(), [candidate.recording_mbid]: Date.now() };
    storeDismissed(next);
    setDismissed(next);
    setNotice("Removed from Discovery for 24 hours. No like, dislike or taste signal was recorded.");
    setError(null);
    // The ready reserve already contains additional playable recommendations.
    // Never call backend taste feedback or remove audio from the library.
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
          <span>{visibleTarget} tracks · {refreshing ? "preparing new music" : hydrationPending ? "preparing more previews" : feedStatus === "ready" ? "ready" : feedStatus} · {formatFeedTime(bundle?.generated_at)}</span>
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
        <DiscoveryShelf items={recommendations.slice(0, visibleTarget)}
          currentPreviewMbid={currentPreviewMbid} playing={player.playing}
          rejectingMbid={rejecting} taste={taste} ownership={ownership}
          onPlayQueue={playDiscoveryQueue} onQuickAdd={addToLibrary}
          onFeedback={updateFeedback}
          onBadSource={(candidate) => void rejectBadSource(candidate)}
          onDismiss={dismissNeutral} />
      ) : <div className="discovery-fit-message">Preparing the first discoveries…</div>}
    </div>
  );
}
