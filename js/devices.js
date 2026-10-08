// Procedural devices. Every model is built from rounded slabs and panels in
// centimetres, so nothing is loaded and everything is customisable.
import * as THREE from 'three';
import { slab, panel, rrHole, kdMarkGeometry, M, screenMaterial, mesh } from './geo.js';
import { ScreenCanvas } from './screens.js';
import { PROPS } from './props.js';

const D2R = Math.PI / 180;

export const CASE_COLOURS = [
  { id: 'blue', label: 'KD Blue', hex: '#0339f8' },
  { id: 'ink', label: 'Ink', hex: '#16171b' },
  { id: 'paper', label: 'Paper', hex: '#efece4' },
  { id: 'coral', label: 'Coral', hex: '#ff7a59' },
  { id: 'teal', label: 'Teal', hex: '#21d4b4' },
];

export const SUPPORT_LABEL = {
  none: 'Standing', dock: 'Display stand', flat: 'Flat lay', float: 'Floating',
  riser: 'Laptop stand', stand: 'Built-in stand',
};

export const MODELS = {
  macbook: {
    label: 'MacBook Air 13″', short: 'MacBook', kind: 'laptop', px: [2560, 1664],
    finishes: [
      { id: 'midnight', label: 'Midnight', hex: '#2c323c' },
      { id: 'starlight', label: 'Starlight', hex: '#e4dccd' },
      { id: 'silver', label: 'Silver', hex: '#d6d7d9' },
      { id: 'sky', label: 'Sky Blue', hex: '#b6c5d6' },
      { id: 'kd', label: 'KD Blue', hex: '#0339f8' },
    ],
    supports: ['none', 'riser', 'float'], cases: false, poses: false,
  },
  iphone: {
    label: 'iPhone 17 Pro', short: 'iPhone', kind: 'phone', px: [1206, 2622],
    finishes: [
      { id: 'silver', label: 'Silver', hex: '#e2e2e0' },
      { id: 'deepblue', label: 'Deep Blue', hex: '#2c3954' },
      { id: 'orange', label: 'Cosmic Orange', hex: '#e8772c' },
      { id: 'black', label: 'Black', hex: '#2a2a2c' },
      { id: 'kd', label: 'KD Blue', hex: '#0339f8' },
    ],
    supports: ['dock', 'none', 'flat', 'float'], cases: true, poses: true,
  },
  ipad: {
    label: 'iPad Pro 11″', short: 'iPad', kind: 'tablet', px: [1668, 2420],
    finishes: [
      { id: 'silver', label: 'Silver', hex: '#d8d9db' },
      { id: 'black', label: 'Space Black', hex: '#2e2f32' },
      { id: 'kd', label: 'KD Blue', hex: '#0339f8' },
    ],
    supports: ['dock', 'none', 'flat', 'float'], cases: false, poses: true,
  },
  fold: {
    label: 'Foldable', short: 'Foldable', kind: 'fold', px: [2160, 2290],
    finishes: [
      { id: 'graphite', label: 'Graphite', hex: '#383b42' },
      { id: 'silver', label: 'Silver', hex: '#d9d9db' },
      { id: 'kd', label: 'KD Blue', hex: '#0339f8' },
    ],
    supports: ['none', 'flat', 'float'], cases: false, poses: false, folds: true,
  },
  display: {
    label: 'Studio Display', short: 'Display', kind: 'display', px: [5120, 2880],
    finishes: [
      { id: 'silver', label: 'Silver', hex: '#d6d7d9' },
      { id: 'midnight', label: 'Midnight', hex: '#2c323c' },
    ],
    supports: ['stand'], cases: false, poses: false,
  },
};

for (const [id, P] of Object.entries(PROPS)) {
  MODELS[id] = { label: P.label, short: P.label, kind: 'prop', px: null, finishes: P.finishes, supports: ['none'], cases: false, poses: false };
}

export function screenPixels(spec) {
  const m = MODELS[spec.model];
  if (!m.px) return [0, 0];
  const [w, h] = m.px;
  return spec.pose === 'landscape' ? [h, w] : [w, h];
}

