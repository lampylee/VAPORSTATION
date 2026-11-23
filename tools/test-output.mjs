// Node test for js/show/output-logic.js: frame guard, health, screen pick.
// Usage: node tools/test-output.mjs   (exit code 1 on failure)
import { FrameGuard, health, pickScreen } from '../js/show/output-logic.js';

let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fails++;
};
const F = 1000 / 60;

// FrameGuard
// (a) two 60 Hz sources at several phase offsets -> one accept per frame
for (const off of [3, 8, 12]) {
  const g = new FrameGuard();
  let n = 0;
  for (let i = 0; i < 300; i++) {
    const t = 1000 + i * F;
    if (g.tick(t, 'laptop')) n++;
    if (g.tick(t + off, 'projector')) n++;
  }
  check(`two 60 Hz sources, offset ${off} ms`, Math.abs(n - 300) <= 1, `accepts=${n}`);
}
// (b) preferred source stops -> other takes over within 2 of its frames, then one per frame
{
  const h = new FrameGuard();
  let n = 0, first = -1;
  for (let i = 0; i < 300; i++) {
    const t = 1000 + i * F;
    if (i < 100) h.tick(t, 'laptop');
    const a = h.tick(t + 8, 'projector');
    if (i >= 100 && a) { n++; if (first < 0) first = i - 100; }
  }
  check('takeover within 2 frames', first >= 0 && first <= 1, `first=${first}`);
  check('then one accept per frame', Math.abs(n - 200) <= 1, `accepts=${n}`);
}
// (c) lone 144 Hz source
{
  const g = new FrameGuard();
  let n = 0;
  for (let i = 0; i < 300; i++) if (g.tick(1000 + i * (1000 / 144), 'projector') && i >= 60) n++;
  check('144 Hz interval converges', Math.abs(g.interval - 6.94) < 0.5, `interval=${g.interval.toFixed(2)}`);
  check('144 Hz one accept per call after warm-up', n === 240, `accepts=${n}`);
}
// (d) 60 Hz laptop + 144 Hz projector (projector preferred first)
{
  const g = new FrameGuard();
  let n = 0, lap = 0;
  const D = 1000 / 144;
  let nextLap = 1000 + 5;
  for (let i = 0; i < 1440; i++) {
    const t = 1000 + i * D;
    while (nextLap <= t) { if (g.tick(nextLap, 'laptop')) lap++; nextLap += F; }
    if (g.tick(t, 'projector') && i >= 60) n++;
  }
  check('projector drives, laptop adds nothing', lap === 0 && n === 1380, `proj=${n} laptop=${lap}`);
}
// (e) prefer(): 60 Hz laptop driving, then prefer('projector') at 144 Hz -> projector drives;
//     projector stops -> laptop takes over
{
  const g = new FrameGuard();
  const D = 1000 / 144;
  let t = 1000;
  for (let i = 0; i < 120; i++, t += F) g.tick(t, 'laptop');
  g.prefer('projector');
  let proj = 0, lap = 0, nextLap = t + 5, n = 0;
  for (let i = 0; i < 288; i++) {
    const tp = t + i * D;
    while (nextLap <= tp) { if (g.tick(nextLap, 'laptop')) lap++; nextLap += F; }
    if (g.tick(tp, 'projector')) proj++;
    n++;
  }
  check('prefer(projector): laptop adds nothing', lap === 0, `laptop=${lap}`);
  check('prefer(projector): projector accepted at its rate', proj >= n - 2, `proj=${proj}/${n}`);
  let first = -1, after = 0;
  for (let i = 0; i < 120; i++, nextLap += F) {
    if (g.tick(nextLap, 'laptop')) { after++; if (first < 0) first = i; }
  }
  check('projector stops -> laptop takes over', first >= 0 && first <= 1 && after >= 118, `first=${first} accepts=${after}`);
}
// (f) prefer() on a source that never ticks: the other source is not locked out
{
  const g = new FrameGuard();
  g.tick(1000, 'laptop'); g.prefer('projector');
  check('prefer(silent source) does not block others', g.tick(1000 + F, 'laptop') === true);
}

// health
const base = { wantLive: false, inputSignal: true, ctxLost: false, projector: 'none', governorTier: 0, broken: 0, audioSuspended: false };
const eq = (name, got, level, text) =>
  check(name, got.level === level && got.text === text, `${got.level}/${got.text}`);
eq('all clear', health(base), 'ok', 'OK');
eq('ctxLost + projector lost', health({ ...base, ctxLost: true, projector: 'lost' }), 'red', 'graphics reset');
eq('projector lost', health({ ...base, projector: 'lost' }), 'amber', 'projector lost');
eq('broken 1', health({ ...base, broken: 1 }), 'amber', '1 environment skipped');
eq('broken 2', health({ ...base, broken: 2 }), 'amber', '2 environments skipped');
eq('no input signal', health({ ...base, wantLive: true, inputSignal: false }), 'red', 'no input signal');
eq('red beats amber', health({ ...base, wantLive: true, inputSignal: false, governorTier: 2 }), 'red', 'no input signal');
eq('reduced detail', health({ ...base, governorTier: 1 }), 'amber', 'reduced detail');
eq('audio paused', health({ ...base, audioSuspended: true }), 'amber', 'audio paused');

// pickScreen
const S = (isPrimary, left) => ({ isPrimary, left, top: 0, width: 1920, height: 1080 });
{
  const sec = S(false, 1920);
  check('primary+secondary -> secondary', pickScreen([S(true, 0), sec], { left: 100, top: 100 }) === sec);
  const a = S(true, 0), b = S(true, 1920);
  check('no non-primary -> other screen', pickScreen([a, b], { left: 100, top: 100 }) === b);
  check('one screen -> null', pickScreen([S(true, 0)], { left: 0, top: 0 }) === null);
}

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('all output tests passed');
