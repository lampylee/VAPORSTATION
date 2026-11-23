// The Conductor: shapes intensity to the whole song instead of 0 -> 1 in two seconds.
//
//   analyser ─► PlayState (playing, k_play) ─► Conductor.process() ─► ShowControl ─► styles
//
// It listens across the song (smoothed loudness, bass and highs from the analyser's raw
// values, so auto-gain doesn't flatten them) and guesses a section:
//   intro      the first ~8 s
//   groove     the default
//   build      loudness climbing for several seconds, or highs rising while the bass falls (a riser)
//   drop       loudness jumps well above its recent minimum with the bass back (after a build /
//              breakdown, or out of nowhere if the jump is big); holds ~8 bars
//   breakdown  well under the song's average with little bass, for a few seconds
//   outro      fading toward silence late in the song
// and turns that into a target intensity: a slow arc through the song, down for breakdowns,
// lifted through builds, and the top of the range (0.85..1) kept for drops. k = k_play × shaped,
// so start / stop / silence behave exactly as before.
//
// It also estimates tempo from the detected beats (inter-onset histogram, 80-170 bpm) so styles
// get audio.bpm / beatPhase / bar without tap tempo (tap tempo still wins, in ShowControl).
//
// Adds to the analyser data: section, build (0..1), drop (true for one frame), songTime,
// autoBpm / autoPhase / autoBar / autoConf. With s.conductor off it passes k through untouched
// and the fields read neutral.
//
// Pure logic, no DOM: tools/test-conductor.mjs drives it with synthetic songs.
import { clamp, damp, lerp, smoothstep } from '../gfx/math.js';

const RING_HZ = 10;            // feature history sample rate
const RING_N = 80;             // 8 s of history
const MIN_HOLD = 4;            // s a section holds before the next (a drop can always cut in)
const INTRO = 8;               // s
const DROP_HOLD = 16;          // s a drop section lasts when the tempo is unknown
const DROP_GAP = 24;           // s between drops at least
const ARC_TIME = 75;           // s for the song arc 0 -> 1 at average energy
const PEAK_DECAY = 8;          // s time constant of the drop peak after the drop section (~20 s to fade)
const LONG_HIGH = 150;         // s of high energy with no drop before the cap starts lifting
const TEMPO_WIN = 12;          // s of beats in the tempo histogram

const log = (x) => Math.log(Math.max(1e-7, x));

export class Conductor {
  constructor() {
    this.ring = new Float32Array(RING_N);     // log Es history
    this.bring = new Float32Array(RING_N);    // log bassS history
    this.onsets = [];
    this.hist = new Float32Array(171);
    this.reset();
    this.active = false;       // a song is under way
    this.shaped = 0.5;
    this.k = 0;
    this.worldChange = false;  // true on the frame a drop asks for a new environment (s.dropSwitch)
  }

  /** Forget the song (called when a new one starts). */
  reset() {
    this.songTime = 0;
    this.Es = 0; this.El = 0; this.bassS = 0; this.bassL = 0; this.highS = 0; this.highL = 0;
    this.ring.fill(0); this.ringPos = 0; this.ringAcc = 0; this.ringFill = 0;
    this.section = 'intro'; this.sectionTime = 0; this.prev = '';
    this.buildEv = 0; this.buildOff = 0; this.breakEv = 0; this.breakOff = 0; this.outroEv = 0;
    this.build = 0; this.buildRaw = 0;
    this.arc = 0; this.peak = 0; this.dropFast = false; this.lastDrop = -1e9; this.drops = 0;
    this.highTime = 0; this.changed = false;
    this.onsets.length = 0; this.bpm = 0; this.conf = 0; this.phase = 0; this.beatN = 0; this.tempoT = 0;
    this.drop = false;
  }

  // ring helpers: value `ago` seconds back (clamped to what's been recorded)
  _ago(sec) {
    const n = Math.min(this.ringFill, Math.round(sec * RING_HZ));
    return this.ring[(this.ringPos - 1 - n + RING_N * 2) % RING_N];
  }
  _minOver(sec, ring = this.ring, cur = log(this.Es)) {
    const n = Math.min(this.ringFill, Math.round(sec * RING_HZ));
    let m = cur;
    for (let i = 1; i <= n; i++) m = Math.min(m, ring[(this.ringPos - i + RING_N) % RING_N]);
    return m;
  }

