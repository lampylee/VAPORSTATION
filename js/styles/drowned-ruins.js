// DROWNED RUINS — drifting through a sunken temple on the sea floor.
//
//   sandy dunes                         K.Terrain + K.fbm, animated caustic overlay (flipbook)
//   colonnades, toppled columns,        K.props.prism / crate / arch, instanced, laid out
//   blocks and half-buried arches       along the camera's path (camera swims through arches)
//   kelp forests                        local kelp sprites, instanced upright billboards + sway
//   schools of small fish               local fish mesh, instanced, analytic "boids-lite" loops
//   bubbles + pressure-pulse bursts     K.Particles 'bubbles' (two fields)
//   light shafts from the surface       tall additive billboards, local dithered shaft sprite
//   bioluminescent glows + sparkle      K.sprites.glow on the ruins, K.Particles fireflies
//   the "sky"                           K.Sky dome only: a fogged gradient up to the surface
//
// Intensity: idle = deep, dark, slow drift, sparse bubbles, kelp barely moving.
// Swell = water brightens, light shafts fade in, fish schools grow, glows switch
// on across the ruins. Bass = currents (kelp sway, fish speed, drift speed).
// Beat = pressure pulse (bubble burst, camera nudge, shaft flare). Highs = sparkle.
import { mat4, lerp, damp, clamp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { blotch, glyphStone, CLEAR } from '../gfx/textures.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const TAU = Math.PI * 2;

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

// ---------- local sprites / textures (suggested kit additions) ----------

/** Kelp frond: wavy stalk with alternating blades. 16x64. */
function kelpSprite({ ramp = 1, seed = 1 } = {}) {
  const rnd = (a, b) => K.rand2(a, b, seed);
  const stalk = (y) => 7.5 + Math.sin((y / 63) * 7 + seed) * 2 * (1 - (y / 63) * 0.6);
  // buoyant blades: leaf shapes rising up and out from the stalk, alternating sides
  const blades = [];
  for (let y0 = 6 + seed % 3, i = 0; y0 < 58; y0 += 5 + rnd(i, 0) * 2, i++) {
    const side = i % 2 ? 1 : -1, len = (5 + rnd(i, 1) * 3) * (1 - (y0 / 63) * 0.35);
    const ax = stalk(y0), ay = y0, bx = Math.max(0.5, Math.min(15.5, ax + side * len * 0.8)), by = y0 - len * 0.75;
    blades.push([ax, ay, bx, by, 1.4 + rnd(i, 2) * 0.8]);
  }
  return make(16, 64, (x, y) => {
    const t = y / 63; // 0 = top, 1 = root
    if (Math.abs(x - stalk(y)) < 0.8) return dshade(ramp, 1.4 + (1 - t) * 0.9, x, y);
    for (const [ax, ay, bx, by, w] of blades) {
      const dx = bx - ax, dy = by - ay, u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(x - ax - dx * u, y - ay - dy * u) < w * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.08))) {
        return dshade(ramp, 2.9 - u * 0.9 - t * 0.7, x, y);
      }
    }
    return CLEAR;
  });
}

/** Tall light shaft: bright core, dithered falloff to transparent, brighter at the top. 16x64. */
function shaftSprite({ ramp = 3 } = {}) {
  return make(16, 64, (x, y) => {
    const t = y / 63, across = 1 - Math.abs(x - 7.5) / 8;
    const b = across * across * (1 - t * 0.75);
    if (b < 0.05 + bayer(x, y) * 0.22) return CLEAR;
    return dshade(ramp, 1 + b * 2.4, x, y);
  });
}

/**
 * Caustic network flipbook: tileable interference lines, CLEAR elsewhere.
 * Draw additively over surfaces and cycle the frames.
 */
function causticFrames(n = 8, ramp = 3) {
  const frames = [];
  for (let f = 0; f < n; f++) {
    const ph = (f / n) * TAU;
    frames.push(make(64, 64, (x, y) => {
      const u = (x / 64) * TAU, v = (y / 64) * TAU;
      const a = Math.sin(2 * u + 1.4 * Math.sin(3 * v + ph));
      const b = Math.sin(2 * v + 1.4 * Math.sin(3 * u - ph));
      const c = Math.sin(2 * (u + v) + Math.sin(u - 2 * v + ph * 2));
      const w = Math.abs(a + b + c) / 3; // 0 on the network lines
      if (w < 0.07) return R(ramp, 3);
      if (w < 0.15 + bayer(x, y) * 0.06) return R(ramp, 2);
      return CLEAR;
    }));
  }
  return frames;
}

