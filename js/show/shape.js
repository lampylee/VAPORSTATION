// Song shape: an eased vector derived from the Conductor's section, so worlds
// open up, close in, slow down or thicken with the song's structure.
//   close    -1 wide … +1 close framing        pace     camera travel ×
//   fog      fog distance ×                     weather  particle amount ×
//   phrase   integer, ticks every 8 bars (or 16 s without a tempo) while the
//            section stays the same, so long grooves keep moving
// Neutral (no section / Conductor off): close 0, pace 1, fog 1, weather 1.
import { damp } from '../gfx/math.js';

export const SHAPE_TABLE = {
  intro:     { close: 0.5, pace: 0.6, fog: 0.85, weather: 0.7 },
  groove:    { close: 0, pace: 1, fog: 1, weather: 1 },
  build:     { close: 0.4, pace: 1.15, fog: 0.9, weather: 1.2 },
  drop:      { close: -0.6, pace: 1.3, fog: 1.25, weather: 1.4 },
  breakdown: { close: 0.8, pace: 0.5, fog: 0.8, weather: 0.6 },
  outro:     { close: 0.6, pace: 0.5, fog: 0.8, weather: 0.6 },
  '':        { close: 0, pace: 1, fog: 1, weather: 1 },
};

const TAU = 2;            // s, easing time constant
const PHRASE_BARS = 8;
const PHRASE_SECONDS = 16;

export class SongShape {
  constructor() {
    this.out = { close: 0, pace: 1, fog: 1, weather: 1, phrase: 0, section: '' };
    this.bars = 0;          // bar wraps since the section started / last tick
    this.clock = 0;         // seconds since the section started / last tick (no tempo)
    this.lastBar = 0;
  }

  update(audio, dt) {
    const o = this.out, section = audio.section || '';
    const row = SHAPE_TABLE[section] ?? SHAPE_TABLE[''];
    o.close = damp(o.close, row.close, TAU, dt);
    o.pace = damp(o.pace, row.pace, TAU, dt);
    o.fog = damp(o.fog, row.fog, TAU, dt);
    o.weather = damp(o.weather, row.weather, TAU, dt);

    if (section !== o.section) { o.section = section; this.bars = 0; this.clock = 0; }
    const bar = audio.bar || 0;
    if (audio.bpm > 0) {
      // a bar wraps when the bar index goes down (3 -> 0, or 2 -> 0 after a re-tap), as K.BarClock
      if (bar < this.lastBar && ++this.bars >= PHRASE_BARS) { this.bars = 0; this.clock = 0; o.phrase++; }
    } else if ((this.clock += dt) >= PHRASE_SECONDS) { this.clock = 0; this.bars = 0; o.phrase++; }
    this.lastBar = bar;
    return o;
  }
}
