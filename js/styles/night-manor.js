// NIGHT MANOR — a slow walk down an endless gothic hall at night.
//
//   stone floor tiles + crimson runner, pointed vault with transverse ribs
//   half-columns, tall lancet windows with an abstract stained-glass pattern
//   moonbeams + coloured window light on the floor (left wall)
//   dark portrait frames flanked by candelabras, wall sconces by the windows
//   hanging chandeliers that swing like pendulums, dust motes
//   endless: the hall is built from 12-unit bay pairs recycled beyond the fog
//
// Intensity: idle = nearly dark, a few stray candles, cold moonlight, slow walk.
// Swell = candles light one by one down the hall, chandeliers kindle, windows
// brighten, dust thickens. Beat = lightning outside (windows + light flash,
// double strike) and a camera nudge. Bass = chandeliers swing, flames flare.
// Highs = candle flicker and dust sparkle.
// Light (Kit v7): candelabras, sconces and chandeliers are point lights (K.LightSet keeps the
// best 4 near the camera); the nearest pairs use a finer floor / carpet / wall mesh so the
// pools of candlelight read.
// Colours: base = stone, secondary = carpet/wax-red, accent = flames/gilt,
// atmosphere = fog/moonlight/glass.
import { mat4, lerp, damp, clamp, hash } from '../gfx/math.js';
import { scaleColor, addColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, box, merge } from '../gfx/geometry.js';
import { bricks, blotch, CLEAR } from '../gfx/textures.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const BAY = 6, PAIR = 12, PAIRS = 8;          // a pair = two bays (window/portrait chequer)
const HW = 4.5, WALL_H = 5.5;                 // half width, vault springing height
const VR = 5.6, VCX = -HW + VR;               // vault arc radius / left arc centre x
const VAULT_APEX = WALL_H + Math.sqrt(VR * VR - VCX * VCX);
const CHAIN = 4.2;                            // chandelier hang length
const BAYS = PAIRS * 2;
const NEAR = 3;                               // pairs (from the camera's) drawn with the fine, candle-lit mesh

// ---------------------------------------------------------------- geometry
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Quad whose winding is flipped if needed so its face normal points along `want`. */
function quadFacing(g, p0, p1, p2, p3, t0, t1, t2, t3, want) {
  const n = cross(sub(p1, p0), sub(p2, p0));
  if (dot3(n, want) >= 0) g.quad(p0, p1, p2, p3, t0, t1, t2, t3);
  else g.quad(p0, p3, p2, p1, t0, t3, t2, t1);
}

/**
 * Pointed (gothic) arch curve in XY: left arc centred at +cx, right at -cx,
 * meeting at x = 0. Returns points from left springing to right springing.
 */
function pointedCurve(cx, rad, n) {
  const tmax = Math.acos(clamp(cx / rad, -1, 1)), left = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * tmax;
    left.push([cx - rad * Math.cos(t), rad * Math.sin(t)]);
  }
  const right = left.slice(0, n).reverse().map(([x, y]) => [-x, y]);
  return left.concat(right);
}

/** Arch band between two pointed curves (same point count), depth along Z. */
function archBand(inner, outer, depth, y0 = 0) {
  const g = new GeoBuilder(), d = depth / 2;
  for (let i = 0; i < inner.length - 1; i++) {
    const a = inner[i], b = inner[i + 1], c = outer[i + 1], e = outer[i];
    const P = (p, z) => [p[0], p[1] + y0, z];
    const u0 = i / (inner.length - 1) * 4, u1 = (i + 1) / (inner.length - 1) * 4;
    quadFacing(g, P(a, d), P(b, d), P(c, d), P(e, d), [u0, 1], [u1, 1], [u1, 0], [u0, 0], [0, 0, 1]);
    quadFacing(g, P(a, -d), P(b, -d), P(c, -d), P(e, -d), [u0, 1], [u1, 1], [u1, 0], [u0, 0], [0, 0, -1]);
    // soffit (underside) faces the arch centre
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], want = [-mid[0], -mid[1] * 0.3 - 0.5, 0];
    quadFacing(g, P(a, d), P(b, d), P(b, -d), P(a, -d), [u0, 0], [u1, 0], [u1, 0.5], [u0, 0.5], want);
  }
  return g.build();
}

/** Pointed barrel vault from z=0 to z=-len, faces pointing into the hall. */
function vault(len) {
  const c = pointedCurve(VCX, VR, 8), g = new GeoBuilder();
  let arc = 0;
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i], b = c[i + 1], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u0 = arc / 3, u1 = (arc + seg) / 3; arc += seg;
    const want = [-(a[0] + b[0]) / 2, -1, 0];
    quadFacing(g, [a[0], a[1] + WALL_H, 0], [b[0], b[1] + WALL_H, 0], [b[0], b[1] + WALL_H, -len], [a[0], a[1] + WALL_H, -len],
      [u0, 0], [u1, 0], [u1, len / 3], [u0, len / 3], want);
  }
  return g.build();
}

