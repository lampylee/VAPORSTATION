// ROUTE 9 — an endless night drive down a desert highway.
//
//   two-lane road strip, indexed asphalt + dashed centre line   (snapped to its texture period)
//   flat desert with gentle dunes, flattened along the road     K.Terrain + periodic K.fbm
//   cactus (local sprite) + scrub billboards                    r.drawInstanced(..., { billboard: 1 })
//   telephone poles with sagging wires, mile markers, reflector posts
//   distant mountain silhouette rings, stars and a big moon     K.Sky + local ring mesh
//   roadside motel / diner with pixel-glyph neon signs          per-letter draws, K.stage
//
// The world is periodic along the road (PERIOD units): every placement,
// the terrain and the particle box repeat exactly, so the camera distance
// wraps back to 0 with no visible jump and floats never grow during a gig.
//
// Idle: slow cruise under cool moonlight, signs buzzing faintly, reflectors dim.
// Swell: speed builds, neon letters / windows / lamps / reflectors switch on in
// sequence, heat-shimmer dust appears, stars brighten.
// Reactions: bass = speed + suspension bounce; beat = neon pulse + camera nudge;
// highs = neon flicker + star twinkle.
import { mat4, lerp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { blotch, grain, solid, CLEAR } from '../gfx/textures.js';
import { GeoBuilder, box, merge } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const PERIOD = 1024;          // world repeat length along the road (-z)
const ROAD_W = 9, ROAD_TILE = 8;
const LANE_X = 1.9, EYE_Y = 1.25;
const AHEAD = 120, BEHIND = 14;
const POLE_S = 16, POLE_X = -6.8;
const DELIN_S = 8, DELIN_X = 4.9;
const MILE_S = 128, MILE_X = 5.8;
const LOT_S = 128, LOT_X = 17;
// which 128-unit slots of the period get a building (null = open desert)
const LOT_PLAN = ['motel', null, 'diner', null, null, 'motel', 'bigdiner', null];
const CELL = 8;               // foliage scatter cell

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const mod = (a, n) => ((a % n) + n) % n;
const sstep = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

function make(w, h, fn) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { data, width: w, height: h, indexed: true };
}
const dshade = (ramp, s, x, y) => {
  s = Math.max(0, Math.min(3, s));
  const f = Math.floor(s);
  return R(ramp, Math.min(3, f + (s - f > bayer(x, y) ? 1 : 0)));
};

// ---------------------------------------------------------------- textures

/** Two-lane asphalt, one tile = ROAD_TILE units: edge lines + dashed centre line. */
function asphaltTex() {
  return make(64, 64, (x, y) => {
    if (x === 3 || x === 4 || x === 59 || x === 60) return grain(R(3, 3), x, y, 0.25, 2); // edge lines
    if ((x === 31 || x === 32) && y < 26) return grain(R(0, 3), x, y, 0.2, 3);         // centre dash
    if (x < 2 || x > 61) return R(1, 0);                                                // crumbly edge
    const n = K.fbm(x * 0.15, y * 0.15, { octaves: 2, seed: 7 });
    const crack = Math.abs(K.noise2(x * 0.09, y * 0.2, 4) - 0.5) < 0.02;
    return crack ? R(1, 0) : grain(R(1, n > 0.62 ? 0 : 1), x, y, 0.25, 1);
  });
}

/** Saguaro-style cactus: trunk + two arms, vertical ribs. 32x64 (original). */
function cactusTex({ ramp = 1, seed = 1 } = {}) {
  const W = 32, H = 64;
  // capsules: [x0, y0, x1, y1, radius]
  const segs = [
    [15.5, 63, 15.5, 6, 4],                 // trunk
    [15.5, 36, 7, 36, 2.6], [7, 36, 7, 18, 2.6],      // left arm
    [15.5, 42, 24, 42, 2.4], [24, 42, 24, 27, 2.4],   // right arm
  ];
  return make(W, H, (x, y) => {
    let best = -1, dxs = 0, rad = 1;
    for (const [ax, ay, bx, by, r] of segs) {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      const px = x - ax - dx * t, py = y - ay - dy * t, d = Math.hypot(px, py);
      if (d < r && (best < 0 || d / r < best)) { best = d / r; dxs = Math.abs(dy) > Math.abs(dx) ? px : py; rad = r; }
    }
    if (best < 0) return CLEAR;
    const rib = (Math.floor(dxs + rad + 0.5) % 2) === 0 ? -0.5 : 0;   // ribs
    const light = 2.1 - (dxs / rad) * 1.1 + rib + (K.rand2(x, y, seed) - 0.5) * 0.4;
    return dshade(ramp, light, x, y);
  });
}

