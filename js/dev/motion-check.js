// Dev only (never imported by the app): measures how smoothly a style's camera moves.
// Synthetic analyser audio (a beat every 0.5 s, scripted Conductor sections, a tempo that can
// switch on / off) goes through a real ShowControl with the given reactivity, so audio.shape,
// groove, beatMotion and K.feel are exactly what the app would produce. The style is stepped by
// hand (the pane is usually hidden, so requestAnimationFrame doesn't run).
//
//   const { motionCheck } = await import('/js/dev/motion-check.js');
//   await motionCheck(viz, { index: 6, frames: 1440, reactivity: 0,
//     sections: [['groove', 6], ['build', 6], ['drop', 6], ['breakdown', 6]], bpmToggleAt: 10 });
//   // → { maxAccel, maxFovStep, frames, maxAccelAt, maxFovStepAt }
//
// maxAccel: largest per-frame change of the eye's per-frame movement, |Δ(Δeye)| (units / frame²),
// read from the inverse of renderer.view after each render. maxFovStep: largest per-frame FOV
// change in degrees, from renderer.proj[5]. Gentle target: maxAccel ≤ 0.01, maxFovStep ≤ 0.3.
//
// motionCheckRig(rig, opts) runs the same audio through a bare camera rig (no style), for kit
// rigs that no environment uses yet (e.g. K.DriftRig, K.GridWanderRig).
import { ShowControl } from '../show/control.js';
import { feel } from '../kit/swell.js';
import { clamp, damp } from '../gfx/math.js';

const ENERGY = { intro: 0.3, groove: 0.55, build: 0.65, drop: 0.85, breakdown: 0.3, outro: 0.3, '': 0.5 };

/** Per-frame synthetic audio through a real ShowControl. Returns a step(i) → { audio, k, playing }. */
function audioSource({ sections = [['groove', 20]], bpmToggleAt = null, bpm = 120, reactivity = 0, k = 1, dt = 1 / 60 } = {}) {
  const show = new ShowControl();
  const s = { reactivity, strobeSafe: true, tempoLock: false, holdLevel: 0, blackoutTime: 2, flashAmount: 0 };
  const a = { level: 0, bass: 0, mid: 0, high: 0, energy: 0.5, beat: false, beatStrength: 2, beatPulse: 0, beatCount: 0, rmsDb: -20, rmsDbSmooth: -20,
    autoBpm: bpm, autoPhase: 0, autoBar: 0, section: '', build: 0, drop: false, songTime: 0 };
  let pulse = 0, nextBeat = 0, beatPos = 0, lastSection = null;
  const sectionAt = (t) => {
    let t0 = 0;
    for (const [name, len] of sections) { if (t < t0 + len) return [name, t - t0, len]; t0 += len; }
    const [name, len] = sections[sections.length - 1]; return [name, len, len];
  };
  return (i) => {
    const t = i * dt;
    const [section, into, len] = sectionAt(t);
    const tempo = bpmToggleAt != null && t >= bpmToggleAt ? (bpm > 0 ? 0 : 120) : bpm;
    a.beat = t >= nextBeat; if (a.beat) { nextBeat += 0.5; a.beatCount++; pulse = 1; } else pulse *= 0.88;
    a.beatPulse = pulse;
    a.energy = damp(a.energy, ENERGY[section] ?? 0.5, 1, dt);
    a.level = clamp(a.energy * 0.8 + pulse * 0.2); a.bass = clamp(a.energy * 0.6 + pulse * 0.4);
    a.mid = clamp(a.energy * 0.7 + Math.sin(t * 1.7) * 0.1); a.high = clamp(a.energy * 0.6 + Math.sin(t * 3.1) * 0.15);
    beatPos += dt * tempo / 60;
    a.autoBpm = tempo; a.autoPhase = tempo ? beatPos % 1 : 0; a.autoBar = tempo ? Math.floor(beatPos) % 4 : 0;
    a.section = section; a.songTime = t;
    a.build = section === 'build' ? clamp(into / len) : 0;
    a.drop = section === 'drop' && lastSection !== 'drop';
    lastSection = section;
    return show.process(a, k, true, dt, s);
  };
}

