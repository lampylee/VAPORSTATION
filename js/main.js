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
import { SetlistStore, SetlistPlayer, styleKey, looksLikeSetlist } from './setlist/setlist.js';
import { SetlistUI } from './setlist/ui.js';
import { ShowControl } from './show/control.js';
import { Midi } from './show/midi.js';
import { ShowUI, MidiUI, EnvBrowser } from './show/ui.js';

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
  onReset() { resetSettings(s); ui.refresh(); applyLook(); engine.setGainDb(s.inputGainDb); engine.setChannel(s.channel); selectPalette(''); setlist.cancelCue(); syncPool(); setlistUI.refresh(); showUI.refresh(); },
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
ui.insertSectionBefore(paletteUI.section, 'Worlds');

// ---------------- setlist ----------------
// Each song picks a palette and environment(s); a key or USB footswitch steps songs.
const STYLE_KEYS = STYLES.map(styleKey);
const setlists = new SetlistStore();
if (s.setlistId && !setlists.get(s.setlistId)) s.setlistId = setlists.all[0]?.id || '';

const songPool = (song) => (song?.styles || []).map((k) => STYLE_KEYS.indexOf(k)).filter((i) => i >= 0);
/** N and idle auto-switch rotate only through the current song's environments. */
function syncPool() { const p = setlist.active ? songPool(setlist.song) : []; styles.pool = p.length ? p : null; }

function applySong(song, i) {
  syncPool();
  if (song.palette !== null) {
    if (song.palette === '' || store.get(song.palette)) selectPalette(song.palette);
    else ui.setStatus(`Setlist: palette for "${song.label}" is missing, keeping the current one.`, true);
  }
  if (styles.pool) styles.goTo(styles.pool[0]);   // crossfades; queued if one is running
  setlistUI.tick();
  saveSettings(s);
}
const setlist = new SetlistPlayer(s, setlists, { apply: applySong });

function setlistOn(on) {
  s.setlistOn = on && !!setlists.all.length;
  if (s.setlistOn && !setlists.get(s.setlistId)) s.setlistId = setlists.all[0].id;
  if (s.setlistOn && setlist.active) setlist.goTo(setlist.pos);
  else { setlist.cancelCue(); syncPool(); }
  setlistUI.refresh();
  saveSettings(s);
}
function stepSong(dir) {
  if (!setlist.active) { ui.setStatus(setlists.all.length ? 'Setlist mode is off (S turns it on).' : 'No setlist yet: Setlist → New.', true); return; }
  setlist.step(dir, state.playing);
  setlistUI.tick();
}
const setlistUI = new SetlistUI(setlists, s, {
  player: setlist,
  styles: STYLES.map((C, i) => ({ key: STYLE_KEYS[i], name: C.meta?.name || C.name })),
  palettes: () => store.all,
  current: () => ({ paletteId: s.paletteId, styleKey: STYLE_KEYS[styles.target] }),
  onToggle: (on) => setlistOn(on),
  onSelectList(id) { s.setlistId = id; s.setlistPos = 0; setlist.cancelCue(); if (s.setlistOn) setlist.goTo(0); syncPool(); setlistUI.refresh(); saveSettings(s); },
  onJump(i) {
    if (!setlists.get(s.setlistId)) s.setlistId = setlists.all[0]?.id || '';
    s.setlistOn = true; setlist.goTo(i); setlistUI.refresh(); saveSettings(s);
  },
  onStep: (dir) => stepSong(dir),
  onSaved(list) { s.setlistId = list.id; if (s.setlistOn) setlist.goTo(setlist.pos); syncPool(); setlistUI.refresh(); saveSettings(s); },
  onDeleted(id) {
    if (s.setlistId === id) { s.setlistId = setlists.all[0]?.id || ''; s.setlistPos = 0; }
    if (!setlists.all.length) s.setlistOn = false;
    setlist.cancelCue(); syncPool(); setlistUI.refresh(); saveSettings(s);
  },
  onSetting: () => saveSettings(s),
});
ui.insertSectionBefore(setlistUI.section, 'Palette');
syncPool();   // look (palette + style) is already restored from settings; just limit the rotation