/** Warm lit window with a blind band. */
function windowTex() {
  return make(16, 16, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return R(0, 1);
    if (y > 2 && y < 6) return R(0, 2);
    return grain(R(0, 3), x, y, 0.15, 5);
  });
}

/** Big pale moon with darker maria, dithered rim. 32x32, atmosphere ramp. */
function moonTex() {
  return make(32, 32, (x, y) => {
    const dx = x - 15.5, dy = y - 15.5, d = Math.hypot(dx, dy) / 15.5;
    if (d > 1) return CLEAR;
    const maria = K.fbm(x * 0.14, y * 0.14, { octaves: 3, seed: 12 });
    const s = 3.2 - d * d * 0.9 - (maria > 0.56 ? 0.9 : 0) + (dx + dy < 0 ? 0.15 : -0.2);
    return dshade(3, s, x, y);
  });
}

/** Little roadside mile plate. */
function plateTex() {
  return make(16, 16, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return R(3, 3);
    if (y >= 5 && y <= 10 && ((x >= 3 && x <= 6) || (x >= 9 && x <= 12)) && !((x === 4 || x === 5 || x === 10 || x === 11) && y >= 6 && y <= 9)) return R(3, 3);
    return R(1, 1);
  });
}

// 5x7 pixel font for the neon signs (only the letters the signs use)
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
};
const GS = 3, CW = 6 * GS, CH = 9 * GS; // texels per glyph pixel, cell size

/** Neon text strip: tube core in accent light, dark accent outline, CLEAR elsewhere. */
function neonTextTex(text) {
  const n = text.length;
  const core = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= n * CW || ty >= CH) return false;
    const g = FONT[text[Math.floor(tx / CW)]];
    if (!g) return false;
    const gx = Math.floor((tx % CW) / GS), gy = Math.floor(ty / GS) - 1;
    return gx < 5 && gy >= 0 && gy < 7 && g[gy][gx] === '1';
  };
  return make(n * CW, CH, (x, y) => {
    if (core(x, y)) return (x % GS === 1 && y % GS === 1) ? R(2, 3) : R(2, 2);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (core(x + i, y + j)) return R(2, 0);
    return CLEAR;
  });
}

// ---------------------------------------------------------------- geometry

const part = (sx, sy, sz, x, y, z, color = null, uv = [1, 1]) =>
  ({ geo: box(sx, sy, sz, { uvRepeat: uv }), xf: (p) => [p[0] + x, p[1] + y, p[2] + z], color });

/** Road strip from z=+12 to z=-(AHEAD+20), v in tiles. */
function roadGeo() {
  // finer rows near the camera keep affine warping in check, longer ones far away
  const g = new GeoBuilder(), w = ROAD_W / 2, z1 = -(AHEAD + 24), cols = 4;
  for (let z = 12; z > z1;) {
    const step = z > -24 ? 2 : 4, za = z, zb = z - step, va = -za / ROAD_TILE, vb = -zb / ROAD_TILE;
    for (let c = 0; c < cols; c++) {
      const u0 = c / cols, u1 = (c + 1) / cols, x0 = -w + u0 * ROAD_W, x1 = -w + u1 * ROAD_W;
      g.quad([x0, 0, za], [x1, 0, za], [x1, 0, zb], [x0, 0, zb], [u0, va], [u1, va], [u1, vb], [u0, vb], [0, 1, 0]);
    }
    z -= step;
  }
  return g.build();
}

/** Flat quad on the ground (headlight pool), pivot at centre. */
function flatQuad(w, l) {
  return new GeoBuilder().quad([-w / 2, 0, l / 2], [w / 2, 0, l / 2], [w / 2, 0, -l / 2], [-w / 2, 0, -l / 2], [0, 1], [1, 1], [1, 0], [0, 0], [0, 1, 0]).build();
}

