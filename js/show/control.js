// Show control: the operator layer between audio analysis and the styles.
//
//   analyser + play state ──► ShowControl.process() ──► styles
//
// - hold:      intensity eases to a fixed level (quiet song you still want big)
// - blackout:  dithered fade to black and back (panic button; never a hard cut)
// - freeze:    styles stop updating; the picture holds until released
// - flash:     "big moment": a synthetic beat, an intensity push and a palette
//              flash in the composite pass, decaying over ~1.5 s
// - strobe-safe limiter: beats (and flashes) reach the styles at most ~3 per
//              second, and the composite flash is capped, so beat flashes can't
//              become a strobe (photosensitivity guidance: ≤ 3 flashes / s)
// - tempo:     tap tempo; "lock" makes the styles' beats land on the tapped grid
//              (detected beats nudge its phase so it doesn't drift)
//
// Styles also receive audio.bpm (0 = unknown), audio.beatPhase (0..1 within the
// beat) and audio.bar (beat index within a 4-beat bar) for phrasing camera moves.
import { clamp, damp } from '../gfx/math.js';

const MIN_BEAT_GAP = 1 / 3;   // strobe-safe: ≤ 3 beats per second

export class TapTempo {
  constructor() { this.taps = []; this.bpm = 0; this.period = 0; this.phase = 0; this.count = 0; }

  /** Register a tap at time t (seconds). Taps more than 2 s apart start over. */
  tap(t) {
    if (this.taps.length && t - this.taps[this.taps.length - 1] > 2) this.taps = [];
    this.taps.push(t);
    if (this.taps.length > 8) this.taps.shift();
    if (this.taps.length >= 2) {
      const n = this.taps.length - 1;
      this.period = (this.taps[n] - this.taps[0]) / n;
      this.bpm = 60 / this.period;
      this.phase = 0;            // the tap is the downbeat
    }
  }

  clear() { this.taps = []; this.bpm = 0; this.period = 0; this.phase = 0; }

  /** Nudge by ±1 bpm (for a knob or keys). */
  nudge(d) { if (!this.bpm) return; this.bpm = clamp(this.bpm + d, 40, 240); this.period = 60 / this.bpm; }

  /** Advance; returns true on the frame the grid crosses a beat. */
  update(dt) {
    if (!this.period) return false;
    this.phase += dt / this.period;
    if (this.phase >= 1) { this.phase -= Math.floor(this.phase); this.count++; return true; }
    return false;
  }

  /** A detected beat close to the grid pulls the phase a little toward it. */
  align() {
    if (!this.period) return;
    const off = this.phase > 0.5 ? this.phase - 1 : this.phase;   // -0.5..0.5 beats
    if (Math.abs(off) < 0.2) this.phase -= off * 0.25;
    if (this.phase < 0) this.phase += 1;
  }
}

export class ShowControl {
  constructor() {
    this.hold = false;
    this.blackout = false;
    this.freeze = false;
    this.fade = 0;            // 0..1 blackout amount
    this.flashEnv = 0;        // 0..1 big-moment envelope
    this.holdK = 0;           // eased hold level
    this.holdBlend = 0;       // eased 0..1: how much the hold overrides the play state
    this.k = 0;               // intensity sent to the styles
    this.tempo = new TapTempo();
    this.time = 0;
    this.lastBeat = -1;
    this.lastFlash = -10;
    this.pendingFlash = false;
    this.out = { level: 0, bass: 0, mid: 0, high: 0, beat: false, beatPulse: 0, beatCount: 0, bpm: 0, beatPhase: 0, bar: 0 };
  }

  tap() { this.tempo.tap(this.time); }
  bigMoment() { this.pendingFlash = true; }

  /**
   * a: analyser data, k / playing: play state. Returns { audio, k, playing }.
   * s: settings (holdLevel, blackoutTime, strobeSafe, tempoLock, flashAmount)
   */
  process(a, k, playing, dt, s) {
    this.time += dt;
    const o = this.out, safe = s.strobeSafe;

    // ---- intensity: hold eases to the level; flash pushes toward full
    // (both the on/off blend and the level are eased, so a toggle or a MIDI knob jump never cuts)
    this.holdBlend = damp(this.holdBlend, this.hold ? 1 : 0, 0.5, dt);
    this.holdK = damp(this.holdK, s.holdLevel, 0.3, dt);
    let kk = k + (this.holdK - k) * this.holdBlend;
    this.flashEnv *= Math.exp(-dt / 0.6);
    kk = Math.max(kk, Math.min(1, this.flashEnv * 1.2));

    // ---- beats: detected or tempo grid, then the strobe limiter
    const grid = this.tempo.update(dt);
    let beat;
    if (s.tempoLock && this.tempo.bpm) {
      if (a.beat) this.tempo.align();
      beat = grid && (playing || this.hold || kk > 0.05);
    } else beat = a.beat;
    if (this.pendingFlash) {
      this.pendingFlash = false;
      if (!safe || this.time - this.lastFlash > 1) {   // strobe-safe: ≤ 1 big moment / s
        this.lastFlash = this.time;
        this.flashEnv = 1;
        beat = true;
        this.lastBeat = -10;                           // the flash's beat always lands
      }
    }
    if (beat && safe && this.time - this.lastBeat < MIN_BEAT_GAP) beat = false;
    if (beat) { this.lastBeat = this.time; o.beatCount++; o.beatPulse = 1; } else o.beatPulse *= Math.exp(-dt / 0.18);
    o.beat = beat;

    // ---- pass the rest through (frozen copies while freeze is on are handled by the caller)
    o.level = a.level; o.bass = a.bass; o.mid = a.mid; o.high = a.high;
    o.rmsDb = a.rmsDb; o.rmsDbSmooth = a.rmsDbSmooth; o.raw = a.raw; o.gain = a.gain;
    o.bpm = this.tempo.bpm; o.beatPhase = this.tempo.bpm ? this.tempo.phase : 0; o.bar = this.tempo.count & 3;
    if (this.holdBlend > 0.01 && !playing) {
      // held but the room is quiet: give the styles a gentle synthetic pulse to react to
      const t = this.time, w = this.holdBlend;
      o.level = Math.max(o.level, w * (0.35 + 0.1 * Math.sin(t * 0.9)));
      o.bass = Math.max(o.bass, w * (0.3 + 0.15 * o.beatPulse));
      o.mid = Math.max(o.mid, w * (0.3 + 0.1 * Math.sin(t * 1.3)));
      o.high = Math.max(o.high, w * (0.25 + 0.1 * Math.sin(t * 3.1)));
    }

    // ---- blackout fade (time in s for 0 -> 1)
    const rate = dt / Math.max(0.05, s.blackoutTime);
    this.fade = clamp(this.fade + (this.blackout ? rate : -rate));

    this.k = kk;
    return { audio: o, k: kk, playing: playing || (this.hold && kk > 0.001) };
  }

  /** Composite-pass flash amount (capped when strobe-safe). */
  flashLevel(s) { return Math.min(this.flashEnv * s.flashAmount, s.strobeSafe ? 0.6 : 1); }

  get label() {
    const f = [];
    if (this.hold) f.push('HOLD');
    if (this.freeze) f.push('FREEZE');
    if (this.blackout || this.fade > 0) f.push(`BLACKOUT ${(this.fade * 100).toFixed(0)}%`);
    if (this.tempo.bpm) f.push(`${this.tempo.bpm.toFixed(1)} bpm`);
    return f.join(' · ') || 'live';
  }
}
