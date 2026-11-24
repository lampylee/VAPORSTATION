# Song shape: calm motion + worlds that change through a song — design

Status: draft for approval (2026-11-24). Supersedes HANDOFF open item 5 ("teach a few styles to use build / drop / bar").

## Why

Two complaints from watching the visualizer with real songs:

1. **Jerky.** The camera lurches and things bounce on beats. Most of the reactions were written against a steady
   electronic kick. With a live band (drums with fills, guitars, vocals) the per-frame bass / highs / beat spikes are
   uneven, so the same code twitches instead of grooving. Many environments are hard to use for non-electronic songs.
2. **Samey.** Inside one world every song plays out the same: the only song-level variable is intensity `k`, so a ballad
   and a loud closer look like the same scene at different volumes.

The user wants **the world to change as the song unfolds** (following its sections), not per-song presets in the setlist.

## Goals

- At the default Feel (Gentle), **nothing moves per beat**: no camera nudge / roll / zoom on beats, no objects hopping on
  beats. Motion follows slow song-level signals (energy, sections, bars).
- Every world changes visibly between sections of a song (intro, groove, build, drop, breakdown, outro) with **no
  per-style work** (the kit does it), and long grooves don't sit still for minutes.
- The 12 Radiohead-set worlds (24–35) get their own **moods**: 2–4 named states per world, crossfaded by section, so a
  breakdown and a chorus look like different moments of the same place.
- Punchy Feel keeps today's beat-driven behaviour for electronic songs.

## Non-goals

- Per-song presets / variants chosen in the setlist (explicitly not what the user wants).
- Moods for the other 24 worlds in this project (later, same mechanism).
- Retuning the Conductor's section detection (it has only been tuned on synthetic songs; this design must be safe
  when it guesses wrong, see Constraints).
- New environments, PS2 mode, camera feed.

## Anti-goals (fails even if it works)

- Anything that reads as a cut or a jump when a section changes. A wrong section guess must look like a slow drift.
- Worlds that end up static or dull at Gentle. Calm is not still: removing beat kicks has to be paid back with slow,
  musical motion (bar-phrased sway, section reframes).
- Camera clipping into walls / terrain because a generic reframe moved the eye somewhere a rig never went before.
- Breaking the hard rules: budgets (≤150 draws, ≤20k tris), no hard cuts, everything × intensity, colours via palette.

## Constraints

- Static ES modules, no build step, no dependencies; 60 fps; shared pipeline only (`CLAUDE.md`).
- Section changes from the Conductor are guesses. Every section-driven value eases over **4–8 s** (the Conductor already
  holds a section ≥ 4 s, except drops). A drop's own move may be faster (≈1–1.5 s rise) but never instant.
- `s.conductor` off (Follow song): song-shape values read neutral, so worlds look as they do after phase 1 with no
  section changes. Feel still applies.
- Styles keep their local copies of kit code they were built with; changes to kit classes reach every style that uses
  them (35 of 36 use a kit camera rig; 7 use the base `CameraRig` directly with their own positioning; `GlideRig` and
  `VigilRig` are local).

## Approaches considered

- **A. Kit director for everyone.** One global, eased "song shape" computed from the section; kit camera rigs, fog and
  particles read it. Every world changes, no per-style work; but every world changes the same way.
- **B. Per-world moods.** Each style declares named states and crossfades between them by section. Most character;
  design + build work per world.
- **C. One slow arc per song** (e.g. dusk → night over the song). Simple, but every song has the same arc and it
  ignores sections.

