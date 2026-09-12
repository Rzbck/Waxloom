# Waxloom mobile roadmap

Date: 2026-09-12

## Current mobile target

The web app must be fully usable from an iPhone/phone over the same Tailscale URL as desktop Waxloom.

Current responsive goals:

- no horizontal page overflow;
- bottom thumb navigation for Home / Albums / Artists / Playlists / Favorites / Discovery / Imports;
- compact mini-player above the navigation bar;
- safe-area support for iPhone notch / home indicator;
- two-column album browsing and compact artist browsing;
- desktop song tables collapse into touch-friendly rows;
- modals become bottom sheets;
- Discovery returns to a phone-style horizontal artist carousel while tracks remain vertically scrollable inside each fixed card;
- all interactive targets remain large enough for touch;
- same Tailscale endpoint and same backend/API as desktop.

## Future native iPhone client

The owner explicitly wants a real iPhone app later.

Architecture direction:

- reuse Waxloom's existing HTTP API and Discovery/player model rather than duplicating Navidrome/AudioMuse/ListenBrainz logic in the phone client;
- connect through the user's Tailscale network so the native app talks directly to Waxloom without exposing Waxloom publicly;
- preserve the same queue, Discovery feedback, playlists, imports and library semantics;
- investigate native playback/background-audio integration, lock-screen / Control Center controls and offline-safe UI states;
- keep distribution choice separate from product architecture: TestFlight/App Store can be evaluated alongside owner-controlled sideload workflows later;
- a polished mobile web/PWA-like experience is the immediate bridge, not a substitute for the later native app.

## Security invariant

The native client must never contain Navidrome passwords, AudioMuse tokens or other provider secrets. Those remain server-side in Waxloom exactly as they do for the browser client.
