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
import { Conductor } from './show/conductor.js';
import { Midi } from './show/midi.js';
import { ShowUI, MidiUI, EnvBrowser } from './show/ui.js';
import { Governor } from './safety/governor.js';
import { Watchdog } from './safety/watchdog.js';
import { SelfTest } from './safety/selftest.js';
import { Sink, Output, watchDpr } from './show/output.js';
import { FrameGuard, health } from './show/output-logic.js';
import { OperatorView } from './show/operator.js';

const s = loadSettings();
const canvas = document.getElementById('view');
const overlay = document.getElementById('overlay');

let renderer, sink;
try {
  renderer = new PS1Renderer();   // draws off-screen; frames go to the sink
  sink = new Sink(canvas);        // the laptop #view (single mode)
} catch (e) {
  overlay.textContent = 'Could not start WebGL2: ' + e.message;
  overlay.hidden = false;
  throw e;
}
/** Size the renderer's backbuffer to the current sink. */
function fitOutput() {
  const z = sink.size;
  renderer.setOutputSize(z.w, z.h, z.dpr);
  renderer.resize();
}
fitOutput();
const laptopSink = sink;

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
  onSelfTest: () => startSelfTest(),
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
const conductor = new Conductor();
function showAction(id, v) {
  switch (id) {
    case 'hold': show.hold = !show.hold; break;
    case 'freeze': show.freeze = !show.freeze; break;
    case 'blackout': show.blackout = !show.blackout; break;
    case 'flash': show.bigMoment(); break;
    case 'tap': show.tap(); break;
    case 'tempoLock': s.tempoLock = !s.tempoLock; break;
    case 'conductor': s.conductor = !s.conductor; break;
    case 'dropSwitch': s.dropSwitch = !s.dropSwitch; break;
    case 'holdLevel': s.holdLevel = Math.round(v * 20) / 20; break;
    case 'reactivity': s.reactivity = v == null ? (s.reactivity >= 0.75 ? 0 : Math.round(s.reactivity * 2) / 2 + 0.5) : Math.round(v * 20) / 20; break;
    case 'nextSong': stepSong(1); break;
    case 'prevSong': stepSong(-1); break;
    case 'nextStyle': styles.goNext(1); break;
    case 'prevStyle': styles.goNext(-1); break;
    case 'nextPalette': stepPalette(1); break;
    case 'prevPalette': stepPalette(-1); break;
    case 'output': openOutput(); break;   // opens / reopens; never closes (a stray pedal press can't kill the projector)
    default: return;
  }
  if (id === 'tempoLock' || id === 'holdLevel' || id === 'reactivity' || id === 'conductor' || id === 'dropSwitch') { showUI.refresh(); saveSettings(s); }
  showUI.update();
  ui.refresh();
}
const showUI = new ShowUI(show, s, {
  onPad: (id) => showAction(id),
  onTap: () => showAction('tap'),
  onTempo(cmd) { if (cmd === 'clear') show.tempo.clear(); else show.tempo.nudge(cmd); showUI.update(); },
  onSetting: () => saveSettings(s),
  onOutput: () => { if (output.state === 'open') closeOutput(); else openOutput(); },
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
  // panel hidden behind the operator view: only the queued ones (load, the "next" tile), no round robin
  const opOnly = !uiVisible && operator.visible && thumbs.pending.length > 0;
  if (!(uiVisible || opOnly) || bench || show.freeze || renderer.lost) return;
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
  if (styles.broken.has(i)) return;
  const st = styles.styles[i];
  const steps = thumbs.last[i] < 0 ? 20 : Math.min(10, Math.max(1, Math.round((now - thumbs.last[i]) / 50)));
  thumbs.last[i] = now;
  const P = renderer.params, saved = [P.flash, P.fade, P.jitterBoost, P.fogScale];
  try {
    for (let n = 0; n < steps; n++) st.update(THUMB_AUDIO, 0, 0.05);
    P.flash = 0; P.fade = 0; P.jitterBoost = 0; P.fogScale = 1;
    renderer.beginScene('A'); renderer.setPalette(st.pal); st.render(renderer);
    renderer.composite(0); renderer.present();
    renderer.snapshot(envBrowser.ctx(i));
  } catch (e) { styles._fail(i, e, 'thumbnail'); }
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
// liveWanted up front: if the interface is plugged in later, the watchdog keeps retrying
refreshDevices().then(() => { if (s.deviceLabel || s.deviceId) { liveWanted = true; startLive(); } });

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
  fitOutput();
});
addEventListener('resize', () => fitOutput());
watchDpr(window, () => fitOutput());   // dpr-only change (window moved to a screen with another scale)

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
  else if (k === 'w') showAction('output');       // projector window: open / reopen
  else handled = false;
  if (handled) {
    e.preventDefault();
    ui.refresh();
    saveSettings(s);
  }
});