  _enter(sec) { this.prev = this.section; this.section = sec; this.sectionTime = 0; }

  /**
   * a: analyser data (mutated: section / build / drop / songTime / auto tempo fields added).
   * kPlay / playing: from PlayState. Returns the shaped intensity.
   */
  process(a, kPlay, playing, dt, s) {
    this.drop = false; this.worldChange = false;
    if (s.conductor === false) {
      this.active = false;
      a.section = ''; a.build = 0; a.drop = false; a.songTime = 0;
      a.autoBpm = 0; a.autoPhase = 0; a.autoBar = 0; a.autoConf = 0;
      this.k = kPlay;
      return kPlay;
    }

    // ---- song boundaries: a song starts when playing after k reached 0, ends when k is back to 0
    if (!this.active && playing) { this.reset(); this.active = true; this.shaped = -1; }
    else if (this.active && !playing && kPlay <= 0) this.active = false;

    if (this.active) this._listen(a, playing, dt, s);
    else { this.build = damp(this.build, 0, 1, dt); this.peak = damp(this.peak, 0, 2, dt); }

    a.section = this.active ? this.section : '';
    a.build = this.build;
    a.drop = this.drop;
    a.songTime = this.active ? this.songTime : 0;
    a.autoBpm = this.bpm; a.autoConf = this.conf;
    a.autoPhase = this.bpm ? this.phase : 0; a.autoBar = this.beatN & 3;

    this.k = kPlay * clamp(this.shaped < 0 ? 0.5 : this.shaped);
    return this.k;
  }

