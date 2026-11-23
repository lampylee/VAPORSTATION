// Pure logic for the projector output + operator view. No DOM access (runs under Node).

/**
 * Shared rAF gate: the laptop and projector windows call tick(now, source) from their own
 * rAF loops (arbitrary phase offsets); only one call per display frame returns true.
 * One source is "preferred" (the last accepted); the other is accepted only if the
 * preferred source has stalled (no call for > 1.5 x its interval).
 */
export class FrameGuard {
  constructor() {
    this._src = new Map();      // source -> { interval, prev }
    this._pref = null;
    this._lastAccepted = -Infinity;
  }
  /** Make `source` the preferred one now (the projector window on attach, so its rate drives). */
  prefer(source) {
    if (!this._src.has(source)) this._src.set(source, { interval: 16.7, prev: undefined });
    this._pref = source;
  }
  get interval() { return this._pref ? this._src.get(this._pref).interval : 16.7; }
  tick(now, source = 'default') {
    let st = this._src.get(source);
    if (!st) this._src.set(source, st = { interval: 16.7, prev: undefined });
    if (st.prev !== undefined) {
      const gap = Math.min(100, Math.max(4, now - st.prev));
      st.interval += (gap - st.interval) * 0.2;
    }
    st.prev = now;
    let ok;
    if (this._pref === null) ok = true;
    else if (source === this._pref) ok = now - this._lastAccepted >= 0.6 * st.interval;
    else {
      const p = this._src.get(this._pref);
      ok = p.prev === undefined || now - p.prev > 1.5 * p.interval;   // preferred never ticked: don't wait on it
    }
    if (ok) { this._pref = source; this._lastAccepted = now; }
    return ok;
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
