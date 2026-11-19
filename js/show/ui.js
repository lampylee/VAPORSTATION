// Panel sections for show control (pads, hold, tempo), MIDI mapping and the
// environment browser (live thumbnails).
import { MIDI_ACTIONS } from './midi.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => k != null && e.append(k));
  return e;
};

function slider(s, key, label, min, max, step, fmt, onSet) {
  const inp = el('input', { type: 'range', min, max, step, value: s[key] });
  const out = el('output', { textContent: fmt(s[key]) });
  inp.oninput = () => { s[key] = Number(inp.value); out.textContent = fmt(s[key]); onSet(); };
  inp.onchange = () => inp.blur();
  const row = el('label', { className: 'row' }, el('span', { textContent: label }), inp, out);
  row.set = (v) => { inp.value = v; out.textContent = fmt(v); };
  return row;
}

function check(s, key, label, onSet, title = '') {
  const inp = el('input', { type: 'checkbox', checked: !!s[key] });
  inp.onchange = () => { s[key] = inp.checked; onSet(); inp.blur(); };
  const row = el('label', { className: 'row check', title }, inp, el('span', { textContent: label }));
  row.set = (v) => { inp.checked = !!v; };
  return row;
}

// ---------------------------------------------------------------- show control
export class ShowUI {
  /** h: onPad(id), onTap(), onTempo(cmd: 'clear' | +1 | -1), onSetting() */
  constructor(show, s, h) {
    this.show = show; this.s = s; this.h = h;
    const pad = (id, label, key, title) => {
      const b = el('button', { className: `pad pad-${id}`, title, onclick: () => { h.onPad(id); b.blur(); } },
        el('span', { className: 'pad-name', textContent: label }), el('kbd', { textContent: key }));
      return b;
    };
    this.pads = {
      hold: pad('hold', 'Hold', 'I', 'Hold intensity at the level below, even when the room is quiet'),
      freeze: pad('freeze', 'Freeze', 'Z', 'Hold the picture still'),
      blackout: pad('blackout', 'Blackout', 'B', 'Fade to black (and back)'),
      flash: pad('flash', 'Big moment', 'G', 'One big flash + beat + intensity push'),
    };
    this.tapBtn = el('button', { className: 'tap', title: 'Tap along to the beat (T). Shift+T clears.', onclick: () => { h.onTap(); this.tapBtn.blur(); } },
      this.tapDot = el('i', { className: 'dot' }), this.bpm = el('span', { textContent: 'Tap tempo' }), el('kbd', { textContent: 'T' }));
    this.rows = {
      holdLevel: slider(s, 'holdLevel', 'Hold level', 0, 1, 0.05, (v) => Number(v).toFixed(2), h.onSetting),
      tempoLock: check(s, 'tempoLock', 'Lock beats to tempo (L)', h.onSetting, 'Styles get beats on the tapped grid instead of detected beats; detected beats keep it in phase.'),
      strobeSafe: check(s, 'strobeSafe', 'Strobe-safe (max 3 flashes / s)', h.onSetting, 'Limits beats and flashes reaching the styles to 3 per second, and caps the big-moment flash.'),
      flashAmount: slider(s, 'flashAmount', 'Flash strength', 0, 1, 0.05, (v) => Number(v).toFixed(2), h.onSetting),
      blackoutTime: slider(s, 'blackoutTime', 'Blackout fade', 0.2, 5, 0.1, (v) => `${Number(v).toFixed(1)} s`, h.onSetting),
    };
    this.section = el('section', { className: 'show' },
      el('h2', { textContent: 'Show control' }),
      el('div', { className: 'pads' }, ...Object.values(this.pads)),
      this.rows.holdLevel,
      el('div', { className: 'tempo' }, this.tapBtn,
        el('button', { textContent: '−1', title: 'Tempo −1 bpm', onclick: () => h.onTempo(-1) }),
        el('button', { textContent: '+1', title: 'Tempo +1 bpm', onclick: () => h.onTempo(1) }),
        el('button', { textContent: 'Clear', title: 'Forget the tempo (Shift+T)', onclick: () => h.onTempo('clear') })),
      this.rows.tempoLock, this.rows.strobeSafe, this.rows.flashAmount, this.rows.blackoutTime);
    this.update();
  }

  refresh() { for (const [k, r] of Object.entries(this.rows)) r.set(this.s[k]); this.update(); }

