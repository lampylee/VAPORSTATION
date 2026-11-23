# PS2 mode: design

**Status:** moonshot. Not scheduled; nothing built yet. This doc says what it would take and in what order.

## Intent

A global **PS2 mode** toggle: the same environments, palettes, setlists and show control, rendered with the look of an
early-2000s console instead of a mid-90s one. Clean perspective-correct geometry, filtered textures, and the signature
PS2 "dream haze": frame-feedback smear, soft glow, heavy layered particles, fog and depth blur.

**Goals**
- One switch (panel, setlist cue and MIDI-learnable) that changes the whole look, crossfaded like everything else.
- Every existing environment works in PS2 mode without being rewritten. Environments that opt in to extra density look
  much better.
- The PS2 look gets its own audio reactions (trail length, haze strength), so it isn't PS1 with the wobble turned off.
- Stays inside the 60 fps budget on a mid-range laptop. The governor falls back to PS1 settings if it can't.

**Non-goals**
- Modern rendering: no PBR, real-time soft shadows, SSAO, TAA or HDR tonemapping. PS2 mode is still a period look.
- Emulating PS2 hardware quirks exactly (GS page layout, VU microcode). Only the look matters.
- A third "Dreamcast / GameCube" mode. Possible later on the same switches, but not designed here.

**Anti-goals (a failure even if it works)**
- "PS1 at a higher resolution": same blocky textures, same low-poly props, just sharper and blurrier.
- Anything recognisable from a specific PS2 game (its haze recipe, HUD, characters, levels).
- A pop when the mode flips, or the frame going black while targets are rebuilt.

## Hard-rule exemption (needs sign-off)

`CLAUDE.md` bans bloom, smooth gradients, mipmaps and AA. PS2 mode needs the first three. The proposal is a scoped
exemption, written into `CLAUDE.md`'s hard rules:

> In PS2 mode only, the pipeline may use bilinear filtering, mipmaps, a glow (haze) pass, frame feedback and depth blur.
> They live in `ps1.js` behind the mode, never in a style, and PS1 mode keeps every original rule. Still banned in both
> modes: MSAA/FXAA/TAA, soft shadows, PBR.

AA stays banned. PS2 games mostly shipped without it, and the jaggies are part of the look. Output stays 24-bit, with an
optional 16-bit + dither setting (many PS2 games dithered a 16-bit framebuffer).

## Budgets

| | PS1 mode (now) | PS2 mode |
|---|---|---|
| Internal resolution | 320×240 (or 426×240 / auto240) | 640×448, plus `auto448` matching the screen's aspect |
| Triangles per environment | ≤20k | ≤100k (aim for 60k) |
| Draw calls | ≤150 | ≤300 |
| Point lights | 4 | 8 |
| Colour | 15-bit + ordered dither | 24-bit, optional 16-bit + dither |
| Full-screen passes | composite + present | + feedback, haze (half res), depth blur (half res) |

The 100k figure is what PS2 games really drew per frame at 60 fps (a few million triangles a second), not the
marketing peak. WebGL2 handles that easily on a laptop. The real cost is fill: 640×448 is ~3.7× the pixels, then
the extra passes and a lot more alpha-blended particles on top. Measure it in `?bench` before committing to the numbers.

## The switch

`renderer.params.mode = 'ps1' | 'ps2'`, saved in settings like `resolution` and `colorBits` (`js/main.js` already copies
those into `renderer.params`). A mode is a bundle of the existing look params plus the new ones:

| Param | PS1 | PS2 |
|---|---|---|
| `resolution` | `320x240` | `640x448` |
| `jitter` | 1 | 0 (sub-pixel precision) |
| `affine` | 1 | 0 (perspective-correct) |
| `colorBits` | 5 | 8 (or 5 with the 16-bit option) |
| `filter` *(new)* | nearest | bilinear + mipmaps |
| `feedback` *(new)* | 0 | 0.15–0.6, audio-driven |
| `haze` *(new)* | 0 | 0.2–0.7, audio-driven |
| `dof` *(new)* | 0 | 0–1, per style |

**Crossfade, not a cut.** `resize()` currently frees and rebuilds targets when the resolution changes, which would blank a
frame. The transition becomes:
1. Snapshot the last composited frame (C) into a held texture.
2. Rebuild targets at the new size.
3. Over ~1.2 s: dissolve from the held snapshot to the live frame (the composite's existing dither dissolve, with
   nearest upscaling of the held frame). Ease `jitter`, `affine`, `feedback` and `haze` toward the new mode over the same
   time, so the wobble melts away rather than switching off.