/** Tracks the largest |Δ(Δeye)| and FOV step. */
function tracker() {
  let prev = null, prevD = null, prevFov = null;
  const out = { maxAccel: 0, maxFovStep: 0, frames: 0, maxAccelAt: 0, maxFovStepAt: 0 };
  out.push = (eye, fov) => {
    if (prev) {
      const d = [eye[0] - prev[0], eye[1] - prev[1], eye[2] - prev[2]];
      if (prevD) {
        const acc = Math.hypot(d[0] - prevD[0], d[1] - prevD[1], d[2] - prevD[2]);
        if (acc > out.maxAccel) { out.maxAccel = acc; out.maxAccelAt = out.frames; }
      }
      prevD = d;
      const fs = Math.abs(fov - prevFov);
      if (fs > out.maxFovStep) { out.maxFovStep = fs; out.maxFovStepAt = out.frames; }
    }
    prev = eye.slice(); prevFov = fov; out.frames++;
  };
  return out;
}

const eyeFromView = (v) => {
  const t0 = v[12], t1 = v[13], t2 = v[14];
  return [-(v[0] * t0 + v[1] * t1 + v[2] * t2), -(v[4] * t0 + v[5] * t1 + v[6] * t2), -(v[8] * t0 + v[9] * t1 + v[10] * t2)];
};
const fovFromProj = (p) => 2 * Math.atan(1 / p[5]) * 180 / Math.PI;
const result = (tr) => ({ maxAccel: +tr.maxAccel.toFixed(5), maxFovStep: +tr.maxFovStep.toFixed(4), frames: tr.frames, maxAccelAt: tr.maxAccelAt, maxFovStepAt: tr.maxFovStepAt });

/**
 * Steps style `index` for `frames` frames and measures its camera.
 * Extra options: k (intensity, default 1), bpm (starting tempo, default 120; bpmToggleAt flips 0 ↔ 120),
 * shape (object merged over audio.shape every frame, e.g. { close: 1 }), present (also draw to the
 * screen each frame, default false), warmup (frames stepped before measuring, default 30).
 */
export async function motionCheck(viz, { index, frames = 1200, sections, bpmToggleAt = null, reactivity = 0, k = 1, bpm = 120, shape = null, present = false, warmup = 30 } = {}) {
  const { styles, renderer, s } = viz, P = renderer.params;
  if (!styles.styles[index]) throw new Error(`motionCheck: no style at index ${index}`);
  const saved = { auto: s.autoSwitch, feel: { ...feel }, fogScale: P.fogScale, weather: P.weather };
  s.autoSwitch = false;
  styles.cur = index; styles.next = -1; styles.enter(index);
  const step = audioSource({ sections, bpmToggleAt, bpm, reactivity, k });
  const tr = tracker(), dt = 1 / 60;
  try {
    for (let i = 0; i < frames + warmup; i++) {
      const { audio, k: kk, playing } = step(i);
      if (shape) Object.assign(audio.shape, shape);
      P.time = (P.time || 0) + dt;
      P.fogScale = clamp(audio.shape?.fog ?? 1, 0.75, 1.25); P.weather = audio.shape?.weather ?? 1;
      renderer.resetStats();
      styles.update(audio, kk, playing, dt, s);
      styles.render();
      if (present) renderer.present();
      if (i >= warmup) tr.push(eyeFromView(renderer.view), fovFromProj(renderer.proj));
    }
  } finally {
    s.autoSwitch = saved.auto; Object.assign(feel, saved.feel); P.fogScale = saved.fogScale; P.weather = saved.weather;
  }
  return result(tr);
}

/** Same measurement for a bare rig: rig.update(audio, k, dt) then rig.apply(stub renderer). */
export function motionCheckRig(rig, { frames = 1200, sections, bpmToggleAt = null, reactivity = 0, k = 1, bpm = 120, shape = null, warmup = 30 } = {}) {
  const saved = { ...feel };
  const step = audioSource({ sections, bpmToggleAt, bpm, reactivity, k });
  const tr = tracker(), dt = 1 / 60;
  let eye = null, fov = 0;
  const stub = { setCamera(e, _t, o = {}) { eye = e.slice(); fov = o.fov ?? 60; } };
  try {
    for (let i = 0; i < frames + warmup; i++) {
      const { audio, k: kk } = step(i);
      if (shape) Object.assign(audio.shape, shape);
      rig.update(audio, kk, dt); rig.apply(stub);
      if (i >= warmup) tr.push(eye, fov);
    }
  } finally { Object.assign(feel, saved); }
  return result(tr);
}
