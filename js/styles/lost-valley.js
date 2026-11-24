// LOST VALLEY — gliding low through a misty jungle valley at dawn.
//
//   ring-shaped valley (ridged hills both sides)    K.Terrain + K.ridged
//   dense instanced broadleaf / pine / fern / grass  r.drawInstanced(..., { billboard: 1, sway })
//   overgrown stone ruins (temple, colonnade, gate) kit props merged into 2 meshes
//   two waterfalls: scrolling indexed panel + mist  uvOffset + K.Particles
//   huge original low-poly beasts walking the ridges box/prism parts, drawn with their own fog
//   flocks of birds that take off as the band swells K.stage
//
// Intensity: idle = dawn mist, thick green fog, slow glide, beasts barely
// visible. Playing = fog thins and warms, faster flight, birds take off,
// fireflies + pollen. Beat = a beast's footstep (camera tremor, ripple through
// the trees, the beast dips). Bass = foliage sway. Highs = sparkle.
import { mat4, lerp, damp, clamp, smoothstep } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { CLEAR, grain } from '../gfx/textures.js';
import { box, merge, GeoBuilder } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

// ---------------------------------------------------------------- world shape
const RING = 72; // the valley floor is a closed loop around the origin
const ringR = (a) => RING + Math.sin(a * 3 + 0.4) * 10 + Math.sin(a * 5 + 1.3) * 5;
/** Distance from the valley's centre line. */
const valleyOff = (x, z) => Math.abs(Math.hypot(x, z) - ringR(Math.atan2(z, x)));
function valleyHeight(x, z) {
  const v = smoothstep(clamp((valleyOff(x, z) - 7) / 38));
  const hills = (0.55 + 0.45 * K.ridged(x * 0.012, z * 0.012, { octaves: 3 })) * 26;
  return v * hills + K.fbm(x * 0.05, z * 0.05, { octaves: 2, seed: 5 }) * 3 - 1.5;
}
/** World position at valley angle a, `off` units off the centre line (+ = outer side). */
const valleyPos = (a, off) => { const rr = ringR(a) + off; return [Math.cos(a) * rr, Math.sin(a) * rr]; };

const TREE_CELL = 6, TREE_RAD = 15, TREE_FADE = [78, 90];
const FERN_CELL = 2.5, FERN_RAD = 10, FERN_FADE = [18, 25];
const fadeOut = (d, [a, b]) => 1 - smoothstep((d - a) / (b - a));

// ---------------------------------------------------------------- local textures (indexed)
const rnd = (x, y, s = 0) => { const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return h - Math.floor(h); };
function make(w, h, fn) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { data, width: w, height: h, indexed: true };
}
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dshade = (ramp, s, x, y) => {
  s = clamp(s, 0, 3); const f = Math.floor(s);
  return R(ramp, Math.min(3, f + (s - f > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 1 : 0)));
};
/** Smooth-ish blob noise in [0,1) from the hash, for moss patches. */
const blobN = (x, y, sc, s) => {
  const fx = x / sc, fy = y / sc, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
  const a = rnd(ix, iy, s), b = rnd(ix + 1, iy, s), c = rnd(ix, iy + 1, s), d = rnd(ix + 1, iy + 1, s);
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
};

