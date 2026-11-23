// ASHFALL TOWN — a slow walk down the empty main street of a small town at
// dusk. Heavy grey fog (things surface ~20-30 units ahead), falling ash,
// boarded-up shops, street lamps, telephone poles, chain-link lots and a few
// abandoned cars. The street is endless: segments are placed deterministically
// by index around the camera and appear/disappear beyond the fog.
//
// Idle (k = 0): grey, quiet, slow walk, light ash, lamps dim.
// Swell: "the town rusts over". Every surface lives in one indexed texture
//   atlas; a rusted copy of the atlas is revealed pixel by pixel through an
//   ordered-dither threshold map (rust grows in patches, up from the bottom of
//   each surface), so the change is a smooth dissolve, never a pop. The light
//   turns sickly red and the ash thickens.
// Reactions: beats = siren-red pulse + camera nudge; highs = lamp flicker;
//   bass = ash speed + a subtle ground tremor.
// Light (Kit v7): the street lamps are point lights (K.LightSet, best 4 ahead), pale at idle,
//   red with the swell, failing ones dim, flickering with the highs.
import { lerp, damp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { CLEAR } from '../gfx/textures.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const SEG = 12;          // street segment length (world units, along -Z)
const AHEAD = 46;        // place segments this far ahead (beyond the fog)
const ROAD = 4;          // road half-width
const WALK = 6.5;        // sidewalk outer edge = building fronts
const MAXSEG = 8;

// ---------------------------------------------------------------------------
// Texture atlas: 256x256 indexed, 4x4 tiles of 64x64. One texture for every
// solid surface, so the whole town rusts with a single re-upload.
// ---------------------------------------------------------------------------
const AT = 256, TS = 64;
const T = {
  PLASTER: 0, BRICK: 1, WINDOW: 2, BOARDED: 3,
  DOOR: 4, AWNING: 5, SIGN: 6, ROAD: 7,
  ROADLINE: 8, SIDEWALK: 9, CURB: 10, CARBODY: 11,
  CARGLASS: 12, DIRT: 13, ROOF: 14, POLE: 15,
};

const rnd = (x, y, s = 0) => { const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return h - Math.floor(h); };
const vn = (x, y, sc, s) => rnd(Math.floor(x / sc), Math.floor(y / sc), s);
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const grain = (ramp, shade, x, y, amt = 0.14, s = 0) => {
  const r = rnd(x, y, s + 5);
  if (r < amt / 2) shade--; else if (r > 1 - amt / 2) shade++;
  return R(ramp, Math.max(0, Math.min(3, shade)));
};

/** Base (clean) pixel for tile t at local (x, y), atlas coords (ax, ay). */
function basePixel(t, x, y, ax, ay) {
  switch (t) {
    case T.PLASTER: {
      const v = 0.6 * vn(ax, ay, 8, 1) + 0.4 * vn(ax, ay, 4, 2);
      let sh = v > 0.72 ? 3 : v > 0.32 ? 2 : 1;
      if (Math.abs(y - (22 + Math.sin(x * 0.35) * 5 + x * 0.2)) < 0.7 && x > 8 && x < 44) return R(0, 0);
      if (y > 54 && rnd(x, y, 3) > 0.55) sh--;
      return grain(0, sh, ax, ay);
    }
    case T.BRICK: {
      const row = y >> 3, off = row % 2 ? 8 : 0;
      if (y % 8 === 0 || (x + off) % 16 === 0) return R(0, 1);
      const b = rnd((x + off) >> 4, row, 4);
      return grain(1, b > 0.7 ? 2 : b > 0.2 ? 1 : 0, ax, ay, 0.18);
    }
    case T.WINDOW: {
      if (x < 4 || x > 59 || y < 4 || y > 55 || Math.abs(x - 31.5) < 1.5 || Math.abs(y - 29.5) < 1.5) return y > 55 ? R(0, 2) : R(0, 1);
      return (x + y) % 32 < 4 ? R(3, 1) : R(3, 0);
    }
    case T.BOARDED: {
      if (x < 4 || x > 59 || y < 4 || y > 55) return y > 55 ? R(0, 2) : R(0, 1);
      const band = [[8, 20], [27, 39], [44, 55]].findIndex(([a, b]) => y >= a && y <= b);
      const diag = Math.abs(x - y * 0.9 - 4) < 5;
      if (band < 0 && !diag) return R(3, 0);
      const edge = band >= 0 && (y === [8, 27, 44][band] || y === [20, 39, 55][band]);
      if ((x === 10 || x === 54) && band >= 0 && (y % 6 === 2)) return R(0, 0); // nails
      return edge ? R(1, 0) : grain(1, diag ? 2 : 1 + (rnd(band, 7) > 0.5 ? 1 : 0), ax, ay, 0.2);
    }
    case T.DOOR: {
      if (x < 4 || x > 59 || y < 2) return R(0, 1);
      if (y > 8 && y < 22 && x > 10 && x < 53) return R(3, 0);
      if ((Math.abs(x - 10) < 1 || Math.abs(x - 53) < 1) && y > 26 && y < 60) return R(1, 0);
      if (Math.hypot(x - 48, y - 40) < 2) return R(0, 3);
      return grain(1, 1, ax, ay, 0.2);
    }
    case T.AWNING: {
      if (y > 52 && Math.hypot((x % 8) - 4, y - 52) > 4.2) return CLEAR; // scalloped valance
      return R((x >> 3) % 2 ? 1 : 0, y < 6 ? 1 : 2);
    }
    case T.SIGN: {
      if (x < 3 || x > 60 || y < 3 || y > 60) return R(0, 0);
      const gx = (x - 6) >> 3, gy = (y - 16) >> 3;
      if (y >= 16 && y < 48 && x >= 6 && x < 58 && rnd(gx, gy, 9) > 0.45 && rnd(x >> 1, y >> 1, 3) > 0.15) return R(2, 1); // abstract glyph blocks
      return rnd(ax, ay, 6) > 0.93 ? R(0, 1) : grain(0, 3, ax, ay, 0.1);
    }
    case T.ROAD: case T.ROADLINE: {
      if (t === T.ROADLINE && x >= 57 && x <= 62 && y < 32 && rnd(ax, ay, 8) > 0.2) return R(0, 3);
      const v = vn(ax, ay, 4, 11);
      if (Math.abs(x - (30 + Math.sin(y * 0.2) * 6)) < 0.6 && y > 20) return R(0, 0);
      return rnd(ax, ay, 12) > 0.93 ? R(0, 2) : R(0, v > 0.75 ? 0 : 1);
    }
    case T.SIDEWALK: {
      if (x % 32 === 0 || y % 32 === 0) return R(0, 0);
      return grain(0, rnd(x >> 5, y >> 5, 13) > 0.7 ? 1 : 2, ax, ay, 0.16);
    }
    case T.CURB: return y < 6 ? R(0, 3) : grain(0, 2, ax, ay, 0.2);
    case T.CARBODY: {
      if (y === 30 || x === 0) return R(1, 0);
      if (y >= 34 && y <= 35) return R(0, 3);
      return grain(1, y > 44 ? 1 : 2, ax, ay, 0.1);
    }
    case T.CARGLASS: {
      if (x < 3 || x > 60 || y < 3 || y > 60) return R(1, 1);
      return (x + y) % 40 < 5 ? R(3, 2) : R(3, 0);
    }
    case T.DIRT: {
      const v = vn(ax, ay, 4, 14);
      if (rnd(ax, ay, 15) > 0.94) return R(1, 0);
      return R(0, v > 0.6 ? 1 : 0);
    }
    case T.ROOF: return (x % 16 === 0 || y % 21 === 0) ? R(0, 0) : grain(0, vn(ax, ay, 8, 16) > 0.5 ? 1 : 0, ax, ay, 0.2);
    case T.POLE: return ((x + Math.floor(Math.sin(y * 0.15) * 2)) % 6 === 0) ? R(1, 0) : grain(1, 1, ax, ay, 0.25);
  }
  return R(0, 1);
}

/** Rusted / grimy version of a base pixel: keeps structure, moves to the rust ramp. */
function rustPixel(idx, ax, ay) {
  if (idx === CLEAR) return CLEAR;
  const ramp = idx >> 2, shade = idx & 3;
  const n = 0.6 * vn(ax, ay, 3, 21) + 0.4 * rnd(ax, ay, 22);
  const drip = rnd(ax >> 1, Math.floor(ay / 20), 23) > 0.78;
  if (ramp === 3) return n > 0.72 ? R(1, 0) : idx;                // grime on glass / gaps
  if (n > 0.8) return R(2, 0);                                     // deep red corrosion
  const s = Math.min(2, shade) - (drip ? 1 : 0);
  return grain(1, Math.max(0, s), ax, ay, 0.2, 7);
}

function buildAtlas() {
  const base = new Uint8Array(AT * AT), rust = new Uint8Array(AT * AT), thr = new Float32Array(AT * AT);
  for (let ay = 0; ay < AT; ay++) for (let ax = 0; ax < AT; ax++) {
    const t = (ay >> 6) * 4 + (ax >> 6), x = ax & 63, y = ay & 63, i = ay * AT + ax;
    base[i] = basePixel(t, x, y, ax, ay);
    rust[i] = rustPixel(base[i], ax, ay);
    // reveal order: large patches first, growing up from the bottom of each surface, ordered dither on top
    const patch = 0.55 * vn(ax, ay, 16, 31) + 0.3 * vn(ax, ay, 8, 32) + 0.15 * rnd(ax, ay, 33);
    thr[i] = 0.1 + patch * 0.8 - (y / 63) * 0.2 + (bayer(ax, ay) - 0.5) * 0.24;
  }
  return { base, rust, thr, data: base.slice(), width: AT, height: AT, indexed: true };
}

// ---------------------------------------------------------------------------
// Atlas geometry helpers (each face is subdivided into cells, one tile each:
// tiling without REPEAT, and less affine warping, like real PS1 geometry).
// ---------------------------------------------------------------------------
function tileUV(t, mirror) {
  const e = 0.5 / AT, tx = t % 4, ty = t >> 2;
  let u0 = (tx * TS) / AT + e, u1 = ((tx + 1) * TS) / AT - e;
  if (mirror) [u0, u1] = [u1, u0];
  return [u0, (ty * TS) / AT + e, u1, ((ty + 1) * TS) / AT - e];
}
const add = (o, u, a, v, b) => [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b];
/** Rect from corner o along unit axes u (width) and v (height, image "up"). Normal = u x v. */
function rect(g, o, u, v, w, h, tile, mirror = false) {
  const [u0, v0, u1, v1] = tileUV(tile, mirror);
  g.quad(o, add(o, u, w, v, 0), add(o, u, w, v, h), add(o, u, 0, v, h), [u0, v1], [u1, v1], [u1, v0], [u0, v0]);
}
/** Face split into cells of ~cw x ch; tile = number or fn(col, row, cols, rows). */
function cells(g, o, u, v, W, H, cw, ch, tile) {
  const cols = Math.max(1, Math.round(W / cw)), rows = Math.max(1, Math.round(H / ch));
  const w = W / cols, h = H / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = typeof tile === 'function' ? tile(c, r, cols, rows) : tile;
    rect(g, add(o, u, c * w, v, r * h), u, v, w, h, t);
  }
}
const X = [1, 0, 0], NX = [-1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1], NZ = [0, 0, -1];
/** Box with base at y0; f = { front, back, left, right, top } tiles (or a single tile). */
function abox(g, cx, y0, cz, sx, sy, sz, f, cw = 2, ch = cw) {
  const F = typeof f === 'object' ? f : { front: f, back: f, left: f, right: f, top: f };
  const hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
  if (F.front != null) cells(g, [cx - hx, y0, cz + hz], X, Y, sx, sy, cw, ch, F.front);
  if (F.back != null) cells(g, [cx + hx, y0, cz - hz], NX, Y, sx, sy, cw, ch, F.back);
  if (F.right != null) cells(g, [cx + hx, y0, cz + hz], NZ, Y, sz, sy, cw, ch, F.right);
  if (F.left != null) cells(g, [cx - hx, y0, cz - hz], Z, Y, sz, sy, cw, ch, F.left);
  if (F.top != null) cells(g, [cx - hx, y1, cz + hz], X, NZ, sx, sz, cw, cw, F.top);
}
const pick = (list) => (c, r) => list[r][c % list[r].length];

