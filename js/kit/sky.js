// Sky: a low-poly dome following the camera with a dithered Gouraud gradient
// (horizon -> zenith), optional stars, a sun/moon disc and a ring of cloud sprites.
//
//   this.sky = new Sky(r, { stars: 120, moon: true, clouds: 8 });
//   render (first, right after clear + camera):
//     this.sky.draw(r, eye, { horizon: fogColor, zenith: this.pal.color(R(3, 0)), brightness })
//
// Pass your fog colour as the horizon so distant geometry melts into the sky.
// gradientTexture() is also exported for banded/indexed sky cards.
import { mat4 } from '../gfx/math.js';
import { GeoBuilder, octahedron, disc, merge } from '../gfx/geometry.js';
import { R } from '../palette/palette.js';
import { bandedSun } from '../gfx/textures.js';
import { cloud, glow } from './sprites.js';
import { rand2 } from './noise.js';

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Vertical gradient texture through palette indices (stops[0] at horizon). */
export function gradientTexture(stops, height = 64) {
  const W = 4, data = new Uint8Array(W * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < W; x++) {
    const t = (1 - y / (height - 1)) * (stops.length - 1); // row 0 = top = last stop
    const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
    data[y * W + x] = f > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? stops[i + 1] : stops[i];
  }
  return { data, width: W, height, indexed: true };
}

/**
 * Dome whose vertex colour holds the gradient weight t (0 at/below the horizon,
 * 1 at the zenith). Drawn with tint = zenith - horizon and emissive = horizon, so
 * colour = horizon + t * (zenith - horizon): a smooth gradient the composite
 * pass then dithers to 15-bit, like PS1 Gouraud skies.
 */
function dome(radius = 100, segs = 12, rings = 6, curve = 0.7) {
  const g = new GeoBuilder();
  const elev = (j) => -0.2 + (j / rings) * (Math.PI / 2 + 0.2);
  const P = (i, j) => { const a = (i / segs) * Math.PI * 2, e = elev(j); return [Math.cos(a) * Math.cos(e) * radius, Math.sin(e) * radius, Math.sin(a) * Math.cos(e) * radius]; };
  const T = (j) => { const t = Math.max(0, elev(j)) / (Math.PI / 2); return Math.pow(t, curve); };
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const A = [T(j), T(j), T(j)], B = [T(j + 1), T(j + 1), T(j + 1)], z = [0, 0], n = [0, -1, 0];
    g.tri(P(i, j), P(i + 1, j), P(i + 1, j + 1), z, z, z, n, [A, A, B]);
    g.tri(P(i, j), P(i + 1, j + 1), P(i, j + 1), z, z, z, n, [A, B, B]);
  }
  return g.build();
}

export class Sky {
  /**
   * moonTexture: your own indexed generator for the moon disc (e.g. sprites.moon({ ramp: 3 })),
   * instead of the default accent-ramp glow (or banded sun).
   */
  constructor(r, { stars = 0, starIndex = R(3, 3), moon = false, moonRamp = 2, moonDir = [0.3, 0.35, -1], moonSize = 9, banded = false, moonTexture = null, clouds = 0, cloudRamp = 3 } = {}) {
    this.dome = r.createMesh(dome());
    this.m = mat4.create();
    this._d = [0, 0, 0];
    if (stars) {
      const st = octahedron(1), parts = [];
      for (let i = 0; i < stars; i++) {
        const th = rand2(i, 1, 9) * Math.PI * 2, ph = Math.acos(0.15 + rand2(i, 2, 9) * 0.85), s = 0.25 + rand2(i, 3, 9) * 0.5;
        const P = [Math.sin(ph) * Math.cos(th) * 90, Math.cos(ph) * 90, Math.sin(ph) * Math.sin(th) * 90];
        parts.push({ geo: st, xf: (q) => [P[0] + q[0] * s, P[1] + q[1] * s, P[2] + q[2] * s] });
      }
      this.stars = r.createMesh(merge(parts));
      this.starIndex = starIndex;
    }
    if (moon) {
      this.moon = r.createMesh(disc(12, 1));
      this.moonTex = r.texture(moonTexture || (banded ? bandedSun({ ramp: moonRamp }) : glow({ ramp: moonRamp })));
      const l = Math.hypot(...moonDir);
      this.moonDir = moonDir.map((v) => v / l);
      this.moonSize = moonSize;
      this.moonGlow = !banded;
    }
    if (clouds) {
      this.cloudMesh = r.createMesh(new GeoBuilder().quad([-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build());
      this.cloudTex = r.texture(cloud({ ramp: cloudRamp }));
      this.cloudInst = r.createInstances(clouds);
      this.cloudData = Array.from({ length: clouds }, (_, i) => ({ a: (i / clouds) * Math.PI * 2 + rand2(i, 4) * 0.5, y: 8 + rand2(i, 5) * 14, s: 22 + rand2(i, 6) * 16 }));
    }
  }

  /**
   * Draw first in a scene. brightness ~ the factor you scale fog by (so horizon matches).
   * starLevel: star brightness (e.g. 0.3 + high * k). cloudDrift: radians offset over time.
   */
  draw(r, eye, { horizon = [0.1, 0.1, 0.15], zenith = [0, 0, 0.05], brightness = 1, starLevel = 0.6, moonScale = 1, cloudDrift = 0, starColor = null } = {}) {
    const m = this.m, b = [brightness, brightness, brightness], d = this._d;
    // horizon is expected to already include any dimming (it's usually the fog colour)
    d[0] = zenith[0] * brightness - horizon[0]; d[1] = zenith[1] * brightness - horizon[1]; d[2] = zenith[2] * brightness - horizon[2];
    mat4.trs(m, eye[0], eye[1], eye[2]);
    r.draw(this.dome, m, { unlit: true, fog: false, depthWrite: false, tint: d, emissive: horizon });
    if (this.stars && starLevel > 0.01) {
      const c = starColor || [starLevel, starLevel, starLevel];
      r.draw(this.stars, mat4.trs(m, eye[0], eye[1], eye[2], 0, r.params.time * 0.004, 0), { tint: [0, 0, 0], emissive: c, unlit: true, fog: false, additive: true });
    }
    if (this.moon) {
      const d = this.moonDir, D = 80;
      // face the camera: yaw/pitch towards the eye
      const yaw = Math.atan2(-d[0], -d[2]), pitch = Math.asin(d[1]);
      mat4.trs(m, eye[0] + d[0] * D, eye[1] + d[1] * D, eye[2] + d[2] * D, pitch, yaw, 0, this.moonSize * moonScale);
      r.draw(this.moon, m, { texture: this.moonTex, unlit: true, fog: false, depthWrite: false, tint: b });
    }
    if (this.cloudInst) {
      this.cloudData.forEach((c, i) => {
        const a = c.a + cloudDrift;
        this.cloudInst.set(i, eye[0] + Math.cos(a) * 70, eye[1] + c.y, eye[2] + Math.sin(a) * 70, c.s, 0, 1, 0, 0.5);
      });
      this.cloudInst.upload(this.cloudData.length);
      r.drawInstanced(this.cloudMesh, this.cloudInst, { texture: this.cloudTex, billboard: 1, unlit: true, fog: false, depthWrite: false, tint: b });
    }
  }

  dispose(r) {
    this.dome.dispose();
    this.stars?.dispose();
    if (this.moon) { this.moon.dispose(); r.deleteTexture(this.moonTex); }
    if (this.cloudInst) { this.cloudMesh.dispose(); r.deleteTexture(this.cloudTex); this.cloudInst.dispose(); }
  }
}
