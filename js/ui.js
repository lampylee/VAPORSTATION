// Settings panel (built from a schema) + debug overlay.
import { RESOLUTIONS } from './gfx/ps1.js';

const SECTIONS = [
  ['Styles', [
    { key: 'style', label: 'Style', type: 'select', options: [] },
    { key: 'autoSwitch', label: 'Auto-switch while idle (A)', type: 'check' },
    { key: 'idleSwitchDelay', label: 'Idle before switching', min: 2, max: 120, step: 1, unit: 's' },
    { key: 'idleSwitchInterval', label: 'Then every', min: 10, max: 300, step: 5, unit: 's' },
    { key: 'transitionTime', label: 'Crossfade time', min: 0.5, max: 10, step: 0.1, unit: 's' },
  ]],
  ['Input level & gain', [
    { key: 'inputGainDb', label: 'Input gain', min: -24, max: 36, step: 0.5, unit: 'dB' },
    { key: 'agc', label: 'Auto-gain (normalise songs)', type: 'check' },
    { key: 'agcTime', label: 'Auto-gain speed', min: 2, max: 30, step: 1, unit: 's' },
  ]],
  ['Play / silence detection', [
    { key: 'thresholdDb', label: 'Threshold', min: -90, max: -10, step: 1, unit: 'dB' },
    { key: 'hysteresisDb', label: 'Hysteresis', min: 0, max: 15, step: 0.5, unit: 'dB' },
    { key: 'startHold', label: 'Start hold', min: 0.1, max: 3, step: 0.05, unit: 's' },
    { key: 'stopHold', label: 'Stop hold', min: 0.5, max: 10, step: 0.1, unit: 's' },
    { key: 'rampUp', label: 'Swell in', min: 0.2, max: 8, step: 0.1, unit: 's' },
    { key: 'rampDown', label: 'Ease out', min: 0.5, max: 12, step: 0.1, unit: 's' },
    { key: 'beatSensitivity', label: 'Beat threshold', min: 1.05, max: 2.5, step: 0.05, unit: '×' },
    { key: 'beatCooldown', label: 'Beat cooldown', min: 0.08, max: 0.6, step: 0.01, unit: 's' },
  ]],
  ['PS1 look', [
    { key: 'resolution', label: 'Internal resolution', type: 'select', options: Object.keys(RESOLUTIONS).map((k) => [k, k === 'auto240' ? 'auto (240p, screen aspect)' : k]) },
    { key: 'aspectMode', label: 'Scaling', type: 'select', options: [['fit', 'fit (keep aspect)'], ['stretch', 'stretch']] },
    { key: 'jitter', label: 'Vertex jitter', min: 0, max: 4, step: 0.1, unit: 'px' },
    { key: 'affine', label: 'Affine texture warp', min: 0, max: 1, step: 0.05 },
    { key: 'dither', label: 'Dither', min: 0, max: 1, step: 0.05 },
    { key: 'colorBits', label: 'Colour bits/channel', min: 3, max: 8, step: 1 },
    { key: 'audioPushesLook', label: 'Music pushes jitter & fog', type: 'check' },
    { key: 'crt', label: 'CRT scanlines (C)', type: 'check' },
  ]],
];

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => e.append(k));
  return e;
};

