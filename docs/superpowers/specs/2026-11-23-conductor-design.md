# The Conductor: design

## Intent

Today intensity (`k`, the number every style builds with) goes from 0 to 1 about 2 s after a song starts (`rampUp`) and
stays at 1 until the song ends. So each style's whole build-up (candles lighting down the hall, the eclipse and colossus, the
hull sliding over the town, the ignition) plays in the first seconds, and the song then sits at the peak, moved only by beats
and loudness.

The Conductor listens across the whole song and shapes intensity to it: a slow build through the song, falling back for
breakdowns and quiet verses, climbing through build-ups, and the top of the range (where the biggest moments live) saved for
the drop. It also estimates tempo by itself so camera moves can land on bars without tap tempo.

**Goals**
- `k` follows the song's shape; the peak lands on drops. All 40 styles benefit with no per-style changes.
- New signals for styles and the kit: `audio.section`, `audio.build` (0..1 anticipation), `audio.drop` (one frame),
  `audio.songTime`; `audio.bpm / beatPhase / bar` filled from an automatic estimate when nothing is tapped.
- Optional (user's choice, **off by default**): change environment on a big drop, at most once per song.
- Never a hard cut: every change to `k` is eased; the drop rises fast but still eased.

**Non-goals**
- Real music-information retrieval (key, chords, lyrics, stems). Sections are guessed from energy, bass and highs only.
- Per-style rewrites. Styles may use `audio.build` / `audio.drop` later; this pass only adds it to shared kit code.

**Anti-goals (a failure even if it works)**
- A song that is loud from the first second looking dead for a minute. (It starts around the middle of the range and
  grows; a drop or sustained energy reaches the peak sooner.)
- Intensity pumping with every bar (the section guess flickering). Sections need several seconds of evidence and hold for
  a minimum time.
- Hold, Big moment, Feel, tap tempo or blackout behaving differently. Operator controls always win.

## Approaches considered

1. **Shape `k` from section detection** *(picked)*: a small state machine over smoothed energy / bass / highs, feeding a
   target intensity that `k` eases toward.
2. Only expose sections and leave `k` alone: styles would each need code to use them, and the 2 s problem stays.
3. A beat-tracking library (Essentia.js etc.): heavier, a runtime dependency, and still needs the same intensity logic.

The user approved "intensity follows the song's shape" and "change world on drops: option, off by default".

## How it works

New `js/show/conductor.js` (pure logic, no DOM / GL, so it can be tested in node). In `main.js` it sits between the play
state and show control:

```
analyser ─► PlayState (playing, k_play) ─► Conductor.process(a, k_play, playing, dt, s) ─► ShowControl.process ─► styles
```

**Per song.** A song starts when `playing` goes true after silence (a short mid-song stop that never let `k_play` reach 0 is
the same song) and ends when `k_play` reaches 0.

**Features (per frame, from the analyser's raw output):** `Es` = energy smoothed ~1.5 s, `El` = energy smoothed ~20 s,
`bassS` / `highS` smoothed ~1 s, `slope` = rise of `Es` over the last ~6 s (from a ring buffer sampled at 10 Hz).

**Sections** (each must hold ≥ ~4 s before the next, except a drop):
- `intro`: the first ~8 s of a song.
- `groove`: the default.
- `build`: `Es` rising steadily (`slope` above a threshold over ≥ 4 s) or highs rising while bass falls (a riser).
  `audio.build` = how far into it (0..1, by duration and rise), eased; it falls back to 0 over ~1 s after the build ends.
- `drop`: `Es` jumps well above its minimum of the last ~4 s with the bass back, either after a build / breakdown or out
  of nowhere if the jump is big. `audio.drop = true` for one frame; section `drop` holds ~8 bars (or ~16 s).
- `breakdown`: `Es` well under `El` (ratio < ~0.6) with low bass for ≥ 3 s.
- `outro`: energy fading toward silence near the end (`Es` falling and `El` falling for ≥ 8 s).

**Intensity target:**
- `arc`: grows with song time from 0 to 1 over ~75 s (eased); it also grows faster while energy is high.
- base = `lerp(0.45, 0.82, arc)` × energy factor (`0.7 + 0.45 × Es/El`, clamped), so loud songs start near the middle.
- `breakdown` pulls the target down to ~0.35–0.45; `build` lifts it gently toward 0.85 with `audio.build`.
- The top band (0.85 → 1) is **reserved for drops**: a drop sets a peak envelope to 1 that holds through the drop section
  then decays over ~20 s back toward the base. If a song never drops but stays high (≥ ~2.5 min of high energy), the cap
  lifts slowly so it still reaches the peak.
- `k = k_play × shaped`, where `shaped` eases toward the target (rise ~3 s, fall ~6 s; on a drop rise ~0.4 s, smooth).
  `k_play` still handles start / stop and silence exactly as now.

**Auto tempo:** inter-onset intervals of detected beats over the last ~12 s, folded into 80–170 BPM, voted in a histogram;
the peak with enough support (confidence ≥ ~0.5) gives `bpm`, the latest beats give phase, and a counter gives `bar`.
Tap tempo, when set, wins. With no confident estimate, `bpm` stays 0 as today.

**Drop world change (off by default):** setting `s.dropSwitch`. On a drop, if the song is ≥ ~45 s in, a build or breakdown
came before it, and no change has happened this song: `styles.goNext()` (the normal crossfade; it respects the setlist
pool and the heavy / broken lists).

**Shared kit (all styles):** camera rigs narrow the FOV slightly and settle during `audio.build` (scaled by `feel.motion`),
and release it with a punch on `audio.drop`. `K.drive` passes `build` and `drop` through (scaled by `k`).

**Controls:** Show card gets "Follow song" (`s.conductor`, default on; off = today's behaviour exactly) and "Change world on
drops" (`s.dropSwitch`, default off), both MIDI-learnable. The debug overlay (D) gets a `song:` line: section, song time,
arc, build, auto bpm and confidence.

## Verification

- A node test (`tools/test-conductor.js`) feeds scripted analyser frames for synthetic songs (intro → groove → build →
  drop → breakdown → build → drop → outro; a flat loud song; a quiet ballad; a song with a 1.2 s stop) and checks the
  section sequence, that `k` never jumps more than a set amount per frame, that the peak lands within ~0.5 s of each drop,
  that the flat loud song starts ≥ 0.5 and still reaches ~1, and the auto tempo on a steady 120 BPM kick.
- The demo track gains a build + drop so it can be checked by ear and eye in the browser; debug overlay readout.
- "Follow song" off gives the old `k` exactly. Hold / Big moment / tap tempo unchanged. All 40 styles clean.

## Build notes (2026-11-23)

- Built as designed: `js/show/conductor.js`, wired in `main.js` between the play state and show control. Show control
  passes `section / build / drop / songTime` through and uses the auto tempo when nothing is tapped.
- **Features use the analyser's raw values** (`a.raw.level / bass / high`), since auto-gain flattens the normalised bands.
- **A drop is the bass coming back:** after a build / breakdown it needs a level jump of ×1.4 over the 4 s minimum and the
  bass ×2 over its own; out of nowhere ×2.7 and ×2.7. 24 s minimum between drops. A drop section ends early if a breakdown
  starts (≥ 4 s in).
- **Riser:** highs ×1.3 over their average while the bass drains below ×0.7, even though the overall level may fall as the
  kick drops out (the demo's first build only reads this way).
- **The no-drop cap lift** counts only time with a steady beat (≥ 10 beats in the tempo window) near the song's average, so a
  quiet ballad never reaches the drop band.
- **Breakdowns drain the drop peak faster** (2.5 s instead of 8 s) and `k` falls with a 4 s constant there (6 s elsewhere).
- **Auto tempo refine:** beats are frame-quantised, so the estimate counts whole half-beats across the 12 s window instead of
  averaging intervals (174 bpm reads 87.0, the demo's 126 reads 126-128).
- **Kit:** `CameraRig` eases `tension` toward `audio.build × k` (× 0.35-1 by `feel.motion`), narrowing the FOV by up to 7 %,
  and on `audio.drop` punches (1.6 × k × motion) and nudges. `K.drive` returns `build` and `drop`.
- **Controls:** Show card rows *Follow song* and *Change world on drops*; MIDI actions `conductor` and `dropSwitch` (toggles).
- **Demo track:** a third song (82-160 s, 126 bpm): groove, riser build, drop, pad breakdown, build, drop, fade. In the pane it
  reads intro > groove > build > drop > groove > breakdown > build > drop, both drops peaking within ~1 s.
- **Checked:** `node tools/test-conductor.mjs` (25 checks: section order, two drops within 0.6 s of the script and peaking
  within 0.6 s, the top band kept for drops, per-frame steps of k at most 0.016 (limit 0.03), flat loud song ≥ 0.5 then 1, ballad ≤ 0.85, the 1.2 s
  stop, 120 / 174 bpm, off = old `k`); the demo track in the pane; all 40 styles with build / drop forced (no errors, ≤ 83
  draws, ≤ 18.1k tris). Not checked: real songs, or how the camera tension looks in a visible window.

## Left to the builder

Exact thresholds and time constants (tuned on the synthetic songs and the demo track), the riser heuristic, how the camera
build-tension looks, the debug readout format.
