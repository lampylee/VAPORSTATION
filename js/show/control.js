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
// beat) and audio.bar (beat index within a 4-beat bar) for phrasing camera moves:
// from tap tempo when tapped, else from the Conductor's automatic estimate. And the
// Conductor's song shape: audio.section, audio.build (0..1), audio.drop (one frame), audio.songTime,
// plus audio.shape (eased close / pace / fog / weather / phrase, see shape.js), audio.groove
// (smooth 0..1 swing on the beat) and audio.beatMotion (0 Gentle ... 1 Punchy: how much beats move the camera).
//
// Reactivity (s.reactivity, 0 = Gentle, 0.5 = Medium, 1 = Punchy) reshapes the
// audio before any style sees it. Gentle follows the song's energy rather than
// each kick: bands are slowed and pulled toward audio.energy, only strong beats
// get through (about one a second), beat pulses ease in and fade slowly, and
// kit envelopes / springs (K.feel) are scaled down. Punchy passes the raw
// analysis through, which is the original, club-style feel.
import { clamp, damp, lerp } from '../gfx/math.js';
import { feel } from '../kit/swell.js';
import { SongShape } from './shape.js';

const MIN_BEAT_GAP = 1 / 3;   // strobe-safe: ≤ 3 beats per second

// Profile parameters at Gentle (0), Medium (0.5) and Punchy (1); blended in between.
//   att/rel   extra band smoothing (s)       detail  how much of the band's own motion survives vs. energy
//   gap       min s between beats            min     beat strength needed (1 = any detected beat)
//   pAtt/pDec beat pulse ease-in / fade (s)   accent/motion/attack/decay  -> K.feel
//   jitter    beat push on the PS1 vertex snap (whole-frame wobble)
const PROFILES = [
  { att: 0.2, rel: 0.6, detail: 0.55, gap: 0.9, min: 1.3, pAtt: 0.09, pDec: 0.75, accent: 0.4, motion: 0.15, attack: 0.09, decay: 2.6, jitter: 0, beatMotion: 0 },
  { att: 0.12, rel: 0.35, detail: 0.7, gap: 0.5, min: 1.12, pAtt: 0.04, pDec: 0.4, accent: 0.7, motion: 0.5, attack: 0.04, decay: 1.6, jitter: 0.4, beatMotion: 0.4 },
  { att: 0, rel: 0, detail: 1, gap: 0, min: 1, pAtt: 0, pDec: 0.18, accent: 1, motion: 1, attack: 0, decay: 1, jitter: 1.2, beatMotion: 1 },
];

function profileAt(r, out) {
  const i = r < 0.5 ? 0 : 1, t = clamp(r < 0.5 ? r * 2 : (r - 0.5) * 2);
  const a = PROFILES[i], b = PROFILES[i + 1];
  for (const key in a) out[key] = lerp(a[key], b[key], t);
  return out;
}

export const REACTIVITY_STEPS = [[0, 'Gentle'], [0.5, 'Medium'], [1, 'Punchy']];
export const reactivityName = (r) => REACTIVITY_STEPS.reduce((n, s) => (Math.abs(s[0] - r) < Math.abs(n[0] - r) ? s : n))[1];

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
    this.out = { level: 0, bass: 0, mid: 0, high: 0, energy: 0, beat: false, beatPulse: 0, beatCount: 0, accent: 1, motion: 1, decay: 1, bpm: 0, beatPhase: 0, bar: 0, section: '', build: 0, drop: false, songTime: 0, groove: 0, beatMotion: 1, shape: null };
    this.shape = new SongShape();
    this.out.shape = this.shape.out;
    this.react = -1;          // eased reactivity (-1 = not started; snaps to the setting on the first frame)
    this.prof = profileAt(1, {});
    this.band = { level: 0, bass: 0, mid: 0, high: 0 };   // extra-smoothed bands
    this.pulseT = 0;          // beat pulse target (decays); out.beatPulse eases toward it
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

    // ---- reactivity profile (eased, so moving the setting mid-song never cuts)
    const rTarget = clamp(s.reactivity ?? 0);
    this.react = this.react < 0 ? rTarget : damp(this.react, rTarget, 0.8, dt);
    const P = profileAt(this.react, this.prof);
    feel.accent = P.accent; feel.motion = P.motion; feel.attack = P.attack; feel.decay = P.decay;
    o.accent = P.accent; o.motion = P.motion; o.decay = P.decay;
    o.beatMotion = feel.beatMotion = P.beatMotion;

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
    } else beat = a.beat && (a.beatStrength ?? 1) >= P.min;
    // reactivity: beats closer than the profile's gap are dropped (Gentle ≈ one a second)
    if (beat && this.time - this.lastBeat < P.gap) beat = false;
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
    if (beat) { this.lastBeat = this.time; o.beatCount++; this.pulseT = 1; }
    this.pulseT *= Math.exp(-dt / P.pDec);
    // the pulse eases in over pAtt (instant at Punchy), then follows the fade
    if (o.beatPulse < this.pulseT && P.pAtt > 0.001) o.beatPulse += (this.pulseT - o.beatPulse) * (1 - Math.exp(-dt / P.pAtt));
    else o.beatPulse = this.pulseT;
    o.beat = beat;

    // ---- bands: extra smoothing, then pulled toward the song's energy (Gentle keeps ~55% of the band's own motion)
    o.energy = a.energy ?? a.level;
    const B = this.band;
    for (const key of ['level', 'bass', 'mid', 'high']) {
      const v = a[key];
      B[key] = P.att + P.rel < 0.001 ? v : damp(B[key], v, v > B[key] ? P.att : P.rel, dt);
      o[key] = lerp(o.energy, B[key], P.detail);
    }

    // ---- pass the rest through (frozen copies while freeze is on are handled by the caller)
    o.rmsDb = a.rmsDb; o.rmsDbSmooth = a.rmsDbSmooth; o.raw = a.raw; o.gain = a.gain;
    // tempo: tap tempo wins; otherwise the conductor's estimate (0 = unknown)
    if (this.tempo.bpm) { o.bpm = this.tempo.bpm; o.beatPhase = this.tempo.phase; o.bar = this.tempo.count & 3; }
    else { o.bpm = a.autoBpm || 0; o.beatPhase = o.bpm ? a.autoPhase : 0; o.bar = o.bpm ? a.autoBar : 0; }
    // the conductor's song shape (neutral when it is off)
    o.section = a.section || ''; o.build = a.build || 0; o.drop = !!a.drop; o.songTime = a.songTime || 0;
    o.shape = this.shape.update(o, dt);
    // groove: a smooth swing on the beat grid (tempo known), else the eased beat pulse; damped so switching never steps
    const gTarget = o.bpm > 0 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * o.beatPhase) : o.beatPulse;
    o.groove = damp(o.groove, gTarget, 0.15, dt);
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
  /** Beat push on the PS1 vertex snap for the current profile (0 at Gentle: the frame never wobbles on beats). */
  get jitterPush() { return this.prof.jitter; }

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
