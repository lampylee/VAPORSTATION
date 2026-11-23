// ?bench — cycles every style through idle and full intensity with synthetic
// audio and reports frame timings. Results: console.table + window.benchResults.

const IDLE = 2, ACTIVE = 4;

export class Bench {
  /** opts: { idle, active } seconds per phase; quiet = no console.table (the self-test uses it). */
  constructor(styles, renderer, { idle = IDLE, active = ACTIVE, quiet = false } = {}) {
    this.idleS = idle; this.activeS = active; this.quiet = quiet;
    this.styles = styles;
    this.r = renderer;
    this.i = 0;
    this.t = 0;
    this.time = 0;
    this.done = false;
    this.results = [];
    this.audio = { level: 0, bass: 0, mid: 0, high: 0, beat: false, beatPulse: 0, beatCount: 0, rmsDb: -100, rmsDbSmooth: -100, raw: {}, gain: { bass: 1 } };
    this._enter(0);
  }

  _enter(i) {
    this.i = i; this.t = 0;
    this.styles.cur = i; this.styles.next = -1; this.styles.queued = -1;
    this.frames = { idle: [], active: [] };
    this.cpu = { idle: [], active: [] };
  }

  get phase() { return this.t < this.idleS ? 'idle' : 'active'; }
  get intensity() { return this.phase === 'idle' ? 0 : 1; }

  /** Synthetic 128 bpm music. */
  tick(dt) {
    this.t += dt; this.time += dt;
    const a = this.audio, beatLen = 60 / 128;
    const ph = (this.time % beatLen) / beatLen;
    a.beat = ph < dt / beatLen;
    if (a.beat) { a.beatCount++; a.beatPulse = 1; } else a.beatPulse *= Math.exp(-dt / 0.18);
    a.bass = Math.exp(-ph * 4);
    a.mid = 0.5 + 0.3 * Math.sin(this.time * 1.3);
    a.high = 0.5 + 0.5 * Math.sin(this.time * 7.1) * Math.sin(this.time * 0.7);
    a.level = 0.4 + a.bass * 0.4;
    a.rmsDbSmooth = this.phase === 'idle' ? -90 : -18;
    return a;
  }

  record(dt, cpuMs) {
    if (this.t < 0.3 || (this.t > this.idleS && this.t < this.idleS + 0.3)) return; // skip warm-up frames
    this.frames[this.phase].push(dt);
    this.cpu[this.phase].push(cpuMs);
    if (this.t >= this.idleS + this.activeS) this._finishStyle();
  }

  _finishStyle() {
    const stat = (arr) => {
      const s = [...arr].sort((x, y) => y - x);
      const avg = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
      return { avg, worst1: s[Math.floor(s.length * 0.01)] || avg };
    };
    const fa = stat(this.frames.active), fi = stat(this.frames.idle), ca = stat(this.cpu.active);
    this.results.push({
      style: this.styles.name(this.i),
      'fps idle': +(1 / fi.avg).toFixed(1),
      'fps active': +(1 / fa.avg).toFixed(1),
      '1% low fps': +(1 / fa.worst1).toFixed(1),
      'cpu ms': +ca.avg.toFixed(2),
      draws: this.r.stats.draws,
      tris: Math.round(this.r.stats.tris),
    });
    if (this.i + 1 < this.styles.count) this._enter(this.i + 1);
    else {
      this.done = true;
      if (!this.quiet) console.table(this.results);
      window.benchResults = this.results;
    }
  }

  get label() {
    return this.done ? 'Bench done — see console (window.benchResults)'
      : `BENCH ${this.i + 1}/${this.styles.count} ${this.styles.name(this.i)} · ${this.phase}`;
  }
}
