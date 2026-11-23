// Node test for js/show/conductor.js: synthetic songs through PlayState + Conductor.
// Usage: node tools/test-conductor.mjs   (exit code 1 on failure)
import { PlayState } from '../js/audio/playstate.js';
import { Conductor } from '../js/show/conductor.js';
import { DEFAULTS } from '../js/settings.js';

const FPS = 60, DT = 1 / FPS;
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const damp = (c, t, tau, dt) => c + (t - c) * (1 - Math.exp(-dt / tau));
const lerp = (a, b, t) => a + (b - a) * t;

// level / bass / high are raw analyser values (rms, band averages); beat = kick present
const QUIET = { level: 1e-5, bass: 1e-7, high: 1e-8, kick: false };
const GROOVE = { level: 0.1, bass: 0.02, high: 0.0007, kick: true };
const DROP = { level: 0.2, bass: 0.04, high: 0.0012, kick: true };
const BREAK = { level: 0.035, bass: 0.003, high: 0.0004, kick: false };
const seg = (dur, from, to = from, name = '') => ({ dur, from, to, name });
const ramp = (a, b) => ({ level: b.level, bass: b.bass, high: b.high, kick: b.kick, _from: a });

/**
 * Run a song script. Returns per-frame records { t, k, kPlay, section, drop, build, bpm, conf }
 * plus scripted marks { name: t }.
 */
