// RIGHT PLACE — for a song about things being put where they belong.
//
// A wall of identical pale blocks floats in a slotted grid (8 columns x 3 rows x 2 layers)
// over an ice plain, icy peaks behind, under a dark sky crossed by slow red streaks.
// Every so often the blocks rearrange: they lift forward out of their slots, glide
// sideways on an eased arc and settle into new ones. Nothing teleports.
//
//   idle (k 0)   ~14 blocks drift and bob; a single swap now and then (every ~15-20 s),
//                streaks crawl, light snow
//   swell        more blocks join, gliding in from deep in the fog while they grow;
//                each bar a rearrangement step, more often and in bigger groups
//                (whole rows shifting one slot along, or a handful shuffling),
//                moving blocks glow with the accent, the streaks brighten and speed up
//   bar          one step per bar: on the wrap of audio.bar to 0 when a tempo is tapped
//                (audio.bpm > 0), else on every 4th audio.beatCount
//   beat         a soft swell of light rolls across the columns (K.History), scaled by feel
//
// Song sections (K.Moods, Conductor on): intro / breakdown / outro = few blocks, loosened from
// their slots and drifting apart, rearranging rarely, the camera eased back; a build brings blocks
// in one by one and the grid forms (they settle tighter into their slots); the drop fills the
// wall, locks the blocks still in their rows and rearranges every bar, mostly whole rows shifting
// along. Every move is still an eased glide; Conductor off = base.
//
// Colours: base ramp = blocks and ice, secondary = block seams / ice veins, accent = streaks
// and glows, atmosphere = fog and sky.
import { mat4, lerp, clamp, damp, smoothstep } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, box } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const COLS = 8, ROWS = 3, LAYERS = 2, SLOTS = COLS * ROWS * LAYERS;
const GAP = 2.15, SIZE = 1.4, BASE_Y = 1.4;
const MAX_BLOCKS = 38, IDLE_BLOCKS = 14;
const AWAY = 46;                      // joining / leaving blocks travel this far back into the fog
const N_STREAKS = 3;

const slotPos = (s, out) => {
  const c = s % COLS, rr = Math.floor(s / COLS) % ROWS, l = Math.floor(s / (COLS * ROWS));
  out[0] = (c - (COLS - 1) / 2) * GAP;
  out[1] = BASE_Y + rr * GAP;
  out[2] = -l * GAP * 1.1;
  return out;
};
const slotCol = (s) => s % COLS;
const slotRow = (s) => Math.floor(s / COLS);           // row index across layers (row + layer * ROWS)

/** Smootherstep: zero velocity and acceleration at both ends, so a slide starts and lands softly. */
const ease = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };

const height = (x, z) => {
  const back = clamp((-z - 32) / 30), side = clamp((Math.abs(x) - 48) / 30);
  const rg = K.ridged(x * 0.03 + 3, z * 0.035, { octaves: 4 });
  const peaks = rg * rg * 40 + K.fbm(x * 0.05, z * 0.05, { octaves: 2, seed: 5 }) * 5;
  return -3 + (K.fbm(x * 0.06, z * 0.06, { octaves: 2, seed: 11 }) - 0.5) * 0.8 + peaks * Math.max(back, side * 0.7);
};

