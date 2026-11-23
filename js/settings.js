// Persistent settings. Everything the user can tweak lives here.
const KEY = 'ps1viz.settings.v1';

export const DEFAULTS = {
  // audio input
  deviceId: '',
  deviceLabel: '',
  channel: 'both',          // 'both' | 'left' | 'right'
  inputGainDb: 0,           // manual trim before analysis
  agc: true,                // slow auto-normalisation of levels
  agcTime: 8,               // seconds, how slowly auto-gain adapts
  // play / silent detection
  thresholdDb: -50,         // RMS (dBFS, after input gain) that counts as "playing"
  hysteresisDb: 4,          // must fall this far below threshold to count toward silence
  startHold: 0.5,           // s above threshold before PLAYING
  stopHold: 2.5,            // s below threshold before SILENT
  rampUp: 2.0,              // s for intensity 0 -> 1
  rampDown: 4.0,            // s for intensity 1 -> 0
  // beat detection
  beatSensitivity: 1.35,    // bass must exceed rolling average by this factor
  beatCooldown: 0.2,        // s minimum between beats
  reactivity: 0,            // 0 = Gentle (follows the song's energy), 0.5 = Medium, 1 = Punchy (every kick)
  // PS1 look
  resolution: '320x240',    // '320x240' | '426x240' | 'auto240' | '640x480'
  aspectMode: 'fit',        // 'fit' | 'stretch'
  jitter: 1.0,              // vertex snap grid in internal pixels (0 = off)
  affine: 1.0,              // 0 = perspective-correct, 1 = full affine warp
  dither: 1.0,              // ordered dither strength
  colorBits: 5,             // bits per channel (5 = PS1 15-bit colour)
  audioPushesLook: true,    // beats bump jitter, level changes fog
  crt: false,
  // palettes
  paletteId: '',            // '' = each style uses its own palette
  paletteFade: 2.5,         // s crossfade between palettes
  // styles
  style: 1,
  autoSwitch: true,         // auto style change while idle only
  idleSwitchDelay: 10,      // s of full idle before the first auto change
  idleSwitchInterval: 45,   // s between auto changes while still idle
  transitionTime: 3.0,      // s crossfade duration
  // setlist
  setlistOn: false,         // setlist mode: songs pick palette + environment(s)
  setlistId: '',            // active setlist
  setlistPos: 0,            // current song index
  setlistCue: true,         // while playing, Next cues the song until the room is quiet
  // show control
  holdLevel: 0.8,           // intensity while Hold is on
  blackoutTime: 1.0,        // s for the blackout fade
  strobeSafe: true,         // ≤ 3 beats/flashes per second reach the styles
  flashAmount: 0.5,         // big-moment palette flash strength
  tempoLock: false,         // beats on the tap-tempo grid instead of detected beats
  conductor: true,          // "Follow song": intensity follows the song's shape (builds, breakdowns, drops)
  dropSwitch: false,        // change environment on a big drop (at most once per song)
  // midi
  midiOn: false,            // reopen MIDI on load (Chrome remembers the permission)
  midiProgram: true,        // Program Change n selects setlist song n + 1
  // ui
  debug: false,
};

export function loadSettings() {
  const s = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(DEFAULTS)) {
        if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
      }
    }
  } catch (e) {
    console.warn('Settings could not be loaded, using defaults.', e);
  }
  return s;
}

let timer = 0;
export function saveSettings(s) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {
      console.warn('Settings could not be saved.', e);
    }
  }, 250);
}

export function resetSettings(s) {
  Object.assign(s, DEFAULTS);
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
