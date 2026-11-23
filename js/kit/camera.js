// Camera rigs. Every rig moves slowly when idle, faster with intensity + bass,
// and gets beat reactions for free: a vertical nudge, a roll kick and an FOV punch
// (all scaled by K.feel.motion, so they nearly vanish at Gentle reactivity).
// With the Conductor, a build-up slowly narrows the FOV (tension) and the drop releases it
// with a bigger punch.
//
//   const cam = new DollyRig(spline, { idleSpeed: 1, activeSpeed: 4 });
//   update:  cam.update(audio, k, dt)
//   render:  cam.apply(r)
import { lerp, damp } from '../gfx/math.js';
import { Spring, Envelope, feel } from './swell.js';

/** Closed Catmull-Rom spline through points [[x,y,z], ...]. */
export class Spline {
  constructor(points) {
    this.p = points;
    // approximate arc length so speed is in world units
    let len = 0, prev = this.at(0);
    const out = [0, 0, 0];
    for (let i = 1; i <= 400; i++) { this.at(i / 400, out); len += Math.hypot(out[0] - prev[0], out[1] - prev[1], out[2] - prev[2]); prev = out.slice(); }
    this.length = len;
  }
  /** t in [0,1) loops. */
  at(t, out = [0, 0, 0]) {
    const n = this.p.length, f = (((t % 1) + 1) % 1) * n, i = Math.floor(f), u = f - i;
    const p0 = this.p[(i - 1 + n) % n], p1 = this.p[i % n], p2 = this.p[(i + 1) % n], p3 = this.p[(i + 2) % n];
    const u2 = u * u, u3 = u2 * u;
    for (let k = 0; k < 3; k++) {
      out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
    }
    return out;
  }
}

export class CameraRig {
  constructor({ fov = 60, near = 0.1, far = 200, fovPunch = 5, nudge = 0.35, rollKick = 0.06, idleSpeed = 1, activeSpeed = 3, bassBoost = 2 } = {}) {
    Object.assign(this, { fov, near, far, fovPunch, nudgeAmt: nudge, rollKick, idleSpeed, activeSpeed, bassBoost });
    this.eye = [0, 2, 5];
    this.target = [0, 0, 0];
    this.roll = 0;
    this.speed = idleSpeed;
    this.time = 0;
    this.nudge = new Spring(6);
    this.rollSpring = new Spring(5);
    this.punch = new Envelope(0.18);
    this.tension = 0;   // 0..1, eased audio.build (narrows the FOV)
  }

  /** Common reactions; subclasses call super.update() then position the camera. */
  update(audio, k, dt) {
    this.time += dt;
    this.speed = damp(this.speed, lerp(this.idleSpeed, this.activeSpeed, k) + audio.bass * k * this.bassBoost, 0.35, dt);
    if (audio.beat && k > 0.05) {
      this.nudge.kick(this.nudgeAmt * 6 * k);
      this.rollSpring.kick((Math.random() < 0.5 ? -1 : 1) * this.rollKick * 6 * k);
      this.punch.trigger(k * feel.motion);   // a zoom is motion too: near-still at Gentle reactivity
    }
    if (audio.drop && k > 0.05) {
      this.punch.trigger(1.6 * k * feel.motion);
      this.nudge.kick(this.nudgeAmt * 9 * k * feel.motion);
    }
    const tt = (audio.build ?? 0) * k * (0.35 + 0.65 * feel.motion);
    this.tension = damp(this.tension, tt, tt > this.tension ? 1.2 : 0.35, dt);
    this.nudge.update(dt); this.rollSpring.update(dt); this.punch.update(dt);
  }

  apply(r) {
    const e = this.eye;
    _eye[0] = e[0]; _eye[1] = e[1] + this.nudge.x; _eye[2] = e[2];
    r.setCamera(_eye, this.target, { fov: this.fov * (1 - 0.07 * this.tension) + this.punch.v * this.fovPunch, near: this.near, far: this.far, roll: this.roll + this.rollSpring.x });
  }
}
const _eye = [0, 0, 0];

