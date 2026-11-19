// Setlist UI: panel section (pick a setlist, see/step songs) and the editor modal.
import { cloneSetlist, normSetlist, downloadSetlist } from './setlist.js';
import { newId } from '../palette/palette.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => k != null && e.append(k));
  return e;
};

export class SetlistUI {
  /**
   * h: styles [{key, name}], palettes() -> [{id, name}], player (SetlistPlayer),
   *    onToggle(on), onSelectList(id), onJump(i), onStep(dir), onSaved(list), onDeleted(id),
   *    current() -> { paletteId, styleKey }, onSetting()
   */
  constructor(store, settings, h) {
    this.store = store; this.s = settings; this.h = h;
    this.modalOpen = false;

    this.on = el('input', { type: 'checkbox' });
    this.on.onchange = () => { h.onToggle(this.on.checked); this.on.blur(); };
    this.select = el('select');
    this.select.onchange = () => { h.onSelectList(this.select.value); this.select.blur(); };
    this.cue = el('input', { type: 'checkbox', checked: settings.setlistCue });
    this.cue.onchange = () => { settings.setlistCue = this.cue.checked; h.onSetting(); this.cue.blur(); };
    this.now = el('div', { className: 'sl-now' });
    this.songs = el('ol', { className: 'sl-songs' });
    const fileIn = el('input', { type: 'file', accept: '.json,application/json' });
    fileIn.onchange = async () => {
      const f = fileIn.files[0]; fileIn.value = '';
      if (f) try { await this.importFile(f); } catch (e) { this.setMsg(`Could not import ${f.name}: ${e.message}`, true); }
    };
    this.msg = el('div', { className: 'status' });

    this.section = el('section', {},
      el('h2', { textContent: 'Setlist' }),
      el('label', { className: 'row check' }, this.on, el('span', { textContent: 'Setlist mode (S)' })),
      el('label', { className: 'row' }, el('span', { textContent: 'Setlist' }), this.select),
      this.now,
      el('div', { className: 'btns' },
        el('button', { textContent: '◀ Prev', title: 'Previous song (PageUp / ← / [)', onclick: () => h.onStep(-1) }),
        el('button', { textContent: 'Next ▶', title: 'Next song (PageDown / → / ])', onclick: () => h.onStep(1) })),
      this.songs,
      el('label', { className: 'row check', title: 'While the band plays, Next only cues the song; it crossfades in when the room goes quiet. Press Next again to go now.' },
        this.cue, el('span', { textContent: 'Wait for silence (cue while playing)' })),
      el('div', { className: 'btns' },
        el('button', { textContent: 'Edit', onclick: () => { const l = this.store.get(this.s.setlistId); if (l) this.openEditor(l); else this.newList(); } }),
        el('button', { textContent: 'New', onclick: () => this.newList() }),
        el('button', { textContent: 'Export', onclick: () => { const l = this.store.get(this.s.setlistId); if (l) downloadSetlist(l); } }),
        el('label', { className: 'filebtn' }, 'Import…', fileIn)),
      this.msg,
    );

    this.modal = el('div', { className: 'modal', hidden: true });
    document.body.append(this.modal);
    this.refresh();
  }

  setMsg(text, error = false) { this.msg.textContent = text; this.msg.classList.toggle('error', error); }

  /** Rebuild the list picker and song list from the store + settings. */
  refresh() {
    const sel = this.select;
    sel.innerHTML = '';
    if (!this.store.all.length) sel.append(el('option', { value: '', textContent: '— none yet: click New —' }));
    for (const l of this.store.all) sel.append(el('option', { value: l.id, textContent: `${l.name} (${l.songs.length})` }));
    sel.value = this.store.get(this.s.setlistId) ? this.s.setlistId : (this.store.all[0]?.id || '');
    this.on.checked = !!this.s.setlistOn;
    this.cue.checked = !!this.s.setlistCue;
    const l = this.store.get(sel.value);
    this.songs.innerHTML = '';
    if (l) l.songs.forEach((song, i) => {
      const li = el('li', { title: 'Click to go to this song now' },
        el('span', { className: 'sl-label', textContent: song.label || 'untitled' }),
        el('span', { className: 'sl-meta', textContent: this._songMeta(song) }));
      li.onclick = () => this.h.onJump(i);
      this.songs.append(li);
    });
    this.tick();
  }

  /** Cheap per-change update of the highlight + "now" line. */
  tick() {
    const p = this.h.player;
    const on = !!this.s.setlistOn && !!this.store.get(this.s.setlistId);
    [...this.songs.children].forEach((li, i) => {
      li.classList.toggle('cur', on && i === p.pos);
      li.classList.toggle('cued', on && i === p.cued);
    });
    this.now.textContent = on ? p.label : 'Setlist mode is off.';
    this.now.classList.toggle('off', !on);
  }

  _songMeta(song) {
    const pal = song.palette === null ? 'keep palette' : song.palette === '' ? 'style palettes' : (this.h.palettes().find((p) => p.id === song.palette)?.name || 'missing palette');
    const names = song.styles.map((k) => this.h.styles.find((x) => x.key === k)?.name || `? ${k}`);
    return `${pal} · ${names.length ? names.join(', ') : 'keep environment'}`;
  }

  newList() {
    const cur = this.h.current();
    this.openEditor({ id: newId(), name: 'New setlist', songs: [{ label: 'Song 1', palette: cur.paletteId, styles: [cur.styleKey] }] }, true);
  }

