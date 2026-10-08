// Environments: architectural sets built from scanned CC0 materials (Poly
// Haven, see assets/env/CREDITS.md), each with its own coloured light rig.
// Everything is laid out so the surface the devices stand on is y = 0.
import * as THREE from 'three';
import { HDRLoader } from '../vendor/HDRLoader.js';
import { RectAreaLightUniformsLib } from '../vendor/RectAreaLightUniformsLib.js';

RectAreaLightUniformsLib.init();

// ---------- materials ----------
// tile = centimetres per texture repeat; tint multiplies the scan
export const MATERIALS = {
  // roughMap: false where the scan's roughness has hard wet patches that
  // read as banding under strong coloured light; contrast < 1 calms the
  // cloudy albedo of plaster and concrete
  concreteDark: { label: 'Dark concrete', tex: 'concrete_floor_worn_001', tile: 140, tint: '#7a7976', rough: 0.88, roughMap: false },
  concrete: { label: 'Concrete', tex: 'concrete_floor_02', tile: 160, tint: '#ffffff', rough: 0.9, roughMap: false, contrast: 0.6 },
  plaster: { label: 'White plaster', tex: 'white_plaster_02', tile: 220, tint: '#eef1f6', rough: 0.95, gain: 1.95, roughMap: false, contrast: 0.4 },
  marble: { label: 'Limestone', tex: 'marble_01', tile: 140, tint: '#ffffff', rough: 0.55 },
  oak: { label: 'Oak', tex: 'oak_veneer_01', tile: 110, tint: '#ffffff', rough: 0.85 },
  walnut: { label: 'Walnut', tex: 'walnut_veneer', tile: 110, tint: '#ffffff', rough: 0.8 },
  linen: { label: 'Linen', tex: 'rough_linen', tile: 45, tint: '#ffffff', rough: 1 },
  terrazzo: { label: 'Terrazzo', tex: 'terrazzo_tiles', tile: 120, tint: '#ffffff', rough: 0.7 },
  matte: { label: 'Matte colour', tex: null, tile: 100, tint: '#d9d9db', rough: 1 },
};

const texLoader = new THREE.TextureLoader();
const texCache = new Map();
let onLoaded = () => {};
export function onTextureLoad(fn) { onLoaded = fn; }

function tex(name, kind, srgb) {
  const key = `${name}_${kind}`;
  if (texCache.has(key)) return texCache.get(key);
  const t = texLoader.load(`assets/env/${key}.jpg`, () => onLoaded());
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

// One material per (kind, tint). Scans repeat in world units because every
// set piece gets UVs scaled to its real size (see box()).
export function surfaceMaterial(id, tintOverride) {
  const M = MATERIALS[id] || MATERIALS.concrete;
  const tint = tintOverride || M.tint;
  // gain lifts scans whose albedo is darker than the real surface reads
  const opts = { color: new THREE.Color(tint).multiplyScalar(M.gain || 1), roughness: M.rough, metalness: 0 };
  if (M.tex) {
    opts.map = tex(M.tex, 'diff', true);
    opts.normalMap = tex(M.tex, 'nor', false);
    if (M.roughMap !== false) opts.roughnessMap = tex(M.tex, 'rough', false);
    opts.normalScale = new THREE.Vector2(1, 1);
  }
  const m = new THREE.MeshPhysicalMaterial(opts);
  m.dithering = true; // dark gradients band without it
  if (M.contrast != null && M.contrast < 1) {
    // pull the scan's albedo towards its own mean: same material, calmer
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uContrast = { value: M.contrast };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform float uContrast;')
        .replace('#include <map_fragment>', `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec3 meanC = textureLod( map, vMapUv, 10.0 ).rgb;
          sampledDiffuseColor.rgb = mix( meanC, sampledDiffuseColor.rgb, uContrast );
          diffuseColor *= sampledDiffuseColor;
        #endif`);
    };
    m.customProgramCacheKey = () => 'contrast' + M.contrast;
  }
  if (id === 'marble' || id === 'terrazzo') { m.clearcoat = 0.35; m.clearcoatRoughness = 0.25; }
  m.userData.tile = M.tile;
  return m;
}

// Box with UVs scaled to centimetres / tile, so a 4 m wall and a 30 cm step
// share the same grain size. Faces: +x −x +y −y +z −z.
function box(w, h, d, mat, seed = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const tile = mat.userData.tile || 100;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const ox = (seed * 0.137) % 1, oy = (seed * 0.291) % 1;
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / tile + ox, uv.getY(k) * dims[f][1] / tile + oy);
  }
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------- HDR reflections ----------
const hdrCache = new Map();
export function loadHdri(name, pmrem) {
  if (hdrCache.has(name)) return hdrCache.get(name);
  const p = new Promise((res) => {
    new HDRLoader().load(`assets/env/${name}.hdr`, (t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      const env = pmrem.fromEquirectangular(t).texture;
      t.dispose();
      res(env);
    }, undefined, () => res(null));
  });
  hdrCache.set(name, p);
  return p;
}

