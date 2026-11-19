// Setlists: an ordered list of songs, each picking a palette and the
// environment(s) to show. Stepped with a key or a USB footswitch between songs.
//
// A song:  { label, palette, styles }
//   palette: null = keep whatever is showing, '' = each style's own, else a palette id
//   styles:  style keys (class names, stable across registry reorders); [] = keep
//            the current environment and rotate through all of them.
//            With several, the first opens the song; N and idle auto-switch
//            rotate only through these.
import { newId } from '../palette/palette.js';

const KEY = 'ps1viz.setlists.v1';

/** Stable key for a style class (its class name; meta.key overrides). */
export const styleKey = (C) => C.meta?.key || C.name;

export function normSong(x) {
  return {
    label: String(x?.label ?? '').slice(0, 80),
    palette: x?.palette === null || x?.palette === undefined ? null : String(x.palette),
    styles: Array.isArray(x?.styles) ? x.styles.filter((k) => typeof k === 'string').slice(0, 16) : [],
  };
}

export function normSetlist(x) {
  if (!x || typeof x !== 'object' || !Array.isArray(x.songs)) throw new Error('Not a setlist (needs a "songs" list).');
  return {
    id: typeof x.id === 'string' && x.id ? x.id : newId(),
    name: String(x.name || 'Setlist').slice(0, 60),
    songs: x.songs.map(normSong),
  };
}

export const cloneSetlist = (x) => normSetlist(JSON.parse(JSON.stringify(x)));

/** Does this JSON text look like a setlist file? */
export function looksLikeSetlist(text) {
  try { const j = JSON.parse(text); return !!j && Array.isArray(j.songs); } catch { return false; }
}

export function downloadSetlist(sl) {
  const data = JSON.stringify({ format: 'vaporstation-setlist', name: sl.name, songs: sl.songs }, null, 2);
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([data], { type: 'application/json' })),
    download: `${sl.name.replace(/[^\w-]+/g, '_') || 'setlist'}.setlist.json`,
  });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export class SetlistStore {
  constructor() {
    this.lists = [];
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.lists = JSON.parse(raw).map((x) => { try { return normSetlist(x); } catch { return null; } }).filter(Boolean);
    } catch (e) {
      console.warn('Setlists could not be loaded.', e);
    }
  }

  get all() { return this.lists; }
  get(id) { return this.lists.find((l) => l.id === id) || null; }

  save(sl) {
    const copy = cloneSetlist(sl);
    const i = this.lists.findIndex((l) => l.id === copy.id);
    if (i >= 0) this.lists[i] = copy; else this.lists.push(copy);
    this._persist();
    return copy;
  }

  remove(id) { this.lists = this.lists.filter((l) => l.id !== id); this._persist(); }

  _persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.lists)); } catch (e) { console.warn('Setlists could not be saved.', e); }
  }
}

/**
 * Steps through the active setlist. While the band is playing, "next" only
 * cues the song; it goes live as soon as the room falls silent, so the
 * crossfade happens between songs. A second press while cued goes now (segues).
 *
 * h: apply(song, index) — does the palette + environment change.
 */
export class SetlistPlayer {
  constructor(settings, store, h) {
    this.s = settings; this.store = store; this.h = h;
    this.cued = -1;
  }

  get list() { return this.s.setlistOn ? this.store.get(this.s.setlistId) : null; }
  get active() { return !!this.list?.songs.length; }
  get pos() { const l = this.list; return l ? Math.min(Math.max(0, this.s.setlistPos), Math.max(0, l.songs.length - 1)) : 0; }
  get song() { return this.list?.songs[this.pos] || null; }

  /** Go to song i right away (crossfades). */
  goTo(i) {
    const l = this.list;
    if (!l || !l.songs.length) return;
    this.s.setlistPos = Math.min(Math.max(0, i), l.songs.length - 1);
    this.cued = -1;
    this.h.apply(l.songs[this.s.setlistPos], this.s.setlistPos);
  }

  /** Footswitch / key: next (+1) or previous (-1) song. */
  step(dir, playing) {
    const l = this.list;
    if (!l || !l.songs.length) return;
    if (this.cued >= 0) {                 // already cued: next = go now, previous = cancel the cue
      if (dir > 0) this.goTo(this.cued); else this.cued = -1;
      return;
    }
    const to = Math.min(Math.max(0, this.pos + dir), l.songs.length - 1);
    if (to === this.pos) return;
    // band still playing: cue it; it goes live when the room falls silent
    if (playing && this.s.setlistCue && dir > 0) { this.cued = to; return; }
    this.goTo(to);
  }

  cancelCue() { this.cued = -1; }

  /** Call every frame. */
  update(playing) {
    if (this.cued >= 0 && (!playing || !this.active)) {
      if (this.active) this.goTo(this.cued); else this.cued = -1;
    }
  }

  get label() {
    const l = this.list;
    if (!l) return 'off';
    if (!l.songs.length) return `${l.name}: empty`;
    const cue = this.cued >= 0 ? `  · cued ${this.cued + 1}: ${l.songs[this.cued].label || 'untitled'}` : '';
    return `${this.pos + 1}/${l.songs.length} ${this.song.label || 'untitled'}${cue}`;
  }
}
