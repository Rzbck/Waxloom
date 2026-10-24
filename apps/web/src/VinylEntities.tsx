import { api } from "./api";
import { ArtistCoverGrid } from "./LibraryGrids";
import type { Artist, PlaylistSummary } from "./types";
import { VinylRack } from "./VinylRack";

export function VinylArtists({ artists, onOpen }: {
  artists: Artist[];
  onOpen: (artist: Artist) => void;
}) {
  return <ArtistCoverGrid artists={artists} onOpen={onOpen}
    identity={`artists-${artists[0]?.id ?? "empty"}`} />;
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
              <span className="waxloom-entity-open" aria-hidden="true">↗</span>
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
