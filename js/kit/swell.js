// Helpers for the two golden rules: everything scales with intensity, and
// nothing pops. Use these instead of hand-rolling decays and springs.
import { clamp, smoothstep, lerp } from '../gfx/math.js';

/** idle value at k=0, active value at k=1. */
export const swell = (k, idle, active) => lerp(idle, active, k);

/**
 * Staged swell: 0 until intensity reaches `from`, 1 at `to`, eased between.
 * e.g. street lights coming on one by one: stage(k, 0.1 + i * 0.05, 0.3 + i * 0.05)
 */
export const stage = (k, from, to) => smoothstep(clamp((k - from) / Math.max(1e-4, to - from)));

/** Audio values pre-multiplied by intensity (what most reactions want). */
export function drive(audio, k) {
  return {
    level: audio.level * k,
    bass: audio.bass * k,
    mid: audio.mid * k,
    high: audio.high * k,
    pulse: audio.beatPulse * k,
    beat: audio.beat && k > 0.05,
    energy: (audio.energy ?? audio.level) * k,
    accent: audio.accent ?? 1,   // reactivity scales for hand-rolled beat reactions (see feel)
    motion: audio.motion ?? 1,
    decay: audio.decay ?? 1,     // multiply hand-rolled flash decay times by this
    build: (audio.build ?? 0) * k,   // Conductor: 0..1 anticipation during a build-up
    drop: !!audio.drop && k > 0.05,  // Conductor: true on the frame a drop lands
  };
}

/**
 * Global reaction feel, set every frame by show control from the Reactivity
 * setting (Gentle … Punchy). Envelopes and springs read it, so every
 * environment calms down or punches up together without per-style code.
 *   accent  scales Envelope triggers (beat flashes, glows)
 *   motion  scales Spring kicks (camera nudges, rolls, bounces)
 *   attack  s: Envelopes ease in instead of jumping (0 = instant)
 *   decay   multiplies every Envelope's decay time (longer = softer glow)
 * Hand-rolled beat reactions should multiply by audio.accent / audio.motion.
 */
export const feel = { accent: 1, motion: 1, attack: 0, decay: 1 };

/** Beat flash / impulse that decays exponentially. trigger(), then read .v */
export class Envelope {
  constructor(decay = 0.2) { this.decay = decay; this.v = 0; this.t = 0; }
  trigger(amount = 1) {
    this.t = Math.max(this.t, amount * feel.accent);
    if (feel.attack <= 0) this.v = Math.max(this.v, this.t);
  }
  update(dt) {
    this.t *= Math.exp(-dt / (this.decay * feel.decay));
    if (this.v < this.t && feel.attack > 0) this.v += (this.t - this.v) * (1 - Math.exp(-dt / feel.attack));
    else this.v = Math.min(this.v, this.t);
    return this.v;
  }
}

