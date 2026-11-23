# Projector Output + Operator View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The projector shows only the picture in its own window; the laptop shows a glanceable operator view; losing the projector never stops the show.

**Architecture:** `PS1Renderer` renders to an `OffscreenCanvas` it owns and hands each finished frame (`transferToImageBitmap`) to the current *sink*: the laptop `#view` (`bitmaprenderer`) in single mode, a same-origin popup (`output.html`) in dual mode. Both windows drive `frame()` through rAF; a `FrameGuard` runs at most one tick per display frame. An `Output` controller in `js/show/output.js` owns the window, sink switching and reconnects; `js/show/operator.js` draws the operator view.

**Tech Stack:** Plain ES modules, WebGL2, `OffscreenCanvas` + `ImageBitmapRenderingContext`, Window Management API (`getScreenDetails`), Node for pure-logic tests (`tools/test-*.mjs`, same style as `tools/test-conductor.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-23-projector-output-design.md`

## Global Constraints

- No build step, no runtime dependencies, works fully offline (`output.html` + its module go into the service worker warm list).
- 60 fps on a mid-range laptop; **no fps or CPU-ms regression in single mode** versus `main` (`?bench`, `window.benchResults`).
- Nothing ever hard-cuts; the projector is never black or frozen: fog cover after **0.5 s** without frames.
- The PS1 pipeline's look does not change; no new post effects.
- Projector-lost badge: text **"projector lost · W to reopen"**, shown **5 s**, then hidden. Picture otherwise clean.
- Operator view: big targets **≥ 64 px** tall, updates at **~10 Hz** except the preview (every frame), dark background, colour only for trouble, "Soft Vapor" UI (`css/style.css`, `js/icons.js`).
- Key **W** and a Show-card button "Projector output" open / reopen the projector; MIDI-learnable action id `output`.
- `s.output = 'single' | 'dual'`, default `'single'`; the app never opens a popup without a click.
- Kiosk: `kiosk.bat dual` → `?kiosk&dual`; plain `kiosk.bat` unchanged.

## Review Focus

1. **Footswitch with focus in the projector window** (after the fullscreen click): PageDown / → / ] must still step songs. Test: Task 4 Step 7.
2. **Main page reloads in dual mode** (watchdog `_reload`): projector shows fog within 0.5 s, then reattaches with no click. Test: Task 4 Step 8.
3. **One window's rAF stops** (laptop minimised under kiosk, projector occluded): the show keeps ticking, never double-steps. Test: Task 1 `FrameGuard` cases + Task 4 Step 9.
4. **Projector and laptop have different dpr / size** (1080p projector at dpr 1, laptop at 1.5): output size comes from the projector window, CRT and aspect correct. Test: Task 4 Step 10.
5. **HDMI replug lands in duplicate mode**: the laptop picture is clean except the 5 s badge; no operator chrome on screen. Test: Task 4 Step 11.

---

### Task 1: Pure logic: frame guard, health, screen pick

**Files:**
- Create: `js/show/output-logic.js`
- Test: `tools/test-output.mjs`

**Interfaces:**
- Produces:
  - `class FrameGuard { constructor(); tick(now: number): boolean; get interval(): number }`: true if this rAF call should run the frame. Runs if `now - last >= 0.6 * interval`; `interval` is an EMA of accepted frame gaps, initial 16.7 ms, gaps clamped to 4..100 ms.
  - `health({ wantLive, inputSignal, ctxLost, projector, governorTier, broken, audioSuspended }): { level: 'ok'|'amber'|'red', text: string }`. `projector` is `'none'|'open'|'lost'`. Red: `ctxLost` ("graphics reset"), `wantLive && !inputSignal` ("no input signal"). Amber: `projector==='lost'` ("projector lost"), `governorTier>0` ("reduced detail"), `broken>0` ("N environment(s) skipped"), `audioSuspended` ("audio paused"). Worst wins; first match in that order within a level. Else `{ level:'ok', text:'OK' }`.
  - `pickScreen(screens: Array<{isPrimary, left, top, width, height}>, here: {left, top}): object|null`: first non-primary screen; else the screen not containing `here`; null if only one.

- [ ] **Step 1: Write the failing tests** in `tools/test-output.mjs` (exit 1 on failure, like `test-conductor.mjs`):
  - `FrameGuard`: two windows calling at 60 Hz with a 3 ms offset → exactly one `true` per 16.7 ms frame over 600 calls (300 true ± 1); one caller stops after 100 frames → the other still gets one true per frame; 144 Hz caller → interval converges to ~6.9 ms within 60 frames.
  - `health`: all-clear → ok/'OK'; ctxLost + projector lost → red 'graphics reset'; projector lost only → amber 'projector lost'; broken 2 → amber '2 environments skipped'; wantLive && !inputSignal → red 'no input signal'.
  - `pickScreen`: [primary, secondary] → secondary; two non-primary-less screens with `here` on the first → the second; one screen → null.