// ---------- the sets ----------
// lights: id, label, kind (spot | rect | point), default colour + intensity,
// position, target; one may be `shadow: true` (the key; it gets soft-shadow
// jitter and can project a window pattern).
export const ENVIRONMENTS = {
  studio: { label: 'Studio', note: 'Seamless cyclorama', swatch: ['#1b1d23', '#0339f8'] },

  stone: {
    label: 'Stone steps', note: 'Warm key on dark concrete', swatch: ['#2a2725', '#ff6a2a'],
    floor: 'concreteDark', wall: 'concreteDark', bg: '#0b0a0a', hdri: 'brown_photostudio_02', envK: 0.3, exposure: 1.25,
    post: { vignette: 0.45, bloom: 0.25, haze: 0.25, dof: 0.12, grain: 0.25 },
    cam: { preset: 'three', shift: { x: 0, y: 0 } },
    build(add, F, W) {
      add(box(600, 40, 300, F, 1), [0, -20, -40]);                 // terrace the set stands on
      add(box(600, 40, 200, F, 2), [0, -32, 210]);                  // step down in front
      add(box(600, 30, 300, W, 3), [0, 15, -220]);                  // first riser behind
      add(box(600, 60, 300, W, 4), [0, 30, -260]);                  // second riser
      add(box(600, 120, 300, W, 5), [0, 60, -300]);                 // back wall of the terraces
      add(box(90, 26, 60, F, 6), [78, 13, -70]);                    // a block catching the light
    },
    lights: [
      { id: 'key', label: 'Key', kind: 'spot', color: '#ff7a3d', intensity: 9, pos: [-150, 115, -80], target: [0, 0, 0], angle: 0.55, penumbra: 0.65, shadow: true },
      { id: 'rim', label: 'Rim', kind: 'rect', color: '#ffb07a', intensity: 2, pos: [80, 60, -120], target: [0, 10, 0], size: [80, 40] },
      { id: 'fill', label: 'Fill', kind: 'point', color: '#5a6a9a', intensity: 0.35, pos: [90, 60, 140] },
    ],
  },

  void: {
    label: 'Void float', note: 'Pure black, coloured rims', swatch: ['#000000', '#7a3cff'],
    floor: null, wall: null, bg: '#000000', hdri: 'studio_small_09', envK: 0.35, exposure: 1.0, noGround: true,
    post: { vignette: 0.35, bloom: 0.35, haze: 0, dof: 0.08, grain: 0.15 },
    cam: { preset: 'hero', shift: { x: 0, y: 0 } },
    build() {},
    lights: [
      { id: 'left', label: 'Left rim', kind: 'rect', color: '#3d66ff', intensity: 4, pos: [-90, 50, -40], target: [0, 10, 0], size: [40, 90] },
      { id: 'right', label: 'Right rim', kind: 'rect', color: '#b45cff', intensity: 4, pos: [90, 50, -40], target: [0, 10, 0], size: [40, 90] },
      { id: 'top', label: 'Key', kind: 'spot', color: '#ffffff', intensity: 2.6, pos: [30, 170, 120], target: [0, 0, 0], angle: 0.5, penumbra: 0.9, shadow: true },
      { id: 'front', label: 'Front soft', kind: 'rect', color: '#ffffff', intensity: 1.4, pos: [0, 60, 150], target: [0, 10, 0], size: [160, 80] },
    ],
  },

  plinth: {
    label: 'White plinth', note: 'Plaster room, stepped plinth', swatch: ['#e9e8e4', '#cfcac2'],
    floor: 'plaster', wall: 'plaster', bg: '#e9e8e4', hdri: 'photo_studio_loft_hall', envK: 0.9, exposure: 1.2,
    post: { vignette: 0.2, bloom: 0.1, haze: 0.1, dof: 0.1, grain: 0.12 },
    cam: { preset: 'three', shift: { x: 0, y: 0 } },
    build(add, F, W) {
      add(box(110, 34, 80, F, 1), [0, -17, 0]);                     // plinth top at y = 0
      add(box(170, 20, 130, F, 2), [10, -44, 10]);                  // lower step
      add(box(600, 10, 600, F, 3), [0, -59, 0]);                    // room floor
      add(box(600, 300, 10, W, 4), [0, 90, -110]);                  // back wall
      add(box(10, 300, 600, W, 5), [-130, 90, 0]);                  // side wall: the corner
      for (let i = 0; i < 9; i++) {                                  // panel joints
        add(box(600, 0.6, 1.2, W, 6 + i), [0, -40 + i * 30, -104.6]);
        add(box(1.2, 0.6, 600, W, 16 + i), [-124.6, -40 + i * 30, 0]);
      }
    },
    lights: [
      { id: 'sun', label: 'Daylight', kind: 'spot', color: '#fff6ea', intensity: 3.6, pos: [-170, 190, -50], target: [0, 0, 0], angle: 0.55, penumbra: 0.8, shadow: true },
      { id: 'bounce', label: 'Bounce', kind: 'rect', color: '#ffffff', intensity: 1.1, pos: [120, 120, 140], target: [0, 0, 0], size: [160, 120] },
    ],
  },

  desk: {
    label: 'Desk at dusk', note: 'Walnut desk, blinds on the wall', swatch: ['#3b2a20', '#ffc48a'],
    floor: 'walnut', wall: 'plaster', wallTint: '#9a958d', bg: '#141210', hdri: 'brown_photostudio_02', envK: 0.3, exposure: 1.0, gobo: 'blinds',
    post: { vignette: 0.4, bloom: 0.2, haze: 0.2, dof: 0.14, grain: 0.2 },
    cam: { preset: 'hero', shift: { x: 0, y: 0 } },
    build(add, F, W) {
      add(box(240, 4, 95, F, 1), [0, -2, 0]);                       // desk top
      add(box(600, 300, 10, W, 2), [0, 100, -55]);                  // wall behind
      add(box(600, 10, 400, surfaceMaterial('concreteDark', '#3a3836'), 3), [0, -80, 60]); // floor far below
    },
    lights: [
      { id: 'sun', label: 'Low sun', kind: 'spot', color: '#ffd2a6', intensity: 3.4, pos: [150, 120, 160], target: [-10, 30, -50], angle: 0.5, penumbra: 0.15, shadow: true },
      { id: 'lamp', label: 'Room', kind: 'point', color: '#8592b3', intensity: 0.45, pos: [-120, 80, 80] },
    ],
  },

  neon: {
    label: 'Neon ledge', note: 'Dark ledge, green and blue light', swatch: ['#06110d', '#00e89a'],
    floor: 'concrete', floorTint: '#4b4f55', wall: 'concrete', wallTint: '#2a2e33', bg: '#020403', hdri: 'studio_small_09', envK: 0.12, exposure: 1.0,
    post: { vignette: 0.45, bloom: 0.75, haze: 0.35, dof: 0.12, grain: 0.2 },
    cam: { preset: 'three', shift: { x: 0, y: 0 } },
    build(add, F, W, glow) {
      add(box(600, 30, 140, F, 1), [0, -15, 0]);                    // the ledge
      add(box(600, 30, 300, F, 2), [0, -45, 220]);                  // step down
      add(box(600, 200, 10, W, 3), [0, 70, -75]);                   // wall
      glow('#00e89a', [300, 1.2, 1.2], [0, 1.2, -68]);              // neon strips
      glow('#2a6bff', [1.2, 1.2, 140], [-110, 0.8, 0]);
    },
    lights: [
      { id: 'green', label: 'Green neon', kind: 'rect', color: '#00e89a', intensity: 6, pos: [0, 8, -66], target: [0, 4, 40], size: [220, 6] },
      { id: 'blue', label: 'Blue neon', kind: 'rect', color: '#2a6bff', intensity: 7, pos: [-108, 6, 0], target: [40, 4, 0], size: [6, 140] },
      { id: 'key', label: 'Top', kind: 'spot', color: '#cfe8ff', intensity: 2.2, pos: [60, 170, 90], target: [0, 0, 0], angle: 0.45, penumbra: 0.7, shadow: true },
    ],
  },

  paper: {
    label: 'Paper flat lay', note: 'Soft grey, from above', swatch: ['#d6d6d8', '#ffffff'],
    floor: 'matte', floorTint: '#d4d4d6', wall: null, bg: '#d4d4d6', hdri: 'photo_studio_loft_hall', envK: 0.8, exposure: 1.0,
    post: { vignette: 0.12, bloom: 0, haze: 0, dof: 0, grain: 0.1 },
    cam: { preset: 'top', shift: { x: 0, y: 0 } },
    build(add, F) {
      add(box(900, 10, 900, F, 1), [0, -5, 0]);
    },
    lights: [
      { id: 'soft', label: 'Softbox', kind: 'spot', color: '#ffffff', intensity: 2.6, pos: [-90, 220, 60], target: [0, 0, 0], angle: 0.6, penumbra: 1, shadow: true },
      { id: 'fill', label: 'Fill', kind: 'rect', color: '#ffffff', intensity: 1.2, pos: [100, 160, -60], target: [0, 0, 0], size: [140, 140] },
    ],
  },
};

