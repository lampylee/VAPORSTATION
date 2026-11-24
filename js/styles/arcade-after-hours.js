// ARCADE AFTER HOURS — a 90s mall arcade at closing time. Original cabinet
// shapes, made-up marquee titles, abstract attract-mode screens; recreates no
// real cabinet, game, brand or logo.
//
//   endless aisles of cabinets (recycled segments)     K.forSegments, instanced bodies / screens / marquees
//   attract-mode screens, 4 abstract patterns          one indexed atlas, r.updateTexture (screen band only)
//   confetti carpet that glows under blacklight        draw { texture2, blend } dither-crossfade
//   light-up dance floor with chasing tile patterns    r.updateTexture, per-tile damped levels
//   neon ceiling tubes + halos through the fog         instanced unlit tubes, additive glows with draw fade
//   prize counter, plush shelf, neon signs             K.Frame / K.xf merged meshes, K.NeonText
//   screen light pools on the carpet                   K.decal + additive glow sprite
//
// Intensity: idle = hall lights off, attract screens dimly cycling, a few
// night tubes. Swell = cabinets power on row by row, ceiling neon flickers to
// life, carpet goes blacklight, dance floor starts chasing.
// Reactions: beat = tile pattern steps + screen flash + camera nudge;
// bass = tile brightness + camera bob; highs = screen sparkle / flicker.
// Light (Kit v7): screen glow down each aisle, the centre ceiling tubes and the dance floors are
// point lights (K.LightSet, best 4 ahead): colour spills onto cabinets, carpet, counter and ceiling.
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { GeoBuilder, box, merge } from '../gfx/geometry.js';
import { solid } from '../gfx/textures.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const SEG = 3;              // segment length along the aisle (3 cabinets per row)
const PERIOD = 12;          // segments per block: 8 cabinet segments (one cross aisle) + 4 open area
const OPEN0 = 8;            // first open-area segment in a block
const AHEAD = 42, BEHIND = 6;
const INNER_X = 1.9, OUTER_X = 5.6, WALL_X = 6.4, CEIL_Y = 4.2, TUBE_Y = 4.0;
const SW = 32, SH = 24;     // one attract screen in the atlas
const AW = 128, AH = 96;    // lit atlas: 4 screens on top, 4 marquees below
const MQ_Y = 24, MQ_H = 18; // marquee rows
const TILES = 8, TPX = 8, TILE_SIZE = 1.1;
const TITLES = ['ZAPWAVE', 'MOONKITE', 'HEX RUN', 'COMETPOP']; // made-up cabinet titles
const MAXCAB = 160;

// ---------------------------------------------------------------- textures

/** Confetti carpet; lit = blacklight version (same shapes, glowing shades). */
function carpet(lit) {
  const shapeAt = (x, y) => {
    const cx = x >> 4, cy = y >> 4, h = K.rnd(cx, cy, 11), ox = (cx << 4) + 8 + (K.rnd(cx, cy, 12) - 0.5) * 4, oy = (cy << 4) + 8 + (K.rnd(cx, cy, 13) - 0.5) * 4;
    const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy);
    if (h < 0.3) return Math.abs(d - 3.6) < 0.8 ? 1 : 0;                                       // ring
    if (h < 0.55) return (dy > -3 && dy < 3 && Math.abs(dx) < (dy + 3) * 0.6) ? 2 : 0;         // triangle
    if (h < 0.8) return (Math.abs(dx) < 5 && Math.abs(dy - Math.sin(dx * 1.1) * 2) < 0.8) ? 3 : 0; // squiggle
    return d < 1.6 ? 4 : 0;                                                                     // dot
  };
  return K.makeIndexed(64, 64, (x, y) => {
    const s = shapeAt(x, y);
    if (!s) return lit ? K.dshade(0, 0.2 + K.blobNoise(x, y, 6, 3) * 0.7, x, y) : K.dshade(0, 0.6 + K.blobNoise(x, y, 6, 3) * 0.9, x, y);
    if (lit) return [0, R(2, 3), R(1, 3), R(2, 2), R(1, 2)][s];
    return [0, R(2, 1), R(1, 1), R(2, 0), R(1, 1)][s];
  });
}

const ceilingTex = () => K.makeIndexed(32, 32, (x, y) => (x % 16 === 0 || y % 16 === 0) ? R(0, 0) : K.dshade(3, 0.4 + K.rnd(x, y, 4) * 0.5, x, y));

/** Hall wall: dark panels, a chrome rail and a pink stripe. */
const wallTex = () => K.makeIndexed(32, 32, (x, y) => {
  if (y === 13 || y === 14) return R(1, 2);
  if (y === 16) return R(2, 1);
  if (x % 16 === 0) return R(0, 0);
  return K.dshade(0, y < 13 ? 0.4 : 0.8 + K.blobNoise(x, y, 5, 2) * 0.4, x, y);
});