- [ ] **Step 2: Run** `node tools/test-output.mjs`. Expected: fails (module missing).
- [ ] **Step 3: Implement** the three exports in `js/show/output-logic.js` (no DOM access).
- [ ] **Step 4: Run** `node tools/test-output.mjs`. Expected: `all output tests passed`, exit 0.
- [ ] **Step 5: Commit** `Output logic: frame guard, health, screen pick (+ node test)`.

### Task 2: Renderer renders off-screen; laptop `#view` is a sink (single mode only)

**Files:**
- Modify: `js/gfx/ps1.js` (constructor ~332, `restore`, `resize` ~508, `present` ~737, `snapshot` ~764)
- Modify: `js/main.js` (renderer creation ~24-33, `fullscreenchange` / `resize` listeners ~338-342, frame loop render block ~485-492)
- Modify: `js/safety/watchdog.js` (listen on `renderer.canvas`), `js/safety/governor.js` (calls `renderer.resize()` → unchanged API)
- Modify: `test.html` / `js/bench.js` only if they construct `PS1Renderer` with a DOM canvas.

**Interfaces:**
- Produces:
  - `new PS1Renderer()`: no argument; creates `this.canvas = new OffscreenCanvas(1, 1)` with the same `getContext('webgl2', …)` options.
  - `renderer.setOutputSize(cssW: number, cssH: number, dpr: number)`: stores them; `resize()` uses `min(dpr, maxDpr||∞)` × css size instead of `clientWidth/Height`. `resize()` keeps its signature (governor and `applyLook` call it).
  - `renderer.takeFrame(): ImageBitmap`: `this.canvas.transferToImageBitmap()`; call after `present()` and after any `snapshot` / preview draw.
  - `renderer.snapshot(ctx)` unchanged signature; draws from the OffscreenCanvas.
  - `class Sink { constructor(canvas: HTMLCanvasElement); show(bitmap: ImageBitmap): void; get size(): {w, h, dpr} }` in `js/show/output.js` (new file, only `Sink` in this task): `canvas.getContext('bitmaprenderer')`, `transferFromImageBitmap`; size from `canvas.clientWidth/Height` and `canvas.ownerDocument.defaultView.devicePixelRatio`.
  - `main.js` holds `let sink = new Sink(canvas)`; on resize / fullscreen: `renderer.setOutputSize(...sink.size)` then `renderer.resize()`.

- [ ] **Step 1: Baseline**: on `main`, in a visible real Chrome tab (chrome-devtools MCP or by the user), run `http://localhost:8080/?bench`; save `window.benchResults` as `bench-before.json` outside the repo (it is only compared, never committed).
- [ ] **Step 2: Implement** the renderer change, `Sink`, and main.js wiring. Frame order after `present()`: thumbnail `snapshot` (existing condition) → `sink.show(renderer.takeFrame())`. Skip `takeFrame` while `renderer.lost`.
- [ ] **Step 3: Verify in the Claude pane** with the hand-stepped loop from `docs/HANDOFF.md` (step frames; after each `present()` call `sink.show(renderer.takeFrame())`): every style at k=0 and k=1, `renderer.gl.getError() === 0`, picture visible (screenshot), env-browser thumbnails fill, resolution and aspect settings change size correctly, CRT toggle works.
- [ ] **Step 4: Context loss**: `renderer.gl.getExtension('WEBGL_lose_context').loseContext()` then `restoreContext()` after 0.8 s → fog cover shows, picture returns, no GL errors (watchdog now listens on the OffscreenCanvas).
- [ ] **Step 5: Bench compare**: `?bench` in visible Chrome again; per style, fps and CPU ms within noise of `bench-before.json` (no style > 5 % worse on mean CPU ms). Record the numbers in the commit message.
- [ ] **Step 6: Commit** `Renderer draws off-screen; frames go to a sink (single mode unchanged)`.

### Task 3: StyleManager commits to the next auto-switch target

**Files:**
- Modify: `js/styles/manager.js` (`goNext` ~82, `update` auto-switch ~93-100, `_fail` ~33)
- Test: `tools/test-manager.mjs` (fake renderer `{ clear(){}, … }` and three fake style classes with `meta`, `palette`, empty `init/update/render/dispose`)

**Interfaces:**
- Produces: `styles.upcoming: number`: the index the next `goNext(1)` / idle auto-switch will go to. Picked when the current target settles, re-picked only if it becomes broken / avoided / leaves `rotation`, or the operator calls `goTo` / `goNext`. The idle auto-switch calls `goTo(this.upcoming)`.

