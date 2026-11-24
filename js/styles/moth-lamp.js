// MOTH LAMP — a single old streetlamp in a black field, moths circling the light.
// (Wave 4a, slow songs; built from kit-calm.js.)
//
//   old iron lamp with a lit glass head        merged prisms/boxes, glass drawn unlit
//   pool of light on the ground + halo         additive decal / billboards (local radial texture)
//   tall grass lit by the lamp                 instanced grass sprites, per-instance shade by distance
//   moth swarm orbiting the head               local instanced swarm, wing flap = heightScale flip
//   a broken fence, dead trees far off         K.props.prism/box, K.sprites.deadTree
//   motes in the light                         K.Particles('dust')
//   slow breathing tied to the tapped tempo    K.Breath
//
// Idle: a few moths, a dim lamp, mostly darkness, the camera drifting round far out.
// Swell: the swarm thickens and tightens around the light, the pool on the ground widens.
// Peak (top of intensity, a big song): light floods the scene, the lamp and ground light
// near max and the fog lifts toward the light atmosphere shade. All smooth, no cuts.
// Beat: the swarm flutters outward (a spring, scaled by Feel) and settles back.
// Song sections (K.Moods, Conductor on): intro / breakdown / outro = few moths, the lamp dim, the
// camera drifting in close; a build tightens the swarm round the lamp; the drop floods the light
// and lifts the fog. Conductor off = base (today's look).
import { mat4, lerp, clamp, damp } from '../gfx/math.js';
import { scaleColor, mixColor } from '../gfx/color.js';
import { box, merge, GeoBuilder } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { ALBUM_PALETTES } from '../palette/library.js';
import * as K from '../kit/index.js';

const TAU = Math.PI * 2;
const HEAD_Y = 4.22;          // centre of the lamp's glass head
const MAX_MOTHS = 180;
const N_GRASS = 280;
const CAM_R = 13.5;           // camera orbit radius (grass keeps clear of it)

// flat around the lamp, gently rolling further out
const height = (x, z) => {
  const d = Math.hypot(x, z);
  const f = clamp((d - 14) / 30);   // dead flat out to the camera orbit, so the light pool decal never cuts the ground
  return K.fbm(x * 0.025, z * 0.025, { octaves: 3, seed: 11 }) * 3 * f - 0.4 * f;
};

// --- local indexed textures ---------------------------------------------------
/** Dark field: dithered secondary ramp with base-ramp flecks. 64x64. */
function fieldTex() {
  return K.makeIndexed(64, 64, (x, y) => {
    const n = K.blobNoise(x, y, 8, 3) * 0.7 + K.rnd(x, y, 5) * 0.3;
    if (K.rnd(x, y, 9) > 0.93) return R(0, 0);
    return K.dshade(1, 0.2 + n * 1.3, x, y);
  });
}
/** Round dithered disc of light (accent ramp): ground pool and halos. 64x64 so the dither stays fine when it's big. */
function poolTex() {
  return K.makeIndexed(64, 64, (x, y) => {
    const d = Math.hypot(x - 31.5, y - 31.5) / 32;
    if (d > 1 || d > 0.5 + K.bayer(x, y) * 0.5) return K.CLEAR;
    return K.dshade(2, 3.3 - d * 3, x, y);
  });
}
/** Lamp glass: warm accent panes with a dark frame line. 16x16. */
function glassTex() {
  return K.makeIndexed(16, 16, (x, y) => {
    if (x === 0 || x === 15 || y === 0 || y === 15) return R(0, 0);
    return K.dshade(2, 2.4 + (1 - Math.abs(y - 7.5) / 8) * 0.8, x, y);
  });
}
/** Moth seen edge-on: body in the centre, wings up (flip heightScale = wings down). 8x8. */
function mothTex() {
  return K.makeIndexed(8, 8, (x, y) => {
    const dx = Math.abs(x - 3.5);
    if (dx < 0.6 && y >= 2 && y <= 6) return R(0, 1);
    if (y <= 4 && dx < 0.5 + (4.5 - y) * 0.9) return K.dshade(3, 3 - dx * 0.3 - (4 - y) * 0.1, x, y);
    if (y === 5 && dx < 1.6) return R(3, 2);
    return K.CLEAR;
  });
}

