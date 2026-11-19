// CLOUD SEA — above the clouds at dawn (slow songs / ballads).
//
//   three scrolling cloud layers       K.tex.cloudLayer on big subdivided planes, screen-door opacity,
//                                      world-locked uvOffset + drift (bass = scroll speed)
//   peaks rising through them          K.Terrain with sparse cone peaks, kept off the flight line
//   a huge low sun                     Sky moon disc with a local sun texture, rising and growing with k
//   birds gliding in loose groups      K.School({ kind: 'bird' }), always gliding
//   sky lanterns from below            K.Particles 'skyLanterns', carried along with the camera
//   beat: a soft brightening wave      K.History → per-vertex brightness on the top cloud layer,
//                                      travelling from the sun towards the viewer (never a flash)
//   phrasing                           K.Breath (camera height, cloud shade, star level)
//
// Idle: pre-dawn, faint stars, the sun just under the cloud line, clouds dim and almost still.
// Swell: the sun rises and grows, the sky and clouds warm into the accent ramp (dither blend),
// more birds join, sky lanterns drift up. Intensity raises light, not speed.
import { mat4, lerp, clamp, smoothstep } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const CAM_Y = 15;                 // flight height
const BASE = -40;                 // valley floor, far below the clouds
const PEAK_CELL = 64;             // one candidate peak per cell
const LAYERS = [                  // y, plane size, segments, uv tiles, scroll factor, opacity, shade, accent blend, cloud ramp
  { y: -12, size: 380, segs: 16, rep: 4, speed: 0.4, opacity: 1, shade: 0.9, warm: 0.2, ramp: 3 },
  { y: -5, size: 380, segs: 18, rep: 5, speed: 0.65, opacity: 0.85, shade: 0.78, warm: 0.4, ramp: 1 },
  { y: 0, size: 380, segs: 30, rep: 6, speed: 1, opacity: 0.6, shade: 1, warm: 0.6, ramp: 1 },
];
const HIST = 150;                 // beat wave: 150 steps at 60 Hz = 2.5 s from the sun side to behind the camera
const W_FAR = 190, W_NEAR = -70;  // wave travels along the sun axis from W_FAR to W_NEAR (camera at 0)

// flight line: a gentle S along -z
const pathX = (s) => Math.sin(s * 0.0055) * 18 + Math.sin(s * 0.0021 + 1) * 10;
const ss = (a, b, x) => smoothstep((x - a) / (b - a));

/** Sparse cone peaks on a jittered grid, flattened below the clouds near the flight line. */
const height = (x, z) => {
  const ix = Math.floor(x / PEAK_CELL), iz = Math.floor(z / PEAK_CELL);
  let h = BASE + K.fbm(x * 0.02, z * 0.02, { octaves: 2, seed: 3 }) * 8;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cz = iz + j;
    if (K.rand2(cx, cz, 11) < 0.3) continue;
    const px = (cx + 0.2 + 0.6 * K.rand2(cx, cz, 12)) * PEAK_CELL, pz = (cz + 0.2 + 0.6 * K.rand2(cx, cz, 13)) * PEAK_CELL;
    const rad = 30 + K.rand2(cx, cz, 14) * 22;
    const d = Math.hypot(x - px, z - pz);
    if (d >= rad) continue;
    const off = Math.abs(px - pathX(-pz));
    const top = lerp(-24, 0 + K.rand2(cx, cz, 15) * 34, ss(28, 52, off));
    const shape = Math.pow(1 - d / rad, 1.6);
    h = Math.max(h, BASE + (top - BASE) * shape + K.ridged(x * 0.05, z * 0.05) * 6 * shape);
  }
  return h;
};

/** Big round sun: a bright core fading through the accent ramp to a dithered rim (32×32, indexed). */
const sunTexture = () => K.makeIndexed(32, 32, (x, y) => {
  const d = Math.hypot(x - 15.5, y - 15.5) / 15.5;
  if (d > 1 || d > 0.82 + K.bayer(x, y) * 0.18) return K.CLEAR;
  return K.dshade(2, 3.4 - d * d * 2.2, x, y);
});

function cloudPlane(size, segs) {
  const h = size / 2;
  return new GeoBuilder().face([0, 0, 0], [h, 0, 0], [0, 0, -h], [0, 0, 1, 1], segs).build();
}

