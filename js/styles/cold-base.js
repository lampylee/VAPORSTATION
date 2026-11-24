// COLD BASE — a snowbound research outpost at night (original).
//
//   perimeter fence, quonset hangars, prefab huts, stacked crates, fuel tanks
//   watchtowers with searchlight cones (crossed additive quads + ground pools)
//   a radar dish turning on a mast, rotating alarm beacons, a frozen ridge behind
//   camera alternates a security-camera pan (SweepRig) with a low glide (DollyRig), blended
//
// Idle: quiet, light snow, one searchlight lazily sweeping, a few lit windows.
// Swell: snowstorm thickens and the wind picks up, frost grows over walls (texture2 blend),
//        searchlights wake one by one, alarm beacons spin up, windows light, fog closes in.
// Beat: searchlights snap toward the camera, beacon flash, camera nudge.
// Bass: wind gusts. Highs: beacon / window / lens flicker.
// Light (Kit v7): each beacon beam is a red point light swinging round with it, each searchlight
// pool a cold one; K.LightSet keeps the best 4 in view. Hut walls and hangar arches are subdivided
// so the sweep reads as moving light, not flashing corners.
import { mat4, lerp, damp, clamp, smoothstep } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, box, merge } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

// ---------- layout (world units, compound centred on the origin) ----------
const FENCE_X = 34, FENCE_Z = 30, GATE = 5;
const CENTER = [0, 0, -2];
const HANGARS = [[-18, -14, 12, 18, 7], [14, -16, 12, 16, 6.4]];            // x, z, width, length, height (doors face +z)
const HUTS = [                                                               // x, z, w, h, d, yaw
  [-24, 8, 6, 2.8, 4, 0], [-14, 14, 5, 2.6, 4, 0.08], [-26, 19, 5, 2.6, 4, Math.PI / 2],
  [18, 6, 6, 3, 4, 0], [25, 16, 5, 2.6, 4, Math.PI / 2], [10, 19, 5, 2.6, 3.6, -0.05],
  [8, 26, 2.2, 2.4, 2.2, 0],                                                 // gate booth
];
const TOWERS = [[-9, 25], [-31, -27], [31, -27], [31, 27], [-31, 27]];      // index 0 is the idle searchlight
const LAMP_Y = 10.75;
const RADAR = [-3, -12];
const TANKS = [[28, -3.5], [28, -7.5]];
const BEACONS = [[-5, 3.15, 30], [5, 3.15, 30], [-18, 7.05, -6], [14, 6.45, -9], [RADAR[0] + 1.2, 2.75, RADAR[1] + 1.2], [28, 2.75, -5.5]];
const MOUNTS = [[-30, 6.5, 2], [2, 6.5, -27], [31, 6.5, 6], [17, 6, 27]]; // security cameras, mid-edge so blends to the glide clear the towers
const CYCLE = [18, 5, 26, 5]; // sweep hold, blend, glide hold, blend (s)

const rotXZ = (x, z, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * x + s * z, -s * x + c * z]; };
/** 2D distance from point (px, pz) to segment (ax, az)-(bx, bz). */
function segDist(ax, az, bx, bz, px, pz) {
  const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const angDiff =(a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b)); // a - b, wrapped

function groundHeight(x, z) {
  const e = Math.max(Math.abs(x) - 38, Math.abs(z) - 34);
  const m = smoothstep(clamp(e / 22));
  return (K.fbm(x * 0.05, z * 0.05, { octaves: 2 }) - 0.5) * 0.5 + m * (K.fbm(x * 0.025 + 7, z * 0.025, { octaves: 3 }) * 7 - 2);
}
// the frozen ridge rises out of the ground behind the base (its own mesh, so it can sit outside the terrain patch)
function ridgeHeight(x, z) {
  const t = smoothstep(clamp((-z - 54) / 42));
  return -4 + t * (26 + K.ridged(x * 0.018, z * 0.03, { octaves: 3 }) * 16) + K.fbm(x * 0.06, z * 0.06, { octaves: 2 }) * 3 * t;
}

