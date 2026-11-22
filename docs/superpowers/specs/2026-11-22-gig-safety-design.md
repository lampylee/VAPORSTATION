# Gig-safety layer (Phase 5)

Goal: at a gig the screen never goes black, never freezes, and never stutters badly,
whatever the GPU, driver, audio interface or one buggy environment does. Every recovery
looks like an ordinary crossfade or a slow fog fade, never a cut.

## 1. Performance governor (`js/safety/governor.js`)

Watches real frame time (raw rAF delta, not the clamped `dt`). Ignores frames while the
page is hidden, the first 5 s after start or a GL restore, and gaps over 0.5 s (tab
switches, debugger). A "slow window" is 3 s with mean fps under 45 (so a 50 Hz display
does not trip it). Steps only go down, one per slow window, cheapest/most invisible first:

| Tier | Action | Visible? |
|---|---|---|
| 1 | Cap the canvas backbuffer at devicePixelRatio 1 (`renderer.params.maxDpr`) | No: the 240p image is nearest-upscaled either way |
| 2 | Particle quality ramps 1 → 0.6 over 3 s (`renderer.quality`, read by kit `Particles`) | Barely: fewer flakes/drops, ramped |
| 3 | The style showing is marked **heavy** on this machine (localStorage `vaporstation.heavy`) and leaves the auto rotation. If fps is under 30 it crossfades away now; otherwise it just isn't picked again | Ordinary crossfade |

Tier 3 can repeat per style. Measurement pauses during crossfades (two styles render then).
Off in `?bench`. `viz.governor` exposes `tier`, `heavy`, `reset()`. Debug overlay shows the tier.

## 2. Watchdog and recovery (`js/safety/watchdog.js` + hooks)

- **Style errors.** `StyleManager` wraps each style's `update` / `render`. A throw marks the
  style `broken` for the session (logged once), its scene is just cleared to fog, it leaves
  the rotation, and if it is showing the manager crossfades to the next style. One bad
  environment can no longer kill the frame loop.
- **Frame loop errors.** The rest of `frame()` is guarded too; an exception is logged
  (rate-limited) and the next frame still runs.
- **WebGL context loss.** `webglcontextlost` → `preventDefault()`, a fog-coloured cover
  (last fog colour, 4×4 dither pattern) fades in over 0.3 s. `webglcontextrestored` →
  `renderer.restore()` rebuilds programs, targets and CLUTs; `styles.rebuild()` re-creates
  every style and palette (keeping current/next style, palette override and pool); the
  cover fades out over 1.5 s. If no restore comes within 6 s, or the rebuild throws, the
  page reloads (settings already persist style, palette and input device, and live input
  reopens on load).
- **Audio.** `AudioContext` `statechange` to suspended/interrupted while input is wanted →
  try `resume()` (works after the first gesture). A live track `ended` → retry `startLive`
  with backoff (0.5, 1, 2, 4… max 10 s) while `liveWanted`. A live stream that delivers
  exact digital zero for 8 s (a dead stream; a real line has a noise floor) is reopened.
  Status line shows what happened.

## 3. Later (not in this pass)

- Offline PWA (service worker, cache every module and the demo) + a kiosk launcher
  (Chrome `--kiosk --autoplay-policy=no-user-gesture-required`, audio permission pre-granted).
- Pre-show self-test page: GPU, fps per style on this machine (feeds the heavy list), input
  levels, MIDI.
- GitHub remote (the user creates the repo).
