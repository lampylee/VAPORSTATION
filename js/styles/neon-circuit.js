// NEON CIRCUIT — flying along a floating anti-gravity race track high above a
// night city. Original layout, names and art; evokes late-90s futuristic racers.
//
//   banked ribbon track baked from a closed spline     one static mesh (+ additive chevron pass)
//   side barriers with light strips                    dynamic vertex colours, segment by segment
//   boost pads, gantries with made-up sponsor signs    baked meshes, pixel-glyph sign atlas
//   city blocks far below with lit windows             instanced boxes, world-cell scatter
//   skyline silhouettes + blinking beacons             camera-following ring, fog off
//   speed lines + sparks                               local instanced lines + K.Particles
//
// Intensity: idle = slow cruise, strips dim, a few windows lit. Swell = speed
// builds, strips light up segment by segment, more windows, speed lines appear.
// Reactions: bass = speed + chevron scroll + FOV; beat = boost-pad flash, camera
// punch and a strobe running along the barriers; highs = sparks + speed lines.
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { GeoBuilder, box } from '../gfx/geometry.js';
import { grain, blotch, grid, solid, CLEAR } from '../gfx/textures.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const STEP = 4;            // track sample spacing (world units)
const HW = 3.6;            // track half width
const BH = 0.9;            // barrier height
const BT = 0.25;           // barrier thickness
const TILE = 8;            // world units per track texture repeat
const LIGHT_SEG = 2;       // samples per barrier light segment
const GANTRY_EVERY = 22, PAD_EVERY = 19, PYLON_EVERY = 9;
const CITY_Y = -20, CELL = 18, CITY_R = 8;
const SKYLINE = 44, SKY_RAD = 172;
const LINES = 80, PULSE_V = 70;

// ---------------------------------------------------------------- helpers
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** p + X*x + U*y + T*z in a track frame. */
const fp = (f, x, y, z = 0) => [f.p[0] + f.r[0] * x + f.u[0] * y + f.t[0] * z, f.p[1] + f.r[1] * x + f.u[1] * y + f.t[1] * z, f.p[2] + f.r[2] * x + f.u[2] * y + f.t[2] * z];

function make(w, h, fn) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { data, width: w, height: h, indexed: true };
}
const rnd = (x, y, s = 0) => { const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return h - Math.floor(h); };

/** Box from a centre and three half-axis vectors, outward normals. */
function orientedBox(g, c, ax, ay, az, uv = [0, 0, 1, 1]) {
  for (const [n, u, v] of [[ax, ay, az], [ay, az, ax], [az, ax, ay]]) {
    for (const s of [1, -1]) {
      const fc = add(c, n, s);
      let uu = u, vv = v;
      if (dot(cross(uu, vv), n) * s < 0) { uu = v; vv = u; }
      g.face(fc, uu, vv, uv);
    }
  }
}

// ---------------------------------------------------------------- textures
/** Dark panelled track metal with edge lane lines. 32x64. */
const trackMetal = () => make(32, 64, (x, y) => {
  if (x < 2 || x > 29) return R(0, 2);
  if (x === 3 || x === 28) return y % 8 < 5 ? R(1, 1) : R(0, 0);
  if (y % 32 === 0) return R(0, 0);
  if ((x === 6 || x === 25) && y % 16 === 8) return R(0, 3); // rivets
  return grain(R(0, 1), x, y, 0.22, 2);
});
/** Chevrons pointing forward (+v), transparent elsewhere — additive overlay. */
const chevrons = () => make(32, 64, (x, y) => {
  const dx = Math.abs(x - 15.5);
  if (dx < 9.5) {
    const d = ((y + dx * 0.9) % 32 + 32) % 32;
    if (d < 3) return R(1, 3);
    if (d < 5) return R(1, 2);
  }
  if ((x === 4 || x === 27) && y % 16 < 6) return R(1, 2);
  return CLEAR;
});
/** Barrier panel: metal with a hazard band at the bottom. 32x16 (u along, v up). */
const barrierTex = () => make(32, 16, (x, y) => {
  if (y > 12) return ((x + y) >> 2) % 2 ? R(2, 1) : R(0, 0);
  if (x % 16 === 0) return R(0, 0);
  if (y === 0) return R(0, 3);
  return grain(R(0, y < 4 ? 2 : 1), x, y, 0.2, 5);
});
/** Boost pad: bright accent arrows on dark accent. 16x32. */
const padTex = () => make(16, 32, (x, y) => {
  if (x === 0 || x === 15) return R(2, 2);
  const dx = Math.abs(x - 7.5), d = ((y + dx * 1.2) % 16 + 16) % 16;
  if (dx < 6.5 && d < 5) return d < 3 ? R(2, 3) : R(2, 2);
  return grain(R(2, 0), x, y, 0.15, 7);
});
/** Building facade with a window grid (windows dark). 32x32. */
const facade = () => make(32, 32, (x, y) => {
  const wx = x % 8, wy = y % 8;
  if (wx >= 2 && wx <= 5 && wy >= 2 && wy <= 5) return R(0, 0);
  return grain(R(3, 0), x, y, 0.2, 9);
});
/** Lit windows only (additive). Some windows stay dark. */
const windowsLit = () => make(32, 32, (x, y) => {
  const wx = x % 8, wy = y % 8, cx = x >> 3, cy = y >> 3, h = rnd(cx, cy, 4);
  if (!(wx >= 2 && wx <= 5 && wy >= 2 && wy <= 5) || h < 0.35) return CLEAR;
  return h > 0.85 ? R(2, 2) : h > 0.6 ? R(1, 2) : R(3, 3);
});