  async importFile(f) {
    const sl = normSetlist(JSON.parse(await f.text()));
    if (this.store.get(sl.id)) sl.id = newId();
    const saved = this.store.save(sl);
    this.h.onSaved(saved);
    this.setMsg(`Imported "${saved.name}" (${saved.songs.length} songs).`);
  }

  // ---------------- editor ----------------
  openEditor(list, isNew = false) {
    const w = cloneSetlist(list);
    const h = this.h, m = this.modal;
    this.modalOpen = true;
    m.innerHTML = '';
    const name = el('input', { type: 'text', value: w.name, maxLength: 60 });
    name.oninput = () => { w.name = name.value; };
    const rows = el('div', { className: 'sl-rows' });

    const palOptions = (sel, v) => {
      sel.append(el('option', { value: '__keep', textContent: '(keep current)' }), el('option', { value: '', textContent: '(each style’s own)' }));
      for (const p of h.palettes()) sel.append(el('option', { value: p.id, textContent: p.name }));
      if (v && !h.palettes().some((p) => p.id === v)) sel.append(el('option', { value: v, textContent: `missing: ${v}` }));
      sel.value = v === null ? '__keep' : v;
    };

    const draw = () => {
      rows.innerHTML = '';
      w.songs.forEach((song, i) => {
        const label = el('input', { type: 'text', value: song.label, placeholder: 'song or album', maxLength: 80 });
        label.oninput = () => { song.label = label.value; };
        const pal = el('select', { title: 'Palette for this song' });
        palOptions(pal, song.palette);
        pal.onchange = () => { song.palette = pal.value === '__keep' ? null : pal.value; };
        const chips = el('div', { className: 'sl-chips' });
        song.styles.forEach((k, j) => {
          const nm = h.styles.find((x) => x.key === k)?.name || `missing: ${k}`;
          chips.append(el('button', { className: 'chip', textContent: `${j + 1}. ${nm} ×`, title: 'Remove', onclick: () => { song.styles.splice(j, 1); draw(); } }));
        });
        const add = el('select', { title: 'Add an environment (the first one opens the song; several rotate)' },
          el('option', { value: '', textContent: song.styles.length ? '+ environment' : '+ environment (none = keep)' }),
          ...h.styles.map((x) => el('option', { value: x.key, textContent: x.name })));
        add.onchange = () => { if (add.value) { song.styles.push(add.value); draw(); } };
        chips.append(add);
        const move = (d) => { const j = i + d; if (j < 0 || j >= w.songs.length) return; [w.songs[i], w.songs[j]] = [w.songs[j], w.songs[i]]; draw(); };
        rows.append(el('div', { className: 'sl-row' },
          el('span', { className: 'sl-num', textContent: i + 1 }),
          label, pal,
          el('div', { className: 'sl-ops' },
            el('button', { textContent: '↑', title: 'Move up', onclick: () => move(-1) }),
            el('button', { textContent: '↓', title: 'Move down', onclick: () => move(1) }),
            el('button', { textContent: '⧉', title: 'Duplicate', onclick: () => { w.songs.splice(i + 1, 0, JSON.parse(JSON.stringify(song))); draw(); } }),
            el('button', { textContent: '✕', className: 'danger', title: 'Remove song', onclick: () => { w.songs.splice(i, 1); draw(); } })),
          chips));
      });
      if (!w.songs.length) rows.append(el('p', { className: 'hint', textContent: 'No songs yet.' }));
    };
    draw();

    const close = () => { this.modalOpen = false; m.hidden = true; m.innerHTML = ''; };
    const addSong = (fromCurrent) => {
      const cur = h.current();
      w.songs.push(fromCurrent ? { label: '', palette: cur.paletteId, styles: [cur.styleKey] } : { label: '', palette: null, styles: [] });
      draw();
      rows.querySelectorAll('.sl-row input[type=text]')[w.songs.length - 1]?.focus();
    };
    const isStored = !isNew && !!this.store.get(w.id);
    m.append(el('div', { className: 'dialog wide' },
      el('h2', { textContent: 'Setlist editor' }),
      el('label', { className: 'row' }, el('span', { textContent: 'Name' }), name),
      el('p', { className: 'hint', textContent: 'One row per song (or album). Pick its palette and one or more environments: the first opens the song, N and idle auto-switch rotate through the rest. "Keep" leaves that part as it is.' }),
      rows,
      el('div', { className: 'btns' },
        el('button', { textContent: '+ Song', onclick: () => addSong(false) }),
        el('button', { textContent: '+ Song from current look', onclick: () => addSong(true) })),
      el('div', { className: 'btns' },
        el('button', { textContent: 'Save', onclick: () => { w.name = (w.name || 'Setlist').trim(); const saved = this.store.save(w); close(); h.onSaved(saved); } }),
        el('button', { textContent: 'Export', onclick: () => downloadSetlist(w) }),
        isStored ? el('button', { textContent: 'Delete', className: 'danger', onclick: () => { if (confirm(`Delete setlist "${w.name}"?`)) { this.store.remove(w.id); close(); h.onDeleted(w.id); } } }) : null,
        el('button', { textContent: 'Cancel', onclick: close }))));
    m.hidden = false;
    m.onkeydown = (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); };
    name.focus();
  }
}
