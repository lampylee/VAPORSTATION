// Operator view: the laptop screen while the projector window shows the picture.
// Built for a glance from ~2 m by a band member mid-song: large type, few numbers, colour only
// for trouble. Answers "is it working?" (preview, input meter, health light) and "what's next?"
// (the cued / next song or environment). Big buttons for one quick tap between songs.
// See docs/superpowers/specs/2026-11-23-projector-output-design.md, section 3.
import { icon } from '../icons.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => k != null && e.append(k));
  return e;
};
const setText = (e, t) => { if (e.textContent !== t) e.textContent = t; };
const meterPct = (db) => Math.max(0, Math.min(100, ((db + 90) / 90) * 100));   // same scale as the panel meter

export class OperatorView {
  /** root: <section id="operator">. h: onAction(id) (hold/freeze/blackout/flash), onNextSong(), onOpenOutput(), onSingle() */
  constructor(root, h) {
    this.root = root; this.h = h;
    this._visible = false;
    this._openOnly = false;
    this.box = { w: 0, h: 0 };
    const tap = (b, fn) => { b.onclick = () => { fn(); b.blur(); }; return b; };
    const bigBtn = (id, label, ic) => tap(el('button', { className: `op-btn op-${id}` }, icon(ic, 30), el('span', { textContent: label })), () => h.onAction(id));

    // ---- "Open projector output" (dual mode saved, no window yet: a popup needs this click)
    this.openBtn = tap(el('button', { className: 'op-openbtn' }, el('span', { textContent: 'Open projector output' })), () => h.onOpenOutput());
    this.openPane = el('div', { className: 'op-open' }, this.openBtn,
      el('p', { className: 'op-hint', textContent: 'or press W · then click the projector window once to go fullscreen' }),
      tap(el('button', { className: 'op-single', textContent: 'No projector: use this screen' }), () => h.onSingle()));

    // ---- top: song line, section, intensity
    this.play = el('span', { className: 'op-play' });
    this.song = el('span', { className: 'op-song' });
    this.section = el('span', { className: 'op-section' });
    this.kFill = el('i');
    const top = el('header', { className: 'op-top' },
      el('div', { className: 'op-songline' }, this.play, this.song),
      el('div', { className: 'op-secline' }, this.section, el('div', { className: 'op-kbar', title: 'intensity' }, this.kFill)));

    // ---- middle: live preview | next | input + health
    this.preview = el('canvas', { className: 'op-preview', width: 320, height: 180 });
    this.pctx = this.preview.getContext('2d', { alpha: false });
    this.nextSong = el('div', { className: 'op-nsong' });
    this.thumb = el('canvas', { className: 'op-nthumb', width: 160, height: 120 });
    this.tctx = this.thumb.getContext('2d');
    this.nextSub = el('div', { className: 'op-nsub' });
    this.meterFill = el('i', { className: 'fill' });
    this.meterThresh = el('i', { className: 'thresh' });
    this.healthDot = el('i', { className: 'op-hdot' });
    this.healthText = el('span', { className: 'op-htext' });
    this.health = el('div', { className: 'op-health' }, this.healthDot, this.healthText);
    const prevBox = el('div', { className: 'op-prevbox' }, this.preview);
    const mid = el('div', { className: 'op-mid' },
      prevBox,
      el('div', { className: 'op-next' }, this.nextHead = el('div', { className: 'op-label', textContent: 'NEXT' }), this.nextSong, this.thumb, this.nextSub),
      el('div', { className: 'op-status' },
        el('div', { className: 'op-label', textContent: 'INPUT' }),
        el('div', { className: 'op-meter' }, this.meterFill, this.meterThresh),
        this.health));

    // ---- buttons (on / off state for the toggles; Big moment and Next are momentary)
    this.btns = {
      hold: bigBtn('hold', 'Hold', 'hold'),
      freeze: bigBtn('freeze', 'Freeze', 'freeze'),
      blackout: bigBtn('blackout', 'Blackout', 'blackout'),
      flash: bigBtn('flash', 'Big moment', 'flash'),
    };
    this.nextLabel = el('span', { textContent: 'Next song' });
    this.nextBtn = tap(el('button', { className: 'op-btn op-nextsong' }, icon('next', 30), this.nextLabel), () => h.onNextSong());
    this.main = el('div', { className: 'op-main' }, top, mid, el('div', { className: 'op-btns' }, ...Object.values(this.btns), this.nextBtn));

    root.classList.add('op');
    root.replaceChildren(this.openPane, this.main);
    this.openPane.hidden = true;

    // preview size follows its box (no layout reads per frame)
    try {
      new ResizeObserver(([e]) => { const r = e.contentRect; this.box = { w: r.width, h: r.height }; }).observe(prevBox);
    } catch (e) { /* very old browser: fixed 320x180 */ }
  }

