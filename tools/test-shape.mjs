// Node test for js/show/shape.js and the groove / beatMotion outputs of ShowControl.
// Usage: node tools/test-shape.mjs   (exit code 1 on failure)
import { SongShape, SHAPE_TABLE } from '../js/show/shape.js';
import { ShowControl } from '../js/show/control.js';
import { feel } from '../js/kit/swell.js';
import { Moods } from '../js/kit/moods.js';
import { DEFAULTS } from '../js/settings.js';

const DT = 1 / 60;
let failed = 0, passed = 0;
function check(name, ok, info = '') {
  if (ok) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (info ? '  ' + info : '')); }
}
const F = ['close', 'pace', 'fog', 'weather'];
const near = (a, b, e) => Math.abs(a - b) <= e;

// neutral when section is ''
{
  const sh = new SongShape(); let o;
  for (let i = 0; i < 600; i++) o = sh.update({ section: '' }, DT);
  const row = SHAPE_TABLE[''];
  check('neutral when section is empty', F.every((f) => near(o[f], row[f], 1e-3)), JSON.stringify(o));
}

// eases, never steps
{
  const sh = new SongShape();
  let o;
  for (let i = 0; i < 600; i++) o = sh.update({ section: 'groove' }, DT);
  const prev = {}; F.forEach((f) => prev[f] = o[f]);
  let worst = 0, bad = '', settled = true;
  for (let i = 0; i < 600; i++) {
    o = sh.update({ section: 'drop' }, DT);
    F.forEach((f) => {
      const lim = Math.abs(SHAPE_TABLE.drop[f] - SHAPE_TABLE.groove[f]) * DT / 2 * 1.01;
      const d = Math.abs(o[f] - prev[f]); prev[f] = o[f];
      if (d > lim + 1e-12) { worst++; bad = `${f} d=${d} lim=${lim}`; }
      if (i === 359 && Math.abs(o[f] - SHAPE_TABLE.drop[f]) > 0.05 * Math.abs(SHAPE_TABLE.drop[f] - SHAPE_TABLE.groove[f]) + 1e-9) settled = false;
    });
  }
  check('eases, never steps', worst === 0, bad);
  check('within 5% of the drop row after 6 s', settled);
}

// alternating sections stay within bounds
{
  const sh = new SongShape(); let ok = true;
  for (let i = 0; i < 3600; i++) {
    const sec = Math.floor(i * DT / 4) % 2 ? 'build' : 'groove';
    const o = sh.update({ section: sec }, DT);
    for (const f of F) {
      const a = SHAPE_TABLE.groove[f], b = SHAPE_TABLE.build[f];
      if (o[f] < Math.min(a, b) - 1e-9 || o[f] > Math.max(a, b) + 1e-9) ok = false;
    }
  }
  check('alternating sections stay within table bounds', ok);
}

// phrase ticks
{
  const sh = new SongShape(); const p0 = sh.update({ section: 'groove', bpm: 120, bar: 0 }, DT).phrase;
  let o, t = 0;
  for (let i = 0; i < 40 * 60; i++, t += DT) {
    const bar = Math.floor(t * 2) & 3;
    o = sh.update({ section: 'groove', bpm: 120, bar }, DT);
  }
  check('phrase ticks every 8 bars (bpm 120)', o.phrase - p0 === 2, 'got ' + (o.phrase - p0));
  const s2 = new SongShape(); const q0 = s2.update({ section: 'groove', bpm: 0, bar: 0 }, DT).phrase;
  for (let i = 0; i < 40 * 60; i++) o = s2.update({ section: 'groove', bpm: 0, bar: 0 }, DT);
  check('phrase ticks every 16 s (bpm 0)', o.phrase - q0 === 2, 'got ' + (o.phrase - q0));
}

// phrase counter restarts when the section changes
{
  const sh = new SongShape(); const p0 = sh.update({ section: 'groove', bpm: 0, bar: 0 }, DT).phrase;
  let o;
  for (let i = 0; i < 15 * 60; i++) o = sh.update({ section: 'groove', bpm: 0, bar: 0 }, DT);
  for (let i = 0; i < 90; i++) o = sh.update({ section: 'build', bpm: 0, bar: 0 }, DT);   // 16.5 s total, 1.5 s into build
  check('phrase does not tick at 16 s total after a section change', o.phrase === p0, 'phrase +' + (o.phrase - p0));
  for (let i = 0; i < 14 * 60; i++) o = sh.update({ section: 'build', bpm: 0, bar: 0 }, DT);   // 15.5 s after the switch
  check('phrase has not ticked just before 16 s after the switch', o.phrase === p0);
  for (let i = 0; i < 60; i++) o = sh.update({ section: 'build', bpm: 0, bar: 0 }, DT);       // 16.5 s after the switch
  check('phrase ticks 16 s after the switch', o.phrase === p0 + 1, 'phrase +' + (o.phrase - p0));
}