/** Cabinet body: dark paint, chrome T-molding edges, an abstract swoosh. */
const cabTex = () => K.makeIndexed(32, 64, (x, y) => {
  if (x === 0 || x === 31) return R(1, 1);
  if (x === 1 || x === 30) return R(1, 3);
  const sw = (y - 40) - (x - 16) * 0.8;
  if (Math.abs(sw) < 2.5) return R(1, 2);
  if (Math.abs(sw + 5) < 1) return R(2, 1);
  if (y < 30 && K.rnd(x, y, 5) < 0.025) return R(2, 2);
  return K.dshade(0, 0.5 + K.blobNoise(x, y, 8, 2) * 0.7, x, y);
});

/** Prize counter front: chrome top, glass case with prizes, kick plate. */
const counterTex = () => K.makeIndexed(64, 32, (x, y) => {
  if (y < 4) return K.dshade(1, 3 - y * 0.4, x, y);
  if (y >= 28) return R(0, 0);
  if (((x - y * 0.5) % 20 + 20) % 20 < 1) return R(1, 2); // glass glint
  for (const [cy, row] of [[11, 0], [21, 1]]) {
    const col = Math.floor(x / 8), cx = col * 8 + 4, d = Math.hypot(x - cx, y - cy);
    if (d < 3.2) return K.dshade([2, 1, 0][(col + row) % 3], 3 - d * 0.5, x, y);
  }
  return R(3, 0);
});

/** Plush shelf behind the counter: pegboard, shelves, round plush with ears. */
const shelfTex = () => K.makeIndexed(64, 64, (x, y) => {
  const row = y >> 4, ly = y & 15;
  if (ly >= 14) return R(1, ly === 14 ? 2 : 1);
  const col = x >> 4, lx = x & 15, ramp = [2, 1, 0, 2, 1][(col + row * 2) % 5];
  const body = Math.hypot(lx - 8, ly - 9), earL = Math.hypot(lx - 4.5, ly - 4), earR = Math.hypot(lx - 11.5, ly - 4);
  if ((lx === 6 || lx === 10) && ly === 8) return R(3, 0);
  if (body < 5) return K.dshade(ramp, 2.8 - body * 0.3, x, y);
  if (earL < 2 || earR < 2) return K.dshade(ramp, 1.6, x, y);
  return (x % 4 === 0 && y % 4 === 0) ? R(0, 1) : R(0, 0);
});

/** 4x1 swatches for joysticks / buttons: accent, chrome, black, bright accent. */
const swatchTex = () => K.makeIndexed(4, 1, (x) => [R(2, 2), R(1, 3), R(0, 0), R(2, 3)][x]);

// ---------------------------------------------------------------- geometry

const darker = (i) => (i % 4 > 0 ? i - 1 : i);

/** Quad facing +z from (x0, y0) to (x1, y1) at depth z, mapped to atlas pixel rect. */
function atlasQuad(x0, y0, x1, y1, z, [px0, py0, px1, py1], W, H) {
  const u0 = px0 / W, u1 = px1 / W, v0 = py0 / H, v1 = py1 / H;
  return new GeoBuilder().quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [u0, v1], [u1, v1], [u1, v0], [u0, v0], [0, 0, 1]).build();
}

/** Horizontal grid (floor / ceiling) with world-space UVs (period `uv`). */
function gridXZ(x0, x1, z0, z1, y, cell, uv, down = false) {
  const g = new GeoBuilder(), nx = Math.round((x1 - x0) / cell), nz = Math.round((z1 - z0) / cell), n = [0, down ? -1 : 1, 0];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = x0 + i * cell, b = a + cell, c = z0 + j * cell, d = c + cell, T = (x, z) => [x / uv, z / uv];
    if (down) g.quad([a, y, c], [b, y, c], [b, y, d], [a, y, d], T(a, c), T(b, c), T(b, d), T(a, d), n);
    else g.quad([a, y, d], [b, y, d], [b, y, c], [a, y, c], T(a, d), T(b, d), T(b, c), T(a, c), n);
  }
  return g.build();
}

/** Vertical wall at x, spanning z0..z1, facing `face` (+1 / -1 along x). */
function wallZY(x, z0, z1, h, cell, uv, face) {
  const g = new GeoBuilder(), nz = Math.round((z1 - z0) / cell), ny = Math.max(1, Math.round(h / cell)), n = [face, 0, 0];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nz; i++) {
    const a = z0 + i * cell, b = a + cell, c = (j * h) / ny, d = ((j + 1) * h) / ny;
    K.quadFacing(g, [x, c, a], [x, c, b], [x, d, b], [x, d, a], [a / uv, 1 - c / uv], [b / uv, 1 - c / uv], [b / uv, 1 - d / uv], [a / uv, 1 - d / uv], n);
  }
  return g.build();
}

