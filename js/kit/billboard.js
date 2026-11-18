// Quad for sprites drawn with r.drawInstanced(..., { billboard: 1 | 2 }).
// Pivot at bottom centre (trees stand on the ground); size 1x1, aspect via
// instance heightScale or pass width/height here.
import { GeoBuilder } from '../gfx/geometry.js';

export function billboardQuad(width = 1, height = 1) {
  const w = width / 2;
  return new GeoBuilder().quad([-w, 0, 0], [w, 0, 0], [w, height, 0], [-w, height, 0], [0, 1], [1, 1], [1, 0], [0, 0], [0, 0, 1]).build();
}