/** Cut stone blocks with mortar, overgrown with moss (ramp 1) creeping down from the top. */
function mossStone({ seed = 1, rows = 4, carve = false } = {}) {
  const rh = 64 / rows;
  return make(64, 64, (x, y) => {
    const row = Math.floor(y / rh), off = row % 2 ? 8 : 0, bx = Math.floor((x + off) / 16);
    const lx = (x + off) % 16, ly = y % rh;
    const moss = blobN(x, y, 10, seed) + (1 - y / 64) * 0.35;
    if (moss > 0.92) return dshade(1, 0.8 + (moss - 0.92) * 14 + rnd(x, y, seed) * 0.6, x, y);
    if (lx === 0 || ly === 0) return moss > 0.7 ? R(1, 0) : R(0, 0);
    if (carve && rnd(bx, row, seed + 3) > 0.6 && lx > 3 && lx < 13 && ly > 3 && ly < rh - 3 && ((lx === 4 || lx === 12 || ly === 4 || ly === rh - 4) || (lx === 8 && ly > 5)))
      return R(0, 0);
    return grain(R(0, rnd(bx, row, seed) > 0.55 ? 2 : 1), x, y, 0.3, seed);
  });
}
/** Raw cliff rock with mossy ledges. */
function cliffRock({ seed = 7 } = {}) {
  return make(64, 64, (x, y) => {
    const ledge = (y + Math.floor(rnd(x >> 3, 0, seed) * 6)) % 16;
    if (ledge < 2) return dshade(1, 1.2 + rnd(x, y, seed), x, y);
    const v = blobN(x, y, 6, seed) * 0.7 + rnd(x >> 1, y >> 1, seed) * 0.3;
    return dshade(0, 0.6 + v * 2.2 - ledge / 32, x, y);
  });
}
/** Jungle floor: green ramp with patches of stone/earth. */
function jungleFloor({ seed = 3 } = {}) {
  return make(64, 64, (x, y) => {
    const v = blobN(x, y, 12, seed);
    if (v > 0.78) return grain(R(0, rnd(x >> 2, y >> 2, seed) > 0.5 ? 1 : 2), x, y, 0.3, seed);
    return dshade(1, 0.7 + blobN(x, y, 5, seed + 1) * 1.6 + rnd(x, y, seed) * 0.4, x, y);
  });
}
/** Falling water streaks (narrow, tiles vertically). Scroll with uvOffset. */
function waterfallTex() {
  return make(16, 64, (x, y) => {
    const ph = Math.floor(rnd(x, 0, 2) * 64), len = 6 + Math.floor(rnd(x, 1, 2) * 18);
    const sy = (y + ph) % 64;
    if (sy < len) return sy < 2 ? R(3, 3) : R(3, rnd(x, 3, 2) > 0.4 ? 3 : 2);
    const r = rnd(x, y >> 3, 4);
    return r > 0.8 ? R(1, 3) : r > 0.55 ? R(1, 2) : R(3, 2);
  });
}
/** Pool surface: dithered ripples. */
function poolTex() {
  return make(32, 32, (x, y) => {
    const v = Math.sin((x + Math.sin(y * 0.4) * 3) * 0.5) + Math.sin(y * 0.7 + x * 0.2);
    const i = dshade(1, 1.8 + v * 0.6, x, y);
    return i === R(1, 3) ? R(3, 3) : i;
  });
}
/** Fern: arching fronds fanned out from the base. 32x24. */
function fern({ ramp = 1, seed = 8 } = {}) {
  const W = 32, H = 24, fronds = [];
  for (let i = 0; i < 7; i++) {
    const ang = Math.PI * (0.14 + (i / 6) * 0.72) + (rnd(i, 0, seed) - 0.5) * 0.15, len = 12 + rnd(i, 1, seed) * 9;
    fronds.push([ang, len]);
  }
  return make(W, H, (x, y) => {
    for (const [ang, len] of fronds) {
      for (let s = 0; s <= 12; s++) {
        const t = s / 12, d = t * len;
        const px = W / 2 + Math.cos(ang) * d, py = H - 1 - Math.sin(ang) * d + t * t * len * 0.55; // droop
        const w = (1 - t) * 2.2 + 0.4;
        if (Math.abs(x - px) < w && Math.abs(y - py) < w * 0.7 && ((x + y) % 2 || w > 1.5)) return dshade(ramp, 0.8 + t * 1.8 + (Math.cos(ang) < 0 ? 0.4 : 0), x, y);
      }
    }
    return CLEAR;
  });
}

// ---------------------------------------------------------------- geometry helpers
const rotP = (p, rx, ry, rz) => {
  let [x, y, z] = p;
  if (rz) { const c = Math.cos(rz), s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c]; }
  if (rx) { const c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c]; }
  if (ry) { const c = Math.cos(ry), s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c]; }
  return [x, y, z];
};
/** Collects parts in a local frame (rotated by ry, moved to x,y,z) for merge(). */
class Frame {
  constructor(x = 0, y = 0, z = 0, ry = 0) { Object.assign(this, { x, y, z, ry }); }
  add(list, geo, ox = 0, oy = 0, oz = 0, rx = 0, ry = 0, rz = 0) {
    list.push({ geo, xf: (p) => { const q = rotP(p, rx, ry, rz); const w = rotP([q[0] + ox, q[1] + oy, q[2] + oz], 0, this.ry, 0); return [w[0] + this.x, w[1] + this.y, w[2] + this.z]; } });
  }
}
/** Chain of boxes (neck / tail) from a start point, each tilted up by its angle. */
function chain(list, f, start, segs) {
  let [y, z] = start;
  for (const [w, h, len, ang] of segs) {
    const dy = Math.sin(ang), dz = Math.cos(ang);
    f.add(list, box(w, h, len), 0, y + dy * len / 2, z + dz * len / 2, -ang);
    y += dy * (len - 0.6); z += dz * (len - 0.6);
  }
  return [y, z];
}
/** Flat polygon facing up (pools). */
function flatPoly(sides, radius) {
  const g = new GeoBuilder();
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    g.tri([0, 0, 0], [Math.cos(a1) * radius, 0, Math.sin(a1) * radius], [Math.cos(a0) * radius, 0, Math.sin(a0) * radius],
      [0.5, 0.5], [0.5 + Math.cos(a1) * 1.5, 0.5 + Math.sin(a1) * 1.5], [0.5 + Math.cos(a0) * 1.5, 0.5 + Math.sin(a0) * 1.5], [0, 1, 0]);
  }
  return g.build();
}
/** Bird: two wing triangles. Wing tips sit at y>0 so instance heightScale flaps them. */
function birdGeo() {
  const g = new GeoBuilder(), z = [0, 0];
  g.tri([0, 0, 0.35], [0, 0, -0.2], [-0.8, 0.35, -0.3], z, z, z, [0, 1, 0]);
  g.tri([0, 0, 0.35], [0.8, 0.35, -0.3], [0, 0, -0.2], z, z, z, [0, 1, 0]);
  g.tri([0, 0, 0.1], [-0.08, 0, -0.45], [0.08, 0, -0.45], z, z, z, [0, 1, 0]); // tail
  return g.build();
}