- [ ] **Step 1: Write failing tests**: rotation [1,2,3], cur 1 → `upcoming` 2; auto-switch fires → cur becomes 2 and `upcoming` 3; mark 3 broken → `upcoming` re-picks 1; set `pool` to [1,3] while on 2 → `upcoming` is 3; `upcoming` never equals `cur` when rotation length > 1.
- [ ] **Step 2: Run** `node tools/test-manager.mjs`. Expected: FAIL (`upcoming` undefined).
- [ ] **Step 3: Implement** `upcoming` (getter backed by a cached index validated against `rotation` each read; `goNext(1)` uses it).
- [ ] **Step 4: Run** both node tests. Expected: PASS.
- [ ] **Step 5: Commit** `StyleManager: committed upcoming style (preview never guesses)`.

### Task 4: Projector window, dual loop, sink switching, reconnect, badge

**Files:**
- Create: `output.html`, `js/show/output-page.js`
- Modify: `js/show/output.js` (add `Output`), `js/main.js` (loop driver, keys **W**, `showAction('output')`, `window.__vaporOutputAttach`), `js/show/ui.js` (Show card button), `js/show/midi.js` (action `['output', 'Projector output', 'button']`), `js/settings.js` (`output: 'single'` in `DEFAULTS`), `sw.js` (warm list gets `output.html`, `js/show/output-page.js`), `css/style.css` (badge)

**Interfaces:**
- Consumes: `FrameGuard`, `pickScreen` (Task 1); `Sink`, `renderer.setOutputSize/takeFrame` (Task 2).
- Produces:
  - `class Output { constructor({ laptopSink, onSinkChange(sink), onState(state) }); open(): Promise<void>; attach(win: Window): void; get state(): 'none'|'open'|'lost'; get sink(): Sink; get win(): Window|null; cover(on: boolean, fog: number[]): void; checkAlive(): void }`. `checkAlive()` is called each frame: `win.closed` → lost.
  - `output-page.js` exposes on its window: `__vaporOutput = { canvas, cover(on, fogRgb), lastFrameAt }`; it calls `opener.__vaporOutputAttach(window)` on load and every 250 ms while `!attached || now - lastFrameAt > 1000`; forwards `keydown` via `opener.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, repeat }))`; draws its own dithered fog cover (CSS like `watchdog._cover`) when `now - lastFrameAt > 500`; requests fullscreen on click / key; screen wake lock while fullscreen; posts `pagehide` → `opener.__vaporOutputGone?.()`.
  - `main.js`: `frame` is scheduled on both `window` and `output.win` rAF; each callback does `if (guard.tick(now)) frame(now)`, and only re-requests on its own window.

- [ ] **Step 1: Spike fullscreen** in real Chrome on Windows (chrome-devtools MCP or the user): (a) `win.document.documentElement.requestFullscreen({ screen })` from the opener's click handler; (b) click-in-window hint. Keep (a) if it works, else (b). Note the result in the spec's "Left to the builder".
- [ ] **Step 2: Implement** `output.html` / `output-page.js` (no imports beyond itself).
- [ ] **Step 3: Implement** `Output.open()`: `getScreenDetails()` (catch → no placement), `pickScreen`, `window.open('output.html', 'vaporstation-output', 'popup,left=…,top=…,width=…,height=…')`, then `attach`. `attach` swaps sink to `new Sink(win.__vaporOutput.canvas)`, sets `s.output='dual'`, starts the second rAF chain, resizes on the window's `resize`.
- [ ] **Step 4: Implement** loss: `pagehide`, `win.closed`, or `screenschange` removing its screen → sink back to laptop, `state='lost'`, laptop shows the badge for 5 s (`#outputBadge`, small, top-right corner, CSS fade).
- [ ] **Step 5: Wire** W key, Show card "Projector output" button (state: off / on / lost), MIDI action `output`, `s.output` saved. Watchdog `_showCover` also calls `output.cover(on, fog)`.
- [ ] **Step 6: Verify single mode untouched** in the Claude pane: no popup without a click; Task 2 Step 3 checks still pass.
- [ ] **Step 7 (Review Focus 1):** real Chrome: open the projector window, click it (focus there), press PageDown / → / ] / B / I → setlist steps and show actions fire once each (check `viz.setlist.pos`, `viz.show.blackout`).
- [ ] **Step 8 (Review Focus 2):** real Chrome dual mode: `location.reload()` on the main window → projector shows fog within 0.5 s, then frames resume within 1.5 s with no click; `viz.output.state === 'open'`.
- [ ] **Step 9 (Review Focus 3):** real Chrome dual mode: cover the laptop window / minimise it (under `kiosk.bat dual`), wait 10 s → projector keeps animating; `viz.renderer.params.time` advanced ~10 s (not 20).
- [ ] **Step 10 (Review Focus 4):** projector window at a different size / zoom (emulate dpr 1 vs 1.5 with chrome-devtools `emulate` or a real second screen) → `renderer.canvas.width/height` equals projector css × dpr (capped by `maxDpr`); aspect bars correct; CRT scanlines scale.
- [ ] **Step 11 (Review Focus 5):** close the projector window → laptop shows the picture with only the badge; badge gone after 5 s; no operator chrome; W reopens.
- [ ] **Step 12:** dual mode, every style at k=0 / k=1 via `?bench` with the projector open; `WEBGL_lose_context` in dual mode → fog on both, picture back on the projector.
- [ ] **Step 13: Commit** `Projector output window: dual rAF, sink switching, reconnect, lost badge`.

