// Owns all style instances, crossfades between them with the pipeline's pixel
// dissolve, and auto-switches only while idle (so changes are never a visible cut).
import { smoothstep } from '../gfx/math.js';

export class StyleManager {
  constructor(renderer, classes, startIndex = 1) {
    this.r = renderer;
    this.styles = classes.map((C) => { const s = new C(); s.init(renderer); return s; });
    this.cur = Math.min(Math.max(0, startIndex), this.styles.length - 1);
    this.next = -1;
    this.t = 0;
    this.queued = -1;
    this.idleTime = 0;
    this.nextAutoAt = Infinity;
    this.onChange = null;
  }

  get count() { return this.styles.length; }
  get transitioning() { return this.next >= 0; }
  get target() { return this.queued >= 0 ? this.queued : this.next >= 0 ? this.next : this.cur; }
  name(i) { return this.styles[i].constructor.meta?.name || `Style ${i}`; }

  /** Crossfade to style i. Requests during a crossfade are queued (last one wins). */
  goTo(i) {
    if (i < 0 || i >= this.count) return;
    if (this.next >= 0) { this.queued = i === this.next ? -1 : i; return; }
    if (i === this.cur) return;
    this.next = i; this.t = 0;
    this.onChange?.(i);
  }

  /** Next style in the rotation (skips the test scene at index 0). */
  goNext() {
    const n = this.count - 1;
    this.goTo(((this.target - 1 + 1) % n) + 1);
  }

  update(audio, intensity, playing, dt, s) {
    // auto-switch: only after being fully idle for a while, then every interval
    const idle = !playing && intensity <= 0.001;
    if (idle) this.idleTime += dt; else { this.idleTime = 0; this.nextAutoAt = s.idleSwitchDelay; }
    if (this.nextAutoAt === Infinity) this.nextAutoAt = s.idleSwitchDelay;
    if (s.autoSwitch && idle && this.idleTime >= this.nextAutoAt && !this.transitioning) {
      this.goNext();
      this.nextAutoAt = this.idleTime + s.idleSwitchInterval;
    }

    this.styles[this.cur].update(audio, intensity, dt);
    if (this.next >= 0) {
      this.styles[this.next].update(audio, intensity, dt);
      this.t += dt / Math.max(0.1, s.transitionTime);
      if (this.t >= 1) {
        this.cur = this.next; this.next = -1; this.t = 0;
        if (this.queued >= 0) { const q = this.queued; this.queued = -1; this.goTo(q); }
      }
    }
  }

  render() {
    const r = this.r;
    r.beginScene('A');
    this.styles[this.cur].render(r);
    let mix = 0;
    if (this.next >= 0) {
      r.beginScene('B');
      this.styles[this.next].render(r);
      mix = smoothstep(this.t);
    }
    r.composite(mix);
  }

  dispose() { this.styles.forEach((s) => s.dispose(this.r)); }
}