/** Follows a Spline (or any {at(t), length}), looking ahead along it. */
export class DollyRig extends CameraRig {
  constructor(path, { lookAhead = 6, heightOffset = 0, groundFn = null, minClearance = 1.5, ...o } = {}) {
    super(o);
    Object.assign(this, { path, lookAhead, heightOffset, groundFn, minClearance });
    this.s = 0;
  }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    this.s += this.speed * dt;
    const L = this.path.length;
    this.path.at(this.s / L, this.eye);
    this.path.at((this.s + this.lookAhead) / L, this.target);
    this.eye[1] += this.heightOffset; this.target[1] += this.heightOffset * 0.8;
    if (this.groundFn) {
      const g = this.groundFn(this.eye[0], this.eye[2]) + this.minClearance;
      if (this.eye[1] < g) this.eye[1] = g;
    }
  }
}

/** Circles a point; radius pulls in with bass. */
export class OrbitRig extends CameraRig {
  constructor({ center = [0, 0, 0], radius = 8, height = 2, bob = 0.6, pushIn = 1, ...o } = {}) {
    super({ idleSpeed: 0.08, activeSpeed: 0.25, bassBoost: 0.3, ...o });
    Object.assign(this, { center, radius, height, bob, pushIn });
    this.angle = 0; this.r = radius;
  }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    this.angle += this.speed * dt;
    this.r = damp(this.r, this.radius - audio.bass * k * this.pushIn, 0.2, dt);
    const c = this.center;
    this.eye[0] = c[0] + Math.sin(this.angle) * this.r;
    this.eye[1] = c[1] + this.height + Math.sin(this.time * 0.17) * this.bob;
    this.eye[2] = c[2] + Math.cos(this.angle) * this.r;
    this.target[0] = c[0]; this.target[1] = c[1]; this.target[2] = c[2];
  }
}

/** Fixed "security camera" that pans back and forth. */
export class SweepRig extends CameraRig {
  constructor({ position = [0, 4, 0], yaw = 0, yawRange = 0.8, pitch = -0.25, distance = 10, ...o } = {}) {
    super({ idleSpeed: 0.15, activeSpeed: 0.5, bassBoost: 0.2, ...o });
    Object.assign(this, { position, yaw0: yaw, yawRange, pitch, distance });
    this.phase = 0;
  }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    this.phase += this.speed * dt;
    const yaw = this.yaw0 + Math.sin(this.phase) * this.yawRange;
    const p = this.position;
    this.eye[0] = p[0]; this.eye[1] = p[1]; this.eye[2] = p[2];
    this.target[0] = p[0] + Math.sin(yaw) * this.distance;
    this.target[1] = p[1] + Math.sin(this.pitch) * this.distance;
    this.target[2] = p[2] - Math.cos(yaw) * this.distance;
  }
}

/**
 * Travels an endless path function s -> [x,y,z] (tunnels, roads, tracks).
 * rollFn(s) -> radians banks the camera with the path (e.g. PathFrames.rollAt), scaled by rollAmount.
 */
export class PathRig extends CameraRig {
  constructor(pathFn, { lookAhead = 6, rollFn = null, rollAmount = 0.85, ...o } = {}) {
    super(o);
    this.pathFn = pathFn; this.lookAhead = lookAhead; this.rollFn = rollFn; this.rollAmount = rollAmount; this.s = 0;
  }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    this.s += this.speed * dt;
    this.pathFn(this.s, this.eye);
    this.pathFn(this.s + this.lookAhead, this.target);
    if (this.rollFn) this.roll = this.rollFn(this.s) * this.rollAmount;
  }
}

// ---------------------------------------------------------------- Kit v5 rigs

/**
 * Kit v5: travels an ellipse (centre, rx, rz) at `speed` world units/s while looking
 * somewhere between the travel direction (lookMix 0) and a focus point (lookMix 1), so a
 * town, skyline or stage stays in view: a boat off a harbour, a slow fly-round of a castle.
 * bob = gentle vertical swell (two slow sines). focus may be a function (eye) => [x, y, z]
 * for a focus that slides with the camera (look along a long shore). From Fog Harbour's HarbourRig.
 *   this.cam = new K.OrbitFocusRig({ center: [0, 3.3, 30], rx: 58, rz: 16, focus: [0, 2, -12], lookMix: 0.7 });
 */
