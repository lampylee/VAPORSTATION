// PETAL STEPS — slow-song environment. A long flight of old stone steps climbing a wooded
// hillside at dusk, lined with paper-lantern posts and blossom trees.
//
//   endless climb          steps are one instanced slab, re-laid every frame along an analytic path
//                          (K.forSegments for trees / mist / light shafts, deterministic per segment)
//   lantern posts          prism posts + K.sprites.lantern + glow, lit ahead of the camera by K.stage
//   pulse up the lanterns  K.Pulses (beats) travelling away from the camera along the post index
//   blossoms + woods       K.sprites.blossomTree / broadleaf, sway with mids and K.Breath
//   air                    petals preset, pollen, mist cards (K.sprites.mistBank + opacity) in the hollows
//   light shafts           K.sprites.lightShaft through the canopy, swell only
//
// Idle: dusk, mist, a handful of lanterns glowing, petals barely falling, a very slow climb.
// Swell: lanterns light up the steps ahead, the petal fall thickens, light shafts open up.
// Beat: one soft pulse runs up the line of lanterns. Mids: blossom sway. Speed never rises.
import { mat4, lerp, clamp, smoothstep } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { box } from '../gfx/geometry.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const DEPTH = 0.75, RISE = 0.22, SLOPE = RISE / DEPTH;    // one step
const POST_GAP = 6, POST_SIDE = 3.5, POST_H = 2.6;
const AHEAD = 100, BEHIND = 10;
const MAX_STEPS = Math.ceil((AHEAD + BEHIND) / DEPTH) + 4;
const MAX_POSTS = Math.ceil((AHEAD + BEHIND) / POST_GAP) + 3;

// the path is a function of z: it winds gently left and right while climbing
const pathX = (z) => 6 * Math.sin(z * 0.0523) + 2.5 * Math.sin(z * 0.0191 + 1);
const pathDX = (z) => 6 * 0.0523 * Math.cos(z * 0.0523) + 2.5 * 0.0191 * Math.cos(z * 0.0191 + 1);
const pathY = (z) => z * SLOPE;
const sstep = (a, b, x) => smoothstep(clamp((x - a) / (b - a)));

// hillside: flat under the steps, banks rising to the sides, hollows and ridges beyond
const height = (x, z) => {
  const d = Math.abs(x - pathX(z)), bank = sstep(3.4, 14, d);
  return pathY(z) - 0.7 + bank * (3 + K.fbm(x * 0.05, z * 0.05, { octaves: 3, seed: 9 }) * 3.5)
    + K.ridged(x * 0.012, z * 0.012) * 9 * sstep(20, 55, d)
    - sstep(0, 1, K.fbm(x * 0.03 + 5, z * 0.03, { octaves: 2, seed: 2 })) * 2.2 * sstep(8, 18, d);
};

export class PetalSteps {
  static meta = { name: 'Petal Steps' };
  static palette = fromKeys('petal-steps', 'Petal Steps', ['#7d7a72', '#5e8048', '#ff9fc2', '#4a4068']);

