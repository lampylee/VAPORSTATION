import { damp } from '../gfx/math.js';

/** Which named state each Conductor section (audio.section) targets. '' = Conductor off. */
export const DEFAULT_MAP = { intro: 'still', outro: 'still', breakdown: 'still', groove: 'base', build: 'gather', drop: 'full', '': 'base' };

/**
 * Kit v5: section-crossfaded named states. A world describes how it looks in a few moods
 * (`still`, `base`, `gather`, `full`: objects of numbers) and Moods eases between them as
 * the song changes section. Missing states or keys fall back to `base`.
 *
 *   this.moods = new K.Moods({ still: { cam: 4 }, base: { cam: 3 }, full: { cam: 1.5 } }, { slow: ['cam'] });
 *   update: const m = this.moods.update(audio, dt);   // m.cam; this.moods.mood is the target's name
 *
 * Every key eases with tau = ease / 3 (about `ease` seconds to settle). Entering a drop is fast
 * (`dropEase`) except keys in `slow` (camera positions), which never ease faster than 6 s.
 * The first update snaps to the target, and so does the first one after snap(): the style
 * manager calls it when a world comes on screen, so a mid-song switch arrives in the current
 * section's mood instead of easing there on top of the crossfade.
 */
export class Moods {
  constructor(states, { map = {}, ease = 6, dropEase = 1.5, slow = [] } = {}) {
    this.states = states;
    this.map = { ...DEFAULT_MAP, ...map };
    this.ease = ease; this.dropEase = dropEase; this.slow = new Set(slow);
    this.v = {}; this.mood = 'base'; this._init = false;
    // key union per state (base + its own keys), so update() allocates nothing
    this._keys = {};
    const base = states.base || {};
    for (const name of new Set([...Object.keys(states), 'base'])) this._keys[name] = [...new Set([...Object.keys(base), ...Object.keys(states[name] || {})])];
  }
  /** The next update() jumps straight to the current section's mood (no ease). */
  snap() { this._init = false; }
  _state(name) { return this.states[name] || this.states.base || {}; }
  update(audio, dt) {
    const sec = audio?.section || '';
    this.mood = this.map[sec] || this.map[''] || 'base';
    const base = this.states.base || {}, st = this._state(this.mood);
    const keys = this._keys[this.states[this.mood] ? this.mood : 'base'];
    const fast = sec === 'drop';
    for (const k of keys) {
      const target = k in st ? st[k] : base[k];
      if (!this._init || !Number.isFinite(this.v[k])) { this.v[k] = target; continue; }
      let tau = (fast ? this.dropEase : this.ease) / 3;
      if (this.slow.has(k)) tau = Math.max(tau, 6 / 3);
      this.v[k] = damp(this.v[k], target, tau, dt);
    }
    this._init = true;
    return this.v;
  }
}
