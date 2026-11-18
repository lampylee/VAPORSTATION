// App entry: wires audio -> analysis -> play state -> styles -> PS1 pipeline.
import { loadSettings, saveSettings, resetSettings } from './settings.js';
import { PS1Renderer } from './gfx/ps1.js';
import { AudioEngine } from './audio/engine.js';
import { Analyser } from './audio/analyser.js';
import { PlayState } from './audio/playstate.js';
import { STYLES } from './styles/index.js';
import { StyleManager } from './styles/manager.js';
import { UI } from './ui.js';
import { PaletteStore } from './palette/store.js';
import { PaletteUI } from './palette/ui.js';
import { Bench } from './bench.js';

const s = loadSettings();
const canvas = document.getElementById('view');
const overlay = document.getElementById('overlay');

let renderer;
try {
  renderer = new PS1Renderer(canvas);
} catch (e) {
  overlay.textContent = 'Could not start WebGL2: ' + e.message;
  overlay.hidden = false;
  throw e;
}

const engine = new AudioEngine();
const analyser = new Analyser();
const state = new PlayState();
const styles = new StyleManager(renderer, STYLES, s.style);
let liveWanted = false;   // user chose live input this session (for auto-reconnect)

const ui = new UI(s, STYLES.map((C) => C.meta.name), {
  onChange(key) {
    if (key === 'inputGainDb') engine.setGainDb(s.inputGainDb);
    if (key === 'channel') engine.setChannel(s.channel);
    if (key === 'style') styles.goTo(s.style);
    applyLook();
    saveSettings(s);
  },
  onDevice(id) { s.deviceId = id; saveSettings(s); startLive(); },
  onStartLive: () => startLive(),
  onFile: (f) => playFile(f, f.name),
  onDemo: () => playFile('demo/demo.wav', 'demo track'),
  onRefresh: () => refreshDevices(),
  onFullscreen: () => toggleFullscreen(),
  onReset() { resetSettings(s); ui.refresh(); applyLook(); engine.setGainDb(s.inputGainDb); engine.setChannel(s.channel); selectPalette(''); },
});
engine.attachPlayer(ui.player);
engine.channel = s.channel;
styles.onChange = (i) => { s.style = i; ui.inputs.style?.set(i); saveSettings(s); paletteUI?.drawStrip(styles.activePalette); };

// ---------------- palettes ----------------
const store = new PaletteStore();
if (s.paletteId && !store.get(s.paletteId)) s.paletteId = '';
styles.applyPalette(store.get(s.paletteId), 0);

function selectPalette(id, fade = s.paletteFade) {
  s.paletteId = id || '';
  styles.applyPalette(store.get(s.paletteId), fade);
  paletteUI.refresh();
  saveSettings(s);
}
/** P / Shift+P: step through "style defaults" + every palette. */
function stepPalette(dir) {
  const ids = ['', ...store.all.map((p) => p.id)];
  const i = ids.indexOf(s.paletteId);
  selectPalette(ids[(i + dir + ids.length) % ids.length]);
}
const paletteUI = new PaletteUI(store, s, {
  onSelect: (id) => selectPalette(id),
  active: () => styles.activePalette,
  // live preview while editing (null = restore the selected palette)
  onPreview: (p) => { styles.applyPalette(p || store.get(s.paletteId), 0.15); paletteUI.drawStrip(styles.activePalette); },
  onSaved: (p) => selectPalette(p.id, 0.15),
  onDeleted: (id) => { if (s.paletteId === id) selectPalette(''); else paletteUI.refresh(); },
  onSetting: () => saveSettings(s),
});
ui.insertSectionBefore(paletteUI.section, 'Styles');

// Drop anything on the window: images -> palette from art, palette files -> import, audio -> play.
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  try {
    if (f.type.startsWith('audio/')) playFile(f, f.name);
    else { setUiVisible(true); await paletteUI.importFile(f); }
  } catch (err) { ui.setStatus(`Could not import ${f.name}: ${err.message}`, true); }
});

function applyLook() {
  const P = renderer.params;
  const resChanged = P.resolution !== s.resolution;
  Object.assign(P, { resolution: s.resolution, aspectMode: s.aspectMode, jitter: s.jitter, affine: s.affine, dither: s.dither, colorBits: s.colorBits, crt: s.crt });
  if (resChanged) renderer.resize();
  document.getElementById('debug').hidden = !s.debug;
}
applyLook();

// ---------------- audio ----------------
async function refreshDevices() {
  try { ui.setDevices(await engine.listInputs(), s.deviceId); } catch (e) { console.warn(e); }
}

async function startLive() {
  ui.setStatus('Opening input…');
  try {
    const { deviceId, label } = await engine.startLive(s.deviceId);
    analyser.attach(engine.analyser);
    engine.setGainDb(s.inputGainDb);
    liveWanted = true;
    if (deviceId) { s.deviceId = deviceId; s.deviceLabel = label; }
    saveSettings(s);
    await refreshDevices();
    ui.setStatus(`Live: ${label || 'default input'}`);
    updateResumeOverlay();
  } catch (e) {
    console.error(e);
    ui.setStatus(`Could not open input: ${e.name === 'NotAllowedError' ? 'permission denied (allow the microphone for this page)' : e.message}`, true);
  }
}