// tiny 3x5 pixel font for the made-up sponsor signs
const FONT = {
  A: '.1.1.11111.11.1', E: '1111..11.1..111', H: '1.11.11111.11.1', I: '111.1..1..1.111',
  K: '1.11.111.1.11.1', L: '1..1..1..1..111', N: '11.1.11.11.11.1', O: '1111.11.11.1111',
  P: '11.1.111.1..1..', Q: '1111.11.1111..1', R: '11.1.111.1.11.1', S: '1111..111..1111',
  U: '1.11.11.11.1111', V: '1.11.11.11.1.1.', X: '1.11.1.1.1.11.1', Y: '1.11.1.1..1..1.',
  Z: '111..1.1.1..111', '9': '1111.1111..1111', '-': '......111......', ' ': '...............',
};
const SIGNS = ['VOLKRA', 'ZEPHYX', null, 'NIRAQ'];
/** 4 signs stacked in a 64x64 atlas (each 64x16). Sign 2 is an abstract logo. */
function signAtlas() {
  const px = new Uint8Array(64 * 64).fill(R(0, 0));
  for (let j = 0; j < 4; j++) {
    const y0 = j * 16, ink = j % 2 ? R(1, 3) : R(2, 3), ink2 = j % 2 ? R(1, 1) : R(2, 1);
    for (let x = 0; x < 64; x++) { px[y0 * 64 + x] = R(0, 2); px[(y0 + 15) * 64 + x] = R(0, 2); }
    for (let y = 0; y < 16; y++) { px[(y0 + y) * 64] = R(0, 2); px[(y0 + y) * 64 + 63] = R(0, 2); }
    const word = SIGNS[j];
    if (word) {
      const w = word.length * 8 - 2, x0 = Math.floor((64 - w) / 2);
      [...word].forEach((ch, c) => {
        const gl = FONT[ch] || FONT[' '];
        for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (gl[gy * 3 + gx] === '1') {
          for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
            const X = x0 + c * 8 + gx * 2 + sx, Y = y0 + 3 + gy * 2 + sy;
            px[Y * 64 + X] = ink;
            if (Y + 1 < y0 + 15 && px[(Y + 1) * 64 + X] === R(0, 0)) px[(Y + 1) * 64 + X] = ink2; // drop shadow
          }
        }
      });
    } else {
      // abstract logo: three chevrons + a ring
      for (let y = 2; y < 14; y++) for (let x = 2; x < 62; x++) {
        const ly = y - 8, d = Math.hypot(x - 46, ly * 1.2);
        if (d > 3.5 && d < 5.6) px[(y0 + y) * 64 + x] = ink;
        for (let c = 0; c < 3; c++) {
          const cx = 10 + c * 9, e = x - cx - Math.abs(ly) * 0.8;
          if (e >= 0 && e < 3 && Math.abs(ly) < 5) px[(y0 + y) * 64 + x] = c === 1 ? ink : ink2;
        }
      }
    }
  }
  return { data: px, width: 64, height: 64, indexed: true };
}

