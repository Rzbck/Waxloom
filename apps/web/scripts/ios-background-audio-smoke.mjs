import assert from "node:assert/strict";
import { isIOSHomeScreenAudio, setIOSPlaybackAudioSession, shouldHandoffBeforeEnd } from "../src/iosBackgroundAudio.ts";

const base = {
  enabled: true, hidden: true, wantsPlayback: true, hasNext: true,
  paused: false, seeking: false, ended: false, currentTime: 179.55, duration: 180,
};
const yes = (name, overrides) => {
  assert.equal(shouldHandoffBeforeEnd({ ...base, ...overrides }), true, name);
};
const no = (name, overrides) => {
  assert.equal(shouldHandoffBeforeEnd({ ...base, ...overrides }), false, name);
};
yes("iOS standalone background transition in the last 0.65 seconds", {});
no("never shorten playback when app visible", { hidden: false });
no("never shorten playback on desktop", { enabled: false });
no("do not override user pause", { wantsPlayback: false });
no("do not advance final queue entry", { hasNext: false });
no("do not advance while seeking", { seeking: true });
no("do not advance after ended", { ended: true });
no("do not advance paused media", { paused: true });
no("do not advance more than 0.65 seconds before end", { currentTime: 179.0 });
no("do not advance after duration", { currentTime: 180 });
no("do not advance near very short audio", { currentTime: 2.8, duration: 2.9 });
no("do not advance unknown duration", { duration: Number.NaN });
no("do not advance unknown position", { currentTime: Number.NaN });
no("do not advance early in the song", { currentTime: 1.9, duration: 2.4 });

Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15",
  platform: "iPhone", maxTouchPoints: 5, standalone: true, audioSession: { type: "auto" },
} });
globalThis.window = { matchMedia: () => ({ matches: false }) };
assert.equal(isIOSHomeScreenAudio(), true, "legacy standalone detection");
setIOSPlaybackAudioSession();
assert.equal(globalThis.navigator.audioSession.type, "playback", "iOS audio session");

globalThis.navigator.standalone = false;
assert.equal(isIOSHomeScreenAudio(), false, "normal Safari not enabled");
globalThis.window.matchMedia = () => ({ matches: true });
assert.equal(isIOSHomeScreenAudio(), true, "display-mode standalone");

globalThis.navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0)";
globalThis.navigator.platform = "Win32";
assert.equal(isIOSHomeScreenAudio(), false, "desktop not affected");
console.log("PASS: iOS background handoff, pause/queue guards, Home Screen and AudioSession checks (18 assertions)");
