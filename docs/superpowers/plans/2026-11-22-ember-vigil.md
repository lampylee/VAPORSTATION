# Ember Vigil Implementation Plan

> Executed natively in one session (user asked for no agent fan-out). Steps use checkboxes.

**Goal:** the Ember Vigil environment plus the kit / pipeline pieces it needs.
**Architecture:** pipeline gains per-vertex point lights; new kit pieces live in the existing kit files (shapes, props,
sprites, textures) plus one new `js/kit/fantasy.js` for the effects (Fire, Candles, Lightning); the style composes them.
**Tech stack:** plain ES modules + WebGL2, no build step. Verification is in the browser (no unit-test framework here).
**Spec:** `docs/superpowers/specs/2026-11-22-ember-vigil-design.md`

## Global Constraints
- ≤150 draws, ≤20k tris (target ≤70 / ≤14k); 320×240; colours only via palette indices; nothing pops; every reaction × k.
- No post effects, no smooth gradients; original content only.

## Review Focus
1. Other styles must render identically after the point-light change (pixel diff 0 %).
2. Thumbnail `update` with k = 0 before the style is ever shown must not throw.
3. Light and dark palettes: the scene must still read (no white-out from point lights; additive glows on light fog).
4. Gentle Feel: lightning / ember bursts must not strobe (BarClock-gated, accent-scaled).
5. Crossfade in / out and `dispose()` free every buffer (no GL errors after dispose + re-init).

---

### Task 1: Point lights in the pipeline
- Modify `js/gfx/ps1.js`: world shader `uniform vec4 uPL[4]` (xyz pos, w radius) + `uPLc[4]` (rgb) + `uPLn`; per-vertex
  `lit += c * max(dot(n, L), 0) * f²` with `f = clamp(1 - d / radius, 0, 1)`, plus a small non-directional share (0.25) so
  faces turned away still glow a little. Skipped for unlit draws. `r.setPointLights(list)` (≤4 `{pos, color, radius}`),
  reset to 0 in `beginScene`.
- Verify: pixel diff of 3 existing styles before/after = 0 %; a test call lights the kit demo floor.

### Task 2: Kit geometry + textures
- `shapes.roseWindow`, `props.gothicPier`, `props.keep`, `props.knight` in shapes / props; `tex.flagstones`, `tex.ashlar`;
  `sprites.tatteredBanner`, `sprites.colossus`, `sprites.corona`.
- Verify: each builds without NaNs (count > 0, finite positions), tri counts logged.

### Task 3: Kit effects `js/kit/fantasy.js`
- `Fire(r, {scale})` → `update(dt, {level, burst})`, `draw(r)`, `.light`, `pointLight(pos)`; `Candles(r, {max})` →
  `set(i, x, y, z, level)`, `upload(n)`, `draw(r)`; `Lightning(r)` → `strike(from, to)`, `update(dt)`, `draw(r)`, `.flash`.
  Export via `js/kit/index.js`.

### Task 4: The style
- `js/styles/ember-vigil.js`, register in `index.js`. Composition, swell table and audio map from the spec.
- Verify: k = 0 / 0.5 / 1 screenshots, Gentle + Punchy, 3 palettes, dispose, crossfade, budget, `?bench`.

### Task 5: Docs + commit
- Guide kit table rows, HANDOFF styles table, commit.