export function defaultSpec(model, over = {}) {
  const m = MODELS[model];
  return {
    id: 'd' + Math.random().toString(36).slice(2, 8),
    model,
    name: m.label,
    finish: m.finishes[0].id,
    case: 'none',
    caseColor: 'blue',
    pose: 'portrait',
    support: m.supports[0],
    roll: 0,
    lid: 112,
    fold: 150,
    x: 0, z: 0, rot: 0, tilt: m.kind === 'phone' || m.kind === 'tablet' ? 9 : 0,
    scale: 1,
    screen: m.kind === 'phone' || m.kind === 'fold' ? 'kd-mobile' : 'kd-desktop',
    fill: 'top',
    scroll: 0,
    brightness: 1,
    ui: true,
    visible: true,
    ...over,
  };
}

// Soft contact shadow texture, shared.
let blobTex;
function contactTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.95)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.7)');
  grd.addColorStop(0.78, 'rgba(0,0,0,0.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

const LENS_EL = new THREE.MeshPhysicalMaterial({ color: 0x0b1530, roughness: 0.05, metalness: 0.4, iridescence: 1, iridescenceIOR: 1.8, emissive: 0x050a1a });
const NOTCH = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });

// Printed key legends: one transparent decal over the whole keyboard, laid
// out from the same key list the instanced keycaps use.
const LEGENDS = [
  'esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', '',
  '`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'delete',
  'tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\',
  'caps lock', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'return',
  'shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'shift',
  'fn', 'control', 'option', 'command', '', 'command', 'option', '◀', '▲', '▼', '▶',
];
let legendCache;
function keyLegends(keys, x0, z0, w, d, y) {
  if (!legendCache) {
    const k = 64;
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(d * k);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(232,233,238,0.9)';
    keys.forEach(([x, z, kw2, kd], i) => {
      const t = LEGENDS[i];
      if (!t) return;
      const cx = (x - x0) * k, cz = (z - z0) * k;
      if (t.length === 1 && !'◀▲▼▶'.includes(t)) {
        g.font = `500 ${0.36 * k}px "Instrument Sans", "Helvetica Neue", sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(t, cx, cz);
      } else if ('◀▲▼▶'.includes(t)) {
        g.font = `${0.2 * k}px sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(t, cx, cz);
      } else {
        g.font = `500 ${0.2 * k}px "Instrument Sans", "Helvetica Neue", sans-serif`;
        const fnRow = i < 14;
        g.textAlign = fnRow ? 'center' : i % 2 ? 'left' : 'left';
        g.textBaseline = fnRow ? 'middle' : 'alphabetic';
        if (fnRow) g.fillText(t, cx, cz);
        else g.fillText(t, cx - (kw2 / 2) * k + 0.16 * k, cz + (kd / 2) * k - 0.16 * k);
      }
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    legendCache = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, depthWrite: false, roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), legendCache);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x0 + w / 2, y, z0 + d / 2);
  return m;
}

