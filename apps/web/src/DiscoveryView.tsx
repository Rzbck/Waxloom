import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "./api";
import type {
  AutomaticDiscoveryResponse,
  DiscoveryCandidate,
  PlaylistSummary,
} from "./types";

import "./discovery.css";

type ArtistGroup = {
  key: string;
  artist: string;
  items: DiscoveryCandidate[];
  bestRank: number;
  bestUnderground: number;
};

type PreviewState = {
  recordingMbid: string;
  embedUrl: string;
  sourceTitle: string;
};

const CACHE_MS = 10 * 60 * 1000;
let discoveryCache: { at: number; value: AutomaticDiscoveryResponse } | null = null;
let discoveryPromise: Promise<AutomaticDiscoveryResponse> | null = null;

function scorePercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function artistKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function groupCandidates(items: DiscoveryCandidate[]): ArtistGroup[] {
  const groups = new Map<string, ArtistGroup>();
  for (const candidate of items) {
    const key = artistKey(candidate.artist) || candidate.recording_mbid;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(candidate);
      existing.bestRank = Math.max(existing.bestRank, candidate.rank);
      existing.bestUnderground = Math.max(existing.bestUnderground, candidate.underground);
    } else {
      groups.set(key, {
        key,
        artist: candidate.artist,
        items: [candidate],
        bestRank: candidate.rank,
        bestUnderground: candidate.underground,
      });
    }
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => b.rank - a.rank);
  }
  return [...groups.values()].sort((a, b) => b.bestRank - a.bestRank);
}

