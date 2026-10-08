// Document model, presets, history and autosave.
import { defaultSpec } from './devices.js';
import { newText } from './overlay.js';
import { ENVIRONMENTS } from './environments.js';

export const ARTBOARDS = {
  launch: { label: 'Launch 16:9', w: 1920, h: 1080 },
  appstore: { label: 'App Store 6.9″', w: 1290, h: 2796 },
  square: { label: 'Social 1:1', w: 1080, h: 1080 },
  portrait: { label: 'Social 4:5', w: 1080, h: 1350 },
  og: { label: 'Open Graph', w: 1200, h: 630 },
  story: { label: 'Story 9:16', w: 1080, h: 1920 },
};

const T = (kind, over) => newText(kind, over);

function headlineSet(head, chip, light = false) {
  return [
    T('headline', { text: head, x: 0.055, y: 0.085, size: 66, width: 0.46 }),
    T('chip', { text: chip, x: 0.055, y: 0.27, size: 22, color: 'paper' }),
  ];
}

export const SCENES = {
  launch: {
    label: 'Launch pair', note: '2 devices',
    make: () => ({
      name: 'Launch shot',
      bg: { preset: 'ink' }, light: { preset: 'studio', dir: 0.22, shadows: 0.65 },
      cam: { preset: 'hero', shift: { x: 0, y: -0.06 } },
      devices: [
        defaultSpec('macbook', { x: -4, z: -2, rot: 17, finish: 'midnight', screen: 'kd-desktop' }),
        defaultSpec('iphone', { x: 20, z: 5, rot: -14, finish: 'silver', screen: 'kd-mobile', support: 'dock' }),
      ],
      texts: headlineSet('Brand and digital design that earns its keep.', 'Now on every screen'),
    }),
  },
  hero: {
    label: 'Hero phone', note: '1 device',
    make: () => ({
      name: 'Hero phone',
      bg: { preset: 'aurora' }, light: { preset: 'studio', dir: 0.3, shadows: 0.6 },
      cam: { preset: 'hero', shift: { x: 0.12, y: -0.04 } },
      devices: [defaultSpec('iphone', { rot: -22, finish: 'orange', screen: 'ie-mobile', support: 'dock' })],
      texts: headlineSet('Some minds don’t wander. They soar.', 'The Imagination Explorer'),
    }),
  },
  trio: {
    label: 'Studio trio', note: '3 devices',
    make: () => ({
      name: 'Studio trio',
      bg: { preset: 'paper' }, light: { preset: 'softbox', dir: 0.2, shadows: 0.55 },
      cam: { preset: 'three', shift: { x: 0, y: -0.04 } },
      devices: [
        defaultSpec('macbook', { x: -10, z: -4, rot: 10, finish: 'silver', screen: 'fkb-desktop' }),
        defaultSpec('ipad', { x: 20, z: -3, rot: -16, pose: 'landscape', finish: 'silver', screen: 'fkb-desktop', support: 'dock', tilt: 11 }),
        defaultSpec('iphone', { x: 9, z: 10, rot: -6, finish: 'black', screen: 'fkb-mobile', support: 'dock' }),
      ],
      texts: [
        T('label', { text: 'FKB Glass & Glazing', x: 0.055, y: 0.075, size: 14 }),
        T('headline', { text: 'Dublin’s glass & glazing specialists.', x: 0.055, y: 0.11, size: 58, width: 0.42 }),
      ],
    }),
  },
  fold: {
    label: 'Fold story', note: '2 devices',
    make: () => ({
      name: 'Fold story',
      bg: { preset: 'electric' }, light: { preset: 'night', dir: 0.35, shadows: 0.6 },
      cam: { preset: 'hero', shift: { x: 0.1, y: -0.02 } },
      devices: [
        defaultSpec('fold', { x: -5, z: 0, rot: 18, screen: 'ie-desktop', fill: 'fill' }),
        defaultSpec('iphone', { x: 11, z: 4, rot: -12, finish: 'kd', screen: 'kd-mark', support: 'dock', fill: 'fill' }),
      ],
      texts: headlineSet('Unfold the whole story.', 'Built for every form'),
    }),
  },
  tablet: {
    label: 'Tablet & phone', note: '2 devices',
    make: () => ({
      name: 'Tablet & phone',
      bg: { preset: 'dusk' }, light: { preset: 'golden', dir: 0.15, shadows: 0.7 },
      cam: { preset: 'hero', shift: { x: 0.12, y: -0.03 } },
      devices: [
        defaultSpec('ipad', { x: -6, z: 0, rot: 15, finish: 'black', screen: 'ie-mobile', support: 'dock' }),
        defaultSpec('iphone', { x: 10, z: 5, rot: -12, finish: 'black', screen: 'ie-mobile', support: 'dock', case: 'silicone', caseColor: 'coral' }),
      ],
      texts: headlineSet('Read it together.', 'Bedtime, reimagined'),
    }),
  },
  stone: {
    label: 'Stone steps', note: 'Warm key, dark concrete',
    make: () => ({
      name: 'Stone steps',
      env: { id: 'stone', lights: {} }, bg: { preset: 'ink' }, light: { preset: 'studio', dir: 0.2, shadows: 0.8 },
      cam: { preset: 'three', shift: { x: 0, y: 0 } },
      render: { floor: 'matte', soft: 0.5 },
      devices: [defaultSpec('macbook', { x: 0, z: 0, rot: 22, finish: 'midnight', screen: 'kd-desktop', lid: 110 })],
      texts: headlineSet('Built for the long night.', 'Now on every screen'),
    }),
  },
  float: {
    label: 'Void float', note: 'Floating, coloured rims',
    make: () => ({
      name: 'Void float',
      env: { id: 'void', lights: {} }, bg: { preset: 'ink' }, light: { preset: 'studio', dir: 0.2, shadows: 0.5 },
      cam: { preset: 'front', shift: { x: 0, y: 0 } },
      render: { floor: 'matte', soft: 0.4 },
      devices: [
        defaultSpec('macbook', { x: -17, z: 0, rot: 18, finish: 'kd', screen: 'kd-desktop', support: 'float', tilt: -24, roll: -12 }),
        defaultSpec('macbook', { x: 17, z: -4, rot: -16, finish: 'silver', screen: 'fkb-desktop', support: 'float', tilt: -20, roll: 10 }),
      ],
      texts: [],
    }),
  },
  plinth: {
    label: 'White plinth', note: 'Plaster room',
    make: () => ({
      name: 'White plinth',
      env: { id: 'plinth', lights: {} }, bg: { preset: 'paper' }, light: { preset: 'softbox', dir: 0.2, shadows: 0.65 },
      cam: { preset: 'three', shift: { x: 0, y: 0 } },
      render: { floor: 'matte', soft: 0.6 },
      devices: [
        defaultSpec('macbook', { x: -6, z: -4, rot: 24, finish: 'silver', screen: 'fkb-desktop', lid: 105 }),
        defaultSpec('iphone', { x: 26, z: 14, rot: -10, finish: 'silver', screen: 'fkb-mobile', support: 'dock' }),
      ],
      texts: [],
    }),
  },
  deskstory: {
    label: 'Desk at dusk', note: 'Walnut, blinds on the wall',
    make: () => ({
      name: 'Desk at dusk',
      env: { id: 'desk', lights: {} }, bg: { preset: 'ink' }, light: { preset: 'studio', dir: 0.2, shadows: 0.85 },
      cam: { preset: 'hero', shift: { x: 0, y: 0 } },
      render: { floor: 'matte', soft: 0.5 },
      devices: [
        defaultSpec('macbook', { x: -4, z: -6, rot: 12, finish: 'silver', screen: 'kd-desktop', lid: 106 }),
        defaultSpec('plant', { x: -52, z: -26, rot: 20, finish: 'paper', screen: null }),
        defaultSpec('books', { x: 44, z: -24, rot: -8, finish: 'neutral', screen: null }),
        defaultSpec('mug', { x: 34, z: 14, rot: -35, finish: 'ink', screen: null }),
      ],
      texts: [],
    }),
  },
  neon: {
    label: 'Neon ledge', note: 'Green and blue light',
    make: () => ({
      name: 'Neon ledge',
      env: { id: 'neon', lights: {} }, bg: { preset: 'ink' }, light: { preset: 'studio', dir: 0.2, shadows: 0.7 },
      cam: { preset: 'three', shift: { x: 0, y: 0 } },
      render: { floor: 'matte', soft: 0.4 },
      devices: [defaultSpec('macbook', { x: 4, z: 6, rot: 20, finish: 'midnight', screen: 'ie-desktop', lid: 112 })],
      texts: headlineSet('Light it up.', 'The Imagination Explorer'),
    }),
  },
  desk: {
    label: 'Desk setup', note: '2 devices',
    make: () => ({
      name: 'Desk setup',
      bg: { preset: 'studio' }, light: { preset: 'studio', dir: 0.25, shadows: 0.6 },
      cam: { preset: 'front', shift: { x: 0, y: -0.02 } },
      devices: [
        defaultSpec('display', { x: 0, z: -6, screen: 'kd-desktop' }),
        defaultSpec('iphone', { x: 30, z: 10, rot: -18, finish: 'silver', screen: 'kd-mobile', support: 'dock' }),
      ],
      texts: [],
    }),
  },
  flat: {
    label: 'Flat lay', note: '3 devices',
    make: () => ({
      name: 'Flat lay',
      bg: { preset: 'paper' }, light: { preset: 'softbox', dir: 0.1, shadows: 0.7 },
      cam: { preset: 'top', shift: { x: 0, y: 0 } },
      devices: [
        defaultSpec('iphone', { x: -9.5, z: 1.5, support: 'flat', finish: 'silver', screen: 'kd-mobile', rot: 6 }),
        defaultSpec('iphone', { x: 0, z: -1, support: 'flat', finish: 'kd', screen: 'ie-mobile', rot: 0 }),
        defaultSpec('iphone', { x: 9.5, z: 1.5, support: 'flat', finish: 'black', screen: 'fkb-mobile', rot: -6 }),
      ],
      texts: [],
    }),
  },
};

