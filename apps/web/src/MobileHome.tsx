import type { Song } from "./types";
import { VinylSongs } from "./VinylSongs";

export type MobileHomeProps = {
  recent: Song[];
  starOverrides: Record<string, boolean>;
  onToggleStar: (song: Song) => void;
  onAddPlaylist: (song: Song) => void;
  onBrowseAlbums: () => void;
  onRefreshRecent: () => void;
};

// One music-first Home collection. These are SONGS, not single-track albums.
// Selecting any cover plays that song and the next contextual tracks.
// The dedicated Albums tab remains the place for album-based browsing.
export function MobileHome({
  recent, starOverrides, onToggleStar, onAddPlaylist, onBrowseAlbums, onRefreshRecent,
}: MobileHomeProps) {
  return (
    <div className="waxloom-mobile-home" aria-label="Home music collection">
      <section className="waxloom-mobile-home-crate" aria-labelledby="waxloom-crate-heading">
        <header className="waxloom-mobile-home-section-head">
          <div>
            <span className="waxloom-home-overline">JUST ARRIVED</span>
            <h2 id="waxloom-crate-heading">Fresh tracks</h2>
            <p>Tap a song. Music keeps playing afterwards.</p>
          </div>
          <button className="waxloom-home-see-all" type="button" onClick={onRefreshRecent}>
            Refresh
          </button>
        </header>
        {recent.length ? (
          <VinylSongs songs={recent} ordered starOverrides={starOverrides}
            onToggleStar={onToggleStar} onAddPlaylist={onAddPlaylist} />
        ) : <p className="waxloom-home-empty">Recently imported tracks will appear here.</p>}
      </section>
      <button className="waxloom-home-explore" type="button" onClick={onBrowseAlbums}>
        <span><strong>Explore the library</strong><small>Albums, artists, playlists and more</small></span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