  init(r) {
    this.ground = new K.Terrain(r, { size: 170, cells: 48, height, uvScale: 0.3 });
    this.groundTex = r.texture(K.tex.jungleFloor({ seed: 11 }));
    this.sky = new K.Sky(r, { stars: 140, moon: true, moonDir: [0.3, 0.25, 1], moonSize: 6, clouds: 4, moonTexture: K.sprites.moon({ ramp: 3 }) });

    // steps: one slab (base at the pivot), instanced; top surface at the step height
    const slab = box(5.4, 2, DEPTH + 0.14, { uvRepeat: [2, 0.5] });
    K.props.shift(slab, 0, 1, 0);
    this.slabMesh = r.createMesh(slab);
    this.stoneTex = r.texture(K.tex.mossStone({ seed: 3 }));
    this.steps = r.createInstances(MAX_STEPS);

    // lantern posts + lanterns + glows (two per index, one each side)
    this.postMesh = r.createMesh(K.props.prism(4, 0.13, POST_H, { cap: true }));
    this.postTex = r.texture(K.tex.cliffRock({ seed: 5 }));
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.lanternTex = r.texture(K.sprites.lantern({ ramp: 2 }));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.posts = r.createInstances(MAX_POSTS * 2);
    this.lanterns = r.createInstances(MAX_POSTS * 2);
    this.glows = r.createInstances(MAX_POSTS * 2);
    this.pulses = new K.Pulses({ width: 2.5, decay: 1.3 });

    // woods
    this.blossomTex = r.texture(K.sprites.blossomTree({ ramp: 2 }));
    this.leafTex = r.texture(K.sprites.broadleaf({ ramp: 1 }));
    this.blossoms = r.createInstances(90);
    this.woods = r.createInstances(150);
    this.shaftTex = r.texture(K.sprites.lightShaft({ ramp: 3 }));
    this.shafts = r.createInstances(24);
    this.mistTex = r.texture(K.sprites.mistBank({ ramp: 3 }));
    this.mists = r.createInstances(40);

    this.petals = new K.Particles(r, 'petals');
    this.pollen = new K.Particles(r, 'pollen');

    this.cam = new K.PathRig((s, out) => { out[0] = pathX(s); out[1] = pathY(s) + 2; out[2] = s; return out; },
      { lookAhead: 9, idleSpeed: 0.55, activeSpeed: 0.7, bassBoost: 0, bob: 0, fovPunch: 0.6, nudge: 0.03, rollKick: 0.005, fov: 58, far: 220 });
    this.cam.s = 30;
    this.breath = new K.Breath({ beats: 8, period: 11 });
    this.time = 0; this.k = 0; this.a = null; this.nBlossom = 0; this.nWood = 0;
    this.m = mat4.create();
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0], g2: [0, 0, 0], shaft: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k), t = this.time;
    const b = this.breath.update(a, dt);
    this.cam.update(a, k, dt);
    this.cam.eye[1] += b * 0.12;
    const eye = this.cam.eye, cs = this.cam.s;
    this.ground.follow(eye[0], eye[2]);

    // steps along the path, laid fresh around the camera (the climb is endless)
    const i0 = Math.floor((cs - BEHIND) / DEPTH), i1 = Math.floor((cs + AHEAD) / DEPTH);
    let n = 0;
    for (let i = i0; i <= i1 && n < MAX_STEPS; i++) {
      const z = i * DEPTH;
      this.steps.set(n++, pathX(z), pathY(z) - 2 + RISE * 0.5, z, 1, Math.atan(pathDX(z)), 0.85 + K.rand2(i, 1, 21) * 0.2, 0, 1);
    }
    this.steps.upload(n); this.nSteps = n;

    // beat: one soft pulse climbs the line of lanterns, starting a little ahead of the camera
    const camPost = Math.floor(cs / POST_GAP);
    if (d.beat) this.pulses.trigger(camPost + 2, 0.55 + k * 0.45, 3);
    this.pulses.update(dt);

    // lantern posts: lit from near to far as the swell rises; a few glow even at idle
    let np = 0;
    const p0 = Math.floor((cs - BEHIND) / POST_GAP), p1 = Math.floor((cs + AHEAD) / POST_GAP);
    for (let pi = p0; pi <= p1 && np < MAX_POSTS * 2; pi++) {
      const z = pi * POST_GAP + 2, dist = z - cs;
      const on = 0.12 + clamp(dist / 90) * 0.62;
      const base = pi % 4 === 0 ? 0.55 : 0.05;
      const level = (Math.max(base, K.stage(k, on, on + 0.18)) * (0.78 + 0.22 * b) + this.pulses.at(pi) * 0.8) * K.fadeOut(dist, 70, 96);
      const gl = lerp(0.3, 1, K.fadeIn(dist, 3, 20));   // near glows stay soft: they sit right beside the lens
      const yaw = Math.atan(pathDX(z)), cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const side of [-1, 1]) {
        const x = pathX(z) + side * POST_SIDE * cy, zz = z - side * POST_SIDE * sy, y = pathY(z) + 0.15;
        const sw = Math.sin(t * 0.9 + pi * 1.7 + side) * 0.03;
        this.posts.set(np, x, y, zz, 1, yaw, 0.9, 0, 1);
        this.lanterns.set(np, x, y + POST_H + 0.4 + sw, zz, 0.7, 0, 0.55 + level * 0.65, 0, 1.5);
        this.glows.set(np, x, y + POST_H + 0.55 + sw, zz, 0.9 + level * 0.6, 0, level * gl, 0, 1);
        np++;
      }
    }
    this.posts.upload(np); this.lanterns.upload(np); this.glows.upload(np); this.nPosts = np;

    // woods, light shafts and mist hollows: deterministic per segment, kept off the path
    let nb = 0, nw = 0, nsh = 0, nm = 0;
    K.forSegments(cs, { length: 10, ahead: AHEAD, behind: BEHIND }, (i, z0) => {
      for (let j = 0; j < 10; j++) {
        const side = K.rand2(i, j, 31) < 0.5 ? -1 : 1;
        const z = z0 + K.rand2(i, j, 32) * 10, lat = 6.5 + K.rand2(i, j, 33) * 20;
        const x = pathX(z) + side * lat, y = height(x, z) - 0.3;
        const fd = K.fadeOut(z - cs, AHEAD - 28, AHEAD - 4);
        if (fd <= 0.02) continue;
        const size = (5 + K.rand2(i, j, 34) * 3.5) * fd, sh = 0.82 + K.rand2(i, j, 35) * 0.3;
        if (K.rand2(i, j, 36) < 0.38 && nb < 90) this.blossoms.set(nb++, x, y, z, size, 0, sh, i * 10 + j, 1.33);
        else if (nw < 150) this.woods.set(nw++, x, y, z, size * 1.15, 0, sh * 0.9, i * 10 + j, 1.4);
      }
      // a shaft of light through the canopy, some segments only
      if (K.rand2(i, 0, 41) < 0.6 && nsh < 24) {
        const side = K.rand2(i, 1, 41) < 0.5 ? -1 : 1, z = z0 + K.rand2(i, 2, 41) * 10, x = pathX(z) + side * (9 + K.rand2(i, 3, 41) * 8);
        this.shafts.set(nsh++, x, height(x, z) - 1, z, 5 + K.rand2(i, 4, 41) * 3, 0, 1, 0, 3);
      }
      // mist sits in the hollows well off the path (never near the lens)
      for (let j = 0; j < 2 && nm < 40; j++) {
        const side = j ? 1 : -1, z = z0 + K.rand2(i, j, 51) * 10, x = pathX(z) + side * (11 + K.rand2(i, j, 52) * 9) + Math.sin(t * 0.03 + i + j) * 1.5;
        this.mists.set(nm++, x, height(x, z) + 0.9, z, 15 + K.rand2(i, j, 53) * 6, 0, 1, 0, 0.3);
      }
    });
    this.blossoms.upload(nb); this.woods.upload(nw); this.shafts.upload(nsh); this.mists.upload(nm);
    this.nb = nb; this.nw = nw; this.nsh = nsh; this.nm = nm;

    // petals thicken with the swell and drift on a slow breeze, pollen only when the song is up
    const ahead = [eye[0], eye[1] + 1, eye[2] + 6];
    this.petals.update(dt, ahead, { amount: lerp(0.12, 0.85, K.stage(k, 0.15, 0.8)), speed: 0.55 + d.mid * 0.4, wind: [0.35, 0.1] });
    this.pollen.update(dt, ahead, { amount: K.swell(k, 0.1, 0.7), speed: 0.5 + d.high * 0.5 });
  }

  render(r) {
    const { col, k, a } = this, P = this.pal;
    const dim = lerp(0.6, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 8, lerp(72, 95, k));
    r.setLight([0.4, -0.55, 0.7], scaleColor(col.light, P.role('light'), lerp(0.3, 0.65, k)), scaleColor(col.amb, P.role('ambient'), 0.55));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;
    col.glow[0] = col.glow[1] = col.glow[2] = lerp(0.75, 1.1, k);

    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: dim, starLevel: 0.5 + this.breath.v * 0.2, cloudDrift: this.time * 0.004 });
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    r.drawInstanced(this.slabMesh, this.steps, { texture: this.stoneTex, tint: col.tint });
    r.drawInstanced(this.postMesh, this.posts, { texture: this.postTex, tint: col.tint });

    const sway = 0.015 + this.breath.v * 0.02 + (a ? K.drive(a, k).mid * 0.06 : 0);
    r.drawInstanced(this.quad, this.woods, { texture: this.leafTex, billboard: 1, sway: sway * 0.5, tint: col.tint });
    r.drawInstanced(this.quad, this.blossoms, { texture: this.blossomTex, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.lanterns, { texture: this.lanternTex, billboard: 1, unlit: true, tint: col.glow });
    r.drawInstanced(this.quad, this.glows, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [40, 90], tint: col.glow });

    // light through the canopy (additive, swell only), then mist, petals, pollen
    const shaft = K.stage(k, 0.35, 0.9) * (0.45 + 0.4 * this.breath.v);
    col.shaft[0] = col.shaft[1] = col.shaft[2] = shaft;
    if (shaft > 0.01) r.drawInstanced(this.quad, this.shafts, { texture: this.shaftTex, billboard: 1, unlit: true, additive: true, fog: false, fade: [30, 85], tint: col.shaft });
    r.drawInstanced(this.quad, this.mists, { texture: this.mistTex, billboard: 1, unlit: true, tint: col.tint, opacity: 0.26 + this.breath.v * 0.1, fade: [35, 90] });
    this.petals.draw(r, { brightness: dim });
    this.pollen.draw(r, { brightness: k });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r);
    [this.petals, this.pollen].forEach((x) => x.dispose(r));
    [this.slabMesh, this.postMesh, this.quad].forEach((m) => m.dispose());
    [this.groundTex, this.stoneTex, this.postTex, this.lanternTex, this.glowTex, this.blossomTex, this.leafTex, this.shaftTex, this.mistTex].forEach((t) => r.deleteTexture(t));
    [this.steps, this.posts, this.lanterns, this.glows, this.blossoms, this.woods, this.shafts, this.mists].forEach((i) => i.dispose());
  }
}
