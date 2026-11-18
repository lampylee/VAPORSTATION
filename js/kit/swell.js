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
