// Coalesce native remote track skips without delaying an isolated click.
// The first click is immediate; further clicks in a burst are netted and
// dispatched after a short quiet period (or bounded window).
export class MediaTrackBurst {
  private delta = 0;
  private last = -Infinity;
  private started = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private apply: ((delta: number) => void) | undefined;
  get pending() { return this.delta !== 0; }
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  push(delta: number, apply: (delta: number) => void) {
    const now = this.now();
    if (now - this.last >= 300 && !this.pending) {
      this.last = now; apply(delta); return;
    }
    if (!this.pending) this.started = now;
    this.last = now; this.delta += delta; this.apply = apply;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending) return;
    if (now - this.started >= 600) { this.flush(); return; }
    this.timer = setTimeout(() => this.flush(), Math.min(220, Math.max(0, 600 - (now - this.started))));
  }
  flush() {
    const delta = this.delta, apply = this.apply;
    this.cancel(false);
    if (delta) apply?.(delta);
  }
  cancel(reset = true) {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined; this.delta = 0; this.apply = undefined;
    if (reset) this.last = -Infinity;
  }
}