// ---------------------------------------------------------------- MacBook
function buildMacbook(spec, fin, screenMat) {
  const g = new THREE.Group();
  const W = 30.41, D = 21.5, tb = 0.6, tl = 0.46, r = 1.05;
  const alu = M.anodised(fin.hex);
  const pad = new THREE.MeshPhysicalMaterial({ color: fin.hex, metalness: 0.35, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const base = mesh(slab(W, D, tb, r, 0.14, 2.4), [alu, alu]);
  base.rotation.x = -Math.PI / 2;
  base.position.y = tb / 2;
  g.add(base);

  // keyboard, instanced
  const pitch = 1.84, gap = 0.2, kw = 15 * pitch;
  const rows = [
    { d: 0.5, k: Array(14).fill(15 / 14) },
    { d: 1, k: [...Array(13).fill(1), 2] },
    { d: 1, k: [1.5, ...Array(12).fill(1), 1.5] },
    { d: 1, k: [1.75, ...Array(11).fill(1), 2.25] },
    { d: 1, k: [2.25, ...Array(10).fill(1), 2.75] },
    { d: 1, k: [1, 1, 1, 1.25, 5.5, 1.25, 1, 'arrows'] },
  ];
  const keys = [];
  let z = -D / 2 + 1.25;
  for (const row of rows) {
    const dz = row.d * pitch;
    let x = -kw / 2;
    for (const k of row.k) {
      if (k === 'arrows') {
        const u = pitch, half = dz / 2;
        keys.push([x + u / 2, z + dz * 0.75, u - gap, half - gap / 2]);
        keys.push([x + u * 1.5, z + dz * 0.25, u - gap, half - gap / 2]);
        keys.push([x + u * 1.5, z + dz * 0.75, u - gap, half - gap / 2]);
        keys.push([x + u * 2.5, z + dz * 0.75, u - gap, half - gap / 2]);
        x += 3 * u;
        continue;
      }
      const w = k * pitch;
      keys.push([x + w / 2, z + dz / 2, w - gap, dz - gap]);
      x += w;
    }
    z += dz;
  }
  const kg = slab(1, 1, 0.12, 0.16, 0.03);
  kg.rotateX(-Math.PI / 2);
  const inst = new THREE.InstancedMesh(kg, M.keys(), keys.length);
  const mtx = new THREE.Matrix4();
  keys.forEach(([x, z2, w, d], i) => {
    mtx.compose(new THREE.Vector3(x, tb + 0.02, z2), new THREE.Quaternion(), new THREE.Vector3(w, 1, d));
    inst.setMatrixAt(i, mtx);
  });
  inst.receiveShadow = true;
  g.add(inst);
  g.add(keyLegends(keys, -kw / 2, -D / 2 + 1.25, kw, z - (-D / 2 + 1.25), tb + 0.083));

  // ports: two USB-C and MagSafe on the left, headphone jack on the right
  for (const [pz, pw] of [[-6.2, 0.86], [-4.9, 0.86], [-3.2, 1.05]]) {
    const pt = mesh(panel(pw, 0.28, 0.14), M.port(), { cast: false });
    pt.rotation.y = -Math.PI / 2;
    pt.position.set(-W / 2 - 0.003, tb / 2, pz);
    g.add(pt);
  }
  const jack = mesh(new THREE.CircleGeometry(0.15, 20), M.port(), { cast: false });
  jack.rotation.y = Math.PI / 2;
  jack.position.set(W / 2 + 0.003, tb / 2, -6.2);
  g.add(jack);

  const tp = mesh(panel(12.2, 7.7, 0.55), pad, { cast: false });
  tp.rotation.x = -Math.PI / 2;
  tp.position.set(0, tb + 0.002, D / 2 - 0.95 - 3.85);
  g.add(tp);

  const hinge = mesh(new THREE.CylinderGeometry(0.3, 0.3, W - 6.5, 24), M.hinge());
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, tb + 0.02, -D / 2 + 0.34);
  g.add(hinge);

  // lid on a pivot at the hinge line
  const pivot = new THREE.Group();
  pivot.position.set(0, tb + 0.02, -D / 2 + 0.34);
  pivot.rotation.x = -((spec.lid ?? 112) - 90) * D2R;
  g.add(pivot);
  const Hl = D - 0.55, lidTop = Hl + 0.05;
  const lid = mesh(slab(W, Hl, tl, r, 0.1, 2.4), [alu, alu]);
  lid.position.set(0, Hl / 2 + 0.05, -tl / 2);
  pivot.add(lid);
  const bezel = mesh(panel(W - 0.14, Hl - 0.14, r - 0.07, 2.4), M.blackGlass(), { cast: false });
  bezel.position.set(0, Hl / 2 + 0.05, 0.002);
  pivot.add(bezel);
  const sw = 28.7, sh = (sw * 1664) / 2560;
  const scr = mesh(panel(sw, sh, 0.42), screenMat, { cast: false });
  const scy = lidTop - 0.6 - sh / 2;
  scr.position.set(0, scy, 0.004);
  pivot.add(scr);
  const notch = mesh(panel(3.1, 0.64, 0.3), NOTCH, { cast: false });
  notch.position.set(0, scy + sh / 2 - 0.2, 0.006);
  pivot.add(notch);
  const cam = mesh(new THREE.CircleGeometry(0.1, 20), M.lensGlass(), { cast: false });
  cam.position.set(0, scy + sh / 2 - 0.12, 0.009);
  pivot.add(cam);
  const mark = mesh(kdMarkGeometry(4.4, 0.012), M.metal(0xe9eaee, 0.06));
  mark.rotation.y = Math.PI;
  mark.position.set(0, Hl / 2 + 0.05, -tl - 0.004);
  pivot.add(mark);

  return { group: g, screens: [scr], dims: [W, D], lid: pivot };
}

// ---------------------------------------------------------------- iPhone
function buildIphone(spec, fin, screenMat) {
  const g = new THREE.Group();
  const W = 7.19, H = 15.0, T = 0.875, r = 1.2, n = 2.6;
  const frame = M.anodised(fin.hex);
  const back = M.frosted(fin.hex);
  const body = mesh(slab(W, H, T - 0.08, r, 0.22, n), [back, frame]);
  body.position.z = -0.04;
  g.add(body);
  const glass = mesh(slab(W - 0.16, H - 0.16, 0.1, r - 0.08, 0.035, n), [M.blackGlass(), M.blackGlass()]);
  glass.position.z = T / 2 - 0.05;
  g.add(glass);
  const sw = 6.66, sh = 14.48;
  const scr = mesh(panel(sw, sh, 0.96, n), screenMat, { cast: false });
  scr.position.z = T / 2 + 0.002;
  g.add(scr);
  const island = mesh(panel(2.0, 0.58, 0.29), NOTCH, { cast: false });
  island.position.set(0, sh / 2 - 0.52, T / 2 + 0.004);
  g.add(island);

  // camera plateau
  const plat = mesh(slab(W - 0.34, 3.4, 0.16, 0.95, 0.06, n), [frame, frame]);
  const py = H / 2 - 0.17 - 1.7;
  plat.position.set(0, py, -T / 2 - 0.04);
  g.add(plat);
  const ring = M.metal(0x3a3b3f, 0.25);
  const lip = M.metal(0xd9dadf, 0.16);
  const zb = -T / 2 - 0.12; // plateau back face
  const lens = (x, y, rad) => {
    const c = mesh(new THREE.CylinderGeometry(rad, rad * 1.03, 0.14, 48), ring);
    c.rotation.x = Math.PI / 2;
    c.position.set(x, y, zb - 0.07);
    g.add(c);
    const t = mesh(new THREE.TorusGeometry(rad - 0.03, 0.03, 10, 48), lip);
    t.position.set(x, y, zb - 0.14);
    g.add(t);
    const well = mesh(new THREE.CircleGeometry(rad * 0.88, 48), M.port(), { cast: false });
    well.rotation.y = Math.PI;
    well.position.set(x, y, zb - 0.141);
    g.add(well);
    // domed cover glass with its anti-reflective tint, and the element behind it
    const er = rad * 0.6, R = er / Math.sin(0.55);
    const dome = mesh(new THREE.SphereGeometry(R, 40, 12, 0, Math.PI * 2, 0, 0.55), M.lensGlass(), { cast: false });
    dome.rotation.x = -Math.PI / 2;
    dome.position.set(x, y, zb - 0.142 + R * Math.cos(0.55));
    g.add(dome);
    const el = mesh(new THREE.CircleGeometry(er * 0.42, 32), LENS_EL, { cast: false });
    el.rotation.y = Math.PI;
    el.position.set(x, y, zb - 0.145);
    g.add(el);
  };
  lens(W / 2 - 1.0, py + 0.66, 0.6);
  lens(W / 2 - 1.0, py - 0.66, 0.6);
  lens(W / 2 - 2.18, py, 0.6);
  const fl = mesh(new THREE.CircleGeometry(0.16, 24), M.flash(), { cast: false });
  fl.rotation.y = Math.PI;
  fl.position.set(-W / 2 + 1.0, py + 0.8, -T / 2 - 0.122);
  g.add(fl);
  const li = mesh(new THREE.CircleGeometry(0.22, 24), M.lensGlass(), { cast: false });
  li.rotation.y = Math.PI;
  li.position.set(-W / 2 + 1.0, py - 0.8, -T / 2 - 0.122);
  g.add(li);
  const mark = mesh(kdMarkGeometry(1.7, 0.01), M.metal(0xeeeeee, 0.08));
  mark.rotation.y = Math.PI;
  mark.position.set(0, -1.2, -T / 2 - 0.002);
  g.add(mark);

  // buttons
  const btn = (side, y, len) => {
    const b = mesh(slab(0.32, len, 0.12, 0.15, 0.04), [frame, frame]);
    b.rotation.y = Math.PI / 2;
    b.position.set(side * (W / 2 + 0.02), y, -0.03);
    g.add(b);
  };
  btn(1, 2.6, 2.0); btn(1, -2.2, 1.5);
  btn(-1, 4.4, 0.75); btn(-1, 3.0, 1.3); btn(-1, 1.45, 1.3);

  // antenna bands: plastic breaks in the aluminium frame
  const band = M.plastic(new THREE.Color(fin.hex).multiplyScalar(0.5));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const a = mesh(new THREE.BoxGeometry(0.03, 0.06, 0.42), band, { cast: false });
    a.position.set(sx * (W / 2 - 0.004), sy * (H / 2 - 1.55), -0.04);
    g.add(a);
    const b = mesh(new THREE.BoxGeometry(0.06, 0.03, 0.42), band, { cast: false });
    b.position.set(sx * (W / 2 - 1.45), sy * (H / 2 - 0.004), -0.04);
    g.add(b);
  }
  // bottom edge: USB-C, speaker and microphone holes
  const port = mesh(panel(0.9, 0.3, 0.15), M.port(), { cast: false });
  port.rotation.x = Math.PI / 2;
  port.position.set(0, -H / 2 - 0.003, -0.04);
  g.add(port);
  const hole = new THREE.CircleGeometry(0.042, 12);
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) {
    if (sx < 0 && i > 3) continue;
    const m = mesh(hole, M.port(), { cast: false });
    m.rotation.x = Math.PI / 2;
    m.position.set(sx * (0.85 + i * 0.17), -H / 2 - 0.003, -0.04);
    g.add(m);
  }
  const ear = mesh(panel(1.3, 0.05, 0.025), M.port(), { cast: false });
  ear.position.set(0, H / 2 - 0.115, T / 2 + 0.003);
  g.add(ear);

  if (spec.case && spec.case !== 'none') {
    const cm = spec.case === 'clear'
      ? M.clearCase()
      : M.silicone(CASE_COLOURS.find((c) => c.id === spec.caseColor)?.hex || '#0339f8');
    const Wc = W + 0.34, Hc = H + 0.34, rc = r + 0.17;
    const sideT = T + 0.08;
    const shell = mesh(slab(Wc, Hc, sideT, rc, 0.1, n, [rrHole(W - 0.14, H - 0.14, r - 0.07, n)]), [cm, cm]);
    shell.position.z = 0.02;
    g.add(shell);
    const bp = mesh(slab(Wc, Hc, 0.14, rc, 0.06, n, [rrHole(W - 0.2, 3.65, 1.05, n, 0, py)]), [cm, cm]);
    bp.position.z = -T / 2 - 0.07;
    g.add(bp);
  }
  return { group: g, screens: [scr], dims: [W, H] };
}