// ---- building variants. Local frame: front faces +Z at z = 0, body extends to -Z.
function awning(g, x0, x1, y, depth = 1.5) {
  const drop = 0.55, len = Math.hypot(drop, depth), v = [0, drop / len, -depth / len];
  for (let x = x0; x < x1 - 1e-3; x += 2) {
    const w = Math.min(2, x1 - x);
    rect(g, [x, y - drop, depth], X, v, w, len, T.AWNING);
    rect(g, [x, y - drop - 0.45, depth], X, Y, w, 0.45, T.AWNING);
  }
}
function sign(g, x0, x1, y0, h) { cells(g, [x0, y0, 0.06], X, Y, x1 - x0, h, 2, h, T.SIGN); }

function buildingA() { // two storeys, plaster, shopfront with awning
  const g = new GeoBuilder(), W = 10, H = 7, D = 8;
  abox(g, 0, 0, -D / 2, W, H, D, {
    front: pick([[T.BOARDED, T.PLASTER, T.DOOR, T.PLASTER, T.BOARDED], [T.WINDOW, T.PLASTER, T.BOARDED, T.PLASTER, T.WINDOW]]),
    back: T.PLASTER, left: T.PLASTER, right: T.PLASTER, top: T.ROOF,
  }, 2, 3.5);
  abox(g, 0, H, -0.15, W, 0.5, 0.3, { front: T.PLASTER, back: T.PLASTER, left: T.PLASTER, right: T.PLASTER, top: T.ROOF }, 2.5, 0.5);
  awning(g, -4.5, 4.5, 3.3);
  sign(g, -3, 3, 3.55, 0.8);
  return g.build();
}
function buildingB() { // single-storey brick shop, parapet, boarded shopfront
  const g = new GeoBuilder(), W = 9, D = 7;
  abox(g, 0, 0, -D / 2, W, 3.2, D, { front: pick([[T.BOARDED, T.BOARDED, T.DOOR, T.BRICK]]), back: T.BRICK, left: T.BRICK, right: T.BRICK }, 2.25, 3.2);
  abox(g, 0, 3.2, -D / 2, W, 1.5, D, { front: T.BRICK, back: T.BRICK, left: T.BRICK, right: T.BRICK, top: T.ROOF }, 2.25, 1.5);
  sign(g, -3.5, 2.5, 3.35, 1.1);
  return g.build();
}
function buildingC() { // narrow three-storey block
  const g = new GeoBuilder(), W = 7, H = 10.5, D = 7;
  abox(g, 0, 0, -D / 2, W, H, D, {
    front: pick([[T.BOARDED, T.DOOR, T.WINDOW], [T.WINDOW, T.BOARDED, T.WINDOW], [T.BOARDED, T.WINDOW, T.WINDOW]]),
    back: T.PLASTER, left: T.PLASTER, right: T.PLASTER, top: T.ROOF,
  }, 7 / 3, 3.5);
  awning(g, -1.25, 1.25, 3.1, 1.1);
  return g.build();
}
function car() { // abandoned car, length along local X
  const g = new GeoBuilder();
  abox(g, 0, 0.3, 0, 4.2, 0.75, 1.8, T.CARBODY, 2.1, 0.75);
  abox(g, -0.2, 1.05, 0, 2.2, 0.62, 1.6, { front: T.CARGLASS, back: T.CARGLASS, left: T.CARGLASS, right: T.CARGLASS, top: T.CARBODY }, 1.1, 0.62);
  for (const [x, z] of [[-1.3, 0.85], [1.3, 0.85], [-1.3, -0.85], [1.3, -0.85]]) abox(g, x, 0, z, 0.7, 0.62, 0.26, T.ROOF, 0.7, 0.62);
  return g.build();
}