export class OrbitFocusRig extends CameraRig {
  constructor({ center = [0, 3, 0], rx = 30, rz = 15, focus = [0, 0, 0], lookMix = 0.7, lookDist = 12, lookDrop = 1, bob = 0.25, rollSway = 0.02, start = 0, ...o } = {}) {
    super({ nudge: 0.07, rollKick: 0.01, fovPunch: 1.2, idleSpeed: 1, activeSpeed: 2.3, bassBoost: 0.3, ...o });
    Object.assign(this, { center, rx, rz, focus, lookMix, lookDist, lookDrop, bob, rollSway });
    this.th = start; this._p = [0, 0, 0];
  }
  pos(th, out) { const c = this.center; out[0] = c[0] + Math.sin(th) * this.rx; out[1] = c[1]; out[2] = c[2] - Math.cos(th) * this.rz; return out; }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    const local = Math.hypot(this.rx * Math.cos(this.th), this.rz * Math.sin(this.th));   // keep speed in world units
    this.th += (this.speed * dt) / Math.max(1, local);
    const e = this.pos(this.th, this.eye), p = this.pos(this.th + 0.1, this._p);
    e[1] = this.center[1] + (Math.sin(this.time * 0.37) * 0.65 + Math.sin(this.time * 0.23 + 1) * 0.35) * this.bob;
    let ax = p[0] - e[0], az = p[2] - e[2]; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const F = typeof this.focus === 'function' ? this.focus(e) : this.focus;
    let fx = F[0] - e[0], fz = F[2] - e[2]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const m = this.lookMix;
    let dx = ax * (1 - m) + fx * m, dz = az * (1 - m) + fz * m; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    this.target[0] = e[0] + dx * this.lookDist; this.target[1] = e[1] - this.lookDrop; this.target[2] = e[2] + dz * this.lookDist;
    this.roll = Math.sin(this.time * 0.29) * this.rollSway;
  }
}

/**
 * Kit v5: near-still drift for quiet scenes. Glides out from `origin` along `yaw` up to
 * `reach` units and back again (1 - cos), with a small lateral sway and slow glances;
 * lookUp tilts the view (positive = looking up at something tall). Beat kicks are tiny by
 * default. From Under the Hull.
 *   this.cam = new K.DriftRig({ origin: [0, 1.65, 4], yaw: 0, reach: 22, lookUp: 3.5 });
 */
export class DriftRig extends CameraRig {
  constructor({ origin = [0, 1.7, 0], yaw = 0, reach = 20, sway = 1.1, glance = 0.16, lookUp = 0, lookDist = 20, ...o } = {}) {
    super({ nudge: 0.05, rollKick: 0.005, fovPunch: 0.6, idleSpeed: 0.02, activeSpeed: 0.06, bassBoost: 0.02, ...o });
    Object.assign(this, { origin, yaw, reach, sway, glance, lookUp, lookDist });
    this.phase = 0;
  }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    this.phase += this.speed * dt;
    const p = this.phase, o = this.origin, e = this.eye, t = this.target;
    const fwd = this.reach * 0.5 * (1 - Math.cos(p)), lat = Math.sin(p * 1.7) * this.sway;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    e[0] = o[0] + sy * fwd + cy * lat; e[1] = o[1]; e[2] = o[2] - cy * fwd + sy * lat;
    const yaw = this.yaw + Math.sin(this.time * 0.031) * this.glance + Math.sin(p * 0.9) * this.glance * 0.5;
    t[0] = e[0] + Math.sin(yaw) * this.lookDist; t[1] = e[1] + this.lookUp; t[2] = e[2] - Math.cos(yaw) * this.lookDist;
  }
}

/**
 * Kit v5: wanders a grid of cells (size `cell`) at walking height, one cell at a time, with
 * smooth quadratic corners. passable(gx, gz, dir) says whether cell (gx, gz) can be left in
 * dir (0 +x, 1 +z, 2 -x, 3 -z, as K.GRID_DIRS). Keep at least one exit per cell besides the
 * way in; at a dead end the rig turns back. Turns are rarer when calm (straightCalm) and
 * commoner as the song swells (straightActive). Aimless glances and a small step bob.
 * Build the cells around rig.eye / rig.gridCell. From the Backrooms.
 *   this.cam = new K.GridWanderRig((gx, gz, d) => this.canExit(gx, gz, d), { cell: 6, eyeHeight: 1.6 });
 */
