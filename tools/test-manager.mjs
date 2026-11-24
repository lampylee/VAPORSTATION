// Node test for js/styles/manager.js: committed `upcoming` style.
// Usage: node tools/test-manager.mjs   (exit code 1 on failure)
import { StyleManager } from '../js/styles/manager.js';
import { fromKeys } from '../js/palette/palette.js';

let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fails++;
};

const renderer = { createClutTexture() { return {}; }, updateClut() {}, deleteTexture() {}, clear() {}, beginScene() {}, setPalette() {}, composite() {} };
const mk = (n) => class {
  static meta = { name: n };
  static palette = fromKeys(n, n, ['#a04a32', '#38e8c8', '#d0b070', '#20283a']);
  init() {} update() {} render() {} dispose() {}
};
// index 0 hidden (like the test scene), 1..3 in rotation
const hidden = mk('hidden'); hidden.meta = { name: 'hidden', hidden: true };
const make = () => new StyleManager(renderer, [hidden, mk('a'), mk('b'), mk('c')], 1);
const S = { autoSwitch: true, idleSwitchDelay: 1, idleSwitchInterval: 1, transitionTime: 0.5 };
const audio = {};
const run = (m, secs, playing = false) => { for (let i = 0; i < secs * 60; i++) m.update(audio, 0, playing, 1 / 60, S); };

{
  const m = make();
  check('cur 1 -> upcoming 2', m.upcoming === 2, `got ${m.upcoming}`);
  check('upcoming stable across reads', m.upcoming === 2 && m.upcoming === 2);
  run(m, 1.2); // idle delay passes -> auto-switch starts
  check('auto-switch goes to the shown upcoming', m.target === 2, `target ${m.target}`);
  run(m, 0.6);
  check('cur becomes 2', m.cur === 2, `cur ${m.cur}`);
  check('upcoming now 3', m.upcoming === 3, `got ${m.upcoming}`);
  m.broken.add(3);
  check('upcoming 3 broken -> re-picks 1', m.upcoming === 1, `got ${m.upcoming}`);
}
{
  const m = make();
  m.goTo(2); run(m, 0.6);
  m.pool = [1, 3];
  check('pool [1,3] while on 2 -> upcoming 3', m.upcoming === 3, `got ${m.upcoming}`);
}
{
  const m = make();
  let ok = true;
  for (let i = 0; i < 8; i++) { if (m.upcoming === m.target) ok = false; m.goNext(); run(m, 0.6, true); }
  check('upcoming never equals cur (rotation > 1)', ok);
  const before = m.cur;
  m.goNext(-1); run(m, 0.6, true);
  check('goNext(-1) steps backwards', m.cur !== before && m.cur !== m.upcoming);
}
{
  // enter(): every way a style comes on screen snaps its moods / rigs and calls style.enter()
  const m = make();
  const entered = [];
  m.styles.forEach((s, i) => { s.enter = () => entered.push(i); });
  m.goTo(2);
  check('goTo calls enter on the incoming style', entered.join() === '2', entered.join());
  m.goTo(3);
  check('a queued request does not enter yet', entered.join() === '2', entered.join());
  run(m, 0.6, true);
  check('the queued style enters when its crossfade starts', entered.join() === '2,3', entered.join());
  run(m, 0.6, true);
  m.goNext();
  check('goNext enters', entered.length === 3 && entered[2] === m.next, entered.join());
  run(m, 0.6, true);
  const n = entered.length;
  run(m, 2, false);   // idle: auto-switch
  check('auto-switch enters', entered.length === n + 1 && entered[n] === m.target, entered.join());
  run(m, 0.6, false);
  const before = entered.length;
  for (let i = 0; i < 30; i++) m.styles.forEach((s, j) => j !== m.cur && s.update(audio, 0, 0.05));   // thumbnails
  check('updating off-screen styles (thumbnails) does not enter', entered.length === before);
  // the kit default: own K.Moods and camera rigs snap even without style.enter()
  const { Moods } = await import('../js/kit/moods.js');
  const { CameraRig } = await import('../js/kit/camera.js');
  const t = m.rotation.find((j) => j !== m.cur);
  const st = m.styles[t]; delete st.enter;
  st.moods = new Moods({ base: { a: 1 } }); st.cam = new CameraRig();
  st.moods._init = true; st.cam._snap = false;
  m.goTo(t);
  check('enter snaps own Moods and CameraRigs', st.moods._init === false && st.cam._snap === true);
  // a throwing enter() marks the style broken instead of breaking the show
  const m2 = make();
  m2.styles[2].enter = () => { throw new Error('boom'); };
  const err = console.error; console.error = () => {};
  m2.goTo(2);
  console.error = err;
  check('a throwing enter() is caught (style marked broken)', m2.broken.has(2));
}
process.exit(fails ? 1 : 0);