// ---------------------------------------------------------------- style
export class NeonCircuit {
  static meta = { name: 'Neon Circuit' };
  static palette = fromKeys('neon-circuit', 'Neon Circuit', ['#4a5266', '#18e4ff', '#ff2aa0', '#14246a']);

  init(r) {
    this._buildPath();
    this._buildTrack(r);
    this._buildCity(r);

    // camera rides the baked frames: slow cruise idle, fast + punchy when playing
    this.lateral = 0;
    this.cam = new K.PathRig((s, out) => this._camPoint(s, out, 2.1), { lookAhead: 10, idleSpeed: 9, activeSpeed: 30, bassBoost: 14, fov: 66, fovPunch: 9, nudge: 0.3, rollKick: 0.05, far: 220 });
    this.cam.s = 40;

    this.sky = new K.Sky(r, { stars: 80 });
    this.sparks = new K.Particles(r, { count: 140, sprite: 'glow', size: 0.13, vel: [0, -3.5, 0], jitter: [2.5, 1.5, 2.5], area: [12, 5, 12], color: R(2, 3), additive: true, glow: 1, flicker: 1 });

    // speed lines: thin streaks along local +Z, rotated to the heading
    const lg = new GeoBuilder();
    lg.quad([-0.012, 0, 0], [0.012, 0, 0], [0.012, 0, 1], [-0.012, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1], [0, 1, 0]);
    lg.quad([0, -0.012, 0], [0, 0.012, 0], [0, 0.012, 1], [0, -0.012, 1], [0, 0], [1, 0], [1, 1], [0, 1], [1, 0, 0]);
    this.lineMesh = r.createMesh(lg.build());
    this.lineTex = r.texture(solid(R(1, 3)));
    this.lineInst = r.createInstances(LINES);
    this.lines = Array.from({ length: LINES }, (_, i) => {
      const side = i % 2 ? 1 : -1;
      return { lat: side * (3 + rnd(i, 1) * 9), up: -1.5 + rnd(i, 2) * 5, z: rnd(i, 3) * 70 - 5, len: 2 + rnd(i, 4) * 5 };
    });

    this.padFlash = new K.Envelope(0.22);
    this.pulses = [];
    this.scroll = 0; this.time = 0; this.k = 0; this.a = null;
    this.fov = 66; this.bassS = 0;
    this.m = mat4.create();
    this._e = v3(); this._f = v3();
    this.col = { fog: v3(), tint: v3(), light: v3(), amb: v3(), sky: v3(), w: [1, 1, 1], strip: v3(), c1: v3(), c2: v3() };
  }