/** Lancet window glass in XY (facing +Z), bottom at y0, springing at y1. */
function lancet(w, y0, y1) {
  const a = w / 2, rad = a * 1.3, cx = -a + rad, top = y1 + Math.sqrt(rad * rad - cx * cx), H = top - y0;
  const uv = (x, y) => [(x + a) / w, (top - y) / H];
  const g = new GeoBuilder(), f = [0, 0, 1];
  const p = (x, y) => [x, y, 0];
  quadFacing(g, p(-a, y0), p(a, y0), p(a, y1), p(-a, y1), uv(-a, y0), uv(a, y0), uv(a, y1), uv(-a, y1), f);
  const c = pointedCurve(cx, rad, 6);
  for (let i = 0; i < c.length - 1; i++) {
    const A = c[i], B = c[i + 1];
    const n = cross(sub(p(A[0], A[1] + y1), p(0, y1)), sub(p(B[0], B[1] + y1), p(0, y1)));
    const tri = [p(0, y1), p(A[0], A[1] + y1), p(B[0], B[1] + y1)], tuv = [uv(0, y1), uv(A[0], A[1] + y1), uv(B[0], B[1] + y1)];
    if (n[2] >= 0) g.tri(tri[0], tri[1], tri[2], tuv[0], tuv[1], tuv[2]);
    else g.tri(tri[0], tri[2], tri[1], tuv[0], tuv[2], tuv[1]);
  }
  return { geo: g.build(), a, rad, cx, top };
}

const tr = (geo, dx, dy, dz) => K.props.shift(geo, dx, dy, dz);
/** Squeeze a geometry's 0..1 UVs into an atlas column [u0, u1]. */
function atlas(geo, u0, u1) {
  const t = geo.uvs;
  for (let i = 0; i < t.length; i += 2) t[i] = u0 + (t[i] - Math.floor(t[i] * 0.999)) * (u1 - u0);
  return geo;
}
const IRON = [0.06, 0.44], WAX = [0.56, 0.94];

/** Place local wall coords (x along wall, y up, z out of the wall) on a hall side. */
const onWall = (side, zc, lift = 0) => (p) => side < 0
  ? [-HW + p[2] + lift, p[1], zc - p[0]]
  : [HW - p[2] - lift, p[1], zc + p[0]];
const rotYp = (a, ox = 0, oy = 0, oz = 0) => (p) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * p[0] + s * p[2] + ox, p[1] + oy, -s * p[0] + c * p[2] + oz];
};

// candle "kit": cup + wax stub; returns parts and the flame point (local)
function candle(x, y, z, parts, flames, h = 0.24) {
  parts.push({ geo: atlas(K.props.prism(4, 0.07, 0.07, { cap: false }), ...IRON), xf: (p) => [p[0] + x, p[1] + y, p[2] + z] });
  parts.push({ geo: atlas(K.props.prism(4, 0.035, h), ...WAX), xf: (p) => [p[0] + x, p[1] + y + 0.07, p[2] + z] });
  flames.push([x, y + 0.07 + h, z]);
}

// ---------------------------------------------------------------- textures
const rnd = (x, y, s = 0) => hash(x * 1.31 + s * 7.7, y * 0.97 + s * 3.1);
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
function make(w, h, fn) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { data, width: w, height: h, indexed: true };
}

/** Abstract stained glass: leaded diamond quarries + a six-petal rose near the top. */
function stainedGlass() {
  const W = 32, H = 64, cx = 15.5, cy = 17;
  return make(W, H, (x, y) => {
    if (x === 0 || x === W - 1 || y === H - 1) return R(0, 0);
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d < 11) {
      if (Math.abs(d - 10.5) < 0.7 || Math.abs(d - 3.5) < 0.6) return R(0, 0);
      if (d < 3.5) return d < 1.6 ? R(2, 3) : R(2, 2);
      const a = Math.atan2(dy, dx), seg = Math.floor(((a / (Math.PI * 2)) + 1) * 6) % 6;
      const edge = Math.abs(((a / (Math.PI * 2)) * 6 % 1 + 1) % 1 - 0.5) > 0.45;
      if (edge) return R(0, 0);
      return seg % 2 ? R(1, d > 7 ? 2 : 3) : R(2, d > 7 ? 1 : 2);
    }
    if (y === 30 || y === 31) return R(0, 0);
    if ((x + y) % 8 === 0 || ((x - y) % 8 + 8) % 8 === 0) return R(0, 0);
    const qi = Math.floor((x + y) / 8), qj = Math.floor((x - y + 64) / 8), h = rnd(qi, qj, 4);
    if (y > 31 && x > 11 && x < 20 && y < 58) return h > 0.5 ? R(1, 2) : R(2, 1);   // central light
    return h < 0.12 ? R(1, 1) : h < 0.55 ? R(3, 2) : R(3, 3);
  });
}

