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
  };
}

/** Beat flash / impulse that decays exponentially. trigger(), then read .v */
export class Envelope {
  constructor(decay = 0.2) { this.decay = decay; this.v = 0; }
  trigger(amount = 1) { this.v = Math.max(this.v, amount); }
  update(dt) { this.v *= Math.exp(-dt / this.decay); return this.v; }
}

/** Critically damped spring: kick() it, it returns to 0 smoothly. Read .x */
export class Spring {
  constructor(freq = 6) { this.w = freq; this.x = 0; this.v = 0; }
  kick(amount) { this.v += amount; }
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
