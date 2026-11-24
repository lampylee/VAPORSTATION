// STILL POOL — a small dark pool at night, seen from just above the water (for a slow, floating song).
//
//   a small pool in a hollow, banks and bed        K.Terrain (one fixed build), K.tex.sand (mud)
//   the water mirrors everything above it          r.setMirror / r.setClipBelow / r.clearDepth + water { opacity }
//   half-sunk stones, reed beds along the edge     faceted icospheres (instanced), K.sprites.reeds
//   faint lights at the far water edge             K.sprites.glow, lit one by one (K.stage), mirrored dimmer
//   rings on the water                             K.Ripples (bass onsets, one per beat at most, the odd drip at idle)
//   a few fireflies low over the water             K.Particles fireflies
//   below the surface: caustics on the bed,        K.Caustics over the terrain mesh, K.Particles bubbles
//   slow bubbles, the surface seen from beneath
//   slow breathing tied to the tapped tempo        K.Breath (falls back to a 12 s cycle)
//
// Idle: very dark, close to the water, three distant lights and their reflections, a drip now and
// then. Swell: the camera sinks very slowly toward the surface, more lights come on and their
// reflections brighten; near the top of the swell it slips under: the view thickens into murk at
// the waterline (fog closes in, the surface fades) and opens again underwater, looking up at the
// rings from below. It only goes under once intensity has stayed high (hysteresis), so it never
// hovers in the murk. Bass: rings. Beat: at most one soft ring. Nothing else reacts to beats.
// Song sections (K.Moods, Conductor on): intro / breakdown / outro still the pool (small rings close
// in, reeds barely move, fewer lights, the camera sinks less); a build sets the reeds swaying and
// lets the rings spread wide; the drop lowers the camera to skim the surface with rings everywhere.
// Only the groove (= today, also Conductor off) may take the camera under; the other moods stay above.
import { mat4, lerp, clamp, damp, smoothstep } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { GeoBuilder, icosphere, flatNormals } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const W = 0;                         // water level
const TAU = Math.PI * 2;
const PCZ = -4, PX = 10, PZ = 9.5;    // pool: ellipse centred at (0, PCZ)
const N_LIGHTS = 9;
const SUB_IN = 0.78, SUB_OUT = 0.6;  // smoothed intensity that takes the camera under / back up
const SUB_TIME = 9;                  // seconds for a full pass through the waterline
const SKIM_Y = 0.2;                  // the drop's eye height over the water (above the murk band)

const sm = (t) => t * t * (3 - 2 * t);
const poolE = (x, z) => Math.hypot(x / PX, (z - PCZ) / PZ);   // < 1 inside the pool
const height = (x, z) => {
  const e = poolE(x, z), n = K.fbm(x * 0.15, z * 0.15, { octaves: 2, seed: 11 }) - 0.5;
  if (e < 1) return lerp(-2.3, -0.45, sm(clamp((e - 0.5) / 0.5))) + n * 0.35;
  return lerp(-0.45, 0.55, sm(clamp((e - 1) / 0.16))) + n * 0.4 + K.fbm(x * 0.05, z * 0.05, { octaves: 3, seed: 3 }) * 2.2 * clamp((e - 1.25) / 0.8);
};

/**
 * Flat water grid with fine cells around the camera and coarse ones far off, so the affine
 * texture warp stays mild right under the lens (a uniform plane smears there). World coords.
 */
function waterGrid() {
  const axis = (lo, hi, fine0, fine1) => {
    const out = [];
    for (let v = lo; v < hi;) {
      out.push(v);
      const d = v < fine0 ? fine0 - v : v > fine1 ? v - fine1 : 0;
      v += d === 0 ? 0.6 : d < 8 ? 1.5 : 4;
    }
    out.push(hi);
    return out;
  };
  const xs = axis(-40, 40, -6, 6), zs = axis(-44, 16, -7, 5), g = new GeoBuilder(), n = [0, 1, 0], s = 0.5;
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    g.quad([x0, W, z1], [x1, W, z1], [x1, W, z0], [x0, W, z0], [x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s], [x0 * s, z0 * s], n);
  }
  return g.build();
}

export class StillPool {
  static meta = { name: 'Still Pool' };
  static palette = ALBUM_PALETTES.inrainbows;