/** Jagged mountain ring around the origin (follows the camera like the sky). */
function mountainRing(radius, segs, base, amp, seed) {
  const g = new GeoBuilder(), z = [0, 0], h = [];
  for (let i = 0; i < segs; i++) {
    const a = i / segs;
    // periodic noise around the ring
    const v = K.ridged(Math.cos(a * Math.PI * 2) * 2.2 + seed, Math.sin(a * Math.PI * 2) * 2.2, { octaves: 3, seed });
    h.push(base + Math.pow(v, 1.6) * amp);
  }
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2, h0 = h[i], h1 = h[(i + 1) % segs];
    const P = (a, y) => [Math.cos(a) * radius, y, Math.sin(a) * radius];
    g.quad(P(a0, -12), P(a1, -12), P(a1, h1), P(a0, h0), z, z, z, z, [0, 0, 1]);
  }
  return g.build();
}

function poleGeo() {
  return merge([
    { geo: K.props.prism(5, 0.13, 7.6, { uvRepeat: [1, 4] }) },
    part(2.5, 0.14, 0.14, 0, 7.1, 0, null, [2, 0.2]),
    part(0.14, 0.18, 0.14, -1.05, 7.24, 0), part(0.14, 0.18, 0.14, 0, 7.24, 0), part(0.14, 0.18, 0.14, 1.05, 7.24, 0),
  ]);
}

/** Three sagging wires from this pole to the next one (z = -POLE_S). */
function wireGeo() {
  const g = new GeoBuilder(), segs = 8, sag = 0.75, th = 0.06, z = [0, 0];
  for (const ox of [-1.05, 0, 1.05]) {
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const y0 = 7.32 - sag * 4 * t0 * (1 - t0), y1 = 7.32 - sag * 4 * t1 * (1 - t1);
      g.quad([ox, y0 - th, -t0 * POLE_S], [ox, y1 - th, -t1 * POLE_S], [ox, y1, -t1 * POLE_S], [ox, y0, -t0 * POLE_S], z, z, z, z, [1, 0, 0]);
    }
  }
  return g.build();
}

/**
 * A roadside building. Local frame: front faces -x (towards the road),
 * origin at the base centre. Returns geometry groups + sign layout.
 */
function buildingParts(type) {
  const roof = [0.72, 0.72, 0.78], dark = [0.38, 0.38, 0.44], board = [0.3, 0.3, 0.36];
  const body = [], win = [[], [], []], trim = [];
  let sign;
  if (type === 'motel') {
    body.push(part(6, 3.2, 22, 0, 1.6, 0, null, [6, 2]), part(7.4, 0.35, 23.2, -0.4, 3.37, 0, roof, [4, 8]),
      part(5, 4.2, 6, 0, 2.1, 14.1, null, [3, 2]), part(5.8, 0.35, 6.8, -0.2, 4.37, 14.1, roof, [3, 3]));
    for (let z = -10; z <= 10.1; z += 5) body.push(part(0.16, 3.2, 0.16, -3.85, 1.6, z, dark));
    for (let u = 0; u < 7; u++) {
      const z = -9 + u * 3;
      body.push(part(0.06, 2.1, 0.95, -3.02, 1.05, z, dark));
      win[u % 3].push(part(0.05, 0.9, 1.2, -3.03, 1.6, z + 1.3));
    }
    body.push(part(0.06, 2.2, 1, -2.52, 1.1, 12.2, dark));
    win[0].push(part(0.05, 1.4, 3, -2.53, 1.9, 14.8));
    trim.push(part(0.08, 0.1, 23.2, -4.1, 3.18, 0), part(0.08, 0.1, 6.8, -2.62, 4.18, 14.1));
    sign = { x: -6.8, z: 19, y: 4.8, lines: [{ text: 'MOONREST', w: 0.78 }, { text: 'MOTEL', w: 0.5 }] };
  } else {
    body.push(part(5, 3.4, 13, 0, 1.7, 0, null, [4, 2]), part(6.4, 0.5, 14, -0.3, 3.65, 0, roof, [4, 6]),
      part(3, 2.6, 4, 1.5, 1.3, -8, null, [2, 2]));
    for (let i = 0; i < 6; i++) win[i % 3].push(part(0.05, 1.1, 1.6, -2.53, 1.9, -5 + i * 1.9));
    body.push(part(0.06, 2.2, 1.1, -2.53, 1.1, 5.7, dark));
    trim.push(part(0.08, 0.12, 13.2, -2.58, 0.85, 0), part(0.08, 0.12, 13.2, -2.58, 3.05, 0), part(0.08, 0.14, 14, -3.52, 3.65, 0));
    sign = type === 'bigdiner'
      ? { x: -7, z: 9.5, y: 4.4, lines: [{ text: 'BIG LEES', w: 0.78 }, { text: 'DINER', w: 0.62 }] }
      : { x: -7.4, z: 9.5, y: 4.4, lines: [{ text: 'DUNE DINER', w: 0.7 }, { text: 'EAT', w: 0.8 }] };
  }
  // sign board + posts (lines stacked, first line on top)
  const lh = sign.lines.map((l) => l.w * 1.5), gap = 0.25;
  const bw = Math.max(...sign.lines.map((l) => l.text.length * l.w)) + 0.8, bh = lh.reduce((a, b) => a + b, 0) + gap * (lh.length + 1);
  sign.bw = bw; sign.bh = bh;
  body.push(part(bw, bh, 0.25, sign.x, sign.y + bh / 2, sign.z, board, [bw / 2, bh / 2]));
  for (const px of [-bw * 0.32, bw * 0.32]) body.push(part(0.22, sign.y, 0.22, sign.x + px, sign.y / 2, sign.z - 0.05, dark));
  trim.push(part(bw + 0.1, 0.08, 0.08, sign.x, sign.y + bh + 0.02, sign.z + 0.14), part(bw + 0.1, 0.08, 0.08, sign.x, sign.y - 0.02, sign.z + 0.14));
  let y = sign.y + bh - gap;
  sign.lines.forEach((l, i) => { y -= lh[i]; l.y = y; y -= gap; });
  return { body: merge(body), win: win.map((w) => merge(w)), trim: merge(trim), sign };
}

