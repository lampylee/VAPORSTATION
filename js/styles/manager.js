// Owns all style instances, crossfades between them with the pipeline's pixel
// dissolve, auto-switches only while idle (so changes are never a visible cut),
// and gives every style a live, crossfading palette.
import { smoothstep } from '../gfx/math.js';
import { LivePalette } from '../palette/palette.js';
import { Moods } from '../kit/moods.js';
import { CameraRig } from '../kit/camera.js';

export class StyleManager {
  constructor(renderer, classes, startIndex = 1) {
    this.r = renderer;
    this.classes = classes;
    this.override = null;   // a palette applied to every style, or null = each style's own
    this.broken = new Set(); // styles that threw this session: out of the rotation, drawn as fog
    this.avoid = new Set();  // governor: too heavy for this machine, out of the rotation
    this.styles = classes.map((C, i) => this._make(C, i));
    this.cur = Math.min(Math.max(0, startIndex), this.styles.length - 1);
    if (this.broken.has(this.cur)) this.cur = this.rotation[0] ?? this.cur;
    this.next = -1;
    this.t = 0;
    this.queued = -1;
    this.idleTime = 0;
    this.nextAutoAt = Infinity;
    this.onChange = null;
    this._up = -1;          // committed next auto-switch target (see `upcoming`)
    this.pool = null;       // setlist: indices N / auto-switch rotate through (null = whole rotation)
  }

  _make(C, i, palette = C.palette) {
    const s = new C();
    s.pal = new LivePalette(this.r, palette);
    try { s.init(this.r); } catch (e) { this._fail(i, e, 'init'); }
    return s;
  }

  /** A style threw: keep the show going. It is drawn as plain fog and leaves the rotation. */
  _fail(i, e, where) {
    if (!this.broken.has(i)) console.error(`[safety] style "${this.name(i)}" failed in ${where}; skipping it this session.`, e);
    this.broken.add(i);
    if (i === this.cur && this.next < 0) this.goNext();
    else if (i === this.next && this.queued < 0) this.queued = this.rotation.find((j) => j !== i) ?? -1;
  }

  /**
   * After a lost WebGL context is restored every GL object is gone: re-create every style
   * and palette from scratch, keeping which style shows, the crossfade, the palette override and the pool.
   */
  rebuild() {
    this.styles = this.classes.map((C, i) => this._make(C, i, this.styles[i]?.pal.palette || C.palette));
  }

  get count() { return this.styles.length; }
  get transitioning() { return this.next >= 0; }
  get target() { return this.queued >= 0 ? this.queued : this.next >= 0 ? this.next : this.cur; }
  name(i) { return this.classes[i]?.meta?.name || `Style ${i}`; }

  /** The palette the visible (or incoming) style is showing. */
  get activePalette() { return this.styles[this.target].pal.palette; }

  /** Apply a palette to every style (null = back to each style's default), crossfading. */
  applyPalette(palette, duration = 0) {
    this.override = palette;
    for (const s of this.styles) s.pal.set(palette || s.constructor.palette, duration);
  }

  /** Crossfade to style i. Requests during a crossfade are queued (last one wins). */
  goTo(i) {
    if (i < 0 || i >= this.count) return;
    this._up = -1;
    if (this.next >= 0) { this.queued = i === this.next ? -1 : i; return; }
    if (i === this.cur) return;
    this.next = i; this.t = 0;
    this.enter(i);
    this.onChange?.(i);
  }

  /**
   * Style i is coming on screen (crossfade target, or shown directly by bench / selftest): its
   * K.Moods and camera rigs (own properties) jump to the current section on their next update,
   * then style.enter?.() resets anything else the style eases from the song's sections. Off-screen
   * styles keep whatever they had (thumbnails update them with sectionless audio), so without
   * this a mid-song switch would arrive in `base` and drift to the section's mood.
   */
  enter(i) {
    const st = this.styles[i];
    if (!st || this.broken.has(i)) return;
    try {
      for (const v of Object.values(st)) {
        if (v instanceof Moods) v.snap();
        else if (v instanceof CameraRig) v.snapShape();
      }
      st.enter?.();
    } catch (e) { this._fail(i, e, 'enter'); }
  }

