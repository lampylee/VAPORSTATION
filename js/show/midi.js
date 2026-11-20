// Web MIDI: map pads / knobs / footswitches to show actions, with MIDI learn.
//
// A binding is { type: 'note' | 'cc', ch (0..15), num }.
// - Button actions fire on note-on (velocity > 0), or when a CC rises past 64
//   (sustain-style footswitches send CC 64 = 127 / 0; latching pedals work too).
// - Value actions (knobs/faders/expression pedals) take CC value / 127.
// - Program Change n jumps to setlist song n + 1 (optional; many MIDI
//   footswitch boards send program changes).
const KEY = 'ps1viz.midi.v1';

/** Every mappable action: [id, label, kind]. kind: 'button' | 'value'. */
export const MIDI_ACTIONS = [
  ['nextSong', 'Next song', 'button'],
  ['prevSong', 'Previous song', 'button'],
  ['nextStyle', 'Next environment', 'button'],
  ['prevStyle', 'Previous environment', 'button'],
  ['nextPalette', 'Next palette', 'button'],
  ['prevPalette', 'Previous palette', 'button'],
  ['flash', 'Big moment (flash)', 'button'],
  ['blackout', 'Blackout (toggle)', 'button'],
  ['freeze', 'Freeze (toggle)', 'button'],
  ['hold', 'Hold intensity (toggle)', 'button'],
  ['holdLevel', 'Hold level (knob)', 'value'],
  ['reactivity', 'Reactivity: gentle → punchy (knob)', 'value'],
  ['tap', 'Tap tempo', 'button'],
  ['tempoLock', 'BPM lock (toggle)', 'button'],
];

const describe = (b) => (b ? `${b.type === 'note' ? 'Note' : 'CC'} ${b.num} · ch ${b.ch + 1}` : '—');

export class Midi {
  /** h: onAction(id, value?), onProgram(n), onStatus() */
  constructor(h) {
    this.h = h;
    this.access = null;
    this.error = '';
    this.learning = null;     // action id waiting for a message
    this.last = '';           // last message (for the UI)
    this.ccState = {};        // "ch:num" -> last value (edge detection for buttons)
    this.map = {};
    try { this.map = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { this.map = {}; }
  }

  get supported() { return !!navigator.requestMIDIAccess; }
  get enabled() { return !!this.access; }
  get inputs() { return this.access ? [...this.access.inputs.values()].filter((i) => i.state === 'connected') : []; }
  describe(id) { return describe(this.map[id]); }

  async enable() {
    if (this.access) return true;
    if (!this.supported) { this.error = 'This browser has no Web MIDI (use Chrome).'; this.h.onStatus(); return false; }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.error = '';
      this.access.onstatechange = () => { this._listen(); this.h.onStatus(); };
      this._listen();
    } catch (e) {
      this.error = `MIDI not available: ${e.name === 'SecurityError' || e.name === 'NotAllowedError' ? 'permission denied' : e.message}`;
    }
    this.h.onStatus();
    return this.enabled;
  }

  _listen() { for (const inp of this.inputs) inp.onmidimessage = (e) => this.handle(e.data); }

  learn(id) { this.learning = this.learning === id ? null : id; this.h.onStatus(); }
  unbind(id) { delete this.map[id]; this._save(); this.h.onStatus(); }
  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.map)); } catch { /* ignore */ } }

  /** Handle raw MIDI bytes (also callable from tests). */
  handle(data) {
    const [st, d1 = 0, d2 = 0] = data;
    const type = st & 0xf0, ch = st & 0x0f;
    let msg = null;
    if (type === 0x90 && d2 > 0) msg = { type: 'note', ch, num: d1, value: d2 / 127, press: true };
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) msg = { type: 'note', ch, num: d1, value: 0, press: false };
    else if (type === 0xb0) {
      const key = `${ch}:${d1}`, prev = this.ccState[key] ?? 0;
      this.ccState[key] = d2;
      msg = { type: 'cc', ch, num: d1, value: d2 / 127, press: d2 >= 64 && prev < 64 };
    } else if (type === 0xc0) {
      this.last = `Program ${d1} · ch ${ch + 1}`;
      this.h.onProgram(d1);
      this.h.onStatus();
      return;
    } else return;   // clock, aftertouch, sysex... ignored

    this.last = `${describe(msg)} = ${Math.round(msg.value * 127)}`;
    if (this.learning) {
      // ignore releases while learning (a note-off would otherwise bind on the way up)
      if (msg.type === 'note' && !msg.press) return;
      for (const [id, b] of Object.entries(this.map)) if (b.type === msg.type && b.ch === msg.ch && b.num === msg.num) delete this.map[id];
      this.map[this.learning] = { type: msg.type, ch: msg.ch, num: msg.num };
      this.learning = null;
      this._save();
      this.h.onStatus();
      return;
    }
    for (const [id, , kind] of MIDI_ACTIONS) {
      const b = this.map[id];
      if (!b || b.type !== msg.type || b.ch !== msg.ch || b.num !== msg.num) continue;
      if (kind === 'value') this.h.onAction(id, msg.value);
      else if (msg.press) this.h.onAction(id);
    }
    this.h.onStatus();
  }
}
