// Output: where the renderer's frames are shown. The renderer draws into its own
// OffscreenCanvas; each frame leaves as an ImageBitmap and a Sink puts it on screen.
// Output manages the optional projector window (output.html) and switches the sink between
// the laptop #view and that window, falling back to the laptop the moment it is lost.
// See docs/superpowers/specs/2026-11-23-projector-output-design.md (sections 1 and 2).
import { pickScreen } from './output-logic.js';

/** A `bitmaprenderer` canvas that shows frames from renderer.takeFrame(). */
export class Sink {
  /** canvas: HTMLCanvasElement in any window (the laptop #view, later the projector window). */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('bitmaprenderer');
    if (!this.ctx) throw new Error('bitmaprenderer canvas is not available in this browser.');
  }

  /** Show a frame. Takes ownership of the bitmap (it is detached afterwards). null = keep the last one. */
  show(bitmap) { if (bitmap) this.ctx.transferFromImageBitmap(bitmap); }

  /** CSS size of the canvas and its window's devicePixelRatio (feeds renderer.setOutputSize). */
  get size() {
    const c = this.canvas;
    return { w: c.clientWidth, h: c.clientHeight, dpr: c.ownerDocument.defaultView?.devicePixelRatio || 1 };
  }
}

/**
 * Calls cb() whenever win's devicePixelRatio changes (window moved to a screen with another
 * scale, browser zoom): a resize event doesn't always come with it. Re-arms itself.
 */
export function watchDpr(win, cb, signal) {
  let mq = null;
  const on = () => { if (signal?.aborted) return; arm(); cb(); };
  const arm = () => {
    mq?.removeEventListener('change', on);
    mq = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    mq.addEventListener('change', on, signal ? { signal } : undefined);
  };
  arm();
}

const NAME = 'vaporstation-output';
const place = (s) => `left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`;
const sameScreen = (a, b) => a === b || (a.label === b.label && a.left === b.left && a.top === b.top &&
  a.width === b.width && a.height === b.height);

export class Output {
  /**
   * h: laptopSink, onSinkChange(sink) (also on the current sink's resize / dpr change),
   *    onState(state), onFrame(now, 'projector', first) (the projector window's rAF, on this window's clock),
   *    onStatus(text, isError)
   */
  constructor(h) {
    this.h = h;
    this.laptopSink = h.laptopSink;
    this._sink = h.laptopSink;
    this._win = null;
    this._pending = null;      // opened, not yet attached
    this._state = 'none';
    this._screen = null;       // ScreenDetailed we placed the window on (null: no placement)
    this._details = null;
    this._coverFog = null;     // watchdog cover on (its fog colour) or null
    this._chain = 0;           // bumps to stop the projector rAF chain
    this._ac = null;           // listeners on the projector window
    this.lostWhy = '';
    // this page going away (reload): stop touching the projector window from the old page;
    // the window keeps its last frame, covers itself with fog and reattaches to the new page
    // (cover it now: while the new page loads it shares this thread with the projector page, so
    // that page's own stall timer can't run until the new page is up)
    addEventListener('pagehide', () => {
      try { if (this._state === 'open') this._win?.__vaporOutput?.stall(); } catch (e) { /* window gone */ }
      this._detach();
    });
  }

  get state() { return this._state; }
  get sink() { return this._sink; }
  get win() { return this._win; }

  /** Open (or reopen) the projector window. Call from a click / key / MIDI handler. */
  async open() {
    if (this._state === 'open' && this._win && !this._win.closed) return;
    const canPlace = typeof window.getScreenDetails === 'function';
    // Only wait for the screen list when it can't show a permission prompt: a prompt can outlast
    // the click's activation and the popup would be blocked. Otherwise open now, move it after.
    let granted = false;
    try { granted = canPlace && (await navigator.permissions.query({ name: 'window-management' })).state === 'granted'; } catch (e) { /* unknown name */ }
    let scr = null;
    if (granted) scr = await this._pickScreen();
    this._screen = scr;
    const w = window.open('output.html', NAME, `popup,${scr ? place(scr) : 'width=960,height=540'}`);
    if (!w) { this.h.onStatus?.('Projector window blocked: allow pop-ups for this page, then press W again.', true); return; }
    this._pending = w;
    // the page calls __vaporOutputAttach(window) once it has loaded -> attach(). Fullscreen needs a
    // click / key in that window (its page shows a hint): requestFullscreen() on it from this
    // window's click is refused by Chrome (spike, see the spec's 'Left to the builder').
    if (canPlace && !granted) {
      // first time: asks for the permission; if given, move the window onto the other screen
      const later = await this._pickScreen();
      if (later && !w.closed) {
        this._screen = later;
        try { w.moveTo(later.availLeft, later.availTop); w.resizeTo(later.availWidth, later.availHeight); } catch (e) { /* stays here */ }
      }
    }
  }

