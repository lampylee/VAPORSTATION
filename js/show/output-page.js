// The projector window (output.html). Deliberately tiny and self-contained (no imports):
// everything else (audio, styles, the renderer) stays in the opener, which pushes finished
// frames straight into this window's canvas (js/show/output.js). This page only:
//  - tells the opener it exists (and re-tells it after the opener reloads: polls attach),
//  - forwards keys to the opener (footswitch / hotkeys work whichever window has focus),
//  - covers a stall with dithered fog (never black, never a frozen picture),
//  - goes fullscreen on a click / key and keeps the screen awake while fullscreen.
// See docs/superpowers/specs/2026-11-23-projector-output-design.md (section 2).

const canvas = document.getElementById('out');
const coverEl = document.getElementById('cover');
const hint = document.getElementById('hint');

const STALL_MS = 500;      // no frame for this long -> own fog cover
const RECONNECT_MS = 1000; // no frame for this long -> ask the opener to (re)attach us

let attached = false;
let openerCover = null;    // fog colour while the opener's watchdog shows its cover, else null
let shownFog = null;

const out = window.__vaporOutput = {
  canvas,
  /** Set by the opener (this window's performance.now()) each time it shows a frame. */
  lastFrameAt: 0,
  /** Last fog colour (0..1 rgb) the opener sent; used for the stall cover. */
  fog: [0.106, 0.102, 0.141],
  /** The opener is reloading: cover now (it may block this thread while it loads). Frames resuming drop it. */
  stall() { out.lastFrameAt = -Infinity; update(); },
  /** The opener's watchdog cover (context lost): on/off with its fog colour. */
  cover(on, fogRgb) {
    const f = fogRgb || out.fog;
    openerCover = on ? [+f[0], +f[1], +f[2]] : null;   // own copy (the opener may reload)
    update();
  },
};

function paint(f) {
  const key = f.join(',');
  if (key === shownFog) return;
  shownFog = key;
  // same 2x2 ordered dither as the watchdog's cover in the opener (no smooth gradient)
  const rgb = (k) => `rgb(${f.map((v) => Math.round(v * 255 * k)).join(',')})`;
  coverEl.style.backgroundColor = rgb(1);
  coverEl.style.backgroundImage = `conic-gradient(${rgb(0.8)} 25%, transparent 0 50%, ${rgb(0.8)} 0 75%, transparent 0)`;
}

let coverOn = false;
function update() {
  const stalled = performance.now() - out.lastFrameAt > STALL_MS;
  const on = !!openerCover || stalled;
  if (on) paint(openerCover || out.fog);
  if (on !== coverOn) {
    coverOn = on;
    coverEl.style.transition = on ? 'opacity 0.3s linear' : 'opacity 1s linear';
    coverEl.style.opacity = on ? '1' : '0';
  }
}

function attach() {
  try { attached = !!window.opener && !window.opener.closed && !!window.opener.__vaporOutputAttach?.(window); } catch (e) { attached = false; }
}

setInterval(update, 100);
setInterval(() => { if (!attached || performance.now() - out.lastFrameAt > RECONNECT_MS) attach(); }, 250);
attach();
update();

addEventListener('pagehide', () => { try { window.opener?.__vaporOutputGone?.(window); } catch (e) { /* opener gone */ } });

// ---------------- fullscreen + wake lock ----------------
function goFullscreen() {
  if (document.fullscreenElement) return;
  document.documentElement.requestFullscreen().catch(() => {});
}
addEventListener('pointerdown', goFullscreen);

let wakeLock = null;
async function keepAwake() {
  if (!document.fullscreenElement || document.hidden || !navigator.wakeLock) {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    return;
  }
  if (wakeLock && !wakeLock.released) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed right now */ }
}
document.addEventListener('fullscreenchange', () => { hint.hidden = !!document.fullscreenElement; keepAwake(); });
document.addEventListener('visibilitychange', keepAwake);

// ---------------- keys -> opener ----------------
// One listener, one forwarded event per press: the opener's own key handler runs exactly once.
// F belongs to this window (fullscreen here, not on the laptop). Ctrl / Meta / Alt combos stay
// with the browser, like the opener's handler ignores them.
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') return;   // the browser leaves fullscreen
  goFullscreen();
  if (e.key.toLowerCase() === 'f') { e.preventDefault(); return; }
  const o = window.opener;
  if (!o || o.closed) return;
  try {
    o.dispatchEvent(new o.KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, repeat: e.repeat }));
    e.preventDefault();
  } catch (err) { /* opener reloading */ }
});
