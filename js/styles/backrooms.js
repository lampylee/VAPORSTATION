// THE BACKROOMS — endless, empty office-like rooms (our own version, not a copy
// of any photo): mono-yellow wallpaper with a faint diamond lattice, damp beige
// carpet, a drop-ceiling grid with fluorescent panels, irregular doorways, odd
// pillars, stub and low partition walls. No figures.
//
// World: an infinite grid of 6 m cells. Every cell edge gets a deterministic wall
// type (open, doorway, solid, stub, two stubs, low partition) from its hash, so the
// rooms never end and never change as you walk. Solid walls only sit on half the
// edges by a parity rule, so every cell keeps an exit: the wander never dead-ends.
//
// Camera: wanders cell to cell at walking height. Each cell is one quadratic
// Bezier piece from the doorway it came through to the one it leaves by (control
// at the cell centre), so the path is C1 and turns corners without snapping.
//
//   idle   quiet, slow wander, a few dead panels, dim, close fog
//   swell  panel runs flicker on (K.Stager), the wander quickens and turns more,
//          walls breathe (shared `wave`), damp spreads (texture2 blend), fog pulls back
//   beat   the panel run ahead buzzes brighter (Envelope, limiter-gated)
//   bass   hum vibration (r.setJitterBoost)
//   light  the panels nearest the view are point lights (K.LightSet): their flicker, the dead
//          ones sputtering and the beat buzz move across the walls and carpet around them
//   highs  flicker sparkle on panels; dead ones sputter
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const C = 6;            // cell size (m)
const H = 2.8;          // ceiling height
const T = 0.16;         // wall thickness
const WALL_U = 1.4;     // wallpaper repeat width (texture covers the full wall height once)
const RAD = 8;          // cells around the camera to populate
const RUNS = 7;         // panel runs that switch on in order with the swell
const EYE = 1.62;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// edge types
const OPEN = 0, DOOR = 1, SOLID = 2, STUB = 3, STUB2 = 4, LOW = 5;
// doorway variants: [gap centre offset, gap width, lintel height]. The camera crosses at 0.
const DOORS = [[0, 1.3, 2.15], [-0.2, 1.5, 2.25], [0.15, 1.2, 2.05], [0.05, 2.4, 2.45]];

/** Grid of quads on a face: corner p0, full edge vectors U and V (normal = U x V). */
function gridFace(g, p0, U, V, uv0, uv1, su = 1, sv = 1, col = null) {
  const P = (a, b) => [p0[0] + U[0] * a + V[0] * b, p0[1] + U[1] * a + V[1] * b, p0[2] + U[2] * a + V[2] * b];
  const Tx = (a, b) => [uv0[0] + (uv1[0] - uv0[0]) * a, uv0[1] + (uv1[1] - uv0[1]) * b];
  for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
    const a0 = i / su, a1 = (i + 1) / su, b0 = j / sv, b1 = (j + 1) / sv;
    g.quad(P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1), Tx(a0, b0), Tx(a1, b0), Tx(a1, b1), Tx(a0, b1), null, col);
  }
}

/**
 * Wall block along X: x0..x1, y0..y1, thickness T around z = 0. Wallpaper u runs with
 * world x (repeat WALL_U), v = height / H, so the baseboard row stays at the floor.
 */
function wallBlock(g, x0, x1, y0, y1, { top = false, bottom = false } = {}) {
  const z = T / 2, L = x1 - x0, hgt = y1 - y0;
  const su = Math.max(1, Math.round(L / 1.6)), sv = hgt > 1.6 ? 3 : 1;   // 3 rows so panel light falls off down the wall
  const u0 = x0 / WALL_U, u1 = x1 / WALL_U, v0 = y0 / H, v1 = y1 / H, du = T / WALL_U;
  gridFace(g, [x0, y0, z], [L, 0, 0], [0, hgt, 0], [u0, v0], [u1, v1], su, sv);          // +z
  gridFace(g, [x1, y0, -z], [-L, 0, 0], [0, hgt, 0], [-u1, v0], [-u0, v1], su, sv);       // -z
  gridFace(g, [x1, y0, z], [0, 0, -T], [0, hgt, 0], [0, v0], [du, v1], 1, sv);            // +x end
  gridFace(g, [x0, y0, -z], [0, 0, T], [0, hgt, 0], [0, v0], [du, v1], 1, sv);            // -x end
  if (top) gridFace(g, [x0, y1, z], [L, 0, 0], [0, 0, -T], [u0, v1 - 0.02], [u1, v1], su, 1);
  if (bottom) gridFace(g, [x0, y0, -z], [L, 0, 0], [0, 0, T], [u0, v0], [u1, v0 + 0.02], su, 1);
}

