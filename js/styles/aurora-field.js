// AURORA FIELD — calm snowfield at night under big rippling aurora curtains.
// The between-songs favourite: it has to look lovely at intensity 0.
//
//   gentle snowy hills around a frozen lake      K.Terrain (lake basin carved into the height fn)
//   frozen lake: frost ice -> aurora-lit ice     tessellated disc, draw { texture2, blend }
//   pine-forest edge, snow on the tiers          K.scatter + K.fadeOut, kit pine sprite + local snow pass
//   aurora curtains                              dynamic ribbon meshes, additive, fog off + fade
//   twinkling stars                              instanced billboard dots (per-star twinkle)
//   moon                                         K.Sky { moonTexture: sprites.moon }
//   snowfall + high-hat sparkle                  K.Particles x2, ground glints via K.scatter
//   slow glide around the lake                   K.DollyRig, target pulled toward the lake
//
// Idle: two faint green curtains breathing slowly, light snow, soft star twinkle.
// Swell: curtains brighten, grow taller and longer, more ribbons fade in one by one,
// the accent ramp shifts in (magenta fringes), the lake and snow pick up the glow.
// Beat: a gentle brightness pulse that travels out along each ribbon + tiny nudge.
// Mids: ripple speed. Highs: star twinkle + snow sparkle.
import { mat4, lerp, damp, clamp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { solid } from '../gfx/textures.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const LX = 0, LZ = 0, LR = 24, LAKE_Y = -1;     // frozen lake
const PATH_R = LR + 13;                          // camera loop radius
const TREE_CELL = 5, TREE_RADIUS = 17, TREE_EDGE = TREE_CELL * TREE_RADIUS;
// ribbon columns; row heights (fraction of the curtain) and brightness. Row 0 is a soft
// glow skirt SKIRT units below the hem that fades to nothing (Gouraud, then dithered).
const COLS = 48, HF = [0, 0, 0.1, 0.42, 1], ROW_B = [0, 1, 1, 0.85, 0.45], SKIRT = 5;
const ROWS = HF.length - 1;
const N_STARS = 230;
const TAU = Math.PI * 2;

// palette: snow white-blue, pine green, aurora green, deep night blue.
// The accent ramp's two dark shades are swapped for magenta so the swell can
// "shift across the ramp" (green curtains growing magenta fringes).
const PAL = fromKeys('aurora-field', 'Aurora Field', ['#dce8f6', '#2c5a46', '#5af0a6', '#141d38']);
PAL.colors[R(2, 0)] = '#4a1852';
PAL.colors[R(2, 1)] = '#a2408e';

// Ribbons live in the far sky (no parallax, like the real thing), placed around the
// direction the camera gazes: azimuth offset, distance, extra yaw, length, base height
// above the eye, curtain height, wake-up stage (null = always on), idle level.
const RIBBONS = [
  { off: 0.0, dist: 125, yaw: 0.15, L: 190, yb: 40, H: 52, on: null, idle: 0.55, ph: 0.0 },
  { off: -0.55, dist: 145, yaw: -0.35, L: 160, yb: 50, H: 46, on: null, idle: 0.35, ph: 1.7 },
  { off: 0.6, dist: 135, yaw: 0.4, L: 170, yb: 44, H: 50, on: [0.08, 0.32], ph: 3.1 },
  { off: -1.0, dist: 115, yaw: -0.5, L: 150, yb: 48, H: 56, on: [0.22, 0.48], ph: 4.4 },
  { off: 1.05, dist: 120, yaw: 0.6, L: 150, yb: 52, H: 48, on: [0.38, 0.62], ph: 5.2 },
  { off: 0.25, dist: 165, yaw: 0.0, L: 220, yb: 66, H: 62, on: [0.52, 0.78], ph: 2.3 },
  { off: -0.25, dist: 100, yaw: 0.2, L: 170, yb: 60, H: 52, on: [0.66, 0.92], ph: 6.0 },
];

const smooth = (t) => t * t * (3 - 2 * t);

/** Ground height: soft rolling snow, a basin for the lake that rises to a bank. */
function baseHeight(x, z) {
  return K.fbm(x * 0.014, z * 0.014, { octaves: 3, seed: 4 }) * 8 + K.fbm(x * 0.05, z * 0.05, { octaves: 2, seed: 8 }) * 1.2 + 1;
}
function height(x, z) {
  const d = Math.hypot(x - LX, z - LZ), lift = smooth(clamp((d - LR + 2) / 14));
  return lerp(LAKE_Y - 1.5, Math.max(baseHeight(x, z), LAKE_Y + 1.2), lift);
}

/** Wind-packed snow: dithered base ramp with faint drifts and the odd glint. */
function snowTex() {
  return K.makeIndexed(64, 64, (x, y) => {
    if (K.rnd(x, y, 3) > 0.993) return R(0, 3);
    const s = 2.05 + (K.blobNoise(x, y, 11, 1) - 0.5) * 0.9 + (K.blobNoise(x, y, 4, 2) - 0.5) * 0.35;
    return K.dshade(0, s, x, y);
  });
}

/** Frozen lake: dark clear ice (atmosphere ramp) with frost patches and pale cracks. */
function iceTex(lit = false) {
  return K.makeIndexed(64, 64, (x, y) => {
    const n = K.blobNoise(x, y, 13, 5), c = K.blobNoise(x + 7, y * 0.6, 9, 6);
    if (Math.abs(n - 0.5) < 0.012 || Math.abs(c - 0.5) < 0.008) return R(0, 1); // cracks
    if (K.rnd(x, y, 9) > 0.996) return R(0, 2);                                   // frost glints
    if (lit) {
      // aurora reflection: long soft smears in the ice, dithered into the accent ramp
      const smear = K.blobNoise(x * 0.5, y * 1.2, 7, 11) * (0.6 + 0.4 * K.blobNoise(x, y, 16, 12));
      if (smear > 0.5) return K.dshade(2, 1.2 + (smear - 0.5) * 8, x, y);
    }
    const frost = K.blobNoise(x, y, 7, 7);
    return K.dshade(3, 1.1 + frost * 0.7 + (frost > 0.75 ? 0.5 : 0), x, y);
  });
}

/**
 * Curtain texture (u along the ribbon, v: 0 = top, 1 = bottom edge).
 * Vertical rays, bright lower hem, top dithers away to transparent.
 * shifted = the swell version: taller, brighter body with magenta upper fringes (shades 0/1).
 */
function curtainTex(shifted) {
  return K.makeIndexed(32, 64, (x, y) => {
    const f = y / 63;                                    // 0 top .. 1 bottom
    const ray = 0.55 + 0.7 * K.blobNoise(x, 0, 3, 2) * (0.7 + 0.3 * K.blobNoise(x, y, 5, 3));
    const reach = shifted ? 0.95 : 0.78;                 // how far up the curtain goes
    const v = Math.pow(clamp((f - (1 - reach)) / reach), shifted ? 1.1 : 1.5) * ray;
    if (v < 0.12 + K.bayer(x, y) * 0.3) return K.CLEAR;
    if (f > 0.93) return R(2, 3);                        // hem
    if (!shifted) return K.dshade(2, 2 + v * 0.9 + (f > 0.8 ? 0.4 : 0), x, y);
    if (f < 0.42) return K.dshade(2, clamp(v * 2.4, 0, 1.4), x, y);   // magenta fringe
    return K.dshade(2, 2 + v * 1.1, x, y);
  });
}

/** Kit pine with snow settled on the top of each tier. */
function snowyPine() {
  const t = K.sprites.pine({ ramp: 1, tiers: 5, seed: 3 }), W = t.width, D = t.data, out = D.slice();
  for (let y = 1; y < t.height - 9; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (D[i] === K.CLEAR) continue;
    if (D[i - W] === K.CLEAR) out[i] = R(0, 3);                                   // top edge of a tier
    else if (y > 1 && D[i - 2 * W] === K.CLEAR && K.rnd(x, y, 4) > 0.35) out[i] = R(0, 2);
    else if (K.rnd(x, y, 6) > 0.94) out[i] = R(0, 2);                             // clumps on branches
  }
  return { ...t, data: out };
}

/** Ice disc made of a grid (per-vertex fog and affine UVs need small triangles); ragged rim hides under the bank. */
function lakeGeo(radius, cell = 4) {
  const g = new GeoBuilder(), n = Math.ceil(radius / cell), uv = 0.12;
  for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) {
    const x0 = i * cell, z0 = j * cell, x1 = x0 + cell, z1 = z0 + cell;
    if (Math.hypot(x0 + cell / 2, z0 + cell / 2) > radius) continue;
    g.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [x0 * uv, z1 * uv], [x1 * uv, z1 * uv], [x1 * uv, z0 * uv], [x0 * uv, z0 * uv], [0, 1, 0]);
  }
  return g.build();
}