// ---------- indexed textures ----------
const concreteTex = (frost) => K.makeIndexed(64, 64, (x, y) => {
  const seam = x % 32 === 0 || y % 21 === 0;
  if (seam) return R(0, frost ? 1 : 0);
  const stain = K.blobNoise(x, y, 9, 3), drip = K.blobNoise(x * 3, y * 0.3, 6, 5);
  if (frost) {
    const f = K.blobNoise(x, y, 6, 11) * 0.8 + (1 - (y % 21) / 21) * 0.4;
    return f > 0.35 ? K.dshade(3, 1.9 + f + (K.rnd(x, y, 4) - 0.5) * 0.4, x, y) : K.dshade(0, 1.8 + stain * 0.6, x, y);
  }
  return K.dshade(0, 1.6 + (stain - 0.5) * 1.3 - (drip > 0.68 ? 0.7 : 0) + (K.rnd(x, y, 1) - 0.5) * 0.45, x, y);
});
const metalTex = (frost) => K.makeIndexed(64, 64, (x, y) => {
  const rib = (x >> 1) & 1, blob = K.blobNoise(x, y, 10, 7);
  if (y % 16 === 2 && x % 8 === 4) return R(1, 3);                            // rivets
  if (frost && (rib || K.blobNoise(x, y, 5, 13) > 0.55)) return K.dshade(3, 2.1 + blob * 0.9, x, y);
  const streak = K.blobNoise(x * 2, y * 0.15, 4, 9) > 0.74;
  return K.dshade(1, 1.2 + rib * 0.8 + (blob - 0.5) * 0.8 - (streak ? 0.6 : 0), x, y);
});
// hangar door: vertical panels, a hazard-striped kick band, a stencilled bay mark
const doorTex = () => K.makeIndexed(64, 64, (x, y) => {
  if (y > 52) return ((x + y) >> 2) & 1 ? R(2, 2) : R(0, 0);
  if (x % 16 === 0 || y === 52) return R(1, 0);
  if (y > 8 && y < 20 && x > 24 && x < 40 && ((x - 24) % 6 < 4) && (y - 8) % 6 < 4) return R(2, 1);
  return K.dshade(1, 1.4 + K.blobNoise(x, y, 8, 21) * 0.9, x, y);
});
const snowTex = (deep) => K.makeIndexed(64, 64, (x, y) => {
  if (K.rnd(x, y, 3) > 0.988) return R(3, 3);                                 // ice glints
  const b = K.blobNoise(x, y, 11, deep ? 17 : 5), c = K.blobNoise(x, y, 4, 8);
  return K.dshade(3, (deep ? 2.85 : 2.45) + (b - 0.5) * 1.1 + (c - 0.5) * 0.4, x, y);
});
const crateTex = () => K.makeIndexed(32, 32, (x, y) => {
  if (x < 3 || y < 3 || x > 28 || y > 28) return R(1, (x + y) & 1 ? 0 : 1);   // frame
  if (Math.abs(x - y) < 2) return R(1, 1);                                      // brace
  if (y > 12 && y < 18 && x > 6 && x < 13) return R(2, 1);                      // stencil block
  return K.dshade(1, 1.8 + K.rnd(x >> 2, y, 6) * 0.6 - ((y % 8) === 0 ? 0.8 : 0), x, y);
});
const windowTex = () => K.makeIndexed(8, 8, (x, y) => (x === 0 || y === 0 || x === 7 || y === 7 || x === 4 ? R(0, 0) : K.dshade(2, y < 3 ? 2.9 : 2.2, x, y)));
const solidTex = (idx) => K.makeIndexed(4, 4, () => idx);

// ---------- geometry ----------
/** Quonset hangar: half-ellipse arch along z with end walls. Pivot at base centre. */
function quonset(w, len, h, segs = 8, nz = 8) {
  const g = new GeoBuilder(), pts = [];
  for (let i = 0; i <= segs; i++) { const a = (Math.PI * i) / segs; pts.push([Math.cos(a) * w / 2, Math.sin(a) * h]); }
  let u = 0;
  for (let i = 0; i < segs; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], du = Math.hypot(x1 - x0, y1 - y0) / 2;
    for (let j = 0; j < nz; j++) {
      const z0 = -len / 2 + (len * j) / nz, z1 = z0 + len / nz, v0 = (len / 2) * (j / nz), v1 = (len / 2) * ((j + 1) / nz);
      K.quadFacing(g, [x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1], [u, v0], [u + du, v0], [u + du, v1], [u, v1], [(x0 + x1) / 2, (y0 + y1) / 2, 0]);
    }
    u += du;
  }
  return g.build();
}
function quonsetEnds(w, len, h, segs = 8) {
  const g = new GeoBuilder();
  for (const z of [-len / 2, len / 2]) {
    for (let i = 0; i < segs; i++) {
      const a0 = (Math.PI * i) / segs, a1 = (Math.PI * (i + 1)) / segs;
      const p1 = [Math.cos(a0) * w / 2, Math.sin(a0) * h, z], p2 = [Math.cos(a1) * w / 2, Math.sin(a1) * h, z];
      const t = (p) => [p[0] / 4 + 0.5, (h - p[1]) / 4];
      g.tri([0, 0, z], p1, p2, t([0, 0]), t(p1), t(p2));
    }
  }
  return g.build();
}
const boxAt = (sx, sy, sz, uv, segs = 1) => K.props.shift(box(sx, sy, sz, { uvRepeat: uv || [Math.max(sx, sz) / 2, sy / 2], segs }), 0, sy / 2, 0);

