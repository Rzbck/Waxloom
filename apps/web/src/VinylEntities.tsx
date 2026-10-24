import { useEffect, useState } from "react";
import { api } from "./api";
import { knownMusicValue } from "./albumDisplay";
import type { Artist, PlaylistSummary } from "./types";
import { VinylRack } from "./VinylRack";

const PAGE_SIZE = 24;

export function VinylArtists({ artists, onOpen }: {
  artists: Artist[];
  onOpen: (artist: Artist) => void;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [artists.length, artists[0]?.id]);
  if (!artists.length) return <p className="muted">No artists in this collection.</p>;
  const visible = artists.slice(0, limit);
  return (
    <div className="waxloom-entity-vinyl" aria-label="Artists as record sleeves">
      <VinylRack count={visible.length} contentKey={visible[0]?.id} variant="artist"
        label="Browse artists as vinyl sleeves"
        records={visible.map((artist) => ({title:knownMusicValue(artist.name) ?? "Artist not tagged",artist:`${artist.albumCount ?? 0} albums`}))}>
        {visible.map((artist,index) => (
          <article key={artist.id} className="waxloom-vinyl-sleeve waxloom-entity-sleeve">
            <button className="waxloom-entity-face" type="button" title={knownMusicValue(artist.name) ?? "Artist not tagged"}
              aria-label={`Open artist ${knownMusicValue(artist.name) ?? "Artist not tagged"}`} onClick={() => onOpen(artist)}>
              <span className="waxloom-entity-fallback">{(knownMusicValue(artist.name) ?? "Artist not tagged").slice(0,1).toUpperCase()}</span>
              {artist.coverArt && <img src={api.coverUrl(artist.coverArt,300)}
                loading={index<3?"eager":"lazy"} alt=""
                onError={(event)=>{event.currentTarget.hidden=true;}} />}
              <span className="waxloom-entity-open" aria-hidden="true">&nearr;</span>
            </button>
            <div className="waxloom-entity-copy">
              <strong title={knownMusicValue(artist.name) ?? "Artist not tagged"}>{knownMusicValue(artist.name) ?? "Artist not tagged"}</strong>
              <small>{artist.albumCount ?? 0} albums</small>
            </div>
          </article>
        ))}
      </VinylRack>
      {limit < artists.length && <button className="waxloom-vinyl-load-more" type="button"
        onClick={() => setLimit((n)=>Math.min(n+PAGE_SIZE,artists.length))}>
        More artists <span>{limit} / {artists.length}</span>
      </button>}
    </div>
  );
}

export function VinylPlaylists({ playlists, onOpen }: {
  playlists: PlaylistSummary[];
  onOpen: (playlist: PlaylistSummary) => void;
}) {
  if (!playlists.length) return <p className="muted">No playlists yet. Create one to start organizing your music.</p>;
  return (
    <div className="waxloom-entity-vinyl" aria-label="Playlists as record sleeves">
      <VinylRack count={playlists.length} contentKey={playlists[0]?.id} variant="playlist"
        label="Browse playlists as vinyl sleeves"
        records={playlists.map((playlist)=>({title:playlist.name,artist:`${playlist.songCount ?? 0} tracks`}))}>
        {playlists.map((playlist,index)=>(
          <article key={playlist.id} className="waxloom-vinyl-sleeve waxloom-entity-sleeve">
            <button className="waxloom-entity-face" type="button" title={playlist.name}
              aria-label={`Open playlist ${playlist.name}`} onClick={()=>onOpen(playlist)}>
              <span className="waxloom-entity-fallback">{playlist.name.slice(0,1).toUpperCase()}</span>
              {playlist.coverArt && <img src={api.coverUrl(playlist.coverArt,300)}
                loading={index<3?"eager":"lazy"} alt=""
                onError={(event)=>{event.currentTarget.hidden=true;}} />}
              <span className="waxloom-entity-open" aria-hidden="true">&nearr;</span>
            </button>
            <div className="waxloom-entity-copy">
              <strong title={playlist.name}>{playlist.name}</strong>
              <small>{playlist.songCount ?? 0} tracks</small>
            </div>
          </article>
        ))}
      </VinylRack>
    </div>
  );
}