// Build a set into `group`. `o` holds the user's overrides:
// { floor, floorTint, wall, wallTint, lights: { id: { color, intensity, on } } }
// Lights are authored as positions; the UI edits them as an orbit around
// their target: angle (azimuth), height (elevation) and the same distance.
export function lightAngles(L) {
  const d = new THREE.Vector3(...L.pos).sub(new THREE.Vector3(...(L.target || [0, 0, 0])));
  const r = d.length();
  return { az: Math.round(Math.atan2(d.x, d.z) * 180 / Math.PI), el: Math.round(Math.asin(d.y / r) * 180 / Math.PI), r };
}
export function lightPosition(L, ov = {}) {
  if (ov.az == null && ov.el == null) return L.pos;
  const a = lightAngles(L);
  const az = (ov.az ?? a.az) * Math.PI / 180, el = (ov.el ?? a.el) * Math.PI / 180;
  const t = L.target || [0, 0, 0];
  return [t[0] + Math.sin(az) * Math.cos(el) * a.r, t[1] + Math.sin(el) * a.r, t[2] + Math.cos(az) * Math.cos(el) * a.r];
}

function clear(group) {
  for (const c of [...group.children]) {
    c.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.dispose && n.isLight) n.dispose(); });
    group.remove(c);
  }
}

