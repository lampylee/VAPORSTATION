// Camera rigs. Every rig moves slowly when idle, faster with intensity + bass,
// and gets beat reactions for free: a vertical nudge, a roll kick and an FOV punch.
//
//   const cam = new DollyRig(spline, { idleSpeed: 1, activeSpeed: 4 });
//   update:  cam.update(audio, k, dt)
//   render:  cam.apply(r)
import { lerp, damp } from '../gfx/math.js';
import { Spring, Envelope } from './swell.js';

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
  }

  /** Common reactions; subclasses call super.update() then position the camera. */
  update(audio, k, dt) {
    this.time += dt;
    this.speed = damp(this.speed, lerp(this.idleSpeed, this.activeSpeed, k) + audio.bass * k * this.bassBoost, 0.35, dt);
    if (audio.beat && k > 0.05) {
      this.nudge.kick(this.nudgeAmt * 6 * k);
      this.rollSpring.kick((Math.random() < 0.5 ? -1 : 1) * this.rollKick * 6 * k);
      this.punch.trigger(k);
    }
    this.nudge.update(dt); this.rollSpring.update(dt); this.punch.update(dt);
  }

  apply(r) {
    const e = this.eye;
    _eye[0] = e[0]; _eye[1] = e[1] + this.nudge.x; _eye[2] = e[2];
    r.setCamera(_eye, this.target, { fov: this.fov + this.punch.v * this.fovPunch, near: this.near, far: this.far, roll: this.roll + this.rollSpring.x });
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