async function playFile(src, name) {
  try {
    liveWanted = false;
    await engine.playFile(src);
    analyser.attach(engine.analyser);
    engine.setGainDb(s.inputGainDb);
    ui.setStatus(`File: ${name}`);
  } catch (e) {
    console.error(e);
    ui.setStatus(`Could not play file: ${e.message}`, true);
  }
  updateResumeOverlay();
}

navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
  await refreshDevices();
  // interface unplugged and replugged mid-gig: reconnect automatically
  if (liveWanted && engine.mode !== 'live') setTimeout(startLive, 500);
});

// AudioContext needs a user gesture before it will run.
function updateResumeOverlay() {
  overlay.hidden = !engine.needsResume;
  overlay.textContent = 'Click or press any key to start audio';
}
const kickAudio = () => { if (engine.needsResume) engine.resume().then(updateResumeOverlay); };
addEventListener('pointerdown', kickAudio);
addEventListener('keydown', kickAudio);

// On load: if live input was used before, reopen the remembered device.
refreshDevices().then(() => { if (s.deviceLabel || s.deviceId) startLive(); });

// ---------------- UI visibility / keys ----------------
let uiVisible = true;
function setUiVisible(v) {
  uiVisible = v;
  document.body.classList.toggle('ui-hidden', !v);
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch((e) => console.warn(e));
}
document.addEventListener('fullscreenchange', () => {
  setUiVisible(!document.fullscreenElement);   // hidden by default in fullscreen
  renderer.resize();
});
addEventListener('resize', () => renderer.resize());

addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (paletteUI.modalOpen) return;
  const tag = e.target?.tagName;
  if (tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type === 'text')) return;
  const k = e.key.toLowerCase();
  let handled = true;
  if (k === 'p') stepPalette(e.shiftKey ? -1 : 1);
  else if (k === 'o') selectPalette('');
  else if (k === 'f') toggleFullscreen();
  else if (k === 'h') setUiVisible(!uiVisible);
  else if (k === 'd') { s.debug = !s.debug; applyLook(); }
  else if (k >= '0' && k <= '9' && Number(k) < styles.count) styles.goTo(Number(k));
  else if (k === 'n') styles.goNext();
  else if (k === 'a') s.autoSwitch = !s.autoSwitch;
  else if (k === 'c') { s.crt = !s.crt; applyLook(); }
  else handled = false;
  if (handled) {
    e.preventDefault();
    ui.refresh();
    saveSettings(s);
  }
});

// ---------------- main loop ----------------
let last = performance.now(), fps = 60, dbgTimer = 0;
const bench = new URLSearchParams(location.search).has('bench') ? new Bench(styles, renderer) : null;
if (bench) { s.debug = true; applyLook(); setUiVisible(false); }
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0.0001, (now - last) / 1000));
  last = now;
  fps += (1 / dt - fps) * Math.min(1, dt * 2);
  const cpuStart = performance.now();

  let audio, k, playing;
  if (bench && !bench.done) {
    audio = bench.tick(dt); k = bench.intensity; playing = k > 0;
  } else {
    audio = analyser.update(dt, s, engine.mode !== 'none' && engine.running);
    state.update(audio.rmsDbSmooth, dt, s);
    k = state.intensity; playing = state.playing;
  }

  // music subtly pushes the PS1 parameters (always scaled by intensity)
  const P = renderer.params;
  P.jitterBoost = s.audioPushesLook ? audio.beatPulse * k * 1.2 : 0;
  P.fogScale = s.audioPushesLook ? 1 + audio.level * k * 0.25 : 1;

  renderer.resetStats();
  styles.update(audio, k, playing, dt, s);
  styles.render();
  renderer.present();
  if (bench && !bench.done) { bench.record(dt, performance.now() - cpuStart); overlay.hidden = false; overlay.textContent = bench.label; }
  else if (bench && bench.done && overlay.textContent !== bench.label) overlay.textContent = bench.label;

  if (uiVisible) ui.updateMeter(audio.rmsDbSmooth, s.thresholdDb, state.playing);
  if (s.debug && (dbgTimer += dt) > 0.05) {
    dbgTimer = 0;
    ui.updateDebug({
      audio, fps, intensity: k, playing, state: bench && !bench.done ? bench.label : state.label, thresholdDb: s.thresholdDb,
      res: `${renderer.width}x${renderer.height}`, draws: renderer.stats.draws, tris: renderer.stats.tris,
      style: styles.name(styles.cur), transition: styles.transitioning ? styles.name(styles.next) : '',
      autoSwitch: s.autoSwitch, idle: styles.idleTime,
      source: engine.mode === 'live' ? `live: ${engine.deviceLabel || 'default'}` : engine.mode === 'file' ? 'file playback' : 'no input',
    });
  }
}
requestAnimationFrame(frame);

// handy for poking at things from the console
window.viz = { s, engine, analyser, state, styles, renderer, store, selectPalette, paletteUI };
