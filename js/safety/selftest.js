// Pre-show self-test (?selftest, or the "Pre-show check" button): a short bench of every
// style on THIS machine plus the things that go wrong at venues (GPU fallback, audio needing
// a click, no input signal, battery power, no offline cache, MIDI missing). Ends with a
// report and rewrites the governor's heavy list from the measured frame rates.
import { Bench } from '../bench.js';

const IDLE_S = 1, ACTIVE_S = 2.5;
const HEAVY_FPS = 45;

export class SelfTest {
  /** ctx: { renderer, styles, engine, midi, governor, keyOf, s } */
  constructor(ctx) {
    Object.assign(this, ctx);
    this.bench = new Bench(this.styles, this.renderer, { idle: IDLE_S, active: ACTIVE_S, quiet: true });
    this.peak = 0; this.probeBuf = null; this.probeT = 0;
    this.finished = false;
    this.saved = { autoSwitch: this.s.autoSwitch, governor: this.governor.enabled };
    this.s.autoSwitch = false;          // the idle phases must not trigger an auto-switch
    this.governor.enabled = false;      // we're measuring, not reacting
  }

  get label() { return `PRE-SHOW CHECK ${this.bench.i + 1}/${this.styles.count} · ${this.styles.name(this.bench.i)}`; }

  /** Called every frame while running: watch the real input level alongside the bench. */
  tick(dt) {
    const a = this.engine.analyser;
    if (this.engine.mode !== 'live' || !a || (this.probeT += dt) < 0.1) return;
    this.probeT = 0;
    if (!this.probeBuf) this.probeBuf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(this.probeBuf);
    for (let i = 0; i < this.probeBuf.length; i++) this.peak = Math.max(this.peak, Math.abs(this.probeBuf[i]));
  }

  async finish() {
    this.finished = true;
    this.s.autoSwitch = this.saved.autoSwitch;
    this.governor.enabled = this.saved.governor;
    this.governor.settle();
    const checks = [];
    const add = (status, title, detail) => checks.push({ status, title, detail });
    const res = this.bench.results;

    // ---- GPU / display
    const gl = this.renderer.gl, dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const software = /swiftshader|llvmpipe|basic render|software/i.test(gpu);
    add(software ? 'fail' : 'ok', 'Graphics', software ? `${gpu}: software rendering. Update the GPU driver or turn on hardware acceleration in Chrome.` : gpu);
    const refresh = Math.max(...res.map((r) => r['fps idle']));
    add('info', 'Display', `${screen.width}×${screen.height} @ ~${Math.round(refresh)} Hz, pixel ratio ${devicePixelRatio}`);

    // ---- styles on this machine
    const shown = res.filter((r, i) => !this.styles.classes[i].meta?.hidden);   // not the test scene
    const slow = shown.filter((r) => r['fps active'] < HEAVY_FPS);
    const visible = this.styles.classes.filter((C) => !C.meta?.hidden).length;
    const order = [...shown].sort((a, b) => a['fps active'] - b['fps active']);
    const worst = order.slice(0, 3).map((r) => `${r.style} ${r['fps active']}`).join(', ');
    if (slow.length > Math.max(2, Math.floor(visible / 4))) {
      add('fail', 'Frame rate', `${slow.length} of ${shown.length} environments under ${HEAVY_FPS} fps: the machine is slow overall. Plug in the charger, set Windows power mode to Best performance, close other apps, then run the check again. (Heavy list left as it was.)`);
    } else {
      this.governor.heavy = new Set(slow.map((r) => this.keyOf(this.styles.classes[res.indexOf(r)])));
      this.governor._save(); this.governor._applyHeavy(); this.governor.saturated = false;
      add(slow.length ? 'warn' : 'ok', 'Frame rate', slow.length
        ? `${slow.length} environment(s) under ${HEAVY_FPS} fps, taken out of the rotation on this machine: ${slow.map((r) => r.style).join(', ')}`
        : order[0]['fps active'] >= refresh * 0.95
          ? `All ${shown.length} environments run at the display's full ~${Math.round(refresh)} fps.`
          : `All ${shown.length} environments hold ${HEAVY_FPS}+ fps (slowest: ${worst}).`);
    }

    // ---- audio
    const eng = this.engine;
    if (eng.mode === 'live') {
      add(eng.running ? 'ok' : 'warn', 'Audio start', eng.running ? 'Audio running without a click.' : 'Audio is waiting for a click. Use kiosk.bat, or click once after loading.');
      const db = this.peak > 0 ? 20 * Math.log10(this.peak) : -Infinity;
      const dbs = Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : 'digital silence';
      if (db > -1) add('warn', 'Input level', `Peak ${dbs}: clipping. Turn the interface gain down (LINE, not INST).`);
      else if (db < -60) add('warn', 'Input level', `Peak ${dbs} during the check. Fine if nothing was playing; otherwise check the aux cable, the input channel and LINE/INST.`);
      else add('ok', 'Input level', `Peak ${dbs} on ${eng.deviceLabel || 'default input'}.`);
    } else {
      add('warn', 'Live input', eng.mode === 'file' ? 'Playing a file, not live input.' : 'No live input open. Pick the interface under Audio and press Start live input.');
    }

    // ---- show control
    if (!this.midi.supported) add('info', 'MIDI', 'This browser has no Web MIDI (keyboard / footswitch keys still work).');
    else if (!this.midi.enabled) add('info', 'MIDI', 'Off.');
    else {
      const names = this.midi.inputs.map((i) => i.name);
      add(names.length ? 'ok' : 'warn', 'MIDI', names.length ? names.join(', ') : 'Enabled but no MIDI device connected.');
    }

    // ---- projector: screens + window-management permission (never prompts: getScreenDetails only if already granted)
    {
      let perm = 'unsupported', n = null;
      try { perm = (await navigator.permissions.query({ name: 'window-management' })).state; } catch (e) { /* unknown name */ }
      try {
        if (perm === 'granted' && typeof window.getScreenDetails === 'function') n = (await window.getScreenDetails()).screens.length;
        else if (typeof screen.isExtended === 'boolean') n = screen.isExtended ? '2+' : 1;
      } catch (e) { /* ignore */ }
      add('info', 'Projector', `${n == null ? 'screens unknown' : `${n} screen${n === 1 ? '' : 's'}`}, window-management permission: ${perm}${perm === 'prompt' ? ' (asked when you first open the projector)' : ''}.`);
    }

    // ---- venue robustness
    let cached = 0;
    try { cached = (await (await caches.open('vaporstation-v1')).keys()).length; } catch (e) { /* no cache API */ }
    const sw = !!navigator.serviceWorker?.controller;
    add(sw && cached > 50 ? 'ok' : 'warn', 'Offline copy', sw ? `${cached} files cached: reloads work without the server.` : 'Not active yet. Reload once with the server running.');
    add('wakeLock' in navigator ? 'ok' : 'warn', 'Screen sleep', 'wakeLock' in navigator ? 'Kept awake in fullscreen / kiosk. Also set Windows sleep to Never on mains.' : 'No wake lock in this browser: set Windows sleep to Never.');
    try {
      const b = await navigator.getBattery?.();
      if (b) add(b.charging ? 'ok' : 'warn', 'Power', b.charging ? `Charging (${Math.round(b.level * 100)} %).` : `On battery (${Math.round(b.level * 100)} %): laptops throttle the GPU on battery. Plug in.`);
    } catch (e) { /* no battery API */ }

    this.report = { when: new Date().toLocaleString(), checks, styles: res };
    window.selfTestReport = this.report;
    this._show();
  }