  init(r) {
    this.ground = new K.Terrain(r, { size: 60, cells: 36, height, uvScale: 0.35, shadeRange: [0.5, 1] });
    this.ground.follow(0, PCZ);   // fixed: the camera never travels far
    this.groundTex = r.texture(K.tex.sand({ ramp: 0, seed: 9 }));
    this.sky = new K.Sky(r, { stars: 70 });

    // water: fine cells near the lens, coarse far off
    this.waterMesh = r.createMesh(waterGrid());
    this.waterTex = r.texture(K.tex.water({ ramp: 3, seed: 7 }));

    // stones: low faceted lumps, half sunk along the edge, a few breaking the surface in front
    this.stoneMesh = r.createMesh(flatNormals(icosphere(1, 1)));
    this.stoneTex = r.texture(K.tex.cliffRock({ seed: 5 }));
    this.stones = r.createInstances(32);
    let ns = 0;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU + K.rand2(i, 1, 4) * 0.25, e = 0.96 + K.rand2(i, 2, 4) * 0.1;
      const x = Math.sin(a) * PX * e, z = PCZ - Math.cos(a) * PZ * e;
      if (z > 1) continue;                                   // nothing right behind / beside the lens
      const s = 0.5 + K.rand2(i, 3, 4) * 0.9;
      this.stones.set(ns++, x, height(x, z) - s * 0.2, z, s, K.rand2(i, 4, 4) * TAU, 0.75 + K.rand2(i, 5, 4) * 0.3, 0, 0.55, K.rand2(i, 6, 4) * 0.4, 0);
    }
    for (const [x, z, s] of [[-3.2, -3.4, 0.55], [2.6, -5.5, 0.7], [-1.2, -8.5, 0.45], [4.6, -2.6, 0.4], [-5.5, -6.8, 0.6]])
      this.stones.set(ns++, x, W - s * 0.3, z, s, x * 1.7, 0.8, 0, 0.5, 0.2, 0.1);
    this.stones.upload(ns);

    // reeds: beds around the edge with gaps
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.reedTex = r.texture(K.sprites.reeds({ ramp: 1, seed: 21 }));
    this.reeds = r.createInstances(64);
    let nr = 0;
    for (let i = 0; i < 64; i++) {
      const a = K.rand2(i, 1, 6) * TAU, e = 0.9 + K.rand2(i, 2, 6) * 0.1;
      if (K.rand2(Math.floor(a * 3), 3, 6) < 0.4) continue;   // gaps between the beds
      const x = Math.sin(a) * PX * e, z = PCZ - Math.cos(a) * PZ * e;
      if (z > 0.5) continue;
      this.reeds.set(nr++, x, Math.max(W - 0.25, height(x, z) - 0.15), z, 1.3 + K.rand2(i, 4, 6) * 0.9, 0, 0.8 + K.rand2(i, 5, 6) * 0.3, i * 1.7, 1.1);
    }
    this.reeds.upload(nr);

    // faint lights standing at the far water edge, so their reflections lie across the pool
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.glows = r.createInstances(N_LIGHTS);
    this.lights = Array.from({ length: N_LIGHTS }, (_, i) => {
      const a = (i / (N_LIGHTS - 1) - 0.5) * 1.9 + (K.rand2(i, 1, 2) - 0.5) * 0.15, e = 0.99 + K.rand2(i, 2, 2) * 0.09;
      const x = Math.sin(a) * PX * e, z = PCZ - Math.cos(a) * PZ * e;
      return { x, z, y: Math.max(W, height(x, z)) + 0.5 + K.rand2(i, 3, 2) * 0.9, ph: K.rand2(i, 4, 2) * TAU, on: 0.08 + K.rand2(i, 5, 2) * 0.55, idle: i % 3 === 1, size: 0.9 + K.rand2(i, 6, 2) * 0.6, level: 0 };
    });

    this.ripples = new K.Ripples(r, { color: R(3, 3), life: 4.5, max: 24 });
    this.caustics = new K.Caustics(r, { ramp: 3, fps: 4 });
    this.flies = new K.Particles(r, 'fireflies', { count: 24, size: 0.12, area: [18, 1.6, 9], yOffset: 0, wobble: 0.8 });
    this.bubbles = new K.Particles(r, 'bubbles', { count: 40, size: 0.07, vel: [0, 0.35, 0], jitter: [0.05, 0.15, 0.05], wobble: 0.3, area: [12, 2.2, 8], yOffset: 0, glow: 0.4 });

