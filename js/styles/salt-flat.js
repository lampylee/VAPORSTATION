// SALT FLAT — a bleached salt pan under a wide pale sky (for "High and Dry").
//
//   cracked hexagonal salt crust     indexed tileable Voronoi texture on K.Terrain
//   wind-scoured crust (swell)       texture2 + blend dither-crossfade
//   a few low mesas on the horizon   one dynamic mesh, vertices wobble with heat shimmer
//   mirage band near the horizon     camera-relative strip, screen-door opacity, wobbling verts
//   lone dead roadside sign          K.forSegments: one every ~140 units, blank weathered face
//   salt crust lumps                 K.scatter + instancing, K.fadeOut at the edge
//   wind-blown salt                  K.Particles (dust preset, low to the ground)
//   soft dust ring on the beat       ring decals (K.ringSprite) with screen-door fade, scaled by audio.accent
//   slow drift toward the horizon    K.PathRig, speed from smoothed energy (not bass)
//
// Idle: still, hazy, faint shimmer, a few motes of salt. Swell: haze lifts, shimmer
// grows, salt streams across the ground, the drift speeds up a little.
// No road, no lane markings, no traffic.
import { mat4, lerp, damp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, merge } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const SIGN_EVERY = 140;              // path units between signs (one at a time, mostly)
const LUMP_CELL = 7, LUMP_RADIUS = 10;
const MIRAGE_NEAR = 16, MIRAGE_FAR = 58, MIRAGE_HALF_W = 90, MIRAGE_SEGS = 24;

const pathX = (s) => Math.sin(s * 0.011) * 9 + Math.sin(s * 0.0037 + 1.3) * 14;
const height = (x, z) => K.fbm(x * 0.012, z * 0.012, { octaves: 2, seed: 7 }) * 0.5;

/** Value noise that tiles every 64 px (cell must divide 64), so textures have no seams. */
function tileBlob(x, y, cell, seed) {
  const n = 64 / cell, fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
  const h = (i, j) => K.rnd(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Tileable cracked salt crust: hexagonal cells (offset-lattice Voronoi) with raised rims. */
function saltCrust({ scoured = false } = {}) {
  const N = 4, S = 16, pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    pts.push([i * S + (j & 1) * S / 2 + (K.rnd(i, j, 3) - 0.5) * 5, j * S + (K.rnd(i, j, 5) - 0.5) * 5]);
  }
  return K.makeIndexed(64, 64, (x, y) => {
    let d1 = 1e9, d2 = 1e9, nx = 0, ny = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) for (const p of pts) {
      const px = p[0] + ox * 64, py = p[1] + oy * 64, d = Math.hypot(x - px, y - py);
      if (d < d1) { d2 = d1; d1 = d; nx = x - px; ny = y - py; } else if (d < d2) d2 = d;
    }
    const e = d2 - d1;                                  // ~distance to the cell edge
    const blob = tileBlob(x, y, 8, scoured ? 11 : 4);
    if (e < 0.7) return scoured && blob > 0.55 ? R(0, 2) : R(0, 1);   // the crack itself
    if (e < 1.8) return nx + ny > 0 ? R(0, 2) : R(2, 3);              // raised rim, lit on one side
    if (e < 2.6 && nx + ny <= 0) return R(2, 3);                     // salt piled against the rim
    // cell interior: flat patches, no fine dither (it shimmers into noise at a distance)
    if (scoured) return blob > 0.38 ? R(2, 3) : R(0, 3);
    return blob > 0.66 ? R(0, 2) : R(0, 3);
  });
}