// ---------------- projector output ----------------
// Optional second window with only the picture (output.html). Both windows' rAF drive frame();
// the guard runs one tick per display frame, so either window alone keeps the show running.
const guard = new FrameGuard();
const badge = document.createElement('div');
badge.id = 'outputBadge';
badge.textContent = 'projector lost · W to reopen';
document.body.appendChild(badge);
let badgeTimer = 0;
const output = new Output({
  laptopSink,
  onSinkChange(next) { sink = next; fitOutput(); },
  onState(st) {
    showUI.setOutput(st);
    clearTimeout(badgeTimer);
    badge.classList.toggle('show', st === 'lost');
    if (st === 'lost') badgeTimer = setTimeout(() => badge.classList.remove('show'), 5000);
    if (st === 'open') { guard.prefer('projector'); if (s.output !== 'dual') { s.output = 'dual'; saveSettings(s); } }
    else guard.prefer('laptop');
    syncOperator();
  },
  onFrame(t, src, first) {
    if (first) guard.prefer(src);   // the projector's display rate drives while it's alive
    if (guard.tick(t, src)) frame(t);
  },
  onStatus: (text, err) => ui.setStatus(text, err),
});
// the projector page calls these on load, and again after this page reloads (no click needed)
window.__vaporOutputAttach = (w) => output.attach(w);
window.__vaporOutputGone = (w) => output.gone(w);
function openOutput() { output.open().catch((e) => ui.setStatus(`Could not open the projector window: ${e.message}`, true)); }
function closeOutput() { output.close(); s.output = 'single'; saveSettings(s); syncOperator(); }

// ---------------- operator view ----------------
// Covers the laptop while the projector window shows the picture (the laptop #view then holds a
// stale frame). Also, with dual mode saved and no window yet, one big "Open projector output"
// button (a popup needs a click). After a loss it hides: the laptop shows the live picture.
const operator = new OperatorView(document.getElementById('operator'), {
  onAction(id) { showAction(id); opTimer = 1; },
  onNextSong() { if (setlist.active) stepSong(1); else showAction('nextStyle'); opTimer = 1; },
  onOpenOutput: () => openOutput(),
  onSingle() { s.output = 'single'; saveSettings(s); syncOperator(); },   // rehearsal without a projector
});
let opTimer = 1, opThumb = -1, lastSignalAt = performance.now();   // grace while the input opens
function syncOperator() {
  const want = output.state === 'open' ||
    (output.state === 'none' && s.output === 'dual' && !params.has('bench') && !params.has('selftest'));
  if (want && !operator.visible) { setUiVisible(false); opTimer = 1; }   // H brings the panel back over it
  operator.visible = want;
}
const paletteName = (id) => (id ? store.get(id)?.name || 'missing palette' : 'own palette');
/** What a footswitch press would bring: the cued / next song, or the next environment (setlists off). */
function nextInfo() {
  const thumb = (i) => (i >= 0 ? envBrowser.ctx(i).canvas : null);
  if (setlist.active) {
    const songs = setlist.list.songs, cued = setlist.cued >= 0;
    const i = cued ? setlist.cued : setlist.pos + 1;
    if (i >= songs.length) return { label: 'end of setlist', envName: '', paletteName: '', thumb: null, env: -1 };
    const song = songs[i], pool = songPool(song);
    const env = pool.length ? pool[0] : styles.target;
    const pal = song.palette === null ? paletteName(s.paletteId) : paletteName(song.palette);
    return { label: `${i + 1}/${songs.length}  ${song.label || 'untitled'}`, cued, envName: styles.name(env), paletteName: pal, thumb: thumb(env), env };
  }
  const up = styles.upcoming;
  return { label: '', envName: styles.name(up), paletteName: paletteName(s.paletteId), thumb: thumb(up), env: up };
}
function currentHealth() {
  return health({
    wantLive: liveWanted, inputSignal: performance.now() - lastSignalAt < 8000, ctxLost: renderer.lost,
    projector: output.state, governorTier: governor.tier, broken: styles.broken.size, audioSuspended: engine.needsResume,
  });
}
/** ~10 Hz: the operator view and the panel's health line. */
function updateOperator(audio, k, playing) {
  const hl = currentHealth();
  if (uiVisible) showUI.setHealth(hl);
  if (!operator.visible) return;
  const next = nextInfo();
  // panel hidden: thumbnails don't refresh by themselves; render the "next" one when it changes
  if (next.env >= 0 && next.env !== opThumb) {
    opThumb = next.env;
    if (!uiVisible && !thumbs.pending.includes(next.env)) thumbs.pending.push(next.env);
  }
  const songs = setlist.active ? setlist.list.songs : null;
  operator.update({
    songLine: songs ? `${setlist.pos + 1}/${songs.length}  ${setlist.song.label || 'untitled'}` : styles.name(styles.target),
    playing,
    section: s.conductor === false ? null : audio.section || '',
    intensity: k,
    next,
    nextAction: setlist.active ? 'song' : 'world',
    meterDb: audio.rmsDbSmooth, thresholdDb: s.thresholdDb, inputOn: state.playing,
    health: hl,
    buttons: { hold: show.hold, freeze: show.freeze, blackout: show.blackout },
    outputState: output.state, dual: s.output === 'dual',
  });
}