/** Fish texture: dark back, light belly (rows top → bottom). 4x8. */
function fishTex() {
  return make(4, 8, (x, y) => (y < 3 ? R(1, 1) : y < 5 ? R(3, 2) : R(0, 3)));
}

/** Small diamond fish with a tail fin; nose along +X, ~1 unit long. */
function fishGeo() {
  const g = new GeoBuilder();
  const nose = [0.5, 0, 0], tail = [-0.28, 0, 0], top = [0, 0.16, 0], bot = [0, -0.13, 0], l = [0, 0, 0.09], rr = [0, 0, -0.09];
  const T = [0.5, 0], B = [0.5, 1], M = [0.5, 0.5];
  for (const s of [l, rr]) {
    g.tri(nose, top, s, M, T, M); g.tri(nose, s, bot, M, M, B);
    g.tri(tail, s, top, M, M, T); g.tri(tail, bot, s, M, B, M);
  }
  g.tri(tail, [-0.55, 0.16, 0], [-0.55, -0.14, 0], M, T, B);
  return g.build();
}

/** Prism lying along X (toppled column), pivot at its middle, resting on y = 0. */
function lyingColumn(len = 5, radius = 0.55, sides = 8) {
  const geo = K.props.prism(sides, radius, len, { uvRepeat: [2, 3] }), p = geo.positions, n = geo.normals;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1];
    p[i] = y - len / 2; p[i + 1] = -x + radius * 0.85; // rotate -90° about Z, sink a little
    const nx = n[i], ny = n[i + 1]; n[i] = ny; n[i + 1] = -nx;
  }
  return geo;
}

// ---------- world shape ----------

const PATH_R = (a) => 44 + Math.sin(a * 3) * 9 + Math.sin(a * 2 + 1) * 4;
const height = (x, z) => {
  const dune = K.fbm(x * 0.022, z * 0.022, { octaves: 3, seed: 7 }) * 5;
  const ripple = Math.sin(x * 0.18 + K.fbm(x * 0.05, z * 0.05, { octaves: 2, seed: 2 }) * 4) * 0.35;
  return dune + ripple - 2;
};
const KELP_CELL = 3.2, KELP_RADIUS = 16, SHAFT_CELL = 12, SHAFT_RADIUS = 4;
const SCHOOLS = 6, PER_SCHOOL = 30;

export class DrownedRuins {
  static meta = { name: 'Drowned Ruins' };
  static palette = fromKeys('drowned-ruins', 'Drowned Ruins', ['#b49a6c', '#3d7a44', '#52f0dc', '#0e3a46']);

  init(r) {
    this.ground = new K.Terrain(r, { size: 110, cells: 32, height, uvScale: 0.3 });
    this.sandTex = r.texture(blotch({ ramp: 0, scale: 8, seed: 5, minShade: 1, noise: 0.2 }));
    this.sky = new K.Sky(r, {});

    // ---- camera: a wobbly loop through the temple district
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU, rad = PATH_R(a), x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      pts.push([x, height(x, z) + 4 + Math.sin(i * 1.7) * 1.2, z]);
    }
    this.path = new K.Spline(pts);
    this.cam = new K.DollyRig(this.path, { idleSpeed: 1.1, activeSpeed: 4, bassBoost: 3.5, lookAhead: 10, groundFn: height, minClearance: 2.2, fov: 62, nudge: 0.5 });

    // ---- ruins along the path
    this.stoneTex = r.texture(glyphStone({ ramp: 0, glyph: R(2, 1), seed: 9 }));
    this.blockTex = r.texture(blotch({ ramp: 0, scale: 8, seed: 11 }));
    this.colMesh = r.createMesh(K.props.prism(8, 0.5, 1, { uvRepeat: [2, 3] }));
    this.lyingMesh = r.createMesh(lyingColumn());
    this.blockMesh = r.createMesh(K.props.crate(1));
    this.archMesh = r.createMesh(K.props.arch(8, 6.5, 0.9, 0.9, 7));
    this.colInst = r.createInstances(110);
    this.lyingInst = r.createInstances(30);
    this.blockInst = r.createInstances(200);
    this.archInst = r.createInstances(12);
    this.glowSpots = [];
    this._layoutRuins();