/** Searchlight cone: three crossed trapezoids along +Y (length 1, end width 1). v = 0 at the lamp (bright end of lightShaft). */
function beamGeo(base = 0.06, sides = 3) {
  const g = new GeoBuilder();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI, c = Math.cos(a), s = Math.sin(a);
    const p = (w, y) => [c * w, y, s * w];
    g.quad(p(-base / 2, 0), p(base / 2, 0), p(0.5, 1), p(-0.5, 1), [0, 0], [1, 0], [1, 1], [0, 1], [0, 0, 1]);
  }
  return g.build();
}
/** Centred quad in the XY plane (windows, light pools when tilted flat). */
function centredQuad(w = 1, h = 1) {
  return new GeoBuilder().quad([-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();
}

export class ColdBase {
  static meta = { name: 'Cold Base' };
  static palette = fromKeys('cold-base', 'Cold Base', ['#7c8088', '#5a6448', '#ff7a1a', '#121c2a']);

  init(r) {
    this.ground = new K.Terrain(r, { size: 170, cells: 46, height: groundHeight, uvScale: 0.3 });
    this.snowTex = r.texture(snowTex(false));
    this.snowTex2 = r.texture(snowTex(true));
    this.sky = new K.Sky(r, { stars: 120, moon: true, moonDir: [-0.35, 0.3, -1], moonSize: 6, moonTexture: K.sprites.moon({ ramp: 3 }), clouds: 8 });
    this._buildRidge(r);
    this._buildBase(r);
    this._buildLights(r);

    // ---- camera: a security-camera pan and a low glide around the outside of the fence, blended
    const pts = [];
    // rounded-square loop (superellipse) so the corners stay outside the fence and its towers
    const se = (v) => Math.sign(v) * Math.sqrt(Math.abs(v));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, x = se(Math.cos(a)) * (45 + Math.sin(i * 1.7) * 2), z = se(Math.sin(a)) * (41 + Math.cos(i * 2.3) * 1.5);
      pts.push([x, groundHeight(x, z) + 1.9, z]);
    }
    this.path = new K.Spline(pts);
    this.dolly = new K.DollyRig(this.path, { idleSpeed: 2.2, activeSpeed: 6.5, bassBoost: 2, lookAhead: 10, groundFn: groundHeight, minClearance: 1.5, fov: 62, nudge: 0.3 });
    this.mount = 0;
    this.sweep = new K.SweepRig({ position: MOUNTS[0], yaw: this._yawTo(MOUNTS[0]), yawRange: 0.62, pitch: -0.2, distance: 12, fov: 58, idleSpeed: 0.16, activeSpeed: 0.42 });
    this.camT = 0; this.camW = 0; this.camPhase = 0; this.prevMount = -1;
    this.pathS = []; const q = [0, 0, 0];
    for (let s = 0; s < this.path.length; s += 1) { this.path.at(s / this.path.length, q); this.pathS.push([s, q[0], q[2]]); }
    this.eye = [0, 5, 30]; this.tgt = [0, 0, 0];

    // ---- weather
    this.snow = new K.Particles(r, 'snow', { count: 600 });
    this.storm = new K.Particles(r, 'snow', { count: 700, size: 0.09, area: [24, 14, 24], vel: [0, -2.4, 0], wobble: 1.6 });
    this.gust = 0; this.wind = [0, 0]; this.bassS = 0; this.cloudT = 0;

    this.flash = new K.Envelope(0.22);
    this.snapEnv = new K.Envelope(0.55); this.snap = 0;
    this.m = mat4.create();
    this.time = 0; this.k = 0; this.a = null; this.radarYaw = 0;
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], one: [1, 1, 1], glow: [0, 0, 0], hot: [0, 0, 0], red: [0, 0, 0], cold: [0, 0, 0], focus: [0, 0, 0] };
    this.plights = new K.LightSet({ reach: 16, fade: 0.4 });
  }

  _yawTo(p) { return Math.atan2(CENTER[0] - p[0], -(CENTER[2] - p[2])); }
  _nearestS(p) {
    let best = 0, bd = Infinity;
    for (const [s, x, z] of this.pathS) { const dd = Math.hypot(x - p[0], z - p[2]); if (dd < bd) { bd = dd; best = s; } }
    return best;
  }

  _buildRidge(r) {
    const g = new GeoBuilder(), NX = 46, NZ = 12, x0 = -175, x1 = 175, z0 = -52, z1 = -150;
    const P = (i, j) => { const x = x0 + ((x1 - x0) * i) / NX, z = z0 + ((z1 - z0) * j) / NZ; return [x, ridgeHeight(x, z), z]; };
    const T = (p) => [p[0] * 0.08, p[2] * 0.08];
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      K.quadFacing(g, a, b, c, d, T(a), T(b), T(c), T(d), [0, 1, 0]);
    }
    this.ridge = r.createMesh(g.build());
  }

  _buildBase(r) {
    const conc = [], metal = [], doors = [], caps = [];
    // hangars: metal arch, concrete end walls, a hazard-striped door, a concrete apron strip
    for (const [x, z, w, len, h] of HANGARS) {
      metal.push({ geo: quonset(w, len, h), xf: K.xf({ pos: [x, 0, z] }) });
      conc.push({ geo: quonsetEnds(w, len, h), xf: K.xf({ pos: [x, 0, z] }) });
      doors.push({ geo: K.props.panel(w * 0.62, h * 0.74, { uvRepeat: [1, 1] }), xf: K.xf({ pos: [x, 0, z + len / 2 + 0.04] }) });
      conc.push({ geo: boxAt(w * 0.3, 0.5, 0.6), xf: K.xf({ pos: [x - w * 0.42, 0, z + len / 2 + 0.3] }) });
    }
    // prefab huts with snow-capped roofs and a metal door
    this.windows = [];
    for (const [x, z, w, h, d, yaw] of HUTS) {
      conc.push({ geo: boxAt(w, h, d, undefined, 4), xf: K.xf({ pos: [x, 0, z], rot: [0, yaw, 0] }) });
      caps.push({ geo: boxAt(w + 0.5, 0.28, d + 0.5, [w / 2, 0.2]), xf: K.xf({ pos: [x, h, z], rot: [0, yaw, 0] }) });
      const dp = rotXZ(w * 0.3, d / 2 + 0.03, yaw);
      metal.push({ geo: boxAt(0.9, 2, 0.08, [0.5, 1]), xf: K.xf({ pos: [x + dp[0], 0, z + dp[1]], rot: [0, yaw, 0] }) });
      for (const lx of w > 3 ? [-w * 0.22] : [0]) this.windows.push({ x, z, lx, ly: h * 0.58, lz: d / 2 + 0.05, yaw });
      if (w > 3) this.windows.push({ x, z, lx: w * 0.22, ly: h * 0.58, lz: d / 2 + 0.05, yaw: yaw + Math.PI });
    }
    // watchtowers: four splayed legs, two brace rings, platform, cabin, snow-capped roof, lamp post
    for (const [x, z] of TOWERS) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        metal.push({ geo: boxAt(0.22, 8.3, 0.22, [0.2, 4]), xf: K.xf({ pos: [x + sx * 1.25, 0, z + sz * 1.25], rot: [-sz * 0.045, 0, sx * 0.045] }) });
      }
      for (const [y, half] of [[3, 1.12], [6, 0.99]]) {
        for (const [ax, az] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          metal.push({ geo: box(ax ? 0.12 : half * 2, 0.12, az ? 0.12 : half * 2), xf: K.xf({ pos: [x + ax * half, y, z + az * half] }) });
        }
      }
      conc.push({ geo: boxAt(2.8, 0.22, 2.8), xf: K.xf({ pos: [x, 8.1, z] }) });
      metal.push({ geo: boxAt(2, 1.5, 2), xf: K.xf({ pos: [x, 8.32, z] }) });
      caps.push({ geo: K.props.prism(4, 1.75, 0.7, { taper: 0.12 }), xf: K.xf({ pos: [x, 9.82, z], rot: [0, Math.PI / 4, 0] }) });
      metal.push({ geo: K.props.prism(4, 0.06, 0.5), xf: K.xf({ pos: [x, 10.3, z] }) });
      for (let q = 0; q < 4; q++) {
        const p = rotXZ(0, 1.03, (q * Math.PI) / 2);
        this.windows.push({ x: x + p[0], z: z + p[1], lx: 0, ly: 9.2, lz: 0, yaw: (q * Math.PI) / 2, tower: true });
      }
    }
    // radar mast + equipment hut
    const [rx, rz] = RADAR;
    conc.push({ geo: boxAt(3, 2.5, 3, undefined, 3), xf: K.xf({ pos: [rx, 0, rz] }) });
    caps.push({ geo: boxAt(3.4, 0.2, 3.4, [1.5, 0.2]), xf: K.xf({ pos: [rx, 2.5, rz] }) });
    metal.push({ geo: K.props.prism(4, 0.45, 8, { taper: 0.4, uvRepeat: [2, 4] }), xf: K.xf({ pos: [rx, 2.6, rz], rot: [0, Math.PI / 4, 0] }) });
    // fuel tanks on saddles
    for (const [tx, tz] of TANKS) {
      metal.push({ geo: K.props.rotZ(K.props.prism(10, 1.2, 6, { uvRepeat: [3, 2] }), Math.PI / 2), xf: K.xf({ pos: [tx + 3, 1.5, tz] }) });
      for (const ox of [-2, 2]) conc.push({ geo: boxAt(0.5, 0.9, 2), xf: K.xf({ pos: [tx + ox, 0, tz] }) });
    }
    // gate posts + barrier arm
    for (const gx of [-GATE, GATE]) conc.push({ geo: boxAt(0.6, 3, 0.6), xf: K.xf({ pos: [gx, 0, FENCE_Z] }) });
    doors.push({ geo: box(GATE * 1.7, 0.16, 0.16, { uvRepeat: [4, 0.1] }), xf: K.xf({ pos: [0.6, 1.1, FENCE_Z + 0.5] }) });
    // beacon housings
    for (const [bx, by, bz] of BEACONS) metal.push({ geo: K.props.prism(6, 0.16, 0.18), xf: K.xf({ pos: [bx, by - 0.18, bz] }) });

    this.concMesh = r.createMesh(merge(conc));
    this.metalMesh = r.createMesh(merge(metal));
    this.doorMesh = r.createMesh(merge(doors));
    this.capMesh = r.createMesh(merge(caps));
    this.concTex = r.texture(concreteTex(false)); this.concTex2 = r.texture(concreteTex(true));
    this.metalTex = r.texture(metalTex(false)); this.metalTex2 = r.texture(metalTex(true));
    this.doorTex = r.texture(doorTex());

    // stacked crates (instanced), deterministic gaps and yaw jitter
    this.crateMesh = r.createMesh(K.props.crate(1.2));
    this.crateTex = r.texture(crateTex());
    this.crates = r.createInstances(64);
    let n = 0;
    const stack = (cx, cz, nx, nz, layers, yaw, seed) => {
      for (let l = 0; l < layers; l++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        if (l > 0 && K.rand2(i + l * 7, j, seed) < 0.35 + l * 0.2) continue;
        const p = rotXZ((i - (nx - 1) / 2) * 1.25, (j - (nz - 1) / 2) * 1.25, yaw);
        if (n < 64) this.crates.set(n++, cx + p[0], l * 1.2, cz + p[1], 1, yaw + (K.rand2(i, j + l, seed + 1) - 0.5) * 0.2, 0.8 + K.rand2(i, l, seed) * 0.3, 0, 1);
      }
    };
    stack(-4, 6, 3, 2, 3, 0.2, 1); stack(10, -2, 2, 2, 2, -0.4, 2); stack(-29, -1, 2, 3, 2, 0, 3); stack(26, -14, 2, 2, 3, 0.6, 4); stack(2, 22, 2, 1, 2, 0.1, 5);
    this.crates.upload(n);

    // perimeter fence (chain-link), gap at the gate
    this.fenceMesh = r.createMesh(K.props.fence(4, 2.5, 2));
    this.fenceTex = r.texture(K.sprites.chainLink({ index: R(1, 2), dark: R(1, 1) }));
    this.fence = r.createInstances(80);
    n = 0;
    for (let x = -FENCE_X + 2; x < FENCE_X; x += 4) {
      this.fence.set(n++, x, groundHeight(x, -FENCE_Z) - 0.1, -FENCE_Z, 1, 0, 1, 0, 1);
      if (Math.abs(x) > GATE + 1) this.fence.set(n++, x, groundHeight(x, FENCE_Z) - 0.1, FENCE_Z, 1, 0, 1, 0, 1);
    }
    for (let z = -FENCE_Z + 2; z < FENCE_Z; z += 4) for (const x of [-FENCE_X, FENCE_X]) this.fence.set(n++, x, groundHeight(x, z) - 0.1, z, 1, Math.PI / 2, 1, 0, 1);
    this.fence.upload(n);

    // radar dish: shallow bowl + feed, pre-tilted; turns around the mast
    this.dishMesh = r.createMesh(K.props.rotX(merge([
      { geo: K.props.prism(10, 0.14, 0.6, { taper: 13, cap: false }) },
      { geo: K.props.prism(4, 0.05, 1.5) },
      { geo: box(0.3, 0.3, 0.3), xf: K.xf({ pos: [0, 1.5, 0] }) },
      { geo: box(0.5, 0.5, 0.7), xf: K.xf({ pos: [0, -0.2, 0.3] }) },
    ]), -1.05));

    // pines beyond the fence
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.pineTex = r.texture(K.sprites.pine({ ramp: 1 }));
    this.pines = r.createInstances(260);

    // windows (opaque, unlit, per-instance brightness)
    this.winMesh = r.createMesh(centredQuad(0.8, 0.55));
    this.winTex = r.texture(windowTex());
    this.winInst = r.createInstances(this.windows.length);
  }

  _buildLights(r) {
    this.beamMesh = r.createMesh(beamGeo());
    this.beamTex = r.texture(K.sprites.lightShaft({ ramp: 3 }));
    this.beaconBeamTex = r.texture(K.sprites.lightShaft({ ramp: 2 }));
    this.beams = r.createInstances(TOWERS.length);
    this.beaconBeams = r.createInstances(BEACONS.length * 2);
    this.poolMesh = r.createMesh(centredQuad(1, 1));
    this.pools = r.createInstances(TOWERS.length);
    this.coldGlowTex = r.texture(K.sprites.glow({ ramp: 3 }));
    this.hotGlowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.lensGlows = r.createInstances(TOWERS.length);
    this.beaconGlows = r.createInstances(BEACONS.length);
    this.headMesh = r.createMesh(K.props.prism(8, 0.26, 0.55));
    this.heads = r.createInstances(TOWERS.length);
    this.beaconHeadMesh = r.createMesh(K.props.prism(6, 0.13, 0.26, { taper: 0.7 }));
    this.beaconHeads = r.createInstances(BEACONS.length);
    this.beaconTex = r.texture(solidTex(R(2, 2)));
    this.lights = TOWERS.map(([x, z], i) => ({
      x, z, y: LAMP_Y, base: Math.atan2(CENTER[0] - x, CENTER[2] - z), range: i === 0 ? 1.0 : 0.75,
      ph: i * 1.9, rate: 0.85 + i * 0.12, yaw: 0, dip: 0.3, dir: [0, -1, 0], len: 30,
    }));
    this.beacons = BEACONS.map(([x, y, z], i) => ({ x, y, z, a: i * 1.3, on: 0 }));
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt; this.dt = dt;
    const d = K.drive(a, k), t = this.time;
    const bm = d.beatMotion;
    this.cloudT += dt * (0.004 + k * 0.01);   // integrated: cloud drift rate follows k without the phase jumping
    if (d.beat) { this.flash.trigger(k); this.snapEnv.trigger(1); }
    this.flash.update(dt); this.snapEnv.update(dt);
    // searchlight snap toward the camera: Gentle leans them in slowly with the groove swing instead of snapping on beats
    this.snap = damp(this.snap, lerp(d.groove * 0.3, this.snapEnv.v, bm), lerp(0.6, 0.07, bm), dt);
    this.bassS = damp(this.bassS, d.bass, 0.5, dt);
    const bassM = lerp(this.bassS, d.bass, bm);

    this._updateCamera(a, k, dt);
    const eye = this.eye;
    this.ground.follow(eye[0], eye[2]);

    // wind: a steady breeze that builds into a storm, with bass gusts
    this.gust = damp(this.gust, d.bass * 9, d.bass * 9 > this.gust ? lerp(0.5, 0.12, bm) : 0.6, dt);
    const w = lerp(0.4, 5.5, k) + this.gust, wa = 0.35 + Math.sin(t * 0.05) * 0.3;
    this.wind[0] = Math.cos(wa) * w; this.wind[1] = Math.sin(wa) * w;
    this.snow.update(dt, eye, { amount: K.swell(k, 0.4, 1), speed: 1 + k * 0.6, wind: this.wind });
    this.storm.update(dt, eye, { amount: K.stage(k, 0.25, 0.95), speed: 1 + k * 0.5 + this.gust * 0.05, wind: this.wind });

    this.radarYaw += dt * (0.28 + k * 0.9 + bassM * 1.4);

    // searchlights: lazy sweeps, waking one by one; beats snap them toward the camera
    const snapW = this.snap * 0.8 * k;
    this.lights.forEach((L, i) => {
      L.wake = i === 0 ? 1 : K.stage(k, 0.12 + i * 0.13, 0.28 + i * 0.13);
      const sp = lerp(0.14, 0.42, k) * L.rate;
      L.ph += dt * sp;
      let yaw = L.base + Math.sin(L.ph) * L.range, dip = 0.33 + Math.sin(L.ph * 0.37 + i) * 0.1;
      // aim at a point just below the camera
      const dx = eye[0] - L.x, dy = eye[1] - 1.4 - L.y, dz = eye[2] - L.z, hz = Math.hypot(dx, dz);
      const cy = Math.atan2(dx, dz), cd = Math.atan2(-dy, hz);
      yaw += angDiff(cy, yaw) * snapW; dip = lerp(dip, cd, snapW);
      L.yaw = yaw; L.dip = dip;
      const cdp = Math.cos(dip), sdp = Math.sin(dip);
      L.dir[0] = Math.sin(yaw) * cdp; L.dir[1] = -sdp; L.dir[2] = Math.cos(yaw) * cdp;
      // length: to the ground, capped
      let len = 40;
      if (sdp > 0.05) {
        len = Math.min(40, (L.y - groundHeight(L.x + L.dir[0] * 30, L.z + L.dir[2] * 30)) / sdp);
      }
      L.len = len; L.hit = sdp > 0.05 && len < 40;
    });

    this.beacons.forEach((b, i) => {
      b.on = K.stage(k, 0.3 + i * 0.08, 0.45 + i * 0.08);
      b.a += dt * b.on * (3.2 + bassM * 3);
    });
    this._scatterPines();
  }

  _updateCamera(a, k, dt) {
    this.sweep.update(a, k, dt); this.dolly.update(a, k, dt);
    const [h0, b0, h1, b1] = CYCLE, T = h0 + b0 + h1 + b1;
    this.camT = (this.camT + dt) % T;
    const ct = this.camT;
    const w = ct < h0 ? 0 : ct < h0 + b0 ? (ct - h0) / b0 : ct < h0 + b0 + h1 ? 1 : 1 - (ct - h0 - b0 - h1) / b1;
    this.camW = smoothstep(w);
    // keep the blends short and clear of towers: the glide starts at the path point nearest the
    // security camera, and the next security camera is the mount nearest the glide (both swaps happen out of view)
    const phase = ct < h0 ? 0 : ct < h0 + b0 ? 1 : ct < h0 + b0 + h1 ? 2 : 3;
    if (phase !== this.camPhase) {
      if (phase === 1) this.dolly.s = this._nearestS(this.sweep.position);
      if (phase === 3) {
        const e = this.dolly.eye;
        let best = 0, bd = Infinity;
        MOUNTS.forEach((m, i) => {
          const clear = TOWERS.every(([tx, tz]) => segDist(e[0], e[2], m[0], m[2], tx, tz) > 9);
          const dd = Math.hypot(m[0] - e[0], m[2] - e[2]) + (i === this.mount ? 40 : i === this.prevMount ? 22 : 0) + (clear ? 0 : 1000);
          if (dd < bd) { bd = dd; best = i; }
        });
        this.prevMount = this.mount; const p = MOUNTS[this.mount = best];
        this.sweep.position = p; this.sweep.yaw0 = this._yawTo(p); this.sweep.phase = 0;
      }
      this.camPhase = phase;
    }
    // the glide looks a little in toward the compound
    const dt_ = this.dolly.target, cw = this.camW;
    for (let i = 0; i < 3; i++) {
      const dtg = lerp(dt_[i], CENTER[i] + (i === 1 ? 2 : 0), 0.35);
      this.eye[i] = lerp(this.sweep.eye[i], this.dolly.eye[i], cw);
      this.tgt[i] = lerp(this.sweep.target[i], dtg, cw);
    }
  }

  /** Deterministic pines around the camera, outside the fence and the glide path, shrinking at the edge. */
  _scatterPines() {
    const e = this.eye, CELL = 7, RAD = 9, edge = CELL * RAD;
    let n = 0;
    K.scatter(e[0], e[2], { cell: CELL, radius: RAD, seed: 21, jitter: 1 }, (x, z, dist, gx, gz) => {
      const out = Math.max(Math.abs(x) - FENCE_X, Math.abs(z) - FENCE_Z), h = K.rand2(gx, gz, 22);
      if (out < 17 || h > 0.6 || n >= this.pines.max || z < -70) return;
      const f = K.fadeOut(dist, edge - 14, edge);
      if (f <= 0) return;
      const s = (4 + K.rand2(gx, gz, 23) * 4) * f;
      this.pines.set(n++, x, groundHeight(x, z) - 0.3, z, s * 0.55, 0, 0.75 + h * 0.4, h * 40, 1 / 0.55);
    });
    this.pines.upload(n);
  }

  render(r) {
    const { col, k } = this, a = this.a, P = this.pal, d = K.drive(a, k), t = this.time, eye = this.eye;
    const dim = lerp(0.72, 1, k), fl = this.flash.v;
    scaleColor(col.fog, P.role('fog'), dim * (1 + k * 0.12));
    mixColor(col.fog, col.fog, P.role('glow'), fl * 0.12 * k);
    r.clear(col.fog);
    // blended camera: lerp the two rigs' camera params (beat / drop reactions, song shape, sway) as well
    const cw = this.camW, ps = this.sweep.camParams(this._ps || (this._ps = {})), pd = this.dolly.camParams(this._pd || (this._pd = {}));
    const e2 = this._e2 || (this._e2 = [0, 0, 0]);
    e2[0] = eye[0]; e2[1] = eye[1] + lerp(ps.lift, pd.lift, cw); e2[2] = eye[2];
    r.setCamera(e2, this.tgt, { fov: lerp(ps.fov, pd.fov, cw), near: 0.1, far: 220, roll: lerp(ps.roll, pd.roll, cw) });

    const storm = K.stage(k, 0.15, 0.85);
    this.sky.draw(r, eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: dim, starLevel: 0.4 * (1 - storm) + d.high * 0.15, moonScale: 1, cloudDrift: this.cloudT });

    r.setLight([0.35, -0.75, 0.55], scaleColor(col.light, P.role('light'), lerp(0.55, 0.75, k)), scaleColor(col.amb, P.role('ambient'), lerp(0.62, 0.72, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    this._pointLights(r, k, d, fl);

    // frozen ridge: own long fog so it reads as a pale silhouette until the storm swallows it
    r.setFog(col.fog, 30, lerp(240, 120, storm));
    r.draw(this.ridge, undefined, { texture: this.snowTex2, tint: col.tint });
    r.setFog(col.fog, 4, lerp(85, 55, storm));

    const frost = K.stage(k, 0.2, 1) * 0.55;
    this.ground.draw(r, { texture: this.snowTex, texture2: this.snowTex2, blend: K.stage(k, 0.1, 0.9) * 0.7, tint: col.tint });
    r.draw(this.concMesh, undefined, { texture: this.concTex, texture2: this.concTex2, blend: frost, tint: col.tint });
    r.draw(this.metalMesh, undefined, { texture: this.metalTex, texture2: this.metalTex2, blend: frost, tint: col.tint });
    r.draw(this.doorMesh, undefined, { texture: this.doorTex, tint: col.tint });
    r.draw(this.capMesh, undefined, { texture: this.snowTex2, tint: col.tint });
    r.drawInstanced(this.crateMesh, this.crates, { texture: this.crateTex, tint: col.tint });
    r.drawInstanced(this.fenceMesh, this.fence, { texture: this.fenceTex, tint: col.tint });
    r.draw(this.dishMesh, mat4.trs(this.m, RADAR[0], 10.9, RADAR[1], 0, this.radarYaw, 0), { texture: this.metalTex, texture2: this.metalTex2, blend: frost, tint: col.tint });
    r.drawInstanced(this.quad, this.pines, { texture: this.pineTex, billboard: 1, sway: 0.01 + this.gust * 0.006 + k * 0.01, tint: col.tint });

    // windows: a few lit at idle, the rest light in sequence; highs make some flicker
    const nw = this.windows.length;
    this.windows.forEach((wd, i) => {
      const idle = i % 3 === 0 ? 0.7 : 0;
      const on = Math.max(idle, K.stage(k, 0.08 + (i / nw) * 0.6, 0.18 + (i / nw) * 0.6));
      const flick = i % 4 === 1 ? 1 - d.high * 0.6 * (Math.sin(t * 29 + i * 5) > 0.2 ? 1 : 0) : 1;
      const p = rotXZ(wd.lx, wd.lz, wd.yaw);
      this.winInst.set(i, wd.x + p[0], wd.ly, wd.z + p[1], 1, wd.yaw, 0.1 + on * 0.85 * flick, 0, 1);
    });
    this.winInst.upload(nw);
    r.drawInstanced(this.winMesh, this.winInst, { texture: this.winTex, unlit: true, tint: col.tint });

    // ---- searchlights
    const nl = this.lights.length;
    this.lights.forEach((L, i) => {
      const rx = Math.PI / 2 + L.dip; // tilt +Y down past horizontal, then yaw
      const s = Math.max(1.2, L.len * 0.12);
      const toCam = this._facing(L);
      // a cone passing right by the lens would fill the screen: dim it by its closest approach to the camera
      const ex = eye[0] - L.x, ey = eye[1] - L.y, ez = eye[2] - L.z;
      const along = clamp(ex * L.dir[0] + ey * L.dir[1] + ez * L.dir[2], 0, L.len);
      const near = Math.hypot(ex - L.dir[0] * along, ey - L.dir[1] * along, ez - L.dir[2] * along) / Math.max(1, along * 0.12);
      const b = L.wake * (0.5 + k * 0.25 + fl * 0.45 + d.bass * 0.15) * lerp(0.06, 1, K.fadeIn(near, 0.8, 3));
      this.beams.set(i, L.x, L.y, L.z, s, L.yaw, b, 0, L.len / s, rx);
      this.heads.set(i, L.x, L.y - 0.1, L.z, 1, L.yaw, 0.9, 0, 1, rx);
      this.lensGlows.set(i, L.x + L.dir[0] * 0.5, L.y + L.dir[1] * 0.5, L.z + L.dir[2] * 0.5, (1.1 + toCam * 3.5) * (0.4 + L.wake * 0.6), 0, L.wake * (0.6 + toCam * 0.9 + d.high * 0.3 * Math.sin(t * 41 + i)), 0, 1);
      const hx = L.x + L.dir[0] * L.len, hz = L.z + L.dir[2] * L.len;
      this.pools.set(i, hx, groundHeight(hx, hz) + 0.35, hz, s * 2.2, L.yaw, L.hit ? b * 1.3 : 0, 0, Math.min(3, 1 / Math.max(0.3, Math.sin(L.dip))), Math.PI / 2);
    });
    [this.beams, this.heads, this.lensGlows, this.pools].forEach((x) => x.upload(nl));
    r.drawInstanced(this.headMesh, this.heads, { texture: this.metalTex, tint: col.tint });

    // ---- beacons: housings glow when on, beams spin, the glow flares as a beam faces the camera
    const nb = this.beacons.length;
    this.beacons.forEach((bc, i) => {
      const ca = Math.atan2(eye[0] - bc.x, eye[2] - bc.z);
      const face = Math.pow(Math.max(0, Math.cos(bc.a - ca)), 6) + Math.pow(Math.max(0, Math.cos(bc.a + Math.PI - ca)), 6);
      const flick = 1 + d.high * 0.5 * Math.sin(t * 37 + i * 2.3);
      const g = bc.on * ((0.3 + face * 1.1) * flick + fl * 0.9);
      this.beaconHeads.set(i, bc.x, bc.y - 0.02, bc.z, 1, 0, 0.18 + bc.on * 0.82 * (0.6 + face * 0.4), 0, 1);
      this.beaconGlows.set(i, bc.x, bc.y + 0.1, bc.z, 0.8 + face * 1.6 + fl * bc.on, 0, g, 0, 1);
      for (let j = 0; j < 2; j++) this.beaconBeams.set(i * 2 + j, bc.x, bc.y + 0.1, bc.z, 1.2, bc.a + j * Math.PI, bc.on * (0.55 + fl * 0.5), 0, 4.5 / 1.2, Math.PI / 2 + 0.06);
    });
    this.beaconHeads.upload(nb); this.beaconGlows.upload(nb); this.beaconBeams.upload(nb * 2);
    r.drawInstanced(this.beaconHeadMesh, this.beaconHeads, { texture: this.beaconTex, unlit: true, tint: col.tint });

    // additive light last: cones and pools ignore fog but fade with distance, so they shine through the snow
    col.one[0] = col.one[1] = col.one[2] = dim;
    r.drawInstanced(this.poolMesh, this.pools, { texture: this.coldGlowTex, unlit: true, additive: true, fog: false, tint: col.one, fade: [40, 95] });
    r.drawInstanced(this.beamMesh, this.beams, { texture: this.beamTex, unlit: true, additive: true, fog: false, fade: [45, 110], tint: col.one });
    r.drawInstanced(this.poolMesh, this.lensGlows, { texture: this.coldGlowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [50, 110], tint: col.one });
    r.drawInstanced(this.beamMesh, this.beaconBeams, { texture: this.beaconBeamTex, unlit: true, additive: true, fog: false, fade: [30, 80], tint: col.one });
    r.drawInstanced(this.poolMesh, this.beaconGlows, { texture: this.hotGlowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [40, 95], tint: col.one });

    this.snow.draw(r, { brightness: dim * 0.95 });
    this.storm.draw(r, { brightness: dim * 0.9 * K.stage(k, 0.2, 0.6) });
  }

  /** Beacon beams (red, swinging round) and searchlight pools (cold) as point lights; the best 4 near the view. */
  _pointLights(r, k, d, fl) {
    const { col } = this, P = this.pal, L = this.plights, eye = this.eye, tg = this.tgt;
    scaleColor(col.red, P.color(R(2, 2)), 2.2 + fl * 1.2);
    scaleColor(col.cold, P.role('light'), 1.5 + fl * 0.6 + d.bass * 0.3);
    L.begin();
    this.beacons.forEach((bc, i) => {
      if (bc.on <= 0.01) return;
      for (let j = 0; j < 2; j++) {   // ~2.4 m out along each beam: walls it faces catch it as it comes round
        const a = bc.a + j * Math.PI;
        L.add(i * 2 + j, bc.x + Math.sin(a) * 2.4, bc.y - 0.3, bc.z + Math.cos(a) * 2.4, col.red, 6.5, bc.on * (1 + d.high * 0.3 * Math.sin(this.time * 37 + i * 2.3)));
      }
    });
    this.lights.forEach((S, i) => {
      if (!S.hit || S.wake <= 0.01) return;
      const hx = S.x + S.dir[0] * S.len, hz = S.z + S.dir[2] * S.len;
      L.add(100 + i, hx, groundHeight(hx, hz) + 3, hz, col.cold, 10, S.wake * (0.7 + k * 0.3));
    });
    const fx = tg[0] - eye[0], fz = tg[2] - eye[2], fn = Math.hypot(fx, fz) || 1;
    col.focus[0] = eye[0] + (fx / fn) * 14; col.focus[1] = 2; col.focus[2] = eye[2] + (fz / fn) * 14;
    L.apply(r, col.focus, this.dt || 1 / 60);
  }

  /** How directly a searchlight points at the camera (0..1), for lens glare. */
  _facing(L) {
    const e = this.eye, dx = e[0] - L.x, dy = e[1] - L.y, dz = e[2] - L.z, l = Math.hypot(dx, dy, dz) || 1;
    const c = (dx * L.dir[0] + dy * L.dir[1] + dz * L.dir[2]) / l;
    return Math.pow(Math.max(0, c), 8);
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.snow.dispose(r); this.storm.dispose(r);
    [this.ridge, this.concMesh, this.metalMesh, this.doorMesh, this.capMesh, this.crateMesh, this.fenceMesh, this.dishMesh,
      this.quad, this.winMesh, this.beamMesh, this.poolMesh, this.headMesh, this.beaconHeadMesh].forEach((m) => m.dispose());
    [this.snowTex, this.snowTex2, this.concTex, this.concTex2, this.metalTex, this.metalTex2, this.doorTex, this.crateTex, this.fenceTex,
      this.pineTex, this.winTex, this.beamTex, this.beaconBeamTex, this.coldGlowTex, this.hotGlowTex, this.beaconTex].forEach((x) => r.deleteTexture(x));
    [this.crates, this.fence, this.pines, this.winInst, this.beams, this.beaconBeams, this.pools, this.lensGlows, this.beaconGlows, this.heads, this.beaconHeads].forEach((i) => i.dispose());
  }
}