// ---------------------------------------------------------------- ruins
function buildRuin(type, f, stone, carved, seed) {
  const P = K.props, h = (i) => K.rand2(i, seed, 31);
  if (type === 'temple') {
    f.add(stone, box(10, 3.2, 10, { uvRepeat: [4, 1.3] }), 0, -0.4, 0);
    f.add(stone, box(7.6, 1.2, 7.6, { uvRepeat: [3, 0.5] }), 0, 1.8, 0);
    f.add(carved, box(5.2, 1.2, 5.2, { uvRepeat: [2, 0.5] }), 0, 3.0, 0);
    f.add(stone, P.stairs(9, 2.6, 0.55, 0.4), 0, 0, 7.6);
    f.add(carved, P.arch(3.2, 3, 0.6, 0.6, 6), 0, 3.6, -0.6);
    [[-4.3, -4.3], [4.3, -4.3], [-4.3, 4.3], [4.3, 4.3]].forEach(([x, z], i) => f.add(stone, P.prism(8, 0.45, 1.6 + h(i) * 4, { uvRepeat: [2, 2] }), x, 1.2, z));
    f.add(stone, P.prism(8, 0.45, 4.2, { uvRepeat: [2, 2] }), 7, 0.4, 3, 0, 0.4, Math.PI / 2);
    f.add(stone, P.crate(1.1), -6.5, -0.2, 5.5, 0.2, 0.5, 0.15);
  } else if (type === 'colonnade') {
    f.add(stone, box(15, 1.2, 6.5, { uvRepeat: [6, 0.5] }), 0, 0, 0);
    for (let i = 0; i < 5; i++) for (const zz of [-2.2, 2.2]) {
      const full = h(i * 2 + (zz > 0)) > 0.45, ht = full ? 6 : 1.2 + h(i + 9 + (zz > 0) * 5) * 3.5;
      f.add(stone, P.prism(8, 0.5, ht, { uvRepeat: [2, 3] }), -6 + i * 3, 0.6, zz);
      if (full && i < 4 && h(i * 2 + 2 + (zz > 0)) > 0.45) f.add(carved, box(3.8, 0.7, 1.2, { uvRepeat: [2, 0.4] }), -4.5 + i * 3, 6.95, zz);
    }
    for (let i = 0; i < 4; i++) f.add(carved, P.wall(3.6, 1 + h(i + 20) * 3.4, 0.7), -5.4 + i * 3.6, 0.3, -4.4, 0, 0, (h(i + 30) - 0.5) * 0.08);
    f.add(stone, P.prism(8, 0.5, 5.5, { uvRepeat: [2, 3] }), 4, 0.5, 5.5, 0, -0.3, Math.PI / 2);
  } else { // gate
    f.add(carved, P.arch(5, 5, 1, 1, 7), 0, 0, 0);
    for (const sx of [-1, 1]) {
      f.add(carved, P.wall(4, 3.8, 0.9), sx * 4.5, -0.2, 0, 0, 0, sx * 0.03);
      f.add(carved, P.wall(4, 1.4 + h(sx + 2) * 1.2, 0.9), sx * 8.5, -0.2, 0.2, 0, sx * 0.08, -sx * 0.06);
      f.add(stone, P.prism(4, 0.7, 6.2, { uvRepeat: [1, 3] }), sx * 2.5, -0.2, 1.2);
    }
    f.add(stone, P.stairs(3, 4, 0.6, 0.3), 0, -0.1, 2.6);
    f.add(stone, P.crate(1.2), 5.5, -0.3, 2.8, 0.3, 0.7, 0.2);
    f.add(stone, P.crate(0.9), -6.4, -0.2, 3.4, 0.1, 0.2, 0.4);
  }
}
const SITES = [
  { a: 0.35, side: 1, off: 15, type: 'temple' },
  { a: 1.5, side: -1, off: 12, type: 'colonnade' },
  { a: 2.6, side: 1, off: 9.5, type: 'gate' },
  { a: 3.75, side: -1, off: 15, type: 'temple' },
  { a: 5.0, side: 1, off: 12, type: 'colonnade' },
  { a: 5.75, side: -1, off: 9.5, type: 'gate' },
];
const FALLS = [{ a: 1.05, side: 1, off: 21 }, { a: 4.4, side: -1, off: 21 }];
const FALL_H = 17;