const E = C / 2 + T / 2 - 0.01; // walls reach just past the vertex so corners close without z-fighting
function doorGeo([o, w, dh]) {
  const g = new GeoBuilder(), a = o - w / 2, b = o + w / 2;
  wallBlock(g, -E, a, 0, H); wallBlock(g, b, E, 0, H); wallBlock(g, a, b, dh, H, { bottom: true });
  return g.build();
}
function stubGeo(len, hgt = H) {
  const g = new GeoBuilder();
  wallBlock(g, -E, -E + len, 0, hgt, { top: hgt < H });
  return g.build();
}
function solidGeo() { const g = new GeoBuilder(); wallBlock(g, -E, E, 0, H); return g.build(); }
function pillarGeo(s = 0.55) {
  const g = new GeoBuilder(), h = s / 2, du = s / WALL_U;
  gridFace(g, [-h, 0, h], [s, 0, 0], [0, H, 0], [0, 0], [du, 1], 1, 2);
  gridFace(g, [h, 0, -h], [-s, 0, 0], [0, H, 0], [0, 0], [du, 1], 1, 2);
  gridFace(g, [h, 0, h], [0, 0, -s], [0, H, 0], [0, 0], [du, 1], 1, 2);
  gridFace(g, [-h, 0, -h], [0, 0, s], [0, H, 0], [0, 0], [du, 1], 1, 2);
  return g.build();
}
/** Horizontal cell-sized face at height y, facing up (floor) or down (ceiling). */
function slabGeo(y, up, uRep, vRep, segs) {
  const g = new GeoBuilder(), h = C / 2;
  if (up) gridFace(g, [-h, y, h], [C, 0, 0], [0, 0, -C], [0, 0], [uRep, vRep], segs, segs);
  else gridFace(g, [-h, y, -h], [C, 0, 0], [0, 0, C], [0, 0], [uRep, vRep], segs, segs);
  return g.build();
}
function rectGeo(w, d, y) { const g = new GeoBuilder(); gridFace(g, [-w / 2, y, -d / 2], [w, 0, 0], [0, 0, d], [0, 0], [1, 1]); return g.build(); }