  /** Indices in the rotation: the setlist song's pool if set, else styles without meta.hidden. */
  get rotation() {
    const all = this.pool?.length ? this.pool : this.styles.map((s, i) => (s.constructor.meta?.hidden ? -1 : i)).filter((i) => i >= 0);
    // broken styles never come back; heavy ones only if nothing else is left
    const ok = all.filter((i) => !this.broken.has(i));
    const light = ok.filter((i) => !this.avoid.has(i));
    return light.length ? light : ok;
  }

  /** Rotation neighbour of the current target (skips hidden styles like the test scene). */
  _neighbour(dir) {
    const rot = this.rotation;
    if (!rot.length) return -1;
    const t = this.target, pos = rot.indexOf(t);
    if (pos >= 0) return rot[(pos + dir + rot.length) % rot.length];
    // the current style left the rotation (broken / heavy / not in this song's pool): its neighbour in order
    const after = dir > 0 ? rot.find((j) => j > t) : [...rot].reverse().find((j) => j < t);
    return after ?? (dir > 0 ? rot[0] : rot[rot.length - 1]);
  }

  /**
   * The style the next goNext(1) / idle auto-switch goes to. Committed, not guessed: kept until the
   * target changes or it leaves the rotation (broken / avoided / pool change), then re-picked.
   */
  get upcoming() {
    const rot = this.rotation;
    if (!rot.length) return this.target;
    if (!rot.includes(this._up) || (this._up === this.target && rot.length > 1)) this._up = this._neighbour(1);
    return this._up;
  }

  goNext(dir = 1) {
    const i = dir > 0 ? this.upcoming : this._neighbour(dir);
    if (i >= 0) this.goTo(i);
  }

  update(audio, intensity, playing, dt, s) {
    // auto-switch: only after being fully idle for a while, then every interval
    const idle = !playing && intensity <= 0.001;
    if (idle) this.idleTime += dt; else { this.idleTime = 0; this.nextAutoAt = s.idleSwitchDelay; }
    if (this.nextAutoAt === Infinity) this.nextAutoAt = s.idleSwitchDelay;
    if (s.autoSwitch && idle && this.idleTime >= this.nextAutoAt && !this.transitioning && this.rotation.length > 1) {
      this.goTo(this.upcoming);
      this.nextAutoAt = this.idleTime + s.idleSwitchInterval;
    }

    // advance the crossfade first, so a queued style that starts now is
    // updated below before it is ever rendered
    if (this.next >= 0) {
      this.t += dt / Math.max(0.1, s.transitionTime);
      if (this.t >= 1) {
        this.cur = this.next; this.next = -1; this.t = 0;
        if (this.queued >= 0) { const q = this.queued; this.queued = -1; this.goTo(q); }
      }
    }
    for (const st of this.styles) st.pal.update(dt);
    const step = (i) => {
      if (this.broken.has(i)) return;
      try { this.styles[i].update(audio, intensity, dt); } catch (e) { this._fail(i, e, 'update'); }
    };
    step(this.cur);
    if (this.next >= 0) step(this.next);
  }

  render() {
    const r = this.r;
    const draw = (which, i) => {
      const st = this.styles[i];
      r.beginScene(which); r.setPalette(st.pal);
      if (this.broken.has(i)) { r.clear(st.pal.role('fog')); return; }
      try { st.render(r); } catch (e) { this._fail(i, e, 'render'); r.beginScene(which); r.setPalette(st.pal); r.clear(st.pal.role('fog')); }
    };
    draw('A', this.cur);
    let mix = 0;
    if (this.next >= 0) { draw('B', this.next); mix = smoothstep(this.t); }
    r.composite(mix);
  }

  dispose() { this.styles.forEach((s) => { s.dispose(this.r); s.pal.dispose(); }); }
}