// ---------------------------------------------------------------- iPad
function buildIpad(spec, fin, screenMat) {
  const g = new THREE.Group();
  const W = 17.75, H = 24.95, T = 0.53, r = 1.05, n = 2.4;
  const alu = M.anodised(fin.hex);
  const body = mesh(slab(W, H, T - 0.06, r, 0.07, n), [alu, alu]);
  body.position.z = -0.03;
  g.add(body);
  const glass = mesh(slab(W - 0.08, H - 0.08, 0.06, r - 0.04, 0.02, n), [M.blackGlass(), M.blackGlass()]);
  glass.position.z = T / 2 - 0.03;
  g.add(glass);
  const scr = mesh(panel(16.05, 23.28, 0.62, n), screenMat, { cast: false });
  scr.position.z = T / 2 + 0.002;
  g.add(scr);
  const cam = mesh(new THREE.CircleGeometry(0.11, 20), M.lensGlass(), { cast: false });
  cam.position.set(W / 2 - 0.42, 0, T / 2 + 0.003);
  g.add(cam);
  const bump = mesh(slab(2.1, 3.3, 0.14, 0.95, 0.05, n), [alu, alu]);
  const bx = W / 2 - 1.55, by = H / 2 - 2.15;
  bump.position.set(bx, by, -T / 2 - 0.04);
  g.add(bump);
  for (const [dy, rad] of [[0.75, 0.48], [-0.75, 0.48]]) {
    const gl = mesh(new THREE.CircleGeometry(rad, 36), M.lensGlass(), { cast: false });
    gl.rotation.y = Math.PI;
    gl.position.set(bx, by + dy, -T / 2 - 0.112);
    g.add(gl);
  }
  const mark = mesh(kdMarkGeometry(3.6, 0.01), M.metal(0xeeeeee, 0.08));
  mark.rotation.y = Math.PI;
  mark.position.set(0, 0, -T / 2 - 0.003);
  g.add(mark);

  // speaker grilles on both short edges, antenna lines, USB-C
  const hole = new THREE.CircleGeometry(0.035, 10);
  for (const sy of [-1, 1]) for (const sx of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const m = mesh(hole, M.port(), { cast: false });
      m.rotation.x = sy > 0 ? -Math.PI / 2 : Math.PI / 2;
      m.position.set(sx * (W / 2 - 3.6 + i * 0.14), sy * (H / 2 + 0.002), -0.03);
      g.add(m);
    }
  }
  const usb = mesh(panel(0.9, 0.26, 0.13), M.port(), { cast: false });
  usb.rotation.x = Math.PI / 2;
  usb.position.set(0, -H / 2 - 0.003, -0.03);
  g.add(usb);
  const band = M.plastic(new THREE.Color(fin.hex).multiplyScalar(0.55));
  for (const sx of [-1, 1]) {
    const a = mesh(new THREE.BoxGeometry(0.03, 2.4, 0.36), band, { cast: false });
    a.position.set(sx * (W / 2 - 0.004), H / 2 - 3.2, -0.03);
    g.add(a);
  }
  // Smart Connector and the magnetic Pencil strip
  const gold = M.metal(0x9a8a6c, 0.3);
  for (const dx of [-0.45, 0, 0.45]) {
    const c = mesh(new THREE.CircleGeometry(0.09, 16), gold, { cast: false });
    c.rotation.y = Math.PI;
    c.position.set(dx, -H / 2 + 1.1, -T / 2 - 0.004);
    g.add(c);
  }
  const strip = mesh(new THREE.BoxGeometry(0.02, 9, 0.34), M.plastic(new THREE.Color(fin.hex).multiplyScalar(0.7)), { cast: false });
  strip.position.set(W / 2 + 0.002, 0, -0.03);
  g.add(strip);
  return { group: g, screens: [scr], dims: [W, H] };
}