// ---------------- gig safety ----------------
const governor = new Governor(renderer, styles, styleKey);
const watchdog = new Watchdog({
  canvas: renderer.canvas, renderer, styles, engine, governor,
  wantLive: () => liveWanted,
  reopenLive: () => startLive(),
  onCover: (on, fog) => output.cover(on, fog),
});
try {
  const why = sessionStorage.getItem('vaporstation.recovered');
  if (why) { sessionStorage.removeItem('vaporstation.recovered'); console.warn(`[watchdog] recovered by reload (${why})`); }
} catch (e) { /* ignore */ }
// Offline: a service worker caches everything this page loaded, so a reload still works with
// the server gone (node window closed, GitHub Pages copy opened offline).
const params = new URLSearchParams(location.search);
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !params.has('bench') && !params.has('nosw')) {
  navigator.serviceWorker.register('sw.js').then(async () => {
    const reg = await navigator.serviceWorker.ready;
    const urls = [location.pathname, 'manifest.webmanifest', 'icon.svg', 'demo/demo.wav', 'output.html', 'js/show/output-page.js', 'js/show/output-logic.js',
      ...performance.getEntriesByType('resource').map((e) => e.name)];
    reg.active?.postMessage({ type: 'warm', urls: [...new Set(urls)] });
  }).catch((e) => console.warn('[offline] service worker not registered', e));
}

// Kiosk (?kiosk, used by kiosk.bat and the installed app): no panel, no cursor, live input on.
const kiosk = params.has('kiosk');
if (kiosk) {
  setUiVisible(false);
  document.body.classList.add('kiosk');
  if (!(s.deviceLabel || s.deviceId)) { liveWanted = true; refreshDevices().then(startLive); }   // otherwise the saved device opens below
}

// Keep the screen awake while fullscreen / kiosk (re-requested when the page comes back).
let wakeLock = null;
async function keepAwake() {
  const want = kiosk || !!document.fullscreenElement;
  if (!want || document.hidden || !navigator.wakeLock) { if (!want && wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } return; }
  if (wakeLock && !wakeLock.released) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed right now */ }
}
document.addEventListener('visibilitychange', keepAwake);
document.addEventListener('fullscreenchange', keepAwake);
keepAwake();

let frameErrAt = 0;
const frameError = (where, e) => {
  const now = performance.now();
  if (now - frameErrAt > 5000) { frameErrAt = now; console.error(`[safety] frame error in ${where}`, e); }
};

// ---------------- main loop ----------------
let last = performance.now(), fps = 60, dbgTimer = 0;
let bench = params.has('bench') ? new Bench(styles, renderer) : null;
if (bench) { s.debug = true; applyLook(); setUiVisible(false); governor.enabled = false; }