/** Sign atlas: top half = blank, sun-bleached face (no text), bottom = post metal. 32x32. */
function signAtlas() {
  return K.makeIndexed(32, 32, (x, y) => {
    if (y >= 16) return K.dshade(0, 0.8 + K.rnd(x >> 1, y >> 1, 2) * 0.8, x, y);
    if (x === 0 || y === 0 || x === 31 || y === 15) return R(0, 1);              // bent frame
    const peel = K.blobNoise(x, y, 4, 8);
    if (peel > 0.72) return K.ditherPick(R(0, 1), R(0, 2), 0.5, x, y);            // rust bloom
    if (peel > 0.58) return R(0, 3);                                               // paint gone, bare metal
    return K.dshade(1, 1.6 + K.blobNoise(x, y, 7, 3) * 1.2, x, y);                 // faded face, nothing on it
  });
}

/** Mirage: horizontal broken lines of sky colour; dense at the far edge (v=0), dissolving toward the near edge. */
function mirageTex() {
  return K.makeIndexed(64, 32, (x, y) => {
    const t = 1 - y / 31, line = tileBlob(x, (y * 4) & 63, 8, 6);
    if (t * t * 0.95 + line * 0.25 < K.bayer(x, y) + 0.2) return K.CLEAR;
    return line > 0.62 ? R(1, 3) : K.ditherPick(R(1, 2), R(1, 3), 0.35, x, y);
  });
}

/** A few broad flat-topped mesas in a ring segment ahead, stored camera-relative. */
function mesaGeo() {
  const g = new GeoBuilder();
  const list = [[-70, -150, 26, 9], [-28, -175, 18, 6], [18, -160, 34, 7.5], [64, -140, 20, 10], [105, -120, 16, 5], [-115, -110, 22, 6.5]];
  for (const [cx, cz, w, h] of list) {
    const sides = 9, top = 0.72, rows = 3;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const r0 = w * (0.8 + K.rand2(i, cx, 1) * 0.4), r1 = w * (0.8 + K.rand2((i + 1) % sides, cx, 1) * 0.4);
      const P = (a, r, f) => [cx + Math.cos(a) * r * lerp(1, top, f), h * f, cz + Math.sin(a) * r * 0.35 * lerp(1, top, f)];
      for (let j = 0; j < rows; j++) {
        const f0 = j / rows, f1 = (j + 1) / rows, c0 = [0.75 + f0 * 0.25, 0.75 + f0 * 0.25, 0.75 + f0 * 0.25], c1 = [0.75 + f1 * 0.25, 0.75 + f1 * 0.25, 0.75 + f1 * 0.25];
        g.quad(P(a1, r1, f0), P(a0, r0, f0), P(a0, r0, f1), P(a1, r1, f1), [0, 0], [0, 0], [0, 0], [0, 0], null, [c0, c0, c1]);
      }
      g.tri([cx, h, cz], P(a1, r1, 1), P(a0, r0, 1), [0, 0], [0, 0], [0, 0], [0, 1, 0], [1, 1, 1]);
    }
  }
  return g.build();
}

/** Flat strip in camera space (forward = -z), subdivided along x so its vertices can wobble. */
function mirageGeo() {
  const g = new GeoBuilder(), n = MIRAGE_SEGS;
  for (let i = 0; i < n; i++) {
    const x0 = -MIRAGE_HALF_W + (2 * MIRAGE_HALF_W * i) / n, x1 = -MIRAGE_HALF_W + (2 * MIRAGE_HALF_W * (i + 1)) / n;
    const u0 = (i / n) * 6, u1 = ((i + 1) / n) * 6;
    g.quad([x0, 0, -MIRAGE_NEAR], [x1, 0, -MIRAGE_NEAR], [x1, 0, -MIRAGE_FAR], [x0, 0, -MIRAGE_FAR], [u0, 1], [u1, 1], [u1, 0], [u0, 0], [0, 1, 0]);
  }
  return g.build();
}

