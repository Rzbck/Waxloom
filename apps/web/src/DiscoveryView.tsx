import { useEffect, useMemo, useState } from "react";

import { api } from "./api";
import { usePlayer } from "./Player";
import type {
  AudioMuseSimilarTrack,
  DiscoveryCandidate,
  DiscoveryResponse,
  Song,
} from "./types";

import "./discovery.css";

type ProfileStats = {
  playlists: number;
  playlistTracks: number;
  favorites: number;
  queueTracks: number;
  uniqueTracks: number;
  representativeSeeds: number;
  representativeArtists: number;
};

type AutomaticDiscovery = {
  profile: ProfileStats;
  seeds: Song[];
  localSimilar: AudioMuseSimilarTrack[];
  external: DiscoveryResponse;
};

type WeightedSong = { song: Song; score: number };

const CACHE_MS = 10 * 60 * 1000;
let discoveryCache: { at: number; value: AutomaticDiscovery } | null = null;

function scorePercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function normalizedArtist(song: Song): string {
  return (song.artist ?? "unknown artist").trim().toLocaleLowerCase();
}

function addWeighted(pool: Map<string, WeightedSong>, song: Song, score: number) {
  if (!song.id) return;
  const previous = pool.get(song.id);
  pool.set(song.id, { song, score: (previous?.score ?? 0) + score });
}

async function buildAutomaticDiscovery(currentSong: Song | null): Promise<AutomaticDiscovery> {
  const [playlistPayload, starred, queue, random] = await Promise.all([
    api.playlists(),
    api.starred(),
    api.playQueue(),
    api.randomSongs(100),
  ]);

  const playlistDetails = await Promise.all(
    playlistPayload.items.map((playlist) => api.playlist(playlist.id).catch(() => null)),
  );

  const pool = new Map<string, WeightedSong>();
  let playlistTracks = 0;

  for (const playlist of playlistDetails) {
    for (const song of playlist?.entry ?? []) {
      playlistTracks += 1;
      addWeighted(pool, song, 5);
    }
  }
  for (const song of starred.songs ?? []) addWeighted(pool, song, 10);
  for (const song of queue.entry ?? []) addWeighted(pool, song, 4);
  for (const song of random.items) addWeighted(pool, song, 1);
  if (currentSong) addWeighted(pool, currentSong, 12);

  const ranked = [...pool.values()].sort((a, b) => b.score - a.score || a.song.id.localeCompare(b.song.id));
  const artistCounts = new Map<string, number>();
  const seeds: Song[] = [];

  for (const item of ranked) {
    const artist = normalizedArtist(item.song);
    const count = artistCounts.get(artist) ?? 0;
    if (count >= 2) continue;
    seeds.push(item.song);
    artistCounts.set(artist, count + 1);
    if (seeds.length >= 24) break;
  }

  if (seeds.length < 12) {
    const known = new Set(seeds.map((song) => song.id));
    for (const song of random.items) {
      if (known.has(song.id)) continue;
      seeds.push(song);
      known.add(song.id);
      if (seeds.length >= 24) break;
    }
  }

  if (seeds.length === 0) throw new Error("Waxloom could not build a listening profile from your library.");

  const [external, localBatches] = await Promise.all([
    api.discover(seeds.map((song) => song.id), 0.75, 50),
    Promise.all(
      seeds.slice(0, 8).map((song) =>
        api.localSimilar(song.id, 10).catch(() => ({ items: [], count: 0 })),
      ),
    ),
  ]);

  const localBest = new Map<string, AudioMuseSimilarTrack>();
  const seedIds = new Set(seeds.map((song) => song.id));
  for (const batch of localBatches) {
    for (const track of batch.items) {
      if (!track.id || seedIds.has(track.id)) continue;
      const previous = localBest.get(track.id);
      if (
        !previous ||
        Number(track.similarity ?? 0) > Number(previous.similarity ?? 0)
      ) {
        localBest.set(track.id, track);
      }
    }
  }
  const localSimilar = [...localBest.values()]
    .sort((a, b) => Number(b.similarity ?? 0) - Number(a.similarity ?? 0))
    .slice(0, 24);

  return {
    profile: {
      playlists: playlistPayload.items.length,
      playlistTracks,
      favorites: starred.songs?.length ?? 0,
      queueTracks: queue.entry?.length ?? 0,
      uniqueTracks: pool.size,
      representativeSeeds: seeds.length,
      representativeArtists: new Set(seeds.map(normalizedArtist)).size,
    },
    seeds,
    localSimilar,
    external,
  };
}