  get visible() { return this._visible; }
  set visible(v) {
    v = !!v;
    if (v === this._visible) return;
    this._visible = v;
    this.root.hidden = !v;
    document.body.classList.toggle('operator', v);
  }

  /** True when the full view (with the preview) is showing, not just the open button. */
  get showsPreview() { return this._visible && !this._openOnly; }

  /**
   * Copy the frame just presented (nearest, the shown rect only). Same task as present(),
   * before takeFrame(). src: the renderer's OffscreenCanvas; shown: [x, y, w, h] in GL coordinates
   * (origin bottom-left); h: the source height (for the flip).
   */
  drawPreview(src, shown, h) {
    if (!this.showsPreview) return;
    const [x, y, w, hh] = shown || [0, 0, src.width, src.height];
    const dpr = devicePixelRatio || 1;
    if (!this.box.w) { const r = this.preview.parentNode.getBoundingClientRect(); this.box = { w: r.width, h: r.height }; }   // before the first observer callback
    const bw = this.box.w * dpr, bh = this.box.h * dpr;
    if (bw < 2 || bh < 2 || w < 1 || hh < 1) return;
    const sc = Math.min(bw / w, bh / hh, 1);
    const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(hh * sc));
    const cv = this.preview;
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    this.pctx.imageSmoothingEnabled = false;
    this.pctx.drawImage(src, x, h - y - hh, w, hh, 0, 0, cw, ch);
  }

  /**
   * ~10 Hz. info: { songLine, playing, section (null: Conductor off), intensity, next: { label, cued, envName,
   * paletteName, thumb }, nextAction ('song' | 'world'), meterDb, thresholdDb, inputOn, health: { level, text },
   * buttons: { hold, freeze, blackout }, outputState, dual }
   */
  update(info) {
    const openOnly = !!info.dual && info.outputState === 'none';
    if (openOnly !== this._openOnly) {
      this._openOnly = openOnly;
      this.openPane.hidden = !openOnly;
      this.main.hidden = openOnly;
    }
    if (openOnly) return;

    setText(this.play, info.playing ? '▶' : '■');
    this.play.classList.toggle('idle', !info.playing);
    setText(this.song, info.songLine || '');
    setText(this.section, info.section == null ? '' : (info.section || '').toUpperCase());
    this.section.hidden = info.section == null;
    this.kFill.style.width = `${Math.round(Math.max(0, Math.min(1, info.intensity)) * 100)}%`;

    const n = info.next || {};
    setText(this.nextSong, n.label || n.envName || '');
    this.nextSong.classList.toggle('cued', !!n.cued);
    setText(this.nextHead, n.cued ? 'CUED · goes when the song ends' : 'NEXT');
    setText(this.nextSub, n.label ? [n.envName, n.paletteName].filter(Boolean).join(' · ') : (n.paletteName || ''));
    if (n.thumb) { this.tctx.imageSmoothingEnabled = false; this.tctx.drawImage(n.thumb, 0, 0, this.thumb.width, this.thumb.height); }
    else { this.tctx.fillStyle = '#000'; this.tctx.fillRect(0, 0, this.thumb.width, this.thumb.height); }

    this.meterFill.style.width = `${meterPct(info.meterDb)}%`;
    this.meterFill.classList.toggle('on', !!info.inputOn);
    this.meterThresh.style.left = `${meterPct(info.thresholdDb)}%`;

    const hl = info.health || { level: 'ok', text: 'OK' };
    if (this.health.dataset.level !== hl.level) this.health.dataset.level = hl.level;
    setText(this.healthText, hl.text);

    const b = info.buttons || {};
    for (const id of ['hold', 'freeze', 'blackout']) this.btns[id].classList.toggle('on', !!b[id]);
    setText(this.nextLabel, info.nextAction === 'world' ? 'Next world' : n.cued ? 'Go now' : 'Next song');
  }
}