`jitterBoost` (the show control's beat push on vertex snap) does nothing at `jitter` 0. In PS2 mode, that same beat push
drives a feedback "kick" (a brief zoom/rotate on the smear) instead. Gentle reactivity still zeroes it.

## Pipeline changes (`js/gfx/ps1.js`)

1. **Resolution.** Add `640x448` and `auto448` to `RESOLUTIONS`. `640x480` already exists.
2. **Filtered indexed textures.** Indexed textures store palette slots, so filtering the index texture would blend
   meaningless indices. Two options:
   - **(a) Decode on the GPU:** render each indexed texture through the live palette (CLUT) into an RGBA8 texture with
     mipmaps, re-rendered only when the palette changes or crossfades. Normal hardware filtering after that.
   - **(b) Manual bilinear filter:** in the shader, look up four texels through the palette and blend them. No mipmaps.
   - **Recommended: (a).** Mipmaps are part of the PS2 look (shimmer and visible LOD seams at grazing angles), and palette
     crossfades are infrequent enough that re-decoding is cheap. Note the extra memory cost. Palette crossfades re-decode
     each frame while they run; cap that to the textures visible in the current style.
3. **Feedback (ghosting).** A persistent target D holds the previous output. The composite blends D in, sampled with a
   slight zoom/rotate/offset (`uFeedback`, `uFeedbackXform`). Fade toward the fog colour so trails never build to white.
   Blackout and flash still apply after it, so a blackout always reaches black.
4. **Haze (the PS2 glow).** Downsample C to half res, threshold softly, apply a cheap separable blur (5–9 taps), and add it
   back in the composite. The 16-bit option still dithers after the haze, so gradients stay period-correct.
5. **Depth blur.** Needs depth as a texture: change the A/B depth renderbuffers to depth textures in PS2 mode. Mix the
   half-res blur in by distance from a focal plane (`r.setFocus(dist, range)` for styles; default off).
6. **8 point lights** in PS2 mode (`uPL[8]`), plus an optional per-vertex specular term (`uSpec`), off by default.
7. **Environment maps.** `o.envMap` on `draw()`: a sphere-map lookup from the view-space normal, blended by `o.envAmount`.
   The map itself is an indexed texture from `textures.js`, so it recolours with the palette.
8. **Alpha-blended particles.** A sorted, alpha/additive blend path next to the current screen-door (dither) transparency.
   PS1 mode keeps the screen-door look.
9. **Interlace shimmer** (optional) in the present pass, next to the CRT effect: alternate-field line weighting.

## Engine and kit changes

- **Palettes.** Keep the 4 ramps × 4 shades model and every saved palette. In PS2 mode, build a 256-entry CLUT by
  interpolating each ramp to 64 shades. Indexed textures that want the extra shades store 8-bit indices
  (`ramp * 64 + shade`); old 4-shade textures map `shade → shade * 21`. Roles (`fog`, `glow`, …) are unchanged.
  "Any palette recolours any environment" still holds.
- **Kit detail.** `renderer.quality` (0..1, set by the governor) already scales particle counts. Add a separate
  `renderer.detail` (1 = PS1, 2–4 = PS2) that kit generators read at `init`: terrain/floor subdivision, cylinder and arch
  segments, prop bevels, sky dome rings, foliage counts, particle caps. Styles get the density for free through the kit.
  Hand-built meshes in a style can read `r.detail` too.
- **Textures.** `js/kit/textures.js` generators take a `scale` (2× in PS2 mode) and use the 64-shade ramps, so filtered
  textures look smooth rather than smeared.
- **Changing detail needs a rebuild.** Detail is read at `init`, so a mode flip rebuilds the active style(s). Hide that
  inside the mode crossfade: build the new-mode style into B while A keeps running, then dissolve, as with style changes.
- **GLB loader (later).** Skinned meshes (bones, up to ~32 per mesh) for creatures and characters. Not needed for the first
  version.
- **Shadows (later).** Blob shadows (kit decal) first. Projected silhouette shadows only if a showpiece needs them.

## Safety, bench, self-test

- **Governor.** Steps down in order: depth blur off → haze to half strength → particle caps → `detail` down a step (at the
  next style change, never mid-song) → PS1 mode for this machine. It still only steps down.
- **Bench / `?selftest`.** Run each style in both modes. The heavy list is tracked per mode, so a style can be fine in PS1
  mode and marked heavy in PS2.
- **Watchdog.** Context restore rebuilds the new targets (D, haze, depth textures) and the decoded textures.
- **Debug overlay (D).** Shows the mode, `detail`, feedback and haze amounts.

## Phases

1. **Pipeline-only PS2.** Resolution, `jitter` / `affine` off, 24-bit, decoded textures with mipmaps, feedback, haze, the
   crossfaded switch, the jitter-push replacement, bench in both modes. Existing environments get the look at PS1 density.
   **Decision point:** look at 3–4 environments at a real gig size. If it isn't striking, stop here.
2. **Density.** `renderer.detail` through the kit, 2× textures, 64-shade ramps, governor rules, rebuild-on-flip.
   Upgrade one showpiece (Ember Vigil is the obvious candidate: fire light, fog, stone) as the reference.
3. **Extras.** 8 lights + specular, environment maps, the blended particle path, depth blur, interlace shimmer, then
   skinning and blob shadows if a scene wants them.
4. **Docs.** `docs/ENVIRONMENT-GUIDE.md` gets a PS2 section (what `detail` does, budgets, when to use `envMap` / `setFocus`);
   `js/styles/kit-demo.js` shows both modes.

## Open questions

- Is the hard-rule exemption acceptable as written?
- Per-setlist or per-song mode (a PS2 song in a PS1 set), or a single global switch? The crossfade supports either, and
  per-song costs little more once the switch exists.
- Does 640×448 hold 60 fps on the actual gig laptop with haze + feedback on? Phase 1's bench answers this.
- Do any environments stay PS1-only on purpose? For example a style marked `static meta = { ps2: false }` keeps the PS1
  look even with the switch on.