function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase();
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (host.endsWith("youtube.com")) {
      const direct = url.searchParams.get("v");
      if (direct) return direct;
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0] ?? "")) return parts[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

async function loadAutomatic(force: boolean): Promise<AutomaticDiscoveryResponse> {
  if (!force && discoveryCache && Date.now() - discoveryCache.at < CACHE_MS) {
    return discoveryCache.value;
  }
  if (!force && discoveryPromise) return discoveryPromise;
  const promise = api.automaticDiscovery(force, 80);
  discoveryPromise = promise;
  try {
    const value = await promise;
    discoveryCache = { at: Date.now(), value };
    return value;
  } finally {
    if (discoveryPromise === promise) discoveryPromise = null;
  }
}

function ArtistGroupCard({
  group,
  preview,
  previewLoading,
  onPreview,
  onQuickAdd,
}: {
  group: ArtistGroup;
  preview: PreviewState | null;
  previewLoading: string | null;
  onPreview: (candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.items : group.items.slice(0, 3);

  return (
    <article className="artist-discovery-card">
      <header className="artist-discovery-head">
        <div>
          <p>{group.artist}</p>
          <span>{group.items.length} suggestion{group.items.length > 1 ? "s" : ""}</span>
        </div>
        <b>{scorePercent(group.bestRank)}</b>
      </header>

      <div className="artist-track-stack">
        {visible.map((candidate) => (
          <div className="artist-track-row" key={candidate.recording_mbid}>
            <div className="artist-track-copy">
              <strong>{candidate.title}</strong>
              <span>{candidate.release || candidate.reason || "Outside your library"}</span>
            </div>
            <button
              className="compact-action"
              type="button"
              onClick={() => onPreview(candidate)}
              disabled={previewLoading === candidate.recording_mbid}
              title="Preview"
            >
              {previewLoading === candidate.recording_mbid ? "…" : "▶"}
            </button>
            <button className="compact-action compact-action-add" type="button" onClick={() => onQuickAdd(candidate)} title="Add to playlist">
              +
            </button>

            {preview?.recordingMbid === candidate.recording_mbid && (
              <div className="inline-preview">
                <iframe
                  src={preview.embedUrl}
                  title={`Preview ${candidate.artist} - ${candidate.title}`}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
                <small>{preview.sourceTitle}</small>
              </div>
            )}
          </div>
        ))}
      </div>

      <footer className="artist-discovery-foot">
        <span>{group.items[0]?.tags?.slice(0, 3).join(" · ") || group.items[0]?.source || "recommendation"}</span>
        {group.items.length > 3 && (
          <button className="text-action" type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Collapse" : `+${group.items.length - 3} tracks`}
          </button>
        )}
      </footer>
    </article>
  );
}

function DiscoveryRail({
  eyebrow,
  title,
  subtitle,
  groups,
  preview,
  previewLoading,
  onPreview,
  onQuickAdd,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  groups: ArtistGroup[];
  preview: PreviewState | null;
  previewLoading: string | null;
  onPreview: (candidate: DiscoveryCandidate) => void;
  onQuickAdd: (candidate: DiscoveryCandidate) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  if (groups.length === 0) return null;

  function scroll(direction: -1 | 1) {
    railRef.current?.scrollBy({ left: direction * Math.max(360, window.innerWidth * 0.65), behavior: "smooth" });
  }

  return (
    <section className="discovery-rail-section">
      <div className="section-toolbar discovery-rail-toolbar">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>
        </div>
        <div className="rail-arrows">
          <button type="button" onClick={() => scroll(-1)} aria-label="Scroll left">←</button>
          <button type="button" onClick={() => scroll(1)} aria-label="Scroll right">→</button>
        </div>
      </div>
      <div className="artist-discovery-rail" ref={railRef}>
        {groups.map((group) => (
          <ArtistGroupCard
            key={group.key}
            group={group}
            preview={preview}
            previewLoading={previewLoading}
            onPreview={onPreview}
            onQuickAdd={onQuickAdd}
          />
        ))}
      </div>
    </section>
  );
}

export function DiscoveryView({ onImportCandidate }: { onImportCandidate: (candidate: DiscoveryCandidate) => void }) {
  const [bundle, setBundle] = useState<AutomaticDiscoveryResponse | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [quickTarget, setQuickTarget] = useState<DiscoveryCandidate | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const [value, playlistPayload] = await Promise.all([
        loadAutomatic(force),
        api.playlists(),
      ]);
      setBundle(value);
      setPlaylists(playlistPayload.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Automatic discovery failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  const rails = useMemo(() => {
    const groups = groupCandidates(bundle?.external.items ?? []);
    const closest = groups.slice(0, 12);
    const used = new Set(closest.map((group) => group.key));
    const underground = [...groups]
      .filter((group) => !used.has(group.key) && group.items.some((item) => item.source === "listenbrainz"))
      .sort((a, b) => b.bestUnderground - a.bestUnderground || b.bestRank - a.bestRank)
      .slice(0, 12);
    underground.forEach((group) => used.add(group.key));
    const deep = groups
      .filter((group) => !used.has(group.key) && group.items.some((item) => item.source === "musicbrainz_catalog"))
      .slice(0, 12);
    return { closest, underground, deep, totalArtists: groups.length };
  }, [bundle]);

  async function previewCandidate(candidate: DiscoveryCandidate) {
    if (preview?.recordingMbid === candidate.recording_mbid) {
      setPreview(null);
      return;
    }
    setPreviewLoading(candidate.recording_mbid);
    setError(null);
    try {
      const payload = await api.youtubeSearch(candidate.artist, candidate.title);
      const best = payload.items[0];
      if (!best) throw new Error("No preview source found.");
      const id = youtubeVideoId(best.url);
      if (!id) throw new Error("The best source could not be embedded.");
      setPreview({
        recordingMbid: candidate.recording_mbid,
        embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`,
        sourceTitle: best.title,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preview search failed.");
    } finally {
      setPreviewLoading(null);
    }
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
      discoveryCache = null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Automatic import failed.");
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="discovery-layout discovery-auto-layout">
      <section className="panel discovery-profile-panel discovery-profile-compact">
        <div className="section-toolbar">
          <div>
            <p className="eyebrow">Automatic discovery · outside your library</p>
            <h2>Recommendations from your whole collection.</h2>
            <p className="muted">Waxloom scans the full Navidrome library, builds a diversified profile across artists and genres, then uses AudioMuse, ListenBrainz and MusicBrainz internally. Local songs are not shown here.</p>
          </div>
          <button className="secondary-action" type="button" onClick={() => void load(true)} disabled={loading}>Refresh</button>
        </div>
        {bundle && (
          <div className="profile-stat-grid profile-stat-grid-library">
            <div><strong>{bundle.profile.library_tracks}</strong><span>library tracks</span></div>
            <div><strong>{bundle.profile.library_albums}</strong><span>albums</span></div>
            <div><strong>{bundle.profile.library_artists}</strong><span>artists</span></div>
            <div><strong>{bundle.profile.library_genres}</strong><span>genres</span></div>
            <div><strong>{bundle.profile.representative_seeds}</strong><span>smart anchors</span></div>
          </div>
        )}
        {loading && <div className="discovery-building">Scanning your library and building recommendations…</div>}
        {error && <div className="state-card state-card-error">{error}</div>}
        {notice && <div className="state-card state-card-success">{notice}</div>}
      </section>

      {bundle && (
        <>
          <DiscoveryRail
            eyebrow={`Best matches · ${rails.totalArtists} artists found`}
            title="Closest to your collection"
            subtitle="Artists are grouped so one catalogue cannot flood the page. Scroll horizontally."
            groups={rails.closest}
            preview={preview}
            previewLoading={previewLoading}
            onPreview={(candidate) => void previewCandidate(candidate)}
            onQuickAdd={setQuickTarget}
          />
          <DiscoveryRail
            eyebrow="Dig deeper"
            title="More underground"
            subtitle="Less obvious ListenBrainz matches, still connected to the full-library profile."
            groups={rails.underground}
            preview={preview}
            previewLoading={previewLoading}
            onPreview={(candidate) => void previewCandidate(candidate)}
            onQuickAdd={setQuickTarget}
          />
          <DiscoveryRail
            eyebrow="Catalogue exploration"
            title="Deep cuts from neighbouring artists"
            subtitle="MusicBrainz catalogue paths reached through AudioMuse when collaborative similarity is sparse."
            groups={rails.deep}
            preview={preview}
            previewLoading={previewLoading}
            onPreview={(candidate) => void previewCandidate(candidate)}
            onQuickAdd={setQuickTarget}
          />

          {bundle.external.warning && bundle.external.count > 0 && (
            <div className="discovery-note">{bundle.external.warning}</div>
          )}
          {bundle.external.count === 0 && (
            <div className="state-card state-card-error">{bundle.external.warning ?? "No outside-library recommendation source returned a usable track."}</div>
          )}

          <details className="discovery-details">
            <summary>How Waxloom built this page</summary>
            <p>{bundle.profile.library_tracks} tracks · {bundle.profile.library_albums} albums · {bundle.profile.library_artists} artists · {bundle.profile.representative_seeds} diversified anchors.</p>
            {bundle.external.diagnostics && (
              <p>ListenBrainz: {bundle.external.diagnostics.resolved_seeds}/{bundle.external.diagnostics.requested_seeds} anchors resolved · {bundle.external.diagnostics.similar_rows} similarity rows · {bundle.external.diagnostics.catalog_fallback_candidates ?? 0} MusicBrainz fallback candidates · {bundle.external.diagnostics.local_duplicates_removed} local duplicates removed.</p>
            )}
          </details>
        </>
      )}

      {quickTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setQuickTarget(null)}>
          <section className="modal discovery-playlist-modal" role="dialog" aria-modal="true" aria-label="Download and add to playlist" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Download + add</p>
                <h3>{quickTarget.artist} — {quickTarget.title}</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setQuickTarget(null)}>×</button>
            </div>
            <p className="muted">Choose the destination playlist. Waxloom uses the highest-confidence source automatically; ambiguous matches fall back to manual source selection.</p>
            <div className="modal-list">
              {playlists.map((playlist) => (
                <button
                  className="modal-list-item"
                  type="button"
                  key={playlist.id}
                  disabled={importing === quickTarget.recording_mbid}
                  onClick={() => void addToPlaylist(playlist)}
                >
                  <strong>{playlist.name}</strong>
                  <span>{playlist.songCount ?? 0} tracks</span>
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