// ---------------------------------------------------------------- Foldable
function buildFold(spec, fin, screenMat) {
  const g = new THREE.Group();
  const Wp = 7.55, H = 15.6, T = 0.48, r = 0.95, n = 2.5;
  const frame = M.metal(fin.hex, 0.3);
  const back = M.frosted(fin.hex);
  const half = (180 - (spec.fold ?? 150)) / 2 * D2R;
  const screens = [], pivots = [];
  for (const side of [-1, 1]) {
    const pv = new THREE.Group();
    pv.rotation.y = side < 0 ? half : -half;
    pv.userData.side = side;
    pivots.push(pv);
    g.add(pv);
    const cx = side * (Wp / 2 + 0.06);
    const b = mesh(slab(Wp, H, T - 0.06, r, 0.12, n), [back, frame]);
    b.position.set(cx, 0, -0.03);
    pv.add(b);
    const gl = mesh(slab(Wp - 0.1, H - 0.1, 0.06, r - 0.05, 0.02, n), [M.blackGlass(), M.blackGlass()]);
    gl.position.set(cx, 0, T / 2 - 0.03);
    pv.add(gl);
    const sw = Wp - 0.36, sh = H - 0.5;
    // inner edges meet at the hinge, so the panel UVs split the artwork
    const scr = mesh(panel(sw, sh, 0.55, n, side < 0 ? 0 : 0.5, side < 0 ? 0.5 : 1), screenMat, { cast: false });
    scr.position.set(side * (sw / 2 + 0.12), 0, T / 2 + 0.002);
    pv.add(scr);
    screens.push(scr);
    if (side > 0) {
      const cam = mesh(new THREE.CircleGeometry(0.1, 20), NOTCH, { cast: false });
      cam.position.set(cx, sh / 2 - 0.45, T / 2 + 0.004);
      pv.add(cam);
    } else {
      const mark = mesh(kdMarkGeometry(1.8, 0.01), M.metal(0xeeeeee, 0.08));
      mark.rotation.y = Math.PI;
      mark.position.set(cx, -1, -T / 2 - 0.002);
      pv.add(mark);
      const bump = mesh(slab(2.0, 3.4, 0.12, 0.9, 0.04, n), [frame, frame]);
      bump.position.set(cx - Wp / 2 + 1.5, H / 2 - 2.2, -T / 2 - 0.04);
      pv.add(bump);
    }
  }
  const hinge = mesh(new THREE.CylinderGeometry(T / 2, T / 2, H - 0.6, 24), frame);
  hinge.position.z = -0.02;
  g.add(hinge);
  return { group: g, screens, dims: [Wp * 2, H], folds: pivots };
}