  /** Per-frame (cheap): pad states + tempo blink. */
  update() {
    const sh = this.show;
    this.pads.hold.classList.toggle('on', sh.hold);
    this.pads.freeze.classList.toggle('on', sh.freeze);
    this.pads.blackout.classList.toggle('on', sh.blackout);
    this.pads.blackout.classList.toggle('fading', !sh.blackout && sh.fade > 0);
    this.pads.flash.classList.toggle('on', sh.flashEnv > 0.15);
    const bpm = sh.tempo.bpm;
    const txt = bpm ? `${bpm.toFixed(1)} bpm` : sh.tempo.taps.length ? 'Tap again…' : 'Tap tempo';
    if (this.bpm.textContent !== txt) this.bpm.textContent = txt;
    this.tapDot.style.opacity = bpm ? (sh.tempo.phase < 0.15 ? 1 : 0.15) : 0;
    this.tapDot.classList.toggle('down', !!bpm && sh.tempo.count % 4 === 0);
  }
}

// ---------------------------------------------------------------- MIDI
export class MidiUI {
  /** h: onEnable(), onSetting() */
  constructor(midi, s, h) {
    this.midi = midi; this.s = s; this.h = h;
    this.status = el('div', { className: 'status' });
    this.last = el('div', { className: 'midi-last' });
    this.table = el('div', { className: 'midi-map' });
    this.cells = {};
    for (const [id, label] of MIDI_ACTIONS) {
      const bind = el('span', { className: 'midi-bind' });
      const learn = el('button', { textContent: 'Learn', title: 'Click, then press the pad / move the knob', onclick: () => { midi.learn(id); learn.blur(); } });
      const clear = el('button', { textContent: '×', title: 'Remove mapping', className: 'danger', onclick: () => midi.unbind(id) });
      this.cells[id] = { bind, learn };
      this.table.append(el('span', { className: 'midi-act', textContent: label }), bind, learn, clear);
    }
    this.enableBtn = el('button', { textContent: 'Enable MIDI', onclick: () => h.onEnable() });
    this.section = el('section', {},
      el('h2', { textContent: 'MIDI' }),
      el('div', { className: 'btns' }, this.enableBtn),
      this.status,
      check(s, 'midiProgram', 'Program change selects setlist song', h.onSetting, 'Program 0 = song 1, program 1 = song 2, …'),
      this.table,
      this.last);
    this.update();
  }

  update() {
    const m = this.midi;
    this.enableBtn.hidden = m.enabled;
    const names = m.inputs.map((i) => i.name).join(', ');
    this.status.textContent = m.error || (m.enabled ? (names ? `Connected: ${names}` : 'MIDI on, no devices connected. Plug one in.') : 'Off. Footswitches and pads work once MIDI is on.');
    this.status.classList.toggle('error', !!m.error);
    for (const [id, c] of Object.entries(this.cells)) {
      const learning = m.learning === id;
      c.bind.textContent = learning ? 'waiting…' : m.describe(id);
      c.bind.classList.toggle('unset', !m.map[id] && !learning);
      c.learn.classList.toggle('on', learning);
      c.learn.textContent = learning ? 'Cancel' : 'Learn';
    }
    this.last.textContent = m.last ? `Last: ${m.last}` : '';
  }
}

// ---------------------------------------------------------------- environment browser
export class EnvBrowser {
  /** items: [{ name, hidden }], h: onPick(i) */
  constructor(items, h) {
    this.tiles = [];
    this.el = el('div', { className: 'envs' });
    items.forEach((it, i) => {
      const cv = el('canvas', { width: 160, height: 120 });
      const tile = el('button', { className: 'env' + (it.hidden ? ' hidden-style' : ''), title: `${i}: ${it.name}${it.hidden ? ' (not in auto rotation)' : ''}`, onclick: () => { h.onPick(i); tile.blur(); } },
        cv, el('span', { textContent: it.name }));
      this.tiles.push({ tile, ctx: cv.getContext('2d') });
      this.el.append(tile);
    });
  }

  ctx(i) { return this.tiles[i].ctx; }

  /** cur / next: style indices; pool: setlist song's environments (or null). */
  mark(cur, next, pool) {
    this.tiles.forEach(({ tile }, i) => {
      tile.classList.toggle('cur', i === cur);
      tile.classList.toggle('next', i === next);
      tile.classList.toggle('pool', !!pool && pool.includes(i));
    });
  }
}