  _show() {
    const { checks, styles, when } = this.report;
    const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
    const modal = el('div', { className: 'modal selftest' });
    const dlg = el('div', { className: 'dialog wide' });
    const rows = el('div', { className: 'checks' }, ...checks.map((c) =>
      el('div', { className: `check ${c.status}` }, el('span', { className: 'chip', textContent: c.status.toUpperCase() }), el('b', { textContent: c.title }), el('span', { textContent: c.detail }))));
    const table = el('table', {}, el('tr', {}, ...['Environment', 'fps idle', 'fps active', 'draws', 'tris'].map((h) => el('th', { textContent: h }))),
      ...styles.map((r) => el('tr', { className: r['fps active'] < HEAVY_FPS ? 'slow' : '' },
        ...[r.style, r['fps idle'], r['fps active'], r.draws, r.tris].map((v) => el('td', { textContent: String(v) })))));
    const text = () => `Vaporstation pre-show check, ${when}\n` + checks.map((c) => `[${c.status.toUpperCase()}] ${c.title}: ${c.detail}`).join('\n')
      + '\n\n' + styles.map((r) => `${r.style}: ${r['fps idle']} / ${r['fps active']} fps`).join('\n');
    const close = () => {
      modal.remove();
      const u = new URL(location.href); u.searchParams.delete('selftest'); history.replaceState(null, '', u);
      this.onClose?.();
    };
    const copyBtn = el('button', { textContent: 'Copy report', onclick: () => navigator.clipboard?.writeText(text()).then(() => { copyBtn.textContent = 'Copied'; }) });
    dlg.append(
      el('h2', { textContent: `Pre-show check · ${when}` }), rows,
      el('details', {}, el('summary', { textContent: 'Frame rate per environment' }), table),
      el('div', { className: 'btns' }, copyBtn,
        el('button', { textContent: 'Run again', onclick: () => { const u = new URL(location.href); u.searchParams.set('selftest', ''); location.href = u; } }),
        el('button', { textContent: 'Close', onclick: close })));
    modal.append(dlg);
    document.body.append(modal);
  }
}