/** Original upright cabinet, front facing +z, pivot at the base centre. detail = control panel. */
function cabinetGeo(detail) {
  const W = 0.9, parts = [], f = new K.Frame();
  f.add(parts, box(W, 1.05, 0.75), { pos: [0, 0.525, 0] });
  f.add(parts, box(W, 0.95, 0.5), { pos: [0, 1.525, -0.125] });
  f.add(parts, box(W + 0.04, 0.3, 0.62), { pos: [0, 2.15, -0.06] });
  f.add(parts, box(W - 0.1, 0.06, 0.4), { pos: [0, 2.32, -0.1] });           // marquee lip
  if (detail) f.add(parts, box(W + 0.02, 0.1, 0.38), { pos: [0, 1.1, 0.44], rot: [0.25, 0, 0] });
  return merge(parts);
}

/** Joystick + buttons (swatch texture) on the control panel. */
function controlsGeo() {
  const parts = [], f = new K.Frame([0, 1.1, 0.44], { rx: 0.25 });
  const sw = (g, i) => K.atlasUV(g, [i / 4 + 0.05, 0, (i + 1) / 4 - 0.05, 1]);
  f.add(parts, sw(K.props.prism(4, 0.02, 0.13, { cap: false }), 2), { pos: [-0.24, 0.05, 0] });
  f.add(parts, sw(K.props.prism(5, 0.045, 0.07, { taper: 0.5 }), 0), { pos: [-0.24, 0.17, 0] });
  [[0.02, 0], [0.15, 1], [0.28, 0]].forEach(([x, c], i) => f.add(parts, sw(box(0.07, 0.03, 0.07), c === 1 ? 3 : 0), { pos: [x, 0.065, i * 0.02 - 0.03] }));
  return merge(parts);
}

// ---------------------------------------------------------------- screens

/** Attract-mode pattern p at pixel (x, y): palette index. eq = 8 bar heights. */
function pattern(p, x, y, t, eq) {
  if (p === 0) { // tunnel rings
    const cx = 16 + Math.sin(t * 0.7) * 4, cy = 12 + Math.cos(t * 0.9) * 3, dx = x - cx, dy = (y - cy) * 1.2;
    const v = Math.hypot(dx, dy) * 0.45 - t * 4 + Math.sin(Math.atan2(dy, dx) * 3 + t) * 0.8, band = ((v % 4) + 4) % 4;
    return band < 1.4 ? K.dshade(2, 1 + band * 1.4, x, y) : band < 2.2 ? K.dshade(1, 0.6 + (band - 1.4) * 2, x, y) : R(3, 0);
  }
  if (p === 1) { // sun over a scrolling grid horizon
    if (y < 11) {
      const d = Math.hypot(x - 16, y - 8);
      if (d < 6 && !(y > 6 && y % 3 === 0)) return K.dshade(2, 3.2 - (y - 2) * 0.22, x, y);
      return K.dshade(3, 0.2 + (y / 11) * 0.8, x, y);
    }
    const z = 1 / (y - 10.4), gz = (z * 6 + t * 1.5) % 1, gx = Math.abs(((x - 16) * z * 0.9) % 1);
    return gz < 0.18 || gx < 0.14 ? K.dshade(1, 3.2 - z * 1.5, x, y) : R(0, 0);
  }
  if (p === 2) { // plasma
    const v = Math.sin(x * 0.3 + t) + Math.sin(y * 0.4 - t * 1.3) + Math.sin((x + y) * 0.2 + t * 0.7) + Math.sin(Math.hypot(x - 16, y - 12) * 0.35 - t * 2);
    return K.dshade(v > 0 ? 2 : 1, ((v + 4) / 8) * 3.2, x, y);
  }
  // equalizer bars
  const b = x >> 2, h = (0.12 + eq[b] * 0.85) * 22, yb = 23 - y;
  if ((x & 3) === 3 || y < 1) return R(3, 0);
  if (yb < h) return yb > h - 1.2 ? R(1, 3) : K.dshade(2, 0.8 + (yb / 22) * 2.4, x, y);
  return R(3, 0);
}

// ---------------------------------------------------------------- style

export class ArcadeAfterHours {
  static meta = { name: 'Arcade After Hours' };
  static palette = fromKeys('arcade-after-hours', 'Arcade After Hours', ['#5a2a7a', '#3fb8c4', '#ff4fa3', '#0a0710'], { glow: R(2, 2), flash: R(2, 3) });