// ---- indexed textures -------------------------------------------------------
/** Mono wallpaper 32x64 (1.4 m x full wall height): faint diamond lattice, strip seams, baseboard, damp. */
function wallpaper(damp) {
  return K.makeIndexed(32, 64, (x, y) => {
    if (y < 3) return K.dshade(1, 0.9 + K.rnd(x, y, 4) * 0.4, x, y);   // baseboard (row 0 = floor)
    if (y === 3) return R(0, 1);
    let s = 2;
    const row = (y >> 3) & 1, mx = (x + row * 4) & 7, my = y & 7;
    if ((mx === 4 && (my === 2 || my === 4)) || (my === 3 && (mx === 3 || mx === 5))) s -= 0.6;  // our lattice motif
    if (mx === 0 && my === 6) s += 0.45;
    if ((x & 15) === 15) s -= 0.28;                      // seams between paper strips
    if (y >= 61) s -= 0.35;                              // shadow under the ceiling
    const reach = damp ? 40 : 22, wet = K.tileBlob(x, y, 8, damp ? 9 : 3, 32) * clamp(1 - (y - 3) / reach);
    if (wet > (damp ? 0.3 : 0.42) + K.bayer(x, y) * 0.3) s -= damp ? 0.75 : 0.5;
    if (damp && y > 34 && K.rnd(x, 0, 7) < 0.12 && K.tileBlob(x, y, 4, 2, 32) > 0.35) s -= 0.45;  // drips from above
    return K.dshade(0, s, x, y);
  });
}
/** Damp beige carpet 32x32 (1.5 m): speckled pile and stains. */
function carpet(damp) {
  return K.makeIndexed(32, 32, (x, y) => {
    let s = 2.0 + (K.rnd(x, y, 2) - 0.5) * 0.35 + (K.tileBlob(x, y, 16, 4, 32) - 0.5) * 0.35 - (damp ? 0.2 : 0);
    const st = K.tileBlob(x, y, 8, damp ? 11 : 5, 32), th = damp ? 0.55 : 0.7;
    if (st > th) s -= 0.4;
    else if (st > th - 0.04) s -= 0.65;                 // darker tide-mark ring round each stain
    return K.dshade(1, s, x, y);
  });
}
/** Drop ceiling 64x32 = 2 x 2 tiles of 1.2 x 0.6 m: T-bar grid, fissured board, one stained tile. */
function ceiling() {
  return K.makeIndexed(64, 32, (x, y) => {
    if (x % 32 === 0 || y % 16 === 0) return K.dshade(3, 1.4, x, y);
    let s = 2.8 + (K.rnd(x, y, 6) - 0.5) * 0.4;
    if (x >= 32 && y < 16) { const d = Math.hypot(x - 45, y - 7) / 7; if (d < 1) s -= d > 0.8 ? 0.9 : 0.5; }
    return K.dshade(3, s, x, y);
  });
}
/** Fluorescent panel 16x8: frame, diffuser, two dividers. */
function panelTex() {
  return K.makeIndexed(16, 8, (x, y) => {
    if (x === 0 || x === 15 || y === 0 || y === 7) return R(2, 1);
    if (x === 5 || x === 10) return R(2, 2);
    return R(2, 3);
  });
}
/** Soft rectangular halo 32x24, dithered falloff (additive). */
function haloTex() {
  return K.makeIndexed(32, 24, (x, y) => {
    const dx = Math.abs(x - 15.5) / 16, dy = Math.abs(y - 11.5) / 12, d = Math.pow(Math.pow(dx, 3) + Math.pow(dy, 3), 1 / 3);
    const v = 1 - d;
    if (v <= 0 || v < K.bayer(x, y) * 0.55) return K.CLEAR;
    return K.dshade(2, 0.2 + v * 2.4, x, y);
  });
}

export class Backrooms {
  static meta = { name: 'The Backrooms' };
  static palette = fromKeys('backrooms', 'The Backrooms', ['#d2bc5c', '#b39e72', '#fbf7e2', '#d3c994']);

