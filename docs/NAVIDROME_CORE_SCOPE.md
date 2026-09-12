# Waxloom Navidrome core scope

Waxloom is intended to become the primary user-facing client for the connected Navidrome server, not a playlist-only viewer.

This tranche targets the daily-use Navidrome surface that should exist before Discovery/Imports become the main differentiator:

- albums and artists browsing;
- album and artist details;
- full-text search across artists, albums and songs;
- starred/favorites;
- audio streaming through Waxloom without exposing Navidrome credentials to the browser;
- cover-art proxying;
- player controls, queue, previous/next, seek, volume, repeat and shuffle;
- scrobble/now-playing reporting;
- persisted Navidrome play queue;
- playlist browsing plus create, rename, delete, add-song and remove-song operations;
- clear separation between implemented Navidrome core and future Waxloom-only layers (Discovery, AudioMuse workflows, Imports).

Navidrome parity that remains outside this single music-player tranche: admin/user management, public shares, internet-radio management, podcasts, bookmarks/audiobooks, jukebox-server hardware control, and smart-playlist authoring. Those can be added as dedicated later tranches without blocking the core music-player experience.