  _listen(a, playing, dt, s) {
    const raw = a.raw || a;
    this.songTime += dt; this.sectionTime += dt;
    const t = this.songTime;

    // ---- features (only while there is sound: a short stop doesn't drag the averages down)
    const sounding = playing && (a.rmsDbSmooth ?? 0) > (s.thresholdDb ?? -50) - (s.hysteresisDb ?? 4);
    if (this.Es === 0) {   // first frame of the song: start the averages where the song is
      this.Es = this.El = raw.level; this.bassS = this.bassL = raw.bass; this.highS = this.highL = raw.high;
      this.ring.fill(log(raw.level)); this.bring.fill(log(raw.bass));
    }
    if (sounding) {
      const lt = Math.min(20, 3 + t);   // long averages settle faster at the start of a song
      this.Es = damp(this.Es, raw.level, 1.5, dt); this.El = damp(this.El, raw.level, lt, dt);
      this.bassS = damp(this.bassS, raw.bass, 1, dt); this.bassL = damp(this.bassL, raw.bass, lt, dt);
      this.highS = damp(this.highS, raw.high, 1, dt); this.highL = damp(this.highL, raw.high, lt, dt);
    }
    this.ringAcc += dt;
    while (this.ringAcc >= 1 / RING_HZ) {
      this.ringAcc -= 1 / RING_HZ;
      this.ring[this.ringPos] = log(this.Es); this.bring[this.ringPos] = log(this.bassS);
      this.ringPos = (this.ringPos + 1) % RING_N; this.ringFill = Math.min(RING_N - 1, this.ringFill + 1);
    }
    const lE = log(this.Es);
    const ratio = this.Es / Math.max(1e-7, this.El);                   // now vs the song's average
    const bassR = this.bassS / Math.max(1e-7, this.bassL);
    const highR = this.highS / Math.max(1e-7, this.highL);
    const slope = lE - this._ago(6);                                     // log rise over 6 s
    const jump = lE - this._minOver(4);                                  // log rise over the 4 s minimum
    const lB = log(this.bassS), bassJump = lB - this._minOver(4, this.bring, lB);

    // ---- sections
    const sec = this.section, held = this.sectionTime >= MIN_HOLD;
    // a riser: highs up while the bass drains out (the overall level may even fall as the kick goes)
    const rising = slope > 0.28 || (highR > 1.3 && bassR < 0.7 && slope > -0.8);
    this.buildEv = rising ? this.buildEv + dt : Math.max(0, this.buildEv - dt * 2);
    const fadingFast = slope < -0.35;
    const low = ratio < 0.62 && bassR < 0.65 && !rising;
    this.breakEv = low ? this.breakEv + dt : Math.max(0, this.breakEv - dt * 2);
    const fading = fadingFast && lE - this._ago(3) < -0.12 && log(this.El) < this._ago(8) + 0.2 && t > 45;
    this.outroEv = fading ? this.outroEv + dt : Math.max(0, this.outroEv - dt * 2);

    const afterTension = sec === 'build' || sec === 'breakdown' || this.prev === 'build' && this.sectionTime < 3;
    const dropOk = sec !== 'drop' && t > INTRO && t - this.lastDrop > DROP_GAP && bassR > 0.85 && ratio > 0.9;
    // a drop is the bass coming back hard: a smaller jump counts after a build / breakdown
    if (dropOk && (afterTension ? jump > 0.35 && bassJump > 0.7 : jump > 1.0 && bassJump > 1.0)) {
      this.drop = true; this.drops++; this.lastDrop = t; this.peak = 1; this.dropFast = true;
      // the optional world change: late enough, earned by a build / breakdown, once per song
      if (s.dropSwitch && !this.changed && t >= 45 && afterTension) { this.changed = true; this.worldChange = true; }
      this._enter('drop');
    } else if (sec === 'intro') {
      if (t >= INTRO) this._enter(this.buildEv > 2 ? 'build' : 'groove');
    } else if (sec === 'drop') {
      const len = this.bpm ? Math.min(DROP_HOLD, (32 * 60) / this.bpm) : DROP_HOLD;
      if (this.sectionTime >= len) this._enter(this.breakEv > 3 ? 'breakdown' : 'groove');
      else if (this.sectionTime >= MIN_HOLD && this.breakEv > 3) this._enter('breakdown');   // the drop ended early
    } else if (held) {
      if (sec === 'build') {
        this.buildOff = rising ? 0 : this.buildOff + dt;
        if (this.buildOff > 1.5) this._enter(this.breakEv > 3 ? 'breakdown' : 'groove');
      } else if (sec === 'breakdown') {
        this.breakOff = low || rising ? 0 : this.breakOff + dt;   // a build out of the breakdown is not a return to groove
        if (this.outroEv > 8) this._enter('outro');
        else if (this.buildEv > 2.5) this._enter('build');
        else if (this.breakOff > 2) this._enter('groove');
      } else if (sec === 'outro') {
        if (slope > 0.2) this._enter('groove');
      } else {   // groove
        if (this.outroEv > 8) this._enter('outro');
        else if (this.breakEv > 3) this._enter('breakdown');
        else if (this.buildEv > 2.5) this._enter('build');
      }
    }
    if (this.section !== 'build') this.buildOff = 0;
    if (this.section !== 'breakdown') this.breakOff = 0;

    // ---- build anticipation (0..1): by how long and how far it has climbed
    const inBuild = this.section === 'build';
    this.buildRaw = inBuild ? clamp(Math.max(this.sectionTime / 10, (lE - this._minOver(8)) / 1.2)) : 0;
    this.build = damp(this.build, this.buildRaw, this.buildRaw > this.build ? 0.5 : 1, dt);

    // ---- intensity target
    const e = clamp(a.energy ?? 0.5);
    this.arc = clamp(this.arc + (dt / ARC_TIME) * (0.6 + e * 0.9));
    const arcE = smoothstep(this.arc);
    let target = lerp(0.45, 0.82, arcE) * clamp(0.7 + 0.45 * ratio, 0.75, 1.15);
    // "high energy" for the no-drop cap lift: a steady beat and near the song's average (a ballad never qualifies)
    if (this.onsets.length >= 10 && ratio > 0.8) this.highTime += dt;
    const capLift = this.drops ? 0 : clamp((this.highTime - LONG_HIGH) / 30);
    target = Math.min(target, 0.85);
    if (this.section === 'breakdown') target = Math.min(target, lerp(0.45, 0.35, clamp(this.sectionTime / 6)));
    if (this.section === 'outro') target = Math.min(target, lerp(0.7, 0.45, clamp(this.sectionTime / 10)));
    if (inBuild || this.build > 0.01) target = Math.max(target, lerp(target, 0.85, this.build));
    if (this.section !== 'breakdown' && this.section !== 'outro') target = lerp(target, 1, capLift);
    const calm = this.section === 'breakdown' || this.section === 'outro';   // a breakdown drains the peak faster
    if (this.section !== 'drop') this.peak *= Math.exp(-dt / (calm ? 2.5 : PEAK_DECAY));
    target = target + (1 - target) * this.peak;

    if (this.shaped < 0) this.shaped = target;   // first frame of a song: k_play is ~0 anyway
    const up = target > this.shaped;
    if (this.dropFast && (!up || this.section !== 'drop')) this.dropFast = false;
    this.shaped = damp(this.shaped, target, up ? (this.dropFast ? 0.4 : 3) : calm ? 4 : 6, dt);

    this._tempo(a, dt);
  }