// --- local geometry -----------------------------------------------------------
const at = (dx, dy, dz) => (p) => [p[0] + dx, p[1] + dy, p[2] + dz];
function lampIron() {
  const P = K.props.prism;
  const parts = [
    { geo: P(8, 0.24, 0.45) },                                   // plinth
    { geo: P(8, 0.16, 0.2), xf: at(0, 0.45, 0) },
    { geo: P(8, 0.07, 3.3, { uvRepeat: [1, 3] }), xf: at(0, 0.65, 0) },   // pole
    { geo: P(8, 0.12, 0.08), xf: at(0, 2.2, 0) },                 // ring halfway up
    { geo: P(8, 0.1, 0.12, { taper: 1.8 }), xf: at(0, 3.85, 0) }, // collar under the head
    { geo: box(0.4, 0.04, 0.4), xf: at(0, 3.97, 0) },             // head floor
    { geo: P(4, 0.32, 0.26, { taper: 0.15 }), xf: at(0, 4.47, 0) },// pyramid cap
    { geo: P(6, 0.03, 0.16), xf: at(0, 4.7, 0) },                 // finial
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ geo: box(0.035, 0.5, 0.035), xf: at(sx * 0.17, 4.22, sz * 0.17) });
  return merge(parts);
}
function lampGlass() { return box(0.3, 0.48, 0.3); }
function fenceGeo() {
  const parts = [];
  const posts = [[15, -8, 0.05], [17.2, -7.2, -0.12], [19.5, -6.6, 0.2], [21.6, -5.6, -0.06]];   // beyond the camera orbit
  posts.forEach(([x, z, lean], i) => {
    const h = 1.25 - (i === 2 ? 0.35 : 0);
    parts.push({ geo: K.props.prism(4, 0.07, h, { uvRepeat: [1, 1] }), xf: (p) => [p[0] + x + p[1] * lean, p[1] + height(x, z), p[2] + z] });
  });
  // two sagging rails between the first three posts (the last span is broken)
  for (let i = 0; i < 2; i++) {
    const [x0, z0] = posts[i], [x1, z1] = posts[i + 1], len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
    for (const y of [0.55, 1.0]) {
      const rail = box(len, 0.06, 0.04);
      parts.push({ geo: rail, xf: (p) => { const c = Math.cos(-ang), s = Math.sin(-ang); return [x0 + (x1 - x0) / 2 + p[0] * c - p[2] * s, p[1] + y - 0.06 * Math.cos(p[0] / len * Math.PI) + height(x0, z0), z0 + (z1 - z0) / 2 + p[0] * s + p[2] * c]; } });
    }
  }
  return merge(parts);
}
/** Centre-pivot quad (so a heightScale flip mirrors the wings around the body). */
function centreQuad() {
  return new GeoBuilder().quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();
}

export class MothLamp {
  static meta = { name: 'Moth Lamp' };
  static palette = ALBUM_PALETTES.inrainbows;