export class UI {
  /** h = handlers: onChange(key), onDevice(id), onStartLive(), onFile(file), onDemo(), onRefresh(), onFullscreen(), onReset() */
  constructor(settings, styleNames, h) {
    this.s = settings; this.h = h; this.inputs = {};
    SECTIONS.find(([t]) => t === 'Styles')[1][0].options = styleNames.map((n, i) => [String(i), `${i}: ${n}`]);
    const panel = document.getElementById('panel');

    // ---- audio source section
    this.deviceSel = el('select', { id: 'device' });
    this.channelSel = el('select', {}, ...['both', 'left', 'right'].map((c) => el('option', { value: c, textContent: c === 'both' ? 'L+R' : c === 'left' ? 'Input 1 / left' : 'Input 2 / right' })));
    this.channelSel.value = settings.channel;
    this.status = el('div', { className: 'status', textContent: 'No input yet.' });
    const fileIn = el('input', { type: 'file', accept: 'audio/*' });
    this.player = el('audio', { id: 'player', controls: true, loop: true });
    const src = el('section', {},
      el('h2', { textContent: 'Audio source' }),
      el('label', { className: 'row' }, el('span', { textContent: 'Device' }), this.deviceSel),
      el('label', { className: 'row' }, el('span', { textContent: 'Channel' }), this.channelSel),
      el('div', { className: 'btns' },
        el('button', { textContent: 'Start live input', onclick: () => h.onStartLive() }),
        el('button', { textContent: '↻ devices', onclick: () => h.onRefresh() })),
      el('div', { className: 'btns' },
        el('label', { className: 'filebtn' }, 'Load audio file…', fileIn),
        el('button', { textContent: 'Play demo track', onclick: () => h.onDemo() })),
      this.player,
      this.status,
      this.meter = el('div', { className: 'meter' }, el('div', { className: 'fill' }), el('div', { className: 'thresh' })),
    );
    this.deviceSel.onchange = () => { h.onDevice(this.deviceSel.value); this.deviceSel.blur(); };
    this.channelSel.onchange = () => { settings.channel = this.channelSel.value; h.onChange('channel'); this.channelSel.blur(); };
    fileIn.onchange = () => { if (fileIn.files[0]) h.onFile(fileIn.files[0]); fileIn.blur(); };
    panel.append(el('h1', { textContent: 'PS1 VISUALIZER' }), src);

    // ---- schema sections
    for (const [title, items] of SECTIONS) {
      const sec = el('section', {}, el('h2', { textContent: title }));
      for (const it of items) sec.append(this._control(it));
      panel.append(sec);
    }
    panel.append(el('section', {},
      el('div', { className: 'btns' },
        el('button', { textContent: 'Fullscreen (F)', onclick: () => h.onFullscreen() }),
        el('button', { textContent: 'Reset settings', onclick: () => h.onReset() })),
      el('pre', { className: 'keys', textContent: 'F fullscreen   H hide UI   D debug\n1-9 style      N / Shift+N next/prev\n0 test scene   A auto-switch  C CRT\nP / Shift+P palette   O style palettes\nS setlist mode\nPgDn → ]  next song (footswitch)\nPgUp ← [  previous song\nI hold   Z freeze   B blackout\nG big moment   T tap   Shift+T clear\nL lock beats to tempo\nDrop an image, palette, setlist or\naudio file anywhere.' })));

    this.debug = document.getElementById('debug');
    this._buildDebug();
  }

  _control(it) {
    const s = this.s, h = this.h;
    if (it.type === 'check') {
      const inp = el('input', { type: 'checkbox', checked: !!s[it.key] });
      inp.onchange = () => { s[it.key] = inp.checked; h.onChange(it.key); inp.blur(); };
      this.inputs[it.key] = { set: (v) => { inp.checked = !!v; } };
      return el('label', { className: 'row check' }, inp, el('span', { textContent: it.label }));
    }
    if (it.type === 'select') {
      const sel = el('select', {}, ...it.options.map(([v, t]) => el('option', { value: v, textContent: t })));
      const numeric = typeof s[it.key] === 'number';
      sel.value = String(s[it.key]);
      sel.onchange = () => { s[it.key] = numeric ? Number(sel.value) : sel.value; h.onChange(it.key); sel.blur(); };
      this.inputs[it.key] = { set: (v) => { sel.value = String(v); } };
      return el('label', { className: 'row' }, el('span', { textContent: it.label }), sel);
    }
    const inp = el('input', { type: 'range', min: it.min, max: it.max, step: it.step, value: s[it.key] });
    const val = el('output');
    const fmt = (v) => `${Number(v).toFixed(it.step < 0.1 ? 2 : it.step < 1 ? 1 : 0)}${it.unit ? ' ' + it.unit : ''}`;
    val.textContent = fmt(s[it.key]);
    inp.oninput = () => { s[it.key] = Number(inp.value); val.textContent = fmt(inp.value); h.onChange(it.key); };
    inp.onchange = () => inp.blur();
    this.inputs[it.key] = { set: (v) => { inp.value = v; val.textContent = fmt(v); } };
    return el('label', { className: 'row' }, el('span', { textContent: it.label }), inp, val);
  }

  /** Insert an extra section (e.g. the palette section) before the named section. */
  insertSectionBefore(section, title) {
    const h2 = [...document.querySelectorAll('#panel h2')].find((x) => x.textContent === title);
    if (h2) h2.parentElement.before(section); else document.getElementById('panel').append(section);
  }

