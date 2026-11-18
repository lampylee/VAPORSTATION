// Minimal .glb loader for low-poly models (Blockbench, Blender, itch.io packs).
// Reads every mesh primitive in the default scene with node transforms applied,
// and returns non-indexed geometry for r.createMesh():
//   POSITION, NORMAL, TEXCOORD_0, COLOR_0 (vertex colours), indices
//
//   const { geo, images } = await loadGLB('models/crate.glb');
//   this.crate = r.createMesh(geo);
//   // embedded texture -> palette-indexed texture on one ramp (keeps palettes working):
//   if (images[0]) this.tex = r.texture(await imageToIndexed(images[0], { ramp: 0 }));
//
// Materials are ignored; colour comes from vertex colours, our indexed textures,
// or the converted embedded image.
import { R } from '../palette/palette.js';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export async function loadGLB(src) {
  const buf = src instanceof ArrayBuffer ? src : await (await fetch(src)).arrayBuffer();
  return parseGLB(buf);
}

export function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a .glb file');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');

  const read = (ai) => {
    const acc = json.accessors[ai], view = json.bufferViews[acc.bufferView];
    const n = COMPONENTS[acc.type], T = TYPED[acc.componentType];
    const stride = view.byteStride || n * T.BYTES_PER_ELEMENT;
    const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const out = new Float32Array(acc.count * n), d = new DataView(bin);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[acc.componentType];
    for (let i = 0; i < acc.count; i++) for (let c = 0; c < n; c++) {
      let v = d[get](base + i * stride + c * T.BYTES_PER_ELEMENT, true);
      if (acc.normalized && NORM[acc.componentType]) v /= NORM[acc.componentType];
      out[i * n + c] = v;
    }
    return { data: out, n, count: acc.count };
  };

  const pos = [], nrm = [], uv = [], col = [];
  const visit = (ni, parent) => {
    const node = json.nodes[ni], m = mul(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue; // triangles only
        const A = prim.attributes, P = read(A.POSITION);
        const N = A.NORMAL !== undefined ? read(A.NORMAL) : null;
        const T = A.TEXCOORD_0 !== undefined ? read(A.TEXCOORD_0) : null;
        const C = A.COLOR_0 !== undefined ? read(A.COLOR_0) : null;
        const idx = prim.indices !== undefined ? read(prim.indices).data : Float32Array.from({ length: P.count }, (_, i) => i);
        for (const i of idx) {
          const x = P.data[i * 3], y = P.data[i * 3 + 1], z = P.data[i * 3 + 2];
          pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
          if (N) { const a = N.data[i * 3], b = N.data[i * 3 + 1], c = N.data[i * 3 + 2]; nrm.push(m[0] * a + m[4] * b + m[8] * c, m[1] * a + m[5] * b + m[9] * c, m[2] * a + m[6] * b + m[10] * c); } else nrm.push(0, 1, 0);
          if (T) uv.push(T.data[i * 2], T.data[i * 2 + 1]); else uv.push(0, 0);
          if (C) col.push(C.data[i * C.n], C.data[i * C.n + 1], C.data[i * C.n + 2]); else col.push(1, 1, 1);
        }
      }
    }
    for (const c of node.children || []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene ? scene.nodes : json.nodes.map((_, i) => i);
  for (const r of roots) visit(r, IDENT);

  const images = (json.images || []).map((img) => {
    if (img.bufferView === undefined) return null;
    const v = json.bufferViews[img.bufferView];
    return new Blob([new Uint8Array(bin, v.byteOffset || 0, v.byteLength)], { type: img.mimeType || 'image/png' });
  }).filter(Boolean);

  const geo = { positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uv), colors: new Float32Array(col), count: pos.length / 3 };
  // normalise normals (node scale may have changed their length)
  for (let i = 0; i < geo.normals.length; i += 3) {
    const l = Math.hypot(geo.normals[i], geo.normals[i + 1], geo.normals[i + 2]) || 1;
    geo.normals[i] /= l; geo.normals[i + 1] /= l; geo.normals[i + 2] /= l;
  }
  return { geo, images };
}

/**
 * Convert an image (Blob/URL/ImageBitmap) to an indexed texture: luminance ->
 * 4 shades of one ramp (ordered dither), alpha < 50% -> transparent.
 * Keeps imported textures palette-swappable.
 */
export async function imageToIndexed(src, { ramp = 0, size = 64 } = {}) {
  const bmp = src instanceof ImageBitmap ? src : await createImageBitmap(src instanceof Blob ? src : await (await fetch(src)).blob());
  const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    if (px[o + 3] < 128) { data[y * size + x] = 255; continue; }
    const l = (0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]) / 255 * 3;
    const f = Math.floor(l);
    data[y * size + x] = R(ramp, Math.min(3, f + (l - f > (B[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 1 : 0)));
  }
  return { data, width: size, height: size, indexed: true };
}

// ---- matrices (column-major) ----
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
