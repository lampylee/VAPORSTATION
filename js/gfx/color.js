// Colour helpers. Palettes are written as hex strings for easy tweaking.

/** '#ff3366' -> [1, 0.2, 0.4] */
export function hex(str) {
  let s = str.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** '#ff3366' -> [255, 51, 102] */
export function hex255(str) {
  return hex(str).map((v) => Math.round(v * 255));
}

/** Convert every hex string in a palette object to [r,g,b] floats. */
export function paletteToRgb(p) {
  const out = {};
  for (const k of Object.keys(p)) out[k] = hex(p[k]);
  return out;
}

export function mixColor(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function scaleColor(out, a, s) {
  out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s;
  return out;
}

export function addColor(out, a, b, s = 1) {
  out[0] = a[0] + b[0] * s; out[1] = a[1] + b[1] * s; out[2] = a[2] + b[2] * s;
  return out;
}