### Task 5: Operator view

**Files:**
- Create: `js/show/operator.js`
- Modify: `js/main.js` (create it, show while `output.state==='open'`, update calls), `index.html` (`<section id="operator" hidden>`), `css/style.css`

**Interfaces:**
- Consumes: `health()` (Task 1), `styles.upcoming` (Task 3), `Output.state` (Task 4), existing `setlist`, `conductor.section`, `show`, `envBrowser` thumbnail canvases (`envBrowser.ctx(i).canvas`), `showAction`, `stepSong`.
- Produces: `class OperatorView { constructor(root: HTMLElement, h: { onAction(id), onNextSong(), onOpenOutput() }); set visible(v: boolean); drawPreview(src: OffscreenCanvas, shown: [x,y,w,h], h: number): void; update(info): void }` where `info = { songLine, section, intensity, next: { label, envName, paletteName, thumb: HTMLCanvasElement|null }, meterDb, thresholdDb, health, buttons: { hold, freeze, blackout } , outputState }`.

- [ ] **Step 1: Implement** the layout from the spec sketch: song line + section + intensity bar (top, large type); preview canvas (~1/3 width) drawn every frame from `renderer.canvas` before `takeFrame()`; Next block with thumbnail; input meter; health light; buttons Hold / Freeze / Blackout / Big moment / Next song (≥ 64 px). With `outputState==='none'` and `s.output==='dual'`: one big "Open projector output" button instead.
- [ ] **Step 2: Wire** in `main.js`: preview draw in the frame order (snapshot → preview → takeFrame); `update` at 10 Hz; H still toggles the panel over it; D debug overlay still shows.
- [ ] **Step 3: Verify** in the Claude pane by forcing `viz.operator.visible = true` with the projector absent: layout at 1366×768 and 1920×1080 (screenshots), buttons fire their actions, health light turns red when `renderer.lost` is set, Next shows `styles.upcoming` with setlists off and the cued song with setlists on.
- [ ] **Step 4: Verify** in real Chrome dual mode that the operator view appears on open and disappears on loss; `?bench` with the projector open shows no drop from the preview.
- [ ] **Step 5: Commit** `Operator view: glanceable status, preview, next, big buttons`.

### Task 6: Kiosk dual, self-test line, docs

**Files:**
- Modify: `kiosk.bat`, `js/main.js` (`?dual` param), `js/safety/selftest.js`, `README.md`, `docs/HANDOFF.md`, `ROADMAP.md`, `docs/superpowers/specs/2026-11-23-projector-output-design.md` (record spike results)

- [ ] **Step 1: Spike** kiosk + popup in real Chrome: with `--kiosk`, does `window.open` from Task 4 land on the second screen and go fullscreen? Try pre-granting window-management for the kiosk profile; find flags so that from double-clicking `kiosk.bat dual` to projector fullscreen takes **at most one click or keypress** beyond single kiosk.
- [ ] **Step 2: Implement** `kiosk.bat dual` (opens `?kiosk&dual`; laptop shows the operator view, cursor visible, the open button front and centre). Plain `kiosk.bat` byte-identical behaviour.
- [ ] **Step 3: Self-test** report gains an INFO line: screens found and window-management permission state.
- [ ] **Step 4: Docs**: README (how to run with a projector), HANDOFF (status, what's verified vs not), ROADMAP (Phase 5 item), spec "Left to the builder" filled in.
- [ ] **Step 5: Run** `node tools/test-output.mjs`, `node tools/test-manager.mjs`, `node tools/test-conductor.mjs`. Expected: all pass.
- [ ] **Step 6: Commit** `Kiosk dual mode, self-test screens line, docs`.