/** Carpet runner: crimson field, faint lattice, gilt-dark borders. */
function carpet() {
  return make(32, 64, (x, y) => {
    if (x < 2 || x > 29) return R(2, 0);
    if (x === 3 || x === 28) return R(1, 0);
    const lat = ((x + y) % 12 === 0) || (((x - y) % 12 + 12) % 12 === 0);
    if (lat) return R(1, 0);
    return rnd(x, y, 2) > 0.9 ? R(1, 2) : R(1, 1);
  });
}

/** Portrait: dark carved frame around a near-black, faintly varnished canvas. */
function portrait() {
  return make(32, 48, (x, y) => {
    const e = Math.min(x, y, 31 - x, 47 - y);
    if (e < 1) return R(0, 0);
    if (e < 4) return (e === 2 ? R(2, 1) : R(2, 0));
    if (e < 5) return R(0, 0);
    const v = rnd(x >> 2, y >> 2, 9) * 0.6 + rnd(x, y, 3) * 0.4;
    return v > 0.86 ? R(3, 1) : v > 0.55 ? R(3, 0) : R(0, 0);
  });
}

/** Iron (left half) + wax (right half) atlas. */
function propAtlas() {
  return make(16, 16, (x, y) => x < 8 ? (rnd(x, y, 5) > 0.75 ? R(0, 1) : R(0, 0)) : (y < 3 ? R(3, 3) : rnd(x, y, 6) > 0.7 ? R(3, 2) : R(3, 3)));
}

/** Moonbeam: dithered, densest near the window (v = 0), thinning toward the floor. */
function beam() {
  return make(16, 32, (x, y) => (bayer(x, y) < 0.55 - (y / 31) * 0.4 ? R(3, 3) : CLEAR));
}

// ---------------------------------------------------------------- pendulum
/** Lightly damped pendulum (the kit Spring is critically damped and won't swing). */
class Pendulum {
  constructor(freq = 1.5, damping = 0.18) { this.w = freq; this.c = damping; this.x = 0; this.v = 0; }
  push(a) { this.v += a; }
  update(dt) {
    this.v += (-this.w * this.w * this.x - this.c * this.v) * dt;
    this.x += this.v * dt;
    if (Math.abs(this.x) > 0.28) { this.x = Math.sign(this.x) * 0.28; this.v *= 0.5; }
    return this.x;
  }
}

const hallPath = (s, out) => {
  out[0] = Math.sin(s * 0.021) * 0.7;
  out[1] = 1.72 + Math.sin(s * 4.2) * 0.025;   // footsteps
  out[2] = -s;
  return out;
};

export class NightManor {
  static meta = { name: 'Night Manor' };
  static palette = fromKeys('night-manor', 'Night Manor', ['#7c8190', '#8e1f2c', '#f0b250', '#1b2338'], { flash: R(3, 3) });

