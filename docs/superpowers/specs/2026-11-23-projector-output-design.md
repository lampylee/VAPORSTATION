# Projector output + operator view — design

Status: draft for approval (2026-11-23). Follow-up after this: live camera feed (separate spec).

## Intent

At a gig the laptop drives the projector, and today the picture and the control panel share one window. Fullscreen hides
the panel, so whoever runs the show is blind to what the app thinks is happening.

The person at the laptop is **a member of the band, playing at the same time**. They look at the laptop for a second or two
between phrases, from up to ~2 m away, with their hands mostly on an instrument. They step songs with the footswitch / MIDI
and touch the laptop between songs at most.

So: the projector shows **only the picture**, in its own window. The laptop screen becomes a **glanceable operator view**
that answers "is it working?" and "what's next?" in one look, and has a few big buttons for one quick tap.

## Goals

- A second window, fullscreen on the projector, showing exactly the picture the app renders today.
- A laptop operator view: live preview, song / section / intensity, what's cued next, input meter, one health light,
  big show buttons.
- Losing the projector (window closed, cable pulled, screen gone) never stops the show: the picture falls back to the
  laptop screen and the health light says so; one action reopens it.
- Single-screen use (rehearsal, a laptop without a projector) behaves exactly as today.

## Non-goals

- Remote control from another device (phone / tablet / network). Not now.
- More than two windows, or different pictures on different outputs.
- Editing in the operator view: palettes, setlist editor and settings stay in the existing panel (one keypress away, for
  soundcheck).

## Anti-goals (a failure even if it "works")

- Anything that can leave the projector black or frozen while the laptop still runs (or vice versa).
- Any fps drop in single-screen mode, or a noticeable one in dual mode (measure with `?bench`).
- An operator view that needs reading: small text, many numbers, colour used for decoration rather than trouble.
- A second copy of the app (audio / styles / Conductor) in the projector window: double analysis, drifting pictures.

## Constraints

- Hard rules from `CLAUDE.md`: no build step, no dependencies, offline, 60 fps, nothing hard-cuts. The PS1 pipeline's look
  does not change.
- A WebGL context belongs to one canvas. The projector window is a same-origin popup (`window.open`), so the opener can
  reach its DOM directly.
- Placing a window on another screen needs Chrome's Window Management API (`getScreenDetails`, permission
  `window-management`). Fullscreen needs user activation **in the window being made fullscreen**.
- The window that owns the `requestAnimationFrame` loop must stay visible, or the loop pauses.
- The Claude browser pane cannot show popups or a second display; dual mode is verified in real Chrome (see Verification).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Keep rendering to the laptop canvas at projector size, copy each frame to a 2D canvas in the projector window | Least change; but a full-resolution copy every frame, and the laptop canvas renders at projector size while shown small |
| **B** | **Render to an `OffscreenCanvas` sized to the output, hand each finished frame over as an `ImageBitmap` (`transferToImageBitmap` → `bitmaprenderer`, zero copy); draw the preview from it first** | Small contained renderer change (explicit output size instead of measuring the page); cheapest per frame; the renderer survives the projector window disappearing |
| C | Move the WebGL canvas itself into the projector window's document | No copies, but closing that window or unplugging takes the canvas and context with it → full rebuild mid-show |
| — | Second app instance in the popup, synced by `BroadcastChannel` | Rejected: double audio analysis, pictures drift |

**Picked: B** (the user chose it). Reason: barely more work than A, cheapest per frame, and the only one where losing the
projector is a non-event.

## Design

### 1. Renderer renders to an off-screen canvas, frames go to a "sink"

- `PS1Renderer` gets its WebGL2 context from an `OffscreenCanvas` it owns, **in both single and dual mode** (one code path;
  my call, so there is nothing dual-only to rot). `#view` on the laptop becomes a `bitmaprenderer` canvas.