  async _pickScreen() {
    try {
      const d = await window.getScreenDetails();
      this._watchScreens(d);
      return pickScreen(d.screens, { left: window.screenX, top: window.screenY });
    } catch (e) { return null; }   // refused / not supported: this screen, the operator drags it over
  }

  /** Adopt a loaded projector window (from open(), or the window reattaching after this page reloaded). */
  attach(win) {
    if (!win || win.closed || !win.__vaporOutput?.canvas) return false;
    if (win === this._win && this._state === 'open') return true;
    let sink;
    try { sink = new Sink(win.__vaporOutput.canvas); } catch (e) { console.warn('[output]', e); return false; }
    this._detach();
    this._win = win;
    this._sink = sink;
    this._state = 'open';
    this.lostWhy = '';
    const ac = this._ac = new AbortController();
    const refit = () => { if (this._win === win) this.h.onSinkChange(this._sink); };
    win.addEventListener('resize', refit, { signal: ac.signal });
    watchDpr(win, refit, ac.signal);
    if (this._coverFog) win.__vaporOutput.cover(true, this._coverFog);
    this._pending = null;
    // second rAF chain: the projector window's display drives frames while it's alive
    const chain = ++this._chain;
    const offset = win.performance.timeOrigin - performance.timeOrigin;
    let first = true;
    const loop = (t) => {
      if (chain !== this._chain || win.closed) return;
      win.requestAnimationFrame(loop);
      this.h.onFrame(t + offset, 'projector', first);
      first = false;
    };
    win.requestAnimationFrame(loop);
    this.h.onSinkChange(sink);
    this.h.onState('open');
    return true;
  }

  /** Call after each frame shown on the projector: lets its page know frames arrive, and the fog to cover with. */
  shown(fog) {
    const o = this._win?.__vaporOutput;
    if (!o) return;
    o.lastFrameAt = this._win.performance.now();
    if (fog) { o.fog[0] = fog[0]; o.fog[1] = fog[1]; o.fog[2] = fog[2]; }
  }

  /** The watchdog's fog cover (context lost): show it on the projector too. */
  cover(on, fog) {
    this._coverFog = on ? [fog[0], fog[1], fog[2]] : null;
    if (this._state !== 'open') return;
    try { this._win.__vaporOutput.cover(on, this._coverFog); } catch (e) { /* window going */ }
  }

  /** Per frame (cheap): a closed window, or one whose page was replaced without telling us, is lost. */
  checkAlive() {
    if (this._state !== 'open') return;
    const w = this._win;
    let dead = !w || w.closed;
    if (!dead) {
      try { dead = !this._sink.canvas.ownerDocument.defaultView || w.__vaporOutput?.canvas !== this._sink.canvas; } catch (e) { dead = true; }
    }
    if (dead) this._lose(w && !w.closed ? 'page replaced' : 'window closed');
  }

  /** The projector page reports pagehide. */
  gone(win) { if (win === this._win && this._state === 'open') this._lose('window closed'); }

  /** Operator turned it off: back to single mode, close the window. */
  close() {
    const w = this._win || this._pending;
    this._detach();
    this._pending = null;
    this._toLaptop();
    this._state = 'none';
    this.h.onState('none');
    try { w?.close(); } catch (e) { /* ignore */ }
  }

  _lose(why, closeIt = false) {
    const w = this._win;
    this._detach();
    this._toLaptop();
    this._state = 'lost';
    this.lostWhy = why;
    console.warn(`[output] projector lost (${why})`);
    this.h.onState('lost');
    if (closeIt) try { w?.close(); } catch (e) { /* ignore */ }
  }

  _toLaptop() {
    this._win = null;
    if (this._sink !== this.laptopSink) { this._sink = this.laptopSink; this.h.onSinkChange(this.laptopSink); }
  }

  _detach() {
    this._chain++;
    this._ac?.abort();
    this._ac = null;
  }

  _watchScreens(d) {
    if (this._details === d) return;
    this._details = d;
    d.addEventListener('screenschange', () => {
      if (this._state !== 'open' || !this._screen) return;
      if (!d.screens.some((s) => sameScreen(s, this._screen))) this._lose('screen removed', true);
    });
  }
}