  // ---- auto tempo: inter-onset intervals folded into 80..170 bpm, voted
  _tempo(a, dt) {
    const t = this.songTime, on = this.onsets;
    if (a.beat) on.push(t);
    while (on.length && on[0] < t - TEMPO_WIN) on.shift();

    this.tempoT += dt;
    if (this.tempoT >= 0.5) {
      this.tempoT = 0;
      const h = this.hist; h.fill(0);
      let total = 0;
      for (let i = 0; i < on.length; i++) {
        for (let j = i + 1; j <= i + 2 && j < on.length; j++) {
          let bpm = 60 / (on[j] - on[i]);
          if (!(bpm > 20 && bpm < 400)) continue;
          while (bpm < 80) bpm *= 2;
          while (bpm >= 170) bpm /= 2;
          const w = j === i + 1 ? 1 : 0.5, b = Math.round(bpm);
          h[b] += w; h[b - 1] += w * 0.5; if (b + 1 < h.length) h[b + 1] += w * 0.5;
          total += w;
        }
      }
      let best = 0, bi = 0;
      for (let b = 80; b < 170; b++) if (h[b] > best) { best = h[b]; bi = b; }
      const conf = total > 0 && on.length >= 8 ? clamp(best / total) : 0;
      this.conf = damp(this.conf, conf, 1.5, 0.5);
      if (bi && (this.bpm ? this.conf > 0.35 : this.conf > 0.5)) {
        // refine: beats are frame-quantised, so count whole half-beats across the span instead of
        // averaging intervals (onsets may run at twice the folded tempo, or skip beats)
        const half = 30 / bi, span = on[on.length - 1] - on[0];
        let units = 0;
        for (let i = 1; i < on.length; i++) units += Math.max(1, Math.round((on[i] - on[i - 1]) / half));
        let est = span > 2 ? (30 * units) / span : bi;
        while (est >= 170) est /= 2;
        while (est < 80) est *= 2;
        if (Math.abs(est - bi) >= 3) est = bi;
        this.bpm = this.bpm && Math.abs(this.bpm - est) < 4 ? lerp(this.bpm, est, 0.3) : est;
      } else if (this.conf <= 0.35) this.bpm = 0;
    }
    if (!this.bpm) return;
    this.phase += dt * this.bpm / 60;
    if (this.phase >= 1) { this.phase -= Math.floor(this.phase); this.beatN++; }
    if (a.beat) {   // detected beats pull the grid toward them
      const off = this.phase > 0.5 ? this.phase - 1 : this.phase;
      if (Math.abs(off) < 0.25) this.phase -= off * 0.3;
      if (this.phase < 0) this.phase += 1;
    }
  }

  get label() {
    if (!this.active) return 'song: —';
    const m = Math.floor(this.songTime / 60), sec = Math.floor(this.songTime % 60).toString().padStart(2, '0');
    const bpm = this.bpm ? `${this.bpm.toFixed(0)} bpm (${(this.conf * 100).toFixed(0)}%)` : `bpm ? (${(this.conf * 100).toFixed(0)}%)`;
    return `song: ${this.section} ${m}:${sec} · arc ${(this.arc * 100).toFixed(0)}% · build ${(this.build * 100).toFixed(0)}% · ${bpm}`;
  }
}