  init(r) {
    this.r = r;
    // ---- hall shell (planes follow the camera, snapped to their texture period)
    this.floorMesh = r.createMesh(gridXZ(-WALL_X, WALL_X, -52, 8, 0, 2, 4));
    this.ceilMesh = r.createMesh(gridXZ(-WALL_X, WALL_X, -52, 8, CEIL_Y, 2, 4, true));
    this.wallL = r.createMesh(wallZY(-WALL_X, -52, 8, CEIL_Y, 2.1, 4.2, 1));
    this.wallR = r.createMesh(wallZY(WALL_X, -52, 8, CEIL_Y, 2.1, 4.2, -1));
    this.carpetTex = r.texture(carpet(false));
    this.carpetLit = r.texture(carpet(true));
    this.ceilTex = r.texture(ceilingTex());
    this.wallTex = r.texture(wallTex());

    // ---- cabinets
    this.cabMesh = r.createMesh(cabinetGeo(true));
    this.cabLod = r.createMesh(cabinetGeo(false));
    this.ctrlMesh = r.createMesh(controlsGeo());
    this.cabTex = r.texture(cabTex());
    this.swatch = r.texture(swatchTex());
    this.cabInst = r.createInstances(MAXCAB);
    this.lodInst = r.createInstances(MAXCAB);
    this.ctrlInst = r.createInstances(MAXCAB);

    // lit atlas: 4 animated screens (rows 0..23) + 4 marquee titles below
    this.atlas = K.makeIndexed(AW, AH, () => R(3, 0));
    TITLES.forEach((name, v) => {
      const ramp = v % 2 ? 1 : 2, txt = K.textTexture(name.padEnd(8, ' ').slice(0, 8), { scale: 2, core: R(ramp, 3), mid: R(ramp, 2), outline: R(ramp, 0), bg: R(0, 0) });
      const ox = (AW - txt.width) >> 1, oy = MQ_Y + v * MQ_H;
      for (let y = 0; y < MQ_H; y++) for (let x = 0; x < AW; x++) {
        const tx = x - ox, ty = y;
        this.atlas.data[(oy + y) * AW + x] = (tx >= 0 && tx < txt.width && ty < txt.height) ? txt.data[ty * txt.width + tx] : (y === 0 || y === MQ_H - 1 ? R(2, 0) : R(0, 0));
      }
    });
    this.atlasTex = r.texture(this.atlas);
    this.screenMesh = []; this.marqMesh = []; this.screenInst = []; this.marqInst = [];
    for (let v = 0; v < 4; v++) {
      this.screenMesh.push(r.createMesh(atlasQuad(-0.34, 1.27, 0.34, 1.8, 0.135, [v * SW + 0.5, 0.5, (v + 1) * SW - 0.5, SH - 0.5], AW, AH)));
      this.marqMesh.push(r.createMesh(atlasQuad(-0.43, 2.03, 0.43, 2.27, 0.256, [12, MQ_Y + v * MQ_H + 0.5, AW - 12, MQ_Y + (v + 1) * MQ_H - 0.5], AW, AH)));
      this.screenInst.push(r.createInstances(MAXCAB)); this.marqInst.push(r.createInstances(MAXCAB));
    }
    this.eq = new Float32Array(8);
    this.screenClock = 0; this.screenFrame = 0;

    // screen light pools on the carpet
    this.poolMesh = r.createMesh(K.decal(1.3, 1.6, 0.03));
    this.poolTex = r.texture(K.sprites.glow({ ramp: 1 }));
    this.poolInst = r.createInstances(MAXCAB);

    // ---- ceiling neon
    this.tubeLong = r.createMesh(box(0.09, 0.09, 2.4));
    this.tubeCross = r.createMesh(box(8.6, 0.07, 0.07));
    this.tubePink = r.texture(solid(R(2, 3)));
    this.tubeTeal = r.texture(solid(R(1, 3)));
    this.longInst = r.createInstances(64);
    this.crossInst = r.createInstances(32);
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.glowInst = r.createInstances(96);

    // ---- open area: dance floor + prize counter + signs
    const dg = new GeoBuilder(), hs = (TILES * TILE_SIZE) / 2;
    for (let j = 0; j < TILES; j++) for (let i = 0; i < TILES; i++) {
      const a = -hs + i * TILE_SIZE, b = a + TILE_SIZE, c = -hs + j * TILE_SIZE, d = c + TILE_SIZE;
      dg.quad([a, 0.04, d], [b, 0.04, d], [b, 0.04, c], [a, 0.04, c], [i / TILES, (j + 1) / TILES], [(i + 1) / TILES, (j + 1) / TILES], [(i + 1) / TILES, j / TILES], [i / TILES, j / TILES], [0, 1, 0]);
    }
    this.danceMesh = r.createMesh(dg.build());
    this.dance = K.makeIndexed(TILES * TPX, TILES * TPX, () => R(0, 1));
    this.danceTex = r.texture(this.dance);
    this.tileLevel = new Float32Array(TILES * TILES);
    this.step = 0; this.stepClock = 0; this.danceClock = 0;

    const cparts = [], cf = new K.Frame();
    cf.add(cparts, box(0.8, 1.0, 8, { uvRepeat: [6, 1] }), { pos: [0, 0.5, 0] });
    cf.add(cparts, box(0.9, 0.06, 8.1, { uvRepeat: [6, 0.1] }), { pos: [0, 1.03, 0] });
    this.counterMesh = r.createMesh(merge(cparts));
    this.counterTex = r.texture(counterTex());
    this.shelfMesh = r.createMesh(merge([{ geo: box(0.2, 2.6, 8, { uvRepeat: [4, 3] }), xf: K.xf({ pos: [0, 1.3, 0] }) }]));
    this.shelfTex = r.texture(shelfTex());
    this.signPrizes = new K.NeonText(r, 'PRIZES', { height: 0.55 });
    this.signDance = new K.NeonText(r, 'DANCE', { height: 0.7 });
    this.signTokens = new K.NeonText(r, 'TOKENS', { height: 0.45, core: R(1, 3), mid: R(1, 2), outline: R(1, 0) });

    // ---- camera: a slow dolly down the main aisle with a gentle weave
    this.cam = new K.PathRig((s, out) => { out[0] = Math.sin(s * 0.045) * 0.45; out[1] = 1.55; out[2] = -s; return out; },
      { lookAhead: 6, idleSpeed: 0.7, activeSpeed: 2.0, bassBoost: 1.2, fov: 62, nudge: 0.25, rollKick: 0.04, far: 60 });
    this.dust = new K.Particles(r, 'dust', { area: [14, 4, 20], count: 160 });

    this.flash = new K.Envelope(0.16);
    this.bob = 0; this.bobPhase = 0; this.bobS = 0;
    this.areas = [];
    this.m = mat4.create();
    this.time = 0; this.k = 0; this.a = null;
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], dance: [0, 0, 0], white: [1, 1, 1], glow: [0, 0, 0], lScr: [0, 0, 0], lTube: [0, 0, 0], lDance: [0, 0, 0], focus: [0, 0, 0] };
    this.lights = new K.LightSet({ reach: 6, cap: 96 }); this.cand = []; this.nCand = 0;
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt; this.dt = dt;
    const d = K.drive(a, k);
    this.cam.update(a, k, dt);
    // bass: a soft dip plus a footstep bob that grows with the beat
    // (bass drives the eye directly only at Punchy; at Gentle it is eased, 0.5 s)
    this.bobS = damp(this.bobS, d.bass, 0.5, dt);
    this.bob = damp(this.bob, lerp(this.bobS, d.bass, d.beatMotion), lerp(0.4, 0.15, d.beatMotion), dt);
    this.bobPhase += dt * (2.2 + this.cam.speed * 0.8);
    this.cam.eye[1] += -this.bob * 0.12 + Math.sin(this.bobPhase * 2) * (0.012 + this.bob * 0.05);
    this.cam.target[0] += Math.sin(this.time * 0.11) * 1.4; // glance at the cabinets now and then
    this.cam.target[1] -= 0.15;

    if (d.beat) { this.flash.trigger(k); this.step++; this.stepClock = 0; }
    this.flash.update(dt);
    // tiles also chase on their own once the band is going (so a quiet beat-less groove still moves)
    const chase = K.stage(k, 0.2, 0.65);
    this.stepClock += dt * chase * 2.5;
    if (this.stepClock > 1) { this.stepClock = 0; this.step++; }

    // equalizer screen: bars follow the bands when playing, wander gently at idle
    for (let b = 0; b < 8; b++) {
      const band = b < 3 ? a.bass : b < 6 ? a.mid : a.high, wander = 0.25 + 0.2 * Math.sin(this.time * (0.7 + b * 0.23) + b * 1.7);
      this.eq[b] = damp(this.eq[b], lerp(wander, clamp(band * 1.1 + Math.sin(this.time * 9 + b * 2.1) * 0.12), k), 0.08, dt);
    }
    this.screenClock += dt;
    if (this.screenClock > 1 / 20) { this.screenClock = 0; this.screenFrame++; this._drawScreens(d); }
    this.danceClock += dt;
    this._updateTiles(k, dt, chase);
    if (this.danceClock > 1 / 30) { this.danceClock = 0; this._drawTiles(); }

    this.dust.update(dt, this.cam.eye, { amount: K.swell(k, 0.35, 0.7), speed: 1 + d.energy * 0.5 });
    this._place(d, k);
  }

  /** Repaint the 4 attract screens (top band of the atlas only), cycling patterns. */
  _drawScreens(d) {
    const t = this.time, A = this.atlas.data, f = this.screenFrame, fl = this.flash.v, hi = d.high;
    for (let v = 0; v < 4; v++) {
      const tt = t + v * 3.1, cyc = tt / 8, cur = (v + Math.floor(cyc)) % 4, nxt = (cur + 1) % 4, tr = clamp(((cyc % 1) * 8 - 7.3) / 0.7);
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        let i;
        if (x === 0 || y === 0 || x === SW - 1 || y === SH - 1) i = R(3, 0);
        else {
          i = pattern(cur, x, y, tt, this.eq);
          if (tr > 0) i = K.ditherPick(i, pattern(nxt, x, y, tt, this.eq), tr, x, y);
          if (y % 3 === 2) i = darker(i);                                 // scanlines
          if (fl > K.bayer(x, y) + 0.15 && i % 4 < 3) i++;                 // beat flash
          if (K.rnd(x, y, f * 7 + v) < hi * 0.06) i = R(v % 2 ? 1 : 2, 3); // highs sparkle
        }
        A[y * AW + v * SW + x] = i;
      }
    }
    this.r.updateTexture(this.atlasTex, this.atlas, [0, SH]);
  }

  _updateTiles(k, dt, chase) {
    const s = this.step, mode = Math.floor(s / 8) % 4, t = this.time;
    for (let ty = 0; ty < TILES; ty++) for (let tx = 0; tx < TILES; tx++) {
      let on;
      if (mode === 0) on = (tx + ty + s) % 4 === 0;
      else if (mode === 1) on = (tx + ty + s) % 2 === 0;
      else if (mode === 2) on = Math.floor(Math.max(Math.abs(tx - 3.5), Math.abs(ty - 3.5))) === s % 4;
      else on = K.rand2(tx * 8 + ty, s, 9) > 0.55;
      const idle = 0.12 + 0.1 * Math.sin(t * 0.6 + tx * 0.7 + ty * 0.4); // slow faint breathing wave
      const i = ty * TILES + tx;
      this.tileLevel[i] = damp(this.tileLevel[i], idle + (on ? chase * 0.95 : 0), on ? 0.04 : 0.18, dt);
    }
  }

  _drawTiles() {
    const D = this.dance.data, W = TILES * TPX, mode = Math.floor(this.step / 8) % 4;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const tx = x >> 3, ty = y >> 3, lx = x & 7, ly = y & 7, L = this.tileLevel[ty * TILES + tx];
      let i;
      if (lx === 0 || ly === 0) i = R(3, 0);
      else {
        const ramp = (tx + ty + (mode & 1)) % 2 ? 2 : 1;
        const lit = (lx === 1 && ly === 1 && L > 0.5) ? R(ramp, 3) : K.dshade(ramp, 1 + L * 2.2, x, y);
        i = K.ditherPick(L > 0.1 ? R(0, 1) : R(0, 0), lit, clamp((L - 0.1) * 1.6), x, y);
      }
      D[y * W + x] = i;
    }
    this.r.updateTexture(this.danceTex, this.dance);
  }

  /** Deterministic hall contents for the segments around the camera. */
  _place(d, k) {
    const s = this.cam.s, t = this.time, fl = this.flash.v;
    const cnt = { cab: 0, lod: 0, scr: [0, 0, 0, 0], mq: [0, 0, 0, 0], pool: 0, long: 0, cross: 0, glow: 0 };
    this.areas.length = 0; this.nCand = 0;
    const cand = (id, x, y, z, kind, level) => {
      const c = this.cand[this.nCand] || (this.cand[this.nCand] = [0, 0, 0, 0, 0, 0]);
      c[0] = id; c[1] = x; c[2] = y; c[3] = z; c[4] = kind; c[5] = level; this.nCand++;
    };
    let ss = 0, sn = 0;
    const cab = (x, z, rot, lane, i, j, detail) => {
      const h = K.rand2(i * 3 + j, lane, 21), v = Math.floor(K.rand2(i * 3 + j, lane, 22) * 4) % 4;
      // cabinets power on row by row (inner rows first), staggered along each row
      const from = 0.04 + lane * 0.13 + h * 0.12, p = K.stage(k, from, from + 0.12);
      const flick = p < 0.98 ? (K.rand2(i * 3 + j, Math.floor(t * 12), 23) > 0.45 ? 1 : 0.35) : 1;
      const hiFlick = 1 - d.high * 0.3 * K.rand2(i * 3 + j, Math.floor(t * 20), 24);
      const scr = (0.42 + 0.12 * Math.sin(t * 0.8 + h * 6) + p * 0.55 * flick + fl * 0.45 * p) * hiFlick;
      if (detail) { this.cabInst.set(cnt.cab, x, 0, z, 1, rot, 1); this.ctrlInst.set(cnt.cab++, x, 0, z, 1, rot, 1); }
      else this.lodInst.set(cnt.lod++, x, 0, z, 1, rot, 1);
      this.screenInst[v].set(cnt.scr[v]++, x, 0, z, 1, rot, scr);
      this.marqInst[v].set(cnt.mq[v]++, x, 0, z, 1, rot, 0.05 + p * 0.95 * flick);
      if (detail) { ss += scr; sn++; }
      if (detail) this.poolInst.set(cnt.pool++, x + Math.sin(rot) * 1.0, 0, z + Math.cos(rot) * 1.0, 1, rot, (0.16 + p * 0.3 + fl * 0.2) * hiFlick);
    };
    let lastArea = null;
    K.forSegments(s, { length: SEG, ahead: AHEAD, behind: BEHIND }, (_, z0, i) => {
      const ty = ((i % PERIOD) + PERIOD) % PERIOD, open = ty >= OPEN0, cross = ty === 4;
      if (cnt.cab > MAXCAB - 8) return;
      ss = 0; sn = 0;
      for (let j = 0; j < 3; j++) {
        const z = -(z0 + 0.5 + j);
        if (!open && !cross) { cab(-INNER_X, z, Math.PI / 2, 0, i, j, true); cab(INNER_X, z, -Math.PI / 2, 1, i, j, true); }
        if (!open) cab(-OUTER_X, z, Math.PI / 2, 2, i, j, false);
        cab(OUTER_X, z, -Math.PI / 2, 3, i, j, false);
      }
      if (sn) cand(i * 4, 0, 1.4, -(z0 + SEG / 2), 0, (ss / sn) * 0.9);   // the screens either side of the aisle
      if (open) { const id = Math.floor((i - OPEN0) / PERIOD); if (id !== lastArea) { lastArea = id; this.areas.push(-((id * PERIOD + OPEN0) * SEG + 6)); } }
      // ceiling tubes: each segment flickers to life at its own point in the swell
      const zc = -(z0 + SEG / 2);
      [-3.9, 0, 3.9].forEach((x, n) => {
        const th = 0.08 + K.rand2(i, n, 31) * 0.5, on = K.stage(k, th, th + 0.14);
        const fl2 = on > 0.02 && on < 0.97 ? (K.rand2(i * 3 + n, Math.floor(t * 14), 32) > 0.5 ? 1 : 0.15) : 1;
        const night = n === 1 && ((i % 4) + 4) % 4 === 0 ? 0.35 : 0; // a few night lights stay on at idle
        const b = Math.max(night, on * fl2) * (1 + d.pulse * 0.25) * (1 - d.high * 0.15 * K.rand2(i, Math.floor(t * 24), n));
        this.longInst.set(cnt.long++, x, TUBE_Y, zc, 1, 0, 0.08 + b * 0.92);
        this.glowInst.set(cnt.glow++, x, TUBE_Y - 0.15, zc, 1.6 + lerp(d.groove, d.pulse, d.beatMotion) * 0.5, 0, b * 0.4);
        if (n === 1 && i % 2 === 0) cand(i * 4 + 1, 0, TUBE_Y - 0.5, zc, 1, b);
      });
      if (i % 2 === 0) {
        const th = 0.25 + K.rand2(i, 9, 33) * 0.45, on = K.stage(k, th, th + 0.12);
        const fl2 = on > 0.02 && on < 0.97 ? (K.rand2(i, Math.floor(t * 11), 34) > 0.5 ? 1 : 0.2) : 1;
        this.crossInst.set(cnt.cross++, 0, TUBE_Y + 0.08, -z0, 1, 0, 0.06 + on * fl2 * 0.94);
      }
    });
    this.cabInst.upload(cnt.cab); this.ctrlInst.upload(cnt.cab); this.lodInst.upload(cnt.lod); this.poolInst.upload(cnt.pool);
    for (let v = 0; v < 4; v++) { this.screenInst[v].upload(cnt.scr[v]); this.marqInst[v].upload(cnt.mq[v]); }
    this.longInst.upload(cnt.long); this.crossInst.upload(cnt.cross); this.glowInst.upload(cnt.glow);

    const stagger = (sign, from, span, idle) => sign.setAll((n, N) => Math.max(idle, K.stage(k, from + (n / N) * span, from + 0.06 + (n / N) * span)) * (0.9 + 0.1 * Math.sin(t * 15 + n * 2.3) - d.high * 0.15 * K.rand2(n, Math.floor(t * 18), 41)) + d.pulse * 0.4);
    stagger(this.signPrizes, 0.25, 0.2, 0.12);
    stagger(this.signDance, 0.4, 0.2, 0);
    stagger(this.signTokens, 0.5, 0.2, 0.06);
  }

  render(r) {
    const { col, k } = this, P = this.pal, d = K.drive(this.a, k);
    const dlv = (0.75 + d.bass * 0.7 + d.pulse * 0.2) * K.stage(k, 0.3, 0.8);
    const dim = lerp(0.62, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 3, lerp(22, 36, k));
    r.setLight([0.25, -1, 0.35], scaleColor(col.light, P.role('light'), lerp(0.18, 0.55, k)), scaleColor(col.amb, P.role('ambient'), lerp(0.42, 0.55, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    const m = this.m;
    // coloured light: screens (atmosphere-light), ceiling neon (accent), dance floors (secondary, on the bass)
    scaleColor(col.lScr, P.color(R(3, 3)), 1.1); scaleColor(col.lTube, P.color(R(2, 2)), 1.5); scaleColor(col.lDance, P.color(R(1, 3)), 2.2);
    const L = this.lights, eye = this.cam.eye, KC = [col.lScr, col.lTube], KR = [4.2, 5.5];
    L.begin();
    for (let i = 0; i < this.nCand; i++) { const c = this.cand[i]; L.add(c[0], c[1], c[2], c[3], KC[c[4]], KR[c[4]], c[5]); }
    this.areas.forEach((zc, i) => L.add(1e6 + Math.round(zc), 0.8, 0.8, zc, col.lDance, 8, dlv));
    col.focus[0] = 0; col.focus[1] = 1.6; col.focus[2] = eye[2] - 6;
    L.apply(r, col.focus, this.dt || 1 / 60);

    // hall shell
    const zf = Math.round(-this.cam.s / 4) * 4;
    mat4.trs(m, 0, 0, zf, 0, 0, 0);
    r.draw(this.floorMesh, m, { texture: this.carpetTex, texture2: this.carpetLit, blend: K.stage(k, 0.25, 0.85), tint: col.tint });
    r.draw(this.ceilMesh, m, { texture: this.ceilTex, tint: col.tint });
    r.draw(this.wallL, m, { texture: this.wallTex, tint: col.tint });
    r.draw(this.wallR, m, { texture: this.wallTex, tint: col.tint });

    // open areas: dance floor, prize counter, shelf
    const dl = dim * (0.75 + d.bass * 0.7 + d.pulse * 0.2);
    col.dance[0] = col.dance[1] = col.dance[2] = dl;
    for (const zc of this.areas) {
      r.draw(this.danceMesh, mat4.trs(m, 0.8, 0, zc, 0, 0, 0), { texture: this.danceTex, unlit: true, tint: col.dance });
      r.draw(this.counterMesh, mat4.trs(m, -4.7, 0, zc, 0, 0, 0), { texture: this.counterTex, tint: col.tint, emissive: scaleColor(col.glow, P.color(R(0, 1)), 0.15 * k) });
      r.draw(this.shelfMesh, mat4.trs(m, -6.05, 0, zc, 0, 0, 0), { texture: this.shelfTex, tint: col.tint });
    }

    // cabinets
    r.drawInstanced(this.cabMesh, this.cabInst, { texture: this.cabTex, tint: col.tint });
    r.drawInstanced(this.ctrlMesh, this.ctrlInst, { texture: this.swatch, tint: col.tint });
    r.drawInstanced(this.cabLod, this.lodInst, { texture: this.cabTex, tint: col.tint });
    for (let v = 0; v < 4; v++) {
      r.drawInstanced(this.screenMesh[v], this.screenInst[v], { texture: this.atlasTex, unlit: true, fade: [20, 36] });
      r.drawInstanced(this.marqMesh[v], this.marqInst[v], { texture: this.atlasTex, unlit: true, fade: [20, 36] });
    }

    // ceiling neon (unlit tubes, then halos that shine through the fog)
    r.drawInstanced(this.tubeLong, this.longInst, { texture: this.tubePink, unlit: true, fog: false, fade: [16, 34] });
    r.drawInstanced(this.tubeCross, this.crossInst, { texture: this.tubeTeal, unlit: true, fog: false, fade: [16, 34] });

    // additive: screen light pools, tube halos, signs, dust
    r.drawInstanced(this.poolMesh, this.poolInst, { texture: this.poolTex, unlit: true, additive: true, fade: [12, 30] });
    r.drawInstanced(this.quad, this.glowInst, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [14, 32] });
    for (const zc of this.areas) {
      this.signPrizes.draw(r, mat4.trs(m, -5.9, 2.75, zc, 0, Math.PI / 2, 0), { additive: true, fog: false, fade: [16, 34], tint: col.white });
      this.signDance.draw(r, mat4.trs(m, 0.8, 3.2, zc + 4.2, 0, 0, 0), { additive: true, fog: false, fade: [16, 34], tint: col.white });
      this.signTokens.draw(r, mat4.trs(m, WALL_X - 0.05, 2.75, zc - 3, 0, -Math.PI / 2, 0), { additive: true, fog: false, fade: [16, 34], tint: col.white });
    }
    this.dust.draw(r, { brightness: dim * 0.45 });
  }

  dispose(r) {
    this.dust.dispose(r);
    [this.signPrizes, this.signDance, this.signTokens].forEach((s) => s.dispose(r));
    [this.floorMesh, this.ceilMesh, this.wallL, this.wallR, this.cabMesh, this.cabLod, this.ctrlMesh, this.poolMesh, this.tubeLong, this.tubeCross,
      this.quad, this.danceMesh, this.counterMesh, this.shelfMesh, ...this.screenMesh, ...this.marqMesh].forEach((m) => m.dispose());
    [this.carpetTex, this.carpetLit, this.ceilTex, this.wallTex, this.cabTex, this.swatch, this.atlasTex, this.poolTex, this.tubePink, this.tubeTeal,
      this.glowTex, this.danceTex, this.counterTex, this.shelfTex].forEach((t) => r.deleteTexture(t));
    [this.cabInst, this.lodInst, this.ctrlInst, this.poolInst, this.longInst, this.crossInst, this.glowInst, ...this.screenInst, ...this.marqInst].forEach((i) => i.dispose());
  }
}
