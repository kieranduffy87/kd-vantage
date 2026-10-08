// Shape + material helpers shared by every device. Units are centimetres.
import * as THREE from 'three';
import { toCreasedNormals } from '../vendor/BufferGeometryUtils.js';

// Rounded rectangle centred on the origin. `n` is the superellipse exponent of
// each corner: 2 is a plain arc, ~3 approximates Apple's continuous corners.
export function rrPath(w, h, r, n = 2, path = new THREE.Shape(), seg = 10, cx0 = 0, cy0 = 0) {
  r = Math.max(0.0001, Math.min(r, w / 2, h / 2));
  const x0 = cx0 - w / 2, y0 = cy0 - h / 2, x1 = cx0 + w / 2, y1 = cy0 + h / 2;
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      const c = Math.cos(a), s = Math.sin(a);
      const px = cx + r * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const py = cy + r * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      if (i === 0 && a0 === -Math.PI / 2) path.moveTo(px, py); else path.lineTo(px, py);
    }
  };
  corner(x1 - r, y0 + r, -Math.PI / 2);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  path.closePath?.();
  return path;
}

export function rrHole(w, h, r, n = 2, cx = 0, cy = 0) {
  return rrPath(w, h, r, n, new THREE.Path(), 10, cx, cy);
}

// Extruded rounded slab: outer size w × h, total thickness t along Z, centred.
// Group 0 = the two caps, group 1 = the sides (so caps and rim can differ).
export function slab(w, h, t, r, bevel = 0.05, n = 2, holes = []) {
  bevel = Math.min(bevel, t / 2 - 0.001, w / 4, h / 4);
  const shape = rrPath(w - bevel * 2, h - bevel * 2, Math.max(0.01, r - bevel), n);
  for (const hp of holes) shape.holes.push(hp);
  const depth = Math.max(0.001, t - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0.0005, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: bevel > 0.1 ? 10 : bevel > 0.04 ? 6 : 3, curveSegments: 6,
  });
  g.translate(0, 0, -depth / 2);
  // ExtrudeGeometry is non-indexed, so its normals are per-face and the
  // bevels read as facets. Smooth everything under 50° and keep real creases.
  return toCreasedNormals(g, 50 * Math.PI / 180);
}

// Flat rounded panel in the XY plane with 0..1 UVs across its bounding box,
// which is what screen textures need (ShapeGeometry's raw UVs are in units).
export function panel(w, h, r, n = 2, u0 = 0, u1 = 1) {
  const g = new THREE.ShapeGeometry(rrPath(w, h, r, n), 12);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w + 0.5;
    uv.setXY(i, u0 + u * (u1 - u0), p.getY(i) / h + 0.5);
  }
  return g;
}

// The KD mark as two flat polygons, centred, `size` wide.
export function kdMarkGeometry(size, depth = 0.02) {
  const s = size / 18.62, cx = 9.31, cy = 5.865;
  const P = (pts) => {
    const sh = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? sh.lineTo : sh.moveTo).call(sh, (x - cx) * s, (cy - y) * s));
    return sh;
  };
  const shapes = [
    P([[18.62, 0], [12, 0], [6, 5.86], [12, 11.73], [18.62, 11.73], [12.62, 5.86]]),
    P([[0, 0], [0, 11.72], [6, 5.86]]),
  ];
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ---------- materials ----------

const cache = new Map();
function once(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// Bead-blasted grain: a tiling noise normal map. Real aluminium and frosted
// glass are never perfectly smooth, and this micro-structure is what stops a
// procedural surface reading as plastic.
let grain;
function grainMap() {
  if (grain) return grain;
  const N = 256, h = new Float32Array(N * N);
  for (let i = 0; i < h.length; i++) h[i] = Math.random();
  // two blur passes for a fine, slightly clumped grain
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(h);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += o[((y + dy + N) % N) * N + ((x + dx + N) % N)];
      h[y * N + x] = a / 9;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const dx = (h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)]) * 6;
    const dy = (h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x]) * 6;
    const l = Math.hypot(dx, dy, 1);
    img.data[i * 4] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[i * 4 + 1] = (-dy / l * 0.5 + 0.5) * 255;
    img.data[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain = new THREE.CanvasTexture(c);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(1.6, 1.6); // shape UVs are in cm: ~6 mm tiles
  grain.anisotropy = 4;
  return grain;
}

export const M = {
  metal: (hex, rough = 0.34) => new THREE.MeshPhysicalMaterial({
    color: hex, metalness: 1, roughness: rough, clearcoat: 0.25, clearcoatRoughness: 0.3,
    normalMap: grainMap(), normalScale: new THREE.Vector2(0.05, 0.05),
  }),
  anodised: (hex) => new THREE.MeshPhysicalMaterial({
    color: hex, metalness: 0.72, roughness: 0.4, clearcoat: 0.1, clearcoatRoughness: 0.5,
    normalMap: grainMap(), normalScale: new THREE.Vector2(0.09, 0.09),
  }),
  frosted: (hex) => new THREE.MeshPhysicalMaterial({
    color: hex, metalness: 0.15, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.22,
    normalMap: grainMap(), normalScale: new THREE.Vector2(0.14, 0.14),
  }),
  port: () => once('port', () => new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })),
  plastic: (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.1 }),
  blackGlass: () => once('blackGlass', () => new THREE.MeshPhysicalMaterial({
    color: 0x040405, metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03,
  })),
  lensGlass: () => once('lensGlass', () => new THREE.MeshPhysicalMaterial({
    color: 0x05070c, metalness: 0.2, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.1,
    iridescence: 0.6, iridescenceIOR: 1.6,
  })),
  rubber: () => once('rubber', () => new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 })),
  keys: () => once('keys', () => new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.62, metalness: 0.05 })),
  hinge: () => once('hinge', () => new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.45, metalness: 0.6 })),
  flash: () => once('flash', () => new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.3, emissive: 0x2a2820 })),
  silicone: (hex) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.78, metalness: 0, sheen: 0.4, sheenRoughness: 0.8 }),
  clearCase: () => new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.08, transmission: 0, transparent: true, opacity: 0.22,
    clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false,
  }),
};

// Screen material: black glass whose emissive channel carries the artwork.
// toneMapped=false keeps the screen's pixels exactly as designed.
export function screenMaterial(texture) {
  const m = new THREE.MeshPhysicalMaterial({
    specularIntensity: 0.35,
    color: 0x000000, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 1,
    roughness: 0.1, metalness: 0, toneMapped: false, envMapIntensity: 0.28,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  return m;
}

export function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