    this.cam = new K.CameraRig({ fov: 56, near: 0.05, far: 140, fovPunch: 0, nudge: 0.02, rollKick: 0, idleSpeed: 0, activeSpeed: 0, bassBoost: 0 });
    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.time = 0; this.k = 0; this.sk = 0; this.sub = 0; this.subTarget = 0; this.under = 0; this.murk = 0; this.eyeY = 1;
    this.a = null; this.barClock = new K.BarClock({ minGap: 1 }); this.midS = 0; this.swayMid = 0; this.bassAvg = 0; this.cool = 0; this.nextDrip = 1.5;
    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], murk: [0, 0, 0], tmp: [0, 0, 0], zen: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], water: [0, 0, 0] };

    // song sections: gates multiply the k fed into today's stage() curves (clamped 0..1); ringGate /
    // spread scale ring size / where rings land; rain = extra small rings per second (× k).
    // sink (how far the swell lowers the eye), skim (0..1 toward SKIM_Y) and subGate (> 0.5 lets the
    // camera go under) are camera keys: slow, eased twice.
    this.moods = new K.Moods({
      still:  { lightGate: 0.55, flyGate: 0.4, ringGate: 0.6,  ringBright: 0.8,  spread: 0.65, reedSway: 0.35, rain: 0,   sink: 0.6, skim: 0, subGate: 0 },
      base:   { lightGate: 1,    flyGate: 1,   ringGate: 1,    ringBright: 1,   spread: 1,    reedSway: 1,    rain: 0,   sink: 1,   skim: 0, subGate: 1 },
      gather: { lightGate: 1.2,  flyGate: 1.2, ringGate: 1.25, ringBright: 1.3, spread: 1.5,  reedSway: 2.4,  rain: 0.6, sink: 1,   skim: 0, subGate: 0 },
      full:   { lightGate: 1.4,  flyGate: 1.3, ringGate: 1.35, ringBright: 1.8, spread: 1.9,  reedSway: 2,    rain: 2.5, sink: 1,   skim: 1, subGate: 0 },
    }, { dropEase: 4, slow: ['sink', 'skim', 'subGate'] });
    this.camSink = null; this.camSkim = 0; this.camSub = 1; this.spread = 1; this.reedSway = 1; this.ringB = 1; this.nextRain = 0.5;
  }

  /** Spawn a ring somewhere in view on the water. */
  _ring(size, amp = 1) {
    const sp = this.spread, x = (Math.random() - 0.5) * 9 * sp, z = -2.5 - Math.random() * 8 * sp;
    this.ripples.spawn(x, W, z, size, amp);
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const m = this.moods.update(a, dt);
    const d = K.drive(a, k), t = this.time;
    const b = this.breath.update(a, dt);
    // camera mood keys: eased a second time so a section change starts softly
    if (this.camSink === null) { this.camSink = m.sink; this.camSkim = m.skim; this.camSub = m.subGate; }
    this.camSink = damp(this.camSink, m.sink, 2, dt); this.camSkim = damp(this.camSkim, m.skim, 2, dt); this.camSub = damp(this.camSub, m.subGate, 2, dt);
    this.spread = m.spread; this.reedSway = m.reedSway;
    const rl = m.ringBright - 1; this.ringB = 1 + (rl > 0 ? rl * k : rl);   // brighter rings are light: × k
    const skim = smoothstep(clamp(this.camSkim));
    // big, slow things follow a heavily smoothed intensity (plus a little song energy)
    this.sk = damp(this.sk, clamp(k * 0.85 + d.energy * 0.15), 4, dt);
    const sk = this.sk;

    // going under: hysteresis, then a slow constant-speed pass through the waterline
    if (sk > SUB_IN) this.subTarget = 1; else if (sk < SUB_OUT) this.subTarget = 0;
    const subT = this.camSub > 0.5 ? this.subTarget : 0;   // only the groove goes under; elsewhere the pass runs back up
    this.sub = clamp(this.sub + Math.sign(subT - this.sub) * Math.min(Math.abs(subT - this.sub), dt / SUB_TIME));
    const u = smoothstep(this.sub);

    this.cam.update(a, k, dt);
    const e = this.cam.eye, tg = this.cam.target;
    const skS = sk * this.camSink;
    const yAbove = lerp(lerp(1.25, 0.42, skS), SKIM_Y, skim) + b * lerp(0.08, 0.05, skim), yBelow = -0.8 + b * 0.06;
    e[0] = Math.sin(t * 0.031) * 1.1;
    e[1] = lerp(yAbove, yBelow, u);
    e[2] = 1.4 - sk * 1.1 + Math.sin(t * 0.023 + 1) * 0.3;
    tg[0] = Math.sin(t * 0.019 + 2) * 2.4;
    tg[1] = lerp(lerp(lerp(-1.6, -0.45, skS), -0.2, skim), 0.9, u);   // look down at the water (skimming: along it); from below, up at the surface
    tg[2] = -9;
    this.eyeY = e[1] + this.cam.nudge.x;
    this.under = this.eyeY < W ? 1 : 0;
    // (skimming, the eye is near the waterline without crossing it: then murk only during a pass under)
    this.murk = (1 - smoothstep(clamp(Math.abs(this.eyeY - W) / 0.32))) * lerp(1, smoothstep(clamp(this.sub * 3)), skim);

    // rings: a bass onset, or a beat; never more than one at a time (shared cooldown)
    this.bassAvg = damp(this.bassAvg, a.bass, 0.5, dt);
    this.cool -= dt;
    // (below Punchy a ring is a once-a-bar event: a ring growing on every kick is a beat movement)
    const onset = d.bass > 0.05 && a.bass - this.bassAvg > 0.07;
    const bar = this.barClock.update(a, dt) && k > 0.05;
    const hit = d.beatMotion >= 0.5 ? d.beat || onset : bar;
    if (hit && this.cool <= 0) {
      this._ring((2.2 + k * 2.8 + lerp(d.energy, d.bass, d.beatMotion) * 1.5) * lerp(0.7, 1, clamp(d.accent)) * m.ringGate);
      this.cool = 0.75 * Math.max(1, d.decay);
    }
    // idle life: a drip now and then (sparser as the song takes over)
    if ((this.nextDrip -= dt) <= 0) {
      this.nextDrip = lerp(3, 6, sk) + Math.random() * 3;
      this._ring(1.1 + Math.random() * 0.8);
    }
    // build / drop: small rings spreading everywhere, as if a light rain began (a steady rate, never on beats)
    if (m.rain * k > 0.01 && (this.nextRain -= dt * m.rain * k) <= 0) {
      this.nextRain = 0.6 + Math.random() * 0.8;
      this._ring(0.9 + Math.random() * 1.2, 0.7);
    }
    this.ripples.update(dt);
    this.caustics.update(dt, 0.6 + sk * 0.6);

    // far lights come on one by one with the swell and breathe gently
    this.lights.forEach((L, i) => {
      const lit = Math.max(L.idle ? 0.5 : 0, K.stage(clamp(sk * m.lightGate), L.on, L.on + 0.2));
      L.level = lit * (0.78 + 0.22 * b) * (0.92 + 0.08 * Math.sin(t * 0.7 + L.ph)) * lerp(0.8, 1.15, sk);
      this.glows.set(i, L.x, L.y, L.z, L.size * (0.8 + L.level * 0.6), 0, L.level, 0, 1);
    });
    this.glows.upload(N_LIGHTS);

    this.midS = damp(this.midS, d.mid, 0.5, dt);
    this.swayMid = lerp(this.midS, d.mid, d.beatMotion);
    this.flies.update(dt, [0, W + 0.9, -8], { amount: K.stage(clamp(sk * m.flyGate), 0.25, 0.75) * 0.8, speed: 0.4 });
    this.bubbles.update(dt, [0, -1.25, -5.5], { amount: u * lerp(0.3, 0.8, k), speed: 0.6 + this.swayMid * 0.4 });
  }

  /** Sky + everything standing in the scene. Drawn mirrored, then clipped (above), or once (below). */
  _world(r, col, glowLevel, { flies = true } = {}) {
    const fade = 1 - this.murk;
    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: col.zen, brightness: 1, starLevel: (0.25 + this.breath.v * 0.1) * fade * (1 - this.under * 0.5) });
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    r.drawInstanced(this.stoneMesh, this.stones, { texture: this.stoneTex, tint: col.tint });
    const sway = 0.012 + this.breath.v * 0.015 * Math.min(1, this.reedSway) + this.swayMid * 0.03 * this.reedSway;
    r.drawInstanced(this.quad, this.reeds, { texture: this.reedTex, billboard: 1, sway, tint: col.tint });
    const g = glowLevel * fade;
    if (g > 0.01) {
      col.glow[0] = col.glow[1] = col.glow[2] = g;
      r.drawInstanced(this.quad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [40, 70], tint: col.glow });
    }
    if (flies) this.flies.draw(r, { brightness: this.sk * fade });
  }

  render(r) {
    const { col, sk, murk } = this, P = this.pal;
    const dim = lerp(0.7, 1, sk);
    // underwater murk: the fog pulled toward the secondary ramp's darkest shade
    mixColor(col.murk, P.role('fog'), P.color(R(1, 0)), 0.5);
    scaleColor(col.murk, col.murk, lerp(0.8, 1.15, sk));
    scaleColor(col.tmp, P.role('fog'), dim);
    if (this.under) col.fog.splice(0, 3, ...col.murk); else mixColor(col.fog, col.tmp, col.murk, murk);
    scaleColor(col.zen, P.color(R(3, 0)), dim);
    mixColor(col.zen, col.zen, col.fog, Math.max(murk, this.under * 0.6));
    r.clear(col.fog);
    this.cam.apply(r);
    r.setLight([0.4, -0.6, 0.5], scaleColor(col.light, P.role('light'), lerp(0.4, 0.65, sk)), scaleColor(col.amb, P.role('ambient'), lerp(0.35, 0.5, sk)));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    if (!this.under) {
      // above: fog closes in to murk right at the waterline, so the pass under it is a dissolve
      r.setFog(col.fog, lerp(5, 0, murk), lerp(lerp(30, 40, sk), 1.2, murk));
      // 1) the reflection, darker; reflected lights brighten with the swell
      r.setMirror(W);
      col.tint[0] = col.tint[1] = col.tint[2] = dim * 0.6;
      this._world(r, col, lerp(0.75, 1.05, sk));
      col.tint[0] = col.tint[1] = col.tint[2] = dim;
      r.setMirror(null);
      r.clearDepth();
      // 2) the world itself, clipped at the waterline
      r.setClipBelow(W);
      this._world(r, col, 1);
      r.setClipBelow(null);
      // 3) the surface over the reflection, rings on top
      const op = lerp(lerp(0.5, 0.4, sk), 0, murk);
      if (op > 0.02) {
        col.water[0] = col.water[1] = col.water[2] = dim * 0.85;
        const dr = this.time * 0.006;
        r.draw(this.waterMesh, mat4.identity(this.m), { texture: this.waterTex, tint: col.water, opacity: op, uvOffset: [dr, dr * 0.4] });
      }
      this.ripples.draw(r, { brightness: lerp(0.4, 0.8, sk) * (1 - murk) * this.ringB });
    } else {
      // below: murky green-dark water, the bed with caustics, the surface seen from beneath
      r.setFog(col.fog, lerp(0.5, 0, murk), lerp(lerp(9, 15, sk), 1.2, murk));
      this._world(r, col, 0.6, { flies: false });
      this.caustics.draw(r, this.ground.mesh, { model: mat4.identity(this.m), brightness: lerp(0.12, 0.35, sk) * (1 - murk), uvScale: [0.6, 0.6] });
      const op = lerp(0.55, 0, murk);
      if (op > 0.02) {
        col.water[0] = col.water[1] = col.water[2] = lerp(0.9, 1.3, sk);
        const dr = this.time * 0.006;
        r.draw(this.waterMesh, mat4.identity(this.m), { texture: this.waterTex, tint: col.water, opacity: op, uvOffset: [dr, dr * 0.4] });
      }
      this.ripples.draw(r, { brightness: lerp(0.35, 0.7, sk) * (1 - murk) });
      this.bubbles.draw(r, { brightness: lerp(0.4, 0.8, sk) * (1 - murk) });
    }
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    [this.flies, this.bubbles, this.ripples, this.caustics].forEach((x) => x.dispose(r));
    [this.waterMesh, this.stoneMesh, this.quad].forEach((m) => m.dispose());
    [this.groundTex, this.waterTex, this.stoneTex, this.reedTex, this.glowTex].forEach((t) => r.deleteTexture(t));
    [this.stones, this.reeds, this.glows].forEach((i) => i.dispose());
  }
}
