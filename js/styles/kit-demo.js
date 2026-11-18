// KIT DEMO — reference environment that uses every world-kit piece.
// Copy this file as the starting point for a new environment.
//
//   sky dome + stars + moon + clouds     K.Sky
//   rolling infinite hills               K.Terrain + K.fbm
//   instanced billboard pines & bushes   r.drawInstanced(..., { billboard: 1, sway })
//   street lamps that switch on one by one as the band swells   K.stage
//   chain-link fence with see-through holes                     K.sprites.chainLink
//   snow when idle, fireflies when playing                      K.Particles
//   camera dolly along a looping spline, hugging the ground     K.DollyRig
//
// Intensity: idle = dim dusk, slow drift, snow. Playing = lamps on, faster
// flight, trees sway with bass, fireflies, moon pulses on beats.
import { mat4, lerp } from '../gfx/math.js';
import { scaleColor } from '../gfx/color.js';
import { blotch } from '../gfx/textures.js';
import { R, fromKeys } from '../palette/palette.js';
import * as K from '../kit/index.js';

const TREE_CELL = 5, TREE_RADIUS = 9; // cells around the camera to populate

export class KitDemo {
  static meta = { name: 'Kit demo', hidden: true };
  static palette = fromKeys('kitdemo', 'Kit Demo', ['#6a7a4a', '#3f7a46', '#ffc36a', '#1c2438']);

  init(r) {
    // ---- world shape
    const height = (x, z) => K.fbm(x * 0.02, z * 0.02, { octaves: 3 }) * 14 + K.ridged(x * 0.008, z * 0.008) * 10 - 8;
    this.ground = new K.Terrain(r, { size: 140, cells: 44, height, uvScale: 0.35 });
    this.groundTex = r.texture(blotch({ ramp: 0, scale: 8, seed: 3 }));
    this.sky = new K.Sky(r, { stars: 140, moon: true, moonDir: [0.4, 0.3, -1], clouds: 7 });

    // ---- camera path: a wobbly loop, lifted above the ground
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, rad = 70 + Math.sin(i * 2.3) * 18;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      pts.push([x, height(x, z) + 3, z]);
    }
    this.path = new K.Spline(pts);
    this.cam = new K.DollyRig(this.path, { idleSpeed: 2, activeSpeed: 7, bassBoost: 4, lookAhead: 8, groundFn: height, minClearance: 2, fov: 64 });

    // ---- foliage (instanced billboards)
    this.quad = r.createMesh(K.billboardQuad(1, 1));
    this.pineTex = r.texture(K.sprites.pine({ ramp: 1 }));
    this.bushTex = r.texture(K.sprites.bush({ ramp: 1 }));
    this.trees = r.createInstances(600);
    this.bushes = r.createInstances(400);

    // ---- lamps + fence placed along the path
    this.lampMesh = r.createMesh(K.props.lampPost(4.2, 0.9));
    this.poleTex = r.texture(blotch({ ramp: 3, scale: 4, minShade: 1 }));
    this.glowTex = r.texture(K.sprites.glow({ ramp: 2 }));
    this.lampInst = r.createInstances(64);
    this.glowInst = r.createInstances(64);
    this.lamps = [];
    const p = [0, 0, 0], q = [0, 0, 0], L = this.path.length;
    for (let s = 0, i = 0; s < L && i < 64; s += 14, i++) {
      this.path.at(s / L, p); this.path.at((s + 1) / L, q);
      let tx = q[0] - p[0], tz = q[2] - p[2]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const nx = -tz, nz = tx, side = i % 2 ? 1 : -1; // alternate sides of the path
      const x = p[0] + nx * 4 * side, z = p[2] + nz * 4 * side, y = height(x, z);
      const rot = Math.atan2(nz * side, -nx * side); // arm points back at the path
      this.lamps.push({ x, y, z, rot, hx: x - nx * side * 0.9, hz: z - nz * side * 0.9 });
    }
    this.fenceMesh = r.createMesh(K.props.fence(4, 1.8, 2));
    this.fenceTex = r.texture(K.sprites.chainLink({ index: R(3, 3), dark: R(3, 2) }));
    this.fenceInst = r.createInstances(80);
    let n = 0;
    for (let s = 0; s < L * 0.45 && n < 80; s += 4, n++) {
      this.path.at(s / L, p); this.path.at((s + 4) / L, q);
      const mx = (p[0] + q[0]) / 2, mz = (p[2] + q[2]) / 2;
      let tx = q[0] - p[0], tz = q[2] - p[2]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const x = mx + tz * 6, z = mz - tx * 6;
      this.fenceInst.set(n, x, height(x, z) - 0.1, z, 1, Math.atan2(-tz, tx), 1, 0, 1);
    }
    this.fenceInst.upload(n);

    // ---- weather
    this.snow = new K.Particles(r, 'snow');
    this.flies = new K.Particles(r, 'fireflies');