// ---------------------------------------------------------------- textures
/** One block face: pale base ramp, dithered top-lit, a dark seam border and a faint inset line. */
const blockTex = () => K.makeIndexed(32, 32, (x, y) => {
  const e = Math.min(x, y, 31 - x, 31 - y);
  if (e < 1) return R(1, 1);
  if (e < 2) return R(1, 2);
  if (e === 5) return R(0, 2);
  return K.dshade(0, 2.9 - (y / 31) * 1.3 + (K.rnd(x, y, 7) - 0.5) * 0.25, x, y);
});
/** Ice: pale blotches with steel-blue veins. */
const iceTex = () => K.makeIndexed(64, 64, (x, y) => {
  const n = K.blobNoise(x, y, 12, 4) * 0.7 + K.blobNoise(x, y, 5, 9) * 0.3;
  const vein = Math.abs(Math.sin((x * 0.9 + y * 0.35) * 0.18 + K.blobNoise(x, y, 16, 2) * 5));
  if (vein < 0.035) return R(1, 2);
  return K.dshade(0, 1.2 + n * 1.8, x, y);
});
/** Long thin horizontal streaks, tileable in x, CLEAR between them; ends taper with dither. */
const streakTex = (seed) => K.makeIndexed(64, 32, (x, y) => {
  const lane = Math.floor(y / 3), inLane = y % 3;
  if (inLane === 2 || K.rnd(lane, 0, seed) < 0.35) return K.CLEAR;
  const len = 0.25 + K.rnd(lane, 1, seed) * 0.5, start = K.rnd(lane, 2, seed);
  let u = (x / 64 - start); u -= Math.floor(u);
  if (u > len) return K.CLEAR;
  const t = Math.sin((u / len) * Math.PI);           // 0 at the ends, 1 mid-streak
  if (t < 0.15 + K.bayer(x, y) * 0.5) return K.CLEAR;
  return K.dshade(2, 0.4 + t * 2.6 - inLane * 0.6, x, y);
});

/** A sky band: a ring around the eye between two elevations; vertex colour fades both edges. */
function bandGeo(e0, e1, radius = 88, segs = 24, uRepeat = 3) {
  const g = new GeoBuilder(), em = (e0 + e1) / 2;
  const P = (i, e) => { const a = (i / segs) * TAU; return [Math.cos(a) * Math.cos(e) * radius, Math.sin(e) * radius, Math.sin(a) * Math.cos(e) * radius]; };
  const rows = [[e0, 0, 0], [em, 0.5, 1], [e1, 1, 0]];
  for (let j = 0; j < 2; j++) for (let i = 0; i < segs; i++) {
    const [ea, va, ca] = rows[j], [eb, vb, cb] = rows[j + 1];
    const u0 = (i / segs) * uRepeat, u1 = ((i + 1) / segs) * uRepeat, n = [0, -1, 0];
    const A = [ca, ca, ca], B = [cb, cb, cb];
    g.tri(P(i, ea), P(i + 1, ea), P(i + 1, eb), [u0, 1 - va], [u1, 1 - va], [u1, 1 - vb], n, [A, A, B]);
    g.tri(P(i, ea), P(i + 1, eb), P(i, eb), [u0, 1 - va], [u1, 1 - vb], [u0, 1 - vb], n, [A, B, B]);
  }
  return g.build();
}

/** Centred quad (billboardQuad pivots at the bottom). */
const centredQuad = () => new GeoBuilder().quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();

export class RightPlace {
  static meta = { name: 'Right Place' };
  static palette = ALBUM_PALETTES.kida;