**Picked: A as the base for all 36, B layered on, starting with the Radiohead set.** A fixes "samey" everywhere at once
and is the safety net for wrong section guesses; B adds personality world by world. C is dropped (it is what `k`'s song arc already does).

## Design

Three phases, each shippable on its own.

### Phase 1 — calm motion + song shape (kit / show control)

**1a. Beat motion becomes a Feel setting.** Add a `beatMotion` column to `PROFILES` in `js/show/control.js`:
Gentle 0, Medium 0.4, Punchy 1, exported through `feel.beatMotion` (`js/kit/swell.js`) and `audio.beatMotion`.
It scales every per-beat *movement* (springs kicked on a beat, position / scale bounces on beats). Beat *light*
reactions (twinkles, glows) keep using `accent` as today. At Punchy, behaviour matches today.
*(Design call)* `beatMotion` is a **second factor applied at beat sites only**; the existing `feel.motion` (inside
`Spring.kick`) stays as it is, so non-beat kicks (drops, style-specific events) keep today's scaling. It is not folded
into `Spring.kick`, because a spring doesn't know whether it was kicked by a beat. Phase 2 is therefore a per-style
sweep of the beat sites.

**1b. Camera rigs stop lurching** (`js/kit/camera.js`, `CameraRig` base + subclasses):
- Beat nudge, roll kick and beat FOV punch are multiplied by `feel.beatMotion` (0 at Gentle).
- Travel speed follows `audio.energy × k` instead of `audio.bass × k` (same `bassBoost` option, now an energy boost),
  with a slower ease (~1.5 s instead of 0.35 s). `OrbitRig`'s push-in follows energy the same way.
- Bar sway replaces beat kicks: when a tempo is known (`audio.bpm > 0`), a small continuous sway / roll phrased on the
  4-beat bar (driven by `beatPhase` + `bar`, so it's smooth, not a kick); without a tempo, a slow free-running sway.
  Amount scales with `k` and a rig option (default small; `DriftRig` / `GridWanderRig` smaller still).
- Build tension (FOV narrowing) stays as is. The drop punch stays, softened (×0.6) and with a ~0.3 s attack instead
  of instant, still scaled by `feel.motion` (so near zero at Gentle). *(Design call)* At Gentle a drop is shown by the
  song shape (framing opens wide, fog lifts, weather rises) and by moods, not by a camera punch.

**1c. Song shape signal.** Show control (next to where the Conductor's fields are copied, `control.js` ~line 180)
computes an eased vector `audio.shape` from `audio.section`, one table row per section, each value eased over 4–8 s:

| field | meaning | intro | groove | build | drop | breakdown | outro |
|---|---|---|---|---|---|---|---|
| `close` | −1 wide … +1 close framing | 0.5 | 0 | 0.4 | −0.6 | 0.8 | 0.6 |
| `pace` | camera travel × | 0.6 | 1 | 1.15 | 1.3 | 0.5 | 0.5 |
| `fog` | fog distance × | 0.85 | 1 | 0.9 | 1.25 | 0.8 | 0.8 |
| `weather` | particle amount × | 0.7 | 1 | 1.2 | 1.4 | 0.6 | 0.6 |

(Starting values; tune in the browser.) Plus `audio.shape.phrase`: a counter that ticks every 8 bars (or ~16 s without a
tempo) while the section stays the same, so long grooves keep moving.
Neutral (Conductor off / no section): close 0, pace 1, fog 1, weather 1, phrase still ticks.
Pure function + eased state, testable in node (`tools/test-conductor.mjs` or a new `tools/test-shape.mjs`).

**1d. Kit and pipeline read it:**
- Camera rigs: `pace` multiplies travel speed. `close` narrows / widens FOV (±10 %) and, per rig, moves the eye along
  a safe axis: `OrbitRig` / `OrbitFocusRig` radius, `DollyRig` height offset (ground clamp still applies), `DriftRig`
  reach; `SweepRig` (fixed eye), `PathRig` (tunnels / roads) and `GridWanderRig` FOV only. A rig option `shapeAmount` (default 1, 0 = off)
  lets a style opt out where it would clip. On `phrase` ticks, rigs that have a free choice (orbit start angle, sweep
  centre yaw, drift glance) ease to a new framing over ~6 s.
- Fog: `renderer.fogScale` (set each frame from `shape.fog`) multiplies `near` / `far` inside `setFog`, so all styles
  get it without edits. Clamp so a style's fog never goes beyond ±25 %.
- Particles: kit `Particles` multiplies `amount` by `shape.weather` the same way it already does with `r.quality`.
- Debug overlay (D): a `shape:` line (section, close, pace, fog, weather, phrase).

### Phase 2 — bouncing pass (every style)

- Add to `K.drive`: `groove` (0..1 smooth swing: from `beatPhase` when `bpm > 0`, else the eased `beatPulse` with a long
  decay) and `beatMotion` (copied from `feel`).
- Go through all 36 styles (+ kit demo / kit calm). Every beat-triggered *movement* (`.kick(` on a beat, scale /
  position from `d.pulse`, hops on `beatCount`) is multiplied by `beatMotion`, and where the motion is part of the
  world's look it moves to `groove` or `energy` so it still breathes at Gentle. Direct per-frame `d.bass` / `d.high`
  driving *positions* is smoothed (eased ≥ 0.4 s) or moved to `energy`. Light / colour reactions are left alone.
- Done per style when: at Gentle with the demo track's band-like songs nothing jumps; at Punchy it looks like today.

### Phase 3 — moods for the Radiohead set (worlds 24–35)

**Kit helper `K.Moods`** (`js/kit/swell.js` or a new `js/kit/moods.js`):
```js
this.moods = new K.Moods({
  still:  { lamps: 1, camReach: 0.2, fogGreen: 0 },
  base:   { lamps: 3, camReach: 0.5, fogGreen: 0.2 },
  gather: { lamps: 5, camReach: 0.7, fogGreen: 0.5 },
  full:   { lamps: 8, camReach: 1,   fogGreen: 0.8 },
}, { map: { breakdown: 'still' }, ease: 6 });
// update(): this.moods.update(audio, k, dt);   read: this.moods.v.lamps
```
- Moods are numbers only, blended (so crossfades are free). Missing keys fall back to `base`.
- Default section → mood map: intro / outro / breakdown → `still`, groove → `base`, build → `gather`, drop → `full`.
  A style may override entries. Conductor off → `base`.
- Ease per transition default 6 s; into `full` on a drop 1.5 s; the style can set its own.
- *(Design call)* **Camera values always use the slow ease** (≥ 6 s, also on drops): `K.Moods` takes a list of
  "slow" keys (`{ slow: ['camReach', …] }`) that never ease faster than 6 s. Only light, particle and colour values
  get the 1.5 s drop ease. A wrong drop guess then costs a quick light change and a slow camera drift, never a fast move.
- *(Design call)* **How moods combine with `k`:** `base` means "today's behaviour": its values are the neutral
  factors (1 for gates, today's constants for positions), so Conductor off or a long groove looks like today. Features
  a style already stages by `k` (`stage(k, …)`) are **multiplied** by a mood gate (`still` < 1, `base` 1, `gather` /
  `full` ≥ 1, clamped to 0..1 after the multiply). So `k` still sets the ceiling, and a breakdown pulls the world back
  below where `k` alone would put it. New mood-only values (camera reach, which beams are on) are read directly, with
  anything that adds light or motion still × `k`.
- *(Design call)* **Style switch mid-song** (`dropSwitch`, auto-switch, setlist): `audio.shape` is global, so the
  incoming world gets the current values with no step. A style's `K.Moods` starts **already at** the current section's
  mood (no ease on the first update), so there's no second move on top of the crossfade.

**Per-world moods (my proposals, for the user to adjust):** `still` / `gather` / `full`; `base` = today's look.

| # | World | still | gather | full |
|---|---|---|---|---|
| 24 | Quiet House | one window, camera closest to the house | green creeps into the fog, more windows | every window lit, camera eases back to show the street |
| 25 | Moth Lamp | few moths, lamp dim, camera close | swarm tightens round the lamp | light floods, fog lifts |
| 26 | Under the Hull | shape far off, sky open | shape slides overhead | shape overhead, town lights all on, fog darkens |
| 27 | Still Pool | camera just above still water | reeds sway, ripples spread | camera lowers to skim the surface, ripples everywhere (no underwater view: that would be new rendering, out of scope) |
| 28 | Underriver | shallow, few figures | sinking faster, more figures | near the riverbed, star field bright |
| 29 | Before Dawn | inside the bedroom, one faint light | drift toward the window | out in the field, sky alight |
| 30 | Salt Flat | no wind, shimmer only | salt starts blowing | faster drift, horizon haze, dust storm |
| 31 | Searchlight Town | one slow beam, high wide view | more lights wake, beams converge | the melt / wobble peak |
| 32 | Back Road Lights | one light far off, camera low by the fence | lights gather over the farmhouse | beams down on the field |
| 33 | Paper Crowd | figures slumped, only the mic lit | rows rise front to back | all standing, ripples through the rows |
| 34 | Newsprint | a few pages float | stacks sway, pages gather | page storm around the camera |
| 35 | Right Place | blocks drift apart, few | grid forming | all blocks locked in rows, rearranging each bar |

Several of these already happen as `k` rises; the mood makes them follow the *section*, so a breakdown at `k = 0.45`
goes back to `still` instead of sitting at a half-built version of `full`.

## Verification

- Node: song-shape easing and neutral fallback; `K.Moods` blending and map; existing `test-conductor` / `test-output`
  still pass.
- Browser (pane, frames stepped by hand, see HANDOFF tips): every style at k = 0 and k = 1, Gentle and Punchy; scripted
  section sequence (intro → groove → build → drop → breakdown → outro) through `audio.section`, check no frame-to-frame
  jump in camera position larger than a threshold, no GL errors, budgets unchanged; camera not inside geometry at
  `close` = ±1 for each rig style (screenshots).
- Demo track third song (82–160 s, two builds + drops) watched with the debug overlay.
- `?bench` unchanged within noise.
- Not verifiable here: how it feels with real band songs in a visible window — the user's check.

## Left to the builder

- Exact sway shapes, easing curves and the starting table values (tune by eye).
- Whether `audio.shape` lives in `control.js` or a small `js/show/shape.js` module.
- How each Phase 2 style's beat moves are re-expressed (per-style judgment within the rule above).
- Per-world mood parameter names and values, within the table above.
- Splitting Phases 2 and 3 into parallel sessions (one per style group / per world) as in the wave process in HANDOFF.
