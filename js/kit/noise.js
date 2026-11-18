// Deterministic 2D value noise + fBm for terrain, placement and wobble.

const hash2 = (x, z, seed) => {
  const h = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
};
const fade = (t) => t * t * (3 - 2 * t);

/** Smooth value noise in [0,1). */
export function noise2(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = fade(x - xi), zf = fade(z - zi);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

/** Fractal noise in roughly [0,1). */
export function fbm(x, z, { octaves = 4, seed = 0, lacunarity = 2, gain = 0.5 } = {}) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * f, z * f, seed + i * 17) * amp;
    norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise (sharp crests) in [0,1): mountains, dunes. */
export function ridged(x, z, opts = {}) {
  return 1 - Math.abs(fbm(x, z, opts) * 2 - 1);
}

/** Deterministic random in [0,1) for integer coords (placement). */
export const rand2 = hash2;
