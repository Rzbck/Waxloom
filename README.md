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
scripts/      Development helpers
```

## Development status

The initial scaffold is live:

- FastAPI backend;
- React + TypeScript + Vite frontend;
- server-side environment configuration;
- Navidrome/OpenSubsonic client;
- Navidrome health, playlist listing, and playlist-detail API endpoints;
- first Waxloom application shell.

## Windows quick start

Requirements:

- Python 3.12+
- `uv`
- Node.js / npm

Clone the repository, then from its root:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set at least:

```text
NAVIDROME_URL=http://127.0.0.1:4533
NAVIDROME_USERNAME=your-user
NAVIDROME_PASSWORD=your-password
AUDIOMUSE_URL=http://127.0.0.1:8042
AUDIOMUSE_API_TOKEN=your-token
MUSIC_LIBRARY_PATH=E:\Music
```

Then launch:

```powershell
.\scripts\dev.ps1
```

The development launcher starts the backend and frontend, but **the Waxloom UI is the only user-facing page**.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Legal note

Waxloom is intended to help users manage and discover music they are authorized to access or download. Provider integrations must respect the applicable service terms, rights-holder permissions, and local law.
