// One lifecycle for the persistent HTMLAudioElement. Intent, pending requests
// and confirmed playback are deliberately independent. No extra audio element.
export type AudioPhase = "idle" | "loading" | "playing" | "waiting" | "paused" | "interrupted" | "blocked";
type Trace = (event: string, key: string) => void;
type Options = {
  phase: (phase: AudioPhase) => void;
  trace: Trace;
  ios: () => boolean;
  hidden: () => boolean;
  interrupted: () => boolean;
  configure: () => void;
  now?: () => number;
};

export class AudioTransport {
  intent = false;
  phase: AudioPhase = "idle";
  generation = 0;
  key = "";
  source = "";
  private attempts = 0;
  private foregroundRetry = false;
  private lastProgressAt = 0;
  private lastPosition = 0;
  private requestPending = false;
  private pendingSeek: number | null = null;
  private lastClockTrace = 0;
  private lastTrace = new Map<string, number>();
  private options: Options;
  constructor(options: Options) { this.options = options; }
  private now() { return this.options.now?.() ?? Date.now(); }
  private change(phase: AudioPhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.options.phase(phase);
  }
  matches(audio: HTMLAudioElement) {
    return Boolean(this.source && audio.getAttribute("src") === this.source);
  }
  currentResource(audio: HTMLAudioElement) {
    if (!this.matches(audio)) return false;
    if (!audio.currentSrc) return true;
    try { return new URL(this.source, audio.ownerDocument?.baseURI ?? "http://localhost/").href === audio.currentSrc; }
    catch { return false; }
  }
  trace(event: string, audio: HTMLAudioElement, force = false) {
    if (!this.key) return;
    const name = `${event}-${this.options.hidden() ? "bg" : "fg"}-r${audio.readyState}n${audio.networkState}p${Number(audio.paused)}`;
    const now = this.now();
    if (!force && now - (this.lastTrace.get(name) ?? -Infinity) < 3000) return;
    if (this.lastTrace.size >= 24) this.lastTrace.clear();
    this.lastTrace.set(name, now);
    const position = Number.isFinite(audio.currentTime) ? Math.max(0, Math.floor(audio.currentTime)) : 0;
    this.options.trace((name + "t" + position).slice(0, 40), this.key);
  }
  start(audio: HTMLAudioElement, key: string, source: string, reason: string, initialPosition?: number) {
    const changed = this.key !== key || !this.matches(audio) || this.source !== source;
    this.intent = true;
    this.generation++;
    this.key = key;
    this.source = source;
    this.attempts = 0;
    this.foregroundRetry = false;
    this.lastTrace.clear();
    this.lastClockTrace = this.now();
    this.pendingSeek = initialPosition ?? null;
    this.lastPosition = changed ? 0 : audio.currentTime;
    this.lastProgressAt = this.now();
    this.requestPending = false;
    this.change("loading");
    this.options.configure();
    // Assignment already initiates selection. Avoid a second WebKit load()
    // and a separate pause() that can tear down the background audio session.
    if (audio.getAttribute("src") !== source) {
      audio.src = source;
      if (!this.options.ios()) audio.load();
    } else if (audio.error) {
      // Explicit retry of a failed resource needs a fresh resource selection.
      this.pendingSeek = changed ? (initialPosition ?? 0) : audio.currentTime;
      audio.load();
    } else if (changed || initialPosition !== undefined) {
      try { audio.currentTime = initialPosition ?? 0; this.pendingSeek = null; } catch { /* metadata will restore the target position */ }
    }
    this.request(audio);
    this.trace(reason, audio, true);
  }
  // Invalidates an old pending play when a new selection has no URL yet.
  selectPending(audio: HTMLAudioElement) {
    this.generation++;
    this.intent = true;
    this.requestPending = false;
    this.key = ""; this.source = ""; this.pendingSeek = null;
    this.change("loading");
    audio.pause();
  }
  stop(audio: HTMLAudioElement, reason = "user-pause") {
    this.intent = false;
    this.generation++;
    this.requestPending = false;
    this.pendingSeek = null;
    this.change("paused");
    audio.pause();
    this.trace(reason, audio, true);
  }
  private request(audio: HTMLAudioElement) {
    if (!this.intent || !this.matches(audio)) return;
    const token = ++this.generation;
    this.requestPending = true;
    this.lastProgressAt = this.now();
    this.change("loading");
    const current = () => token === this.generation && this.intent && this.matches(audio);
    const failure = (error: unknown) => {
      if (!current()) return;
      this.requestPending = false;
      const name = error instanceof DOMException ? error.name : "Error";
      this.trace(name === "NotAllowedError" ? "play-denied" : name === "AbortError" ? "play-aborted" : "play-failed", audio, true);
      this.change("blocked");
    };
    try {
      void audio.play().then(() => {
        if (!current()) return;
        this.requestPending = false;
        // play() resolution is not proof of audible output, but the element
        // must at least be unpaused and have current data.
        if (!audio.paused && audio.readyState >= 2) this.confirm(audio);
      }, failure);
    } catch (error) { failure(error); }
  }
  confirm(audio: HTMLAudioElement) {
    if (!this.currentResource(audio) || !this.intent || audio.paused || audio.ended || audio.readyState < 2) return;
    this.requestPending = false;
    this.lastProgressAt = this.now();
    this.lastPosition = audio.currentTime;
    if (this.phase !== "playing") this.trace("audio-playing", audio, true);
    this.change("playing");
  }
  observe(audio: HTMLAudioElement, event: string) {
    if (!this.currentResource(audio)) return;
    if (event === "loadedmetadata" && this.pendingSeek !== null) {
      const seek = this.pendingSeek; this.pendingSeek = null;
      if (this.intent && Number.isFinite(seek)) {
        try { audio.currentTime = Math.max(0, Math.min(seek, Number.isFinite(audio.duration) ? audio.duration : seek)); } catch { /* non-seekable media */ }
      }
    }
    if (event === "playing") { this.confirm(audio); return; }
    if (event === "timeupdate") {
      if (Math.abs(audio.currentTime - this.lastPosition) >= .05) {
        this.lastProgressAt = this.now();
        this.lastPosition = audio.currentTime;
        if (this.intent && !audio.paused && !audio.seeking && audio.readyState >= 2 && !audio.ended) this.confirm(audio);
      }
      if (this.intent && this.options.ios() && this.options.hidden() && this.now() - this.lastClockTrace >= 30000) {
        this.lastClockTrace = this.now(); this.trace("clock", audio, true);
      }
      return;
    }
    this.trace(event, audio);
    if (event === "ended" && audio.ended) { this.change("paused"); return; }
    if (!this.intent || audio.ended) return;
    if (event === "pause" && audio.paused && this.phase !== "loading") {
      this.lastProgressAt = this.now();
      // A bare native pause can be a headset or OS user action. Never infer
      // consent to restart unless a transition/stall/interruption is known.
      if (this.phase === "playing" && !this.options.interrupted()) {
        this.intent = false; this.generation++; this.requestPending = false;
        this.trace("native-pause", audio, true); this.change("paused");
      } else this.change("interrupted");
    }
    if (event === "waiting" || (event === "stalled" && audio.readyState < 3)) {
      if (this.phase === "playing") this.lastProgressAt = this.now();
      this.change("waiting");
    }
    if (event === "session-interrupted") this.change("interrupted");
    if (event === "error") { this.generation++; this.requestPending = false; this.change("blocked"); }
  }
  recover(audio: HTMLAudioElement, foreground = false) {
    if ((!foreground && !this.options.hidden()) || !this.options.ios() || !this.intent || !this.matches(audio) || audio.ended || audio.seeking || this.options.interrupted()) return;
    // Timers/timeupdate can be throttled while native playback keeps advancing.
    // Sample the actual element before declaring a stall after a suspended page.
    if (this.currentResource(audio) && !audio.paused && !audio.error && audio.readyState >= 2 && Math.abs(audio.currentTime - this.lastPosition) >= .05) {
      this.confirm(audio); return;
    }
    const elapsed = this.now() - this.lastProgressAt;
    const stalled = elapsed >= 8000 && (this.requestPending || audio.paused || audio.readyState < 3 || this.phase === "waiting" || this.phase === "playing");
    const eligible = foreground ? (audio.paused || this.phase === "blocked" || stalled) : stalled || this.phase === "blocked";
    if (!eligible) return;
    // At most one background attempt and one foreground attempt per explicit
    // start/source. No loops, auto-skip, silence tracks or background polling
    // that pretends to override a suspended operating system.
    if (foreground ? this.foregroundRetry : this.attempts >= 1) {
      if (stalled && this.phase !== "blocked") { this.change("blocked"); this.trace("recovery-exhausted", audio); }
      return;
    }
    if (foreground) this.foregroundRetry = true; else this.attempts++;
    this.trace(foreground ? "recover-fg" : "recover-stall", audio, true);
    this.options.configure();
    // Preserve position and source. Re-request playback without replacing src.
    // Do not pause a healthy advancing stream.
    if (foreground && audio.error) {
      this.pendingSeek = audio.currentTime;
      audio.load();
    } else if (!audio.paused && stalled) audio.pause();
    this.request(audio);
  }
}
