// Infinite heightmap terrain. One grid mesh centred on the camera and snapped
// to its cell size, rebuilt from a height function when the camera crosses a
// cell. Texture UVs are in world space so the ground never slides.
// Vertex colours darken valleys / steep slopes (Gouraud).
//
//   this.ground = new Terrain(r, { height: (x, z) => fbm(x * 0.03, z * 0.03) * 8 });
//   update: this.ground.follow(eye[0], eye[2]);
//   render: this.ground.draw(r, { texture, tint });
//   place things: this.ground.heightAt(x, z)
import { mat4 } from '../gfx/math.js';

export class Terrain {
  constructor(r, { size = 120, cells = 40, height = () => 0, uvScale = 0.25, shadeRange = [0.55, 1], slopeShade = 0.6 } = {}) {
    Object.assign(this, { size, cells, heightFn: height, uvScale, shadeRange, slopeShade });
    this.step = size / cells;
    const n = cells * cells * 6;
    this.geo = {
      positions: new Float32Array(n * 3), normals: new Float32Array(n * 3),
      uvs: new Float32Array(n * 2), colors: new Float32Array(n * 3), count: n,
    };
    this.cx = NaN; this.cz = NaN;
    this._build(0, 0);
    this.mesh = r.createMesh(this.geo, true);
    this.m = mat4.create();
    // height range estimate for shading
  }

  heightAt(x, z) { return this.heightFn(x, z); }

  /** Re-centre on the camera (cheap unless a cell boundary was crossed). */
  follow(x, z) {
    const cx = Math.round(x / this.step), cz = Math.round(z / this.step);
    if (cx === this.cx && cz === this.cz) return;
    this._build(cx, cz);
    this.mesh.update(this.geo);
  }

  _build(cx, cz) {
    this.cx = cx; this.cz = cz;
    const { cells, step, heightFn: h, uvScale } = this, half = cells / 2;
    const N = cells + 1, H = new Float32Array(N * N);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = h((cx - half + i) * step, (cz - half + j) * step);
      H[j * N + i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    // fix the shading range on the first build so it never shifts (no popping)
    if (this.lo === undefined) { this.lo = lo; this.hi = hi; }
    lo = this.lo;
    const range = Math.max(1e-3, this.hi - lo), [s0, s1] = this.shadeRange;
    const g = this.geo, P = g.positions, Nn = g.normals, U = g.uvs, C = g.colors;
    let o = 0;
    const vert = (i, j) => {
      const x = (cx - half + i) * step, z = (cz - half + j) * step, y = H[j * N + i];
      const hl = H[j * N + Math.max(0, i - 1)], hr = H[j * N + Math.min(N - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * N + i], hu = H[Math.min(N - 1, j + 1) * N + i];
      let nx = hl - hr, ny = 2 * step, nz = hd - hu;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const shade = (s0 + (s1 - s0) * ((y - lo) / range)) * (1 - this.slopeShade * (1 - ny));
      P[o * 3] = x; P[o * 3 + 1] = y; P[o * 3 + 2] = z;
      Nn[o * 3] = nx; Nn[o * 3 + 1] = ny; Nn[o * 3 + 2] = nz;
      U[o * 2] = x * uvScale; U[o * 2 + 1] = z * uvScale;
      C[o * 3] = C[o * 3 + 1] = C[o * 3 + 2] = shade;
      o++;
    };
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
      vert(i, j); vert(i, j + 1); vert(i + 1, j + 1);
      vert(i, j); vert(i + 1, j + 1); vert(i + 1, j);
    }
  }

  draw(r, opts = {}) { r.draw(this.mesh, mat4.identity(this.m), opts); }

  dispose() { this.mesh.dispose(); }
}