    this.moonPulse = new K.Envelope(0.25);
    this.time = 0; this.k = 0; this.a = null;
    this.col = { fog: [0, 0, 0], tint: [0, 0, 0], light: [0, 0, 0], amb: [0, 0, 0], glow: [0, 0, 0] };
  }

  update(a, k, dt) {
    this.a = a; this.k = k; this.time += dt;
    const d = K.drive(a, k);
    this.cam.update(a, k, dt);
    this.ground.follow(this.cam.eye[0], this.cam.eye[2]);
    if (d.beat) this.moonPulse.trigger(k);
    this.moonPulse.update(dt);
    const eye = this.cam.eye;
    this.snow.update(dt, eye, { amount: K.swell(k, 0.7, 0.15), speed: 1 + d.level });
    this.flies.update(dt, [eye[0], this.ground.heightAt(eye[0], eye[2]) + 2, eye[2]], { amount: k, speed: 1 + d.high * 2 });
    this._scatter();
  }

  /** Deterministic foliage in world cells around the camera (infinite forest). */
  _scatter() {
    const e = this.cam.eye, cx = Math.floor(e[0] / TREE_CELL), cz = Math.floor(e[2] / TREE_CELL);
    let nt = 0, nb = 0;
    for (let j = -TREE_RADIUS; j <= TREE_RADIUS; j++) for (let i = -TREE_RADIUS; i <= TREE_RADIUS; i++) {
      const gx = cx + i, gz = cz + j, h = K.rand2(gx, gz, 1);
      const x = (gx + K.rand2(gx, gz, 2)) * TREE_CELL, z = (gz + K.rand2(gx, gz, 3)) * TREE_CELL;
      // keep the flight path clear: skip cells near the loop radius band
      const rr = Math.hypot(x, z);
      if (Math.abs(rr - 70) < 9 + Math.sin(Math.atan2(z, x) * 2.3) * 2) continue;
      const y = this.ground.heightAt(x, z);
      if (h < 0.42 && nt < this.trees.max) {
        const s = 3.5 + K.rand2(gx, gz, 4) * 3;
        this.trees.set(nt++, x, y - 0.2, z, s * 0.55, 0, 0.8 + K.rand2(gx, gz, 5) * 0.4, h * 50, 1 / 0.55 * 1.0);
      } else if (h > 0.8 && nb < this.bushes.max) {
        this.bushes.set(nb++, x, y - 0.1, z, 1.6, 0, 0.9, h * 30, 0.75);
      }
    }
    this.trees.upload(nt); this.bushes.upload(nb);
  }

  render(r) {
    const { col, k } = this, a = this.a, P = this.pal, d = K.drive(a, k), eye = this.cam.eye;
    const dim = lerp(0.65, 1, k);
    scaleColor(col.fog, P.role('fog'), dim);
    r.clear(col.fog);
    this.cam.apply(r);

    this.sky.draw(r, eye, { horizon: col.fog, zenith: P.color(R(3, 0)), brightness: dim, starLevel: 0.25 + d.high * 0.8, moonScale: 1 + this.moonPulse.v * 0.15, cloudDrift: this.time * 0.01 });

    r.setFog(col.fog, 8, lerp(45, 70, k));
    r.setLight([-0.4, -0.7, 0.5], scaleColor(col.light, P.role('light'), lerp(0.45, 0.85, k)), scaleColor(col.amb, P.role('ambient'), 0.45));
    col.tint[0] = col.tint[1] = col.tint[2] = dim;

    this.ground.draw(r, { texture: this.groundTex, tint: col.tint });
    const sway = 0.02 + d.bass * 0.12;
    r.drawInstanced(this.quad, this.trees, { texture: this.pineTex, billboard: 1, sway, tint: col.tint });
    r.drawInstanced(this.quad, this.bushes, { texture: this.bushTex, billboard: 1, sway: sway * 0.5, tint: col.tint });
    r.drawInstanced(this.fenceMesh, this.fenceInst, { texture: this.fenceTex, tint: col.tint });

    // lamps switch on one after another as the band swells in
    const nl = this.lamps.length;
    this.lamps.forEach((l, i) => {
      const on = K.stage(k, 0.05 + (i / nl) * 0.6, 0.15 + (i / nl) * 0.6);
      const flick = on * (0.85 + 0.15 * Math.sin(this.time * 13 + i * 7)) * (1 + d.high * 0.6);
      this.lampInst.set(i, l.x, l.y, l.z, 1, l.rot, 1, 0, 1);
      this.glowInst.set(i, l.hx, l.y + 3.85, l.hz, 1.6 + d.pulse * 0.8, 0, flick, 0, 1);
    });
    this.lampInst.upload(nl); this.glowInst.upload(nl);
    r.drawInstanced(this.lampMesh, this.lampInst, { texture: this.poleTex, tint: col.tint });
    r.drawInstanced(this.quad, this.glowInst, { texture: this.glowTex, billboard: 2, unlit: true, additive: true, tint: [1, 1, 1] });

    this.snow.draw(r, { brightness: dim * 0.9 });
    this.flies.draw(r, { brightness: k });
  }

  dispose(r) {
    this.ground.dispose(); this.sky.dispose(r); this.snow.dispose(r); this.flies.dispose(r);
    [this.quad, this.lampMesh, this.fenceMesh].forEach((m) => m.dispose());
    [this.groundTex, this.pineTex, this.bushTex, this.poleTex, this.glowTex, this.fenceTex].forEach((t) => r.deleteTexture(t));
    [this.trees, this.bushes, this.lampInst, this.glowInst, this.fenceInst].forEach((i) => i.dispose());
  }
}
