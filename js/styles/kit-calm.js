// KIT CALM — Kit v3 reference environment for slow songs. Copy it for calm scenes.
//
//   still pond with a real reflection        r.setMirror / r.setClipBelow / r.clearDepth + water { opacity }
//   willows, blossom trees, reeds, lily pads K.sprites.willow / blossomTree / reeds, K.tex.lilyPad
//   floating paper lanterns                  K.sprites.lantern + glow, lit one by one (K.stage)
//   a light pulse that circles the lanterns  K.Pulses (on beats)
//   rings on the water                       K.Ripples (beats, plus the odd fish rising when idle)
//   petals, pollen, low mist, sky lanterns   K.Particles presets petals / pollen / mist / skyLanterns
//   a flock gliding over the water           K.School({ kind: 'bird' })
//   slow breathing tied to the tapped tempo  K.Breath (falls back to a 11 s cycle)
//
// Idle: dusk, mist on the water, a few lanterns glowing, very slow orbit.
// Swell: lanterns light up around the pond, petals and pollen drift in, birds
// arrive, sky lanterns rise. Beats: a soft pulse runs around the lantern ring
// and a ripple opens under a lantern. Nothing here is fast: it's for ballads.
//
// Beat motion follows Feel (d.beatMotion: Gentle 0 ... Punchy 1): the pulse always
// brightens the lanterns, but only swells their halos at Punchy; the ring opens
// every beat at Punchy and once a bar at Gentle; particle speeds and sway ease to
// d.energy at Gentle (lerp(d.energy, raw, d.beatMotion), so Punchy is the raw band).
import { mat4, lerp, clamp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { plane } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const WATER = 0;          // water plane height
const POND = 26;          // pond radius
const N_LANTERNS = 14;
const TAU = Math.PI * 2;

const height = (x, z) => {
  const d = Math.hypot(x, z), shore = clamp((d - POND + 3) / 12);
  return -1.6 + shore * shore * 2.4 + K.fbm(x * 0.03, z * 0.03, { octaves: 3, seed: 4 }) * 4 * clamp((d - POND) / 25) + K.ridged(x * 0.01, z * 0.01) * 6 * clamp((d - POND - 20) / 30);
};

export class KitCalm {
  static meta = { name: 'Kit calm (pond)', hidden: true };
  static palette = fromKeys('kitcalm', 'Kit Calm', ['#6a6a78', '#4f7a5a', '#ffbf8f', '#1e2340']);

  init(r) {
    this.ground = new K.Terrain(r, { size: 180, cells: 42, height, uvScale: 0.3 });
    this.groundTex = r.texture(K.tex.jungleFloor({ seed: 5 }));
    this.sky = new K.Sky(r, { stars: 160, moon: true, moonDir: [-0.5, 0.22, -1], moonSize: 7, clouds: 5, moonTexture: K.sprites.moon({ ramp: 3 }) });

    // water: a big flat disc (reaches under the shore to the horizon), drawn over the reflection
    // (subdivided, so the affine texture warp stays mild on the near water)
    this.waterMesh = r.createMesh(plane(260, 26, 36));
    this.waterTex = r.texture(K.tex.water({ ramp: 3 }));

    // shore planting (instanced billboards, placed once)
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.willowTex = r.texture(K.sprites.willow({ ramp: 1 }));
    this.blossomTex = r.texture(K.sprites.blossomTree({ ramp: 2 }));
    this.reedTex = r.texture(K.sprites.reeds({ ramp: 1 }));
    this.willows = r.createInstances(12); this.blossoms = r.createInstances(12); this.reeds = r.createInstances(60);
    let nw = 0, nb = 0, nr = 0;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU + K.rand2(i, 1, 7) * 0.2, d = POND + 12 + K.rand2(i, 2, 7) * 12;   // outside the camera orbit
      const x = Math.cos(a) * d, z = Math.sin(a) * d, y = height(x, z) - 0.3;
      if (i % 2 === 0 && nw < 12) this.willows.set(nw++, x, y, z, 8 + K.rand2(i, 3, 7) * 3, 0, 0.85 + K.rand2(i, 4, 7) * 0.3, i, 1.33);
      else if (nb < 12) this.blossoms.set(nb++, x, y, z, 7 + K.rand2(i, 3, 7) * 3, 0, 0.9, i, 1.33);
    }
    for (let i = 0; i < 60; i++) {
      const a = K.rand2(i, 1, 9) * TAU, d = POND - 2.5 + K.rand2(i, 2, 9) * 4;
      if (K.rand2(i, 3, 9) < 0.35) continue;   // leave gaps in the reed beds
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      this.reeds.set(nr++, x, Math.max(WATER - 0.2, height(x, z) - 0.2), z, 1.6 + K.rand2(i, 4, 9), 0, 0.85 + K.rand2(i, 5, 9) * 0.3, i * 2, 1);
    }
    this.willows.upload(nw); this.blossoms.upload(nb); this.reeds.upload(nr);

    // lily pads: flat decals on the water
    this.padMesh = r.createMesh(K.decal(1, 1, 0.02));
    this.padTex = r.texture(K.tex.lilyPad({ ramp: 1, flower: 2 }));
    this.pads = r.createInstances(40);
    let np = 0;
    for (let i = 0; i < 40; i++) {
      const a = K.rand2(i, 1, 3) * TAU, d = 6 + K.rand2(i, 2, 3) * (POND - 9);
      this.pads.set(np++, Math.cos(a) * d, WATER, Math.sin(a) * d, 0.9 + K.rand2(i, 3, 3) * 0.9, K.rand2(i, 4, 3) * TAU, 0.85 + K.rand2(i, 5, 3) * 0.3, 0, 1);
    }
    this.pads.upload(np);

    // floating lanterns in a loose ring; each has a glow sprite
    this.lanternTex = r.texture(K.sprites.lantern({ ramp: 2 }));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.lanterns = r.createInstances(N_LANTERNS); this.glows = r.createInstances(N_LANTERNS);
    this.lant = Array.from({ length: N_LANTERNS }, (_, i) => {
      const a = (i / N_LANTERNS) * TAU, d = 12 + K.rand2(i, 1, 5) * 7;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, ph: K.rand2(i, 2, 5) * TAU, on: 0.1 + K.rand2(i, 3, 5) * 0.75, idle: i % 4 === 0 };
    });
    this.pulses = new K.Pulses({ loop: N_LANTERNS, width: 2.5, decay: 1.1 });
    this.ripples = new K.Ripples(r, { color: R(3, 3), life: 4 });

    this.birds = new K.School(r, { kind: 'bird', groups: 1, perGroup: 9, size: 1.4, spread: [2, 6], lift: 0.8 });
    this.petals = new K.Particles(r, 'petals');
    this.pollen = new K.Particles(r, 'pollen');
    this.mist = new K.Particles(r, 'mist', { area: [38, 1.5, 38] });   // stays mid-pond, clear of the camera orbit
    this.skyLanterns = new K.Particles(r, 'skyLanterns', { area: [90, 22, 90], yOffset: 0 });

    this.cam = new K.OrbitRig({ center: [0, 0.6, 0], radius: 30, height: 3.2, bob: 0.4, pushIn: 0.6, idleSpeed: 0.018, activeSpeed: 0.05, bassBoost: 0.02, fovPunch: 1.5, nudge: 0.08, rollKick: 0.01, fov: 58, far: 260 });
    this.breath = new K.Breath({ beats: 8, period: 11 });
    this.time = 0; this.k = 0; this.a = null; this.nextIdleRipple = 2;
    this.d = K.drive({ level: 0, bass: 0, mid: 0, high: 0, beatPulse: 0 }, 0);
    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], water: [0, 0, 0], refl: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = this.d = K.drive(a, k), t = this.time;
    const b = this.breath.update(a, dt);
    this.cam.update(a, k, dt);
    this.cam.eye[1] += b * 0.5;                       // the whole view breathes up and down, slowly
    this.ground.follow(this.cam.eye[0], this.cam.eye[2]);

    // beats: a pulse runs around the lantern ring, a ripple opens under a lantern
    if (d.beat) {
      const i = Math.floor(K.rand2(a.beatCount || 0, t, 3) * N_LANTERNS), L = this.lant[i];
      this.pulses.trigger(i, 0.6 + k * 0.4, 4);
      if (d.beatMotion > 0.5 || ((a.bpm || 0) > 0 && Number.isFinite(a.bar) ? (a.bar | 0) === 0 : (a.beatCount || 0) % 4 === 0)) this.ripples.spawn(L.x, WATER, L.z, 3 + k * 2);   // every beat at Punchy, once a bar at Gentle
    }
    // idle life: now and then a fish rises somewhere on the pond
    if ((this.nextIdleRipple -= dt) <= 0) {
      this.nextIdleRipple = 2.5 + Math.random() * 4;
      const ang = Math.random() * TAU, dd = 4 + Math.random() * (POND - 8);
      this.ripples.spawn(Math.cos(ang) * dd, WATER, Math.sin(ang) * dd, 1.6 + Math.random());
    }
    this.pulses.update(dt);
    this.ripples.update(dt);

    // lanterns bob on the water; light comes on one by one with the swell
    this.lant.forEach((L, i) => {
      const lit = Math.max(L.idle ? 0.55 : 0.08, K.stage(k, L.on, L.on + 0.15));
      const pl = this.pulses.at(i) * 0.8;
      L.level = lit * (0.75 + 0.25 * b) + pl;
      const lvSize = L.level - pl * (1 - d.beatMotion);   // the pulse brightens; it only swells the halo at Punchy
      const y = WATER + 0.35 + Math.sin(t * 0.8 + L.ph) * 0.06;
      this.lanterns.set(i, L.x, y, L.z, 0.75, 0, 0.6 + L.level * 0.6, 0, 1.5);
      this.glows.set(i, L.x, y + 0.5, L.z, 1.2 + lvSize * 0.9, 0, L.level, 0, 1);
    });
    this.lanterns.upload(N_LANTERNS); this.glows.upload(N_LANTERNS);

    // birds glide a wide loop well beyond the camera's orbit (never right past the lens);
    // they flap only when the song is up
    this.birds.update(dt, (g, tt, out) => { const ang = tt * 0.04; out[0] = Math.cos(ang) * 75; out[1] = 20 + Math.sin(tt * 0.3) * 3; out[2] = Math.sin(ang) * 75; },
      { amount: K.stage(k, 0.3, 0.8), speed: 1, flap: K.stage(k, 0.4, 0.6) * 0.6 });   // flap can change every frame (Kit v4)

    const eye = this.cam.eye;
    this.petals.update(dt, eye, { amount: K.stage(k, 0.2, 0.7) * 0.8, speed: 0.6 + lerp(d.energy, d.mid, d.beatMotion) * 0.5, wind: [0.3, 0.1] });
    this.pollen.update(dt, eye, { amount: K.swell(k, 0.15, 0.8), speed: 0.5 + lerp(d.energy, d.high, d.beatMotion) });
    this.mist.update(dt, [0, WATER + 1.4, 0], { amount: K.swell(k, 1, 0.45), speed: 0.4 });
    // sky lanterns rise over the pond, kept well above the camera so none drifts past the lens
    this.skyLanterns.update(dt, [0, 26, 0], { amount: K.stage(k, 0.55, 1) * 0.9, speed: 0.6 });
  }

  /** Everything that stands above the water (drawn twice: reflected, then normally). */
  _world(r, col, glowLevel) {
    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: this.pal.color(R(3, 0)), brightness: col.tint[0], starLevel: 0.5 + this.breath.v * 0.2, cloudDrift: this.time * 0.004 });
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    const sway = 0.015 + this.breath.v * 0.02 + lerp(this.d.energy, this.d.mid, this.d.beatMotion) * 0.05;
    r.drawInstanced(this.quad, this.willows, { texture: this.willowTex, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.blossoms, { texture: this.blossomTex, billboard: 1, sway: sway * 0.6, tint: col.tint });
    r.drawInstanced(this.quad, this.reeds, { texture: this.reedTex, billboard: 1, sway: sway * 1.5, tint: col.tint });
    r.drawInstanced(this.quad, this.lanterns, { texture: this.lanternTex, billboard: 1, unlit: true, tint: col.glow });
    col.refl[0] = col.refl[1] = col.refl[2] = glowLevel;
    r.drawInstanced(this.quad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [50, 90], tint: col.refl });
    this.birds.draw(r, { tint: col.tint });
  }

  render(r) {
    const { col, k } = this, P = this.pal;
    const dim = lerp(0.6, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 16, lerp(95, 120, k));
    r.setLight([0.5, -0.5, 0.6], scaleColor(col.light, P.role('light'), lerp(0.35, 0.7, k)), scaleColor(col.amb, P.role('ambient'), 0.5));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    col.glow[0] = col.glow[1] = col.glow[2] = lerp(0.75, 1.1, k);

    // 1) the reflection: the world mirrored in the water plane, a little darker
    r.setMirror(WATER);
    const tint = col.tint[0];
    col.tint[0] = col.tint[1] = col.tint[2] = tint * 0.7;
    this._world(r, col, 0.45);
    col.tint[0] = col.tint[1] = col.tint[2] = tint;
    r.setMirror(null);
    r.clearDepth();

    // 2) the world itself, clipped at the waterline so the reflection shows through
    r.setClipBelow(WATER);
    this._world(r, col, 1);
    r.setClipBelow(null);

    // 3) water surface over the reflection (screen-door), drifting ripples; pads and rings on top
    col.water[0] = col.water[1] = col.water[2] = dim * 0.9;
    const drift = this.time * 0.01;
    r.draw(this.waterMesh, mat4.identity(this.m), { texture: this.waterTex, tint: col.water, opacity: lerp(0.62, 0.5, k), uvOffset: [drift, drift * 0.3] });
    r.drawInstanced(this.padMesh, this.pads, { texture: this.padTex, tint: col.tint });
    this.ripples.draw(r, { brightness: lerp(0.35, 0.7, k) });

    // 4) air: mist low on the water, petals and pollen, lanterns rising far off
    this.mist.draw(r, { brightness: dim, opacity: 0.24 + this.breath.v * 0.1 });
    this.petals.draw(r, { brightness: dim });
    this.pollen.draw(r, { brightness: k });
    this.skyLanterns.draw(r, { brightness: 1 });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    [this.petals, this.pollen, this.mist, this.skyLanterns, this.birds, this.ripples].forEach((x) => x.dispose(r));
    [this.waterMesh, this.quad, this.padMesh].forEach((m) => m.dispose());
    [this.groundTex, this.waterTex, this.willowTex, this.blossomTex, this.reedTex, this.padTex, this.lanternTex, this.glowTex].forEach((t) => r.deleteTexture(t));
    [this.willows, this.blossoms, this.reeds, this.pads, this.lanterns, this.glows].forEach((i) => i.dispose());
  }
}