// ---------------------------------------------------------------- Studio Display
function buildDisplay(spec, fin, screenMat) {
  const g = new THREE.Group();
  const W = 62.3, H = 35.9, T = 1.6, r = 1.25;
  const alu = M.anodised(fin.hex);
  const head = new THREE.Group();
  head.position.set(0, 10.5 + H / 2, 0);
  g.add(head);
  const body = mesh(slab(W, H, T, r, 0.18), [alu, alu]);
  head.add(body);
  const glass = mesh(panel(W - 0.12, H - 0.12, r - 0.06), M.blackGlass(), { cast: false });
  glass.position.z = T / 2 + 0.002;
  head.add(glass);
  const scr = mesh(panel(60.3, 33.92, 0.3), screenMat, { cast: false });
  scr.position.z = T / 2 + 0.004;
  head.add(scr);
  const dcam = mesh(new THREE.CircleGeometry(0.16, 20), M.lensGlass(), { cast: false });
  dcam.position.set(0, H / 2 - 0.5, T / 2 + 0.006);
  head.add(dcam);
  const hump = mesh(slab(W - 12, H - 9, 1.6, 5, 0.6), [alu, alu]);
  hump.position.z = -T / 2 - 0.6;
  head.add(hump);
  const mark = mesh(kdMarkGeometry(6, 0.012), M.metal(0xeeeeee, 0.08));
  mark.rotation.y = Math.PI;
  mark.position.set(0, 3, -T / 2 - 1.41);
  head.add(mark);

  const foot = mesh(slab(17, 19, 0.6, 1.6, 0.2), [alu, alu]);
  foot.rotation.x = -Math.PI / 2;
  foot.position.set(0, 0.3, -4.5);
  g.add(foot);
  const rise = 10.5 + H / 2 - 0.6, lean = 9;
  const neck = mesh(slab(16, Math.hypot(rise, lean), 0.8, 1.2, 0.2), [alu, alu]);
  neck.rotation.x = Math.atan2(lean, rise);
  neck.position.set(0, 0.6 + rise / 2, -12.5 + lean / 2);
  g.add(neck);
  return { group: g, screens: [scr], dims: [W, H] };
}