  init(r) {
    this.meshes = {
      floor: r.createMesh(slabGeo(0, true, C / 1.5, C / 1.5, 4)),
      ceil: r.createMesh(slabGeo(H, false, C / 2.4, C / 1.2, 3)),
      panel: r.createMesh(rectGeo(1.2, 0.6, H - 0.012)),
      halo: r.createMesh(rectGeo(2.8, 1.9, H - 0.03)),
      solid: r.createMesh(solidGeo()),
      pillar: r.createMesh(pillarGeo()),
      doors: DOORS.map((d) => r.createMesh(doorGeo(d))),
      stubs: [r.createMesh(stubGeo(1.8)), r.createMesh(stubGeo(2.3)), r.createMesh(stubGeo(2.2, 1.25))],
    };
    this.tex = {
      wall: r.texture(wallpaper(false)), wall2: r.texture(wallpaper(true)),
      carpet: r.texture(carpet(false)), carpet2: r.texture(carpet(true)),
      ceil: r.texture(ceiling()), panel: r.texture(panelTex()), halo: r.texture(haloTex()),
    };
    const N = (2 * RAD + 1) ** 2;
    this.inst = {
      floor: r.createInstances(N), ceil: r.createInstances(N),
      panel: r.createInstances(N * 2), halo: r.createInstances(N * 2),
      solid: r.createInstances(N), pillar: r.createInstances(N),
      doors: DOORS.map(() => r.createInstances(N)),
      stubs: [0, 1, 2].map(() => r.createInstances(N * 2)),
    };
    this.dust = new K.Particles(r, 'dust', { count: 120, area: [12, 2.6, 12], size: 0.04 });

    this.runs = new K.Stager(RUNS, { from: [0.04, 0.6], to: [0.2, 0.85], rise: [0.8, 2.6], fall: 1.6 });
    this.buzz = new K.Envelope(0.4);
    this.lights = new K.LightSet({ reach: 3, fade: 0.35 });
    this.cand = []; this.nCand = 0;
    this.buzzKey = -1;
    this.breath = new K.Breath({ beats: 16, period: 14 });

    // camera: a CameraRig with the base reactions turned well down (a slow, aimless walk)
    this.cam = new K.CameraRig({ fov: 68, near: 0.08, far: 80, fovPunch: 1.2, nudge: 0.05, rollKick: 0.008, idleSpeed: 0.75, activeSpeed: 2.1, bassBoost: 0.25 });
    this.pieces = []; this.sPos = C / 2;
    this._addPiece(0, 0, 0, 0);
    this.look = [1, 0];       // smoothed horizontal look direction
    this.walk = 0; this.time = 0; this.k = 0; this.a = null; this.d = K.drive({ level: 0, bass: 0, mid: 0, high: 0, beatPulse: 0, beat: false }, 0);
    this.light = 0.6; this.waveAmp = 0;
    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], tint: [1, 1, 1], tube: [0, 0, 0], focus: [0, 0, 0] };
    this._update(0);
  }

  // ---- the world --------------------------------------------------------------
  /** Edge kind 0 runs along x at z = ez*C (centre x = (ex+.5)C); kind 1 runs along z at x = ex*C. */
  edgeType(kind, ex, ez) {
    let h = K.rand2(ex * 2 + kind, ez, 11);
    if (K.rand2(Math.floor(ex / 3), Math.floor(ez / 3), 5) < 0.3) h *= 0.55;   // open-plan zones
    const solidOk = ((ex + ez) & 1) === kind;                                     // parity: every cell keeps an exit
    if (h < 0.4) return OPEN;
    if (h < 0.62) return DOOR;
    if (h < 0.74) return solidOk ? SOLID : DOOR;
    if (h < 0.86) return STUB;
    if (h < 0.94) return STUB2;
    return LOW;
  }
  /** Exit edge of cell (gx, gz) in direction e is passable? */
  canExit(gx, gz, e) {
    const t = e === 0 ? this.edgeType(1, gx + 1, gz) : e === 2 ? this.edgeType(1, gx, gz) : e === 1 ? this.edgeType(0, gx, gz + 1) : this.edgeType(0, gx, gz);
    return t !== SOLID;
  }
  _addPiece(gx, gz, din, dout) {
    const cx = (gx + 0.5) * C, cz = (gz + 0.5) * C, a = DIRS[din], b = DIRS[dout];
    const p = { gx, gz, din, dout, a: [cx - a[0] * C / 2, cz - a[1] * C / 2], c: [cx, cz], b: [cx + b[0] * C / 2, cz + b[1] * C / 2] };
    // arc length of the quadratic piece
    let len = 0, px = p.a[0], pz = p.a[1];
    for (let i = 1; i <= 16; i++) { const o = this._bez(p, i / 16, []); len += Math.hypot(o[0] - px, o[1] - pz); px = o[0]; pz = o[1]; }
    const last = this.pieces[this.pieces.length - 1];
    p.s0 = last ? last.s0 + last.len : 0; p.len = len;
    this.pieces.push(p);
  }
  _bez(p, t, out) {
    const u = 1 - t, A = u * u, B = 2 * u * t, Cc = t * t;
    out[0] = A * p.a[0] + B * p.c[0] + Cc * p.b[0]; out[1] = A * p.a[1] + B * p.c[1] + Cc * p.b[1];
    return out;
  }
  /** Choose the next cell: straight is likelier when calm, turns likelier as the song swells. */
  _extend(k) {
    const last = this.pieces[this.pieces.length - 1], d = last.dout;
    const gx = last.gx + DIRS[d][0], gz = last.gz + DIRS[d][1];
    const opts = [[d, lerp(2.8, 0.9, k)], [(d + 1) % 4, 1], [(d + 3) % 4, 1]].filter(([e]) => this.canExit(gx, gz, e));
    let tot = opts.reduce((s, o) => s + o[1], 0), pick = Math.random() * tot, e = opts[0][0];
    for (const [oe, w] of opts) { if ((pick -= w) <= 0) { e = oe; break; } }
    this._addPiece(gx, gz, d, e);
  }
  _pathAt(s, out) {
    const ps = this.pieces;
    let p = ps[ps.length - 1];
    for (const q of ps) if (s < q.s0 + q.len) { p = q; break; }
    return this._bez(p, clamp((s - p.s0) / p.len), out);
  }

  /** Panel brightness 0..1+ for panel j of cell (gx, gz). */
  panel(gx, gz, j) {
    const t = this.time, d = this.d, h = K.rand2(gx * 2 + j, gz, 31), runKey = Math.floor(gx / 3) * 2 + j;
    const hr = K.rand2(runKey, gz, 33);
    let b;
    if (h < 0.08) {
      // dead tube: sputters a little with the highs at full intensity
      b = Math.pow(Math.max(0, Math.sin(t * 6.1 + h * 97)), 10) * d.high * 0.5 * d.accent;
    } else if (hr < 0.55) {
      b = 0.94 + 0.06 * Math.sin(t * 1.3 + h * 40);                      // on even at idle
    } else {
      const v = this.runs.v[Math.min(RUNS - 1, Math.floor((hr - 0.55) / 0.45 * RUNS))];
      const fl = 4 * v * (1 - v), ph = h * 60;                            // flicker strongest mid-way, gone when settled
      b = v * (1 - fl * 0.55 * (0.5 + 0.5 * Math.sin(t * 9 + ph)) * (0.5 + 0.5 * Math.sin(t * 3.1 + ph * 1.7)));
    }
    b *= 1 + d.high * 0.3 * d.accent * Math.pow(Math.max(0, Math.sin(t * 17 + h * 133)), 8);   // highs: sparkle
    if (this.buzzKey === runKey * 4096 + gz) b += this.buzz.v * 0.7 * (0.88 + 0.12 * Math.sin(t * 44)) * Math.max(b, 0.35);
    return b;
  }
  cellLight(gx, gz) { return (this.panel(gx, gz, 0) + this.panel(gx, gz, 1)) * 0.5; }

  // ---- update -------------------------------------------------------------------
  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt; this.dt = dt;
    this.d = K.drive(a, k);
    this._update(dt);
  }

  _update(dt) {
    const k = this.k, d = this.d, a = this.a || { level: 0, bass: 0, mid: 0, high: 0, beat: false, beatPulse: 0, beatCount: 0 };
    this.runs.update(k, dt);
    this.buzz.update(dt);
    const br = this.breath.update(a, dt);
    this.waveAmp = damp(this.waveAmp, K.stage(k, 0.45, 1) * (0.05 + 0.06 * br), 0.6, dt);

    // walk the chain
    if (dt > 0) this.cam.update(a, k, dt);
    this.sPos += this.cam.speed * dt;
    while (this.pieces[this.pieces.length - 1].s0 + this.pieces[this.pieces.length - 1].len < this.sPos + 14) this._extend(k);
    while (this.pieces.length > 3 && this.pieces[1].s0 + this.pieces[1].len < this.sPos - 2) this.pieces.shift();
    const e2 = this._pathAt(this.sPos, [0, 0]), t2 = this._pathAt(this.sPos + 3.2, [0, 0]);
    let lx = t2[0] - e2[0], lz = t2[1] - e2[1]; const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
    this.look[0] = damp(this.look[0], lx, 0.45, dt); this.look[1] = damp(this.look[1], lz, 0.45, dt);
    // aimless glances left and right, a touch wider when the song swells
    const glance = (Math.sin(this.time * 0.21) * 0.22 + Math.sin(this.time * 0.083 + 1.3) * 0.16) * lerp(0.8, 1.2, k);
    const lyaw = Math.atan2(this.look[1], this.look[0]) + glance;
    this.walk += this.cam.speed * dt * 2.1;
    const eye = this.cam.eye, tg = this.cam.target, bob = Math.sin(this.walk) * 0.022 * (d.motion ?? 1);
    eye[0] = e2[0]; eye[1] = EYE + bob; eye[2] = e2[1];
    tg[0] = eye[0] + Math.cos(lyaw) * 4; tg[1] = EYE - 0.12 + Math.sin(this.time * 0.13) * 0.08; tg[2] = eye[2] + Math.sin(lyaw) * 4;

    // beat: the panel run just ahead buzzes
    if (d.beat) {
      const fx = Math.floor((eye[0] + this.look[0] * C * 1.5) / C), fz = Math.floor((eye[2] + this.look[1] * C * 1.5) / C);
      this.buzzKey = (Math.floor(fx / 3) * 2 + (Math.random() < 0.5 ? 0 : 1)) * 4096 + fz;
      this.buzz.trigger(0.35 + 0.65 * k);
    }
    this._build(eye);
    this.dust.update(dt, [eye[0], 1.4, eye[2]], { amount: lerp(0.35, 0.8, k), speed: 0.6 + lerp(d.energy, d.level, d.beatMotion) * 0.6 });
  }

  /** Fill every instance buffer from the cells around the camera. */
  _build(eye) {
    const I = this.inst, cgx = Math.floor(eye[0] / C), cgz = Math.floor(eye[2] / C), fx = this.look[0], fz = this.look[1];
    const n = { floor: 0, panel: 0, halo: 0, solid: 0, pillar: 0, doors: [0, 0, 0, 0], stubs: [0, 0, 0] };
    let sum = 0, cnt = 0;
    this.nCand = 0;
    const lights = new Map(), L = (gx, gz) => {
      const key = gx * 8192 + gz; let v = lights.get(key);
      if (v === undefined) { v = this.cellLight(gx, gz); lights.set(key, v); }
      return v;
    };
    const shadeOf = (l) => lerp(0.62, 1.1, clamp(l, 0, 1.2));
    for (let gz = cgz - RAD; gz <= cgz + RAD; gz++) for (let gx = cgx - RAD; gx <= cgx + RAD; gx++) {
      const x0 = gx * C, z0 = gz * C, cx = x0 + C / 2, cz = z0 + C / 2, dx = cx - eye[0], dz = cz - eye[2];
      const dist = Math.hypot(dx, dz);
      if (dist > RAD * C || dx * fx + dz * fz < -C * 1.3) continue;     // outside the fog, or behind us
      const own = L(gx, gz), soft = own * 0.6 + (L(gx - 1, gz) + L(gx + 1, gz) + L(gx, gz - 1) + L(gx, gz + 1)) * 0.1;
      if (dist < 16) { sum += own; cnt++; }
      const sh = shadeOf(soft);
      I.floor.set(n.floor, cx, 0, cz, 1, 0, sh); I.ceil.set(n.floor, cx, 0, cz, 1, 0, lerp(0.95, 1.3, clamp(soft)));
      n.floor++;
      for (let j = 0; j < 2; j++) {
        const b = this.panel(gx, gz, j), px = cx + (j ? 1.2 : -1.2), pz = cz + (j ? 1.5 : -1.5);
        I.panel.set(n.panel++, px, 0, pz, 1, 0, 0.42 + 0.8 * b);
        if (dist < 13 && b > 0.01) {   // light candidates: panels near the camera
          const c = this.cand[this.nCand] || (this.cand[this.nCand] = [0, 0, 0, 0]);
          c[0] = (gx * 4096 + gz) * 2 + j; c[1] = px; c[2] = pz; c[3] = b; this.nCand++;
        }
        if (b > 0.02) I.halo.set(n.halo++, px, 0, pz, 1, 0, b * 0.42);
      }
      // the two edges on this cell's -z and -x sides, and the vertex between them
      for (let kind = 0; kind < 2; kind++) {
        const type = this.edgeType(kind, gx, gz);
        if (type === OPEN) continue;
        const ex = kind ? x0 : cx, ez = kind ? cz : z0;
        const nb = kind ? L(gx - 1, gz) : L(gx, gz - 1), wsh = shadeOf((own + nb) * 0.5) * (kind ? 0.94 : 1);
        const hv = K.rand2(gx * 2 + kind, gz, 12), flip = hv < 0.5 ? Math.PI : 0;
        const rot = (kind ? Math.PI / 2 : 0) + flip;
        if (type === SOLID) I.solid.set(n.solid++, ex, 0, ez, 1, rot, wsh);
        else if (type === DOOR) { const v = Math.floor(K.rand2(gx, gz * 2 + kind, 13) * 4); I.doors[v].set(n.doors[v]++, ex, 0, ez, 1, rot, wsh); }
        else if (type === STUB) { const v = hv < 0.25 || hv > 0.75 ? 0 : 1; I.stubs[v].set(n.stubs[v]++, ex, 0, ez, 1, rot, wsh); }
        else if (type === STUB2) { I.stubs[0].set(n.stubs[0]++, ex, 0, ez, 1, rot, wsh); I.stubs[1].set(n.stubs[1]++, ex, 0, ez, 1, rot + Math.PI, wsh); }
        else I.stubs[2].set(n.stubs[2]++, ex, 0, ez, 1, rot, wsh);
      }
      if (K.rand2(gx, gz, 21) < 0.2) I.pillar.set(n.pillar++, x0, 0, z0, 1, 0, shadeOf(own) * 0.97);
    }
    I.floor.upload(n.floor); I.ceil.upload(n.floor); I.panel.upload(n.panel); I.halo.upload(n.halo);
    I.solid.upload(n.solid); I.pillar.upload(n.pillar);
    I.doors.forEach((b, i) => b.upload(n.doors[i])); I.stubs.forEach((b, i) => b.upload(n.stubs[i]));
    this.light = cnt ? sum / cnt : 0.6;
  }

  // ---- render -------------------------------------------------------------------
  render(r) {
    const { col, k, d } = this, P = this.pal, M = this.meshes, I = this.inst, X = this.tex;
    const dim = lerp(0.86, 1, k) * lerp(0.9, 1.04, clamp(this.light));
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    const far = lerp(22, 44, K.stage(k, 0.05, 0.9));
    r.setFog(col.fog, 2.5, far);
    r.setLight([0.35, -0.8, 0.45], scaleColor(col.light, P.role('light'), 0.38 * dim), scaleColor(col.amb, P.role('ambient'), 0.72 * dim));
    r.setJitterBoost(lerp(d.energy, d.bass, d.beatMotion) * 0.35 + k * 0.04);       // the hum
    // the nearest tubes light the walls round them; their flicker / buzz rides on b
    const L = this.lights, eye = this.cam.eye;
    scaleColor(col.tube, P.color(R(2, 3)), 0.85);
    L.begin();
    for (let i = 0; i < this.nCand; i++) { const c = this.cand[i]; L.add(c[0], c[1], H - 0.3, c[2], col.tube, 4.6, c[3]); }
    col.focus[0] = eye[0] + this.look[0] * 3; col.focus[1] = EYE; col.focus[2] = eye[2] + this.look[1] * 3;
    L.apply(r, col.focus, this.dt || 1 / 60);

    const wave = this.waveAmp > 0.002 ? [this.waveAmp, 0.33, 0.55] : null;
    const id = mat4.identity(this.m), damp2 = K.stage(k, 0.3, 1) * 0.5;
    const o = { texture: X.wall, texture2: X.wall2, blend: damp2, wave, model: id };
    r.drawInstanced(M.floor, I.floor, { texture: X.carpet, texture2: X.carpet2, blend: damp2, wave });
    r.drawInstanced(M.ceil, I.ceil, { texture: X.ceil, wave });
    r.drawInstanced(M.solid, I.solid, o);
    r.drawInstanced(M.pillar, I.pillar, o);
    M.doors.forEach((m, i) => r.drawInstanced(m, I.doors[i], o));
    M.stubs.forEach((m, i) => r.drawInstanced(m, I.stubs[i], o));
    r.drawInstanced(M.panel, I.panel, { texture: X.panel, unlit: true, wave });
    // halos shine a little through the haze, fading by distance (never popping at the scatter edge)
    r.drawInstanced(M.halo, I.halo, { texture: X.halo, unlit: true, additive: true, fog: false, fade: [far * 0.45, far * 0.95], wave });
    this.dust.draw(r, { brightness: lerp(0.35, 0.7, k) });
  }

  dispose(r) {
    const M = this.meshes, I = this.inst;
    [M.floor, M.ceil, M.panel, M.halo, M.solid, M.pillar, ...M.doors, ...M.stubs].forEach((m) => m.dispose());
    Object.values(this.tex).forEach((t) => r.deleteTexture(t));
    [I.floor, I.ceil, I.panel, I.halo, I.solid, I.pillar, ...I.doors, ...I.stubs].forEach((i) => i.dispose());
    this.dust.dispose(r);
  }
}