/** Two posts and a slightly twisted blank panel, one mesh with the sign atlas. Pivot at the base. */
function signGeo() {
  const post = (x) => K.atlasUV(K.props.shift(K.props.prism(4, 0.06, 2.7, { cap: false }), x, 0, 0), [0, 0.5, 1, 1]);
  const face = K.atlasUV(K.props.shift(K.props.crate(1), 0, -0.5, 0), [0, 0, 1, 0.5]);
  K.props.transform(face, { pos: [0, 2.15, 0.07], rot: [0, 0.06, 0.03], scale: [2.0, 1.05, 0.06] });
  return merge([{ geo: post(-0.7) }, { geo: post(0.7) }, { geo: face }]);
}

export class SaltFlat {
  static meta = { name: 'Salt Flat' };
  static palette = ALBUM_PALETTES.bends;

  init(r) {
    this.ground = new K.Terrain(r, { size: 260, cells: 80, height, uvScale: 1 / 10, shadeRange: [0.86, 1], slopeShade: 0.3 });
    this.crustTex = r.texture(saltCrust());
    this.crustTex2 = r.texture(saltCrust({ scoured: true }));
    this.sky = new K.Sky(r, {});   // a wide, empty pale sky

    const path = (s, out) => { out[0] = pathX(s); out[1] = 1.7 + Math.sin(s * 0.03) * 0.08; out[2] = -s; return out; };
    this.cam = new K.PathRig(path, { lookAhead: 12, fov: 62, far: 260, idleSpeed: 0.7, activeSpeed: 1.8, bassBoost: 0, fovPunch: 1.2, nudge: 0.06, rollKick: 0.008 });

    this.mesaBase = mesaGeo();
    this.mesaLive = { ...this.mesaBase, positions: new Float32Array(this.mesaBase.positions) };
    this.mesas = r.createMesh(this.mesaLive, true);

    this.mirBase = mirageGeo();
    this.mirLive = { ...this.mirBase, positions: new Float32Array(this.mirBase.positions) };
    this.mirage = r.createMesh(this.mirLive, true);
    this.mirTex = r.texture(mirageTex());

    this.signMesh = r.createMesh(signGeo());
    this.signTex = r.texture(signAtlas());

    this.lumpMesh = r.createMesh(K.props.prism(5, 0.55, 0.32, { taper: 0.35 }));
    this.lumpTex = r.texture(K.makeIndexed(16, 16, (x, y) => K.ditherPick(R(0, 3), R(2, 3), 0.55, x, y)));
    this.lumps = r.createInstances(220);

    this.salt = new K.Particles(r, 'dust', { count: 520, color: R(3, 3), size: 0.05, vel: [0.3, 0.02, 0.05], jitter: [0.25, 0.05, 0.2], wobble: 0.25, area: [34, 1.2, 34], yOffset: -1.25, additive: false });
    // dust rings: tan on the white crust, so they are drawn solid with screen-door fade (K.Ripples is additive)
    this.ringMesh = r.createMesh(K.decal(1, 1, 0.12));
    this.ringTex = r.texture(K.ringSprite({ index: R(0, 2) }));
    this.rings = [];
    this.puff = new K.Envelope(0.6);

    this.m = mat4.create();
    this.time = 0; this.k = 0; this.en = 0; this.shimmer = 0.12; this.yaw = 0; this.mirU = 0;
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [1, 1, 1], light: [0, 0, 0], amb: [0, 0, 0], sun: [0, 0, 0], mesa: [0, 0, 0], mir: [1, 1, 1] };
  }

  update(a, k, dt) {
    this.k = k; this.time += dt;
    const d = K.drive(a, k);
    // big continuous things follow smoothed energy, never the kick drum
    this.en = damp(this.en, d.energy, 1.5, dt);
    this.cam.activeSpeed = 1.5 + this.en * 1.2;
    this.cam.update(a, k, dt);
    this.cam.target[1] += 0.9;                                   // look a touch up: more sky
    const e = this.cam.eye, t = this.cam.target;
    this.yaw = Math.atan2(-(t[0] - e[0]), -(t[2] - e[2]));
    this.ground.follow(e[0], e[2]);

    this.shimmer = damp(this.shimmer, lerp(0.12, 0.75, k) + this.en * 0.45, 1.2, dt);
    this.mirU += dt * (0.02 + this.shimmer * 0.06);              // accumulate, so a changing rate never jumps
    this._wobble();

    // beat: a soft ring of dust kicked up somewhere ahead, scaled by accent
    if (d.beat) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), dist = 11 + Math.random() * 8, side = (Math.random() - 0.5) * 10;
      const x = e[0] + fx * dist - fz * side, z = e[2] + fz * dist + fx * side;
      this.rings.push({ x, y: height(x, z), z, size: (7 + Math.random() * 5) * (0.55 + 0.45 * d.accent) * (0.6 + 0.4 * k), amp: (0.35 + 0.65 * d.accent) * k, t: 0 });
      if (this.rings.length > 6) this.rings.shift();
      this.puff.trigger(k);
    }
    this.rings = this.rings.filter((g) => (g.t += dt / (2.6 * d.decay)) < 1);
    this.puff.update(dt);

    const gust = K.stage(k, 0.05, 0.85);
    const wind = 0.2 + gust * 4.5 + this.en * 2;
    this.salt.update(dt, e, { amount: lerp(0.08, 1, gust), speed: 1 + d.level * 0.5, wind: [wind, wind * 0.18] });
    this._scatter();
  }

  /** Heat shimmer: the mesas ripple from the base up, the mirage strip breathes. */
  _wobble() {
    const t = this.time, A = this.shimmer;
    const B = this.mesaBase.positions, L = this.mesaLive.positions;
    for (let i = 0; i < B.length; i += 3) {
      const y = B[i + 1], heat = 1 / (1 + y * 0.35);              // strongest near the ground
      L[i] = B[i] + Math.sin(t * 2.1 + y * 1.7 + B[i] * 0.05) * A * 1.8 * heat;
      L[i + 1] = y * (1 + Math.sin(t * 0.9 + B[i] * 0.02) * 0.03 * A);
    }
    this.mesas.update(this.mesaLive);
    const MB = this.mirBase.positions, ML = this.mirLive.positions;
    for (let i = 0; i < MB.length; i += 3) {
      const far = (-MB[i + 2] - MIRAGE_NEAR) / (MIRAGE_FAR - MIRAGE_NEAR);
      ML[i + 1] = (Math.sin(t * 2.6 + MB[i] * 0.13) + Math.sin(t * 1.3 - MB[i] * 0.05)) * 0.12 * A * far;
    }
    this.mirage.update(this.mirLive);
  }

  /** Low salt lumps on a jittered grid around the camera, shrinking away at the edge. */
  _scatter() {
    const e = this.cam.eye, edge = LUMP_CELL * LUMP_RADIUS;
    let n = 0;
    K.scatter(e[0], e[2], { cell: LUMP_CELL, radius: LUMP_RADIUS, seed: 21, jitter: 0.9 }, (x, z, dist, gx, gz) => {
      if (n >= this.lumps.max || K.rand2(gx, gz, 3) > 0.32) return;
      const f = K.fadeOut(dist, edge - 20, edge);
      if (f <= 0 || Math.abs(x - pathX(-z)) < 2.5) return;
      const s = (0.6 + K.rand2(gx, gz, 4) * 1.4) * f;
      this.lumps.set(n++, x, height(x, z) - 0.05, z, s, K.rand2(gx, gz, 5) * 6, 0.85 + K.rand2(gx, gz, 6) * 0.15, 0, 0.6 + K.rand2(gx, gz, 7));
    });
    this.lumps.upload(n);
  }

  render(r) {
    const { col, k } = this, P = this.pal, e = this.cam.eye;
    const bright = lerp(0.88, 1, k);
    // bleached haze: atmosphere's palest shade washed toward the palest crust colour
    mixColor(col.fog, P.color(R(3, 3)), P.color(R(0, 3)), lerp(0.55, 0.4, k));
    scaleColor(col.fog, col.fog, bright);
    mixColor(col.zen, P.color(R(1, 3)), P.color(R(3, 2)), lerp(0.6, 0.4, k));
    r.clear(col.fog);
    this.cam.apply(r);
    this.sky.draw(r, e, { horizon: col.fog, zenith: col.zen, brightness: bright });

    mixColor(col.sun, P.role('light'), P.color(R(2, 3)), 0.5);
    r.setLight([-0.25, -0.9, -0.3], scaleColor(col.light, col.sun, lerp(0.72, 0.9, k)), scaleColor(col.amb, P.role('ambient'), lerp(0.6, 0.7, k)));
    col.tint[0] = col.tint[1] = col.tint[2] = bright;

    // far mesas: a much longer fog so they stay as hazy silhouettes
    r.setFog(col.fog, 30, lerp(230, 300, k));
    mixColor(col.mesa, P.color(R(3, 2)), P.color(R(0, 1)), 0.35);
    r.draw(this.mesas, mat4.trs(this.m, e[0], 0, e[2], 0, this.yaw * 0.15, 0), { unlit: true, tint: col.mesa });

    r.setFog(col.fog, lerp(6, 14, k), lerp(90, 125, k));
    this.ground.draw(r, { texture: this.crustTex, texture2: this.crustTex2, blend: K.stage(k, 0.25, 1) * 0.45, tint: col.tint });
    r.drawInstanced(this.lumpMesh, this.lumps, { texture: this.lumpTex, tint: col.tint });

    K.forSegments(this.cam.s, { length: SIGN_EVERY, ahead: 240, behind: 30 }, (i, s0) => {
      const s = s0 + 30 + K.rand2(i, 1, 2) * 70, side = K.rand2(i, 2, 2) < 0.5 ? -1 : 1;
      const x = pathX(s) + side * (5 + K.rand2(i, 3, 2) * 5), z = -s;
      const lean = (K.rand2(i, 4, 2) - 0.5) * 0.25;
      r.draw(this.signMesh, mat4.trs(this.m, x, height(x, z) - 0.1, z, 0.04, side * 0.6 + (K.rand2(i, 5, 2) - 0.5) * 0.6, lean), { texture: this.signTex, tint: col.tint });
    });

    // mirage: sky colour shimmering on the flat near the horizon (just above the highest ground); fog off so it reads as "wet sky"
    const mo = lerp(0.18, 0.5, k) + this.en * 0.15;
    col.mir[0] = col.mir[1] = col.mir[2] = bright;
    r.draw(this.mirage, mat4.trs(this.m, e[0], 0.55, e[2], 0, this.yaw, 0), {
      texture: this.mirTex, unlit: true, fog: false, depthWrite: false, opacity: Math.min(0.7, mo), tint: col.mir,
      uvOffset: [this.mirU, Math.sin(this.time * 1.7) * 0.02 * this.shimmer],
    });

    this.salt.draw(r, { brightness: bright * (0.85 + this.puff.v * 0.25) });
    for (const g of this.rings) {
      const e2 = 1 - (1 - g.t) * (1 - g.t), sz = g.size * (0.15 + 0.85 * e2);
      r.draw(this.ringMesh, mat4.trs(this.m, g.x, g.y, g.z, 0, 0, 0, sz, 1, sz), { texture: this.ringTex, tint: col.tint, opacity: g.amp * Math.min(1, g.t * 6) * (1 - g.t) * (1 - g.t) * 0.9 });   // eases in, fades out
    }
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.salt.dispose(r);
    [this.mesas, this.mirage, this.signMesh, this.lumpMesh, this.ringMesh].forEach((m) => m.dispose());
    [this.crustTex, this.crustTex2, this.mirTex, this.signTex, this.lumpTex, this.ringTex].forEach((t) => r.deleteTexture(t));
    this.lumps.dispose();
  }
}
