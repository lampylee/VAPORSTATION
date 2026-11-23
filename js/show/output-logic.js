// Pure logic for the projector output + operator view. No DOM access (runs under Node).

/**
 * Shared rAF gate: several windows call tick() from their own rAF loops; only one
 * call per display frame returns true. interval is an EMA of accepted frame gaps.
 */
export class FrameGuard {
  constructor() {
    this._interval = 16.7;
    this._last = -Infinity;
    this._prev = undefined;
  }
  get interval() { return this._interval; }
  tick(now) {
    // Learn the frame interval from the gap since the previous call from ANY caller.
    // Gaps under 4 ms are same-frame duplicates from another window (ignored); this lets a
    // lone 144 Hz caller converge even though the stale interval would reject some frames.
    if (this._prev !== undefined) {
      const raw = now - this._prev;
      if (raw >= 4) this._interval += (Math.min(100, raw) - this._interval) * 0.2;
    }
    this._prev = now;
    if (now - this._last < 0.6 * this._interval) return false;
    this._last = now;
    return true;
  }
}

/** Single status line for the operator view. Worst level wins; first match within a level. */
export function health({ wantLive, inputSignal, ctxLost, projector, governorTier, broken, audioSuspended }) {
  if (ctxLost) return { level: 'red', text: 'graphics reset' };
  if (wantLive && !inputSignal) return { level: 'red', text: 'no input signal' };
  if (projector === 'lost') return { level: 'amber', text: 'projector lost' };
  if (governorTier > 0) return { level: 'amber', text: 'reduced detail' };
  if (broken > 0) return { level: 'amber', text: `${broken} ${broken === 1 ? 'environment' : 'environments'} skipped` };
  if (audioSuspended) return { level: 'amber', text: 'audio paused' };
  return { level: 'ok', text: 'OK' };
}

/** Pick the screen to put the projector window on: first non-primary, else the one not containing `here`. */
export function pickScreen(screens, here) {
  if (!screens || screens.length < 2) return null;
  const other = screens.find(s => !s.isPrimary);
  if (other) return other;
  const contains = s => here.left >= s.left && here.left < s.left + s.width &&
    here.top >= s.top && here.top < s.top + s.height;
  return screens.find(s => !contains(s)) || null;
}