// Pre-show check (?selftest or the button): short bench of every style + venue checks, then a report.
let selftest = null;
function startSelfTest() {
  if (selftest && !selftest.finished) return;
  const back = styles.cur;
  selftest = new SelfTest({ renderer, styles, engine, midi, governor, keyOf: styleKey, s });
  selftest.onClose = () => { if (!kiosk) setUiVisible(true); };
  selftest.back = back;
  bench = selftest.bench;
  setUiVisible(false);
}
if (params.has('selftest') && !bench) startSelfTest();
syncOperator();
let lastIn = null;   // last good analysis result, reused if a frame's analysis throws
function frame(now) {
  try {
    output.checkAlive();   // projector window closed / its page replaced -> back to the laptop before drawing
    // backstop for the dpr watchers (their change event doesn't always come, e.g. under emulation)
    if ((sink.canvas.ownerDocument.defaultView?.devicePixelRatio || 1) !== renderer.out.dpr) fitOutput();
  } catch (e) { frameError('output', e); }
  const rawMs = now - last;
  const dt = Math.min(0.1, Math.max(0.0001, rawMs / 1000));
  last = now;
  fps += (1 / dt - fps) * Math.min(1, dt * 2);
  const cpuStart = performance.now();

  let audio, k, playing;
  try {
    if (bench && !bench.done) {
      audio = bench.tick(dt); k = bench.intensity; playing = k > 0;
    } else {
      audio = analyser.update(dt, s, engine.mode !== 'none' && engine.running);
      state.update(audio.rmsDbSmooth, dt, s);
      k = state.intensity; playing = state.playing;
      const cued = setlist.cued;
      setlist.update(playing);
      if (setlist.cued !== cued) setlistUI.tick();
      k = conductor.process(audio, k, playing, dt, s);   // intensity follows the song's shape
      if (conductor.worldChange) styles.goNext();         // "Change world on drops" (off by default)
      ({ audio, k, playing } = show.process(audio, k, playing, dt, s));
    }
    lastIn = { audio, k, playing };
  } catch (e) {
    frameError('audio/show', e);
    if (!lastIn) return;
    ({ audio, k, playing } = lastIn);
  }
  try { watchdog.update(dt); governor.update(rawMs, dt); } catch (e) { frameError('safety', e); }

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
  try {
    if (!show.freeze) styles.update(audio, k, playing, dt, s);
    if (!renderer.lost) {
      styles.render();
      renderer.present();
      // the thumbnail must never cost the real frame
      if (thumbs.captureCur && !P.fade && P.flash < 0.01) try { renderer.snapshot(envBrowser.ctx(styles.cur)); } catch (e) { frameError('thumbnail', e); }
      // operator preview: same task, before takeFrame; it must never cost the real frame either
      if (operator.showsPreview) try { operator.drawPreview(renderer.canvas, renderer.shown, renderer.canvas.height); } catch (e) { frameError('preview', e); }
      const bmp = renderer.takeFrame();
      sink.show(bmp);
      if (bmp && output.state === 'open') output.shown(renderer.fogColor);
    }
  } catch (e) { frameError('render', e); }
  markEnvs();
  if (uiVisible) showUI.update();
  if (audio.rmsDbSmooth > -70) lastSignalAt = performance.now();   // health: input signal seen in the last 8 s
  if ((opTimer += dt) >= 0.1) { opTimer = 0; try { updateOperator(audio, k, playing); } catch (e) { frameError('operator', e); } }
  if (bench && !bench.done) {
    bench.record(dt, performance.now() - cpuStart);
    selftest?.tick(dt);
    overlay.hidden = false; overlay.textContent = selftest ? selftest.label : bench.label;
  } else if (selftest && !selftest.finished) {
    overlay.hidden = true; bench = null;
    styles.cur = selftest.back; styles.next = -1;   // under the report dialog
    selftest.finish().catch((e) => console.error('[selftest]', e));
  }
  else if (bench && bench.done && overlay.textContent !== bench.label) overlay.textContent = bench.label;

  if (uiVisible) ui.updateMeter(audio.rmsDbSmooth, s.thresholdDb, state.playing);
  if (s.debug && (dbgTimer += dt) > 0.05) {
    dbgTimer = 0;
    ui.updateDebug({
      audio, fps, intensity: k, playing, state: bench && !bench.done ? bench.label : state.label, thresholdDb: s.thresholdDb,
      res: `${renderer.width}x${renderer.height}`, draws: renderer.stats.draws, tris: renderer.stats.tris,
      style: styles.name(styles.cur), transition: styles.transitioning ? styles.name(styles.next) : '',
      autoSwitch: s.autoSwitch, idle: styles.idleTime, setlist: setlist.label, show: show.label, song: s.conductor === false ? 'song: follow off' : conductor.label, safety: `${governor.label} · ${watchdog.label}`,
      source: engine.mode === 'live' ? `live: ${engine.deviceLabel || 'default'}` : engine.mode === 'file' ? 'file playback' : 'no input',
    });
  }
}
function laptopLoop(now) {
  requestAnimationFrame(laptopLoop);
  if (guard.tick(now, 'laptop')) frame(now);
}
requestAnimationFrame(laptopLoop);

// handy for poking at things from the console
window.viz = { s, engine, analyser, state, conductor, styles, renderer, get sink() { return sink; }, output, store, selectPalette, paletteUI, setlists, setlist, setlistUI, show, showUI, midi, midiUI, envBrowser, showAction, governor, watchdog, operator,
  frame };   // frame(now): one tick by hand (the Claude pane is often hidden, so rAF never fires)