/** Empty ribbon geometry (COLS x ROWS cells), rewritten every frame. */
function ribbonGeo() {
  const n = COLS * ROWS * 6;
  const geo = { positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), uvs: new Float32Array(n * 2), colors: new Float32Array(n * 3), count: n };
  for (let i = 0; i < n; i++) geo.normals[i * 3 + 1] = 1;
  return geo;
}

export class AuroraField {
  static meta = { name: 'Aurora Field' };
  static palette = PAL;

  init(r) {
    // ---- ground, lake, sky
    this.ground = new K.Terrain(r, { size: 220, cells: 50, height, uvScale: 0.22, shadeRange: [0.62, 1], slopeShade: 0.5 });
    this.snowTex = r.texture(snowTex());
    this.lake = r.createMesh(lakeGeo(LR + 16));
    this.iceTex = r.texture(iceTex(false));
    this.iceLitTex = r.texture(iceTex(true));
    this.sky = new K.Sky(r, { moon: true, moonDir: [-0.65, 0.22, 0.72], moonSize: 3.2, moonTexture: K.sprites.moon({ ramp: 3 }) });

    // ---- camera: slow loop around the lake, gaze pulled toward the far shore + sky
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU, rad = PATH_R + Math.sin(i * 1.9) * 3.5;
      const x = LX + Math.cos(a) * rad, z = LZ + Math.sin(a) * rad;
      pts.push([x, height(x, z) + 3.2, z]);
    }
    this.path = new K.Spline(pts);
    this.cam = new K.DollyRig(this.path, {
      idleSpeed: 1.3, activeSpeed: 3.2, bassBoost: 0.8, lookAhead: 12, groundFn: height, minClearance: 2.6,
      fov: 66, far: 280, nudge: 0.07, rollKick: 0.008, fovPunch: 0.8,
    });
    this.look = [0, 0, 0];

