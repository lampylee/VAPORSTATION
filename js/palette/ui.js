// Palette UI: picker section in the panel, the palette editor and the importer.
import { R, RAMP_NAMES, ROLE_NAMES, rampFrom, clonePalette, newId, parsePaletteText, paletteFromImage } from './palette.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => k != null && e.append(k));
  return e;
};

export function downloadPalette(p) {
  const data = JSON.stringify({ name: p.name, colors: p.colors, roles: p.roles }, null, 2);
  const a = el('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })), download: `${p.name.replace(/[^\w-]+/g, '_') || 'palette'}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export class PaletteUI {
  /**
   * h: onSelect(id), onPreview(palette|null), onSaved(palette), onDeleted(id), active() -> palette shown now
   */
  constructor(store, settings, h) {
    this.store = store; this.s = settings; this.h = h;
    this.modalOpen = false;

    // ---- panel section
    this.select = el('select');
    this.select.onchange = () => { h.onSelect(this.select.value); this.select.blur(); };
    this.strip = el('div', { className: 'swatches', title: 'Click to edit this palette' });
    this.strip.onclick = () => this.openEditor(h.active());
    const fade = el('input', { type: 'range', min: 0, max: 8, step: 0.1, value: settings.paletteFade });
    const fadeOut = el('output', { textContent: `${settings.paletteFade.toFixed(1)} s` });
    fade.oninput = () => { settings.paletteFade = Number(fade.value); fadeOut.textContent = `${settings.paletteFade.toFixed(1)} s`; h.onSetting(); };
    fade.onchange = () => fade.blur();
    this.fadeInput = fade; this.fadeOut = fadeOut;
    const imgIn = el('input', { type: 'file', accept: 'image/*' });
    imgIn.onchange = () => { if (imgIn.files[0]) this.fromImage(imgIn.files[0]); imgIn.value = ''; };

    this.section = el('section', {},
      el('h2', { textContent: 'Palette' }),
      el('label', { className: 'row' }, el('span', { textContent: 'Palette (P / O)' }), this.select),
      this.strip,
      el('label', { className: 'row' }, el('span', { textContent: 'Palette fade' }), fade, fadeOut),
      el('div', { className: 'btns' },
        el('button', { textContent: 'Edit', onclick: () => this.openEditor(h.active()) }),
        el('button', { textContent: 'New', onclick: () => this.openEditor(null) }),
        el('button', { textContent: 'Export', onclick: () => downloadPalette(h.active()) })),
      el('div', { className: 'btns' },
        el('label', { className: 'filebtn' }, 'From album art…', imgIn),
        el('button', { textContent: 'Import…', onclick: () => this.openImport() })),
    );

    this.modal = el('div', { className: 'modal', hidden: true });
    document.body.append(this.modal);
    this.refresh();
  }

  refresh() {
    const sel = this.select, all = this.store;
    sel.innerHTML = '';
    sel.append(el('option', { value: '', textContent: '— each style’s own —' }));
    const g1 = el('optgroup', { label: 'Built-in' }), g2 = el('optgroup', { label: 'Yours' });
    for (const p of all.all) (p.builtin ? g1 : g2).append(el('option', { value: p.id, textContent: p.name }));
    sel.append(g1);
    if (all.user.length) sel.append(g2);
    sel.value = this.s.paletteId || '';
    this.drawStrip(this.h.active());
    this.fadeInput.value = this.s.paletteFade;
    this.fadeOut.textContent = `${Number(this.s.paletteFade).toFixed(1)} s`;
  }

  drawStrip(p) {
    this.strip.innerHTML = '';
    if (!p) return;
    p.colors.forEach((c) => this.strip.append(el('i', { style: `background:${c}` })));
  }

  // ---------------- editor ----------------
  openEditor(pal) {
    const isUser = pal && this.store.isUser(pal.id);
    const w = pal ? clonePalette(pal) : clonePalette(this.h.active());
    if (!pal) { w.name = 'New palette'; w.id = newId(); }
    this._editor(w, isUser);
  }

  _editor(w, isUser) {
    const h = this.h, m = this.modal;
    this.modalOpen = true;
    m.innerHTML = '';
    const preview = () => h.onPreview(w);
    const name = el('input', { type: 'text', value: w.name, maxLength: 40 });
    name.oninput = () => { w.name = name.value; };

    const swatchInputs = [];
    const roleSelects = {};
    const syncRoles = () => {
      for (const k of ROLE_NAMES) {
        const s = roleSelects[k];
        [...s.options].forEach((o, i) => { o.style.background = w.colors[i]; o.style.color = lum(w.colors[i]) > 0.5 ? '#000' : '#fff'; });
        s.style.background = w.colors[w.roles[k]];
        s.style.color = lum(w.colors[w.roles[k]]) > 0.5 ? '#000' : '#fff';
      }
    };
    const grid = el('div', { className: 'ramps' });
    for (let ramp = 0; ramp < 4; ramp++) {
      const key = el('input', { type: 'color', value: w.colors[R(ramp, ramp === 3 ? 1 : 2)], title: 'Key colour: rebuilds this ramp' });
      key.oninput = () => {
        rampFrom(key.value, ramp === 3 ? 1 : 2).forEach((c, s) => { w.colors[R(ramp, s)] = c; swatchInputs[R(ramp, s)].value = c; });
        syncRoles(); preview();
      };
      const row = el('div', { className: 'ramp' }, el('span', { textContent: RAMP_NAMES[ramp] }), key, el('span', { className: 'arrow', textContent: '→' }));
      for (let s = 0; s < 4; s++) {
        const i = R(ramp, s);
        const inp = el('input', { type: 'color', value: w.colors[i], title: `${RAMP_NAMES[ramp]} shade ${s} (index ${i})` });
        inp.oninput = () => { w.colors[i] = inp.value; syncRoles(); preview(); };
        swatchInputs[i] = inp;
        row.append(inp);
      }
      grid.append(row);
    }
    const roles = el('div', { className: 'roles' });
    for (const k of ROLE_NAMES) {
      const s = el('select');
      for (let i = 0; i < 16; i++) s.append(el('option', { value: i, textContent: `${RAMP_NAMES[i >> 2]} ${i & 3}` }));
      s.value = w.roles[k];
      s.onchange = () => { w.roles[k] = Number(s.value); syncRoles(); preview(); };
      roleSelects[k] = s;
      roles.append(el('label', {}, el('span', { textContent: k }), s));
    }
    syncRoles();

    const close = (restore) => { this.modalOpen = false; m.hidden = true; m.innerHTML = ''; if (restore) h.onPreview(null); };
    const save = (asNew) => {
      const p = clonePalette(w);
      p.name = (p.name || 'Untitled').trim();
      if (asNew || !isUser) p.id = newId();
      const saved = this.store.save(p);
      close(false);
      h.onSaved(saved);
    };
    const btns = el('div', { className: 'btns' },
      el('button', { textContent: isUser ? 'Save' : 'Save as mine', onclick: () => save(false) }),
      isUser ? el('button', { textContent: 'Save as new', onclick: () => save(true) }) : null,
      el('button', { textContent: 'Export', onclick: () => downloadPalette(w) }),
      isUser ? el('button', { textContent: 'Delete', className: 'danger', onclick: () => { if (confirm(`Delete palette "${w.name}"?`)) { this.store.remove(w.id); close(false); h.onDeleted(w.id); } } }) : null,
      el('button', { textContent: 'Cancel', onclick: () => close(true) }));

    m.append(el('div', { className: 'dialog' },
      el('h2', { textContent: 'Palette editor' }),
      el('label', { className: 'row' }, el('span', { textContent: 'Name' }), name),
      el('p', { className: 'hint', textContent: 'Each row is a ramp, dark → light. Pick the key colour to rebuild a whole ramp, or set swatches one by one. Changes preview live.' }),
      grid,
      el('h3', { textContent: 'Roles' }),
      roles,
      btns));
    m.hidden = false;
    m.onkeydown = (e) => { if (e.key === 'Escape') close(true); e.stopPropagation(); };
    preview();
    name.focus();
  }

  // ---------------- import ----------------
  openImport() {
    const m = this.modal;
    this.modalOpen = true;
    m.innerHTML = '';
    const text = el('textarea', { rows: 6, placeholder: 'Paste hex codes (one per line, Lospec .hex), a GIMP .gpl, or palette JSON' });
    const file = el('input', { type: 'file', accept: '.hex,.gpl,.json,.txt,image/*' });
    const slug = el('input', { type: 'text', placeholder: 'e.g. endesga-32' });
    const msg = el('div', { className: 'status' });
    const close = () => { this.modalOpen = false; m.hidden = true; m.innerHTML = ''; };
    const fail = (e) => { msg.textContent = e.message || String(e); msg.classList.add('error'); };
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      try { close(); await this.importFile(f); } catch (e) { fail(e); }
    };
    const go = () => { try { const p = parsePaletteText(text.value, 'Imported'); close(); this._editor(p, false); } catch (e) { fail(e); } };
    const fetchLospec = async () => {
      const name = slug.value.trim().toLowerCase().replace(/\s+/g, '-');
      if (!name) return;
      msg.textContent = 'Fetching from lospec.com…'; msg.classList.remove('error');
      try {
        const res = await fetch(`https://lospec.com/palette-list/${encodeURIComponent(name)}.json`);
        if (!res.ok) throw new Error(`Lospec returned ${res.status} — check the palette name.`);
        const p = parsePaletteText(await res.text(), name);
        close(); this._editor(p, false);
      } catch (e) {
        fail(new Error(`${e.message} If it keeps failing, download the .hex file from Lospec and load it here instead.`));
      }
    };
    m.append(el('div', { className: 'dialog' },
      el('h2', { textContent: 'Import palette' }),
      text,
      el('div', { className: 'btns' }, el('button', { textContent: 'Import pasted text', onclick: go })),
      el('label', { className: 'row' }, el('span', { textContent: 'Or load a file' }), file),
      el('label', { className: 'row' }, el('span', { textContent: 'Lospec name' }), slug),
      el('div', { className: 'btns' }, el('button', { textContent: 'Fetch from Lospec (online)', onclick: fetchLospec })),
      el('p', { className: 'hint', textContent: 'Any number of colours works: they are grouped into 4 ramps × 4 shades automatically. You can fine-tune everything in the editor next.' }),
      msg,
      el('div', { className: 'btns' }, el('button', { textContent: 'Cancel', onclick: close }))));
    m.hidden = false;
    m.onkeydown = (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); };
    text.focus();
  }

  /** Import from a dropped/loaded file (image or palette text). */
  async importFile(f) {
    if (f.type.startsWith('image/')) return this.fromImage(f);
    const p = parsePaletteText(await f.text(), f.name.replace(/\.[^.]+$/, ''));
    this._editor(p, false);
  }

  async fromImage(f) {
    const p = await paletteFromImage(f, f.name.replace(/\.[^.]+$/, ''));
    this._editor(p, false);
  }
}

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