function RecommendationCard({
  candidate,
  onImportCandidate,
}: {
  candidate: DiscoveryCandidate;
  onImportCandidate: (candidate: DiscoveryCandidate) => void;
}) {
  return (
    <article className="recommendation-card">
      <div className="recommendation-copy">
        <strong>{candidate.title}</strong>
        <span>{candidate.artist}</span>
        <small>{candidate.release || candidate.reason || "Outside your library"}</small>
        {candidate.reason && <p>{candidate.reason}</p>}
        {candidate.tags.length > 0 && (
          <div className="tag-row">
            {candidate.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}
      </div>
      <div className="recommendation-scores">
        <span>match <b>{scorePercent(candidate.similarity)}</b></span>
        {candidate.source === "listenbrainz" && (
          <span>underground <b>{scorePercent(candidate.underground)}</b></span>
        )}
      </div>
      <div className="discovery-actions">
        <a className="mini-action discovery-link" href={candidate.musicbrainz_url} target="_blank" rel="noreferrer">MB</a>
        <button className="primary-action" type="button" onClick={() => onImportCandidate(candidate)}>Find source →</button>
      </div>
    </article>
  );
}

function RecommendationRail({
  eyebrow,
  title,
  subtitle,
  items,
  onImportCandidate,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: DiscoveryCandidate[];
  onImportCandidate: (candidate: DiscoveryCandidate) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="recommendation-section">
      <div className="section-toolbar">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>
        </div>
      </div>
      <div className="recommendation-grid">
        {items.map((candidate) => (
          <RecommendationCard key={candidate.recording_mbid} candidate={candidate} onImportCandidate={onImportCandidate} />
        ))}
      </div>
    </section>
  );
}

export function DiscoveryView({ onImportCandidate }: { onImportCandidate: (candidate: DiscoveryCandidate) => void }) {
  const player = usePlayer();
  const [bundle, setBundle] = useState<AutomaticDiscovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      if (!force && discoveryCache && Date.now() - discoveryCache.at < CACHE_MS) {
        setBundle(discoveryCache.value);
        return;
      }
      const value = await buildAutomaticDiscovery(player.currentSong ?? null);
      discoveryCache = { at: Date.now(), value };
      setBundle(value);
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
    const items = bundle?.external.items ?? [];
    const close = items.slice(0, 16);
    const used = new Set(close.map((item) => item.recording_mbid));
    const underground = [...items]
      .filter((item) => item.source === "listenbrainz" && !used.has(item.recording_mbid))
      .sort((a, b) => b.underground - a.underground || b.rank - a.rank)
      .slice(0, 16);
    underground.forEach((item) => used.add(item.recording_mbid));
    const deepCuts = items
      .filter((item) => item.source === "musicbrainz_catalog" && !used.has(item.recording_mbid))
      .slice(0, 16);
    return { close, underground, deepCuts };
  }, [bundle]);

  return (
    <div className="discovery-layout discovery-auto-layout">
      <section className="panel discovery-profile-panel">
        <div className="section-toolbar">
          <div>
            <p className="eyebrow">Automatic discovery</p>
            <h2>Built from the music you already chose.</h2>
            <p className="muted">No seed picking and no Generate button. Waxloom reads your playlists, favorites, queue and library, then builds a diversified listening profile automatically.</p>
          </div>
          <button className="secondary-action" type="button" onClick={() => void load(true)} disabled={loading}>Refresh</button>
        </div>

        {bundle && (
          <div className="profile-stat-grid">
            <div><strong>{bundle.profile.playlists}</strong><span>playlists</span></div>
            <div><strong>{bundle.profile.uniqueTracks}</strong><span>profile tracks</span></div>
            <div><strong>{bundle.profile.favorites}</strong><span>favorites</span></div>
            <div><strong>{bundle.profile.representativeArtists}</strong><span>artists represented</span></div>
            <div><strong>{bundle.profile.representativeSeeds}</strong><span>smart anchors</span></div>
          </div>
        )}
        {loading && <div className="discovery-building">Analysing playlists, favorites and sonic neighbours…</div>}
        {error && <div className="state-card state-card-error">{error}</div>}
      </section>

      {bundle && bundle.localSimilar.length > 0 && (
        <section>
          <div className="section-toolbar">
            <div>
              <p className="eyebrow">AudioMuse · already yours</p>
              <h2>Sonic matches inside your library</h2>
              <p className="muted">Local tracks that sit close to the overall profile Waxloom built from your listening.</p>
            </div>
          </div>
          <div className="local-similar-grid">
            {bundle.localSimilar.slice(0, 18).map((track) => (
              <button
                className="local-similar-card"
                type="button"
                key={track.id}
                onClick={() => player.playNow({ id: track.id, title: track.title, artist: track.artist, album: track.album })}
              >
                <span className="local-play">▶</span>
                <div><strong>{track.title ?? "Unknown title"}</strong><span>{track.artist ?? "Unknown artist"}</span></div>
                <small>{typeof track.similarity === "number" ? scorePercent(track.similarity) : "AudioMuse"}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {bundle && (
        <>
          <RecommendationRail
            eyebrow="Best matches · outside your library"
            title="Closest to your taste right now"
            subtitle="Ranked from the full profile, not a single manually selected track."
            items={rails.close}
            onImportCandidate={onImportCandidate}
          />
          <RecommendationRail
            eyebrow="Dig deeper"
            title="More underground"
            subtitle="Lower-popularity ListenBrainz candidates that still remain connected to your profile."
            items={rails.underground}
            onImportCandidate={onImportCandidate}
          />
          <RecommendationRail
            eyebrow="AudioMuse → MusicBrainz"
            title="Deep cuts from neighbouring artists"
            subtitle="Fallback catalogue picks reached through artists that AudioMuse says are sonically close to you."
            items={rails.deepCuts}
            onImportCandidate={onImportCandidate}
          />

          {bundle.external.warning && bundle.external.count > 0 && (
            <div className="discovery-note">{bundle.external.warning}</div>
          )}
          {bundle.external.count === 0 && (
            <div className="state-card state-card-error">{bundle.external.warning ?? "No outside-library recommendation source returned a usable track."}</div>
          )}

          <details className="discovery-details">
            <summary>How Waxloom built this page</summary>
            <p>
              {bundle.profile.playlists} playlists · {bundle.profile.playlistTracks} playlist entries · {bundle.profile.queueTracks} queued · {bundle.profile.representativeSeeds} diversified anchors.
            </p>
            {bundle.external.diagnostics && (
              <p>
                ListenBrainz: {bundle.external.diagnostics.resolved_seeds}/{bundle.external.diagnostics.requested_seeds} seeds resolved · {bundle.external.diagnostics.similar_rows} similarity rows · {bundle.external.diagnostics.catalog_fallback_candidates ?? 0} MusicBrainz fallback candidates · {bundle.external.diagnostics.local_duplicates_removed} local duplicates removed.
              </p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
