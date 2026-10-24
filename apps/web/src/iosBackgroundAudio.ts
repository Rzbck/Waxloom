// Safari Home Screen apps may suspend their audio session after a natural
// media 'ended' event. Keep a bounded, iOS-only early handoff and a foreground
// recovery path; neither can override WebKit's background execution policy.
type AudioNavigator = Navigator & {
  standalone?: boolean;
  audioSession?: { type: string };
};

export function isIOSHomeScreenAudio(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const nav = navigator as AudioNavigator;
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent)
    || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  if (!ios) return false;
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)")?.matches === true;
}

export function setIOSPlaybackAudioSession(): void {
  if (!isIOSHomeScreenAudio()) return;
  const session = (navigator as AudioNavigator).audioSession;
  if (!session) return;
  try { session.type = "playback"; } catch { /* iOS versions may not support AudioSession. */ }
}

export type PreEndState = {
  enabled: boolean;
  hidden: boolean;
  wantsPlayback: boolean;
  hasNext: boolean;
  paused: boolean;
  seeking: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
};

// Transition only while the old stream is still playing, otherwise iOS may
// reject play() for the next track on a locked, standalone web app.
// This is deliberately limited to the last 0.65 s and iOS in background.
// It is a mitigation, not a guarantee for suspended WebKit pages.
export function shouldHandoffBeforeEnd(state: PreEndState): boolean {
  if (!state.enabled || !state.hidden || !state.wantsPlayback || !state.hasNext
    || state.paused || state.seeking || state.ended) return false;
  if (!Number.isFinite(state.duration) || !Number.isFinite(state.currentTime)
    || state.duration < 3 || state.currentTime < 2) return false;
  const remaining = state.duration - state.currentTime;
  return remaining > 0 && remaining <= 0.65;
}
