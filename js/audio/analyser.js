// Per-frame audio analysis. Produces the AudioData object every style receives:
//
//   level, bass, mid, high   0..1, smoothed, auto-gain normalised
//   beat                     true on the frame a beat/onset is detected
//   beatPulse                1 on a beat, decays to 0 over ~0.25 s
//   beatCount                increments per beat
//   beatStrength             on a beat: how far the kick cleared the trigger (1 = just, 2 = twice)
//   energy                   0..1, how big the song is *right now*: level over the last few
//                            seconds against a much slower (~minute) reference, so a chorus
//                            reads higher than the verse instead of being normalised away
//   rmsDb                    raw RMS in dBFS (after input gain) for play/silence detection
//
// Auto-gain: each value is divided by a slowly-tracked reference (its recent
// average while music is playing), so average loudness maps to ~0.5 and peaks
// to ~1 for both quiet and loud songs. It only adapts while above the play
// threshold, so silence never gets "normalised up".
import { damp, clamp } from '../gfx/math.js';

const BANDS = {
  bass: [30, 150],
  mid: [150, 2000],
  high: [2000, 10000],
  kick: [40, 130],    // used for beat detection
};

// Reference values used before auto-gain has adapted (and when AGC is off).
// Roughly "a typical mixed music feed at line level".
const FIXED_REF = { level: 0.12, bass: 0.02, mid: 0.004, high: 0.0007, kick: 0.025 };

const SMOOTH = {           // [attack, release] time constants, seconds
  level: [0.06, 0.3],
  bass: [0.03, 0.18],
  mid: [0.04, 0.2],
  high: [0.02, 0.15],
};

export class Analyser {
  constructor() {
    this.node = null;
    this.ref = { ...FIXED_REF };
    this.data = {
      level: 0, bass: 0, mid: 0, high: 0,
      beat: false, beatPulse: 0, beatCount: 0, beatStrength: 0, energy: 0,
      rmsDb: -100, rmsDbSmooth: -100,
      raw: { level: 0, bass: 0, mid: 0, high: 0, kick: 0 },
      gain: { level: 1, bass: 1, mid: 1, high: 1 }, // current auto-gain factors (debug)
    };
    this.kickAvg = 0;
    this.longRef = FIXED_REF.level;  // slow reference for energy
    this.gatedTime = 0;              // seconds of music heard (the reference adapts fast at first)
    this.energyRaw = 0;
    this.lastBeat = -1;
    this.time = 0;
  }

  attach(analyserNode) {
    this.node = analyserNode;
    this.timeBuf = new Float32Array(analyserNode.fftSize);
    this.freqBuf = new Float32Array(analyserNode.frequencyBinCount);
    const binHz = analyserNode.context.sampleRate / analyserNode.fftSize;
    this.bins = {};
    for (const [k, [lo, hi]] of Object.entries(BANDS)) {
      const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(this.freqBuf.length - 1, Math.ceil(hi / binHz));
      this.bins[k] = [a, Math.max(a, b)];
    }
  }

  _band(k) {
    const [a, b] = this.bins[k], f = this.freqBuf;
    let sum = 0;
    for (let i = a; i <= b; i++) { const db = f[i]; if (db > -160) sum += Math.pow(10, db / 20); }
    return sum / (b - a + 1);
  }

  /**
   * @param dt seconds since last frame
   * @param s settings (agc, agcTime, thresholdDb, hysteresisDb, beatSensitivity, beatCooldown)
   */
  update(dt, s, active) {
    const d = this.data;
    this.time += dt;
    d.beat = false;
    if (!this.node || !active) {
      // decay everything gracefully to zero when there is no source
      for (const k of ['level', 'bass', 'mid', 'high']) d[k] = damp(d[k], 0, 0.3, dt);
      d.beatPulse *= Math.exp(-dt / 0.18);
      d.energy = damp(d.energy, 0, 3, dt);
      d.rmsDb = -100;
      d.rmsDbSmooth = damp(d.rmsDbSmooth, -100, 0.3, dt);
      return d;
    }

    this.node.getFloatTimeDomainData(this.timeBuf);
    this.node.getFloatFrequencyData(this.freqBuf);

    let sq = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sq += this.timeBuf[i] * this.timeBuf[i];
    const rms = Math.sqrt(sq / this.timeBuf.length);
    d.rmsDb = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
    d.rmsDbSmooth = damp(d.rmsDbSmooth, d.rmsDb, 0.1, dt);

    const raw = d.raw;
    raw.level = rms;
    raw.bass = this._band('bass');
    raw.mid = this._band('mid');
    raw.high = this._band('high');
    raw.kick = this._band('kick');

    // ---- auto gain: track the average of each value while music is present
    const gateOpen = d.rmsDbSmooth > s.thresholdDb;
    for (const k of ['level', 'bass', 'mid', 'high', 'kick']) {
      if (!s.agc) { this.ref[k] = FIXED_REF[k]; continue; }
      if (gateOpen) this.ref[k] = damp(this.ref[k], Math.max(raw[k], FIXED_REF[k] * 0.02), s.agcTime, dt);
      this.ref[k] = clamp(this.ref[k], FIXED_REF[k] * 0.02, FIXED_REF[k] * 40);
    }

    // ---- normalise + smooth (fast attack, slower release)
    for (const k of ['level', 'bass', 'mid', 'high']) {
      const target = clamp((raw[k] / this.ref[k]) * 0.5, 0, 1);
      const [att, rel] = SMOOTH[k];
      d[k] = damp(d[k], target, target > d[k] ? att : rel, dt);
      d.gain[k] = 0.5 / this.ref[k];
    }

    // ---- energy: a few seconds of level against a ~minute reference
    if (gateOpen) {
      this.gatedTime += dt;
      this.longRef = damp(this.longRef, Math.max(raw.level, FIXED_REF.level * 0.02), Math.min(45, 3 + this.gatedTime), dt);
    }
    this.energyRaw = damp(this.energyRaw, raw.level, 0.8, dt);
    const eTarget = gateOpen ? clamp((this.energyRaw / this.longRef) * 0.5, 0, 1) : 0;
    d.energy = damp(d.energy, eTarget, eTarget > d.energy ? 1 : 3, dt);

    // ---- beat: low-end energy jump against its rolling average, with cooldown
    const kick = raw.kick;
    if (this.kickAvg === 0) this.kickAvg = kick;
    const loudEnough = kick > this.ref.kick * 0.4 && d.rmsDbSmooth > s.thresholdDb - s.hysteresisDb;
    if (loudEnough && kick > this.kickAvg * s.beatSensitivity && this.time - this.lastBeat > s.beatCooldown) {
      d.beat = true;
      d.beatStrength = kick / Math.max(1e-9, this.kickAvg * s.beatSensitivity);
      d.beatCount++;
      d.beatPulse = 1;
      this.lastBeat = this.time;
    } else {
      d.beatPulse *= Math.exp(-dt / 0.18);
    }
    this.kickAvg = damp(this.kickAvg, kick, 0.6, dt);
    return d;
  }
}