// ---------------------------------------------------------------- beasts (original designs)
function longneck() {
  const body = [], neck = [], f = new Frame();
  f.add(body, box(5, 4.5, 11, { uvRepeat: [2, 2] }), 0, 9.2, 0);
  f.add(body, box(4, 1.6, 8), 0, 6.6, 0);
  f.add(body, box(5.4, 1.6, 4), 0, 11.6, -3);
  chain(body, f, [9.6, -4.8], [[2.6, 2.4, 4.2, -0.15], [1.8, 1.6, 4.2, -0.3], [1.0, 1.0, 4.6, -0.42], [0.5, 0.5, 4, -0.3]]);
  const [hy, hz] = chain(neck, f, [-1, -0.8], [[2.6, 2.6, 4.6, 0.7], [2.0, 2.0, 4.6, 0.9], [1.6, 1.6, 4.6, 1.1], [1.3, 1.3, 3, 1.25]]);
  f.add(neck, box(1.5, 1.3, 2.8), 0, hy + 0.2, hz + 0.9, 0.2);
  f.add(neck, box(1.0, 0.5, 2), 0, hy - 0.5, hz + 1.2, 0.3);
  const legLen = 8;
  return {
    body: merge(body), neck: merge(neck), neckPivot: [0, 10.5, 5],
    leg: K.props.shift(K.props.prism(6, 0.7, legLen, { taper: 1.35 }), 0, -legLen, 0),
    hips: [[-2.1, 8, 3.8], [2.1, 8, 3.8], [-2.1, 8, -3.8], [2.1, 8, -3.8]], stride: 7,
  };
}
function hornback() {
  const body = [], head = [], f = new Frame();
  f.add(body, box(5.2, 3.6, 8, { uvRepeat: [2, 2] }), 0, 5.6, 0);
  f.add(body, box(4.2, 1.2, 6), 0, 3.6, 0);
  for (let i = 0; i < 4; i++) f.add(body, K.props.prism(3, 0.8, 1.4 + (i % 2) * 0.5, { taper: 0.05 }), 0, 7.2, -3 + i * 2);
  chain(body, f, [5.6, -3.8], [[2, 1.8, 3.6, -0.2], [1.1, 1.0, 3.6, -0.3]]);
  f.add(head, box(3, 2.6, 3.4), 0, -0.2, 1.8);
  f.add(head, box(1.6, 1.4, 1.6), 0, -0.8, 3.9);
  f.add(head, box(5.2, 3.6, 0.5), 0, 1.4, 0.2, -0.5);
  for (const sx of [-1, 1]) f.add(head, K.props.prism(5, 0.35, 3.2, { taper: 0.1 }), sx * 1.0, 0.9, 2.6, 1.1);
  f.add(head, K.props.prism(5, 0.3, 1.6, { taper: 0.1 }), 0, -0.3, 4.3, 0.5);
  const legLen = 4.4;
  return {
    body: merge(body), neck: merge(head), neckPivot: [0, 5.6, 4],
    leg: K.props.shift(K.props.prism(6, 0.65, legLen, { taper: 1.3 }), 0, -legLen, 0),
    hips: [[-2.0, 4.6, 2.8], [2.0, 4.6, 2.8], [-2.0, 4.6, -2.8], [2.0, 4.6, -2.8]], stride: 4.5,
  };
}
// R = circle radius (outer ridges / inner hills), w = angular speed (walks against the camera)
const BEASTS = [
  { type: 'longneck', R: 112, a0: 0.4, w: 0.012, s: 1.0 },
  { type: 'hornback', R: 106, a0: 2.4, w: 0.013, s: 1.6 },
  { type: 'longneck', R: 116, a0: 4.3, w: 0.0115, s: 1.15 },
  { type: 'longneck', R: 36, a0: 1.3, w: 0.035, s: 0.9 },
  { type: 'hornback', R: 40, a0: 3.4, w: 0.03, s: 1.5 },
  { type: 'longneck', R: 38, a0: 5.4, w: 0.032, s: 1.05 },
];

const SILENT = { level: 0, bass: 0, mid: 0, high: 0, beat: false, beatPulse: 0, beatCount: 0 };

export class LostValley {
  static meta = { name: 'Lost Valley' };
  static palette = fromKeys('lost-valley', 'Lost Valley', ['#7d8463', '#3f7d36', '#e8b04a', '#7c9483']);

  init(r) {
    // ---- ground + sky
    this.ground = new K.Terrain(r, { size: 220, cells: 50, height: valleyHeight, uvScale: 0.3, shadeRange: [0.6, 1] });
    this.groundTex = r.texture(jungleFloor());
    this.sky = new K.Sky(r, { moon: true, moonRamp: 2, moonDir: [0.55, 0.1, -1], moonSize: 11, clouds: 4 });

    // ---- camera glides along the valley floor
    const pts = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2, [x, z] = valleyPos(a, 0);
      pts.push([x, valleyHeight(x, z) + 3.2 + Math.sin(i * 1.7) * 0.8, z]);
    }
    this.path = new K.Spline(pts);
    this.cam = new K.DollyRig(this.path, { idleSpeed: 2, activeSpeed: 6, bassBoost: 3, lookAhead: 9, groundFn: valleyHeight, minClearance: 2.2, fov: 64, far: 230 });

    // ---- foliage
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.leafTexA = r.texture(K.sprites.broadleaf({ ramp: 1, seed: 2 }));
    this.leafTexB = r.texture(K.sprites.broadleaf({ ramp: 1, seed: 9 }));
    this.pineTex = r.texture(K.sprites.pine({ ramp: 1, tiers: 5, seed: 4 }));
    this.fernTex = r.texture(fern());
    this.grassTex = r.texture(K.sprites.grass({ ramp: 1 }));
    const nTree = (2 * TREE_RAD + 1) ** 2, nFern = (2 * FERN_RAD + 1) ** 2;
    this.leafA = r.createInstances(nTree); this.leafB = r.createInstances(nTree); this.pines = r.createInstances(nTree);
    this.ferns = r.createInstances(nFern); this.grass = r.createInstances(nFern);

