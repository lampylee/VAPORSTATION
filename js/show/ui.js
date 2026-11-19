// Panel sections for show control (pads, hold, tempo), MIDI mapping and the
// environment browser (live thumbnails).
import { MIDI_ACTIONS } from './midi.js';
import { icon, card, fold } from '../icons.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => k != null && e.append(k));
  return e;
};

const heading = (title) => { const h = el('h2', { textContent: title }); h.dataset.title = title; return h; };

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
const HOLD_STEPS = [0.2, 0.4, 0.6, 0.8, 1];

export class ShowUI {
  /** h: onPad(id) (hold/freeze/blackout/flash/tempoLock), onTap(), onTempo(cmd: 'clear' | +1 | -1), onSetting() */
  constructor(show, s, h) {
    this.show = show; this.s = s; this.h = h;
    const pad = (id, label, ic, title) => {
      const b = el('button', { className: `pad pad-${id}`, title, onclick: () => { h.onPad(id); b.blur(); } }, icon(ic, 18), el('span', { textContent: label }));
      return b;
    };
    this.pads = {
      hold: pad('hold', 'Hold', 'hold', 'Hold intensity at the level below, even when the room is quiet (I)'),
      freeze: pad('freeze', 'Freeze', 'freeze', 'Hold the picture still (Z)'),
      blackout: pad('blackout', 'Black', 'blackout', 'Fade to black and back (B)'),
      flash: pad('flash', 'Big', 'flash', 'Big moment: one flash, a beat and a push to full intensity (G)'),
    };

    // hold level as five steps instead of a slider (MIDI knobs can still set anything in between)
    this.segs = HOLD_STEPS.map((v) => el('button', { textContent: v === 1 ? '1' : String(v).slice(1), title: `Hold at ${v}`,
      onclick: (e) => { s.holdLevel = v; h.onSetting(); this.update(); e.currentTarget.blur(); } }));

    this.tapBtn = el('button', { className: 'tap', title: 'Tap along to the beat (T). Shift+T clears.', onclick: () => { h.onTap(); this.tapBtn.blur(); } },
      this.tapDot = el('i', { className: 'dot' }), this.bpm = el('span', { textContent: 'Tap tempo' }), el('span', { className: 'hint-key', textContent: 'tap T' }));
    this.lockBtn = el('button', { className: 'lock', title: 'Lock the environments’ beats to the tapped tempo (L)', onclick: () => { h.onPad('tempoLock'); this.lockBtn.blur(); } });

    this.rows = {
      strobeSafe: check(s, 'strobeSafe', 'Strobe-safe (max 3 flashes / s)', h.onSetting, 'Limits beats and flashes reaching the environments to 3 per second, and caps the big-moment flash.'),
      flashAmount: slider(s, 'flashAmount', 'Flash strength', 0, 1, 0.05, (v) => Number(v).toFixed(2), h.onSetting),
      blackoutTime: slider(s, 'blackoutTime', 'Blackout fade', 0.2, 5, 0.1, (v) => `${Number(v).toFixed(1)} s`, h.onSetting),
    };
    this.section = card('Show', 'show',
      el('div', { className: 'pads' }, ...Object.values(this.pads)),
      el('div', { className: 'seg-row' }, el('span', { textContent: 'Hold at' }), el('div', { className: 'seg' }, ...this.segs)),
      el('div', { className: 'tempo' }, this.tapBtn, this.lockBtn),
      fold('Fine-tune: flash, fade, tempo',
        this.rows.strobeSafe, this.rows.flashAmount, this.rows.blackoutTime,
        el('div', { className: 'btns' },
          el('button', { textContent: '−1 bpm', onclick: () => h.onTempo(-1) }),
          el('button', { textContent: '+1 bpm', onclick: () => h.onTempo(1) }),
          el('button', { textContent: 'Clear tempo', title: 'Shift+T', onclick: () => h.onTempo('clear') }))));
    this.update();
  }

  refresh() { for (const [k, r] of Object.entries(this.rows)) r.set(this.s[k]); this.update(); }

  /** Per-frame (cheap): pad states, hold step, tempo blink. */
  update() {
    const sh = this.show, s = this.s;
    this.pads.hold.classList.toggle('on', sh.hold);
    this.pads.freeze.classList.toggle('on', sh.freeze);
    this.pads.blackout.classList.toggle('on', sh.blackout);
    this.pads.blackout.classList.toggle('fading', !sh.blackout && sh.fade > 0);
    this.pads.flash.classList.toggle('on', sh.flashEnv > 0.15);
    let near = 0;
    HOLD_STEPS.forEach((v, i) => { if (Math.abs(v - s.holdLevel) < Math.abs(HOLD_STEPS[near] - s.holdLevel)) near = i; });
    this.segs.forEach((b, i) => b.classList.toggle('on', i === near));
    const bpm = sh.tempo.bpm;
    const txt = bpm ? `${bpm.toFixed(1)} bpm` : sh.tempo.taps.length ? 'Tap again…' : 'Tap tempo';
    if (this.bpm.textContent !== txt) this.bpm.textContent = txt;
    this.tapDot.style.opacity = bpm ? (sh.tempo.phase < 0.15 ? 1 : 0.2) : 0.2;
    this.tapDot.classList.toggle('down', !!bpm && sh.tempo.count % 4 === 0);
    const lock = s.tempoLock ? 'Locked' : 'Lock';
    if (this.lockBtn.textContent !== lock) this.lockBtn.textContent = lock;
    this.lockBtn.classList.toggle('on', s.tempoLock);
    const st = sh.label === 'live' ? '' : sh.label;
    if (this.section.status.textContent !== st) this.section.status.textContent = st;
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
      heading('MIDI'),
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