  init(r) {
    this.ground = new K.Terrain(r, { size: 170, cells: 40, height, uvScale: 0.35, shadeRange: [0.6, 1] });
    this.groundTex = r.texture(fieldTex());
    this.sky = new K.Sky(r, { stars: 90 });

    this.ironMesh = r.createMesh(lampIron());
    this.ironTex = r.texture(K.props.rust({ metal: 3, rust: 0, seed: 7 }));
    this.glassMesh = r.createMesh(lampGlass());
    this.glassTex = r.texture(glassTex());
    this.fenceMesh = r.createMesh(fenceGeo());
    this.fenceTex = r.texture(K.props.planks({ ramp: 0 }));

    // light: ground pool (decal), halos + a faint shaft (billboards), all additive
    this.poolTex = r.texture(poolTex());
    this.poolMesh = r.createMesh(K.decal(1, 1, 0));
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.halos = r.createInstances(2);
    this.shaftTex = r.texture(K.sprites.lightShaft({ ramp: 2 }));
    this.shaft = r.createInstances(1);

    // grass tufts across the field (lit by the lamp through per-instance shade)
    this.grassTex = r.texture(K.sprites.grass({ ramp: 1, seed: 21 }));
    this.grass = r.createInstances(N_GRASS);
    this.g = [];
    for (let i = 0; this.g.length < N_GRASS && i < N_GRASS * 3; i++) {
      const a = K.rand2(i, 1, 13) * TAU, d = 0.9 + Math.pow(K.rand2(i, 2, 13), 0.8) * 44;
      if (d > CAM_R - 7.5 && d < CAM_R + 4) continue;    // keep the camera's orbit (and the tufts right under the lens) clear
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      this.g.push({ x, z, y: height(x, z) - 0.05, d, s: 0.7 + K.rand2(i, 3, 13) * 0.6, hs: 1 + K.rand2(i, 4, 13) * 0.6, ph: i });
    }
    // dead trees standing far out at the fog's edge (silhouettes when the light floods)
    this.treeTex = r.texture(K.sprites.deadTree({ index: R(0, 0) }));
    this.trees = r.createInstances(6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + K.rand2(i, 1, 17) * 0.6, d = 38 + K.rand2(i, 2, 17) * 18, x = Math.cos(a) * d, z = Math.sin(a) * d;
      this.trees.set(i, x, height(x, z) - 0.3, z, 6 + K.rand2(i, 3, 17) * 4, 0, 0.8, i, 1.5);
    }
    this.trees.upload(6);

    // moths
    this.mothMesh = r.createMesh(centreQuad());
    this.mothTex = r.texture(mothTex());
    this.moths = r.createInstances(MAX_MOTHS);
    this.m = Array.from({ length: MAX_MOTHS }, (_, i) => ({
      rb: 0.35 + Math.pow(K.rand2(i, 1, 31), 0.7) * 0.65,            // normalised orbit radius
      a: K.rand2(i, 2, 31) * TAU,
      w: (1.2 + K.rand2(i, 3, 31) * 2.4) * (K.rand2(i, 4, 31) < 0.85 ? 1 : -1),
      y: (K.rand2(i, 5, 31) - 0.6) * 1.6,
      incl: (K.rand2(i, 6, 31) - 0.5) * 1.1,
      ph: K.rand2(i, 7, 31) * TAU,
      fr: 9 + K.rand2(i, 8, 31) * 6,
      sz: 0.22 + K.rand2(i, 9, 31) * 0.1,
      sd: [K.rand2(i, 10, 31) - 0.5, K.rand2(i, 11, 31) - 0.5, K.rand2(i, 12, 31) - 0.5],   // scatter direction
    }));
    this.dust = new K.Particles(r, 'dust', { count: 90, area: [7, 5, 7], yOffset: 0 });

    this.cam = new K.OrbitRig({ center: [0, 2.1, 0], radius: CAM_R, height: 1.3, bob: 0.25, pushIn: 0, idleSpeed: 0.012, activeSpeed: 0.028, bassBoost: 0, fovPunch: 0.6, nudge: 0.03, rollKick: 0, fov: 52, far: 220 });
    this.breath = new K.Breath({ beats: 8, period: 12 });
    this.scatter = new K.Spring(2.2); this.loose = 0; this.highE = 0; this.highS = 0;
    this.time = 0; this.k = 0; this.E = 0; this.flood = 0; this.count = 10; this.lamp = 0.4; this.poolR = 3;
    this.mat = mat4.create();
    this.col = { fog: [0, 0, 0], hi: [0, 0, 0], zen: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glass: [0, 0, 0], pool: [0, 0, 0], one: [1, 1, 1], grass: [0, 0, 0], lamp: [0, 0, 0] };
    // the lamp as a point light (Kit v7): it lights its own post from the head down, the ground and the fence
    this.lampLight = [{ pos: [0, HEAD_Y - 0.25, 0], color: this.col.lamp, radius: 8 }];
    // song sections: gates multiply the k fed into today's curves (clamped 0..1); swarmR scales the
    // orbit radius; camIn pulls the camera orbit in (a camera position: slow, eased twice)
    this.moods = new K.Moods({
      still:  { countGate: 0.3, lampGate: 0.45, floodGate: 0.6,  swarmR: 1.12, camIn: 2.5 },
      base:   { countGate: 1,   lampGate: 1,    floodGate: 1,    swarmR: 1,    camIn: 0 },
      gather: { countGate: 1.3, lampGate: 1.1,  floodGate: 1.05, swarmR: 0.72, camIn: 0.8 },
      full:   { countGate: 1.3, lampGate: 1.3,  floodGate: 1.65, swarmR: 0.9,  camIn: 0 },
    }, { dropEase: 4, slow: ['camIn'] });
    this.camIn = null; this.flCam = 0;
  }