    // ---- ruins + waterfalls (static, world space, merged)
    const stone = [], carved = [], cliff = [], falls = [], pools = [];
    this.exclude = [];
    SITES.forEach((s, i) => {
      const [x, z] = valleyPos(s.a, s.side * s.off);
      const ry = Math.atan2(-s.side * Math.cos(s.a), -s.side * Math.sin(s.a)) + (K.rand2(i, 0, 40) - 0.5) * 0.4;
      buildRuin(s.type, new Frame(x, valleyHeight(x, z) - 0.3, z, ry), stone, carved, i);
      this.exclude.push([x, z, s.off]); // keep a clearing between the path and the ruin
    });
    this.mists = [];
    FALLS.forEach((s, i) => {
      const [x, z] = valleyPos(s.a, s.side * s.off), y = valleyHeight(x, z) - 1.5;
      const ry = Math.atan2(-s.side * Math.cos(s.a), -s.side * Math.sin(s.a));
      const f = new Frame(x, y, z, ry);
      f.add(cliff, box(16, FALL_H + 3, 6, { uvRepeat: [4, 5] }), 0, (FALL_H + 3) / 2 - 1, -3.2);
      f.add(cliff, box(7, FALL_H + 8, 6, { uvRepeat: [2, 6] }), -9.5, (FALL_H + 8) / 2 - 1, -4, 0, 0.25, 0.04);
      f.add(cliff, box(8, FALL_H - 3, 6, { uvRepeat: [2, 4] }), 9.8, (FALL_H - 3) / 2 - 1, -3.5, 0, -0.3, -0.03);
      f.add(cliff, box(5.5, 1.4, 2.2), 0, FALL_H + 0.4, -0.4);
      f.add(cliff, box(3, 2, 2.5), -3.8, 0, 2.2, 0, 0.5, 0.2);
      f.add(cliff, box(2.4, 1.6, 2), 4.2, 0, 2.6, 0, -0.4, -0.15);
      f.add(falls, K.props.panel(4.6, FALL_H + 1, { uvRepeat: [1, 4.5] }), 0, 0, 0.05);
      f.add(falls, K.props.panel(3.2, FALL_H + 1, { uvRepeat: [0.7, 3.2] }), 0.4, 0, 0.35);
      const [px, py, pz] = [0, 0, 3.2], w = rotP([px, py, pz], 0, ry, 0), wx = w[0] + x, wz = w[2] + z;
      f.add(pools, flatPoly(10, 5.2), px, Math.max(py + 0.25, valleyHeight(wx, wz) - y + 0.15), pz);
      this.mists.push({ center: [wx, y + 2.2, wz], fx: new K.Particles(r, { count: 90, sprite: 'dot', size: 0.4, vel: [0, 0.9, 0], jitter: [1.2, 0.5, 1.2], wobble: 0.7, area: [9, 5, 6], color: R(3, 3), additive: true, glow: 0.4 }) });
      this.exclude.push([x, z, 13]);
    });
    this.stoneMesh = r.createMesh(merge(stone));
    this.carvedMesh = r.createMesh(merge(carved));
    this.cliffMesh = r.createMesh(merge(cliff));
    this.fallMesh = r.createMesh(merge(falls));
    this.poolMesh = r.createMesh(merge(pools));
    this.stoneTex = r.texture(mossStone({ seed: 1 }));
    this.carvedTex = r.texture(mossStone({ seed: 5, rows: 4, carve: true }));
    this.cliffTex = r.texture(cliffRock());
    this.fallTex = r.texture(waterfallTex());
    this.poolTex = r.texture(poolTex());

    // ---- beasts
    this.beastGeo = { longneck: longneck(), hornback: hornback() };
    this.beastMesh = {};
    for (const [k, g] of Object.entries(this.beastGeo)) this.beastMesh[k] = { body: r.createMesh(g.body), neck: r.createMesh(g.neck), leg: r.createMesh(g.leg) };
    this.beasts = BEASTS.map((b) => ({ ...b, x: 0, y: 0, z: 0, heading: 0, phase: K.rand2(b.a0 * 10, 1, 3) * 6, dip: new K.Envelope(0.35), stride: this.beastGeo[b.type].stride * b.s, dist: 0 }));
    this.m = mat4.create(); this.mLocal = mat4.create(); this.mOut = mat4.create();

    // ---- birds, mist banks, particles
    this.birdMesh = r.createMesh(birdGeo());
    this.birds = r.createInstances(48);
    this.cloudTex = r.texture(K.sprites.cloud({ ramp: 3, seed: 12 }));
    this.mistBank = r.createInstances(28);
    this.mistOff = Array.from({ length: 28 }, (_, i) => [(K.rand2(i, 1, 50) - 0.5) * 80, (K.rand2(i, 2, 50) - 0.5) * 80, 12 + K.rand2(i, 3, 50) * 12]);
    this.flies = new K.Particles(r, 'fireflies');
    this.pollen = new K.Particles(r, 'dust', { count: 160, color: R(2, 3), glow: 0.45 });

