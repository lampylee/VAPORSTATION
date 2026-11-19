// Path tools: tracks, corridors, roads and anything laid out along a curve,
// plus helpers for endless worlds (segments ahead of the camera, scatter around it).
//
//   const path = new K.PathFrames(new K.Spline(points), { step: 4, bank: 70 });
//   const road = r.createMesh(path.sweep([[-3.6, 0], [3.6, 0]], { uvTile: 8 }));
//   this.cam = new K.PathRig((s, out) => path.point(s, out, 0, 2), { rollFn: (s) => path.rollAt(s) });
//   path.placeEvery(22, (f, s) => K.orientedBox(g, f.p, ...));
import { GeoBuilder } from '../gfx/geometry.js';
import { lerp } from '../gfx/math.js';
import { Spline } from './camera.js';
import { rand2 } from './noise.js';
import { vadd, vsub, vdot, vcross, vnorm, vscale } from './shapes.js';

const wrap = (s, L) => ((s % L) + L) % L;

/**
 * A curve resampled at even arc-length steps, with a frame at every sample:
 *   { p: position, t: tangent, u: up, r: right, roll: bank angle, s: arc length }.
 * source: a Spline (or any { at(t) } with t in [0, 1)), or an array of points (closed spline).
 * bank: how much frames lean into turns (0 = flat, ~70 = racing track); bankMax caps the lean.
 * closed: false for open paths (sampled t in [0, 1]; s is clamped instead of wrapped).
 */
export class PathFrames {
  constructor(source, { step = 4, bank = 0, bankMax = 0.45, smooth = 8, closed = true, samples = 6000 } = {}) {
    const curve = Array.isArray(source) ? new Spline(source) : source;
    this.closed = closed;
    const D = samples, dense = [], cum = [0];
    for (let i = 0; i <= D; i++) dense.push(curve.at(closed ? i / D : Math.min(i / D, 0.999999), [0, 0, 0]));
    for (let i = 1; i <= D; i++) cum.push(cum[i - 1] + Math.hypot(...vsub(dense[i], dense[i - 1])));
    const L = cum[D], N = Math.max(2, Math.round(L / step)), ds = L / N, P = [];
    const count = closed ? N : N + 1;
    for (let i = 0, j = 0; i < count; i++) {
      const s = Math.min(i * ds, L);
      while (j < D - 1 && cum[j + 1] < s) j++;
      const u = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      P.push(vadd(dense[j], vsub(dense[j + 1], dense[j]), u));
    }
    const M = P.length, at = (i) => P[closed ? (i + M) % M : Math.max(0, Math.min(M - 1, i))];
    // horizontal curvature (points into the turn), smoothed
    const acc = P.map((p, i) => { const a = at(i - 1), b = at(i + 1); return [(a[0] - 2 * p[0] + b[0]) / (ds * ds), 0, (a[2] - 2 * p[2] + b[2]) / (ds * ds)]; });
    const sm = acc.map((_, i) => {
      const o = [0, 0, 0];
      for (let d = -smooth; d <= smooth; d++) { const q = acc[closed ? (i + d + M) % M : Math.max(0, Math.min(M - 1, i + d))]; o[0] += q[0]; o[2] += q[2]; }
      return vscale(o, 1 / (2 * smooth + 1));
    });
    this.frames = P.map((p, i) => {
      const t = vnorm(vsub(at(i + 1), at(i - 1)));
      let lean = [sm[i][0] * bank, 0, sm[i][2] * bank];
      const lm = Math.hypot(lean[0], lean[2]);
      if (lm > bankMax) lean = [lean[0] * bankMax / lm, 0, lean[2] * bankMax / lm];
      let u = vnorm([lean[0], 1, lean[2]]);
      const r = vnorm(vcross(t, u)); u = vcross(r, t);
      const flatR = vnorm(vcross(t, [0, 1, 0]));
      return { p, t, u, r, roll: Math.atan2(vdot(u, flatR), u[1]), s: i * ds };
    });
    this.N = N; this.ds = ds; this.length = L;
  }

  _idx(s) {
    if (this.closed) { const f = wrap(s, this.length) / this.ds, i = Math.floor(f); return [i % this.N, (i + 1) % this.N, f - i]; }
    const f = Math.max(0, Math.min(this.length, s)) / this.ds, i = Math.min(this.N - 1, Math.floor(f));
    return [i, i + 1, f - i];
  }

  /** Point at arc length s, offset x along the frame's right and y along its up. */
  point(s, out = [0, 0, 0], x = 0, y = 0) {
    const [i, j, u] = this._idx(s), A = this.frames[i], B = this.frames[j];
    for (let c = 0; c < 3; c++) {
      const a = A.p[c] + A.r[c] * x + A.u[c] * y, b = B.p[c] + B.r[c] * x + B.u[c] * y;
      out[c] = a + (b - a) * u;
    }
    return out;
  }

  /** Interpolated frame at arc length s: { p, t, u, r, roll }. */
  frameAt(s) {
    const [i, j, u] = this._idx(s), A = this.frames[i], B = this.frames[j];
    const t = vnorm(vadd(vscale(A.t, 1 - u), B.t, u)), up = vnorm(vadd(vscale(A.u, 1 - u), B.u, u)), r = vnorm(vcross(t, up));
    return { p: this.point(s), t, u: vcross(r, t), r, roll: lerp(A.roll, B.roll, u) };
  }

  rollAt(s) { const [i, j, u] = this._idx(s); return lerp(this.frames[i].roll, this.frames[j].roll, u); }

  /** Yaw angle (rotY for instances) that faces along the path at s. */
  yawAt(s) { const [i] = this._idx(s), t = this.frames[i].t; return Math.atan2(-t[0], -t[2]); }