  /**
   * Make every panel section collapsible by clicking its heading. Call once,
   * after all sections are in place. Collapsed titles persist per browser.
   */
  makeCollapsible() {
    const KEY = 'ps1viz.ui.collapsed';
    let closed = [];
    try { closed = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* ignore */ }
    for (const h2 of document.querySelectorAll('#panel > section > h2')) {
      const sec = h2.parentElement, title = h2.textContent;
      h2.tabIndex = 0;
      h2.setAttribute('role', 'button');
      const set = (c) => { sec.classList.toggle('collapsed', c); h2.setAttribute('aria-expanded', String(!c)); };
      set(closed.includes(title));
      const toggle = () => {
        set(!sec.classList.contains('collapsed'));
        closed = [...document.querySelectorAll('#panel > section.collapsed > h2')].map((x) => x.textContent);
        try { localStorage.setItem(KEY, JSON.stringify(closed)); } catch { /* ignore */ }
      };
      h2.onclick = toggle;
      h2.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); toggle(); } };
    }
  }

  /** Sync all controls from settings (after keyboard toggles / reset). */
  refresh() {
    for (const [k, c] of Object.entries(this.inputs)) c.set(this.s[k]);
    this.channelSel.value = this.s.channel;
  }

  setDevices(list, selectedId) {
    this.deviceSel.innerHTML = '';
    this.deviceSel.append(el('option', { value: '', textContent: 'System default input' }));
    list.forEach((d, i) => this.deviceSel.append(el('option', { value: d.deviceId, textContent: d.label || `Audio input ${i + 1} (start live input to see names)` })));
    this.deviceSel.value = list.some((d) => d.deviceId === selectedId) ? selectedId : '';
  }

  setStatus(text, error = false) {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  /** Live level meter in the panel, with the threshold marker. */
  updateMeter(rmsDb, thresholdDb, playing) {
    const pct = (db) => Math.max(0, Math.min(100, ((db + 90) / 90) * 100));
    this.meter.firstChild.style.width = pct(rmsDb) + '%';
    this.meter.firstChild.classList.toggle('on', playing);
    this.meter.lastChild.style.left = pct(thresholdDb) + '%';
  }

  // ---------- debug overlay ----------
  _buildDebug() {
    const rows = ['input', 'level', 'bass', 'mid', 'high', 'intensity'];
    this.dbg = {};
    this.debug.innerHTML = '';
    this.dbg.head = el('div', { className: 'dhead' });
    this.debug.append(this.dbg.head);
    for (const r of rows) {
      const fill = el('div', { className: 'dfill' });
      const val = el('span', { className: 'dval' });
      const bar = el('div', { className: 'dbar' }, fill);
      if (r === 'input') { this.dbg.thresh = el('div', { className: 'dthresh' }); bar.append(this.dbg.thresh); }
      this.debug.append(el('div', { className: 'drow' }, el('span', { className: 'dlab', textContent: r }), bar, val));
      this.dbg[r] = { fill, val };
    }
    this.dbg.beat = el('span', { className: 'beat', textContent: 'BEAT' });
    this.dbg.state = el('span', { className: 'dstate' });
    this.dbg.foot = el('div', { className: 'dfoot' });
    this.debug.append(el('div', { className: 'drow' }, this.dbg.beat, this.dbg.state), this.dbg.foot);
  }

  updateDebug(info) {
    const d = this.dbg, a = info.audio;
    d.head.textContent = `${info.fps.toFixed(0)} fps · ${info.res} · ${info.draws} draws · ${info.tris} tris`;
    const set = (k, v, text) => { d[k].fill.style.width = (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%'; d[k].val.textContent = text; };
    const dbPct = (db) => (db + 90) / 90;
    set('input', dbPct(a.rmsDbSmooth), `${a.rmsDbSmooth.toFixed(1)} dB`);
    d.thresh.style.left = (dbPct(info.thresholdDb) * 100) + '%';
    set('level', a.level, a.level.toFixed(2));
    set('bass', a.bass, a.bass.toFixed(2));
    set('mid', a.mid, a.mid.toFixed(2));
    set('high', a.high, a.high.toFixed(2));
    set('intensity', info.intensity, info.intensity.toFixed(2));
    d.beat.style.opacity = 0.15 + a.beatPulse * 0.85;
    d.beat.textContent = `BEAT ${a.beatCount}`;
    d.state.textContent = info.state;
    d.state.className = 'dstate ' + (info.playing ? 'playing' : 'silent');
    d.foot.textContent = `${info.source}\nstyle: ${info.style}${info.transition ? '  → ' + info.transition : ''}\nsetlist: ${info.setlist}\nshow: ${info.show}\nauto-switch: ${info.autoSwitch ? 'on' : 'off'} · idle ${info.idle.toFixed(0)} s · auto-gain ×${a.gain.bass.toFixed(0)} (bass)`;
  }
}