    // ---- footsteps
    this.stomp = new K.Envelope(0.3);
    this.shake = new K.Envelope(0.22);
    this.ripple = new K.History(48);
    this.stompAt = [0, 0]; this.bassS = 0; this.fallT = 0; this.levelS = 0;

    this.time = 0; this.k = 0; this.a = SILENT;
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [1, 1, 1], light: [0, 0, 0], amb: [0, 0, 0], beast: [0, 0, 0], bird: [0, 0, 0], mist: [0, 0, 0], fall: [0, 0, 0], tmp: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k), eye = this.cam.eye;
    this.cam.update(a, k, dt);
    this.ground.follow(eye[0], eye[2]);

    // beasts walk their own slow circles, against the camera's direction
    let near = null, nearD = Infinity;
    for (const b of this.beasts) {
      const ang = b.a0 - this.time * b.w, rr = b.R + Math.sin(this.time * 0.05 + b.a0 * 3) * 4;
      const nx = Math.cos(ang) * rr, nz = Math.sin(ang) * rr;
      const step = Math.hypot(nx - b.x, nz - b.z);
      if (b.y !== 0 || b.x !== 0) { b.heading = Math.atan2(nx - b.x, nz - b.z); b.phase += Math.min(step, 1) / b.stride * Math.PI * 2; }
      b.x = nx; b.z = nz; b.y = valleyHeight(nx, nz) - 0.3;
      b.dip.update(dt);
      const dist = Math.hypot(nx - eye[0], nz - eye[2]);
      b.dist = dist;
      if (dist < nearD) { nearD = dist; near = b; }
    }

    // beat = the nearest beast's footstep: tremor, ripple through the trees, body dip
    if (d.beat) {
      this.stomp.trigger(k * d.beatMotion); this.shake.trigger(k * d.beatMotion); // no footstep tremor or tree ripple at Gentle
      if (near) { near.dip.trigger(k * d.beatMotion); this.stompAt[0] = near.x; this.stompAt[1] = near.z; }
    }
    this.bassS = damp(this.bassS, d.bass, 0.5, dt);
    this.levelS = damp(this.levelS, d.level, 0.5, dt);
    this.fallT += dt * (0.9 + this.levelS * 0.6); // integrated: the waterfall never jumps when the level moves
    this.stomp.update(dt); this.shake.update(dt);
    this.ripple.push(this.stomp.v);

    const ground = this.ground.heightAt(eye[0], eye[2]);
    this.flies.update(dt, [eye[0], ground + 2, eye[2]], { amount: K.stage(k, 0.3, 0.8), speed: 1 + d.high * 2 });
    this.pollen.update(dt, eye, { amount: K.swell(k, 0.5, 0.9), speed: 1 + d.mid });
    for (const m of this.mists) m.fx.update(dt, m.center, { amount: 1, speed: 1 + d.level });
    this._scatter();
    this._birds(d);
    this._mistBanks();
  }

  /** Deterministic jungle in world cells around the camera (infinite). */
  _scatter() {
    const e = this.cam.eye, ex = this.exclude, rip = this.ripple, [sx, sz] = this.stompAt;
    const blocked = (x, z, pad) => { for (const s of ex) if (Math.abs(x - s[0]) < s[2] + pad && Math.abs(z - s[1]) < s[2] + pad && Math.hypot(x - s[0], z - s[1]) < s[2] + pad) return true; return false; };
    let na = 0, nb = 0, np = 0;
    let cx = Math.floor(e[0] / TREE_CELL), cz = Math.floor(e[2] / TREE_CELL);
    for (let j = -TREE_RAD; j <= TREE_RAD; j++) for (let i = -TREE_RAD; i <= TREE_RAD; i++) {
      const gx = cx + i, gz = cz + j, h = K.rand2(gx, gz, 1);
      if (h > 0.66) continue;
      const x = (gx + K.rand2(gx, gz, 2)) * TREE_CELL, z = (gz + K.rand2(gx, gz, 3)) * TREE_CELL;
      const dist = Math.hypot(x - e[0], z - e[2]), fade = fadeOut(dist, TREE_FADE);
      if (fade <= 0 || valleyOff(x, z) < 5.5 || blocked(x, z, 0)) continue;
      const y = valleyHeight(x, z), r3 = K.rand2(gx, gz, 4);
      const rp = rip.at(clamp((Math.hypot(x - sx, z - sz) - 30) / 150));
      const shade = 0.72 + K.rand2(gx, gz, 5) * 0.38, phase = h * 40 + rp * 1.5;
      if (y > 11 && r3 < 0.7) {
        const s = (3.2 + K.rand2(gx, gz, 6) * 2.5) * fade;
        this.pines.set(np++, x, y - 0.3, z, s, 0, shade, phase, 2 * (1 - rp * 0.12));
      } else {
        const s = (5.5 + K.rand2(gx, gz, 6) * 5) * fade, inst = r3 < 0.5 ? this.leafA : this.leafB;
        inst.set(r3 < 0.5 ? na++ : nb++, x, y - 0.4, z, s, 0, shade, phase, 1.33 * (1 - rp * 0.12));
      }
    }
    this.leafA.upload(na); this.leafB.upload(nb); this.pines.upload(np);

    let nf = 0, ng = 0;
    cx = Math.floor(e[0] / FERN_CELL); cz = Math.floor(e[2] / FERN_CELL);
    for (let j = -FERN_RAD; j <= FERN_RAD; j++) for (let i = -FERN_RAD; i <= FERN_RAD; i++) {
      const gx = cx + i, gz = cz + j, h = K.rand2(gx, gz, 11);
      if (h > 0.8) continue;
      const x = (gx + K.rand2(gx, gz, 12)) * FERN_CELL, z = (gz + K.rand2(gx, gz, 13)) * FERN_CELL;
      const fade = fadeOut(Math.hypot(x - e[0], z - e[2]), FERN_FADE);
      if (fade <= 0 || valleyOff(x, z) < 1.2 || blocked(x, z, -2)) continue;
      const y = valleyHeight(x, z), shade = 0.75 + K.rand2(gx, gz, 14) * 0.35;
      if (h < 0.5) this.ferns.set(nf++, x, y - 0.15, z, (1.6 + K.rand2(gx, gz, 15) * 1.4) * fade, 0, shade, h * 30, 0.75);
      else this.grass.set(ng++, x, y - 0.1, z, (0.9 + K.rand2(gx, gz, 15) * 0.6) * fade, 0, shade, h * 30, 1);
    }
    this.ferns.upload(nf); this.grass.upload(ng);
  }

  /** Flocks rise out of the canopy one after another as the band swells. */
  _birds(d) {
    const e = this.cam.eye;
    let fx = this.cam.target[0] - e[0], fz = this.cam.target[2] - e[2]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    let n = 0;
    for (let f = 0; f < 3; f++) {
      const air = K.stage(this.k, 0.2 + f * 0.18, 0.45 + f * 0.18);
      if (air <= 0.001) continue;
      const ahead = 34 + f * 10, side = (f - 1) * 12;
      const cx = e[0] + fx * ahead - fz * side, cz = e[2] + fz * ahead + fx * side;
      const cy = Math.max(valleyHeight(cx, cz), e[1] - 3) + 2 + air * (5 + f * 2);
      for (let i = 0; i < 16; i++) {
        const th = this.time * (0.35 + f * 0.07) * (f % 2 ? -1 : 1) + i * 0.39 + K.rand2(i, f, 60) * 0.6;
        const rr = 5 + K.rand2(i, f, 61) * 7 * air;
        const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr, y = cy + Math.sin(this.time * 1.3 + i) * 1.2 + K.rand2(i, f, 62) * 3;
        const dir = f % 2 ? -1 : 1, heading = Math.atan2(-Math.sin(th) * dir, Math.cos(th) * dir);
        const flap = Math.sin(this.time * (9 + K.rand2(i, f, 63) * 4) + i * 1.7);
        this.birds.set(n++, x, y, z, 1.7 * air, heading, 1, 0, flap);
      }
    }
    this.birds.upload(n);
  }

  /** Low mist banks hugging the ground around the camera; they thin and sink when playing. */
  _mistBanks() {
    const e = this.cam.eye, sink = this.k * 2.5;
    this.mistOff.forEach(([ox, oz, s], i) => {
      const x = e[0] + ((((ox - e[0]) % 80) + 120) % 80) - 40, z = e[2] + ((((oz - e[2]) % 80) + 120) % 80) - 40;
      const near = smoothstep((Math.hypot(x - e[0], z - e[2]) - 8) / 16); // no big cards in your face
      this.mistBank.set(i, x, this.ground.heightAt(x, z) - 0.5 - sink, z, s, 0, near, i, 0.3);
    });
    this.mistBank.upload(this.mistOff.length);
  }

  render(r) {
    const { col, k } = this, P = this.pal, d = K.drive(this.a, k), cam = this.cam, eye = cam.eye;
    const warm = K.stage(k, 0.15, 1), dim = lerp(0.74, 1, k);

    // colours: green-grey dawn fog that thins and warms towards gold
    mixColor(col.fog, P.role('fog'), P.color(R(2, 2)), 0.22 * warm);
    scaleColor(col.fog, col.fog, dim);
    mixColor(col.zen, P.color(R(3, 0)), P.color(R(3, 2)), 0.35 + 0.15 * warm);
    scaleColor(col.zen, col.zen, dim);
    r.clear(col.fog);

    // camera + footstep tremor
    const sh = this.shake.v * (this.a?.motion ?? 1), ox = Math.sin(this.time * 53) * sh * 0.22, oy = -sh * 0.3 + Math.sin(this.time * 61) * sh * 0.1;
    eye[0] += ox; eye[1] += oy; cam.target[1] += oy * 1.5;
    cam.apply(r);
    eye[0] -= ox; eye[1] -= oy; cam.target[1] -= oy * 1.5;

    this.sky.draw(r, eye, { horizon: col.fog, zenith: col.zen, brightness: dim, starLevel: 0, moonScale: 1 + lerp(d.groove, d.pulse, d.beatMotion) * 0.08, cloudDrift: this.time * 0.006 });

    const fogNear = lerp(3, 14, k), fogFar = lerp(42, 125, k);
    r.setFog(col.fog, fogNear, fogFar);
    mixColor(col.light, P.role('light'), P.color(R(2, 3)), 0.45 * warm);
    scaleColor(col.light, col.light, lerp(0.5, 0.9, k));
    r.setLight([-0.55, -0.45, 0.6], col.light, scaleColor(col.amb, P.role('ambient'), lerp(0.42, 0.5, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    // opaque world
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    r.draw(this.stoneMesh, mat4.identity(this.m), { texture: this.stoneTex, tint: col.tint });
    r.draw(this.carvedMesh, this.m, { texture: this.carvedTex, tint: col.tint });
    r.draw(this.cliffMesh, this.m, { texture: this.cliffTex, tint: col.tint });
    scaleColor(col.fall, P.color(R(3, 3)), 0.08 + d.high * 0.12);
    r.draw(this.fallMesh, this.m, { texture: this.fallTex, tint: col.tint, emissive: col.fall, uvOffset: [0, -this.fallT] });
    r.draw(this.poolMesh, this.m, { texture: this.poolTex, tint: col.tint, emissive: col.fall, uvOffset: [this.time * 0.03, this.time * 0.05] });

    // jungle
    const sway = 0.015 + lerp(this.bassS, d.bass, d.beatMotion) * 0.09 + this.stomp.v * 0.025 + d.groove * (1 - d.beatMotion) * 0.02;
    r.drawInstanced(this.quad, this.leafA, { texture: this.leafTexA, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.leafB, { texture: this.leafTexB, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.pines, { texture: this.pineTex, billboard: 1, sway: sway * 0.7, tint: col.tint });
    r.drawInstanced(this.quad, this.ferns, { texture: this.fernTex, billboard: 1, sway: sway * 1.6, tint: col.tint });
    r.drawInstanced(this.quad, this.grass, { texture: this.grassTex, billboard: 1, sway: sway * 2, tint: col.tint });

    // beasts: dark silhouettes with their own, wider fog (barely there at idle)
    r.setFog(col.fog, lerp(20, 40, k), lerp(100, 220, k));
    mixColor(col.tmp, P.color(R(0, 0)), P.color(R(3, 0)), 0.35);
    for (const b of this.beasts) this._drawBeast(r, b, col.tmp);
    r.setFog(col.fog, fogNear, fogFar);

    // birds catch the light on highs
    mixColor(col.bird, P.color(R(0, 0)), P.color(R(2, 3)), clamp(d.high * 0.8 + d.pulse * 0.2));
    r.drawInstanced(this.birdMesh, this.birds, { unlit: true, tint: col.bird });

    // additive last: mist banks, waterfall spray, fireflies, pollen
    scaleColor(col.mist, P.color(R(3, 2)), K.swell(k, 0.2, 0.04));
    r.drawInstanced(this.quad, this.mistBank, { texture: this.cloudTex, billboard: 1, unlit: true, additive: true, tint: col.mist });
    for (const m of this.mists) m.fx.draw(r, { brightness: dim });
    this.flies.draw(r, { brightness: K.stage(k, 0.3, 0.8) * (0.75 + d.high * 0.9) });
    this.pollen.draw(r, { brightness: K.swell(k, 0.5, 0.8) + d.high * 0.6 });
  }

  _drawBeast(r, b, silhouette) {
    const g = this.beastGeo[b.type], M = this.beastMesh[b.type], s = b.s, dip = b.dip.v;
    const bob = Math.cos(b.phase * 2) * 0.12 * s - dip * 0.45 * s;
    mat4.trs(this.m, b.x, b.y + bob, b.z, 0, b.heading, 0, s, s, s);
    r.draw(M.body, this.m, { unlit: true, tint: silhouette });
    const [px, py, pz] = g.neckPivot;
    mat4.trs(this.mLocal, px, py, pz, Math.sin(b.phase * 2 + 0.6) * 0.04 + dip * 0.12, Math.sin(b.phase * 0.25) * 0.15, 0);
    r.draw(M.neck, mat4.multiply(this.mOut, this.m, this.mLocal), { unlit: true, tint: silhouette });
    g.hips.forEach(([hx, hy, hz], i) => {
      const swing = Math.sin(b.phase + ((i === 0 || i === 3) ? 0 : Math.PI)) * 0.32;
      mat4.trs(this.mLocal, hx, hy - bob / s, hz, swing, 0, 0);
      r.draw(M.leg, mat4.multiply(this.mOut, this.m, this.mLocal), { unlit: true, tint: silhouette });
    });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.flies.dispose(r); this.pollen.dispose(r);
    for (const m of this.mists) m.fx.dispose(r);
    for (const M of Object.values(this.beastMesh)) { M.body.dispose(); M.neck.dispose(); M.leg.dispose(); }
    [this.quad, this.stoneMesh, this.carvedMesh, this.cliffMesh, this.fallMesh, this.poolMesh, this.birdMesh].forEach((m) => m.dispose());
    [this.groundTex, this.leafTexA, this.leafTexB, this.pineTex, this.fernTex, this.grassTex, this.stoneTex, this.carvedTex, this.cliffTex, this.fallTex, this.poolTex, this.cloudTex].forEach((t) => r.deleteTexture(t));
    [this.leafA, this.leafB, this.pines, this.ferns, this.grass, this.birds, this.mistBank].forEach((i) => i.dispose());
  }
}
