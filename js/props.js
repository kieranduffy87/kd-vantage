// Set dressing. Every prop is modelled at real size in centimetres so it
// scales correctly against the devices.
import * as THREE from 'three';
import { slab, mesh, M } from './geo.js';

const ceramic = (hex) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.15 });
const matte = (hex, r = 0.85) => new THREE.MeshStandardMaterial({ color: hex, roughness: r });

function lathe(profile, seg = 64) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

// ---------- mug ----------
function mug(c) {
  const g = new THREE.Group();
  const m = ceramic(c.hex);
  const R = 4.2, H = 9.4, t = 0.38;
  const prof = [[0.01, 0], [R - 0.5, 0], [R - 0.1, 0.25], [R, 1], [R, H - 0.15], [R - 0.08, H], [R - t, H], [R - t, 0.9], [0.01, 0.9]];
  const body = mesh(lathe(prof), m);
  g.add(body);
  const coffee = mesh(new THREE.CircleGeometry(R - t, 48), new THREE.MeshPhysicalMaterial({ color: '#3a2216', roughness: 0.15, clearcoat: 1 }), { cast: false });
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = H - 1.6;
  g.add(coffee);
  const handle = mesh(new THREE.TorusGeometry(2.4, 0.5, 18, 40, Math.PI * 1.15), m);
  handle.rotation.z = -Math.PI * 0.575;
  handle.position.set(R + 0.6, H * 0.52, 0);
  handle.scale.set(0.75, 1, 1);
  g.add(handle);
  return g;
}

// ---------- plant: a snake plant in a ceramic planter ----------
let leafTex;
function leafMap() {
  if (leafTex) return leafTex;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 512;
  const x = cv.getContext('2d');
  x.fillStyle = '#2f5a2e';
  x.fillRect(0, 0, 64, 512);
  // banding typical of sansevieria
  for (let y = 0; y < 512; y += 9 + Math.random() * 14) {
    x.fillStyle = `rgba(${150 + Math.random() * 40},${180 + Math.random() * 40},${110},${0.18 + Math.random() * 0.2})`;
    x.beginPath();
    x.ellipse(32, y, 34, 2 + Math.random() * 3, (Math.random() - 0.5) * 0.4, 0, Math.PI * 2);
    x.fill();
  }
  // yellow margins
  const gr = x.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, 'rgba(214,201,94,0.95)'); gr.addColorStop(0.1, 'rgba(214,201,94,0)');
  gr.addColorStop(0.9, 'rgba(214,201,94,0)'); gr.addColorStop(1, 'rgba(214,201,94,0.95)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 512);
  leafTex = new THREE.CanvasTexture(cv);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  return leafTex;
}

function leaf(h, w, bend, twist) {
  // a sword leaf: tapered, gently cupped, bending outwards
  const geo = new THREE.PlaneGeometry(w, h, 6, 24);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w, v = Math.min(1, Math.max(0, p.getY(i) / h + 0.5)); // u -0.5..0.5, v 0..1
    const taper = Math.pow(1 - v, 0.55) * (1 - Math.pow(v, 6) * 0.9);
    const x = u * w * taper;
    const z = -Math.abs(u) * w * 0.35 * taper + bend * v * v * h;
    const y = v * h;
    const tw = twist * v;
    p.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw), y, x * Math.sin(tw) + z * Math.cos(tw));
  }
  geo.computeVertexNormals();
  return geo;
}