export function makeDoc(scene = 'launch', artboard = 'launch') {
  const s = SCENES[scene].make();
  return {
    v: 1,
    artboard,
    ...s,
    cam: { mode: '3d', orbit: false, pos: null, target: null, fov: null, ...s.cam },
    env: { id: 'studio', lights: {}, ...(s.env || {}) },
    bg: { preset: 'ink', ...s.bg },
    light: { preset: 'studio', dir: 0.2, shadows: 0.6, ...s.light },
    render: { quality: 'high', soft: 0.45, dof: 0, floor: s.bg?.preset === 'paper' || s.bg?.preset === 'studio' ? 'matte' : 'satin', haze: 0, bloom: 0, vignette: 0, grain: 0, contact: 1, ...(ENVIRONMENTS[s.env?.id]?.post || {}), ...(s.render || {}) },
  };
}

// ---------- history ----------
export class History {
  constructor(limit = 80) { this.stack = []; this.i = -1; this.limit = limit; }
  push(doc) {
    const s = JSON.stringify(doc);
    if (this.stack[this.i] === s) return;
    this.stack = this.stack.slice(0, this.i + 1);
    this.stack.push(s);
    if (this.stack.length > this.limit) this.stack.shift();
    this.i = this.stack.length - 1;
  }
  undo() { if (this.i > 0) return JSON.parse(this.stack[--this.i]); return null; }
  redo() { if (this.i < this.stack.length - 1) return JSON.parse(this.stack[++this.i]); return null; }
}

// ---------- autosave ----------
const KEY = 'kd-vantage-doc';
export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    return d && d.v === 1 && Array.isArray(d.devices) ? d : null;
  } catch { return null; }
}
export function save(doc) {
  try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch { /* storage off */ }
}
