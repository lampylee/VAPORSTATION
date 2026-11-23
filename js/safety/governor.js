// Performance governor: if this machine can't hold the frame rate, quietly trade detail
// for smoothness, cheapest and least visible first. Only ever steps down (no oscillation).
//   tier 1: backbuffer capped at devicePixelRatio 1 (the 240p image is nearest-upscaled anyway)
//   tier 2: kit particle counts ramp to 60 %
//   tier 3+: the style showing is marked heavy on this machine and leaves the rotation;
//            under 30 fps it crossfades away at once.
// See docs/superpowers/specs/2026-11-22-gig-safety-design.md.

const HEAVY_KEY = 'vaporstation.heavy';
const WINDOW = 3;        // seconds per measurement window
const SLOW_FPS = 45;     // mean fps under this = slow (50 Hz displays stay clear)
const AWFUL_FPS = 30;    // leave the style now rather than at the next switch
const WARMUP = 5;        // seconds ignored after start / GL restore
const LOW_QUALITY = 0.6;

export class Governor {
  constructor(renderer, styles, keyOf) {
    this.r = renderer;
    this.styles = styles;
    this.keyOf = keyOf;      // style index -> stable key (survives reordering the registry)
    this.tier = 0;
    this.enabled = true;
    this.quality = 1;        // target for renderer.quality (ramped)
    this.warm = WARMUP;
    this.t = 0; this.frames = 0;
    this.lastFps = 0;
    this.heavy = new Set(this._load());
    this.events = [];
    this._applyHeavy();
  }

  _load() { try { return JSON.parse(localStorage.getItem(HEAVY_KEY) || '[]'); } catch (e) { return []; } }
  _save() { try { localStorage.setItem(HEAVY_KEY, JSON.stringify([...this.heavy])); } catch (e) { /* private mode */ } }
  _applyHeavy() {
    this.styles.avoid.clear();
    this.styles.classes.forEach((C, i) => { if (this.heavy.has(this.keyOf(C))) this.styles.avoid.add(i); });
  }
  _log(msg) { this.events.push(msg); if (this.events.length > 20) this.events.shift(); console.info('[governor] ' + msg); }

  /** Restart the warm-up (after a GL restore, or anything else that stalls a few frames). */
  settle() { this.warm = WARMUP; this.t = 0; this.frames = 0; }

  /** Forget everything: full detail back on, heavy list cleared. */
  reset() {
    this.tier = 0; this.quality = 1; this.r.quality = 1;
    if (this.r.params.maxDpr) { this.r.params.maxDpr = 0; this.r.resize(); }
    this.heavy.clear(); this._save(); this._applyHeavy(); this.saturated = false;
    this.settle();
  }

  get label() {
    const parts = [`tier ${this.tier}`];
    if (this.r.params.maxDpr) parts.push('dpr 1');
    if (this.quality < 1) parts.push(`particles ${Math.round(this.r.quality * 100)}%`);
    if (this.heavy.size) parts.push(`${this.heavy.size} heavy`);
    return parts.join(' · ');
  }

  /** rawMs: real time since the last frame (unclamped). */
  update(rawMs, dt) {
    // ramp particle quality toward its target (never a pop)
    if (this.r.quality !== this.quality) {
      const step = dt / 3;
      this.r.quality = this.r.quality > this.quality ? Math.max(this.quality, this.r.quality - step) : Math.min(this.quality, this.r.quality + step);
    }
    if (!this.enabled || document.hidden || rawMs > 500) { this.t = 0; this.frames = 0; return; }
    if (this.warm > 0) { this.warm -= rawMs / 1000; return; }
    if (this.styles.transitioning) { this.t = 0; this.frames = 0; return; }   // two styles render then
    this.t += rawMs / 1000; this.frames++;
    if (this.t < WINDOW) return;
    const fps = this.frames / this.t;
    this.lastFps = fps;
    this.t = 0; this.frames = 0;
    if (fps < SLOW_FPS) this._stepDown(fps);
  }

  _stepDown(fps) {
    const f = fps.toFixed(0);
    if (this.tier === 0 && (window.devicePixelRatio || 1) > 1) {
      this.tier = 1; this.r.params.maxDpr = 1; this.r.resize();
      this._log(`${f} fps: backbuffer capped at 1x`);
    } else if (this.tier <= 1) {
      this.tier = 2; this.quality = LOW_QUALITY;
      this._log(`${f} fps: particles to ${LOW_QUALITY * 100}%`);
    } else {
      const i = this.styles.cur, key = this.keyOf(this.styles.classes[i]);
      if (this.heavy.has(key)) return;   // already known; nothing more we can do here
      // slow everywhere (battery saver, thermal throttling): it's the machine, not the style
      const visible = this.styles.classes.filter((C) => !C.meta?.hidden).length;
      if (this.heavy.size >= Math.max(2, Math.floor(visible / 4))) {
        if (!this.saturated) { this.saturated = true; this._log(`${f} fps on many styles: machine is slow overall, not marking more`); }
        return;
      }
      if (performance.now() - (this.lastLeave || -1e9) < 60000) fps = AWFUL_FPS;   // at most one forced crossfade a minute
      this.tier++;
      this.heavy.add(key); this._save(); this._applyHeavy();
      this._log(`${f} fps: "${this.styles.name(i)}" marked heavy, out of the rotation`);
      if (fps < AWFUL_FPS && this.styles.rotation.some((j) => j !== i)) { this.lastLeave = performance.now(); this.styles.goNext(); }
    }
    this.warm = 1;   // let the change take effect before measuring again
  }
}