// THUMB_AUDIO shaped input
{
  let o, threw = false;
  try { o = new SongShape().update({ level: 0, beat: false, bpm: 0, bar: 0 }, DT); } catch (e) { threw = true; }
  check('THUMB_AUDIO-shaped input is neutral', !threw && F.every((f) => near(o[f], SHAPE_TABLE[''][f], 1e-3)));
}

// returns same object
{
  const sh = new SongShape();
  check('returns the same object every frame', sh.update({ section: 'drop' }, DT) === sh.update({ section: 'drop' }, DT));
}

// groove has no step when bpm appears
{
  const sc = new ShowControl(); const s = { ...DEFAULTS, reactivity: 1 };
  const base = { level: 0.1, bass: 0.1, mid: 0.1, high: 0.1, energy: 0.1, beat: false };
  let prev = 0, worst = 0, ph = 0;
  for (let i = 0; i < 480; i++) {
    const a = { ...base };
    if (i >= 240) { a.autoBpm = 120; a.autoPhase = ph; a.autoBar = 0; ph = (ph + DT * 2) % 1; }
    a.beat = false;   // beatPulse stays 0: only the cos <-> pulse source switch is measured
    const out = sc.process(a, 1, true, DT, s).audio;
    if (i > 0) worst = Math.max(worst, Math.abs(out.groove - prev));
    prev = out.groove;
  }
  check('groove has no step when bpm appears', worst <= 0.1, 'max step ' + worst.toFixed(3));
}

// beatMotion per profile
for (const [r, want] of [[0, 0], [0.5, 0.4], [1, 1]]) {
  const sc = new ShowControl(); const s = { ...DEFAULTS, reactivity: r };
  let out;
  for (let i = 0; i < 300; i++) out = sc.process({ level: 0.1, bass: 0.1, mid: 0.1, high: 0.1, beat: false }, 1, true, DT, s).audio;
  check(`beatMotion at reactivity ${r}`, near(out.beatMotion, want, 0.02) && feel.beatMotion === out.beatMotion, `got ${out.beatMotion} feel ${feel.beatMotion}`);
}

// ---- K.Moods ----
{
  const S = { still: { a: 0, x: 0 }, base: { a: 1, x: 10 }, gather: { a: 2, x: 20 }, full: { a: 5, x: 50 } };
  { const m = new Moods(S); m.update({ section: 'drop' }, DT);
    check('moods: first update snaps', m.v.a === 5 && m.v.x === 50 && m.mood === 'full', JSON.stringify(m.v)); }
  { const m = new Moods({ base: { a: 1, x: 10 }, still: { a: 0 } });
    m.update({ section: 'intro' }, DT);
    check('moods: missing key falls back to base', m.v.a === 0 && m.v.x === 10, JSON.stringify(m.v));
    const n = new Moods({ base: { a: 1, x: 10 } }); n.update({ section: '' }, DT);
    check('moods: empty section targets base', n.mood === 'base' && n.v.a === 1); }
  { const m = new Moods(S, { map: { breakdown: 'base' } }); m.update({ section: 'breakdown' }, DT);
    check('moods: map override', m.mood === 'base' && m.v.a === 1); }
  { const m = new Moods(S, { slow: ['x'] });
    for (let i = 0; i < 600; i++) m.update({ section: 'groove' }, DT);
    for (let i = 0; i < 90; i++) m.update({ section: 'drop' }, DT);
    const fa = (m.v.a - 1) / 4, fx = (m.v.x - 10) / 40;
    check('moods: drop ease fast, slow keys slow', fa >= 0.95 && fx <= 0.6, `a ${fa.toFixed(2)} x ${fx.toFixed(2)}`); }
  { const m = new Moods(S); let ok = true;
    for (let i = 0; i < 3600; i++) {
      m.update({ section: Math.floor(i * DT / 4) % 2 ? 'build' : 'groove' }, DT);
      for (const k of ['a', 'x']) if (m.v[k] < S.base[k] - 1e-9 || m.v[k] > S.gather[k] + 1e-9) ok = false;
    }
    check('moods: flicker stays within base..gather', ok); }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
