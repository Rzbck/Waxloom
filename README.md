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

## Available product areas

- Navidrome/OpenSubsonic library, playlists, queue and continuous music playback.
- Home, Albums, Artists and Favorites browsing, with Back/Forward navigation and cached search context.
- Discovery music recommendations with preview, taste controls and neutral suggestion dismissal.
- Authorized, user-initiated YouTube source selection and imports into the existing music library.
- Responsive desktop/mobile web UI, Media Session controls and experimental iPhone Home Screen support.

Phone Safari/PWA and lock-screen behavior still require physical-device acceptance; see the current release notes rather than assuming all browser tests cover iOS.
## Repository layout

```text
apps/
  api/        Waxloom backend and provider adapters
  web/        Waxloom user interface
docs/         Architecture, handoff, and workflow notes
scripts/      Development and security helpers
```

## Current source and release status

`main` contains the consolidated Web/API source as of 2026-10-25. Production identity is tracked **separately** from Git commits: the currently deployed Web source is `82eddfc`, while the API source is `6b1fe45`. A newer maintenance commit in GitHub does not automatically deploy anything.

Read [current repository and release status](docs/REPOSITORY_CONSOLIDATION_20261025.md) and [HANDOFF.md](HANDOFF.md) before making changes. Historical development branches and prior pull requests were intentionally kept separate from production releases.
## Windows quick start

Requirements:

- Python 3.12+
- `uv`
- Node.js / npm

Clone the repository, then from its root run:

```powershell
.\scripts\configure.ps1
```

The Windows configuration helper:

- detects the local Navidrome installation and `MusicFolder`;
- reads the AudioMuse plugin URL and API token without printing the token;
- asks only for the Navidrome account credentials;
- writes the local ignored `.env` file;
- backs up an existing `.env` before replacing it.

Then launch:

```powershell
.\scripts\dev.ps1
```

The development launcher starts the backend and frontend, but **the Waxloom UI is the only user-facing page**.

## Development workflow

Waxloom uses an isolated branch/worktree workflow:

**1 active chantier = 1 branch = 1 dedicated worktree.**

Before modifying the repository, start with [`HANDOFF.md`](HANDOFF.md). Public-repository security rules are blocking and `scripts/security-gate.ps1` must pass before publication.

Relevant documents:

- [`AI_PROJECT_RULES.md`](AI_PROJECT_RULES.md)
- [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md)
- [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)
- [`docs/LOCAL_MULTI_WORKTREE_POLICY.md`](docs/LOCAL_MULTI_WORKTREE_POLICY.md)
- [`SECURITY.md`](SECURITY.md)

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Legal note

Waxloom is intended to help users manage and discover music they are authorized to access or download. Provider integrations must respect the applicable service terms, rights-holder permissions, and local law.