    // ---- kelp
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.kelpTex = [r.texture(kelpSprite({ seed: 1 })), r.texture(kelpSprite({ seed: 4 }))];
    this.kelp = [r.createInstances(800), r.createInstances(800)];

    // ---- light shafts, glows, caustics
    this.shaftTex = r.texture(shaftSprite());
    this.shafts = r.createInstances(90);
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.glows = r.createInstances(this.glowSpots.length);
    this.caustics = causticFrames(8).map((f) => r.texture(f));

    // ---- fish
    this.fishMesh = r.createMesh(fishGeo());
    this.fishTex = r.texture(fishTex());
    this.fish = r.createInstances(SCHOOLS * PER_SCHOOL);
    this.schools = Array.from({ length: SCHOOLS }, (_, i) => ({
      a0: K.rand2(i, 1, 21) * TAU, dir: i % 2 ? 1 : -1, rad: 10 + K.rand2(i, 2, 21) * 22,
      w: 0.05 + K.rand2(i, 3, 21) * 0.05, y: 1.5 + K.rand2(i, 4, 21) * 4, size: 0.75 + K.rand2(i, 5, 21) * 0.45,
    }));
    this.fishSeed = Array.from({ length: SCHOOLS * PER_SCHOOL }, (_, j) => [K.rand2(j, 1, 33), K.rand2(j, 2, 33), K.rand2(j, 3, 33)]);

    // ---- particles
    this.bubbles = new K.Particles(r, 'bubbles');
    this.burst = new K.Particles(r, 'bubbles', { count: 160, size: 0.2, vel: [0, 3.2, 0], jitter: [0.6, 1.2, 0.6], area: [16, 12, 16], wobble: 1.6 });
    this.sparkle = new K.Particles(r, 'fireflies', { count: 160, size: 0.12, vel: [0, 0.25, 0], area: [26, 10, 26], yOffset: -1, wobble: 1.3 });