function plant(c) {
  const g = new THREE.Group();
  const potM = c.id === 'terracotta' ? matte(c.hex, 0.9) : ceramic(c.hex);
  const R = 6.2, H = 11;
  const pot = mesh(lathe([[0.01, 0], [R - 1.1, 0], [R - 0.6, 0.6], [R, H - 0.6], [R, H], [R - 0.45, H], [R - 0.5, 1.2], [0.01, 1.2]]), potM);
  g.add(pot);
  const soil = mesh(new THREE.CircleGeometry(R - 0.5, 40), matte('#2a1d14', 1), { cast: false });
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = H - 1.2;
  g.add(soil);
  const lm = new THREE.MeshPhysicalMaterial({ map: leafMap(), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
  const rnd = mulberry(7);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.5;
    const rr = rnd() * 2.4;
    const h = 26 + rnd() * 20, w = 3.6 + rnd() * 1.6;
    const lf = mesh(leaf(h, w, 0.06 + rnd() * 0.1, (rnd() - 0.5) * 1.2), lm);
    lf.position.set(Math.cos(a) * rr, H - 1.4, Math.sin(a) * rr);
    lf.rotation.y = -a + Math.PI / 2;
    g.add(lf);
  }
  return g;
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- notebook ----------
function notebook(c) {
  const g = new THREE.Group();
  const W = 14.8, D = 21, T = 1.5;
  const cover = new THREE.MeshPhysicalMaterial({ color: c.hex, roughness: 0.62, sheen: 0.5, sheenRoughness: 0.7 });
  const top = mesh(slab(W, D, 0.12, 0.6, 0.04), cover);
  top.rotation.x = -Math.PI / 2;
  top.position.y = T - 0.06;
  g.add(top);
  const bot = top.clone();
  bot.position.y = 0.06;
  g.add(bot);
  const pages = mesh(slab(W - 0.35, D - 0.4, T - 0.22, 0.45, 0.03), matte('#f3efe4', 0.95));
  pages.rotation.x = -Math.PI / 2;
  pages.position.set(0.12, T / 2, 0);
  g.add(pages);
  const spine = mesh(new THREE.CylinderGeometry(T / 2, T / 2, D, 24, 1, false, Math.PI, Math.PI), cover);
  spine.rotation.x = Math.PI / 2;
  spine.position.set(-W / 2 + 0.05, T / 2, 0);
  g.add(spine);
  const band = mesh(new THREE.BoxGeometry(0.6, T + 0.06, D + 0.04), matte(c.id === 'paper' ? '#0e0f12' : '#1a1b1f', 0.7));
  band.position.set(W / 2 - 2.2, T / 2, 0);
  g.add(band);
  return g;
}

// ---------- pen ----------
function pen(c) {
  const g = new THREE.Group();
  const body = M.metal(c.hex, 0.28);
  const L = 14, r = 0.5;
  const barrel = mesh(new THREE.CylinderGeometry(r, r, L - 2, 32), body);
  barrel.rotation.z = Math.PI / 2;
  g.add(barrel);
  const cone = mesh(new THREE.CylinderGeometry(r, 0.12, 1.6, 32), body);
  cone.rotation.z = Math.PI / 2;
  cone.position.x = (L - 2) / 2 + 0.8;
  g.add(cone);
  const tip = mesh(new THREE.SphereGeometry(0.13, 12, 8), M.metal(0xcfcfd4, 0.2));
  tip.position.x = (L - 2) / 2 + 1.62;
  g.add(tip);
  const cap = mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), body);
  cap.rotation.z = Math.PI / 2;
  cap.position.x = -(L - 2) / 2;
  g.add(cap);
  const clip = mesh(slab(4.2, 0.36, 0.1, 0.12, 0.03), M.metal(0xd9dadf, 0.18));
  clip.position.set(-(L - 2) / 2 + 2.4, 0, r + 0.08);
  clip.rotation.x = Math.PI / 2;
  g.add(clip);
  g.position.y = r;
  const outer = new THREE.Group();
  outer.add(g);
  return outer;
}