export class CloudSea {
  static meta = { name: 'Cloud Sea' };
  static palette = fromKeys('cloud-sea', 'Cloud Sea', ['#a49caa', '#ece6f2', '#ffa070', '#3c5890']);

  init(r) {
    this.ground = new K.Terrain(r, { size: 360, cells: 48, height, uvScale: 0.12, shadeRange: [0.45, 1.05], slopeShade: 0.45 });
    this.rockTex = r.texture(K.tex.cliffRock({ seed: 9 }));
    this.sky = new K.Sky(r, { stars: 170, moon: true, moonDir: [0.55, -0.05, -1], moonSize: 13, moonTexture: sunTexture() });   // the "moon" is our sun

    // cloud layers: white (secondary) with an accent twin for the dawn dither-blend
    this.layers = LAYERS.map((L, i) => {
      const geo = cloudPlane(L.size, L.segs);
      const top = i === LAYERS.length - 1;
      return {
        ...L, geo, mesh: r.createMesh(geo, top),
        tex: r.texture(K.tex.cloudLayer({ ramp: L.ramp, seed: 8 + i * 5 })),
        warmTex: r.texture(K.tex.cloudLayer({ ramp: 2, seed: 8 + i * 5 })),
        local: top ? geo.positions.slice() : null, tint: [1, 1, 1], uv: [0, 0], drift: 0,
      };
    });
    this.hist = new K.History(HIST);
    this.hAcc = 0; this.wave = 0;
    this.beatEnv = new K.Envelope(0.45);

    this.birds = new K.School(r, { kind: 'bird', groups: 3, perGroup: 7, size: 1.8, spread: [2, 9], lift: 1.2 });
    this.lanterns = new K.Particles(r, 'skyLanterns', { count: 44, size: 2.2, area: [170, 60, 120], yOffset: 0, vel: [0.08, 0.55, 0], jitter: [0.15, 0.2, 0] });

    this.cam = new K.PathRig((s, out) => { out[0] = pathX(s); out[1] = CAM_Y + Math.sin(s * 0.011) * 1.5; out[2] = -s; return out; },
      { lookAhead: 40, idleSpeed: 1.1, activeSpeed: 1.45, bassBoost: 0, fovPunch: 0, nudge: 0.03, rollKick: 0, fov: 60, far: 400 });
    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.time = 0; this.k = 0; this.sunUp = 0;
    this.sunDir = [0, 0, -1];
    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], zen: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], tmp: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.k = k; this.time += dt;
    const d = K.drive(a, k), b = this.breath.update(a, dt);
    this.cam.update(a, k, dt);
    const eye = this.cam.eye;
    eye[1] += b * 0.9;                                 // the view breathes up and down
    this.cam.target[1] -= 5;                           // look gently down over the cloud sea
    this.ground.follow(eye[0], eye[2]);

    // the sun rises with the swell (eased, so a jump in k still glides)
    this.sunUp += (K.stage(k, 0, 0.9) - this.sunUp) * Math.min(1, dt * 0.6);
    const sd = this.sunDir; sd[0] = 0.55; sd[1] = lerp(-0.05, 0.15, this.sunUp); sd[2] = -1;
    const l = Math.hypot(sd[0], sd[1], sd[2]); sd[0] /= l; sd[1] /= l; sd[2] /= l;
    this.sky.moonDir = sd;

    // clouds scroll towards the camera; bass pushes them (pre-multiplied by k)
    for (const L of this.layers) L.drift += dt * (0.0022 + d.bass * 0.016) * L.speed;

    // beat: a soft brightening wave from the sun side across the cloud tops
    if (d.beat) this.beatEnv.trigger(0.5 + 0.5 * k);
    this.beatEnv.update(dt);
    this.hAcc += dt;
    while (this.hAcc >= 1 / 60) {
      this.hAcc -= 1 / 60;
      this.wave += (this.beatEnv.v * K.stage(k, 0.02, 0.3) - this.wave) * 0.18;   // soft attack
      this.hist.push(this.wave);
    }

    // birds glide ahead of the camera in loose groups, crossing slowly; more join with the swell
    const camV = this.cam.speed, now = this.time;
    this.birds.update(dt, (g, t, out) => {
      const tt = t + g * 37;
      out[0] = eye[0] + Math.sin(tt * 0.045 + g * 2.1) * 55 + (g - 1) * 20;
      out[1] = CAM_Y + 7 + g * 3.5 + Math.sin(tt * 0.13) * 2;
      out[2] = eye[2] - 80 - g * 22 + Math.sin(tt * 0.03) * 12 - (t - now) * camV;   // fly along with the camera
    }, { amount: lerp(0.2, 1, K.stage(k, 0.1, 0.85)), speed: 1, flap: 0 });

    // sky lanterns rise from below the clouds, carried along with the camera so none drifts past the lens
    const ls = 0.6;
    this.lanterns.update(dt, [eye[0], 6, eye[2] - 100], { amount: K.stage(k, 0.45, 1) * 0.95, speed: ls, wind: [0, -camV / ls] });
  }

  render(r) {
    const { col, k } = this, P = this.pal, b = this.breath.v, eye = this.cam.eye;
    const dim = lerp(0.55, 1, k), warm = K.stage(k, 0.15, 1);
    mixColor(col.tmp, P.role('fog'), P.color(R(2, 1)), 0.32 * warm);
    scaleColor(col.fog, col.tmp, dim);
    mixColor(col.zen, P.color(R(3, 0)), P.color(R(3, 1)), 0.45 * k);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 40, lerp(165, 185, k));
    const sd = this.sunDir;
    r.setLight([-sd[0], -Math.max(0.35, sd[1]), -sd[2]],
      scaleColor(col.light, mixColor(col.tmp, P.role('light'), P.color(R(2, 2)), 0.5 * warm), lerp(0.3, 0.95, k)),
      scaleColor(col.amb, P.role('ambient'), lerp(0.45, 0.8, k)));

    // sky, stars fading out as the sun rises, the sun itself
    this.sky.draw(r, eye, {
      horizon: col.fog, zenith: col.zen, brightness: dim,
      starLevel: lerp(0.55, 0, K.stage(k, 0.05, 0.6)) * (0.85 + 0.15 * b), moonScale: lerp(1, 1.2, this.sunUp),
    });

    // peaks, birds
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    this.ground.draw(r, { texture: this.rockTex, tint: col.tint });
    this.birds.draw(r, { tint: col.tint });

    // cloud layers, bottom to top: world-locked texture + drift, warming into the accent ramp.
    // Pre-dawn they take the fog's blue cast; with the swell they turn white, then sun-coloured.
    const f = P.role('fog'), fm = Math.max(f[0], f[1], f[2], 1e-3), cool = lerp(0.62, 1, k);
    this.layers.forEach((L, i) => {
      const top = i === this.layers.length - 1;
      L.uv[0] = eye[0] * L.rep / L.size + L.drift * 0.35;
      L.uv[1] = -eye[2] * L.rep / L.size + L.drift;   // clouds stream towards the viewer
      if (top) this._waveColours(L, k);
      const s = L.shade * cool * (0.94 + 0.06 * b);
      for (let c = 0; c < 3; c++) L.tint[c] = s * lerp(0.35 + 0.4 * f[c] / fm, 1, k);
      mat4.trs(this.m, eye[0], L.y, eye[2]);
      r.draw(L.mesh, this.m, {
        texture: L.tex, texture2: L.warmTex, blend: warm * L.warm, unlit: true, tint: L.tint,
        uvOffset: L.uv, uvScale: [L.rep, L.rep], opacity: L.opacity,
      });
    });

    this.lanterns.draw(r, { brightness: 1 });
  }

  /** Per-vertex brightness of the top layer: the sun side glows at dawn, beat waves roll towards the viewer. */
  _waveColours(L, k) {
    const sd = this.sunDir, sl = Math.hypot(sd[0], sd[2]) || 1, ux = sd[0] / sl, uz = sd[2] / sl;
    const P = L.local, C = L.geo.colors, n = L.geo.count, H = this.hist, glow = 0.28 * K.stage(k, 0.2, 1);
    for (let v = 0; v < n; v++) {
      const s = P[v * 3] * ux + P[v * 3 + 2] * uz;
      const w = H.at(clamp((W_FAR - s) / (W_FAR - W_NEAR)));
      const c = 1 + w * 0.5 + glow * clamp(s / W_FAR);
      C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = c;
    }
    L.mesh.update(L.geo);
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    this.birds.dispose(r); this.lanterns.dispose(r);
    r.deleteTexture(this.rockTex);
    this.layers.forEach((L) => { L.mesh.dispose(); r.deleteTexture(L.tex); r.deleteTexture(L.warmTex); });
  }
}