    // ---- pines (forest edge) + reeds at the shore
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.pineTex = r.texture(snowyPine());
    this.reedTex = r.texture(K.sprites.grass({ ramp: 1, seed: 7 }));
    this.trees = r.createInstances(900);
    this.reeds = r.createInstances(160);

    // ---- aurora
    this.curtainTex = r.texture(curtainTex(false));
    this.curtainTex2 = r.texture(curtainTex(true));
    this.ribbons = RIBBONS.map((def) => {
      const geo = ribbonGeo();
      return { def, geo, mesh: r.createMesh(geo, true), b: 0, tint: [0, 0, 0] };
    });
    this.grid = new Float32Array((COLS + 1) * (ROWS + 1) * 4); // x y z bright
    this.ripple = 0; this.drift = 0;
    this.pulse = new K.Envelope(0.7);
    this.wave = new K.History(48);  // beat pulses travelling out along the ribbons

    // ---- stars (own field so each star twinkles on its own)
    this.starTex = r.texture(solid(R(3, 3)));
    this.starMesh = r.createMesh(new GeoBuilder().quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build());
    this.starInst = r.createInstances(N_STARS);
    this.stars = Array.from({ length: N_STARS }, (_, i) => {
      const th = K.rand2(i, 1, 21) * TAU, el = Math.asin(0.06 + Math.pow(K.rand2(i, 2, 21), 0.8) * 0.94);
      return {
        d: [Math.cos(el) * Math.cos(th), Math.sin(el), Math.cos(el) * Math.sin(th)],
        s: 0.45 + Math.pow(K.rand2(i, 3, 21), 3) * 0.7, b: 0.35 + K.rand2(i, 4, 21) * 0.65,
        f: 2 + K.rand2(i, 5, 21) * 7, ph: K.rand2(i, 6, 21) * 50,
      };
    });

    // ---- weather + glints
    this.snow = new K.Particles(r, 'snow', { count: 520, size: 0.09 });
    this.sparkle = new K.Particles(r, 'snow', { count: 160, size: 0.09, additive: true, glow: 1, flicker: 1, color: R(0, 3) });
    this.glintTex = r.texture(solid(R(0, 3)));
    this.glints = r.createInstances(220);