const BUILDERS = { macbook: buildMacbook, iphone: buildIphone, ipad: buildIpad, fold: buildFold, display: buildDisplay };
for (const [id, P] of Object.entries(PROPS)) BUILDERS[id] = (spec, fin) => ({ group: P.build(fin), screens: [], dims: [0, 0] });



// ---------------------------------------------------------------- Device
export class Device {
  constructor(spec, library) {
    this.lib = library;
    this.root = new THREE.Group();
    this.root.userData.device = this;
    this.spec = {};
    this._sk = null;
    this.update(spec);
  }

  get id() { return this.spec.id; }

  update(spec) {
    const sk = [spec.model, spec.case, spec.caseColor, spec.pose, spec.support, spec.tilt, spec.finish, spec.roll].join('|');
    if (sk !== this._sk) { this._build(spec); this._sk = sk; }
    this.spec = { ...spec };
    const r = this.root;
    r.position.set(spec.x, 0, spec.z);
    r.rotation.y = spec.rot * D2R;
    r.scale.setScalar(spec.scale || 1);
    r.visible = spec.visible !== false;
    this.screenMat.emissiveIntensity = spec.brightness ?? 1;
    this.articulate(spec.lid, spec.fold);
    return this.paint();
  }

  paint(force = false, scroll = null) {
    const s = this.spec;
    const src = this.lib.get(s.screen);
    const kind = MODELS[s.model].kind;
    let ui = null;
    if (s.ui !== false) {
      if (kind === 'phone') ui = s.pose === 'landscape' ? null : { kind: 'phone' };
      else if (kind === 'tablet' || kind === 'fold') ui = { kind: 'tablet' };
      else if (src?.form !== 'mobile') ui = { kind, url: s.url || src?.url || '' };
    }
    return this.sc.paint(src, s.fill, scroll ?? (s.scroll || 0), force, ui);
  }

  // Lid and hinge move without a rebuild, so they can be animated.
  articulate(lid, fold) {
    if (this.lid && lid != null) this.lid.rotation.x = -(lid - 90) * D2R;
    if (this.folds && fold != null) {
      const half = (180 - fold) / 2 * D2R;
      for (const pv of this.folds) pv.rotation.y = pv.userData.side < 0 ? half : -half;
    }
  }

  isVideo() { return this.lib.get(this.spec.screen)?.kind === 'video'; }

  _dispose() {
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    this.root.clear();
    this.sc?.dispose();
  }

