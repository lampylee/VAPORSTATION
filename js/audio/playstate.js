// Playing / silent state machine with hysteresis, and the master "intensity".
//
//  SILENT --(level >= threshold for startHold s)--> PLAYING
//  PLAYING --(level < threshold - hysteresis for stopHold s)--> SILENT
//
// Brief dips below the threshold while silent only *drain* the start timer
// (they don't reset it), so a sparse intro still counts as playing. Any sound
// above the lower threshold while playing resets the stop timer, so short
// pauses and quiet passages never flip the state.
//
// intensity: a linear ramp (up over rampUp s, down over rampDown s) passed
// through smoothstep, so it eases in and out and never jumps.
import { clamp, smoothstep } from '../gfx/math.js';

export class PlayState {
  constructor() {
    this.playing = false;
    this.aboveTime = 0;
    this.belowTime = 0;
    this.ramp = 0;         // linear 0..1
    this.intensity = 0;    // eased 0..1, use this for visuals
  }

  update(levelDb, dt, s) {
    if (!this.playing) {
      if (levelDb >= s.thresholdDb) this.aboveTime += dt;
      else this.aboveTime = Math.max(0, this.aboveTime - dt);
      if (this.aboveTime >= s.startHold) { this.playing = true; this.belowTime = 0; }
    } else {
      if (levelDb < s.thresholdDb - s.hysteresisDb) this.belowTime += dt;
      else this.belowTime = 0;
      if (this.belowTime >= s.stopHold) { this.playing = false; this.aboveTime = 0; }
    }
    const rate = this.playing ? dt / Math.max(0.05, s.rampUp) : -dt / Math.max(0.05, s.rampDown);
    this.ramp = clamp(this.ramp + rate);
    this.intensity = smoothstep(this.ramp);
    return this;
  }

  get label() {
    if (this.playing) return this.ramp < 1 ? 'PLAYING (swelling)' : 'PLAYING';
    return this.ramp > 0 ? 'SILENT (easing)' : 'SILENT (idle)';
  }
}