    this.pulse = new K.Envelope(0.4);
    this.burstEnv = new K.Envelope(0.9);
    this.time = 0; this.k = 0; this.a = null;
    this.cur = 0; this.hi = 0; this.hiS = 0; this.swimT = 0; this.causticT = 0;
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], caus: [0, 0, 0], shaft: [0, 0, 0], one: [1, 1, 1] };
    this.m = mat4.create();
  }

  /** Deterministic temple layout: colonnades, arches and rubble beside the path. */
  _layoutRuins() {
    const L = this.path.length, p = [0, 0, 0], q = [0, 0, 0];
    let nc = 0, nl = 0, nb = 0, na = 0;
    const block = (x, z, s, rot, sink = 0.35) => {
      if (nb < this.blockInst.max) this.blockInst.set(nb++, x, height(x, z) - s * sink, z, s, rot, 0.75 + K.rand2(nb, 9, 3) * 0.35, 0, 1);
    };
    for (let s = 0, i = 0; s < L; s += 7, i++) {
      this.path.at(s / L, p); this.path.at((s + 1) / L, q);
      let tx = q[0] - p[0], tz = q[2] - p[2]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const nx = -tz, nz = tx, yaw = Math.atan2(-tz, tx);
      const district = K.fbm(s * 0.02, 3.1, { octaves: 2, seed: 4 }); // temple sections vs open sand
      // arches spanning the path every ~42 units (camera swims through them)
      if (i % 6 === 0 && na < this.archInst.max) {
        this.archInst.set(na++, p[0], height(p[0], p[2]) - 1.4, p[2], 1, yaw + Math.PI / 2, 0.9, 0, 1);
        this.glowSpots.push([p[0], height(p[0], p[2]) + 7.3, p[2], 1.6]);
      }
      // colonnade pairs
      if (district > 0.4) {
        for (const side of [-1, 1]) {
          const h = K.rand2(i, side + 5, 1), x = p[0] + nx * 6.5 * side, z = p[2] + nz * 6.5 * side, y = height(x, z);
          if (h < 0.15) continue; // missing column
          const tall = h > 0.6 ? 7 + h * 2 : 1.2 + h * 5; // standing vs broken stump
          if (nc < this.colInst.max) this.colInst.set(nc++, x, y - 0.4, z, 1.4, h * 6, 0.8 + h * 0.3, 0, tall / 1.4);
          block(x, z, 1.7, yaw, 0.6); // plinth
          if (h < 0.6) {
            if (h < 0.4 && nl < this.lyingInst.max) { // the rest of it lies in the sand nearby
              const lx = x + nx * side * 3, lz = z + nz * side * 3;
              this.lyingInst.set(nl++, lx, height(lx, lz) - 0.3, lz, 1.2, yaw + (h - 0.3) * 3, 0.9, 0, 1);
            }
            if (K.rand2(i, side, 7) > 0.35) this.glowSpots.push([x, y + tall - 0.4, z, 1.1]);
          }
        }
      }
      // rubble field
      const nr = 1 + Math.floor(K.rand2(i, 3, 2) * 3);
      for (let j = 0; j < nr; j++) {
        const side = K.rand2(i, j, 4) > 0.5 ? 1 : -1, off = 9 + K.rand2(i, j, 5) * 16, along = (K.rand2(i, j, 6) - 0.5) * 6;
        const x = p[0] + nx * off * side + tx * along, z = p[2] + nz * off * side + tz * along, sz = 0.8 + K.rand2(i, j, 8) * 2.2;
        block(x, z, sz, K.rand2(i, j, 9) * 6);
        if (sz > 2.2 && K.rand2(i, j, 10) > 0.5) { block(x + 0.3, z - 0.2, sz * 0.6, K.rand2(i, j, 11) * 6, -1.05); this.glowSpots.push([x, height(x, z) + sz * 1.3, z, 1]); }
      }
    }
    this.colInst.upload(nc); this.lyingInst.upload(nl); this.blockInst.upload(nb); this.archInst.upload(na);
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k);
    this.cur = damp(this.cur, d.bass, 0.4, dt);   // "current" strength from bass
    this.hi = damp(this.hi, d.high, 0.08, dt);
    const bm = d.beatMotion;
    this.hiS = damp(this.hiS, d.high, 0.5, dt);   // sparkle drift speed: eased at Gentle (the glint itself stays on this.hi)
    this.cam.heightOffset = Math.sin(this.time * 0.23) * 0.8;
    this.cam.update(a, k, dt);
    const eye = this.cam.eye;
    this.ground.follow(eye[0], eye[2]);
    if (d.beat) { this.pulse.trigger(k); this.burstEnv.trigger(0.5 + 0.5 * k); }
    this.pulse.update(dt); this.burstEnv.update(dt);

    const wind = [Math.cos(this.time * 0.05) * this.cur * 2.5, Math.sin(this.time * 0.05) * this.cur * 2.5];
    this.bubbles.update(dt, eye, { amount: K.swell(k, 0.18, 0.55), speed: 0.6 + k * 0.6 + this.cur, wind });
    this.burst.update(dt, [eye[0] + (this.cam.target[0] - eye[0]) * 0.5, eye[1] - 2, eye[2] + (this.cam.target[2] - eye[2]) * 0.5], { amount: lerp(d.groove * 0.3, this.burstEnv.v * k, bm), speed: 1 + this.burstEnv.v * bm, wind });   // Gentle: a steady groove-swung drift of bubbles instead of beat bursts
    this.sparkle.update(dt, eye, { amount: K.stage(k, 0.05, 0.5) * 0.85, speed: 0.6 + lerp(this.hiS, this.hi, bm) * 2, wind });

    this.swimT += dt * (K.swell(k, 0.35, 1) + this.cur * 1.6);
    this.causticT += dt * (0.6 + k * 0.6 + this.cur);
    this._scatter();
    this._fish(k);
  }

  /** Kelp forests and light shafts in world cells around the camera (infinite sea floor). */
  _scatter() {
    const e = this.cam.eye;
    let cx = Math.floor(e[0] / KELP_CELL), cz = Math.floor(e[2] / KELP_CELL);
    const n = [0, 0];
    for (let j = -KELP_RADIUS; j <= KELP_RADIUS; j++) for (let i = -KELP_RADIUS; i <= KELP_RADIUS; i++) {
      const gx = cx + i, gz = cz + j;
      const x = (gx + K.rand2(gx, gz, 2)) * KELP_CELL, z = (gz + K.rand2(gx, gz, 3)) * KELP_CELL;
      const forest = K.fbm(x * 0.03, z * 0.03, { octaves: 2, seed: 12 });
      if (forest < 0.42 || K.rand2(gx, gz, 1) > (forest - 0.42) * 4.5) continue;
      const rr = Math.hypot(x, z);
      if (Math.abs(rr - PATH_R(Math.atan2(z, x))) < 3.5) continue; // keep the swim lane clear
      const v = K.rand2(gx, gz, 4) > 0.5 ? 1 : 0, inst = this.kelp[v];
      if (n[v] >= inst.max) continue;
      const h = 5 + K.rand2(gx, gz, 5) * 8;
      inst.set(n[v]++, x, height(x, z) - 0.3, z, 1.8, 0, 0.75 + K.rand2(gx, gz, 6) * 0.45, K.rand2(gx, gz, 7) * 40, h / 1.8);
    }
    this.kelp[0].upload(n[0]); this.kelp[1].upload(n[1]);

    cx = Math.floor(e[0] / SHAFT_CELL); cz = Math.floor(e[2] / SHAFT_CELL);
    let ns = 0;
    const t = this.time;
    for (let j = -SHAFT_RADIUS; j <= SHAFT_RADIUS; j++) for (let i = -SHAFT_RADIUS; i <= SHAFT_RADIUS; i++) {
      const gx = cx + i, gz = cz + j;
      if (K.rand2(gx, gz, 14) > 0.45) continue;
      const x = (gx + K.rand2(gx, gz, 15)) * SHAFT_CELL + Math.sin(t * 0.07 + gx) * 2, z = (gz + K.rand2(gx, gz, 16)) * SHAFT_CELL + Math.cos(t * 0.06 + gz) * 2;
      const dist = Math.hypot(x - e[0], z - e[2]);
      const fade = (1 - clamp((dist - 16) / 26)) * clamp((dist - 3) / 9); // fades out far away and right in front of the camera
      if (fade <= 0 || ns >= this.shafts.max) continue;
      const shimmer = 0.7 + 0.3 * Math.sin(t * 0.6 + gx * 3.1 + gz * 1.7);
      const w = 2.5 + K.rand2(gx, gz, 17) * 3.5;
      this.shafts.set(ns++, x, height(x, z) - 1, z, w, 0, fade * shimmer, 0, 46 / w);
    }
    this.shafts.upload(ns);
  }

  /** Schools swim loops around the temple; each fish mills around its school centre. */
  _fish(k) {
    const T = this.swimT, f = this.fish;
    let n = 0;
    for (let s = 0; s < SCHOOLS; s++) {
      const S = this.schools[s];
      for (let j = 0; j < PER_SCHOOL; j++) {
        const g = s * PER_SCHOOL + j, [r1, r2, r3] = this.fishSeed[g];
        // swell: school 0 is always partly there, the rest fade in by growing from nothing
        const th = s === 0 && j < 10 ? -1 : 0.05 + ((s * 0.13 + j / PER_SCHOOL) % 1) * 0.75;
        const grow = th < 0 ? 1 : K.stage(k, th, th + 0.12);
        if (grow <= 0.001) continue;
        const pos = (t, out) => {
          const a = S.a0 + S.dir * t * S.w * 3;
          const rad = PATH_R(a) + Math.sin(t * 0.13 + s) * S.rad * 0.4 - 8 + S.rad * 0.3;
          const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
          const ph = r1 * TAU + t * (0.6 + r2 * 0.5) * S.dir;
          const spread = 1.2 + r3 * 2.2;
          out[0] = cx + Math.cos(ph) * spread;
          out[2] = cz + Math.sin(ph) * spread * 0.7;
          out[1] = height(cx, cz) + S.y + Math.sin(ph * 1.3 + r2 * 5) * 0.8 + (r3 - 0.5) * 1.5;
          return out;
        };
        const p0 = pos(T, _a), p1 = pos(T + 0.05, _b);
        const rot = Math.atan2(-(p1[2] - p0[2]), p1[0] - p0[0]);
        f.set(n++, p0[0], p0[1], p0[2], S.size * grow * (0.8 + r2 * 0.4), rot, 0.8 + r3 * 0.4, 0, 1);
      }
    }
    f.upload(n);
  }

  render(r) {
    const { col, k } = this, a = this.a, P = this.pal, d = K.drive(a, k), eye = this.cam.eye, t = this.time;
    const pv = this.pulse.v;
    const dim = lerp(0.52, 1, k) + pv * 0.08;
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    // no sky: the surface far above, a fogged gradient
    this.sky.draw(r, eye, { horizon: col.fog, zenith: P.color(R(3, 2)), brightness: lerp(0.3, 0.9, k) + pv * 0.1 });

    r.setFog(col.fog, 4, lerp(36, 58, k));
    r.setLight([0.45, -0.8, 0.35], scaleColor(col.light, P.role('light'), lerp(0.4, 0.85, k) + pv * 0.15), scaleColor(col.amb, P.role('ambient'), lerp(0.38, 0.55, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = lerp(0.7, 1, k);

    // opaque: sand, ruins, fish
    this.ground.draw(r, { texture: this.sandTex, tint: col.tint });
    r.drawInstanced(this.colMesh, this.colInst, { texture: this.stoneTex, tint: col.tint });
    r.drawInstanced(this.lyingMesh, this.lyingInst, { texture: this.stoneTex, tint: col.tint });
    r.drawInstanced(this.blockMesh, this.blockInst, { texture: this.blockTex, tint: col.tint });
    r.drawInstanced(this.archMesh, this.archInst, { texture: this.stoneTex, tint: col.tint });
    r.drawInstanced(this.fishMesh, this.fish, { texture: this.fishTex, tint: col.tint });

    // kelp (cut-out billboards), currents bend it
    const sway = 0.05 + k * 0.06 + this.cur * 0.35;
    r.drawInstanced(this.quad, this.kelp[0], { texture: this.kelpTex[0], billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.kelp[1], { texture: this.kelpTex[1], billboard: 1, sway: sway * 0.8, tint: col.tint });

    // caustics: additive flipbook over sand and columns
    const frame = this.caustics[Math.floor(this.causticT * 6) % this.caustics.length];
    const cb = (lerp(0.07, 0.4, k) + pv * 0.25) * (0.85 + 0.15 * Math.sin(t * 1.3));
    col.caus[0] = col.caus[1] = col.caus[2] = cb;
    const drift = this.causticT * 0.03;
    r.draw(this.ground.mesh, this.m, { texture: frame, additive: true, unlit: true, tint: col.caus, uvScale: [0.6, 0.6], uvOffset: [drift, drift * 0.6] });
    r.drawInstanced(this.colMesh, this.colInst, { texture: frame, additive: true, unlit: true, tint: col.caus, uvOffset: [drift, 0] });

    // light shafts fade in with the swell, flare on the pressure pulse
    const sb = K.stage(k, 0.1, 0.6) * 0.75 + 0.06 + pv * 0.6 * k;
    col.shaft[0] = col.shaft[1] = col.shaft[2] = sb;
    r.drawInstanced(this.quad, this.shafts, { texture: this.shaftTex, billboard: 1, unlit: true, additive: true, tint: col.shaft });

    // bioluminescence switches on across the ruins, flickering with highs
    const ng = this.glowSpots.length;
    let n = 0;
    for (let i = 0; i < ng; i++) {
      const on = K.stage(k, 0.12 + (i / ng) * 0.55, 0.25 + (i / ng) * 0.55);
      if (on <= 0.001) continue;
      const [x, y, z, s] = this.glowSpots[i];
      const fl = on * (0.65 + 0.35 * Math.sin(t * 2.1 + i * 2.7)) * (1 + this.hi * 1.4);
      this.glows.set(n++, x, y + Math.sin(t * 0.8 + i) * 0.15, z, s * (1 + lerp(d.groove, d.pulse, d.beatMotion) * 0.4), 0, fl, 0, 1);
    }
    this.glows.upload(n);
    r.drawInstanced(this.quad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, tint: col.one });

    this.bubbles.draw(r, { brightness: dim * 0.8 });
    this.burst.draw(r, { brightness: dim });
    this.sparkle.draw(r, { brightness: K.stage(k, 0.05, 0.5) * (0.2 + this.hi * 2.4) });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    this.bubbles.dispose(r); this.burst.dispose(r); this.sparkle.dispose(r);
    [this.colMesh, this.lyingMesh, this.blockMesh, this.archMesh, this.quad, this.fishMesh].forEach((m) => m.dispose());
    [this.sandTex, this.stoneTex, this.blockTex, this.shaftTex, this.glowTex, this.fishTex, ...this.kelpTex, ...this.caustics].forEach((x) => r.deleteTexture(x));
    [this.colInst, this.lyingInst, this.blockInst, this.archInst, this.shafts, this.glows, this.fish, ...this.kelp].forEach((i) => i.dispose());
  }
}
const _a = [0, 0, 0], _b = [0, 0, 0];