  update(a, k, dt) {
    dt = Math.min(dt, 0.1);
    this.k = k; this.time += dt;
    const m = this.moods.update(a, dt);
    const t = this.time, d = K.drive(a, k);
    const b = this.breath.update(a, dt);
    // slow, big things: energy (how big the song is), smoothed again
    this.E = damp(this.E, clamp(a.energy ?? a.level ?? 0), 1.5, dt);
    const floodTarget = K.stage(clamp(k * m.floodGate), 0.62, 1) * lerp(0.45, 1, K.stage(this.E, 0.35, 0.8));
    this.flood = damp(this.flood, floodTarget, 1.4, dt);
    const fl = this.flood;

    // camera orbit: the flood's pull-in and the mood's camIn, both eased once more (never a step)
    if (this.camIn === null) { this.camIn = m.camIn; this.flCam = fl; }
    this.camIn = damp(this.camIn, m.camIn, 2, dt); this.flCam = damp(this.flCam, fl, 2, dt);
    this.cam.radius = lerp(CAM_R, CAM_R - 1.5, k * 0.5 + this.flCam * 0.5) - this.camIn;   // ≥ 9.5: the grass is clear out to 6
    this.cam.update(a, k, dt);
    this.cam.eye[1] += b * 0.35;
    this.ground.follow(this.cam.eye[0], this.cam.eye[2]);

    // lamp: dim and slightly uneven at idle, steady and bright with the swell, near max at the peak
    const waver = (1 - k) * 0.06 * (K.noise2(t * 0.7, 3.1) - 0.5) * 2;
    this.lamp = damp(this.lamp, lerp(0.42, 0.85, clamp(k * m.lampGate)) * (0.94 + 0.06 * b) + fl * 0.45 + waver + d.mid * 0.08, 0.5, dt);
    this.poolR = damp(this.poolR, lerp(3, 5.6, k) + fl * 1.8 + b * 0.3, 0.8, dt);   // ≤ 7.7: on the flat ground, clear of the lens

    // halos: a core glow at the head and a wide soft one that grows to the flood
    this.halos.set(0, 0, HEAD_Y - 0.45, 0, 1.1 + this.lamp * 0.6, 0, this.lamp * 0.9, 0, 1);
    this.halos.set(1, 0, HEAD_Y - 0.4, 0, 3.2 + k * 1.8 + fl * 3, 0, 0.1 + this.lamp * 0.2 + fl * 0.2, 0, 1);
    this.halos.upload(2);
    const sh = K.stage(k, 0.25, 0.9) * 0.3 + fl * 0.3 + 0.05;
    this.shaft.set(0, 0, 0, 0, 3.2 + fl * 3, 0, sh, 0, (HEAD_Y - 0.2) / (3.2 + fl * 3));
    this.shaft.upload(1);

    // grass: lit by the pool of light, lifted by the flood
    for (let i = 0; i < this.g.length; i++) {
      const G = this.g[i], lit = K.fadeOut(G.d, this.poolR * 0.25, this.poolR) * this.lamp;
      this.grass.set(i, G.x, G.y, G.z, G.s, 0, Math.min(1.05, 0.14 + lit * 0.9 + fl * 0.4), G.ph, G.hs);
    }
    this.grass.upload(this.g.length);

    // moth swarm: count grows one by one, orbit tightens with the swell, flutters on beats
    // (at Gentle the swarm only loosens slowly with the groove, never a burst per beat)
    if (d.beat) this.scatter.kick(1.6 * (0.4 + 0.6 * k) * d.beatMotion);
    this.loose = damp(this.loose, d.groove * (1 - d.beatMotion) * 0.3, 0.8, dt);
    const sc = Math.max(0, this.scatter.update(dt)) + this.loose;
    this.count = damp(this.count, lerp(10, MAX_MOTHS, K.stage(clamp(k * m.countGate), 0, 0.85)), 1.2, dt);
    const rad = lerp(3.3, 1.9, K.swell(k * 0.7 + fl * 0.3, 0, 1)) * m.swarmR, speed = lerp(0.7, 1.15, k);
    let n = 0;
    for (let i = 0; i < MAX_MOTHS; i++) {
      const pres = clamp(this.count - i);
      if (pres <= 0) break;
      const M = this.m[i];
      M.a += M.w * speed * dt / (0.6 + M.rb);
      const wob = 1 + 0.22 * Math.sin(t * 1.3 * Math.abs(M.w) + M.ph) + 0.08 * Math.sin(t * 7.1 + M.ph * 3);
      const rr = M.rb * rad * wob * (1 + sc * 0.9);
      const x = Math.cos(M.a) * rr + M.sd[0] * sc * 1.2;
      const z = Math.sin(M.a) * rr + M.sd[2] * sc * 1.2;
      const y = HEAD_Y - 0.1 + M.y * (0.7 + rad * 0.25) + Math.sin(M.a) * rr * M.incl + Math.sin(t * 2.3 + M.ph) * 0.12 + M.sd[1] * sc;
      const near = 1 - clamp((Math.hypot(x, y - HEAD_Y, z) - 0.3) / 3.5);
      const shade = (0.2 + near * 1.0 * this.lamp) * (1 - 0.4 * fl) + 0.08;   // darker against the flood
      const flap = Math.cos(t * M.fr + M.ph);
      this.moths.set(n++, x, y, z, M.sz * pres, 0, shade, 0, flap < 0 ? Math.min(-0.35, flap) : Math.max(0.35, flap));
    }
    this.moths.upload(n);

    this.highE = damp(this.highE, d.high, 0.6, dt); this.highS = lerp(this.highE, d.high, d.beatMotion);   // mote speed: eased unless Punchy
    this.dust.update(dt, [0, 2.4, 0], { amount: K.swell(k, 0.2, 0.75) + fl * 0.25, speed: 0.5 + this.highS * 0.5 });
  }