// ---------------- show control + MIDI ----------------
// Panic states (hold / freeze / blackout) deliberately don't persist across reloads.
const show = new ShowControl();
function showAction(id, v) {
  switch (id) {
    case 'hold': show.hold = !show.hold; break;
    case 'freeze': show.freeze = !show.freeze; break;
    case 'blackout': show.blackout = !show.blackout; break;
    case 'flash': show.bigMoment(); break;
    case 'tap': show.tap(); break;
    case 'tempoLock': s.tempoLock = !s.tempoLock; break;
    case 'holdLevel': s.holdLevel = Math.round(v * 20) / 20; break;
    case 'reactivity': s.reactivity = v == null ? (s.reactivity >= 0.75 ? 0 : Math.round(s.reactivity * 2) / 2 + 0.5) : Math.round(v * 20) / 20; break;
    case 'nextSong': stepSong(1); break;
    case 'prevSong': stepSong(-1); break;
    case 'nextStyle': styles.goNext(1); break;
    case 'prevStyle': styles.goNext(-1); break;
    case 'nextPalette': stepPalette(1); break;
    case 'prevPalette': stepPalette(-1); break;
    default: return;
  }
  if (id === 'tempoLock' || id === 'holdLevel' || id === 'reactivity') { showUI.refresh(); saveSettings(s); }
  showUI.update();
  ui.refresh();
}
const showUI = new ShowUI(show, s, {
  onPad: (id) => showAction(id),
  onTap: () => showAction('tap'),
  onTempo(cmd) { if (cmd === 'clear') show.tempo.clear(); else show.tempo.nudge(cmd); showUI.update(); },
  onSetting: () => saveSettings(s),
});
ui.insertSectionBefore(showUI.section, 'Setlist');

const midi = new Midi({
  onAction: (id, v) => showAction(id, v),
  onProgram(n) {
    if (!s.midiProgram || !setlists.get(s.setlistId)) return;
    if (!s.setlistOn) { s.setlistOn = true; setlistUI.refresh(); }
    setlist.goTo(n);           // an explicit song pick goes now (no cue)
    setlistUI.tick();
    saveSettings(s);
  },
  onStatus: () => midiUI.update(),
});
const midiUI = new MidiUI(midi, s, {
  async onEnable() { s.midiOn = await midi.enable(); saveSettings(s); },
  onSetting: () => saveSettings(s),
});
ui.insertSectionBefore(midiUI.section, 'Input level & gain');
if (s.midiOn) midi.enable();

// ---------------- environment browser (live thumbnails) ----------------
const envBrowser = new EnvBrowser(STYLES.map((C) => ({ name: C.meta?.name || C.name, hidden: !!C.meta?.hidden })), {
  onPick: (i) => { styles.goTo(i); ui.refresh(); },
});
// at the top of the Worlds card
ui.worlds.querySelector('h2').after(envBrowser.el);
let marked = '';
function markEnvs() {   // cheap; called every frame, touches the DOM only on change
  const key = `${styles.cur}|${styles.next}|${styles.pool}`;
  if (key !== marked) { marked = key; envBrowser.mark(styles.cur, styles.next, styles.pool); }
}
ui.makeCollapsible();

// One thumbnail per frame on load, then one every 0.4 s, only while the panel is
// visible. Each is the style at idle (k = 0) with its current palette, rendered
// through the full pipeline before the real frame (which then overwrites it).
const THUMB_AUDIO = { level: 0, bass: 0, mid: 0, high: 0, beat: false, beatPulse: 0, beatCount: 0, bpm: 0, beatPhase: 0, bar: 0, rmsDb: -100, rmsDbSmooth: -100 };
const thumbs = { pending: STYLES.map((_, i) => i), last: STYLES.map(() => -1), timer: 0, rr: 0, captureCur: false };
function thumbFrame(dt, now) {
  thumbs.captureCur = false;
  if (!uiVisible || bench || show.freeze) return;
  thumbs.timer -= dt;
  let i = -1;
  if (thumbs.pending.length) i = thumbs.pending.shift();
  else if (thumbs.timer <= 0) { thumbs.timer = 0.4; i = thumbs.rr = (thumbs.rr + 1) % styles.count; }
  if (i < 0) return;
  if (i === styles.cur || i === styles.next) {
    // the visible style: copy the real frame instead (unless it's mid-crossfade / flashing / fading)
    if (i === styles.cur && !styles.transitioning) thumbs.captureCur = true;
    else thumbs.pending.push(i);
    return;
  }
  const st = styles.styles[i];
  const steps = thumbs.last[i] < 0 ? 20 : Math.min(10, Math.max(1, Math.round((now - thumbs.last[i]) / 50)));
  thumbs.last[i] = now;
  for (let n = 0; n < steps; n++) st.update(THUMB_AUDIO, 0, 0.05);
  const P = renderer.params, saved = [P.flash, P.fade, P.jitterBoost, P.fogScale];
  P.flash = 0; P.fade = 0; P.jitterBoost = 0; P.fogScale = 1;
  renderer.beginScene('A'); renderer.setPalette(st.pal); st.render(renderer);
  renderer.composite(0); renderer.present();
  renderer.snapshot(envBrowser.ctx(i));
  [P.flash, P.fade, P.jitterBoost, P.fogScale] = saved;
}

