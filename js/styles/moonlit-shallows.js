// MOONLIT SHALLOWS — a tidal flat at night, for slow songs and ballads.
//
//   wet sand bars + a sheet of shallow water mirroring a huge low moon (r.setMirror / setClipBelow)
//   driftwood logs, rocks and rock pools on the bars
//   long bright wave lines rolling in (thin additive strips, scrolling toward the shore)
//   a glitter road under the moon (additive strip, drifting)
//   soft glowing drifters just above the water; they gather and brighten with the swell
//   a ripple ring opens where a drifter touches the water on a beat (K.Ripples)
//
// Idle: low tide. Still water, faint waves far out, one slow wave line, only the moon and two
// dim drifters. Swell: drifters gather and brighten, waves grow longer and brighter, stars
// twinkle. Beat: a ripple ring under one drifter (no flashes). Bass: wave height (width).
// Intensity raises light, not speed. Phrasing follows K.Breath.
import { mat4, lerp, clamp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { plane } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const W = 0;                 // water level
const TAU = Math.PI * 2;
const N_DRIFT = 16;
const N_WAVES = 6;
const N_LOGS = 9;
const N_ROCKS = 14;
const N_POOLS = 10;

const sm = (t) => t * t * (3 - 2 * t);
const height = (x, z) => {
  const shore = sm(clamp((z - 3) / 10));                    // the standing bar the camera glides along (z > ~8)
  const bars = Math.max(0, K.fbm(x * 0.04, z * 0.04, { octaves: 3, seed: 9 }) - 0.46) * 7 * clamp((-z - 8) / 10);
  const dunes = clamp((-z - 75) / 60) * 7;                  // low dark dunes far off, a horizon line
  return -0.75 + shore * 1.5 + bars + dunes + (K.fbm(x * 0.15, z * 0.15, { octaves: 2, seed: 3 }) - 0.5) * 0.25;
};

/** A thin wave line: long along u, bright dithered core, ragged breaks. 64x16. */
function waveLine() {
  return K.makeIndexed(64, 16, (x, y) => {
    const v = Math.abs((y + 0.5) / 16 * 2 - 1), prof = 1 - v;
    const nz = K.blobNoise(x, y * 4, 6, 4);
    const t = prof * (0.4 + nz * 0.9);
    if (t < 0.12 + K.bayer(x, y) * 0.3) return K.CLEAR;
    return t > 0.55 ? R(3, 3) : R(3, 2);
  });
}

/** Moon glitter: a column of dithered sparkles, fading to the sides and ends. 32x64 (u across, v along). */
function glitter() {
  return K.makeIndexed(32, 64, (x, y) => {
    const across = 1 - Math.abs((x + 0.5) / 32 * 2 - 1), along = Math.sin(((y + 0.5) / 64) * Math.PI);
    const t = across * across * (0.3 + along * 0.7) * (0.35 + K.blobNoise(x, y, 3, 8) * 1.1);
    if (t < 0.1 + K.bayer(x, y) * 0.35) return K.CLEAR;
    return t > 0.5 ? R(3, 3) : R(3, 2);
  });
}

export class MoonlitShallows {
  static meta = { name: 'Moonlit Shallows' };
  static palette = fromKeys('moonlit-shallows', 'Moonlit Shallows', ['#8a8f98', '#6a5640', '#4fe8d8', '#0f1838']);

  init(r) {
    this.ground = new K.Terrain(r, { size: 180, cells: 42, height, uvScale: 0.5 });
    this.sandTex = r.texture(K.tex.sand({ ramp: 0, seed: 4 }));
    this.sky = new K.Sky(r, { stars: 190, moon: true, moonDir: [0.0, 0.13, -1], moonSize: 12, moonTexture: K.sprites.moon({ ramp: 3 }) });

    // water: a big flat sheet reaching the horizon (subdivided so the affine warp stays mild)
    this.waterMesh = r.createMesh(plane(260, 26, 36));
    this.waterTex = r.texture(K.tex.water({ ramp: 3 }));
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));

    // driftwood logs lying on the bars and in the shallows
    this.logMesh = r.createMesh(K.props.prism(6, 0.3, 1, { uvRepeat: [2, 1] }));
    this.logTex = r.texture(K.tex.boards({ ramp: 1, seed: 3 }));
    this.logs = r.createInstances(N_LOGS);
    let n = 0;
    for (let i = 0; i < 40 && n < N_LOGS; i++) {
      const x = (K.rand2(i, 1, 21) - 0.5) * 70, z = 10 - K.rand2(i, 2, 21) * 40;
      const gy = height(x, z);
      if (gy < -0.45 || Math.abs(x) < 3 && z > 6) continue;
      const len = 3 + K.rand2(i, 3, 21) * 4;
      this.logs.set(n++, x, Math.max(gy, W - 0.1) + 0.22, z, 1, K.rand2(i, 4, 21) * TAU, 0.8 + K.rand2(i, 5, 21) * 0.3, 0, len, 0, Math.PI / 2 + (K.rand2(i, 6, 21) - 0.5) * 0.15);
    }
    this.logs.upload(n);

    // rocks (low tapered prisms) beside the logs
    this.rockMesh = r.createMesh(K.props.prism(6, 0.5, 0.7, { taper: 0.55, uvRepeat: [2, 1] }));
    this.rockTex = r.texture(K.tex.cliffRock({ ramp: 0, seed: 8 }));
    this.rocks = r.createInstances(N_ROCKS);
    n = 0;
    for (let i = 0; i < 60 && n < N_ROCKS; i++) {
      const x = (K.rand2(i, 1, 22) - 0.5) * 80, z = 12 - K.rand2(i, 2, 22) * 45;
      const gy = height(x, z);
      if (gy < -0.5 || Math.abs(x) < 3 && z > 6) continue;
      this.rocks.set(n++, x, Math.max(gy, W - 0.2) - 0.1, z, 0.9 + K.rand2(i, 3, 22) * 1.6, K.rand2(i, 4, 22) * TAU, 0.6 + K.rand2(i, 5, 22) * 0.3, 0, 1);
    }
    this.rocks.upload(n);

    // rock pools: small flat mirrors sunk into the higher sand
    this.poolMesh = r.createMesh(K.decal(1, 1, 0.03));
    this.pools = r.createInstances(N_POOLS);
    n = 0;
    for (let i = 0; i < 80 && n < N_POOLS; i++) {
      const x = (K.rand2(i, 1, 23) - 0.5) * 60, z = 7 - K.rand2(i, 2, 23) * 22;
      const gy = height(x, z);
      if (gy < 0.12 || gy > 0.9 || Math.abs(x) < 4 && z > 6) continue;
      this.pools.set(n++, x, gy - 0.02, z, 1.2 + K.rand2(i, 3, 23) * 2, K.rand2(i, 4, 23) * TAU, 0.7, 0, 1);
    }
    this.pools.upload(n);

    // wave lines and the glitter road: unit decals scaled per draw
    this.stripMesh = r.createMesh(plane(1, 14, 1));   // subdivided so the affine UVs of long strips stay sane
    this.waveTex = r.texture(waveLine());
    this.glitterTex = r.texture(glitter());

    // drifters: soft glows bobbing just above the water
    this.glows = r.createInstances(N_DRIFT);
    this.dr = Array.from({ length: N_DRIFT }, (_, i) => ({
      hx: (K.rand2(i, 1, 31) - 0.5) * 56, hz: -2 - K.rand2(i, 2, 31) * 20,           // home spot (spread field)
      ga: (i / N_DRIFT) * TAU + K.rand2(i, 3, 31) * 0.4, gr: 4 + K.rand2(i, 4, 31) * 8, // gathered spot (loose ring)
      ph: K.rand2(i, 5, 31) * TAU, on: 0.05 + (i / N_DRIFT) * 0.7, idle: i === 3 || i === 10,
      x: 0, z: 0, level: 0,
    }));
    this.pulses = new K.Pulses({ loop: N_DRIFT, width: 2.5, decay: 1.4 });
    this.ripples = new K.Ripples(r, { color: R(3, 3), life: 4.5 });

    this.stars = new K.Particles(r, 'starTwinkle', { area: [90, 22, 90], yOffset: 18 });   // high above, never at the lens
    this.mist = new K.Particles(r, 'mist', { area: [50, 1.2, 40] });

    this.cam = new K.CameraRig({ fov: 58, far: 260, fovPunch: 0.8, nudge: 0.03, rollKick: 0.004, idleSpeed: 0.03, activeSpeed: 0.07, bassBoost: 0.01 });
    this.breath = new K.Breath({ beats: 8, period: 11 });
    this.phase = 0; this.time = 0; this.k = 0; this.a = null; this.bassS = 0; this.nextIdle = 3;
    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], water: [0, 0, 0], refl: [0, 0, 0], wave: [0, 0, 0] };
    this.wavePhase = Array.from({ length: N_WAVES }, (_, i) => i / N_WAVES);
    this._moonX = 0;
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k), t = this.time;
    const b = this.breath.update(a, dt);
    this.bassS += (d.bass - this.bassS) * Math.min(1, dt * 1.2);   // slow follower: waves swell, they don't jerk

    // slow glide along the shore, always looking out to the moon
    this.cam.update(a, k, dt);
    this.phase += this.cam.speed * dt;
    const ex = Math.sin(this.phase) * 13, ez = 14 + Math.cos(this.phase * 0.7) * 2;
    const e = this.cam.eye;
    e[0] = ex; e[2] = ez; e[1] = Math.max(4.4, height(ex, ez) + 3.4) + b * 0.35;
    this.cam.target[0] = ex * 0.5 + Math.sin(this.phase * 1.3) * 4; this.cam.target[1] = 1.2 + b * 0.2; this.cam.target[2] = -40;
    this.ground.follow(e[0], e[2]);

    // beats: one soft ripple where a drifter touches the water, a gentle pulse through the drifters
    if (d.beat) {
      const i = Math.floor(K.rand2(a.beatCount || 0, t, 3) * N_DRIFT), D = this.dr[i];
      this.pulses.trigger(i, 0.5 + k * 0.4, 3);
      this.ripples.spawn(D.x, W, D.z, 3 + k * 2.5);
    }
    // idle life: a drifter dips now and then
    if ((this.nextIdle -= dt) <= 0) {
      this.nextIdle = 3.5 + Math.random() * 5;
      const D = this.dr[Math.floor(Math.random() * N_DRIFT)];
      this.ripples.spawn(D.x, W, D.z, 1.6 + Math.random());
    }
    this.pulses.update(dt);
    this.ripples.update(dt);

    // drifters: ease from a spread field toward a loose ring as the song swells
    const gather = K.stage(k, 0.25, 0.85) * 0.85;
    this.dr.forEach((D, i) => {
      const sway = Math.sin(t * 0.13 + D.ph) * 1.2;
      const gx = Math.cos(D.ga + t * 0.03) * D.gr, gz = -2 + Math.sin(D.ga + t * 0.03) * D.gr * 0.45;
      D.x = lerp(D.hx + sway, gx, gather); D.z = lerp(D.hz + Math.cos(t * 0.11 + D.ph), gz, gather);
      const lit = Math.max(D.idle ? 0.35 : 0.05, K.stage(k, D.on, D.on + 0.2));
      D.level = lit * (0.75 + 0.25 * b) + this.pulses.at(i) * 0.5;
      const size = 1.1 + D.level * 1.3, y = W + 0.25 + size * 0.55 + Math.sin(t * 0.55 + D.ph) * 0.12;   // centre above the waterline so the clip never cuts the glow
      this.glows.set(i, D.x, y, D.z, size, 0, D.level, 0, 1);
    });
    this.glows.upload(N_DRIFT);

    // waves roll toward the shore; period is slow and fixed, intensity only changes their light and reach
    const sp = 0.012 + k * 0.004;
    for (let i = 0; i < N_WAVES; i++) this.wavePhase[i] = (this.wavePhase[i] + sp * dt) % 1;

    const eye = this.cam.eye;
    this.stars.update(dt, [eye[0], 0, eye[2] - 30], { amount: K.stage(k, 0.25, 0.8), speed: 0.4 });
    this.mist.update(dt, [0, W + 0.9, -24], { amount: K.swell(k, 0.8, 0.4), speed: 0.3 });
  }

  /** Everything that stands above the water (drawn twice: reflected, then normally). */
  _world(r, col, glowLevel) {
    const eye = this.cam.eye;
    this.sky.draw(r, eye, { horizon: col.fog, zenith: this.pal.color(R(3, 0)), brightness: col.tint[0], starLevel: 0.35 + this.k * 0.3 + this.breath.v * 0.1 });
    this.ground.draw(r, { texture: this.sandTex, tint: col.tint });
    r.drawInstanced(this.logMesh, this.logs, { texture: this.logTex, tint: col.tint });
    r.drawInstanced(this.rockMesh, this.rocks, { texture: this.rockTex, tint: col.tint });
    col.refl[0] = col.refl[1] = col.refl[2] = glowLevel;
    r.drawInstanced(this.quad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [55, 100], tint: col.refl });
  }

  render(r) {
    const { col, k } = this, P = this.pal, t = this.time;
    const dim = lerp(0.62, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 14, lerp(90, 125, k));
    r.setLight([0.1, -0.35, 0.9], scaleColor(col.light, P.role('light'), lerp(0.4, 0.75, k)), scaleColor(col.amb, P.role('ambient'), 0.5));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    // 1) reflection, a little darker
    r.setMirror(W);
    col.tint[0] = col.tint[1] = col.tint[2] = dim * 0.7;
    this._world(r, col, 0.45);
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    r.setMirror(null);
    r.clearDepth();

    // 2) the world, clipped at the waterline
    r.setClipBelow(W);
    this._world(r, col, 1);
    // rock pools: little mirrors on the sand (opaque water texture, dithered into the sand)
    col.water[0] = col.water[1] = col.water[2] = dim * 0.8;
    r.drawInstanced(this.poolMesh, this.pools, { texture: this.waterTex, tint: col.water, opacity: 0.7 });
    r.setClipBelow(null);

    // 3) water sheet over the reflection
    const drift = t * 0.006;
    r.draw(this.waterMesh, mat4.identity(this.m), { texture: this.waterTex, tint: col.water, opacity: lerp(0.62, 0.5, k), uvOffset: [drift, drift * 0.4] });

    // 4) moon glitter road + wave lines + ripples (additive, flat on the water)
    const eye = this.cam.eye, m = this.m, wv = col.wave;
    const glit = lerp(0.3, 0.65, k) * (0.8 + this.breath.v * 0.25);
    wv[0] = wv[1] = wv[2] = glit;
    r.draw(this.stripMesh, mat4.trs(m, eye[0], W + 0.05, eye[2] - 80, 0, 0, 0, 18, 1, 100), { texture: this.glitterTex, unlit: true, additive: true, depthWrite: false, tint: wv, uvOffset: [Math.sin(t * 0.1) * 0.05, 0], fade: [30, 105] });
    const reach = lerp(0.5, 1, k) + this.bassS * 0.35;     // longer, wider waves with the swell and the bass
    for (let i = 0; i < N_WAVES; i++) {
      const p = this.wavePhase[i];
      const z = lerp(-70, 3, p * p * 0.5 + p * 0.5), fadeIO = Math.sin(Math.PI * p);
      const wd = lerp(1.2, 4, p) * (1 + this.bassS * 0.8), len = (130 + (i % 3) * 30) * (0.6 + reach * 0.4);
      const x = eye[0] * 0.6 + Math.sin(i * 2.3 + t * 0.02) * 10;
      const br = fadeIO * lerp(0.4, 0.9, k) * (0.85 + this.breath.v * 0.2);
      wv[0] = wv[1] = wv[2] = br;
      r.draw(this.stripMesh, mat4.trs(m, x, W + 0.05, z, 0, 0, 0, len, 1, wd), { texture: this.waveTex, unlit: true, additive: true, depthWrite: false, tint: wv, fade: [8, 110], uvScale: [len / 16, 1], uvOffset: [i * 0.37 + t * 0.004, 0] });
    }
    this.ripples.draw(r, { brightness: lerp(0.4, 0.75, k) });

    // 5) air: low mist, twinkling stars-in-air
    this.mist.draw(r, { brightness: dim, opacity: 0.2 + this.breath.v * 0.08 });
    this.stars.draw(r, { brightness: K.stage(k, 0.25, 0.8) });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    [this.stars, this.mist, this.ripples].forEach((x) => x.dispose(r));
    [this.waterMesh, this.quad, this.logMesh, this.rockMesh, this.poolMesh, this.stripMesh].forEach((x) => x.dispose());
    [this.sandTex, this.waterTex, this.glowTex, this.logTex, this.rockTex, this.waveTex, this.glitterTex].forEach((x) => r.deleteTexture(x));
    [this.logs, this.rocks, this.pools, this.glows].forEach((x) => x.dispose());
  }
}