- The output size is set explicitly: `renderer.setOutputSize(w, h)` (device pixels, after the governor's `maxDpr` cap)
  replaces reading `canvas.clientWidth`. The **current sink** reports its size: the laptop `#view` (client size × dpr) in
  single mode, the projector window (`innerWidth/innerHeight × its devicePixelRatio`) in dual mode. Resize / fullscreen /
  dpr changes on the current sink's window call it.
- `present()` is unchanged in what it draws. After it, the frame loop does, in this order, in the same task:
  1. thumbnail capture (`renderer.snapshot`, now drawing from the `OffscreenCanvas`), as today;
  2. in dual mode, the operator preview: `drawImage` of the OffscreenCanvas into a small 2D canvas (nearest, the shown rect
     only);
  3. `transferToImageBitmap()` → `sink.transferFromImageBitmap(bitmap)`.
- Context loss: the watchdog listens for `webglcontextlost` / `webglcontextrestored` on the OffscreenCanvas (Chrome fires
  them there). The fog cover it draws today must show on whichever sink is current.

### 2. The projector window

- `output.html`: a black page with one full-window `bitmaprenderer` canvas, cursor hidden, and one small module
  (`js/show/output-page.js`) that only:
  - tells the opener its size, its dpr, and when it closes (`pagehide`);
  - **forwards every `keydown`** to the opener's key handler (the USB footswitch sends PageDown / → / ]; after the
    fullscreen click this window has focus, and keys must work whichever window has it);
  - **covers a stall:** if no frame has arrived for 0.5 s, it draws a dithered fog cover itself (Bayer-pattern dither of the
    last fog colour the opener sent, never black, never a frozen picture), and drops it when frames resume;
  - **reconnects after the opener reloads** (the watchdog's last-resort `location.reload()`): it polls
    `window.opener.__vaporOutputAttach?.(window)` every 250 ms while disconnected, so the reloaded app adopts the
    existing window without a click and without `window.open` (my call).

  Added to the service worker's warm list. Everything else stays in the opener.
- **Opening** (button "Projector output" in the Show card, key **W**, my call; also a MIDI-learnable action):
  1. `getScreenDetails()`; pick a screen that is not the laptop's (`!isPrimary`, else the one not containing this window).
     If permission is refused or there is only one screen, open the window anyway at a normal size on this screen, and the
     operator drags it over.
  2. `window.open('output.html', 'vaporstation-output', 'popup,left,top,width,height' of that screen)`.
  3. Fullscreen: the projector window shows a large "click to go fullscreen" hint until it is fullscreen; any click or key
     in it calls `requestFullscreen()`. If Chrome allows fullscreen on the target screen straight from the opener's click
     (`requestFullscreen({ screen })` via the opened window), use that and skip the hint. **Builder: spike which works in
     current Chrome on Windows and keep the one that needs the fewest operator actions.**
- **Frame loop: both windows request rAF; whichever fires first runs the frame** (my call). `frame()` is called from
  the laptop window's rAF and, while open, the projector window's rAF; a guard runs at most one tick per display frame
  (skip if less than ~0.6 of the last measured frame interval has passed). So the show keeps running if either window's
  rAF stops (laptop covered or minimised, projector window occluded / its display asleep / moved by the OS), with no
  stall detection to get wrong. The frame `dt` still comes from real time, so two windows never double-step.
- **Losing it** (`pagehide`, `closed` seen true, or `screenschange` removing its screen): within one frame the sink switches
  back to the laptop `#view` and the laptop shows the clean picture as in single mode (no crossfade needed: same frame
  stream). Because a replugged HDMI cable on Windows often lands in duplicate mode (the laptop screen is then on the
  projector), the only chrome is a **small corner badge "projector lost · W to reopen", shown for 5 s, then hidden** (the
  user's choice). The health light in the panel / operator view stays amber until reopened; **H** shows the panel as
  usual. W / the button reopens. The renderer, styles and audio are untouched.
- **Normal Chrome vs kiosk:** dual mode works in a normal Chrome window while the laptop window stays visible.
  "Minimise the laptop window and everything keeps running" is guaranteed only under `kiosk.bat dual` (it disables
  background timer throttling, which the watchdog's timers rely on). The projector window also requests a screen wake
  lock while fullscreen.
- `s.output = 'single' | 'dual'` is remembered. On load with `dual` saved, the app does **not** pop a window by itself
  (browsers block popups without a click); the operator view shows one big "Open projector output" button instead.

### 3. The operator view (laptop, while the projector window is open)

Shown instead of the picture on the laptop. Readable from ~2 m: large type, few numbers, colour only for trouble.

```
┌──────────────────────────────────────────────┐
│  ▶ 3/9  Song Title             BUILD ▮▮▮▮▮▯  │
│  ┌─────────────┐   NEXT: Fog Harbour · Kid A │
│  │ live output │   ┌───────┐                 │
│  │  preview    │   │ next  │   input ▮▮▮▮▯   │
│  └─────────────┘   └───────┘   ● OK          │
│ [HOLD] [FREEZE] [BLACKOUT] [BIG]  [NEXT SONG] │
└──────────────────────────────────────────────┘
```

- **Song line:** setlist position + song label (`setlist`), or the environment name when setlists are off.
  Conductor section (intro / groove / build / drop / breakdown / outro) + an intensity bar (`k` after show control).
  When the Conductor is off, just the intensity bar.
- **Live preview:** the frame drawn in step 1.2, every frame, about 1/3 of the screen width.
- **Next:** what a footswitch press would bring: the cued (or next) song's label, its environment and palette names, and
  its thumbnail from the environment browser's existing canvases. When setlists are off: the next environment the idle
  auto-switch will go to. `StyleManager` picks that target ahead of time and commits to it (re-picked only if it becomes
  broken / heavy or the operator changes environment), so the preview is never a guess (my call).
- **Input meter:** the same level and threshold the panel meter shows.
- **Health light:** green "OK", or amber / red with a short reason, the worst one shown:
  red = no input signal while live is wanted, context lost; amber = projector lost, governor stepped down, a style broken,
  audio suspended. Built from `watchdog`, `governor`, `styles`, `engine` state that exists today.
- **Buttons:** Hold, Freeze, Blackout, Big moment, Next song, wired to the existing `showAction` / `stepSong`; they show
  their on / off state. Big targets (≥ 64 px tall).
- Keys, MIDI and the footswitch work exactly as today (the laptop window has focus). **H** still opens the full panel over
  the operator view; **D** debug overlay too.
- Style: the existing "Soft Vapor" UI (`css/style.css`, `js/icons.js`), dark background so the laptop screen doesn't glow
  on a dark stage.
- Updates at ~10 Hz except the preview (every frame).

### 4. Kiosk

- `kiosk.bat dual` (argument, my call) opens `?kiosk&dual`: laptop shows the operator view with the cursor visible, live
  input on, and the "Open projector output" button front and centre. Requirement: from double-clicking `kiosk.bat dual` to
  the projector fullscreen takes **at most one click or keypress by the operator** beyond what single kiosk needs.
  Builder: find the Chrome flags / approach that meets this (e.g. `--kiosk` interacts with popups; window-management
  permission may need pre-granting for that profile).
- Plain `kiosk.bat` stays single-screen and unchanged.

## Verification

- `?bench` and `?selftest` in single mode: no fps or CPU-ms regression versus `main` (compare `window.benchResults`).
- Real Chrome, two displays (or one display with the projector window as a normal window): open / close / reopen,
  drag across screens, resize, fullscreen; pull the HDMI cable; lose the context (`WEBGL_lose_context`) in dual mode;
  minimise the laptop window (picture must keep running, under `kiosk.bat dual`); footswitch / hotkeys with focus in each
  window; reload the main page (projector shows fog, then reconnects with no click); every style at k=0 / k=1 in dual
  mode; thumbnails still fill.
- The Claude pane can verify single mode only (popups and second screens don't work there).
- Self-test report gains an INFO line: screens found, window-management permission state.

## Left to the builder

- Module layout (suggest `js/show/output.js` for the sink / window logic, `js/show/operator.js` for the view).
- Exact operator-view proportions and type sizes within the sketch.
- ~~The fullscreen and kiosk spikes named above.~~ Done, see below.
- How the fog cover during context loss reaches the current sink.

**Decided (Task 4, 2026-11-23):**
- **Fullscreen spike** (Chrome 157, Windows, one display, driven over the DevTools protocol): (a) calling
  `win.document.documentElement.requestFullscreen()` on the projector window from the opener's click handler is refused
  (`TypeError: Permissions check failed`; the opener had transient activation, the popup did not). (b) a click in the
  projector window goes fullscreen. **Kept (b):** the window shows "Click to go fullscreen" until it is fullscreen; any
  click or key in it requests fullscreen (and keys are still forwarded). Not tried: Chrome's fullscreen-popup /
  fullscreen-companion-window paths that need the `window-management` permission already granted (revisit with the
  kiosk spike in Task 6).
- **Placement without a blocked popup:** when the `window-management` permission is not yet granted, the window opens at
  once on this screen and `getScreenDetails()` is asked afterwards (a permission prompt can outlast the click's
  activation); if it is granted the window is moved / resized onto the other screen. Once granted, the screen is picked
  first and the window opens there directly.
- **Fog cover:** the watchdog's cover is mirrored via `output.cover(on, fog)`; the projector page also covers itself
  with the last fog colour sent with each frame. When the opener unloads (reload) it tells the projector to cover
  immediately: a same-origin popup shares the opener's thread, so its own 0.5 s stall timer can't run while the
  reloading page loads (measured ~0.8 s blocked).
- **W / MIDI `output` only open or reopen; the Show card button also turns the projector off** (back to single mode).
  A stray pedal press can't close the projector mid-show.
- **Kiosk spike (Task 6, Chrome 157, Windows, one 1920x1080 display, real Chrome driven over CDP, throwaway profile):**
  (a) with `--kiosk` + `--disable-popup-blocking`, `window.open(..., 'popup,...')` from the page opens a normal window
  (bounds 616x473, `windowState: normal`), **not** fullscreen; `--kiosk` does not carry over to popups. (b) Pre-granting
  works: a profile `Preferences` entry `profile.content_settings.exceptions.window_placement["http://localhost:PORT,*"] = {setting: 1}`
  (written before launch) makes `permissions.query({name:'window-management'})` return `granted`. The key must be
  `window_placement` (tried alone, enough). No flag or policy needed. `kiosk.bat dual` writes it for the kiosk profile
  through `tools/grant-window-management.js` (needs node, which the launcher already uses; if Chrome is already running
  with that profile it overwrites the file and the one-time prompt appears instead). (c) `--disable-popup-blocking` kept
  (this profile only) so W / MIDI reopen works with no click. **Result:** double-click `kiosk.bat dual` → click "Open
  projector output" → click the projector once. That is two clicks, one over the "at most one beyond single kiosk" goal,
  because the fullscreen click has to be inside the projector window. Auto-opening the projector on load in dual kiosk
  would make it one click; not done (untestable here without a second screen and it would double-open on reload).
  **Not verified:** that the pre-granted permission puts the window on the second screen and that its fullscreen click
  lands there (one display only).
- **Screen removed** (`screenschange`): the projector window is also closed, so Windows doesn't drop it onto the laptop
  screen over the picture.