  _build(spec) {
    this._dispose();
    const model = MODELS[spec.model];
    const fin = model.finishes.find((f) => f.id === spec.finish) || model.finishes[0];
    const [pw, ph] = model.px || [1, 1];
    const landscape = model.poses && spec.pose === 'landscape';
    if (model.px) {
      this.sc = new ScreenCanvas(landscape ? ph : pw, landscape ? pw : ph, 2048, landscape);
      this.screenMat = screenMaterial(this.sc.texture);
    } else {
      this.sc = { paint: () => false, dispose() {} };
      this.screenMat = { emissiveIntensity: 1 };
    }
    const built = BUILDERS[spec.model](spec, fin, this.screenMat);
    this.screens = built.screens;
    for (const sm of this.screens) sm.receiveShadow = false;
    this.lid = built.lid || null;
    this.folds = built.folds || null;

    // body: the device in its pose; mount: tilt / lay flat; placed on support
    const body = built.group;
    if (landscape) body.rotation.z = Math.PI / 2;
    const mount = new THREE.Group();
    mount.add(body);
    const support = spec.support;
    if (support === 'float') {
      mount.rotation.set(-(spec.tilt || 0) * D2R, 0, (spec.roll || 0) * D2R);
    } else if (support === 'flat') mount.rotation.x = -Math.PI / 2;
    else if (support === 'riser') mount.rotation.x = 10 * D2R;
    else if (model.kind !== 'laptop' && model.kind !== 'display') mount.rotation.x = -(spec.tilt || 0) * D2R;

    const tmp = new THREE.Group();
    tmp.add(mount);
    tmp.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mount);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());

    let floorY = 0, zOff = 0;
    if (support === 'dock') {
      const bw = Math.max(4.2, size.x * 0.62 + 1.4), bd = 3.6, bh = 0.95;
      const base = mesh(slab(bw, bd, bh, 0.9, 0.3, 2.6), M.anodised(0xc9cbce));
      base.rotation.x = -Math.PI / 2;
      base.position.y = bh / 2;
      this.root.add(base);
      const slot = mesh(panel(bw - 0.9, 0.5, 0.22), M.rubber(), { cast: false });
      slot.rotation.x = -Math.PI / 2;
      slot.position.set(0, bh + 0.002, -0.35);
      this.root.add(slot);
      floorY = bh - 0.32;
      zOff = -0.35;
    } else if (support === 'riser') {
      const sw = 24, sd = 19;
      const m = M.anodised(0xc9cbce);
      const top = mesh(slab(sw, sd, 0.5, 1.2, 0.15), m);
      top.rotation.x = -Math.PI / 2 + 10 * D2R;
      top.position.set(0, 4.6, -0.2);
      this.root.add(top);
      for (const sx of [-1, 1]) {
        const leg = mesh(slab(0.6, 7.8, 0.6, 0.3, 0.1), m);
        leg.position.set(sx * (sw / 2 - 1.5), 3.6, -sd / 2 + 1.8);
        leg.rotation.x = -0.25;
        this.root.add(leg);
        const ft = mesh(slab(0.8, 16, 0.5, 0.4, 0.12), m);
        ft.rotation.x = -Math.PI / 2;
        ft.position.set(sx * (sw / 2 - 1.5), 0.25, -1);
        this.root.add(ft);
      }
      floorY = 4.85 + Math.sin(10 * D2R) * (size.z / 2);
    } else if (support === 'float') {
      floorY = Math.max(2.5, size.y * 0.16);
    }
    mount.position.set(-c.x, floorY - box.min.y, zOff - c.z);
    this.root.add(mount);
    this.mount = mount;

    // contact shadow
    const shadowMat = new THREE.MeshBasicMaterial({
      map: contactTexture(), transparent: true, depthWrite: false, opacity: 0.55,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const fw = size.x * (support === 'float' ? 1.5 : 1.12) + 3;
    const fd = size.z * (support === 'float' ? 1.5 : 1.12) + 3;
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(fw, Math.max(fd, 3)), shadowMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, 0.06, zOff * 0.5);
    blob.renderOrder = -1;
    blob.userData.contact = true;
    blob.userData.float = support === 'float';
    this.root.add(blob);
    this.contact = blob;
    this.root.traverse((o) => { if (o.isMesh) o.userData.device = this; });
  }

  setContactStrength(k) {
    if (this.contact) this.contact.material.opacity = k * (this.contact.userData.float ? 0.4 : 0.85);
  }
}