// ---------------------------------------------------------------- style

export class RouteNine {
  static meta = { name: 'Route 9' };
  // sandy desert, asphalt grey-blue, neon pink, indigo night
  static palette = fromKeys('route-nine', 'Route 9', ['#b08a5c', '#545e78', '#ff4fa0', '#2c2860']);

  init(r) {
    // ---- world shape: periodic dunes, flat along the road and building lots
    const RZ = (PERIOD * 0.022) / (Math.PI * 2);
    this.height = (x, z) => {
      const a = (z / PERIOD) * Math.PI * 2, cz = Math.cos(a), sz = Math.sin(a);
      const dunes = K.fbm(x * 0.03 + cz * RZ, sz * RZ, { octaves: 3, seed: 2 }) * 5
        + K.ridged(x * 0.012 + cz * RZ * 0.4, sz * RZ * 0.4 + 9, { octaves: 2, seed: 5 }) * 4;
      let flat = sstep((Math.abs(x) - 7) / 16);
      const slot = Math.round(z / LOT_S);
      if (x > 0 && LOT_PLAN[mod(slot, LOT_PLAN.length)]) {
        const dz = Math.abs(z - slot * LOT_S);
        flat = Math.min(flat, Math.max(sstep((dz - 22) / 12), sstep((x - 27) / 10)));
      }
      return dunes * flat - 0.25;
    };
    this.ground = new K.Terrain(r, { size: 160, cells: 40, height: this.height, uvScale: 0.25, shadeRange: [0.6, 1], slopeShade: 0.5 });
    this.groundTex = r.texture(blotch({ ramp: 0, scale: 10, seed: 6, minShade: 1 }));

    this.sky = new K.Sky(r, { stars: 170 });
    this.moonDir = [-0.36, 0.22, -1].map((v, _, a) => v / Math.hypot(...a));
    this.moon = r.createMesh(K.props.panel(2, 2, { uvRepeat: [1, 1] }));
    this.moonTex = r.texture(moonTex());
    this.moonHalo = r.texture(K.sprites.glow({ ramp: 3 }));
    this.farRidge = r.createMesh(mountainRing(94, 56, 2, 16, 3));
    this.nearRidge = r.createMesh(mountainRing(90, 44, 0.5, 8, 8));

    // ---- road
    this.road = r.createMesh(roadGeo());
    this.roadTex = r.texture(asphaltTex());
    this.pool = r.createMesh(flatQuad(7, 16));
    this.warmGlowTex = r.texture(K.sprites.glow({ ramp: 0 }));
    this.neonGlowTex = r.texture(K.sprites.glow({ ramp: 2 }));

    // ---- roadside furniture
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.cactusTex = r.texture(cactusTex({ ramp: 1 }));
    this.scrubTex = r.texture(K.sprites.bush({ ramp: 1, seed: 9 }));
    this.cacti = r.createInstances(220);
    this.scrub = r.createInstances(220);

    this.poleMesh = r.createMesh(poleGeo());
    this.wireMesh = r.createMesh(wireGeo());
    this.woodTex = r.texture(blotch({ ramp: 0, scale: 4, seed: 11, minShade: 0 }));
    this.wireTex = r.texture(solid(R(1, 0)));
    this.poles = r.createInstances(16);

    this.delinMesh = r.createMesh(merge([part(0.1, 0.9, 0.06, 0, 0.45, 0, [0.8, 0.8, 0.85])]));
    this.postTex = r.texture(solid(R(3, 3)));
    this.delin = r.createInstances(48);
    this.reflect = r.createInstances(48);

    this.mileMesh = r.createMesh(merge([part(0.1, 1.1, 0.1, 0, 0.55, 0), { geo: K.props.panel(0.6, 0.6, { uvRepeat: [1, 1] }), xf: (p) => [p[0], p[1] + 1.05, p[2] + 0.06] }]));
    this.plateTex = r.texture(plateTex());
    this.miles = r.createInstances(4);

    // ---- buildings
    this.stuccoTex = r.texture(blotch({ ramp: 0, scale: 6, seed: 14, minShade: 1 }));
    this.windowTex = r.texture(windowTex());
    this.neonTex = r.texture(solid(R(2, 3)));
    this.letter = r.createMesh(K.props.panel(1, 1.5, { uvRepeat: [1, 1] }));
    this.lampMesh = r.createMesh(K.props.lampPost(5, 1));
    this.lamps = r.createInstances(8);
    this.lampGlow = r.createInstances(8);
    this.neonGlow = r.createInstances(8);
    this.types = {};
    for (const type of ['motel', 'diner', 'bigdiner']) {
      const p = buildingParts(type);
      const lines = p.sign.lines.map((l) => ({ ...l, tex: r.texture(neonTextTex(l.text)) }));
      let total = 0; lines.forEach((l) => { l.first = total; total += l.text.replace(/ /g, '').length; });
      this.types[type] = { body: r.createMesh(p.body), win: p.win.map((g) => r.createMesh(g)), trim: r.createMesh(p.trim), sign: { ...p.sign, lines, total } };
    }

    // ---- atmosphere
    this.dust = new K.Particles(r, 'dust', { count: 240, area: [24, 7, 32], color: R(0, 3), glow: 0.45, yOffset: -0.4 });

    // ---- camera: driver's seat, right-hand lane
    this.bounce = new K.Spring(9);
    this.prevBass = 0;
    this.cam = new K.PathRig((s, out) => {
      out[0] = LANE_X + Math.sin(s * 0.011) * 0.22;
      out[1] = EYE_Y + this.bounce.x + Math.sin(s * 0.9) * 0.004;
      out[2] = -s;
      return out;
    }, { lookAhead: 12, idleSpeed: 8, activeSpeed: 24, bassBoost: 14, fov: 62, nudge: 0.18, rollKick: 0.025, fovPunch: 4, far: 220 });

    this.signPulse = new K.Envelope(0.22);
    this.m = mat4.create();
    this.time = 0; this.k = 0; this.a = null;
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], ridgeA: [0, 0, 0], ridgeB: [0, 0, 0], zen: [0, 0, 0], dark: [0, 0, 0], t: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k);
    // suspension: bass onsets push the car down, a little road hum always
    const db = d.bass - this.prevBass; this.prevBass = d.bass;
    if (db > 0.04) this.bounce.kick(-db * 1.6);
    if (d.beat) { this.bounce.kick(-0.12 * k); this.signPulse.trigger(k); }
    this.bounce.update(dt); this.signPulse.update(dt);

    this.cam.update(a, k, dt);
    this.cam.target[1] -= 0.16; // look slightly down the road
    if (this.cam.s >= PERIOD) this.cam.s -= PERIOD; // world repeats: seamless wrap
    const eye = this.cam.eye;
    this.ground.follow(eye[0], eye[2] - 40);
    this.dust.update(dt, [eye[0], EYE_Y, eye[2] - 6], { amount: K.stage(k, 0.25, 0.75), speed: 1 + d.level, wind: [1.2 + d.bass * 2, 0.4] });
    this._scatter();
  }

  /** Deterministic cacti / scrub in world cells (periodic along z). */
  _scatter() {
    const e = this.cam.eye, N = PERIOD / CELL;
    const z0 = Math.floor((e[2] - AHEAD + 20) / CELL), z1 = Math.floor((e[2] + BEHIND) / CELL);
    let nc = 0, ns = 0;
    for (let gz = z0; gz <= z1; gz++) for (let gx = -8; gx < 8; gx++) {
      const kz = mod(gz, N), h = K.rand2(gx, kz, 1);
      const x = (gx + 0.15 + K.rand2(gx, kz, 2) * 0.7) * CELL, z = (gz + K.rand2(gx, kz, 3)) * CELL;
      if (Math.abs(x) < 7.5) continue;
      if (x > 0) { // keep building lots clear
        const slot = Math.round(z / LOT_S);
        if (LOT_PLAN[mod(slot, LOT_PLAN.length)] && Math.abs(z - slot * LOT_S) < 28 && x < 26) continue;
      }
      const y = this.height(x, z), shade = 0.75 + K.rand2(gx, kz, 5) * 0.35;
      if (h < 0.3 && nc < this.cacti.max) {
        this.cacti.set(nc++, x, y - 0.1, z, 1.4 + K.rand2(gx, kz, 4) * 1.4, 0, shade, h * 40, 2);
      } else if (h > 0.55 && ns < this.scrub.max) {
        this.scrub.set(ns++, x, y - 0.05, z, 1 + K.rand2(gx, kz, 6) * 1.1, 0, shade * 0.9, h * 30, 0.75);
        if (h > 0.85 && ns < this.scrub.max) { // a second clump near the shoulder
          const sx = Math.sign(x) * (8 + K.rand2(gx, kz, 7) * 3);
          this.scrub.set(ns++, sx, this.height(sx, z) - 0.05, z + 3, 0.8, 0, shade * 0.8, h * 20, 0.7);
        }
      }
    }
    this.cacti.upload(nc); this.scrub.upload(ns);
  }

  /** Visit slot positions z = i*S within view; key is periodic. */
  _slots(S, offset, fn) {
    const ez = this.cam.eye[2], N = PERIOD / S;
    for (let i = Math.ceil((ez - AHEAD - offset) / S); i <= Math.floor((ez + BEHIND - offset) / S); i++) fn(i * S + offset, mod(i, N), i);
  }

  render(r) {
    const { col, k, m } = this, a = this.a, P = this.pal, d = K.drive(a, k), eye = this.cam.eye, t = this.time;
    const dim = lerp(0.62, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);

    // ---- sky, moon, mountains (all beyond the fog)
    const twinkle = d.high * 0.55 * (0.6 + 0.4 * Math.sin(t * 19));
    scaleColor(col.zen, P.color(R(3, 0)), 1);
    this.sky.draw(r, eye, { horizon: col.fog, zenith: col.zen, brightness: dim, starLevel: lerp(0.32, 0.85, k) + twinkle, moonScale: 1 });
    // the big moon (behind the mountains): faint halo + disc
    const md = this.moonDir, D = 85, yaw = Math.atan2(-md[0], -md[2]);
    col.t[0] = col.t[1] = col.t[2] = lerp(0.18, 0.28, k);
    r.draw(this.moon, mat4.trs(m, eye[0] + md[0] * D, eye[1] + md[1] * D - 22, eye[2] + md[2] * D, 0, yaw, 0, 22), { texture: this.moonHalo, unlit: true, fog: false, depthWrite: false, additive: true, tint: col.t });
    col.t[0] = col.t[1] = col.t[2] = lerp(0.85, 1, k);
    r.draw(this.moon, mat4.trs(m, eye[0] + md[0] * D, eye[1] + md[1] * D - 6.5, eye[2] + md[2] * D, 0, yaw, 0, 6.5), { texture: this.moonTex, unlit: true, fog: false, depthWrite: false, tint: col.t });
    scaleColor(col.dark, P.color(R(3, 0)), dim * 0.8);
    mixColor(col.ridgeA, col.fog, col.dark, 0.45);
    mixColor(col.ridgeB, col.fog, col.dark, 0.85);
    mat4.trs(m, eye[0], 0, eye[2]);
    r.draw(this.farRidge, m, { unlit: true, fog: false, depthWrite: false, tint: col.ridgeA });
    r.draw(this.nearRidge, m, { unlit: true, fog: false, depthWrite: false, tint: col.ridgeB });

    r.setFog(col.fog, 6, lerp(58, 86, k));
    // cool moonlight from ahead-left
    r.setLight([0.38, -0.45, 1], scaleColor(col.light, P.role('light'), lerp(0.5, 0.75, k)), scaleColor(col.amb, P.role('ambient'), lerp(0.38, 0.48, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    // ---- ground + road
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    r.draw(this.road, mat4.trs(m, 0, 0, Math.round(eye[2] / ROAD_TILE) * ROAD_TILE), { texture: this.roadTex, tint: col.tint });

    // ---- poles + wires (left), reflector posts (both sides), mile markers (right)
    let np = 0;
    this._slots(POLE_S, 0, (z, key) => { this.poles.set(np++, POLE_X, -0.1, z, 1, 0, 0.8 + K.rand2(key, 0, 21) * 0.25, key, 1); });
    this.poles.upload(np);
    r.drawInstanced(this.poleMesh, this.poles, { texture: this.woodTex, tint: col.tint });
    scaleColor(col.t, col.tint, 0.7);
    r.drawInstanced(this.wireMesh, this.poles, { texture: this.wireTex, unlit: true, tint: col.t, sway: 0.003 + d.bass * 0.012 });

    let nd = 0;
    this._slots(DELIN_S, 4, (z, key) => {
      for (const side of [-1, 1]) {
        const th = K.rand2(key, side, 31) * 0.55; // each reflector wakes at its own intensity
        const on = K.stage(k, th, th + 0.18);
        this.delin.set(nd, side * DELIN_X, 0, z, 1, 0, 0.8, 0, 1);
        this.reflect.set(nd, side * DELIN_X, 0.62, z, 0.32 + d.pulse * 0.12, 0, 0.25 + on * 0.85, 0, 1);
        nd++;
      }
    });
    this.delin.upload(nd); this.reflect.upload(nd);
    r.drawInstanced(this.delinMesh, this.delin, { texture: this.postTex, tint: col.tint });

    let nm = 0;
    this._slots(MILE_S, 64, (z) => { this.miles.set(nm++, MILE_X, 0, z, 1, 0, 1, 0, 1); });
    this.miles.upload(nm);
    r.drawInstanced(this.mileMesh, this.miles, { texture: this.plateTex, tint: col.tint });

    // ---- foliage
    const sway = 0.008 + d.bass * 0.03;
    r.drawInstanced(this.quad, this.cacti, { texture: this.cactusTex, billboard: 1, tint: col.tint });
    r.drawInstanced(this.quad, this.scrub, { texture: this.scrubTex, billboard: 1, sway, tint: col.tint });

    // ---- roadside buildings
    let nl = 0, ng = 0;
    this._slots(LOT_S, 0, (z, key) => {
      const type = LOT_PLAN[key % LOT_PLAN.length];
      if (type) { this._building(r, this.types[type], z, key, d, nl, ng); nl += 2; ng += 1; }
    });
    this.lamps.upload(nl); this.lampGlow.upload(nl); this.neonGlow.upload(ng);
    if (nl) r.drawInstanced(this.lampMesh, this.lamps, { texture: this.woodTex, tint: col.tint });

    // ---- additive lights last
    col.t[0] = col.t[1] = col.t[2] = 1;
    r.drawInstanced(this.quad, this.reflect, { texture: this.neonGlowTex, billboard: 2, unlit: true, additive: true, tint: col.t });
    r.drawInstanced(this.quad, this.lampGlow, { texture: this.warmGlowTex, billboard: 2, unlit: true, additive: true, tint: col.t });
    r.drawInstanced(this.quad, this.neonGlow, { texture: this.neonGlowTex, billboard: 2, unlit: true, additive: true, tint: col.t });
    // headlight pool on the asphalt ahead
    const hl = lerp(0.22, 0.32, k) + d.pulse * 0.05;
    col.t[0] = col.t[1] = col.t[2] = hl;
    r.draw(this.pool, mat4.trs(m, LANE_X - 0.2, 0.02, eye[2] - 11), { texture: this.warmGlowTex, unlit: true, additive: true, tint: col.t });

    this.dust.draw(r, { brightness: dim * 0.9 });
  }

  _building(r, B, z, key, d, li, gi) {
    const { m, k, col, time: t } = this, mm = this._mm || (this._mm = mat4.create());
    mat4.trs(m, LOT_X, 0, z);
    r.draw(B.body, m, { texture: this.stuccoTex, tint: col.tint });
    // windows: one group always faintly lit, the others switch on as the band swells
    const wl = [lerp(0.45, 1, k), lerp(0.12, 1, K.stage(k, 0.2, 0.45)), lerp(0.12, 1, K.stage(k, 0.5, 0.8))];
    B.win.forEach((w, i) => {
      const v = wl[i] * (0.94 + 0.06 * Math.sin(t * 3 + i * 2 + key));
      col.t[0] = col.t[1] = col.t[2] = v;
      r.draw(w, m, { texture: this.windowTex, unlit: true, tint: col.t });
    });
    // neon trim tubes
    const trimOn = K.stage(k, 0.55, 0.85);
    const trim = lerp(0.18, 1.1, trimOn) * (1 - d.high * 0.3 * (K.rand2(Math.floor(t * 24), key, 3) > 0.6 ? 1 : 0)) + this.signPulse.v * 0.4 * trimOn;
    col.t[0] = col.t[1] = col.t[2] = trim;
    r.draw(B.trim, m, { texture: this.neonTex, unlit: true, tint: col.t });

    // neon letters switch on one by one; beat pulses, highs flicker
    const S = B.sign, sx = LOT_X + S.x, sz = z + S.z + 0.15;
    let idx = 0, onSum = 0;
    for (const l of S.lines) {
      const n = l.text.length, x0 = sx - (n * l.w) / 2 + l.w / 2;
      for (let i = 0; i < n; i++) {
        if (l.text[i] === ' ') continue;
        const f = idx / S.total, on = K.stage(k, 0.08 + f * 0.45, 0.16 + f * 0.45);
        const tick = Math.floor(t * 14 + idx * 3.7);
        const buzz = K.rand2(tick, idx, key) < 0.06 ? 0.45 : 1;                         // faint idle buzz
        const flick = K.rand2(Math.floor(t * 30), idx, key + 9) < d.high * 0.55 ? 0.3 : 1; // highs
        let b = lerp(0.24 * buzz, 1.15 * flick, on) + this.signPulse.v * 0.6 * on;
        col.t[0] = col.t[1] = col.t[2] = b;
        r.draw(this.letter, mat4.trs(mm, x0 + i * l.w, l.y, sz, 0, 0, 0, l.w), { texture: l.tex, unlit: true, tint: col.t, uvOffset: [i / n, 0], uvScale: [1 / n, 1] });
        onSum += on; idx++;
      }
    }
    const signOn = onSum / Math.max(1, idx), hs = S.bw * 1.05;
    this.neonGlow.set(gi, sx, S.y + S.bh / 2 - hs / 2, sz + 0.3, hs, 0, 0.05 + signOn * 0.32 + this.signPulse.v * 0.15 * signOn, 0, 0.55);

    // forecourt lamps
    const lampOn = K.stage(k, 0.3, 0.6);
    for (let j = 0; j < 2; j++) {
      const lz = z + (j ? -8 : 8), lx = LOT_X - 6;
      this.lamps.set(li + j, lx, 0, lz, 1, Math.PI, 0.9, 0, 1);
      this.lampGlow.set(li + j, lx - 1, 4.8 - 1, lz, 2 + d.pulse * 0.6, 0, 0.1 + lampOn * 0.9 * (0.93 + 0.07 * Math.sin(t * 11 + j * 4)), 0, 1);
    }
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.moon.dispose(); r.deleteTexture(this.moonTex); r.deleteTexture(this.moonHalo); this.dust.dispose(r);
    [this.farRidge, this.nearRidge, this.road, this.pool, this.quad, this.poleMesh, this.wireMesh, this.delinMesh, this.mileMesh, this.letter, this.lampMesh].forEach((x) => x.dispose());
    for (const B of Object.values(this.types)) {
      B.body.dispose(); B.trim.dispose(); B.win.forEach((w) => w.dispose());
      B.sign.lines.forEach((l) => r.deleteTexture(l.tex));
    }
    [this.groundTex, this.roadTex, this.warmGlowTex, this.neonGlowTex, this.cactusTex, this.scrubTex, this.woodTex, this.wireTex,
      this.postTex, this.plateTex, this.stuccoTex, this.windowTex, this.neonTex].forEach((x) => r.deleteTexture(x));
    [this.cacti, this.scrub, this.poles, this.delin, this.reflect, this.miles, this.lamps, this.lampGlow, this.neonGlow].forEach((x) => x.dispose());
  }
}
