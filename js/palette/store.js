// Palette library = built-ins + user palettes saved in localStorage.
import { BUILTIN_PALETTES } from './library.js';
import { clonePalette, isValidPalette } from './palette.js';

const KEY = 'ps1viz.palettes.v1';

export class PaletteStore {
  constructor() {
    this.user = [];
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.user = JSON.parse(raw).filter(isValidPalette).map(clonePalette);
    } catch (e) {
      console.warn('User palettes could not be loaded.', e);
    }
  }

  get all() { return [...BUILTIN_PALETTES, ...this.user]; }
  get(id) { return this.all.find((p) => p.id === id) || null; }
  isUser(id) { return this.user.some((p) => p.id === id); }

  /** Insert or replace a user palette. Returns the saved copy. */
  save(p) {
    const copy = clonePalette(p);
    const i = this.user.findIndex((u) => u.id === copy.id);
    if (i >= 0) this.user[i] = copy; else this.user.push(copy);
    this._persist();
    return copy;
  }

  remove(id) {
    this.user = this.user.filter((p) => p.id !== id);
    this._persist();
  }

  _persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.user)); } catch (e) { console.warn('User palettes could not be saved.', e); }
  }
}