/** One street segment, z in [-SEG, 0]: road, curbs, sidewalks, lots, a lamp (left) and a telephone pole + wires (right). */
function segment() {
  const g = new GeoBuilder(), rows = SEG / 2;
  for (let r = 0; r < rows; r++) {
    const z = -r * 2;
    for (let c = 0; c < 4; c++) {
      const t = c === 1 || c === 2 ? T.ROADLINE : T.ROAD;
      rect(g, [-ROAD + c * 2, 0, z], X, NZ, 2, 2, t, c === 2);
    }
    rect(g, [ROAD, 0.15, z], X, NZ, WALK - ROAD, 2, T.SIDEWALK);
    rect(g, [-WALK, 0.15, z], X, NZ, WALK - ROAD, 2, T.SIDEWALK);
    rect(g, [ROAD, 0, z - 2], Z, Y, 2, 0.15, T.CURB);
    rect(g, [-ROAD, 0, z], NZ, Y, 2, 0.15, T.CURB);
  }
  cells(g, [WALK, 0.05, 0], X, NZ, 16, SEG, 4, 3, T.DIRT);
  cells(g, [-WALK - 16, 0.05, 0], X, NZ, 16, SEG, 4, 3, T.DIRT);
  // street lamp, left side, arm over the road
  const lx = -ROAD - 0.6, lz = -2;
  abox(g, lx, 0.15, lz, 0.16, 4.9, 0.16, T.ROOF, 0.16, 2.45);
  abox(g, lx + 0.55, 4.95, lz, 1.1, 0.1, 0.1, T.ROOF, 1.1, 0.1);
  abox(g, lx + 1.1, 4.75, lz, 0.45, 0.22, 0.35, T.CURB, 0.45, 0.22);
  // telephone pole, right side, wires sagging to the next segment's pole
  const px = ROAD + 0.7, pz = -7;
  abox(g, px, 0.15, pz, 0.26, 8, 0.26, T.POLE, 0.26, 2);
  abox(g, px, 7.5, pz, 2.4, 0.14, 0.14, T.POLE, 2.4, 0.14);
  for (const wx of [-1, 1]) {
    const a = [px + wx, 7.62, pz], m = [px + wx, 7.0, pz - SEG / 2], b = [px + wx, 7.62, pz - SEG];
    for (const [p, q] of [[a, m], [m, b]]) {
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(...d);
      rect(g, p, d.map((v) => v / L), Y, L, 0.05, T.ROOF);
    }
  }
  return g.build();
}
const LAMP_HEAD = [-ROAD - 0.6 + 1.1, 4.66, -2];

