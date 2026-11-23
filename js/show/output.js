// Output: where the renderer's frames are shown. The renderer draws into its own
// OffscreenCanvas; each frame leaves as an ImageBitmap and a Sink puts it on screen.
// See docs/superpowers/specs/2026-11-23-projector-output-design.md (section 1).

/** A `bitmaprenderer` canvas that shows frames from renderer.takeFrame(). */
export class Sink {
  /** canvas: HTMLCanvasElement in any window (the laptop #view, later the projector window). */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('bitmaprenderer');
    if (!this.ctx) throw new Error('bitmaprenderer canvas is not available in this browser.');
  }

  /** Show a frame. Takes ownership of the bitmap (it is detached afterwards). null = keep the last one. */
  show(bitmap) { if (bitmap) this.ctx.transferFromImageBitmap(bitmap); }

  /** CSS size of the canvas and its window's devicePixelRatio (feeds renderer.setOutputSize). */
  get size() {
    const c = this.canvas;
    return { w: c.clientWidth, h: c.clientHeight, dpr: c.ownerDocument.defaultView.devicePixelRatio || 1 };
  }
}