// The architecture and its materials.
export function buildSet(group, id, o = {}) {
  clear(group);
  const E = ENVIRONMENTS[id];
  if (!E || id === 'studio') return;
  const F = E.floor || o.floor ? surfaceMaterial(o.floor || E.floor, o.floorTint || E.floorTint) : null;
  const W = E.wall || o.wall ? surfaceMaterial(o.wall || E.wall, o.wallTint || E.wallTint) : null;
  const add = (mesh, pos) => { mesh.position.set(...pos); group.add(mesh); return mesh; };
  const glow = (col, size, pos) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(3), toneMapped: false }));
    m.position.set(...pos);
    group.add(m);
  };
  E.build(add, F, W, glow);
}

// The light rig; rebuilt on its own so colour / angle edits stay cheap.
export function buildLights(group, id, o = {}) {
  clear(group);
  const E = ENVIRONMENTS[id];
  if (!E || id === 'studio') return { shadowLight: null, lights: [], E };
  let shadowLight = null;
  const lights = [];
  for (let L of E.lights) {
    const ov = o.lights?.[L.id] || {};
    if (ov.on === false) continue;
    const col = ov.color || L.color;
    const k = ov.intensity ?? L.intensity;
    const pos = lightPosition(L, ov);
    L = { ...L, pos, penumbra: ov.soft != null && L.kind === 'spot' ? ov.soft : L.penumbra,
      size: L.size && ov.soft != null && L.kind === 'rect' ? L.size.map((v) => v * (0.4 + ov.soft * 1.6)) : L.size,
      shadow: L.kind === 'spot' ? (ov.shadow ?? !!L.shadow) : false };
    let light;
    if (L.kind === 'spot') {
      // intensities are authored as "stops": scale by distance² so they read
      // the same however far away the light sits
      const d = new THREE.Vector3(...L.pos).distanceTo(new THREE.Vector3(...L.target));
      light = new THREE.SpotLight(col, k * d * d * 0.32, 0, L.angle, L.penumbra, 2);
      light.target.position.set(...L.target);
      group.add(light.target);
      if (L.shadow) {
        light.castShadow = true;
        light.shadow.mapSize.set(shadowLight ? 1024 : 2048, shadowLight ? 1024 : 2048);
        light.shadow.bias = -0.0004;
        light.shadow.normalBias = 0.04;
        light.shadow.camera.near = 20;
        light.shadow.camera.far = d * 3;
        if (!shadowLight) shadowLight = light;
      }
    } else if (L.kind === 'rect') {
      light = new THREE.RectAreaLight(col, k, L.size[0], L.size[1]);
      light.lookAt(...L.target);
    } else {
      const d2 = new THREE.Vector3(...L.pos).lengthSq();
      light = new THREE.PointLight(col, k * d2 * 0.32, 0, 2);
    }
    light.position.set(...L.pos);
    if (L.kind === 'rect') light.lookAt(...L.target);
    group.add(light);
    light.userData.lightId = L.id;
    lights.push(light);
  }
  return { shadowLight, lights, E };
}