  init(r) {
    // ---- textures
    this.tex = {
      floor: r.texture(K.props.tiles({ ramp: 0, grout: R(3, 0), cells: 4, cracked: 0.2 })),
      stone: r.texture(bricks({ ramp: 0, mortar: R(3, 0), rows: 6, cols: 3 })),
      vault: r.texture(blotch({ ramp: 0, scale: 6, seed: 7, minShade: 0 })),
      carpet: r.texture(carpet()),
      glass: r.texture(stainedGlass()),
      portrait: r.texture(portrait()),
      props: r.texture(propAtlas()),
      beam: r.texture(beam()),
      flame: r.texture(K.sprites.flame({ ramp: 2 })),
      glow: r.texture(K.sprites.glow({ ramp: 2 })),
    };

    // ---- one bay pair: bay 0 = window left / portrait right, bay 1 = the reverse
    const stone = [], glass = [], beams = [], patches = [], portraits = [], props = [];
    this.flames = [];   // [x, y, z] pair-local candle tips
    this.halos = [];    // [x, y, z, size] pair-local glow positions
    // subdivided so affine texture warping stays PS1-plausible near the camera; the fine
    // versions (near pairs) are dense enough for per-vertex candlelight
    const floorGeo = (n) => new GeoBuilder().face([0, 0, -PAIR / 2], [HW, 0, 0], [0, 0, -PAIR / 2], [0, 0, 3, 4], n).build();
    const carpetGeo = (n) => new GeoBuilder().face([0, 0.03, -PAIR / 2], [1.3, 0, 0], [0, 0, -PAIR / 2], [0, 0, 1, PAIR / 2.6], n).build();
    const wallGeo = (n) => {
      const gw = new GeoBuilder();
      for (const side of [-1, 1]) gw.face([side * HW, WALL_H / 2, -PAIR / 2], [0, 0, side * PAIR / 2], [0, WALL_H / 2, 0], [0, WALL_H / 2.5, PAIR / 2.5, 0], n);
      return gw.build();
    };
    // half-columns + transverse ribs at both bay boundaries
    const ribIn = pointedCurve(VCX, VR - 0.5, 8), ribOut = pointedCurve(VCX, VR + 0.02, 8);
    for (const zb of [0, -BAY]) {
      for (const side of [-1, 1]) {
        const px = side * (HW - 0.3);
        stone.push({ geo: tr(box(1.0, 0.4, 1.0, { uvRepeat: [0.5, 0.2] }), px, 0.2, zb) });
        stone.push({ geo: K.props.prism(8, 0.38, WALL_H - 0.4, { uvRepeat: [1.5, 2.2] }), xf: (p) => [p[0] + px, p[1] + 0.4, p[2] + zb] });
        stone.push({ geo: tr(box(1.0, 0.35, 1.0, { uvRepeat: [0.5, 0.2] }), px, WALL_H - 0.18, zb) });
      }
      stone.push({ geo: archBand(ribIn, ribOut, 0.7, WALL_H), xf: (p) => [p[0], p[1], p[2] + zb] });
    }
    // windows, frames, sconces, beams
    const win = lancet(1.6, 1.3, 4.3), fr = 0.22;
    const frameIn = pointedCurve(win.cx, win.rad, 6), frameOut = pointedCurve(win.cx, win.rad + fr, 6);
    const placeWindow = (side, zc) => {
      const W = onWall(side, zc);
      glass.push({ geo: win.geo, xf: onWall(side, zc, 0.04) });
      for (const sx of [-1, 1]) stone.push({ geo: tr(box(fr, 3.0, 0.3, { uvRepeat: [0.2, 1.2] }), sx * (win.a + fr / 2), 2.8, 0.15), xf: W });
      stone.push({ geo: archBand(frameIn, frameOut, 0.3, 4.3), xf: (p) => W([p[0], p[1], p[2] + 0.15]) });
      stone.push({ geo: tr(box(win.a * 2 + 0.7, 0.18, 0.5, { uvRepeat: [1, 0.1] }), 0, 1.21, 0.25), xf: W });
      for (const sx of [-1.35, 1.35]) {
        props.push({ geo: atlas(tr(box(0.08, 0.08, 0.4), sx, 2.3, 0.2), ...IRON), xf: W });
        const parts = [], f = [];
        candle(sx, 2.34, 0.38, parts, f);
        for (const pt of parts) props.push({ geo: pt.geo, xf: (p) => W(pt.xf(p)) });
        const tip = W(f[0]); this.flames.push(tip); this.halos.push([tip[0], tip[1] + 0.1, tip[2], 1.0]);
      }
      if (side < 0) {
        // moonbeam plane from the window head down to the floor, plus coloured light on the floor
        const z0 = zc + win.a, z1 = zc - win.a, xw = -HW + 0.1, slope = 0.7;
        const xTop = xw + 5.0 * slope, xBot = xw + 1.3 * slope;
        const gb = new GeoBuilder();
        quadFacing(gb, [xw, 5.0, z0], [xw, 5.0, z1], [xTop, 0.05, z1], [xTop, 0.05, z0], [0, 0], [1, 0], [1, 1], [0, 1], [1, 1, 0]);
        beams.push({ geo: gb.build() });
        const gp = new GeoBuilder();
        quadFacing(gp, [xTop, 0.06, z0], [xTop, 0.06, z1], [xBot, 0.06, z1], [xBot, 0.06, z0], [0, 0], [1, 0], [1, 1], [0, 1], [0, 1, 0]);
        patches.push({ geo: gp.build() });
      }
    };
    const placePortrait = (side, zc) => {
      const W = onWall(side, zc);
      portraits.push({ geo: tr(box(1.5, 1.95, 0.1), 0, 2.75, 0.06), xf: W });
      for (const sx of [-1.45, 1.45]) {
        const parts = [], f = [];
        parts.push({ geo: atlas(K.props.prism(6, 0.24, 0.1), ...IRON) });
        parts.push({ geo: atlas(K.props.prism(6, 0.035, 1.35), ...IRON), xf: (p) => [p[0], p[1] + 0.1, p[2]] });
        parts.push({ geo: atlas(tr(box(0.85, 0.05, 0.05), 0, 1.45, 0), ...IRON) });
        for (const cx of [-0.4, 0, 0.4]) candle(cx, cx === 0 ? 1.55 : 1.47, 0, parts, f, cx === 0 ? 0.3 : 0.24);
        parts.push({ geo: atlas(tr(box(0.05, 0.1, 0.05), 0, 1.5, 0), ...IRON) });
        const local = (p) => W([p[0] + sx, p[1], p[2] + 0.55]);
        for (const pt of parts) { const inner = pt.xf || ((p) => p); props.push({ geo: pt.geo, xf: (p) => local(inner(p)) }); }
        for (const tip of f) this.flames.push(local(tip));
        const c = local([0, 1.75, 0]); this.halos.push([c[0], c[1], c[2], 1.7]);
      }
    };
    placeWindow(-1, -BAY / 2); placePortrait(1, -BAY / 2);
    placePortrait(-1, -BAY * 1.5); placeWindow(1, -BAY * 1.5);

    this.mesh = {
      floor: r.createMesh(floorGeo(4)), carpet: r.createMesh(carpetGeo(4)), walls: r.createMesh(wallGeo(3)),
      floorFine: r.createMesh(floorGeo(12)), carpetFine: r.createMesh(carpetGeo(9)), wallsFine: r.createMesh(wallGeo(9)),
      stone: r.createMesh(merge(stone)), vault: r.createMesh(vault(PAIR)),
      glass: r.createMesh(merge(glass)), beams: r.createMesh(merge(beams)), patches: r.createMesh(merge(patches)),
      portraits: r.createMesh(merge(portraits)), props: r.createMesh(merge(props)),
      quad: r.createMesh(K.billboardQuad(1, 1)),
      pool: r.createMesh(new GeoBuilder().face([0, 0, 0], [0.5, 0, 0], [0, 0, -0.5], [0, 0, 1, 1]).build()),
    };

    // ---- chandelier (pivot at the ceiling, hangs down -Y)
    const ch = [], chTips = [];
    ch.push({ geo: atlas(tr(box(0.05, CHAIN, 0.05), 0, -CHAIN / 2, 0), ...IRON) });
    ch.push({ geo: atlas(K.props.prism(6, 0.16, 0.5, { taper: 0.4 }), ...IRON), xf: (p) => [p[0], -p[1] - CHAIN + 0.5, p[2]] });
    const RING = 0.9;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6, len = RING + 0.06;
      ch.push({ geo: atlas(box(len, 0.06, 0.06), ...IRON), xf: rotYp(a + Math.PI / 2, Math.cos(a) * RING * Math.cos(Math.PI / 6), -CHAIN, -Math.sin(a) * RING * Math.cos(Math.PI / 6)) });
    }
    for (let i = 0; i < 3; i++) ch.push({ geo: atlas(tr(box(RING * 2, 0.04, 0.04), 0, -CHAIN + 0.02, 0), ...IRON), xf: rotYp((i / 3) * Math.PI) });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, f = [];
      const parts = [];
      candle(0, 0, 0, parts, f, 0.22);
      const px = Math.cos(a) * RING * 0.93, pz = Math.sin(a) * RING * 0.93;
      for (const pt of parts) ch.push({ geo: pt.geo, xf: (p) => [p[0] + px, p[1] - CHAIN + 0.03, p[2] + pz] });
      chTips.push([px, f[0][1] - CHAIN + 0.03, pz]);
    }
    this.mesh.chandelier = r.createMesh(merge(ch));
    this.chTips = chTips;

    // ---- instances
    this.pairInst = r.createInstances(PAIRS);
    this.nearInst = r.createInstances(NEAR); this.farInst = r.createInstances(PAIRS - NEAR);
    this.lights = new K.LightSet({ cap: 128, reach: 5 });
    this.lights.g = this.halos.map((h) => h[3] > 1.2);   // candelabra (true) or sconce
    this.flameInst = r.createInstances(PAIRS * this.flames.length + BAYS * chTips.length);
    this.haloInst = r.createInstances(PAIRS * this.halos.length + BAYS);
    this.poolInst = r.createInstances(PAIRS * 4 + BAYS);
    this.dust = new K.Particles(r, 'dust', { count: 320, area: [10, 7, 26], yOffset: 1.6, color: R(3, 3) });

    this.cam = new K.PathRig(hallPath, { lookAhead: 10, idleSpeed: 0.55, activeSpeed: 2.2, bassBoost: 1.2, fov: 62, nudge: 0.22, rollKick: 0.025, fovPunch: 3, far: 140 });
    this.swingX = new Pendulum(1.5, 0.16); this.swingZ = new Pendulum(1.42, 0.2);
    this.histX = new K.History(90); this.histZ = new K.History(90);
    this.flash = new K.Envelope(0.1); this.after = new K.Envelope(0.35);
    this.strike2 = -1; this.strike2Amt = 0;
    this.flare = new K.Envelope(0.25);
    this.time = 0; this.k = 0; this.a = null; this.d = null; this.bassS = 0; this.lvlS = 0;
    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], dim: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], warm: [0, 0, 0], focus: [0, 0, 0], win: [0, 0, 0], winE: [0, 0, 0], beam: [0, 0, 0], one: [1, 1, 1], tmp: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt; this.dt = dt;
    const d = this.d = K.drive(a, k);
    this.cam.update(a, k, dt);
    const t = this.cam.target;
    t[0] += Math.sin(this.time * 0.07) * 1.3;
    t[1] += 0.7 + Math.sin(this.time * 0.11) * 0.45;

    // lightning: main strike + a weaker second flicker shortly after
    if (d.beat) {
      this.flash.trigger(k); this.after.trigger(k * 0.6); this.flare.trigger(k);
      if (Math.random() < 0.6) { this.strike2 = 0.07 + Math.random() * 0.08; this.strike2Amt = k * (0.4 + Math.random() * 0.4); }
    }
    if (this.strike2 > 0 && (this.strike2 -= dt) <= 0) this.flash.trigger(this.strike2Amt);
    this.flash.update(dt); this.after.update(dt); this.flare.update(dt);

    // chandeliers: bass pumps the swing in phase with its motion (resonance), so it builds up
    const sx = this.swingX, sz = this.swingZ;
    // Gentle: no beat kick, bass reaches the swing only eased; the smooth groove swing keeps the hall rocking
    this.bassS = damp(this.bassS, d.bass, 0.5, dt);
    const bm = d.beatMotion, bass = lerp(this.bassS, d.bass, bm);
    sx.push((sx.v >= 0 ? 1 : -1) * (bass * 0.07 + d.groove * (1 - bm) * 0.04) * dt + (d.beat ? (sx.v >= 0 ? 1 : -1) * 0.03 * k * bm : 0));
    sz.push((sz.v >= 0 ? 1 : -1) * (bass * 0.04 + d.groove * (1 - bm) * 0.025) * dt);
    sx.update(dt); sz.update(dt);
    this.histX.push(sx.x); this.histZ.push(sz.x);

    this.dust.update(dt, this.cam.eye, { amount: K.swell(k, 0.3, 1), speed: 0.6 + lerp(this.lvlS = damp(this.lvlS, d.level, 0.5, dt), d.level, bm) * 1.2, wind: [0, -0.15] });
  }

  render(r) {
    const { col, k, m, mesh, tex } = this, P = this.pal, d = this.d, eye = this.cam.eye, time = this.time;
    const fl = this.flash.v, glowAll = clamp(fl + this.after.v * 0.4);

    // ---- atmosphere + light
    scaleColor(col.fog, P.role('fog'), lerp(0.42, 0.75, k));
    addColor(col.fog, col.fog, P.role('flash'), fl * 0.12);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 2, lerp(30, 56, k));
    const candleWarm = K.stage(k, 0.05, 0.8);
    scaleColor(col.light, P.role('light'), lerp(0.32, 0.5, k));
    mixColor(col.light, col.light, P.role('flash'), clamp(fl * 1.2));
    scaleColor(col.amb, P.role('ambient'), lerp(0.2, 0.26, k));
    addColor(col.amb, col.amb, P.role('glow'), 0.04 + candleWarm * 0.2 + d.bass * 0.05);
    r.setLight([0.65, -0.7, -0.15], col.light, col.amb);
    const dim = lerp(0.62, 1, k);
    col.dim[0] = col.dim[1] = col.dim[2] = dim;

    // ---- the hall: bay pairs recycled beyond the fog
    const s = this.cam.s, pb = Math.floor(s / PAIR) - 1;
    for (let i = 0; i < PAIRS; i++) this.pairInst.set(i, 0, 0, -(pb + i) * PAIR, 1, 0, 1, 0, 1);
    this.pairInst.upload(PAIRS);
    for (let i = 0; i < PAIRS; i++) {
      const z = -(pb + i) * PAIR;
      if (i >= 1 && i <= NEAR) this.nearInst.set(i - 1, 0, 0, z, 1, 0, 1, 0, 1); else this.farInst.set(i < 1 ? 0 : i - NEAR, 0, 0, z, 1, 0, 1, 0, 1);
    }
    this.nearInst.upload(NEAR); this.farInst.upload(PAIRS - NEAR);
    const pi = this.pairInst;
    this._lights(r, s, pb);
    for (const [inst, fine] of [[this.nearInst, true], [this.farInst, false]]) {
      r.drawInstanced(fine ? mesh.floorFine : mesh.floor, inst, { texture: tex.floor, tint: col.dim });
      r.drawInstanced(fine ? mesh.carpetFine : mesh.carpet, inst, { texture: tex.carpet, tint: col.dim });
      r.drawInstanced(fine ? mesh.wallsFine : mesh.walls, inst, { texture: tex.stone, tint: col.dim });
    }
    r.drawInstanced(mesh.stone, pi, { texture: tex.stone, tint: col.dim });
    scaleColor(col.tmp, col.dim, 0.75);
    r.drawInstanced(mesh.vault, pi, { texture: tex.vault, tint: col.tmp });
    r.drawInstanced(mesh.portraits, pi, { texture: tex.portrait, tint: col.dim });
    r.drawInstanced(mesh.props, pi, { texture: tex.props, tint: col.dim });

    // windows: moonlit at idle, brighter as the band swells, white-hot on lightning
    const winLvl = lerp(0.42, 0.75, K.stage(k, 0.1, 0.7)) + d.high * 0.15;
    col.win[0] = col.win[1] = col.win[2] = winLvl + glowAll * 1.4;
    scaleColor(col.winE, P.role('flash'), glowAll * 0.55);
    r.drawInstanced(mesh.glass, pi, { texture: tex.glass, unlit: true, tint: col.win, emissive: col.winE });

    // ---- chandeliers (individually: each swings, the swing ripples down the hall)
    const bb = pb * 2, fogFar = lerp(30, 56, k);
    let nf = 0, nh = 0, np = 0;
    const fi = this.flameInst, hi = this.haloInst, po = this.poolInst;
    const idleSway = Math.sin(time * 1.3) * 0.012;
    for (let j = 0; j < BAYS; j++) {
      const b = bb + j, z = -b * BAY - BAY / 2, rel = -z - s, dist = Math.max(0, rel);
      if (rel < -8 || rel > fogFar + 8) continue;   // hidden behind the camera or in the fog
      const rx = this.histX.at(clamp(dist / 70)) + idleSway * Math.sin(b * 1.7);
      const rz = this.histZ.at(clamp(dist / 70)) + idleSway * Math.cos(b * 2.3);
      mat4.trs(m, 0, VAULT_APEX - 0.1, z, rx, 0, rz);
      r.draw(mesh.chandelier, m, { texture: tex.props, tint: col.dim });
      // lit in sequence down the hall; distant ones stay dark until intensity is high
      const on = K.stage(k, 0.25 + clamp(dist / 60) * 0.5 + hash(b, 3) * 0.08, 0.45 + clamp(dist / 60) * 0.5 + hash(b, 3) * 0.08);
      const cx = Math.cos(rx), sxr = Math.sin(rx), cz = Math.cos(rz), szr = Math.sin(rz);
      for (let c = 0; c < this.chTips.length; c++) {
        const [px, py, pz] = this.chTips[c];
        const x1 = px * cz - py * szr, y1 = px * szr + py * cz;          // Rz
        const y2 = y1 * cx - pz * sxr, z2 = y1 * sxr + pz * cx;          // then Rx
        const ph = b * 5.1 + c * 1.9, f = this._flick(ph, d);
        fi.set(nf++, x1, y2 + VAULT_APEX - 0.1, z2 + z, 0.16 * (0.5 + 0.5 * on) * (1 + d.bass * 0.5 + this.flare.v * 0.3) * f, 0, on * f, 0, 1.9);
      }
      const cy = VAULT_APEX - 0.1 - CHAIN * Math.cos(rx) * Math.cos(rz) + 0.2;
      const hs = 2.6 * (1 + d.bass * 0.35);
      hi.set(nh++, CHAIN * szr, cy - hs * 0.5, z - CHAIN * cz * sxr, hs, 0, on * 0.5 * (0.9 + d.high * 0.3), 0, 1);
      po.set(np++, 0, 0.05, z, 6.5 * (1 + d.bass * 0.15), 0, on * 0.3, 0, 1);
    }

    // ---- candles: a few always burn; the rest light one by one down the hall
    const nc = this.flames.length;
    for (let i = 0; i < PAIRS; i++) {
      const pz = -(pb + i) * PAIR;
      for (let c = 0; c < nc; c++) {
        const [x, y, z0] = this.flames[c], z = z0 + pz, id = (pb + i) * 64 + c;
        const on = this._candleOn(id, -z - s, k);
        const f = this._flick(id * 2.7, d);
        fi.set(nf++, x, y - 0.01, z, 0.13 * (0.6 + 0.4 * on) * (1 + d.bass * 0.7 + this.flare.v * 0.4) * f, 0, on * f, 0, 2);
      }
      for (let h = 0; h < this.halos.length; h++) {
        const [x, y, z0, size] = this.halos[h], z = z0 + pz, id = (pb + i) * 64 + 40 + h;
        // a halo burns as bright as its nearest candles: reuse the first candle of its group
        const on = this._candleOn((pb + i) * 64 + this._haloCandle(h), -z - s, k);
        hi.set(nh++, x, y - size * 0.5, z, size * (1 + d.bass * 0.4), 0, on * 0.45 * this._flick(id, d), 0, 1);
        if (size > 1.2) po.set(np++, x * 0.92, 0.05, z, 2.6, 0, on * 0.22, 0, 1);
      }
    }
    fi.upload(nf); hi.upload(nh); po.upload(np);

    // additive light last: pools, moonbeams, window light on the floor, halos, flames, dust
    r.drawInstanced(mesh.pool, po, { texture: tex.glow, unlit: true, additive: true, tint: col.one });
    const beamLvl = lerp(0.1, 0.16, k) + glowAll * 0.6;
    col.beam[0] = col.beam[1] = col.beam[2] = beamLvl;
    r.drawInstanced(mesh.beams, pi, { texture: tex.beam, unlit: true, additive: true, tint: col.beam });
    scaleColor(col.tmp, col.one, 0.16 + k * 0.08 + glowAll * 0.9);
    r.drawInstanced(mesh.patches, pi, { texture: tex.glass, unlit: true, additive: true, tint: col.tmp });
    r.drawInstanced(mesh.quad, hi, { texture: tex.glow, billboard: 2, unlit: true, additive: true, tint: col.one });
    r.drawInstanced(mesh.quad, fi, { texture: tex.flame, billboard: 1, unlit: true, additive: true, tint: col.one });
    this.dust.draw(r, { brightness: lerp(0.5, 1, k) * (0.55 + d.high * 1.2 + glowAll * 1.2) });
  }

  /** Point lights: every candelabra / sconce / chandelier is a candidate, the LightSet keeps the best 4. */
  _lights(r, s, pb) {
    const { col, k, d } = this, L = this.lights, eye = this.cam.eye, tg = this.cam.target;
    // warm candle colour; a lightning strike washes it out a little, the bass flares it
    scaleColor(col.warm, this.pal.role('glow'), 1 + d.bass * 0.35 + this.flare.v * 0.3);
    const fx = tg[0] - eye[0], fy = tg[1] - eye[1], fz = tg[2] - eye[2], fn = Math.hypot(fx, fy, fz) || 1;
    col.focus[0] = eye[0] + (fx / fn) * 5; col.focus[1] = eye[1]; col.focus[2] = eye[2] + (fz / fn) * 5;
    L.begin();
    for (let i = 1; i <= NEAR + 1; i++) {
      const pz = -(pb + i) * PAIR;
      for (let h = 0; h < this.halos.length; h++) {
        const [x, y, z0] = this.halos[h], z = z0 + pz, big = L.g[h];
        const on = this._candleOn((pb + i) * 64 + this._haloCandle(h), -z - s, k);
        if (on <= 0.01) continue;
        const f = this._flick((pb + i) * 64 + 40 + h, d);
        // pulled a little off the wall so the wall behind lights as a pool, not a hot spot
        L.add((pb + i) * 64 + h, x * 0.86, y - 0.1, z, col.warm, big ? 6 : 4, on * f * (big ? 2 : 1.2));
      }
    }
    // chandeliers: the light hangs with the swinging ring
    const bb = pb * 2;
    for (let j = 1; j < (NEAR + 1) * 2; j++) {
      const b = bb + j, z = -b * BAY - BAY / 2, dist = Math.max(0, -z - s);
      const on = K.stage(k, 0.25 + clamp(dist / 60) * 0.5 + hash(b, 3) * 0.08, 0.45 + clamp(dist / 60) * 0.5 + hash(b, 3) * 0.08);
      if (on <= 0.01) continue;
      const rx = this.histX.at(clamp(dist / 70)), rz = this.histZ.at(clamp(dist / 70));
      const y = VAULT_APEX - 0.1 - CHAIN * Math.cos(rx) * Math.cos(rz);
      L.add(1e6 + b, CHAIN * Math.sin(rz), y - 0.3, z - CHAIN * Math.sin(rx), col.warm, 11, on * 2.4 * this._flick(b * 5.1, d));
    }
    L.apply(r, col.focus, this.dt);
  }

  /** Candle brightness 0..1. ~1 in 6 burn even at idle; others swell in by distance. */
  _candleOn(id, dist, k) {
    const h = hash(id, 11);
    const base = h < 0.17 ? 0.75 : 0;
    const from = 0.04 + clamp(dist / 55) * 0.6 + hash(id, 12) * 0.12;
    return Math.max(base, K.stage(k, from, from + 0.12));
  }

  _haloCandle(h) {
    // halos: per window 2 sconces (1 candle each), per portrait 2 candelabras (3 candles each)
    if (!this._hc) {
      this._hc = []; let c = 0;
      // build order: window(L) sconces, portrait(R) candelabras, portrait(L), window(R)
      const groups = [[1, 1], [3, 3], [3, 3], [1, 1]];
      for (const g of groups) for (const n of g) { this._hc.push(c + (n === 3 ? 1 : 0)); c += n; }
    }
    return this._hc[h];
  }

  _flick(ph, d) {
    const t = this.time;
    return 0.86 + 0.1 * Math.sin(t * 9 + ph) + 0.05 * Math.sin(t * 23 + ph * 1.7) + d.high * 0.35 * Math.sin(t * 41 + ph * 3.1);
  }

  dispose(r) {
    Object.values(this.mesh).forEach((m) => m.dispose());
    Object.values(this.tex).forEach((t) => r.deleteTexture(t));
    [this.pairInst, this.nearInst, this.farInst, this.flameInst, this.haloInst, this.poolInst].forEach((i) => i.dispose());
    this.dust.dispose(r);
  }
}