export const GRID_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export class GridWanderRig extends CameraRig {
  constructor(passable, { cell = 6, eyeHeight = 1.6, start = [0, 0], dir = 0, straightCalm = 2.8, straightActive = 0.9, glance = 0.22, bob = 0.022, lookAhead = 3.2, ...o } = {}) {
    super({ nudge: 0.04, rollKick: 0.004, fovPunch: 0.8, idleSpeed: 0.9, activeSpeed: 2.2, bassBoost: 0.3, ...o });
    Object.assign(this, { passable, cell, eyeHeight, straightCalm, straightActive, glance, bobAmt: bob, lookAhead });
    this.pieces = []; this.s = 0; this.walk = 0; this.k = 0;
    this.look = [GRID_DIRS[dir][0], GRID_DIRS[dir][1]];
    this._a = [0, 0]; this._b = [0, 0];
    this._add(start[0], start[1], dir, dir);
  }
  _bez(p, t, out) {
    const u = 1 - t, A = u * u, B = 2 * u * t, C = t * t;
    out[0] = A * p.a[0] + B * p.c[0] + C * p.b[0]; out[1] = A * p.a[1] + B * p.c[1] + C * p.b[1];
    return out;
  }
  _add(gx, gz, din, dout) {
    const C = this.cell, cx = (gx + 0.5) * C, cz = (gz + 0.5) * C, a = GRID_DIRS[din], b = GRID_DIRS[dout];
    const p = { gx, gz, din, dout, a: [cx - a[0] * C / 2, cz - a[1] * C / 2], c: [cx, cz], b: [cx + b[0] * C / 2, cz + b[1] * C / 2] };
    let len = 0, px = p.a[0], pz = p.a[1]; const o = [0, 0];
    for (let i = 1; i <= 16; i++) { this._bez(p, i / 16, o); len += Math.hypot(o[0] - px, o[1] - pz); px = o[0]; pz = o[1]; }
    const last = this.pieces[this.pieces.length - 1];
    p.s0 = last ? last.s0 + last.len : 0; p.len = Math.max(1e-3, len);
    this.pieces.push(p);
  }
  _extend() {
    const last = this.pieces[this.pieces.length - 1], d = last.dout;
    const gx = last.gx + GRID_DIRS[d][0], gz = last.gz + GRID_DIRS[d][1];
    let opts = [[d, lerp(this.straightCalm, this.straightActive, this.k)], [(d + 1) % 4, 1], [(d + 3) % 4, 1]].filter(([e]) => this.passable(gx, gz, e));
    if (!opts.length) opts = [[(d + 2) % 4, 1]];                          // dead end: turn back
    let pick = Math.random() * opts.reduce((s, q) => s + q[1], 0), e = opts[0][0];
    for (const [oe, w] of opts) { if ((pick -= w) <= 0) { e = oe; break; } }
    this._add(gx, gz, d, e);
  }
  _at(s, out) {
    let p = this.pieces[this.pieces.length - 1];
    for (const q of this.pieces) if (s < q.s0 + q.len) { p = q; break; }
    return this._bez(p, Math.max(0, Math.min(1, (s - p.s0) / p.len)), out);
  }
  /** The cell the camera is in now: [gx, gz]. */
  get gridCell() { return [Math.floor(this.eye[0] / this.cell), Math.floor(this.eye[2] / this.cell)]; }
  update(audio, k, dt) {
    super.update(audio, k, dt);
    this.k = k;
    this.s += this.speed * dt;
    const ps = this.pieces;
    while (ps[ps.length - 1].s0 + ps[ps.length - 1].len < this.s + 14) this._extend();
    while (ps.length > 3 && ps[1].s0 + ps[1].len < this.s - 2) ps.shift();
    const e2 = this._at(this.s, this._a), t2 = this._at(this.s + this.lookAhead, this._b);
    let lx = t2[0] - e2[0], lz = t2[1] - e2[1]; const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
    this.look[0] = damp(this.look[0], lx, 0.45, dt); this.look[1] = damp(this.look[1], lz, 0.45, dt);
    const gl = (Math.sin(this.time * 0.21) + Math.sin(this.time * 0.083 + 1.3) * 0.73) * this.glance * lerp(0.8, 1.2, k);
    const yaw = Math.atan2(this.look[1], this.look[0]) + gl;
    this.walk += this.speed * dt * 2.1;
    const e = this.eye, t = this.target, bob = Math.sin(this.walk) * this.bobAmt * feel.motion;
    e[0] = e2[0]; e[1] = this.eyeHeight + bob; e[2] = e2[1];
    t[0] = e[0] + Math.cos(yaw) * 4; t[1] = this.eyeHeight - 0.12 + Math.sin(this.time * 0.13) * 0.08; t[2] = e[2] + Math.sin(yaw) * 4;
  }
}
