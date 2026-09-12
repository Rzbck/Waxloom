# Waxloom architecture

## Product constraint

Waxloom must present **one user-facing application** even when several self-hosted services are used underneath it.

Users should not need to open Navidrome, AudioMuse-AI, MusicBrainz, ListenBrainz, or provider-specific local ports as part of the normal workflow.

## High-level design

```text
Browser / desktop shell
        |
        v
+-----------------------+
|      Waxloom Web      |
+-----------+-----------+
            |
            v
+-----------------------+
|      Waxloom API      |
| auth / orchestration  |
+---+---+---+---+-------+
    |   |   |   |
    |   |   |   +---- MusicBrainz
    |   |   +-------- ListenBrainz
    |   +------------ AudioMuse-AI
    +---------------- Navidrome / OpenSubsonic
```

The browser talks to the Waxloom API, never directly to service tokens.

## Applications

### `apps/api`

Python backend responsible for:

- configuration and secret handling;
- Navidrome/OpenSubsonic adapter;
- AudioMuse-AI adapter;
- ListenBrainz and MusicBrainz adapters;
- discovery aggregation and ranking;
- local-library duplicate detection;
- import orchestration;
- Navidrome rescan and playlist update;
- background jobs and progress events.

### `apps/web`

React/TypeScript UI responsible for:

- library browsing;
- playback controls;
- playlist management;
- discovery views;
- source candidate selection;
- import progress;
- settings and health status.

The production build should be servable behind the same Waxloom entry point as the API.

## Provider adapters

External systems must be isolated behind narrow interfaces so Waxloom is not coupled to one implementation.

Initial adapters:

```text
providers/
  navidrome
  audiomuse
  listenbrainz
  musicbrainz
  youtube
```

Potential future adapters can be added without changing the discovery core.

## Discovery pipeline

```text
playlist / artist / recording seed
            |
            v
   seed normalization
            |
            v
ListenBrainz + MusicBrainz candidates
            |
            v
local-library exclusion
            |
            v
metadata / relation enrichment
            |
            v
similarity scoring
            |
            v
underground weighting
            |
            v
artist / label diversity pass
            |
            v
ranked discoveries
```

### Underground score

The underground score is deliberately separate from similarity.

A candidate can be extremely similar but mainstream, or obscure but weakly related. Waxloom should expose both dimensions instead of hiding them behind one opaque score.

The first implementation should consider signals such as:

- popularity / listener signals where available;
- how many independent seeds recommend the candidate;
- tag specificity and overlap;
- artist and label repetition;
- whether the candidate already exists locally;
- confidence of MusicBrainz entity resolution.

## Import pipeline

Import is always an explicit user action.

```text
Discovery result
      |
      v
external source search
      |
      v
candidate list shown to user
      |
      v
user chooses exact source
      |
      v
acquire authorized audio
      |
      v
metadata / filename normalization
      |
      v
music library
      |
      +--> Navidrome scan
      |
      +--> selected playlist
      |
      +--> AudioMuse analysis
```

The source-search implementation can reuse concepts from `ShazamDownloader`, but Waxloom should expose the candidates rather than silently choosing candidate zero.

## Security rules

- Provider secrets live server-side only.
- `.env` is never committed.
- API responses never echo provider passwords/tokens.
- Local filesystem paths are not exposed unnecessarily to the browser.
- Import operations validate destination paths.
- External URLs are treated as untrusted input.

## First milestone

A useful first milestone is complete when a user can:

1. open Waxloom;
2. see Navidrome playlists;
3. select one playlist;
4. generate external discoveries;
5. see which discoveries are absent locally;
6. select a discovery and inspect source candidates;
7. choose one candidate;
8. import it;
9. see it appear in the chosen Navidrome playlist.