function run(script, { bpm = 124, settings = {} } = {}) {
  const s = { ...DEFAULTS, ...settings };
  const st = new PlayState(), c = new Conductor();
  const a = { raw: { level: 0, bass: 0, mid: 0, high: 0 }, energy: 0, beat: false, rmsDbSmooth: -100 };
  let energyRaw = 0, longRef = 0.12, gated = 0, t = 0, nextBeat = 0;
  const rec = [], marks = {};
  for (const sg of script) {
    if (sg.name) marks[sg.name] = t;
    const n = Math.round(sg.dur * FPS);
    for (let i = 0; i < n; i++, t += DT) {
      const u = i / n, f = sg.from, g = sg.to;
      const L = Math.exp(lerp(Math.log(f.level), Math.log(g.level), u)) * (0.9 + rnd() * 0.2);
      const B = Math.exp(lerp(Math.log(f.bass), Math.log(g.bass), u)) * (0.85 + rnd() * 0.3);
      const H = Math.exp(lerp(Math.log(f.high), Math.log(g.high), u)) * (0.85 + rnd() * 0.3);
      a.beat = false;
      const kick = u < 0.5 ? f.kick : g.kick;
      if (t >= nextBeat) { nextBeat += 60 / bpm; if (kick) a.beat = true; }
      a.raw.level = L; a.raw.bass = B * (a.beat ? 1.6 : 1); a.raw.high = H;
      a.rmsDbSmooth = damp(a.rmsDbSmooth, 20 * Math.log10(L), 0.1, DT);
      const gate = a.rmsDbSmooth > s.thresholdDb;
      if (gate) { gated += DT; longRef = damp(longRef, L, Math.min(45, 3 + gated), DT); }
      energyRaw = damp(energyRaw, L, 0.8, DT);
      a.energy = damp(a.energy, gate ? Math.min(1, energyRaw / longRef * 0.5) : 0, 1, DT);
      st.update(a.rmsDbSmooth, DT, s);
      const k = c.process(a, st.intensity, st.playing, DT, s);
      rec.push({ t, k, kPlay: st.intensity, section: a.section, drop: a.drop, build: a.build, bpm: a.autoBpm, conf: a.autoConf, world: c.worldChange, songTime: a.songTime });
    }
  }
  return { rec, marks };
}

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? `  (${info})` : ''}`); if (!ok) fails++; };
const sections = (rec) => rec.reduce((l, r) => (r.section && l[l.length - 1] !== r.section ? [...l, r.section] : l), []);
const isSubseq = (want, got) => { let i = 0; for (const g of got) if (g === want[i]) i++; return i === want.length; };
const maxStep = (rec) => rec.reduce((m, r, i) => (i ? Math.max(m, Math.abs(r.k - rec[i - 1].k)) : m), 0);
const at = (rec, t) => rec[Math.min(rec.length - 1, Math.round(t * FPS))];

// ---- 1. a song with shape: intro, groove, build, drop, breakdown, build, drop, outro
{
  const { rec, marks } = run([
    seg(3, QUIET),
    seg(40, GROOVE, GROOVE, 'groove'),
    seg(12, { ...GROOVE, level: 0.07, bass: 0.012 }, { level: 0.14, bass: 0.004, high: 0.0025, kick: false }, 'build1'),
    seg(32, DROP, DROP, 'drop1'),
    seg(20, BREAK, BREAK, 'break'),
    seg(12, { ...BREAK, level: 0.04 }, { level: 0.13, bass: 0.004, high: 0.0025, kick: false }, 'build2'),
    seg(32, DROP, DROP, 'drop2'),
    seg(24, GROOVE, { level: 0.004, bass: 0.0005, high: 0.00004, kick: false }, 'outro'),
    seg(12, QUIET),
  ]);
  const secs = sections(rec);
  check('shaped song: section order', isSubseq(['intro', 'groove', 'build', 'drop', 'breakdown', 'build', 'drop', 'outro'], secs), secs.join(' > '));
  const drops = rec.filter((r) => r.drop);
  check('shaped song: two drops', drops.length === 2, drops.map((d) => d.t.toFixed(1)).join(', '));
  for (const [i, m] of ['drop1', 'drop2'].entries()) {
    const d = drops[i];
    if (!d) continue;
    check(`shaped song: ${m} detected near the script`, d.t - marks[m] >= -0.1 && d.t - marks[m] < 2, `${(d.t - marks[m]).toFixed(2)} s late`);
    const peakT = rec.find((r) => r.t >= d.t && r.k >= 0.93)?.t ?? Infinity;
    check(`shaped song: ${m} peak within 0.6 s`, peakT - d.t <= 0.6, `${(peakT - d.t).toFixed(2)} s`);
  }
  const before = rec.filter((r) => r.t < marks.drop1 && r.section !== 'build');
  check('shaped song: top band kept for the drop', Math.max(...before.map((r) => r.k)) <= 0.86, Math.max(...before.map((r) => r.k)).toFixed(2));
  const brk = at(rec, marks.build2 - 1).k;
  check('shaped song: breakdown pulls down', brk < 0.55, brk.toFixed(2));
  const step = maxStep(rec);
  check('shaped song: no jumps (max per-frame step)', step < 0.03, step.toFixed(4));
  check('shaped song: build anticipation reaches > 0.5', rec.some((r) => r.build > 0.5));
  check('shaped song: no world change by default', !rec.some((r) => r.world));
  const ws = run([seg(3, QUIET), seg(40, GROOVE), seg(12, { ...GROOVE, level: 0.07, bass: 0.012 }, { level: 0.14, bass: 0.004, high: 0.0025, kick: false }), seg(30, DROP), seg(20, BREAK), seg(12, BREAK, { level: 0.13, bass: 0.004, high: 0.0025, kick: false }), seg(30, DROP)], { settings: { dropSwitch: true } });
  check('drop switch: exactly one world change per song', ws.rec.filter((r) => r.world).length === 1);
}

// ---- 2. flat loud song: starts around the middle, still gets to the top
{
  const { rec } = run([seg(2, QUIET), seg(240, GROOVE), seg(10, QUIET)]);
  const early = at(rec, 2 + 4).k, end = Math.max(...rec.map((r) => r.k));
  check('flat loud: ≥ 0.5 once the play ramp is done', early >= 0.5, early.toFixed(2));
  check('flat loud: reaches ~1 by the end', end >= 0.95, end.toFixed(2));
  check('flat loud: no drops', !rec.some((r) => r.drop));
  check('flat loud: no jumps', maxStep(rec) < 0.03, maxStep(rec).toFixed(4));
}

// ---- 3. quiet ballad: no beat, never reaches the drop band
{
  const B = { level: 0.012, bass: 0.001, high: 0.0001, kick: false };
  const { rec } = run([seg(2, QUIET), seg(200, B), seg(8, QUIET)]);
  const mx = Math.max(...rec.map((r) => r.k));
  check('ballad: stays below the drop band', mx <= 0.86, mx.toFixed(2));
  check('ballad: no drops', !rec.some((r) => r.drop));
}

// ---- 4. a 1.2 s stop is the same song
{
  const { rec, marks } = run([seg(2, QUIET), seg(30, GROOVE), seg(1.2, QUIET, QUIET, 'stop'), seg(20, GROOVE, GROOVE, 'back'), seg(10, QUIET)]);
  const a = at(rec, marks.stop - 0.1), b = at(rec, marks.back + 1);
  check('short stop: song time keeps counting', b.songTime > a.songTime + 1, `${a.songTime.toFixed(1)} -> ${b.songTime.toFixed(1)}`);
  check('short stop: no new intro', b.section !== 'intro', b.section);
  check('short stop: no drop when the beat comes back', !rec.some((r) => r.drop));
}

// ---- 5. auto tempo on a steady 120 bpm kick
{
  const { rec } = run([seg(2, QUIET), seg(30, GROOVE)], { bpm: 120 });
  const r = rec[rec.length - 1];
  check('auto tempo: 120 bpm', Math.abs(r.bpm - 120) < 1.5, `${r.bpm.toFixed(2)} bpm, conf ${r.conf.toFixed(2)}`);
  const first = rec.find((x) => x.bpm > 0);
  check('auto tempo: locks within ~10 s', first && first.t < 12, first ? `${first.t.toFixed(1)} s` : 'never');
  const r2 = run([seg(2, QUIET), seg(30, GROOVE)], { bpm: 174 }).rec.at(-1);
  check('auto tempo: 174 folds to 87', Math.abs(r2.bpm - 87) < 1.5, r2.bpm.toFixed(2));
}

// ---- 6. "Follow song" off is the old intensity exactly
{
  const { rec } = run([seg(2, QUIET), seg(40, GROOVE), seg(8, QUIET)], { settings: { conductor: false } });
  check('conductor off: k == k_play every frame', rec.every((r) => r.k === r.kPlay));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
