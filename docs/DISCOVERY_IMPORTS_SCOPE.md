# Waxloom discovery + import tranche

This tranche turns the remaining placeholder workflow into a working path:

1. choose one or more local Navidrome seed tracks;
2. resolve MusicBrainz recording IDs when needed;
3. request ListenBrainz Labs similar recordings;
4. filter obvious duplicates already present in the local library;
5. rank candidates with similarity plus an underground weighting;
6. expose AudioMuse local sonic similarity for local-library exploration;
7. search YouTube candidates for one external discovery using the proven ShazamDownloader scoring model;
8. require explicit user selection of the source candidate;
9. download only user-authorized media into the configured Navidrome music library;
10. trigger a Navidrome scan and optionally add the imported track to a selected playlist.

Security invariants:

- provider secrets remain backend-only;
- browser never receives Navidrome credentials, AudioMuse token, cookies, or filesystem paths;
- import paths are constrained under the configured music library root;
- no automatic YouTube candidate selection/download without an explicit user choice;
- the public repository contains no media, cookies, local database, or private library export.

This tranche establishes the complete user-visible discovery-to-library pipeline and keeps providers behind adapters so more sources can be added later.
