// Watchdog: keeps the screen and the audio input alive through the failures a gig laptop
// actually hits. See docs/superpowers/specs/2026-11-22-gig-safety-design.md.
//  - WebGL context lost (driver reset / GPU hiccup): fog-coloured dithered cover fades in,
//    everything is rebuilt on restore and the cover fades out. No restore in 6 s, or the
//    rebuild throws -> reload (settings already remember style, palette and input device).
//  - AudioContext suspended/interrupted: resume() retried.
//  - Live input gone (track ended, interface unplugged): reopened with backoff.
//  - Live stream delivering exact digital zero for 8 s (dead stream): reopened.

const RESTORE_TIMEOUT = 6000;
const DEAD_SILENCE = 8;          // seconds of exact zeros before reopening the input

export class Watchdog {
  /**
   * opts: { canvas (renderer.canvas, the OffscreenCanvas: context events fire there), renderer, styles, engine, governor, wantLive: () => bool, reopenLive: () => Promise,
   *         status: (text, isError) => void }
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.lostAt = 0;
    this.restoreTimer = 0;
    this.retryIn = 0; this.backoff = 0.5; this.reopening = false;
    this.zeroFor = 0; this.probeT = 0; this.probeBuf = null;
    this.resumeT = 0;
    this.log = [];
    this._cover();
    this.canvas.addEventListener('webglcontextlost', (e) => this._lost(e));
    this.canvas.addEventListener('webglcontextrestored', () => this._restored());
  }

  _note(msg) { this.log.push(`${new Date().toLocaleTimeString()} ${msg}`); if (this.log.length > 30) this.log.shift(); console.warn('[watchdog] ' + msg); }

  get label() { return this.renderer.lost ? 'GL lost, waiting for restore' : this.reopening ? 'reopening input' : 'ok'; }

  // ---------------- WebGL ----------------
  _cover() {
    const c = document.createElement('div');
    c.id = 'glcover';
    // 2x2 ordered dither of the fog colour and a darker shade: no smooth gradient, PS1-ish
    Object.assign(c.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', opacity: '0', zIndex: '5',
      transition: 'opacity 0.3s linear', imageRendering: 'pixelated', backgroundSize: '8px 8px',
    });
    document.body.appendChild(c);
    this.coverEl = c;
  }

  _showCover(on) {
    const c = this.coverEl;
    if (on) {
      const f = this.renderer.fogColor || [0, 0, 0];
      const rgb = (k) => `rgb(${f.map((v) => Math.round(v * 255 * k)).join(',')})`;
      c.style.backgroundColor = rgb(1);
      c.style.backgroundImage = `conic-gradient(${rgb(0.8)} 25%, transparent 0 50%, ${rgb(0.8)} 0 75%, transparent 0)`;
      c.style.transition = 'opacity 0.3s linear';
      c.style.opacity = '1';
    } else {
      c.style.transition = 'opacity 1.5s linear';
      c.style.opacity = '0';
    }
  }

  _lost(e) {
    e.preventDefault();   // tells the browser we want webglcontextrestored
    this.renderer.lost = true;
    this.lostAt = performance.now();
    this._showCover(true);
    this._note('WebGL context lost');
    clearTimeout(this.restoreTimer);
    this.restoreTimer = setTimeout(() => { if (this.renderer.lost) this._reload('no context restore'); }, RESTORE_TIMEOUT);
  }

  _restored() {
    clearTimeout(this.restoreTimer);
    try {
      this.renderer.restore();
      this.styles.rebuild();
      this.onRestored?.();
      this.governor?.settle();
      this._note(`WebGL restored after ${((performance.now() - this.lostAt) / 1000).toFixed(1)} s`);
      // let a couple of frames land under the cover before fading it out
      setTimeout(() => this._showCover(false), 120);
    } catch (err) {
      console.error(err);
      this._reload('rebuild failed');
    }
  }

  _reload(why) {
    this._note(`reloading (${why})`);
    try { sessionStorage.setItem('vaporstation.recovered', why); } catch (e) { /* ignore */ }
    location.reload();
  }

  // ---------------- audio ----------------
  update(dt) {
    const eng = this.engine;
    // context suspended / interrupted (OS audio hiccup, device sleep): try to resume
    if (eng.ctx && eng.ctx.state !== 'running' && eng.mode !== 'none' && (this.resumeT -= dt) <= 0) {
      this.resumeT = 2;
      eng.ctx.resume().catch(() => {});
    }

    if (!this.wantLive()) { this.backoff = 0.5; this.retryIn = 0; this.zeroFor = 0; return; }

    // live input wanted but not open: reopen with backoff
    if (eng.mode !== 'live') {
      if (this.reopening) return;
      if (this.retryIn <= 0) this.retryIn = this.backoff;
      if ((this.retryIn -= dt) <= 0) this._reopen('input lost');
      return;
    }
    this.backoff = 0.5;

    // dead stream: exact zeros (a real line input always has a noise floor)
    if ((this.probeT += dt) >= 0.5 && eng.analyser && eng.running) {
      this.probeT = 0;
      const a = eng.analyser;
      if (!this.probeBuf || this.probeBuf.length !== a.fftSize) this.probeBuf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(this.probeBuf);
      let peak = 0;
      for (let i = 0; i < this.probeBuf.length; i++) peak = Math.max(peak, Math.abs(this.probeBuf[i]));
      this.zeroFor = peak === 0 ? this.zeroFor + 0.5 : 0;
      if (this.zeroFor >= DEAD_SILENCE) { this.zeroFor = 0; this._reopen('input delivering digital silence'); }
    }
  }

  async _reopen(why) {
    this.reopening = true;
    this._note(`${why}: reopening`);
    try { await this.reopenLive(); } catch (e) { console.warn(e); }
    this.reopening = false;
    if (this.engine.mode !== 'live') { this.backoff = Math.min(10, this.backoff * 2); this.retryIn = this.backoff; }
  }
}