    this.m = mat4.create();
    this.time = 0; this.k = 0; this.a = null; this.aur = 0; this.az = 0;
    this.bassS = 0; this.midS = 0; this.bassM = 0;
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], ice: [0, 0, 0], one: [1, 1, 1], tmp: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k), t = this.time;
    this.cam.update(a, k, dt);
    // gaze: between the look-ahead point and the lake centre, lifted toward the aurora
    const tg = this.cam.target, e = this.cam.eye;
    tg[0] = lerp(tg[0], LX, 0.55); tg[2] = lerp(tg[2], LZ, 0.55);
    tg[1] = e[1] + 2.5 + Math.sin(t * 0.05) * 1.5 + k * 1.5;
    this.az = Math.atan2(LZ - e[2], LX - e[0]);   // the aurora hangs beyond the lake, wherever we are
    this.ground.follow(e[0], e[2]);

    // aurora motion: slow drift always, ripple speed from mids
    this.drift += dt * (0.05 + k * 0.05);
    // mids / bass shape motion directly only at Punchy; at Gentle they are eased (0.5 s)
    this.bassS = damp(this.bassS, d.bass, 0.5, dt); this.midS = damp(this.midS, d.mid, 0.5, dt);
    this.bassM = lerp(this.bassS, d.bass, d.beatMotion);
    this.ripple += dt * (0.35 + k * 0.25 + lerp(this.midS, d.mid, d.beatMotion) * 2.2);   // integrated phase
    if (d.beat) this.pulse.trigger(0.35 + 0.35 * k);
    this.pulse.update(dt);
    this.wave.push(this.pulse.v * k);
    this._ribbons(d, k, t);

    this.snow.update(dt, e, { amount: K.swell(k, 0.5, 0.75), speed: 0.75 + lerp(d.energy, d.level, d.beatMotion) * 0.5, wind: [0.5 + this.bassM * 1.2, 0.15] });
    this.sparkle.update(dt, e, { amount: 0.25 + K.stage(k, 0, 0.5) * 0.75, speed: 0.75 + lerp(d.energy, d.level, d.beatMotion) * 0.5, wind: [0.5 + this.bassM * 1.2, 0.15] });
    this._scatter(d, k, t);
    this._stars(d, k, t);
  }

  /** Rebuild every visible ribbon's curtain mesh. */
  _ribbons(d, k, t) {
    const G = this.grid, spread = 1 + k * 0.3, amp = 1 + k * 0.6;
    this.aur = 0;
    for (const rb of this.ribbons) {
      const R0 = rb.def, ph = R0.ph;
      const on = R0.on ? K.stage(k, R0.on[0], R0.on[1]) : 1;
      const lvl = R0.on ? lerp(0.6, 1, k) : lerp(R0.idle, 1, k);
      const breathe = 0.78 + 0.22 * Math.sin(t * 0.11 + ph * 2.1);
      rb.b = on * lvl * breathe * (1 + this.pulse.v * 0.35);
      this.aur += rb.b * (R0.on ? 0.12 : 0.25);
      if (rb.b < 0.01) continue;
      const L = R0.L * spread, H = R0.H * amp, az = this.az + R0.off, b = az + R0.yaw;
      // xl runs along the tangent (across the view), zl toward / away from the camera
      const tx = -Math.sin(b), tz = Math.cos(b), nx = Math.cos(b), nz = Math.sin(b);
      const e = this.cam.eye, ox = e[0] + Math.cos(az) * R0.dist, oz = e[2] + Math.sin(az) * R0.dist, oy = e[1];
      const dr = this.drift, rp = this.ripple;
      for (let i = 0; i <= COLS; i++) {
        const u = i / COLS, xl = (u - 0.5) * L;
        // slow meander + faster curtain folds that travel along the ribbon
        const mz = Math.sin(u * 1.6 * TAU + dr * 1.3 + ph) * 8 * amp + Math.sin(u * 3.3 * TAU - dr * 2.1 + ph * 1.7) * 4;
        const fold = Math.sin(u * 7.5 * TAU + rp * 1.4 + ph) * 1.6;
        const hu = H * (0.65 + 0.35 * Math.sin(u * 2.2 * TAU + dr * 1.7 + ph)) * (0.85 + 0.15 * Math.sin(rp * 0.6 + u * 9));
        const ends = Math.pow(Math.sin(Math.PI * u), 0.8);
        const rays = 0.6 + 0.4 * Math.sin(u * 5.1 * TAU - rp * 0.5 + ph * 3);
        const beat = this.wave.at(Math.abs(u - 0.5) * 2) * 0.8;
        // the lower hem undulates so it never reads as a hard horizon line
        const yb = oy + R0.yb + Math.sin(u * 1.3 * TAU + dr + ph) * 3 + Math.sin(u * 6.3 * TAU + dr * 2.5 + ph) * 2;
        for (let j = 0; j <= ROWS; j++) {
          const h = HF[j], lean = h * h;
          const zl = mz + fold * (1 + h * 1.5) + Math.sin(u * 4 * TAU + rp - h * 2) * 2.5 * lean;
          const o = (j * (COLS + 1) + i) * 4;
          G[o] = ox + xl * tx + zl * nx;
          G[o + 1] = j === 0 ? yb - SKIRT : yb + hu * h;
          G[o + 2] = oz + xl * tz + zl * nz;
          G[o + 3] = ends * (rays + beat) * ROW_B[j];
        }
      }
      // triangles
      const P = rb.geo.positions, U = rb.geo.uvs, C = rb.geo.colors, uS = L / 10 / COLS;
      let v = 0;
      const put = (i, j) => {
        const o = (j * (COLS + 1) + i) * 4;
        P[v * 3] = G[o]; P[v * 3 + 1] = G[o + 1]; P[v * 3 + 2] = G[o + 2];
        U[v * 2] = i * uS; U[v * 2 + 1] = 1 - Math.max(0.01, HF[j]); // skirt + hem sample the hem row
        C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = G[o + 3];
        v++;
      };
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        put(i, j); put(i + 1, j); put(i + 1, j + 1);
        put(i, j); put(i + 1, j + 1); put(i, j + 1);
      }
      rb.mesh.update(rb.geo);
    }
    this.aur = clamp(this.aur);
  }

  /** Pines on the outer forest edge, reeds along the shore, snow glints near the camera. */
  _scatter(d, k, t) {
    const e = this.cam.eye;
    let nt = 0, nr = 0, ng = 0;
    K.scatter(e[0], e[2], { cell: TREE_CELL, radius: TREE_RADIUS, seed: 5, jitter: 1 }, (x, z, dist, gx, gz) => {
      const fade = K.fadeOut(dist, TREE_EDGE - 16, TREE_EDGE);
      if (fade <= 0) return;
      const dl = Math.hypot(x - LX, z - LZ);
      if (Math.abs(dl - PATH_R) < 7) return;                        // keep the glide path clear
      // a few lone pines on the inner bank; the forest thickens beyond the glide path, with soft clearings
      const inner = dl > LR + 4 && dl < PATH_R - 7 ? 0.22 : 0;
      const dens = Math.max(inner, smooth(clamp((dl - PATH_R - 6) / 16))) * (0.55 + 0.6 * K.fbm(x * 0.03, z * 0.03, { octaves: 2, seed: 9 }));
      const h = K.rand2(gx, gz, 1);
      if (h < dens * 0.9 && nt < this.trees.max) {
        const s = (4.5 + K.rand2(gx, gz, 4) * 4.5) * fade;
        this.trees.set(nt++, x, height(x, z) - 0.3, z, s * 0.5, 0, 0.75 + K.rand2(gx, gz, 5) * 0.4, h * 50, 2);
      } else if (dl > LR - 1 && dl < LR + 7 && h > 0.55 && nr < this.reeds.max) {
        for (let q = 0; q < 2 && nr < this.reeds.max; q++) {
          const rx = x + (K.rand2(gx, gz, 10 + q) - 0.5) * 3, rz = z + (K.rand2(gx, gz, 12 + q) - 0.5) * 3;
          this.reeds.set(nr++, rx, Math.max(height(rx, rz), LAKE_Y) - 0.1, rz, 1.1 * fade, 0, 0.7, gx + q * 3, 0.9);
        }
      }
    });
    this.trees.upload(nt); this.reeds.upload(nr);
    // glints: tiny additive points on the snow that catch the light (more with highs)
    const amt = 0.22 + d.high * 1.6 + this.aur * 0.2;
    K.scatter(e[0], e[2], { cell: 2.3, radius: 7, seed: 13, jitter: 1 }, (x, z, dist, gx, gz) => {
      if (ng >= this.glints.max) return;
      const r = K.rand2(gx, gz, 2), f = K.fadeOut(dist, 10, 16);
      const tw = Math.pow(Math.max(0, Math.sin(t * (1.2 + r * 3.5) + r * 40)), 10);
      this.glints.set(ng++, x, Math.max(height(x, z), LAKE_Y) + 0.06, z, 0.11, 0, tw * amt * f, 0, 1);
    });
    this.glints.upload(ng);
  }

  _stars(d, k, t) {
    const e = this.cam.eye, D = 92, hi = d.high;
    this.stars.forEach((s, i) => {
      const soft = 0.82 + 0.18 * Math.sin(t * 0.9 * s.f * 0.3 + s.ph);
      const sharp = Math.pow(Math.max(0, Math.sin(t * s.f + s.ph)), 6) * hi * 1.6;
      this.starInst.set(i, e[0] + s.d[0] * D, e[1] + s.d[1] * D, e[2] + s.d[2] * D, s.s * (1 + sharp * 0.4), 0, s.b * (soft + sharp), 0, 1);
    });
    this.starInst.upload(N_STARS);
  }

  render(r) {
    const { col, k } = this, a = this.a, P = this.pal, d = K.drive(a, k), eye = this.cam.eye, aur = this.aur;
    const dim = lerp(0.85, 1, k);
    // the aurora faintly lights the whole night: fog, sky, snow and ice lean toward the glow colour
    scaleColor(col.glow, P.role('glow'), 1);
    mixColor(col.tmp, P.role('fog'), col.glow, aur * 0.08);
    scaleColor(col.fog, col.tmp, dim);
    r.clear(col.fog);
    this.cam.apply(r);

    mixColor(col.zen, P.color(R(3, 0)), col.glow, aur * 0.12);
    this.sky.draw(r, eye, { horizon: col.fog, zenith: col.zen, brightness: dim, moonScale: 1 + lerp(d.groove, this.pulse.v, d.beatMotion) * 0.04 });
    // stars: additive dots, brighter where the sky is darker
    scaleColor(col.tmp, col.one, (0.55 + d.high * 0.3) * (1 - aur * 0.3));
    r.drawInstanced(this.starMesh, this.starInst, { texture: this.starTex, billboard: 2, unlit: true, additive: true, fog: false, tint: col.tmp });

    // aurora curtains (sky layer: no depth write, no fog, fade far away)
    for (const rb of this.ribbons) {
      if (rb.b < 0.01) continue;
      const blend = K.stage(k, 0.25, 0.95) * (0.75 + 0.25 * Math.sin(this.time * 0.07 + rb.def.ph));
      scaleColor(rb.tint, col.one, rb.b * dim * 0.88);
      r.draw(rb.mesh, mat4.identity(this.m), { texture: this.curtainTex, texture2: this.curtainTex2, blend, unlit: true, additive: true, fog: false, fade: [175, 280], tint: rb.tint });
    }

    r.setFog(col.fog, 14, lerp(96, 110, k));
    scaleColor(col.light, P.role('light'), lerp(0.72, 0.85, k));
    mixColor(col.tmp, P.role('ambient'), col.glow, aur * 0.35);
    scaleColor(col.amb, col.tmp, lerp(0.55, 0.62, k));
    r.setLight([0.55, -0.45, -0.6], col.light, col.amb);
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    this.ground.draw(r, { texture: this.snowTex, tint: col.tint });
    scaleColor(col.ice, col.glow, aur * 0.12 * dim);
    r.draw(this.lake, mat4.trs(this.m, LX, LAKE_Y, LZ), {
      texture: this.iceTex, texture2: this.iceLitTex, blend: K.stage(k, 0.15, 0.85) * 0.6, tint: col.tint, emissive: col.ice,
    });
    const sway = 0.012 + this.bassM * 0.03;
    r.drawInstanced(this.quad, this.trees, { texture: this.pineTex, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.reeds, { texture: this.reedTex, billboard: 1, sway: sway * 2, tint: col.tint });

    // additive last: snow glints, snowfall, sparkle
    r.drawInstanced(this.starMesh, this.glints, { texture: this.glintTex, billboard: 2, unlit: true, additive: true, fade: [8, 16], tint: col.one });
    this.snow.draw(r, { brightness: dim * 0.85 });
    this.sparkle.draw(r, { brightness: 0.12 + d.high * 1.1 + aur * 0.15 });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.snow.dispose(r); this.sparkle.dispose(r);
    [this.lake, this.quad, this.starMesh, ...this.ribbons.map((rb) => rb.mesh)].forEach((m) => m.dispose());
    [this.snowTex, this.iceTex, this.iceLitTex, this.pineTex, this.reedTex, this.curtainTex, this.curtainTex2, this.starTex, this.glintTex].forEach((t) => r.deleteTexture(t));
    [this.trees, this.reeds, this.starInst, this.glints].forEach((i) => i.dispose());
  }
}
