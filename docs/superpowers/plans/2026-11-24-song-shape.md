# Song Shape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the camera lurching and objects bouncing on beats at Gentle Feel, make every world change through a song's sections, and give the 12 Radiohead-set worlds their own section moods.

**Architecture:** Show control gains a `beatMotion` Feel column, a smooth `groove` signal and an eased, section-driven `audio.shape` (new `js/show/shape.js`). Kit camera rigs read `beatMotion` / `energy` / `shape`; the renderer's existing `fogScale` and kit `Particles` read `shape.fog` / `shape.weather`. A new kit helper `K.Moods` (`js/kit/moods.js`) crossfades per-style named states by section. Then every style's beat-driven movement is swept, and the Radiohead worlds get moods.

**Tech Stack:** Plain ES modules, WebGL2, Node for pure-logic tests (`node tools/*.mjs`). No build step, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-song-shape-design.md`

## Global Constraints

- Static web app: plain ES modules + WebGL2, no build step, no runtime dependencies, works offline.
- 60 fps on a mid-range laptop; per environment ≤150 draw calls, ≤20k triangles at 320×240.
- Nothing ever hard-cuts; every reaction × intensity `k`; colours only via `this.pal`.
- Every section-driven value eases over 4–8 s; camera values never faster than 6 s, even on drops.
- `s.conductor` off → `audio.section === ''` → shape neutral (close 0, pace 1, fog 1, weather 1) and moods at `base`.
- Punchy Feel (`s.reactivity = 1`) must behave like today: `beatMotion = 1`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pane verification tips in `docs/HANDOFF.md` ("Verification tips for agents") apply: the pane is hidden, step frames by hand; reload after editing `js/kit/*`; `viz.selectPalette` persists (reset with `viz.selectPalette('', 0)`).

## Review Focus

1. **Tempo appears / disappears mid-song** (`audio.bpm` 0 → 120 → 0): sway and `groove` must not jump when their phase source switches. Pinned by `test-shape` "groove has no step when bpm appears" (Task 1) and the motion check with a bpm toggle (Task 3).
2. **Section flicker** (Conductor alternates groove/build every 4 s): shape and moods stay smooth and never overshoot. Pinned by `test-shape` "alternating sections stay within table bounds" (Task 1) and "moods flicker" (Task 4).
3. **Style switch mid-drop** (`dropSwitch`, auto-switch): the incoming world's `K.Moods` starts at the current mood, with no ease from `base`. Pinned by `test-shape` "first update snaps" (Task 4).
4. **Close framing at the extremes** (`close = ±1`) in tight interiors (Backrooms, Night Manor, Paper Crowd, Quiet House): the camera must not end up inside geometry. Pinned by the screenshot step in Task 3 and in each Phase 2 task.
5. **Thumbnails / bench / self-test** run styles with `THUMB_AUDIO` or bench audio that has no `shape` / `groove` / `beatMotion`: everything must default safely (`?? neutral`). Pinned by a `THUMB_AUDIO`-shaped input in `test-shape` (Task 1) and `?bench` in Task 3.

---

## Phase 1 — calm motion + song shape

### Task 1: Song shape, groove and beatMotion in show control

**Files:**
- Create: `js/show/shape.js`
- Create: `tools/test-shape.mjs`
- Modify: `js/show/control.js` (PROFILES ~line 37, `out` in constructor ~line 107, `process()` ~lines 124-180)
- Modify: `js/kit/swell.js` (`feel`, `drive()`)
- Modify: `js/main.js` (`THUMB_AUDIO` ~line 233, debug overlay line ~658)

**Interfaces:**
- Produces:
  - `export const SHAPE_TABLE` — `{ [section]: { close, pace, fog, weather } }` with the spec's rows for `intro groove build drop breakdown outro`, and `'': { close: 0, pace: 1, fog: 1, weather: 1 }`.
  - `export class SongShape { constructor(); update(audio, dt) → { close, pace, fog, weather, phrase, section } }`. Eases each field with `damp(…, tau = 2, dt)` toward `SHAPE_TABLE[audio.section] ?? SHAPE_TABLE['']`. `phrase` (integer) increments every 8 bar wraps (`audio.bar` going from 3 to 0) while `audio.bpm > 0`, else every 16 s; the counter for the next tick restarts when the section changes. Returns the same object every frame.
  - `audio.shape` (that object), `audio.groove` (0..1), `audio.beatMotion` (0..1) on ShowControl's output.
  - `feel.beatMotion` in `js/kit/swell.js` (default 1), set every frame by ShowControl.
  - `PROFILES` gains `beatMotion`: Gentle 0, Medium 0.4, Punchy 1.
  - `drive(audio, k)` gains `groove: (audio.groove ?? audio.beatPulse) * k` and `beatMotion: audio.beatMotion ?? feel.beatMotion`.
  - `audio.groove`: when `bpm > 0`, `0.5 - 0.5 * cos(2π · beatPhase)`; else `beatPulse`. Output is `damp`ed with tau 0.15 s so a source switch never steps.

- [ ] **Step 1: Write the failing tests** in `tools/test-shape.mjs` (same style as `tools/test-conductor.mjs`: plain asserts, `process.exit(1)` on failure, prints a summary):
  - `neutral when section is ''`: 10 s of `{ section: '' }` → `close≈0, pace≈1, fog≈1, weather≈1` (±1e-3).
  - `eases, never steps`: groove for 10 s, then `drop` for 10 s; the max per-frame change of each field ≤ `|row delta| * dt / 2 * 1.01`; after 6 s in drop each field is within 5 % of the drop row.
  - `alternating sections stay within table bounds`: groove/build alternating every 4 s for 60 s; every field stays within `[min, max]` of those two rows.
  - `phrase ticks every 8 bars`: `bpm 120`, `bar` advancing 0..3 at 2 beats/s for 40 s in one section → `phrase` goes up by 2 (16 s per phrase); with `bpm 0` for 40 s → up by 2.
  - `THUMB_AUDIO-shaped input`: `update({ level: 0, beat: false, bpm: 0, bar: 0 }, 1/60)` doesn't throw and returns neutral.
  - `groove has no step when bpm appears`: drive a `ShowControl` for 4 s with `bpm 0`, then with `autoBpm 120` / `autoPhase` advancing; the max per-frame change of `out.groove` ≤ 0.1.
  - `beatMotion per profile`: `ShowControl.process` with `s.reactivity` 0 / 0.5 / 1 (after 5 s of easing) → `out.beatMotion` 0 / 0.4 / 1 (±0.02) and `feel.beatMotion` equal to it.

- [ ] **Step 2: Run it to make sure it fails**
  Run: `node tools/test-shape.mjs` — Expected: fails to import `../js/show/shape.js`.

- [ ] **Step 3: Implement `js/show/shape.js`**, then wire it into `ShowControl` (construct `this.shape = new SongShape()`; after the section is copied, set `o.shape = this.shape.update(o, dt)`; set `o.groove`, `o.beatMotion`, `feel.beatMotion` from the profile). Add `beatMotion` to `PROFILES` and to the `out` initialiser, and add `groove` / `beatMotion` to `drive()`. Add `shape: { close: 0, pace: 1, fog: 1, weather: 1, phrase: 0 }`, `groove: 0`, `beatMotion: 1` to `THUMB_AUDIO`. Add a `shape:` line to the debug overlay: `shape: <section> close 0.40 pace 1.15 fog 0.90 wx 1.20 ph 3`.

- [ ] **Step 4: Run the tests**
  Run: `node tools/test-shape.mjs && node tools/test-conductor.mjs && node tools/test-output.mjs && node tools/test-manager.mjs` — Expected: all pass.

- [ ] **Step 5: Commit** — `git add js/show/shape.js tools/test-shape.mjs js/show/control.js js/kit/swell.js js/main.js` then `git commit -m "Song shape: eased section shape, groove and beatMotion in show control"`.

### Task 2: Fog and weather follow the song shape

**Files:**
- Modify: `js/main.js` (~line 613, where `P.fogScale` is set; thumbnail save / restore ~line 255)
- Modify: `js/gfx/ps1.js` (`params` ~line 354: add `weather: 1`)
- Modify: `js/kit/particles.js` (~line 88, `this.visible`)

**Interfaces:**
- Consumes: `audio.shape.fog`, `audio.shape.weather` (Task 1).
- Produces: `renderer.params.weather` (default 1). `Particles.update` multiplies `amount` by `clamp(r.params.weather, 0, 1.5)` before the existing 0..1 clamp and `quality`.

- [ ] **Step 1: Implement.** `P.fogScale = (s.audioPushesLook ? 1 + audio.level * k * 0.25 : 1) * clamp(audio.shape?.fog ?? 1, 0.75, 1.25)`. `P.weather = audio.shape?.weather ?? 1`. Thumbnails save, reset (to 1) and restore `P.weather` like `P.fogScale`.
- [ ] **Step 2: Verify in the pane** (`node serve.js`, preview, reload). For Ashfall Town (ash particles) and Fog Harbour, step 300 frames at k = 1 with `audio.section` forced to `breakdown`, then 300 frames with `drop`, by stubbing `viz.conductor.process` to set `a.section`. Read `renderer.params.fogScale` / `.weather` and the style's particle `visible` count: breakdown < groove < drop. `renderer.gl.getError()` → 0.
- [ ] **Step 3: Commit** — `git commit -m "Fog distance and particle amount follow the song shape"`.

### Task 3: Calm camera rigs + motion check helper

**Files:**
- Modify: `js/kit/camera.js` (`CameraRig` base lines 35-74; `DollyRig`, `OrbitRig`, `OrbitFocusRig`, `DriftRig`; `SweepRig`, `PathRig` and `GridWanderRig` need no own code beyond the base)
- Create: `js/dev/motion-check.js` (dev only, never imported by the app)
- Modify: `docs/HANDOFF.md` ("Verification tips": how to use the motion check)

**Interfaces:**
- Consumes: `feel.beatMotion`, `audio.energy`, `audio.shape` (Task 1).
- Produces:
  - `CameraRig` options: `sway = 0.012` (roll, rad), `swayLift = 0.04` (eye y, units), `shapeAmount = 1`. `DriftRig` / `GridWanderRig` defaults: `sway 0.006`, `swayLift 0.02`.
  - `CameraRig` state read by subclasses: `this.close` (= `shape.close * shapeAmount`, already eased), `this.reframe` (−1..1, eased with tau 2 s, new target on every `shape.phrase` change: `((phrase * 0.618) % 1) * 2 - 1`), `this.speed` (now includes `shape.pace`).
  - `export async function motionCheck(viz, { index, frames = 1200, sections, bpmToggleAt, reactivity }) → { maxAccel, maxFovStep, frames }` in `js/dev/motion-check.js`. It steps the style by hand (as in the HANDOFF snippet), drives `audio.section` through `sections` (`[[name, seconds], …]`), optionally switches `bpm` 0 ↔ 120 at `bpmToggleAt` s, reads the camera position from `renderer.view` (inverse of the view matrix) and FOV from `renderer.proj[5]` after each render, and returns the largest per-frame change in eye velocity (`|Δ(Δeye)|`) and FOV step (degrees).

Base rig behaviour (spec 1b):
- `speed` target `= lerp(idleSpeed, activeSpeed, k) * pace + (audio.energy ?? audio.level) * k * bassBoost`, damped with tau 1.5 s.
- Beat nudge, roll kick and beat punch × `feel.beatMotion`.
- Drop: target `0.6 * 1.6 * k * feel.motion` into a punch that rises with tau 0.3 s and then decays like today's `punch` (0.18 s × `feel.decay`); the drop nudge kick × `feel.motion` × 0.6.
- Sway: phase `(bar + beatPhase) / 4` when `bpm > 0`, else `time / 8`; `swayV = damp(swayV, sin(2π·phase), 0.6, dt)`; `apply()` adds `sway * swayV * k` to roll and `swayLift * cos(2π·phase) * k` (also damped) to eye y.
- `apply()` FOV: `fov * (1 - 0.07 * tension) * (1 - 0.1 * close) + punch`.
- Subclasses: `OrbitRig` radius `× (1 - 0.25 * close)`, angle `+ 0.6 * reframe`; `OrbitFocusRig` `rx`, `rz × (1 - 0.2 * close)`, `th + 0.5 * reframe`; `DollyRig` `heightOffset - 0.5 * close` (the existing ground clamp still applies); `DriftRig` `reach × (1 - 0.3 * close)`, glance `+ 0.2 * reframe`; `OrbitRig` push-in reads energy, not bass.

- [ ] **Step 1: Write `js/dev/motion-check.js`** with the signature above.
- [ ] **Step 2: Record today's baseline.** In the pane, for one style per rig type (Lost Valley: Dolly; Monoliths: Orbit; Fog Harbour: OrbitFocus; Under the Hull: Drift; Backrooms: GridWander; Fogway: Path; one Sweep user), run `motionCheck` at Gentle with sections `[['groove', 6], ['build', 6], ['drop', 6], ['breakdown', 6]]`. Write the numbers down: Gentle should show the beat-kick spikes.
- [ ] **Step 3: Implement the rig changes** above.
- [ ] **Step 4: Run the motion check again** (reload first). Expected at Gentle: `maxAccel` ≤ 0.01 units/frame² and `maxFovStep` ≤ 0.3° for every rig type, including a run with `bpmToggleAt: 10`. At Punchy, beat spikes come back (values similar to the baseline).
- [ ] **Step 5: Screenshot check at the extremes.** For Backrooms, Night Manor, Paper Crowd, Quiet House, Fog Harbour and Monoliths, force `shape.close` to −1 and to +1 (stub `audio.shape`) for 600 frames at k = 1 and take a screenshot of each. Expected: no camera inside walls / terrain. Where a style clips, set `shapeAmount: 0` (or smaller) in that style's rig options and note it in the commit.
- [ ] **Step 6: Run every style through the guarded path** at k = 0 and k = 1 (HANDOFF snippet). Expected: `gl.getError() === 0`, draws / tris unchanged against the HANDOFF table. Then run `?bench` and check the fps / CPU columns within noise of before.
- [ ] **Step 7: Commit** — `git commit -m "Camera rigs: no beat lurch at Gentle, energy-paced travel, bar sway, section framing"`.

### Task 4: `K.Moods`

**Files:**
- Create: `js/kit/moods.js`
- Modify: `js/kit/index.js` (`export * from './moods.js'`)
- Modify: `tools/test-shape.mjs` (Moods tests)

**Interfaces:**
- Produces: `export class Moods { constructor(states, { map = {}, ease = 6, dropEase = 1.5, slow = [] } = {}); update(audio, dt) → this.v; v; mood }`.
  - `states`: `{ still?, base, gather?, full? }`, each an object of numbers. Missing states or keys fall back to `base`'s value.
  - `DEFAULT_MAP = { intro: 'still', outro: 'still', breakdown: 'still', groove: 'base', build: 'gather', drop: 'full', '': 'base' }`; `map` overrides entries.
  - Each key is damped with tau `ease / 3`. When the target mood came from section `drop`, keys not in `slow` use tau `dropEase / 3`. Keys in `slow` never use a tau below `6 / 3`.
  - The first `update()` snaps `v` to the target with no easing.
  - `mood` = the current target state's name.

- [ ] **Step 1: Write the failing tests** in `tools/test-shape.mjs`:
  - `first update snaps`: new Moods, first update with `section: 'drop'` → `v` equals `full` exactly.
  - `fallback`: a state missing key `x` → `v.x` follows `base.x`; `section: ''` → `base`.
  - `map override`: `map: { breakdown: 'base' }` → breakdown targets `base`.
  - `drop ease fast, slow keys slow`: groove 10 s, then drop: after 1.5 s a non-slow key is ≥ 95 % of the way; a `slow` key is ≤ 60 %.
  - `moods flicker`: groove/build alternating every 4 s for 60 s → every key stays within `[min, max]` of `base` / `gather`.
- [ ] **Step 2: Run** `node tools/test-shape.mjs` — Expected: the Moods tests fail (import missing).
- [ ] **Step 3: Implement `js/kit/moods.js`** and the export.
- [ ] **Step 4: Run** `node tools/test-shape.mjs` — Expected: all pass.
- [ ] **Step 5: Commit** — `git commit -m "Kit: K.Moods, section-crossfaded named states"`.

## Phase 2 — bouncing pass

### Tasks 5–11: one task per style group

The same procedure applies to each group; the groups touch disjoint files, so they can run in parallel worktrees.

| Task | Styles (`js/styles/…`) |
|---|---|
| 5 | `fogway`, `monoliths`, `relic`, `ashfall-town`, `lost-valley`, `neon-circuit` |
| 6 | `night-manor`, `drowned-ruins`, `route-nine`, `cold-base`, `station-deck`, `dream-journal` |
| 7 | `graveyard-hill`, `arcade-after-hours`, `aurora-field`, `lantern-river`, `rain-window`, `cloud-sea` |
| 8 | `petal-steps`, `moonlit-shallows`, `greenhouse-dusk`, `kit-demo`, `kit-calm`, `ember-vigil` |
| 9 | `quiet-house`, `moth-lamp`, `under-the-hull`, `still-pool`, `underriver`, `before-dawn` |
| 10 | `salt-flat`, `searchlight-town`, `back-road-lights`, `paper-crowd`, `newsprint`, `right-place` |
| 11 | `colour-well`, `backrooms`, `fog-harbour` |

**Interfaces:**
- Consumes: `d.beatMotion`, `d.groove` from `K.drive` (Task 1); `motionCheck` (Task 3).

**Rule for every beat site** (spec Phase 2):
- A `.kick(` / `.trigger(` that **moves or scales** something on `d.beat` / `beatCount` / `d.pulse` → × `d.beatMotion`. Where that motion is part of the world's look (things that should still breathe at Gentle), add a replacement driven by `d.groove` or `d.energy`, eased, at most the same amplitude.
- `d.bass` / `d.high` / `d.level` driving **positions, rotations or scale** directly → eased (`damp`, tau ≥ 0.4 s) or moved to `d.energy`.
- Light and colour reactions (glow, twinkle, brightness) → unchanged.
- A custom camera (base `CameraRig` with its own positioning, or a local rig like `GlideRig` / `VigilRig`) follows the Task 3 rules by hand: beat kicks × `beatMotion`, travel paced by energy × `shape.pace`.

- [ ] **Step 1: Find the beat sites** in each file (`grep -n "beat\|pulse\|kick(\|trigger(\|\.bass\|\.high\|\.level"`) and classify each as movement or light.
- [ ] **Step 2: Baseline** `motionCheck` at Gentle for each style (sections as in Task 3) and record `maxAccel`.
- [ ] **Step 3: Apply the rule** to each file.
- [ ] **Step 4: Verify each style.** Expected:
  - Gentle `maxAccel` ≤ 0.01 and `maxFovStep` ≤ 0.3°.
  - At k = 0 and k = 1, `gl.getError() === 0`, and draws / tris unchanged against the HANDOFF table.
  - A screenshot at Gentle k = 1 next to one at Punchy k = 1: Punchy looks like before, Gentle still visibly moves (not frozen).
- [ ] **Step 5: Commit** one commit per group — `git commit -m "Bouncing pass: <styles> beat motion follows Feel"`.

## Phase 3 — moods for the Radiohead set

### Tasks 12–15: three worlds per task

| Task | Worlds (`js/styles/…`, spec table rows) |
|---|---|
| 12 | `quiet-house` (24), `moth-lamp` (25), `under-the-hull` (26) |
| 13 | `still-pool` (27), `underriver` (28), `before-dawn` (29) |
| 14 | `salt-flat` (30), `searchlight-town` (31), `back-road-lights` (32) |
| 15 | `paper-crowd` (33), `newsprint` (34), `right-place` (35) |

Each depends on Task 4 and on that world's Phase 2 commit (Tasks 9 / 10).

**Interfaces:**
- Consumes: `new K.Moods(states, { map, ease, dropEase, slow })`, `this.moods.update(audio, dt)`, `this.moods.v` (Task 4).

Per world:
- `still` / `base` / `gather` / `full` as in the spec table. `base` = today's values, so with the Conductor off the world looks like today after Phase 2.
- Every camera-position key goes in `slow`.
- Features staged by `k` are multiplied by a mood gate and clamped to 0..1 (spec: "How moods combine with `k`").
- Still Pool `full` = the camera lowers to skim the surface. There is no underwater view.

- [ ] **Step 1: Add the moods** to each world (`init`: construct; `update`: `this.moods.update(audio, dt)` first, then read `this.moods.v`).
- [ ] **Step 2: Verify each world.** In the pane, at k = 0.6, step the sections through `motionCheck` with `[['intro', 8], ['groove', 10], ['build', 8], ['drop', 10], ['breakdown', 10], ['outro', 8]]`, and take a screenshot at the end of each section. Expected:
  - Each section is visibly different, and `still` / `full` match the spec table.
  - `maxAccel` ≤ 0.01.
  - `gl.getError() === 0`, and the budgets hold at k = 1 in `full`.
  - Three other palettes from the Radiohead set (`okc`, `kida`, `amsp`) still read; reset the palette afterwards.
- [ ] **Step 3: Watch the demo track's third song** (82–160 s, two builds and drops) with the debug overlay, on one world from the group. Expected: the `shape:` line and the mood changes follow the `song:` line.
- [ ] **Step 4: Commit** one commit per group — `git commit -m "Moods: <worlds> change through the song's sections"`.

### Task 16: Docs

**Files:**
- Modify: `docs/ENVIRONMENT-GUIDE.md`:
  - the audio fields paragraph (~line 35): add `shape`, `groove`, `beatMotion`;
  - the rule "beat movement × `beatMotion`, light × `accent`";
  - a `K.Moods` row in the kit reference table (Kit v8);
  - the camera rig notes: `sway`, `swayLift`, `shapeAmount`, `close` / `reframe`.
- Modify: `docs/HANDOFF.md`:
  - replace open item 5 with this project's status;
  - add a "Landed" section;
  - add the not-verified item "feel with real band songs in a visible window".
- Modify: `CLAUDE.md` Architecture: `js/show/shape.js`, `js/kit/moods.js`, and `node tools/test-shape.mjs` in Run / verify.
- Modify: `js/styles/kit-demo.js`: show `K.Moods` with a two-key example (the guide says kit versions are shown there).

- [ ] **Step 1: Write the doc changes.**
- [ ] **Step 2: Run every node test** — `node tools/test-shape.mjs && node tools/test-conductor.mjs && node tools/test-output.mjs && node tools/test-manager.mjs` — Expected: all pass.
- [ ] **Step 3: Commit** — `git commit -m "Docs: song shape, moods, beatMotion"`.