  // ---------------- path: closed loop resampled at uniform arc length, banked into turns
  _buildPath() {
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rad = 205 + Math.sin(a * 3 + 0.7) * 45 + Math.cos(a * 2) * 20;
      pts.push([Math.cos(a) * rad * 1.15, 14 + Math.sin(a * 2 + 0.4) * 9 + Math.sin(a * 5) * 4, Math.sin(a) * rad]);
    }
    const spline = new K.Spline(pts);
    const D = 6000, dense = [], cum = [0];
    for (let i = 0; i <= D; i++) dense.push(spline.at(i / D, v3()));
    for (let i = 1; i <= D; i++) cum.push(cum[i - 1] + Math.hypot(...sub(dense[i], dense[i - 1])));
    const L = cum[D], N = Math.round(L / STEP), ds = L / N;
    const P = [];
    for (let i = 0, j = 0; i < N; i++) {
      const s = i * ds;
      while (cum[j + 1] < s) j++;
      const u = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      P.push(add(dense[j], sub(dense[j + 1], dense[j]), u));
    }
    // horizontal curvature (points into the turn), smoothed
    const acc = P.map((p, i) => { const a = P[(i - 1 + N) % N], b = P[(i + 1) % N]; return [(a[0] - 2 * p[0] + b[0]) / (ds * ds), 0, (a[2] - 2 * p[2] + b[2]) / (ds * ds)]; });
    const sm = acc.map((_, i) => { const o = v3(); for (let d = -8; d <= 8; d++) { const q = acc[(i + d + N) % N]; o[0] += q[0] / 17; o[2] += q[2] / 17; } return o; });
    this.frames = P.map((p, i) => {
      const t = norm(sub(P[(i + 1) % N], P[(i - 1 + N) % N]));
      let lean = [sm[i][0] * 70, 0, sm[i][2] * 70];
      const lm = Math.hypot(lean[0], lean[2]);
      if (lm > 0.45) lean = [lean[0] * 0.45 / lm, 0, lean[2] * 0.45 / lm];
      let u = norm([lean[0], 1, lean[2]]);
      const rr = norm(cross(t, u)); u = cross(rr, t);
      const flatR = norm(cross(t, [0, 1, 0]));
      return { p, t, u, r: rr, roll: Math.atan2(dot(u, flatR), u[1]) };
    });
    this.N = N; this.ds = ds; this.L = L;
  }

  /** Interpolated point on the track at arc length s, lifted h along the track up. */
  _camPoint(s, out, h) {
    const { N, ds, L } = this, w = ((s % L) + L) % L, f = w / ds, i = Math.floor(f) % N, u = f - Math.floor(f);
    const A = this.frames[i], B = this.frames[(i + 1) % N];
    const lat = this.lateral;
    for (let c = 0; c < 3; c++) {
      const pa = A.p[c] + A.u[c] * h + A.r[c] * lat, pb = B.p[c] + B.u[c] * h + B.r[c] * lat;
      out[c] = pa + (pb - pa) * u;
    }
    return out;
  }
  _rollAt(s) {
    const { N, ds, L } = this, f = (((s % L) + L) % L) / ds, i = Math.floor(f) % N, u = f - Math.floor(f);
    return lerp(this.frames[i].roll, this.frames[(i + 1) % N].roll, u);
  }

  // ---------------- track meshes
  _buildTrack(r) {
    const { frames: F, N } = this, vT = Math.round(this.L / TILE), vs = (i) => (i / N) * vT;
    const road = new GeoBuilder(), wall = new GeoBuilder(), strip = new GeoBuilder();
    for (let i = 0; i < N; i++) {
      const a = F[i], b = F[(i + 1) % N], v0 = vs(i), v1 = vs(i + 1);
      road.quad(fp(a, -HW, 0), fp(a, HW, 0), fp(b, HW, 0), fp(b, -HW, 0), [0, v0], [1, v0], [1, v1], [0, v1], a.u);
      const bu0 = (i * STEP) / 4, bu1 = ((i + 1) * STEP) / 4;
      for (const sd of [-1, 1]) {
        const xi = sd * HW, xo = sd * (HW + BT), inward = sd < 0 ? a.r : a.r.map((x) => -x), outward = inward.map((x) => -x);
        wall.quad(fp(a, xi, 0), fp(b, xi, 0), fp(b, xi, BH), fp(a, xi, BH), [bu0, 1], [bu1, 1], [bu1, 0], [bu0, 0], inward);
        wall.quad(fp(a, xi, BH), fp(b, xi, BH), fp(b, xo, BH), fp(a, xo, BH), [bu0, 0], [bu1, 0], [bu1, 0.1], [bu0, 0.1], a.u);
        wall.quad(fp(a, xo, BH), fp(b, xo, BH), fp(b, xo, -0.6), fp(a, xo, -0.6), [bu0, 0], [bu1, 0], [bu1, 1], [bu0, 1], outward);
        const xs = sd * (HW - 0.03);
        strip.quad(fp(a, xs, 0.52), fp(b, xs, 0.52), fp(b, xs, 0.78), fp(a, xs, 0.78), [0, 0], [1, 0], [1, 1], [0, 1], inward);
      }
      // underside so the far side of the loop reads as a solid ribbon
      road.quad(fp(a, -HW - BT, -0.6), fp(b, -HW - BT, -0.6), fp(b, HW + BT, -0.6), fp(a, HW + BT, -0.6), [0, v0], [0, v1], [1, v1], [1, v0], a.u.map((x) => -x));
    }
    this.road = r.createMesh(road.build());
    this.wall = r.createMesh(wall.build());
    const sg = strip.build();
    this.stripGeo = sg;
    this.strip = r.createMesh(sg, true);
    this.stripOrder = Array.from({ length: Math.ceil(N / LIGHT_SEG) }, (_, j) => 0.04 + ((j % 12) / 12) * 0.62 + rnd(j, 7) * 0.04);

    // boost pads
    const pad = new GeoBuilder();
    this.padS = [];
    for (let i = 12; i + 2 < N; i += PAD_EVERY) {
      const off = [-1.6, 0, 1.6][(i / PAD_EVERY | 0) % 3];
      for (let q = 0; q < 2; q++) {
        const a = F[i + q], b = F[i + q + 1];
        pad.quad(fp(a, off - 1.3, 0.05), fp(a, off + 1.3, 0.05), fp(b, off + 1.3, 0.05), fp(b, off - 1.3, 0.05), [0, q], [1, q], [1, q + 1], [0, q + 1], a.u);
      }
      this.padS.push((i + 1) * this.ds);
    }
    this.pads = r.createMesh(pad.build());

    // gantries: two posts + beam, a sponsor sign facing oncoming traffic, lamps under the beam
    const gan = new GeoBuilder(), sign = new GeoBuilder();
    this.gantries = [];
    const GH = 5.6;
    for (let i = 6, n = 0; i < N; i += GANTRY_EVERY, n++) {
      const f = F[i], half = (v) => v.map((x) => x * 0.5);
      for (const sd of [-1, 1]) orientedBox(gan, fp(f, sd * (HW + BT + 0.3), GH / 2 - 0.3), half(f.r.map((x) => x * 0.5)), half(f.u.map((x) => x * (GH + 0.6))), half(f.t.map((x) => x * 0.5)), [0, 0, 0.5, 2]);
      orientedBox(gan, fp(f, 0, GH), half(f.r.map((x) => x * (2 * HW + 2 * BT + 1.2))), half(f.u.map((x) => x * 0.55)), half(f.t.map((x) => x * 0.5)), [0, 0, 4, 0.5]);
      const j = n % 4, sw = 2.9, y0 = GH - 0.3, y1 = GH - 1.75, z = -0.27;
      sign.quad(fp(f, -sw, y1, z), fp(f, sw, y1, z), fp(f, sw, y0, z), fp(f, -sw, y0, z), [0, (j + 1) / 4], [1, (j + 1) / 4], [1, j / 4], [0, j / 4], f.t.map((x) => -x));
      this.gantries.push({ s: i * this.ds, lamps: [-2.2, 0, 2.2].map((x) => fp(f, x, GH - 0.45)) });
    }
    this.gantry = r.createMesh(gan.build());
    this.signs = r.createMesh(sign.build());
    this.lampInst = r.createInstances(this.gantries.length * 3);

    // support pylons dropping into the city fog
    this.pylonMesh = r.createMesh(K.props.prism(6, 0.7, 1, { cap: false, uvRepeat: [2, 8] }));
    this.pylonInst = r.createInstances(Math.ceil(N / PYLON_EVERY));
    let np = 0;
    for (let i = 3; i < N; i += PYLON_EVERY) {
      const p = F[i].p;
      this.pylonInst.set(np++, p[0], CITY_Y, p[2], 1, i * 0.7, 0.8 + rnd(i, 3) * 0.2, 0, p[1] - 0.5 - CITY_Y);
    }
    this.pylonInst.upload(np);

    this.tex = {
      road: r.texture(trackMetal()), chev: r.texture(chevrons()), wall: r.texture(barrierTex()), pad: r.texture(padTex()),
      metal: r.texture(blotch({ ramp: 0, scale: 4, seed: 6, minShade: 1 })), sign: r.texture(signAtlas()),
      glowA: r.texture(K.sprites.glow({ ramp: 2 })), glowB: r.texture(K.sprites.glow({ ramp: 1 })),
      facade: r.texture(facade()), windows: r.texture(windowsLit()),
      ground: r.texture(grid({ bg: R(0, 0), line: R(1, 1), glow: R(3, 0), size: 32, cells: 1, thick: 3, noise: 0.15 })),
    };
  }

  // ---------------- city far below
  _buildCity(r) {
    this.block = r.createMesh(K.props.shift(box(1, 1, 1, { uvRepeat: [1, 2] }), 0, 0.5, 0));
    const max = (2 * CITY_R + 1) ** 2;
    this.bInst = r.createInstances(max);
    this.wInst = r.createInstances(max);
    this.beaconInst = r.createInstances(64);
    this.skyInst = r.createInstances(SKYLINE);
    this.skyBeacon = r.createInstances(SKYLINE);
    this.ground = r.createMesh(new GeoBuilder().face([0, 0, 0], [CITY_R * CELL, 0, 0], [0, 0, -CITY_R * CELL], [0, 0, 2 * CITY_R, 2 * CITY_R], 10).build());
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    // cells the track passes over: lowest track height there (buildings stay below it, no towers)
    this.nearTrack = new Map();
    for (const f of this.frames) {
      const cx = Math.floor(f.p[0] / CELL), cz = Math.floor(f.p[2] / CELL);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const key = (cx + i) + ',' + (cz + j);
        this.nearTrack.set(key, Math.min(this.nearTrack.get(key) ?? Infinity, f.p[1]));
      }
    }
    this.skyline = Array.from({ length: SKYLINE }, (_, i) => ({
      a: (i / SKYLINE) * Math.PI * 2 + rnd(i, 1) * 0.1, w: 8 + rnd(i, 2) * 14, h: 40 + rnd(i, 3) * 70 * (rnd(i, 5) > 0.7 ? 1.4 : 1), ph: rnd(i, 4) * 6,
    }));
  }

  _scatterCity(k, d) {
    const e = this.cam.eye, cx = Math.floor(e[0] / CELL), cz = Math.floor(e[2] / CELL), t = this.time;
    let n = 0, nb = 0;
    for (let j = -CITY_R; j < CITY_R; j++) for (let i = -CITY_R; i < CITY_R; i++) {
      const gx = cx + i, gz = cz + j, h = K.rand2(gx, gz, 11);
      if (h < 0.22) continue; // plaza / empty lot
      const under = this.nearTrack.get(gx + ',' + gz);
      const tower = h > 0.95 && under === undefined;
      const w = CELL * (0.45 + K.rand2(gx, gz, 12) * 0.25) * (tower ? 0.8 : 1);
      let ht = tower ? 48 + K.rand2(gx, gz, 13) * 22 : 5 + K.rand2(gx, gz, 13) ** 2 * 22;
      if (under !== undefined) ht = Math.min(ht, under - CITY_Y - 5);
      if (ht < 3) continue;
      const x = (gx + 0.5) * CELL + (K.rand2(gx, gz, 14) - 0.5) * (CELL - w) * 0.6, z = (gz + 0.5) * CELL + (K.rand2(gx, gz, 15) - 0.5) * (CELL - w) * 0.6;
      // window lights shine through the fog, so fade them out before the scatter edge
      const fade = clamp((CITY_R * CELL - 10 - Math.max(Math.abs(x - e[0]), Math.abs(z - e[2]))) / 40);
      const rot = Math.floor(K.rand2(gx, gz, 16) * 4) * Math.PI / 2;
      this.bInst.set(n, x, CITY_Y, z, w, rot, 0.75 + K.rand2(gx, gz, 17) * 0.35, 0, ht / w);
      // windows: a few lit when idle, building by building more as the band swells
      const th = K.rand2(gx, gz, 18);
      const lit = Math.max(th < 0.25 ? 0.45 : 0, K.stage(k, 0.1 + th * 0.65, 0.25 + th * 0.65)) * (0.85 + 0.15 * Math.sin(t * 0.7 + h * 40)) + d.mid * 0.25 * (th < 0.6 ? 1 : 0);
      this.wInst.set(n, x, CITY_Y, z, w, rot, lit * fade * 0.8, 0, ht / w);
      n++;
      if (tower && nb < this.beaconInst.max) {
        const blink = Math.max(0, Math.sin(t * lerp(1.6, 3.2, k) + h * 60)) ** 6;
        this.beaconInst.set(nb++, x, CITY_Y + ht + 0.8, z, 2.6, 0, (0.25 + blink * 0.9) * fade, 0, 1);
      }
    }
    this.bInst.upload(n); this.wInst.upload(n); this.beaconInst.upload(nb);
    // skyline ring follows the camera (reads as "at infinity")
    this.skyline.forEach((b, i) => {
      const x = e[0] + Math.cos(b.a) * SKY_RAD, z = e[2] + Math.sin(b.a) * SKY_RAD;
      this.skyInst.set(i, x, CITY_Y - 20, z, b.w, b.a, 1, 0, b.h / b.w);
      const blink = Math.max(0, Math.sin(t * 1.3 + b.ph)) ** 8;
      this.skyBeacon.set(i, x, CITY_Y - 20 + b.h + 1.5, z, 4, 0, 0.2 + blink * 0.8 + d.pulse * 0.3, 0, 1);
    });
    this.skyInst.upload(SKYLINE); this.skyBeacon.upload(SKYLINE);
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k), t = this.time;
    // gentle weave across the lane at idle, tighter racing line when playing
    this.lateral = Math.sin(t * 0.23) * lerp(1.3, 0.7, k) + Math.sin(t * 0.61) * 0.3;
    this.cam.update(a, k, dt);
    this.cam.target[1] -= 1.6; // look slightly down so the city shows past the barriers
    const bm = d.beatMotion;
    this.bassS = damp(this.bassS, d.bass, 0.5, dt);
    this.bassM = lerp(this.bassS, d.bass, bm); // bass reaches positions and scale directly only at Punchy
    this.fov = damp(this.fov, lerp(64, 72, k) + this.bassM * 12 * (0.3 + 0.7 * d.motion), lerp(0.5, 0.15, bm), dt);
    this.cam.fov = this.fov;
    this.cam.roll = this._rollAt(this.cam.s) * 0.85;
    this.scroll += dt * (0.15 + k * 0.6 + this.bassM * 2.6);

    if (d.beat) {
      this.padFlash.trigger(k);
      if (this.pulses.length < 6) this.pulses.push({ s: this.cam.s + 3, amp: k });
    }
    this.padFlash.update(dt);
    for (const p of this.pulses) { p.s += (PULSE_V + this.cam.speed) * dt; p.amp *= Math.exp(-dt / 1.1); }
    this.pulses = this.pulses.filter((p) => p.amp > 0.02);

    this._stripColors(k, d);
    this._scatterCity(k, d);

    // gantry lamps: switch on gantry by gantry, flare when the strobe passes
    const ng = this.gantries.length;
    this.gantries.forEach((g, i) => {
      const on = K.stage(k, 0.15 + (i / ng) * 0.5, 0.3 + (i / ng) * 0.5);
      const b = 0.18 + on * 0.6 * (0.9 + 0.1 * Math.sin(t * 11 + i)) + this._strobe(g.s) * 1.2;
      g.lamps.forEach((p, q) => this.lampInst.set(i * 3 + q, p[0], p[1] - 0.6, p[2], 1.4 + lerp(d.groove, d.pulse, d.beatMotion) * 0.6, 0, b, 0, 1));
    });
    this.lampInst.upload(ng * 3);

    // speed lines stream past in the camera frame
    const e = this.cam.eye, tg = this.cam.target, f = norm(sub(tg, e)), rt = norm(cross(f, [0, 1, 0])), up = cross(rt, f);
    const amount = K.stage(k, 0.25, 0.75) * (0.25 + Math.min(1, a.high * 1.6) * 0.45), rel = this.cam.speed * 1.3 + 12;
    const yaw = Math.atan2(f[0], f[2]);
    this.lines.forEach((l, i) => {
      l.z -= rel * dt;
      if (l.z < -8) l.z += 75;
      const fade = clamp((l.z + 8) / 8) * clamp((67 - l.z) / 20);
      const x = e[0] + f[0] * l.z + rt[0] * l.lat + up[0] * l.up, y = e[1] + f[1] * l.z + rt[1] * l.lat + up[1] * l.up, z = e[2] + f[2] * l.z + rt[2] * l.lat + up[2] * l.up;
      this.lineInst.set(i, x, y, z, l.len * (1 + this.bassM), yaw, amount * fade, 0, 1);
    });
    this.lineInst.upload(LINES);

    const sc = this._e; this._camPoint(this.cam.s + 6, sc, 0.3);
    this.sparks.update(dt, sc, { amount: K.stage(k, 0.2, 0.6) * Math.min(1, 0.15 + a.high * 1.8), speed: 1 + d.bass * 1.5, wind: [-f[0] * this.cam.speed * 0.6, -f[2] * this.cam.speed * 0.6] });
  }

  /** Strobe level at track position s from the beat pulses running ahead of the camera. */
  _strobe(s) {
    let v = 0;
    for (const p of this.pulses) {
      let dd = ((s - p.s) % this.L + this.L) % this.L; if (dd > this.L / 2) dd -= this.L;
      v += p.amp * Math.max(0, 1 - Math.abs(dd) / 9);
    }
    return v;
  }

  _stripColors(k, d) {
    const P = this.pal, c1 = P.color(R(1, 3)), c2 = P.color(R(2, 3)), col = this.stripGeo.colors, t = this.time;
    const chase = k * 0.35, dim = lerp(0.7, 1, k);
    for (let i = 0; i < this.N; i++) {
      const j = (i / LIGHT_SEG) | 0, o = this.stripOrder[j];
      const on = K.stage(k, o, o + 0.12);
      const base = (0.1 + on * 0.75 + chase * Math.max(0, Math.sin(t * 5 - j * 0.6)) ** 4 + d.high * 0.15 * on) * dim;
      const st = Math.min(1.2, this._strobe(i * this.ds));
      const rr = c1[0] * base + c2[0] * st, gg = c1[1] * base + c2[1] * st, bb = c1[2] * base + c2[2] * st;
      for (let v = 0, o3 = i * 36; v < 12; v++, o3 += 3) { col[o3] = rr; col[o3 + 1] = gg; col[o3 + 2] = bb; }
    }
    this.strip.update({ colors: col });
  }

  render(r) {
    const { col, k, tex } = this, a = this.a, P = this.pal, d = K.drive(a, k), eye = this.cam.eye, m = this.m;
    const dim = lerp(0.7, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    this.sky.draw(r, eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: dim, starLevel: 0.3 + d.high * 0.6 });

    // skyline silhouettes beyond the fog, slightly darker than the horizon
    scaleColor(col.sky, col.fog, 0.62);
    r.drawInstanced(this.block, this.skyInst, { unlit: true, fog: false, tint: [0, 0, 0], emissive: col.sky });

    r.setFog(col.fog, 12, lerp(88, 112, k));
    r.setLight([-0.35, -0.8, 0.45], scaleColor(col.light, P.role('light'), lerp(0.4, 0.75, k)), scaleColor(col.amb, P.role('ambient'), 0.42));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    // city
    mat4.trs(m, Math.round(eye[0] / CELL) * CELL, CITY_Y, Math.round(eye[2] / CELL) * CELL);
    r.draw(this.ground, m, { texture: tex.ground, tint: col.tint });
    r.drawInstanced(this.block, this.bInst, { texture: tex.facade, tint: col.tint });
    r.drawInstanced(this.pylonMesh, this.pylonInst, { texture: tex.metal, tint: col.tint });

    // track
    r.draw(this.road, undefined, { texture: tex.road, tint: col.tint });
    r.draw(this.wall, undefined, { texture: tex.wall, tint: col.tint });
    r.draw(this.strip, undefined, { unlit: true });
    r.draw(this.gantry, undefined, { texture: tex.metal, tint: col.tint });
    const sb = lerp(0.45, 1, K.stage(k, 0.1, 0.6)) * (0.92 + 0.08 * Math.sin(this.time * 17)) + d.pulse * 0.2;
    r.draw(this.signs, undefined, { texture: tex.sign, unlit: true, tint: [sb, sb, sb] });
    const pf = this.padFlash.v, pb = lerp(0.35, 0.65, k) + pf * 1.1 + 0.08 * Math.sin(this.time * 4);
    r.draw(this.pads, undefined, { texture: tex.pad, unlit: true, tint: [pb, pb, pb] });

    // additive glows last
    r.drawInstanced(this.block, this.wInst, { texture: tex.windows, unlit: true, additive: true, fog: false, tint: col.w });
    const cb = lerp(0.22, 0.75, k) + d.bass * 0.5;
    r.draw(this.road, undefined, { texture: tex.chev, unlit: true, additive: true, tint: [cb, cb, cb], uvOffset: [0, this.scroll] });
    r.drawInstanced(this.quad, this.beaconInst, { texture: tex.glowA, billboard: 2, unlit: true, additive: true, fog: false });
    r.drawInstanced(this.quad, this.skyBeacon, { texture: tex.glowA, billboard: 2, unlit: true, additive: true, fog: false });
    r.drawInstanced(this.quad, this.lampInst, { texture: tex.glowB, billboard: 2, unlit: true, additive: true });
    r.drawInstanced(this.lineMesh, this.lineInst, { texture: this.lineTex, unlit: true, additive: true });
    this.sparks.draw(r, { brightness: 1 });
  }

  dispose(r) {
    this.sky.dispose(r); this.sparks.dispose(r);
    [this.road, this.wall, this.strip, this.pads, this.gantry, this.signs, this.pylonMesh, this.block, this.ground, this.quad, this.lineMesh].forEach((x) => x.dispose());
    Object.values(this.tex).forEach((t) => r.deleteTexture(t));
    r.deleteTexture(this.lineTex);
    [this.lampInst, this.pylonInst, this.bInst, this.wInst, this.beaconInst, this.skyInst, this.skyBeacon, this.lineInst].forEach((x) => x.dispose());
  }
}
