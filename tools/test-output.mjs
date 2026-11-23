// Node test for js/show/output-logic.js: frame guard, health, screen pick.
// Usage: node tools/test-output.mjs   (exit code 1 on failure)
import { FrameGuard, health, pickScreen } from '../js/show/output-logic.js';

let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fails++;
};
const F = 1000 / 60;

// FrameGuard: two windows at 60 Hz, 3 ms offset -> one true per frame
{
  const g = new FrameGuard();
  let trues = 0;
  for (let i = 0; i < 300; i++) {
    const t = 1000 + i * F;
    if (g.tick(t)) trues++;
    if (g.tick(t + 3)) trues++;
  }
  check('two windows, one true per frame', Math.abs(trues - 300) <= 1, `trues=${trues}`);
}
// one caller stops after 100 frames; the other still runs every frame
{
  const g = new FrameGuard();
  let late = 0;
  for (let i = 0; i < 300; i++) {
    const t = 1000 + i * F;
    const a = g.tick(t);
    const b = i < 100 ? g.tick(t + 3) : false;
    if (i >= 100 && a) late++;
    void b;
  }
  check('survivor still gets every frame', Math.abs(late - 200) <= 1, `late=${late}`);
}
// 144 Hz converges
{
  const g = new FrameGuard();
  for (let i = 0; i < 60; i++) g.tick(1000 + i * (1000 / 144));
  check('144 Hz interval converges', Math.abs(g.interval - 6.94) < 0.5, `interval=${g.interval.toFixed(2)}`);
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
