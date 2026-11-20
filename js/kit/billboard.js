// Quad for sprites drawn with r.drawInstanced(..., { billboard: 1 | 2 }).
// Pivot at bottom centre (trees stand on the ground); size 1x1, aspect via
// instance heightScale or pass width/height here.
import { GeoBuilder } from '../gfx/geometry.js';

export function billboardQuad(width = 1, height = 1) {
  const w = width / 2;
  return new GeoBuilder().quad([-w, 0, 0], [w, 0, 0], [w, height, 0], [-w, height, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();
}

/**
 * Same quad with the pivot in the middle: glows, lens flares, pages and anything that
 * spins in place with rotZ, or lies flat as a pool / decal when tilted with rotX = PI/2.
 */
export function centredQuad(width = 1, height = 1) {
  const w = width / 2, h = height / 2;
  return new GeoBuilder().quad([-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();
}