  render(r) {
    const { col, k } = this, P = this.pal, fl = this.flood;
    const dim = lerp(0.55, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    scaleColor(col.hi, P.color(R(3, 3)), 0.9);
    mixColor(col.fog, col.fog, col.hi, fl * 0.75);                 // fog lifts toward the light shade
    mixColor(col.zen, P.color(R(3, 0)), P.color(R(3, 2)), fl * 0.6);
    r.clear(col.fog);
    this.cam.apply(r);
    r.setFog(col.fog, 6, lerp(36, 58, k) + fl * 20);
    r.setLight([0.15, -1, 0.25], scaleColor(col.light, P.role('light'), lerp(0.18, 0.45, k) + fl * 0.5), scaleColor(col.amb, P.role('ambient'), lerp(0.3, 0.45, k) + fl * 0.45));
    const tintV = dim * (0.75 + fl * 0.5);
    scaleColor(col.lamp, P.role('glow'), this.lamp * 3 + fl * 1.2);
    this.lampLight[0].radius = 11 + this.poolR * 1.2 + fl * 8;   // reaches past the pool decal into the grass
    r.setPointLights(this.lampLight);
    col.tint[0] = col.tint[1] = col.tint[2] = tintV;

    this.sky.draw(r, this.cam.eye, { horizon: col.fog, zenith: col.zen, brightness: 1, starLevel: lerp(0.45, 0.25, k) * (1 - fl) });
    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    r.drawInstanced(this.quad, this.trees, { texture: this.treeTex, billboard: 1, tint: col.tint, unlit: true });
    r.draw(this.fenceMesh, mat4.identity(this.mat), { texture: this.fenceTex, tint: col.tint });
    r.draw(this.ironMesh, mat4.identity(this.mat), { texture: this.ironTex, tint: col.tint });
    const gl = lerp(0.6, 1.15, clamp(this.lamp));
    col.glass[0] = col.glass[1] = col.glass[2] = gl;
    r.draw(this.glassMesh, mat4.trs(this.mat, 0, HEAD_Y, 0, 0, 0, 0, 1, 1, 1), { texture: this.glassTex, unlit: true, tint: col.glass });
    const sway = 0.02 + this.breath.v * 0.02 + this.E * k * 0.04;
    r.drawInstanced(this.quad, this.grass, { texture: this.grassTex, billboard: 1, unlit: true, sway, tint: col.one });
    r.drawInstanced(this.mothMesh, this.moths, { texture: this.mothTex, billboard: 2, unlit: true, tint: col.one });

    // light, additive and last: ground pool, shaft, halos, motes
    const pr = this.poolR;
    col.pool[0] = col.pool[1] = col.pool[2] = clamp(0.2 + this.lamp * 0.45 + fl * 0.15, 0, 0.8);
    r.draw(this.poolMesh, mat4.trs(this.mat, 0, 0.06, 0, 0, 0, 0, pr * 2, 1, pr * 2), { texture: this.poolTex, unlit: true, additive: true, fog: false, fade: [40, 90], tint: col.pool });
    r.drawInstanced(this.quad, this.shaft, { texture: this.shaftTex, billboard: 1, unlit: true, additive: true, fog: false, fade: [40, 90], tint: col.one });
    r.drawInstanced(this.mothMesh, this.halos, { texture: this.poolTex, billboard: 2, unlit: true, additive: true, fog: false, fade: [40, 90], tint: col.one });
    this.dust.draw(r, { brightness: 0.4 + this.lamp * 0.5 });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.dust.dispose(r);
    [this.ironMesh, this.glassMesh, this.fenceMesh, this.poolMesh, this.quad, this.mothMesh].forEach((m) => m.dispose());
    [this.groundTex, this.ironTex, this.glassTex, this.fenceTex, this.poolTex, this.shaftTex, this.grassTex, this.treeTex, this.mothTex].forEach((t) => r.deleteTexture(t));
    [this.halos, this.shaft, this.grass, this.trees, this.moths].forEach((i) => i.dispose());
  }
}