  /**
   * Sweep a cross-section profile along the path: profile = [[x, y], ...] in frame
   * coordinates (x right, y up), consecutive points joined by quads. Faces point to the
   * left of each profile edge's direction (so [[-w,0],[w,0]] faces up: a road).
   * v runs along the path (one repeat per uvTile world units), u across the profile (per uvAcross units).
   * from/to (arc length) limit the sweep; default the whole path.
   */
  sweep(profile, { uvTile = 8, uvAcross = 0, from = 0, to = this.length, g = new GeoBuilder() } = {}) {
    const i0 = Math.round(from / this.ds), i1 = Math.round(to / this.ds);
    const plen = [0];
    for (let k = 1; k < profile.length; k++) plen.push(plen[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
    const total = plen[plen.length - 1] || 1, U = (k) => (uvAcross > 0 ? plen[k] / uvAcross : plen[k] / total);
    for (let i = i0; i < i1; i++) {
      const a = this.frames[this.closed ? i % this.N : Math.min(i, this.N)], b = this.frames[this.closed ? (i + 1) % this.N : Math.min(i + 1, this.N)];
      const va = (i * this.ds) / uvTile, vb = ((i + 1) * this.ds) / uvTile;
      for (let k = 0; k < profile.length - 1; k++) {
        const [x0, y0] = profile[k], [x1, y1] = profile[k + 1];
        const P = (f, x, y) => vadd(vadd(f.p, f.r, x), f.u, y);
        // edge normal in the frame: rotate the edge direction +90° (left side)
        const ex = x1 - x0, ey = y1 - y0, nl = [-ey, ex];
        const n = vnorm(vadd(vscale(a.r, nl[0]), a.u, nl[1]));
        const p0 = P(a, x0, y0), p1 = P(a, x1, y1), p2 = P(b, x1, y1), p3 = P(b, x0, y0);
        const want = vcross(vsub(p1, p0), vsub(p3, p0));
        if (vdot(want, n) >= 0) g.quad(p0, p1, p2, p3, [U(k), va], [U(k + 1), va], [U(k + 1), vb], [U(k), vb], n);
        else g.quad(p0, p3, p2, p1, [U(k), va], [U(k), vb], [U(k + 1), vb], [U(k + 1), va], n);
      }
    }
    return g.build();
  }

  /** Call fn(frame, s, n) every `spacing` world units (starting at `offset`). */
  placeEvery(spacing, fn, offset = 0) {
    let n = 0;
    for (let s = offset; s < this.length - (this.closed ? 1e-6 : -1e-6); s += spacing) fn(this.frameAt(s), s, n++);
  }
}

/**
 * Straight road / floor strip along -Z from zNear to zFar (zNear > zFar), width w.
 * Rows are short near the camera (less affine warping) and long far away.
 * v = -z / tile, so scroll it with uvOffset as the world moves.
 */
export function roadStrip({ width = 8, zNear = 12, zFar = -140, split = -24, nearStep = 2, farStep = 4, cols = 4, tile = 8, y = 0 } = {}) {
  const g = new GeoBuilder(), w = width / 2;
  for (let z = zNear; z > zFar;) {
    const step = z > split ? nearStep : farStep, za = z, zb = Math.max(zFar, z - step), va = -za / tile, vb = -zb / tile;
    for (let c = 0; c < cols; c++) {
      const u0 = c / cols, u1 = (c + 1) / cols, x0 = -w + u0 * width, x1 = -w + u1 * width;
      g.quad([x0, y, za], [x1, y, za], [x1, y, zb], [x0, y, zb], [u0, va], [u1, va], [u1, vb], [u0, vb], [0, 1, 0]);
    }
    z = zb;
  }
  return g.build();
}

/**
 * Endless worlds built from repeating segments: calls fn(index, start) for every
 * segment overlapping [s - behind, s + ahead]. Use `index` as a seed so each segment's
 * contents are deterministic (they look the same if you pass them again), and keep
 * `ahead` beyond the fog far distance so segments never pop in.
 *   K.forSegments(cam.s, { length: 12, ahead: 50 }, (i, z0) => placeShop(i, -z0));
 * period: optional repeat count, so index loops (i mod period) for long-run variety control.
 */
export function forSegments(s, { length, ahead, behind = length, period = 0 }, fn) {
  const i0 = Math.floor((s - behind) / length), i1 = Math.floor((s + ahead) / length);
  for (let i = i0; i <= i1; i++) fn(period ? ((i % period) + period) % period : i, i * length, i);
}

/**
 * Scatter on a jittered grid around a point (the camera): calls
 * fn(x, z, dist, gx, gz) for one candidate per cell within `radius` cells.
 * Positions are deterministic per cell (rand2), so things stay put as the camera moves.
 * Fade by `dist` (K.fadeOut) so nothing pops at the edge of the scatter.
 */
export function scatter(cx, cz, { cell = 4, radius = 10, seed = 0, jitter = 0.8 } = {}, fn) {
  const gx0 = Math.floor(cx / cell), gz0 = Math.floor(cz / cell);
  for (let gz = gz0 - radius; gz <= gz0 + radius; gz++) for (let gx = gx0 - radius; gx <= gx0 + radius; gx++) {
    const x = (gx + 0.5 + (rand2(gx, gz, seed) - 0.5) * jitter) * cell;
    const z = (gz + 0.5 + (rand2(gx, gz, seed + 1) - 0.5) * jitter) * cell;
    const d = Math.hypot(x - cx, z - cz);
    if (d <= radius * cell) fn(x, z, d, gx, gz);
  }
}

/** Positive modulo: repeat a coordinate every `period` units (loop scenery along an endless road). */
export const repeat = (x, period) => ((x % period) + period) % period;