export class AshfallTown {
  static meta = { name: 'Ashfall Town' };
  static palette = fromKeys('ashfall-town', 'Ashfall Town', ['#7d7b77', '#8a5634', '#c42a1c', '#8e908c']);

  init(r) {
    this.r = r;
    this.atlas = buildAtlas();
    this.atlasTex = r.texture(this.atlas);
    this.rustQ = 0;

    this.segMesh = r.createMesh(segment());
    this.bMesh = [buildingA(), buildingB(), buildingC()].map((g) => r.createMesh(g));
    this.carMesh = r.createMesh(car());
    this.fenceMesh = r.createMesh(K.props.fence(11, 2.2, 2.75));
    this.fenceTex = r.texture(K.sprites.chainLink({ index: R(0, 2), dark: R(0, 1) }));
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.pool = r.createMesh(new GeoBuilder().quad([-1, 0, 1], [1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1], [1, 1], [1, 0], [0, 0], [0, 1, 0]).build());
    this.paleTex = r.texture(K.sprites.glow({ ramp: 3 }));
    this.redTex = r.texture(K.sprites.glow({ ramp: 2 }));

    this.segInst = r.createInstances(MAXSEG);
    this.bInst = this.bMesh.map(() => r.createInstances(MAXSEG * 2));
    this.carInst = r.createInstances(MAXSEG);
    this.fenceInst = r.createInstances(MAXSEG * 2);
    this.paleInst = r.createInstances(MAXSEG);
    this.redInst = r.createInstances(MAXSEG);
    this.poolInst = r.createInstances(MAXSEG);

    // walk: slow drift across the street, step bob tied to distance walked
    this.cam = new K.PathRig((s, o) => {
      o[0] = 0.2 + Math.sin(s * 0.045) * 0.9; o[1] = 1.65 + Math.abs(Math.sin(s * 1.6)) * 0.05; o[2] = -s;
      return o;
    }, { lookAhead: 9, idleSpeed: 1.1, activeSpeed: 2.6, bassBoost: 1.2, nudge: 0.22, rollKick: 0.04, fovPunch: 4, fov: 62, far: 80 });

    this.ash = new K.Particles(r, 'ash', { count: 900, area: [26, 14, 26] });
    this.siren = new K.Envelope(0.38);
    this.time = 0; this.k = 0; this.a = null; this.rust = 0; this.tremor = 0;
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], emis: [0, 0, 0], tmp: [0, 0, 0], pale: [0, 0, 0], red: [0, 0, 0], lamp: [0, 0, 0], focus: [0, 0, 0] };
    this.lights = new K.LightSet({ reach: 8 });
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt; this.dt = dt;
    const d = K.drive(a, k);
    this.cam.update(a, k, dt);
    // ground tremor from the bass (offsets only; the rig recomputes eye each frame)
    const t = this.time, tr = d.bass * 0.05;
    const ty = (Math.sin(t * 47) + Math.sin(t * 31.7)) * 0.5 * tr, tx = Math.sin(t * 39.3) * tr * 0.5;
    this.cam.eye[0] += tx; this.cam.eye[1] += ty; this.cam.target[1] += ty * 0.6;

    if (d.beat) this.siren.trigger(k);
    this.siren.update(dt);

    const eye = this.cam.eye;
    this.ash.update(dt, eye, { amount: K.swell(k, 0.3, 1), speed: 1 + k * 0.4 + d.bass * 2.5, wind: [0.15 + d.level * 0.8, -0.1] });

    // the town rusts over: dither-dissolve the rusted atlas in
    this.rust = damp(this.rust, K.stage(k, 0.12, 0.95), 0.8, dt);
    const q = Math.round(this.rust * 160);
    if (q !== this.rustQ) { this.rustQ = q; this._composeRust((q / 160) * 0.92); }

    this._place();
  }

  /** Rebuild the atlas: rust where its threshold is under `level`, upload in place. */
  _composeRust(level) {
    const A = this.atlas, out = A.data, n = out.length;
    for (let i = 0; i < n; i++) out[i] = A.thr[i] < level ? A.rust[i] : A.base[i];
    this.r.updateTexture(this.atlasTex, A);
  }

  /** Deterministic street contents for the segments around the camera. */
  _place() {
    const s = this.cam.s, i0 = Math.max(0, Math.floor(s / SEG) - 1), i1 = Math.floor((s + AHEAD) / SEG);
    const nb = [0, 0, 0];
    let ns = 0, nc = 0, nf = 0;
    for (let i = i0; i <= i1 && ns < MAXSEG; i++) {
      const z0 = -i * SEG;
      this.segInst.set(ns++, 0, 0, z0, 1, 0, 1, 0, 1);
      for (const side of [-1, 1]) {
        const h = K.rand2(i, side, 11), zc = z0 - SEG / 2 + (K.rand2(i, side, 12) - 0.5) * 1.2;
        const rot = side < 0 ? Math.PI / 2 : -Math.PI / 2, x = side * (WALK + 0.1);
        const v = h < 0.3 ? 0 : h < 0.56 ? 1 : h < 0.82 ? 2 : -1;
        if (v >= 0) this.bInst[v].set(nb[v]++, x, 0, zc, 1, rot, 0.82 + K.rand2(i, side, 13) * 0.3, 0, 0.92 + K.rand2(i, side, 14) * 0.2);
        else this.fenceInst.set(nf++, x + side * 0.3, 0.15, zc, 1, Math.PI / 2, 0.9, 0, 1);
      }
      if (K.rand2(i, 0, 21) < 0.38) {
        const side = K.rand2(i, 1, 22) < 0.5 ? -1 : 1;
        this.carInst.set(nc++, side * 2.9, 0, z0 - 3 - K.rand2(i, 2, 23) * 6, 1, Math.PI / 2 + (K.rand2(i, 3, 24) - 0.5) * 0.3, 0.8 + K.rand2(i, 4, 25) * 0.3, 0, 1);
      }
    }
    this.segInst.upload(ns); this.carInst.upload(nc); this.fenceInst.upload(nf);
    this.bInst.forEach((b, v) => b.upload(nb[v]));
    this.segRange = [i0, i0 + ns - 1];
  }

  render(r) {
    const { col, k } = this, P = this.pal, d = K.drive(this.a, k), t = this.time;
    const red = K.stage(k, 0.3, 1), siren = this.siren.v;
    const dim = lerp(0.78, 1, k);

    // grey dusk fog, turning sickly red with the swell, siren-red on beats
    scaleColor(col.fog, P.role('fog'), dim * (1 - red * 0.3));
    mixColor(col.fog, col.fog, P.color(R(2, 1)), red * 0.42);
    mixColor(col.fog, col.fog, P.role('flash'), siren * 0.22);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 1.5, lerp(30, 23, k));

    mixColor(col.light, P.role('light'), P.color(R(2, 2)), red * 0.75);
    scaleColor(col.light, col.light, lerp(0.45, 0.7, k) + siren * 0.35);
    mixColor(col.amb, P.role('ambient'), P.color(R(2, 1)), red * 0.45);
    scaleColor(col.amb, col.amb, lerp(0.48, 0.42, k));
    r.setLight([-0.3, -0.8, 0.45], col.light, col.amb);
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    scaleColor(col.emis, P.role('flash'), siren * 0.1);

    // lamp light on the street, sidewalks and shop fronts
    const [i0, i1] = this.segRange, L = this.lights, eye = this.cam.eye;
    mixColor(col.lamp, P.color(R(3, 3)), P.color(R(2, 2)), red * 0.85);
    scaleColor(col.lamp, col.lamp, 4 + siren * 1.5);
    L.begin();
    for (let i = i0; i <= i1; i++) L.add(i, LAMP_HEAD[0], LAMP_HEAD[1] - 0.4, -i * SEG + LAMP_HEAD[2], col.lamp, 10, this._lampB(i, t, d, k));
    col.focus[0] = 0; col.focus[1] = 1.6; col.focus[2] = eye[2] - 9;
    L.apply(r, col.focus, this.dt || 1 / 60);

    const solid = { texture: this.atlasTex, tint: col.tint, emissive: col.emis };
    r.drawInstanced(this.segMesh, this.segInst, solid);
    this.bMesh.forEach((m, v) => r.drawInstanced(m, this.bInst[v], solid));
    r.drawInstanced(this.carMesh, this.carInst, solid);
    r.drawInstanced(this.fenceMesh, this.fenceInst, { texture: this.fenceTex, tint: col.tint, emissive: col.emis });
    this.ash.draw(r, { brightness: dim * 0.85 });

    // lamps: dim at idle, brighter when playing, flickering with the highs; red takes over with the swell
    let n = 0;
    for (let i = i0; i <= i1; i++, n++) {
      const z = -i * SEG + LAMP_HEAD[2];
      const b = this._lampB(i, t, d, k);
      this.paleInst.set(n, LAMP_HEAD[0], LAMP_HEAD[1], z, 1.5 + d.pulse * 0.4, 0, b * (1 - red * 0.85), 0, 1);
      this.redInst.set(n, LAMP_HEAD[0], LAMP_HEAD[1], z, 1.7 + siren * 0.6, 0, b * red * (1.4 + siren * 0.8) + siren * 0.35 * k, 0, 1);
      this.poolInst.set(n, LAMP_HEAD[0] - 0.3, 0.2, z, 2.2, 0, b * 0.35, 0, 1);
    }
    this.paleInst.upload(n); this.redInst.upload(n); this.poolInst.upload(n);
    r.drawInstanced(this.pool, this.poolInst, { texture: this.paleTex, unlit: true, additive: true });
    r.drawInstanced(this.quad, this.paleInst, { texture: this.paleTex, billboard: 2, unlit: true, additive: true });
    r.drawInstanced(this.quad, this.redInst, { texture: this.redTex, billboard: 2, unlit: true, additive: true });
  }

  /** Lamp i brightness: dim at idle, brighter when playing; some are failing; highs flicker them. */
  _lampB(i, t, d, k) {
    const fl = (0.5 + 0.5 * Math.sin(t * 37 + i * 5.1)) * (0.5 + 0.5 * Math.sin(t * 23.3 + i * 2.7));
    const dead = K.rand2(i, 9, 31) < 0.2 ? 0.35 : 1; // some lamps are failing
    return lerp(0.35, 0.9, k) * dead * (1 - d.high * 0.85 * fl) * (0.93 + 0.07 * Math.sin(t * 1.3 + i));
  }

  dispose(r) {
    [this.segMesh, ...this.bMesh, this.carMesh, this.fenceMesh, this.quad, this.pool].forEach((m) => m.dispose());
    [this.atlasTex, this.fenceTex, this.paleTex, this.redTex].forEach((tx) => r.deleteTexture(tx));
    [this.segInst, ...this.bInst, this.carInst, this.fenceInst, this.paleInst, this.redInst, this.poolInst].forEach((i) => i.dispose());
    this.ash.dispose(r);
  }
}