  init(r) {
    // ---- world
    this.ground = new K.Terrain(r, { size: 200, cells: 48, height, uvScale: 0.12, shadeRange: [0.6, 1], slopeShade: 0.75 });
    this.iceTex = r.texture(iceTex());
    this.sky = new K.Sky(r, { stars: 70 });
    this.streaks = Array.from({ length: N_STREAKS }, (_, i) => {
      const e0 = 0.1 + i * 0.17, e1 = e0 + 0.12 + (i % 2) * 0.04;
      return { mesh: r.createMesh(bandGeo(e0, e1, 88 - i * 3, 24, 3 + i)), tex: r.texture(streakTex(i * 2.3 + 1)), speed: (i % 2 ? -1 : 1) * (0.004 + i * 0.002), ph: i * 1.9, scroll: 0 };
    });

    // ---- blocks
    this.blockMesh = r.createMesh(box(SIZE, SIZE, SIZE));
    this.blockTex = r.texture(blockTex());
    this.blockInst = r.createInstances(MAX_BLOCKS);
    this.quad = r.createMesh(centredQuad());
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.glowInst = r.createInstances(MAX_BLOCKS);

    this.owner = new Int16Array(SLOTS).fill(-1);       // block id in each slot (reserved at move start)
    this.blocks = Array.from({ length: MAX_BLOCKS }, (_, i) => ({
      id: i, slot: -1, active: false,
      from: [0, 0, 0], to: [0, 0, 0], s0: 0, s1: 0,     // start / end position and scale
      t: 1, dur: 1, delay: 0, arc: 0, spin: 0,
      pos: [0, 0, 0], scale: 0, moving: 0,
      ph: K.rand2(i, 1, 3) * TAU, bobF: 0.45 + K.rand2(i, 2, 3) * 0.25,
    }));
    // the idle set is in place from the start (no joining animation on first show)
    this.rng = 12345;
    for (let i = 0; i < IDLE_BLOCKS; i++) {
      const b = this.blocks[i], s = this._freeSlot(true);
      b.active = true; b.slot = s; this.owner[s] = i;
      slotPos(s, b.to); b.from[0] = b.to[0]; b.from[1] = b.to[1]; b.from[2] = b.to[2];
      b.s0 = b.s1 = 1; b.t = 1;
    }

    // ---- camera + atmosphere
    this.cam = new K.CameraRig({ fov: 58, fovPunch: 2, nudge: 0.12, rollKick: 0.015, idleSpeed: 1, activeSpeed: 1, bassBoost: 0, far: 220 });
    this.snow = new K.Particles(r, 'snow');
    this.pulses = new K.History(48);
    this.flare = new K.Envelope(0.6);

    this.m = mat4.create(); this.mSky = mat4.create();
    this.time = 0; this.k = 0; this.a = null;
    this.energy = 0; this.mid = 0;
    this.lastBar = -1; this.lastBC = -1; this.sinceStep = 99; this.idleT = 9; this.stepAcc = 0.6; this.joinT = 0;
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [1, 1, 1], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], band: [0, 0, 0] };
    this._tmp = [0, 0, 0];

    // song sections: gates multiply the k fed into today's curves (clamped 0..1) — countGate how many
    // blocks are out (they still join / leave one at a time), stepGate how often and how big the
    // bar steps are, glowGate the streaks and the moving blocks' glow. Mood-only: minBlocks = the
    // idle count (today IDLE_BLOCKS), loose = blocks drifting apart out of their slots (× k),
    // lock = blocks held still in their slots (less bob / wobble, × k), rowBias = the chance a step
    // is a whole row shifting. camD (+ = back) is a camera position: slow, eased twice.
    this.moods = new K.Moods({
      still:  { countGate: 0.35, stepGate: 0.45, glowGate: 0.6,  minBlocks: 8,           loose: 1, lock: 0,   rowBias: 0.5,  camD: 3 },
      base:   { countGate: 1,    stepGate: 1,    glowGate: 1,    minBlocks: IDLE_BLOCKS, loose: 0, lock: 0,   rowBias: 0.5,  camD: 0 },
      gather: { countGate: 1.12, stepGate: 1.05, glowGate: 1.1,  minBlocks: IDLE_BLOCKS, loose: 0, lock: 0.5, rowBias: 0.6,  camD: 0 },
      full:   { countGate: 1.6,  stepGate: 1.6,  glowGate: 1.4,  minBlocks: IDLE_BLOCKS, loose: 0, lock: 1,   rowBias: 0.85, camD: -1.5 },
    }, { dropEase: 4, slow: ['camD'] });
    this.mv = this.moods.v; this.camD = null; this.kg = 0; this.loose = 0; this.lock = 0;
  }

  // ------------------------------------------------------------ helpers
  _rand() { this.rng = (this.rng * 1664525 + 1013904223) >>> 0; return this.rng / 4294967296; }

  /** A free slot; `front` prefers the front layer (used for the idle set). */
  _freeSlot(front = false) {
    const free = [];
    for (let s = 0; s < SLOTS; s++) if (this.owner[s] === -1 && (!front || s < COLS * ROWS)) free.push(s);
    if (!free.length) return front ? this._freeSlot(false) : -1;
    return free[Math.floor(this._rand() * free.length)];
  }

  /** Start an eased slide for block b to slot s (or away into the fog when s < 0). */
  _move(b, s, { delay = 0, dur = 1.4, arc = 1.2, join = false } = {}) {
    b.from[0] = b.pos[0]; b.from[1] = b.pos[1]; b.from[2] = b.pos[2];
    b.s0 = b.scale;
    if (b.slot >= 0 && this.owner[b.slot] === b.id) this.owner[b.slot] = -1;
    if (s >= 0) {
      this.owner[s] = b.id; b.slot = s; slotPos(s, b.to); b.s1 = 1;
      if (join) {   // come in from deep in the fog, growing on the way
        b.from[0] = b.to[0] * 1.3; b.from[1] = b.to[1] + 3; b.from[2] = b.to[2] - AWAY; b.s0 = 0;
        b.pos[0] = b.from[0]; b.pos[1] = b.from[1]; b.pos[2] = b.from[2]; b.scale = 0;
      }
    } else {         // leave: drift back into the fog, shrinking
      b.slot = -1; b.to[0] = b.pos[0] * 1.3; b.to[1] = b.pos[1] + 3; b.to[2] = b.pos[2] - AWAY; b.s1 = 0;
    }
    b.t = 0; b.delay = delay; b.dur = dur; b.arc = arc; b.spin = (this._rand() < 0.5 ? -1 : 1) * 0.35;
  }

  _settled() { return this.blocks.filter((b) => b.active && b.slot >= 0 && b.t >= 1); }

  /** One rearrangement step: `g` blocks move (a single swap at idle, rows and shuffles when playing). */
  _step(k, motion) {
    const dur = lerp(1.9, 1.15, k) / lerp(0.85, 1.15, clamp(motion));   // Gentle: slower, softer slides
    const g = Math.max(2, Math.round(lerp(1, 8, k) * lerp(0.6, 1.2, this._rand())));
    const pool = this._settled();
    if (pool.length < 2) return;
    const rowShift = g >= 3 && this._rand() < this.mv.rowBias;
    if (rowShift) {
      // a whole row slides one slot along (into free slots, wrapping round the far end on a wide arc)
      const row = Math.floor(this._rand() * ROWS * LAYERS), dir = this._rand() < 0.5 ? 1 : -1;
      const inRow = pool.filter((b) => slotRow(b.slot) === row);
      if (inRow.length >= 2 && inRow.length < COLS) {
        const targets = inRow.map((b) => row * COLS + ((slotCol(b.slot) + dir + COLS) % COLS));
        inRow.forEach((b) => { if (this.owner[b.slot] === b.id) this.owner[b.slot] = -1; });
        const blocked = targets.some((s) => this.owner[s] >= 0);
        inRow.forEach((b) => { this.owner[b.slot] = b.id; });
        if (!blocked) {
          inRow.sort((a, b) => dir * (slotCol(b.slot) - slotCol(a.slot)));   // leading block first
          inRow.forEach((b, j) => {
            const s = row * COLS + ((slotCol(b.slot) + dir + COLS) % COLS), wrap = Math.abs(slotCol(s) - slotCol(b.slot)) > 1;
            this._move(b, s, { delay: j * 0.09, dur: wrap ? dur * 1.5 : dur, arc: wrap ? 3.2 : 0.9 });
          });
          return;
        }
      }
    }
    // shuffle: g blocks swap among their own slots and some free ones
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(this._rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const movers = pool.slice(0, Math.min(g, pool.length));
    const slots = movers.map((b) => b.slot);
    for (let i = 0; i < movers.length; i++) { const f = this._freeSlot(); if (f >= 0 && this._rand() < 0.6) { slots.push(f); this.owner[f] = -2; } }
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(this._rand() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    // make sure nobody "moves" to its own slot when it can be avoided
    movers.forEach((b, i) => { if (slots[i] === b.slot) { const j = (i + 1) % slots.length; [slots[i], slots[j]] = [slots[j], slots[i]]; } });
    slots.forEach((s) => { if (this.owner[s] === -2) this.owner[s] = -1; });
    movers.forEach((b) => { if (this.owner[b.slot] === b.id) this.owner[b.slot] = -1; });
    movers.forEach((b, i) => this._move(b, slots[i], { delay: i * 0.12, dur, arc: 1.1 + (i % 3) * 0.9 }));
  }

  /** True once per bar: audio.bar wrapping round with a tapped tempo, else every 4th beatCount. */
  _barClock(a, dt) {
    this.sinceStep += dt;
    let fire = false;
    const bpm = a.bpm || 0, bar = Number.isFinite(a.bar) ? a.bar | 0 : -1, bc = Number.isFinite(a.beatCount) ? a.beatCount | 0 : 0;
    if (bpm > 0 && bar >= 0) {
      if (this.lastBar >= 0 && bar < this.lastBar) fire = true;   // 3 → 0 (or 3 → 1 after a hitch)
      this.lastBar = bar; this.lastBC = bc;                        // keep the fallback in sync for when the tempo is cleared
    } else {
      this.lastBar = -1;
      if (this.lastBC < 0 || bc < this.lastBC) this.lastBC = bc;   // first frame, or the counter was reset
      else if (bc - this.lastBC >= 4) { fire = true; this.lastBC = bc; }
    }
    if (fire && this.sinceStep < 0.6) fire = false;                // never faster than a very fast bar
    if (fire) this.sinceStep = 0;
    return fire;
  }

  // ------------------------------------------------------------ update
  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const m = this.mv = this.moods.update(a, dt);
    const d = K.drive(a, k);
    this.energy = damp(this.energy, d.energy, 1.2, dt);
    this.mid = damp(this.mid, d.mid, 0.6, dt);
    const ks = clamp(k * m.stepGate);
    this.kg = clamp(k * m.glowGate);
    this.loose = m.loose * K.stage(k, 0.02, 0.3); this.lock = m.lock * K.stage(k, 0.02, 0.3);

    // -- how many blocks are out: joins and leaves trickle one at a time, never all at once
    const want = Math.round(lerp(m.minBlocks, MAX_BLOCKS, smoothstep(clamp((k * 0.75 + this.energy * 0.4) * m.countGate))));
    this.joinT -= dt;
    if (this.joinT <= 0) {
      const active = this.blocks.filter((b) => b.active && b.slot >= 0);
      if (active.length < want) {
        const b = this.blocks.find((x) => !x.active), s = b && this._freeSlot();
        if (b && s >= 0) { b.active = true; this._move(b, s, { dur: 2.6, join: true }); this.joinT = lerp(0.9, 0.35, k); }
      } else if (active.length > want + 1) {
        const b = active.filter((x) => x.t >= 1).pop();
        if (b) { this._move(b, -1, { dur: 3 }); this.joinT = 0.8; }
      }
    }

    // -- rearrangement steps: one per bar (sometimes skipped at low intensity), plus a rare idle swap
    if (this._barClock(a, dt) && k > 0.05) {
      this.stepAcc += lerp(0.35, 1, ks);
      if (this.stepAcc >= 1) { this.stepAcc -= 1; this._step(ks, d.motion); this.flare.trigger(0.5 + 0.5 * k); }
    }
    this.idleT -= dt;
    // free clock: a rare single swap at idle; while playing with no beats arriving (ambient passages), a slow step
    if (this.idleT <= 0) { const iv = lerp(15, 6, ks); this.idleT = iv + this._rand() * iv * 0.4; if (this.sinceStep > iv * 0.8) { this._step(ks * 0.5, d.motion); this.sinceStep = 0; } }

    // -- advance the slides
    for (const b of this.blocks) {
      if (!b.active) continue;
      if (b.t < 1) {
        if (b.delay > 0) b.delay -= dt; else b.t = Math.min(1, b.t + dt / b.dur);
        if (b.t >= 1 && b.slot < 0) { b.active = false; b.scale = 0; continue; }
      }
      const e = ease(b.t), lift = Math.sin(Math.PI * e);
      b.moving = b.t < 1 && b.delay <= 0 ? lift : 0;
      // the arc: lift forward (toward the camera) out of the slot and a little up, then settle back in
      b.pos[0] = lerp(b.from[0], b.to[0], e);
      b.pos[1] = lerp(b.from[1], b.to[1], e) + lift * b.arc * 0.25;
      b.pos[2] = lerp(b.from[2], b.to[2], e) + lift * b.arc;
      b.scale = lerp(b.s0, b.s1, smoothstep(b.t));
    }

    // -- a soft wave of light across the columns on beats (History: it rolls left to right)
    this.pulses.push(d.pulse * d.accent);
    if (d.beat) this.flare.trigger(0.25 * k);
    this.flare.update(dt);

    // -- camera: a slow lateral drift in front of the wall, easing a touch closer as the song grows
    this.cam.update(a, k, dt);
    // camD: eased back for the quiet sections, a touch closer in the drop (eye z ≥ 13; the wall's
    // front face and lifted blocks stay inside z < 5.5)
    if (this.camD === null) this.camD = m.camD;
    this.camD = damp(this.camD, m.camD, 2, dt);
    const t = this.time, dist = lerp(19, 16, this.energy) + this.camD;
    const e = this.cam.eye, tg = this.cam.target;
    e[0] = Math.sin(t * 0.045) * 5.5 + Math.sin(t * 0.017) * 2;
    e[1] = 4 + Math.sin(t * 0.06) * 0.7 + this.camD * 0.25;
    e[2] = dist + Math.cos(t * 0.045) * 1.5;
    tg[0] = e[0] * 0.25; tg[1] = 4.3 + Math.sin(t * 0.05) * 0.2; tg[2] = -2;
    this.cam.roll = Math.sin(t * 0.03) * 0.015;
    this.ground.follow(e[0], e[2]);

    this.snow.update(dt, [e[0], e[1], e[2] - 12], { amount: K.swell(k, 0.3, 0.5), speed: 0.7 + lerp(d.energy, d.level, d.beatMotion) * 0.6, wind: 0.3 + this.mid });
    this.streaks.forEach((sk) => { sk.scroll += dt * sk.speed * (1 + k * 2.5 + this.energy * 2); });
  }

  // ------------------------------------------------------------ render
  render(r) {
    const { col, k } = this, P = this.pal, eye = this.cam.eye, t = this.time;
    const dim = lerp(0.7, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    scaleColor(col.zen, P.color(R(3, 0)), 1);
    this.sky.draw(r, eye, { horizon: col.fog, zenith: col.zen, brightness: dim, starLevel: lerp(0.35, 0.2, k) });

    // red streaks across the sky: always there, crawling; brighter and faster as the song grows
    const accent = P.color(R(2, 2));
    this.streaks.forEach((sk, i) => {
      const lvl = (lerp(0.32, 0.85, this.kg) +this.energy * 0.25 + this.flare.v * 0.35) * (1 - i * 0.18) * (0.92 + 0.08 * Math.sin(t * 0.4 + sk.ph));
      scaleColor(col.band, accent, lvl);
      mat4.trs(this.mSky, eye[0], eye[1] - 6, eye[2], 0, sk.ph, 0);
      r.draw(sk.mesh, this.mSky, { texture: sk.tex, unlit: true, fog: false, additive: true, depthWrite: false, tint: col.band, uvOffset: [sk.scroll, 0] });
    });

    r.setFog(col.fog, 18, lerp(85, 110, k));
    // a cold key light: halfway between the palette's light role and the palest base shade (ice)
    mixColor(col.light, P.role('light'), P.color(R(0, 3)), 0.6);
    scaleColor(col.light, col.light, lerp(0.8, 1.05, k));
    r.setLight([-0.35, -0.6, -0.55], col.light, scaleColor(col.amb, P.role('ambient'), lerp(0.6, 0.7, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    this.ground.draw(r, { texture: this.iceTex, tint: col.tint });

    // blocks: one instanced draw; per-instance shade lifts moving blocks and carries the beat wave
    let n = 0, ng = 0;
    const lk = 1 - 0.75 * this.lock, ls = this.loose;
    const bob = 0.1 * (1 + this.energy * 0.6) * lk;
    for (const b of this.blocks) {
      if (!b.active || b.scale <= 0.002) continue;
      const c = b.slot >= 0 ? slotCol(b.slot) : 0;
      const wave = this.pulses.at(c / (COLS - 1) * 0.5) * 0.18 * k;
      // quiet sections: drifting apart, out of the grid (an offset from the block's own continuous
      // position, so a slide in progress stays smooth). The spread scales with the slot position, so
      // settled neighbours stay ≥ 1.69 apart on some axis (blocks are 1.4, ≤ 1.7 turned 0.25 rad); the back layer moves further back; forward drift ≤ 1.7
      let ox = 0, oy = 0, oz = 0;
      if (ls > 0.001) {
        ox = ls * (b.pos[0] * 0.3 + Math.sin(t * 0.07 + b.ph) * 0.55);
        oy = ls * ((b.pos[1] - BASE_Y - GAP) * 0.35 + Math.sin(t * 0.09 + b.ph * 1.7) * 0.6);
        oz = ls * (0.8 + b.pos[2] * 0.6 + Math.sin(t * 0.05 + b.ph * 2.3) * 0.9);
      }
      const y = b.pos[1] + oy + Math.sin(t * b.bobF + b.ph) * bob;
      const rotY = (Math.sin(t * 0.2 + b.ph) * 0.05 + ls * Math.sin(t * 0.06 + b.ph) * 0.2) * lk + b.moving * b.spin;
      const rotX = (Math.sin(t * 0.17 + b.ph * 1.3) * 0.03 + ls * Math.sin(t * 0.05 + b.ph * 0.7) * 0.2) * lk;
      const shade = 0.92 + b.moving * 0.25 + wave;
      this.blockInst.set(n++, b.pos[0] + ox, y, b.pos[2] + oz, b.scale, rotY, shade, 0, 1, rotX, 0);
      const gl = b.moving * K.stage(this.kg, 0.1, 0.6);
      if (gl > 0.01) this.glowInst.set(ng++, b.pos[0] + ox, b.pos[1] + oy, b.pos[2] + oz - 0.8, (3 + gl) * b.scale, 0, gl * 0.8, 0, 1);
    }
    this.blockInst.upload(n); this.glowInst.upload(ng);
    // box() is centred, so instance y is the block centre
    r.drawInstanced(this.blockMesh, this.blockInst, { texture: this.blockTex, tint: col.tint });
    if (ng) r.drawInstanced(this.quad, this.glowInst, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, depthWrite: false, fog: false, fade: [30, 60], tint: P.role('glow') });

    this.snow.draw(r, { brightness: dim * 0.85 });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.snow.dispose(r);
    [this.blockMesh, this.quad, ...this.streaks.map((s) => s.mesh)].forEach((m) => m.dispose());
    [this.iceTex, this.blockTex, this.glowTex, ...this.streaks.map((s) => s.tex)].forEach((x) => r.deleteTexture(x));
    [this.blockInst, this.glowInst].forEach((i) => i.dispose());
  }
}