/** Critically damped spring: kick() it, it returns to 0 smoothly. Read .x */
export class Spring {
  constructor(freq = 6) { this.w = freq; this.x = 0; this.v = 0; }
  kick(amount) { this.v += amount * feel.motion; }
  update(dt) {
    const w = this.w;
    this.v += (-this.x * w * w - 2 * w * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/**
 * Rolling history of a value (one sample per frame) — read older samples to
 * make pulses travel through space (index by distance from the camera).
 */
export class History {
  constructor(length = 64) { this.buf = new Float32Array(length); }
  push(v) { this.buf.copyWithin(1, 0); this.buf[0] = v; }
  /** t in [0,1]: 0 = now, 1 = oldest */
  at(t) { return this.buf[Math.min(this.buf.length - 1, Math.max(0, Math.floor(t * (this.buf.length - 1))))]; }
}

/**
 * Lightly damped pendulum: swings back and forth after a push (Spring is
 * critically damped and won't). Chandeliers, hanging signs, lanterns, cables.
 * Pump it with bass in phase with its motion so the swing builds up:
 *   if (Math.sign(p.v) === Math.sign(p.x)) p.push(bass * k * 0.4 * dt * Math.sign(p.v));
 * Read .x (radians) and feed it to an instance tilt or mat4.trs.
 */
export class Pendulum {
  constructor(freq = 1.5, damping = 0.18, limit = 0.3) { this.w = freq; this.c = damping; this.limit = limit; this.x = 0; this.v = 0; }
  /** Pushes taper off as the swing nears `limit`, so it saturates softly instead of hitting the stop. */
  push(a) { this.v += a * Math.max(0, 1 - Math.abs(this.x) / this.limit); }
  update(dt) {
    this.v += (-this.w * this.w * this.x - this.c * this.v) * dt;
    this.x += this.v * dt;
    if (Math.abs(this.x) > this.limit) { this.x = Math.sign(this.x) * this.limit; this.v *= 0.5; }
    return this.x;
  }
}

/** 1 up to `near`, easing to 0 at `far`: fade scattered things by camera distance (scale or shade). */
export const fadeOut = (d, near, far) => 1 - smoothstep(clamp((d - near) / Math.max(1e-4, far - near)));
/** 0 up to `near`, easing to 1 at `far` (e.g. hide things right in front of the camera). */
export const fadeIn = (d, near, far) => smoothstep(clamp((d - near) / Math.max(1e-4, far - near)));

/**
 * Kit v3: a slow "breath" for calm songs: 0..1..0 over `beats` beats when a
 * tempo is tapped (audio.bpm), else over `period` seconds. The phase only ever
 * integrates (never jumps), and with a tempo it drifts into line with the bar.
 *
 *   this.breath = new K.Breath({ beats: 8, period: 9 });
 *   update: const b = this.breath.update(audio, dt);   // camera rise, glow swell, mist density…
 */
export class Breath {
  constructor({ beats = 8, period = 10 } = {}) { this.beats = beats; this.period = period; this.phase = 0; this.v = 0; this._bar = 0; }
  update(audio, dt) {
    const bpm = audio?.bpm || 0;
    this.phase += dt * (bpm > 0 ? bpm / 60 / this.beats : 1 / this.period);
    if (bpm > 0 && audio.bar === 0 && this._bar !== 0 && this.beats % 4 === 0) {
      // on each downbeat, ease the phase toward the nearest bar boundary
      const step = 4 / this.beats, target = Math.round(this.phase / step) * step;
      this.phase += (target - this.phase) * 0.15;
    }
    this._bar = audio?.bar ?? 0;
    this.phase -= Math.floor(this.phase);
    this.v = 0.5 - 0.5 * Math.cos(this.phase * Math.PI * 2);
    return this.v;
  }
}

// ---- Kit v4 (wave 4b) ------------------------------------------------------

/**
 * Fires once per bar. With tap tempo (audio.bpm > 0) it fires when audio.bar
 * wraps (3 → 0, or 3 → 1 after a frame hitch); without one, on every
 * `beatsPerBar`-th beatCount. Never faster than `minGap` s. With `backup` = [min, max]
 * seconds it also fires on a slow timer when no beats arrive (quiet passages).
 *
 *   this.bar = new K.BarClock({ backup: [6, 15] });
 *   update: if (this.bar.update(audio, dt)) this.rearrange();
 */
export class BarClock {
  constructor({ beatsPerBar = 4, minGap = 0.6, backup = null } = {}) {
    this.per = beatsPerBar; this.minGap = minGap; this.backup = backup;
    this.lastBar = -1; this.lastBC = -1; this.since = 0; this.count = 0;
    this._wait = backup ? backup[0] + Math.random() * (backup[1] - backup[0]) : Infinity;
  }
  update(audio, dt) {
    this.since += dt;
    let fire = false;
    const bpm = audio?.bpm || 0, bar = Number.isFinite(audio?.bar) ? audio.bar | 0 : -1, bc = Number.isFinite(audio?.beatCount) ? audio.beatCount | 0 : 0;
    if (bpm > 0 && bar >= 0) {
      if (this.lastBar >= 0 && bar < this.lastBar) fire = true;
      this.lastBar = bar; this.lastBC = bc;              // keep the fallback in sync for when the tempo is cleared
    } else {
      this.lastBar = -1;
      if (this.lastBC < 0 || bc < this.lastBC) this.lastBC = bc;   // first frame, or the counter was reset
      else if (bc - this.lastBC >= this.per) { fire = true; this.lastBC = bc; }
    }
    if (!fire && this.since > this._wait) fire = true;
    if (fire && this.since < this.minGap) fire = false;
    if (fire) {
      this.since = 0; this.count++;
      if (this.backup) this._wait = this.backup[0] + Math.random() * (this.backup[1] - this.backup[0]);
    }
    return fire;
  }
}

/**
 * Staged swell for n ordered groups (rows front to back, lamps up a path, …) that keeps
 * its order even when intensity jumps: group i targets stage(k, from_i, to_i) and eases
 * toward it, later groups more slowly. Read .v[i] (0..1).
 *
 *   this.rows = new K.Stager(ROWS, { from: [0.04, 0.62], to: [0.26, 0.86] });
 *   update: this.rows.update(k, dt);  then rise = this.rows.v[row]
 */
export class Stager {
  constructor(n, { from = [0.05, 0.6], to = [0.25, 0.85], rise = [0.6, 2.2], fall = 1.2 } = {}) {
    this.n = n; this.from = from; this.to = to; this.rise = rise; this.fall = fall;
    this.v = new Float32Array(n);
  }
  update(k, dt) {
    for (let i = 0; i < this.n; i++) {
      const f = this.n > 1 ? i / (this.n - 1) : 0;
      const tgt = stage(k, lerp(this.from[0], this.from[1], f), lerp(this.to[0], this.to[1], f));
      const tau = tgt > this.v[i] ? lerp(this.rise[0], this.rise[1], f) : this.fall;
      this.v[i] += (tgt - this.v[i]) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
    }
    return this.v;
  }
}

/**
 * Spring-damped 3D follower: glides toward a moving target with a little overshoot
 * (formations, flocks, a light that drifts to a new spot). Never jumps.
 *   this.f = new K.Follow3([x, y, z], { freq: 0.8, damping: 0.8 });
 *   update: const p = this.f.update(target, dt);
 */
export class Follow3 {
  constructor(start = [0, 0, 0], { freq = 1, damping = 0.85 } = {}) {
    this.p = [...start]; this.v = [0, 0, 0]; this.w = freq * Math.PI * 2; this.z = damping;
  }
  /** Jump straight to a point (only for setup, never during a show). */
  snap(p) { this.p[0] = p[0]; this.p[1] = p[1]; this.p[2] = p[2]; this.v[0] = this.v[1] = this.v[2] = 0; }
  update(target, dt) {
    const w = this.w, h = Math.min(dt, 0.05);
    for (let i = 0; i < 3; i++) {
      this.v[i] += ((target[i] - this.p[i]) * w * w - 2 * this.z * w * this.v[i]) * h;
      this.p[i] += this.v[i] * h;
    }
    return this.p;
  }
}

/**
 * Kit v5: walkers that come out as intensity rises and go home as it falls, at a fixed
 * walking speed, so a jump in intensity never teleports anyone. Walker i heads for distance
 * stage(k, th, th + spread) * length along its own route (0 = home, out of sight in the fog);
 * you map w.u (0..1 along the route) to a position. Pairs with K.Stager for what they walk to.
 *   this.walk = new K.Walkers(22, { from: [0.1, 0.7], length: (i) => 20 + i % 5 * 3 });
 *   update: for (const w of this.walk.update(k, dt, { speed: 1.5 + k * 0.5 })) {
 *             if (w.d < 0.05) continue;                       // still at home
 *             const [x, z] = routeAt(w.i, w.u); const step = Math.sin(w.phase);   // gait
 *           }
 * Each walker: { i, th, L, d, u, moved, phase }. phase advances with distance walked
 * (gaitRate per unit) plus a slow idle rock (idleRate per second).
 */
export class Walkers {
  constructor(n, { from = [0.05, 0.7], spread = 0.08, length = 20, gaitRate = 2.4, idleRate = 0.9, seed = 1 } = {}) {
    this.gaitRate = gaitRate; this.idleRate = idleRate;
    this.list = Array.from({ length: n }, (_, i) => {
      const h = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453, r = h - Math.floor(h);
      const th = lerp(from[0], from[1], n > 1 ? i / (n - 1) : 0) * 0.7 + lerp(from[0], from[1], r) * 0.3;
      return { i, th, spread, L: typeof length === 'function' ? length(i) : length, d: 0, u: 0, moved: 0, phase: r * 6.28 };
    });
  }
  update(k, dt, { speed = 1.5 } = {}) {
    for (const w of this.list) {
      const want = stage(k, w.th, w.th + w.spread) * w.L, prev = w.d;
      w.d += clamp(want - w.d, -speed * dt, speed * dt);
      w.moved = Math.abs(w.d - prev);
      w.u = w.L > 0 ? w.d / w.L : 0;
      w.phase += w.moved * this.gaitRate + dt * this.idleRate;
    }
    return this.list;
  }
}