// Drop anything on the window: images -> palette from art, palette files -> import, audio -> play.
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  try {
    if (f.type.startsWith('audio/')) playFile(f, f.name);
    else if (/\.json$/i.test(f.name) && looksLikeSetlist(await f.text())) { setUiVisible(true); await setlistUI.importFile(f); }
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
  if (paletteUI.modalOpen || setlistUI.modalOpen) return;
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
  else if (k === 'n') styles.goNext(e.shiftKey ? -1 : 1);
  else if (k === 's') setlistOn(!s.setlistOn);
  else if (k === 'pagedown' || k === 'arrowright' || k === ']') stepSong(1);
  else if (k === 'pageup' || k === 'arrowleft' || k === '[') stepSong(-1);
  else if (k === 'a') s.autoSwitch = !s.autoSwitch;
  else if (k === 'c') { s.crt = !s.crt; applyLook(); }
  else if (k === 'i') showAction('hold');
  else if (k === 'z') showAction('freeze');
  else if (k === 'b') showAction('blackout');
  else if (k === 'g') showAction('flash');
  else if (k === 't') { if (e.shiftKey) show.tempo.clear(); else if (!e.repeat) showAction('tap'); }
  else if (k === 'l') { showAction('tempoLock'); }
  else if (k === 'r') showAction('reactivity');   // Gentle → Medium → Punchy
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
    const cued = setlist.cued;
    setlist.update(playing);
    if (setlist.cued !== cued) setlistUI.tick();
    ({ audio, k, playing } = show.process(audio, k, playing, dt, s));
  }

  thumbFrame(dt, now);

  // music subtly pushes the PS1 parameters (always scaled by intensity)
  const P = renderer.params;
  if (!show.freeze) {
    P.time = (P.time || 0) + dt;   // stops while frozen (vertex wobble holds too)
    P.jitterBoost = s.audioPushesLook ? audio.beatPulse * k * show.jitterPush : 0;   // 0 at Gentle reactivity
    P.fogScale = s.audioPushesLook ? 1 + audio.level * k * 0.25 : 1;
  }
  P.fade = show.fade;
  P.flash = show.flashLevel(s);
  P.flashColor = styles.styles[styles.target].pal.role('flash');

  renderer.resetStats();
  if (!show.freeze) styles.update(audio, k, playing, dt, s);
  styles.render();
  renderer.present();
  if (thumbs.captureCur && !P.fade && P.flash < 0.01) renderer.snapshot(envBrowser.ctx(styles.cur));
  markEnvs();
  if (uiVisible) showUI.update();
  if (bench && !bench.done) { bench.record(dt, performance.now() - cpuStart); overlay.hidden = false; overlay.textContent = bench.label; }
  else if (bench && bench.done && overlay.textContent !== bench.label) overlay.textContent = bench.label;

  if (uiVisible) ui.updateMeter(audio.rmsDbSmooth, s.thresholdDb, state.playing);
  if (s.debug && (dbgTimer += dt) > 0.05) {
    dbgTimer = 0;
    ui.updateDebug({
      audio, fps, intensity: k, playing, state: bench && !bench.done ? bench.label : state.label, thresholdDb: s.thresholdDb,
      res: `${renderer.width}x${renderer.height}`, draws: renderer.stats.draws, tris: renderer.stats.tris,
      style: styles.name(styles.cur), transition: styles.transitioning ? styles.name(styles.next) : '',
      autoSwitch: s.autoSwitch, idle: styles.idleTime, setlist: setlist.label, show: show.label,
      source: engine.mode === 'live' ? `live: ${engine.deviceLabel || 'default'}` : engine.mode === 'file' ? 'file playback' : 'no input',
    });
  }
}
requestAnimationFrame(frame);

// handy for poking at things from the console
window.viz = { s, engine, analyser, state, styles, renderer, store, selectPalette, paletteUI, setlists, setlist, setlistUI, show, showUI, midi, midiUI, envBrowser, showAction };
