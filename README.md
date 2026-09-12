# Waxloom

Waxloom is a self-hosted music workspace that brings library playback, playlists, sonic similarity, external discovery, and track acquisition into one interface.

The goal is simple: **one app for the whole music workflow**. Navidrome, AudioMuse-AI, ListenBrainz, MusicBrainz, and other providers stay behind Waxloom as integrations instead of becoming separate UIs the user has to manage.

> Waxloom is an early-stage project. The architecture and public APIs may change quickly.

## Vision

Waxloom aims to provide:

- a single interface for a self-hosted music library;
- playback and playlist management through Navidrome / OpenSubsonic;
- sonic similarity and local-library recommendations through AudioMuse-AI;
- external artist and recording discovery through ListenBrainz and MusicBrainz;
- discovery ranking that can favor obscure / underground results over mainstream popularity;
- provider-aware search for tracks that are not yet in the local library;
- an explicit user-choice flow before importing a found track;
- automatic library rescan and playlist insertion after an import;
- no provider secrets exposed to the browser.

## Core principle

```text
                         Navidrome
                         AudioMuse-AI
Waxloom UI -> Waxloom -> ListenBrainz
                         MusicBrainz
                         external search providers
```

The user interacts with **Waxloom only**. Integrations are plumbing.

## Planned first vertical slice

1. Connect to an existing Navidrome instance.
2. Browse library and playlists inside Waxloom.
3. Pick a playlist and generate external discovery candidates.
4. Filter out tracks already present locally.
5. Rank discoveries with similarity + underground weighting.
6. Search external sources for a selected discovery.
7. Let the user choose the exact source result.
8. Import an authorized track into the music folder.
9. Ask Navidrome to rescan and add the track to the selected playlist.
10. Let AudioMuse-AI analyze the new track in the background.

## Repository layout

```text
apps/
  api/        Waxloom backend and provider adapters
  web/        Waxloom user interface
docs/         Architecture and design notes
```

## Development status

Bootstrap in progress.

## Legal note

Waxloom is intended to help users manage and discover music they are authorized to access or download. Provider integrations must respect the applicable service terms, rights-holder permissions, and local law.