// ---------- earbuds case ----------
function earbuds(c) {
  const g = new THREE.Group();
  const m = new THREE.MeshPhysicalMaterial({ color: c.hex, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  const W = 6.0, H = 4.6, T = 2.2;
  const base = mesh(slab(W, H, T, 1.9, 0.9, 2.2), m);
  base.position.y = H / 2;
  g.add(base);
  const seam = mesh(new THREE.BoxGeometry(W - 0.2, 0.025, T - 0.1), matte('#9a9a9e', 0.6), { cast: false });
  seam.position.y = H - 1.25;
  g.add(seam);
  const led = mesh(new THREE.CircleGeometry(0.05, 12), new THREE.MeshBasicMaterial({ color: '#7dffb0' }), { cast: false });
  led.position.set(0, H * 0.45, T / 2 + 0.005);
  g.add(led);
  return g;
}

// ---------- book stack ----------
function books(c) {
  const g = new THREE.Group();
  const spines = c.id === 'kd' ? ['#0339f8', '#0e0f12', '#efece4'] : c.id === 'warm' ? ['#ff7a59', '#efece4', '#2a1a1c'] : ['#2b2d33', '#8e8a80', '#efece4'];
  let y = 0;
  [[22, 28, 2.6, 0.08], [19, 25, 3.2, -0.12], [17, 23, 2.2, 0.2]].forEach(([w, d, t, rot], i) => {
    const b = new THREE.Group();
    const cover = new THREE.MeshPhysicalMaterial({ color: spines[i], roughness: 0.6, sheen: 0.4 });
    const block = mesh(slab(w, d, t, 0.25, 0.05), [cover, matte('#f1ede2', 0.95)]);
    block.rotation.x = -Math.PI / 2;
    b.add(block);
    const lid = mesh(slab(w + 0.3, d + 0.2, 0.18, 0.3, 0.05), cover);
    lid.rotation.x = -Math.PI / 2;
    lid.position.set(-0.15, t / 2 - 0.09, 0);
    b.add(lid);
    const lid2 = lid.clone();
    lid2.position.y = -t / 2 + 0.09;
    b.add(lid2);
    const sp = mesh(new THREE.BoxGeometry(0.2, t + 0.02, d + 0.2), cover);
    sp.position.x = -w / 2 - 0.2;
    b.add(sp);
    b.position.y = y + t / 2;
    b.rotation.y = rot;
    g.add(b);
    y += t;
  });
  return g;
}

export const PROPS = {
  plant: {
    label: 'Snake plant', build: plant,
    finishes: [{ id: 'paper', label: 'Paper ceramic', hex: '#efece4' }, { id: 'terracotta', label: 'Terracotta', hex: '#c06a45' }, { id: 'ink', label: 'Ink', hex: '#1b1c20' }, { id: 'kd', label: 'KD Blue', hex: '#0339f8' }],
  },
  mug: {
    label: 'Coffee mug', build: mug,
    finishes: [{ id: 'paper', label: 'Paper', hex: '#efece4' }, { id: 'ink', label: 'Ink', hex: '#1b1c20' }, { id: 'kd', label: 'KD Blue', hex: '#0339f8' }, { id: 'coral', label: 'Coral', hex: '#ff7a59' }],
  },
  notebook: {
    label: 'Notebook', build: notebook,
    finishes: [{ id: 'ink', label: 'Ink', hex: '#1b1c20' }, { id: 'kd', label: 'KD Blue', hex: '#0339f8' }, { id: 'coral', label: 'Coral', hex: '#e8694a' }, { id: 'paper', label: 'Paper', hex: '#e8e3d6' }],
  },
  pen: {
    label: 'Pen', build: pen,
    finishes: [{ id: 'ink', label: 'Ink', hex: '#1d1e22' }, { id: 'silver', label: 'Silver', hex: '#c9cacd' }, { id: 'kd', label: 'KD Blue', hex: '#0339f8' }],
  },
  earbuds: {
    label: 'Earbuds case', build: earbuds,
    finishes: [{ id: 'white', label: 'White', hex: '#f4f4f2' }, { id: 'ink', label: 'Ink', hex: '#1b1c20' }],
  },
  books: {
    label: 'Book stack', build: books,
    finishes: [{ id: 'kd', label: 'KD palette', hex: '#0339f8' }, { id: 'neutral', label: 'Neutral', hex: '#8e8a80' }, { id: 'warm', label: 'Warm', hex: '#ff7a59' }],
  },
};
