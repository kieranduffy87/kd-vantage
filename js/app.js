// KD Vantage — app controller: document, selection, panels, interaction,
// motion and export. The stage owns the 3D; this file owns everything else.
import * as THREE from 'three';
import { Stage, BACKGROUNDS, LIGHTS, CAMERAS, FLOORS, QUALITY } from './stage.js';
import { ScreenLibrary } from './screens.js';
import { MODELS, CASE_COLOURS, SUPPORT_LABEL, defaultSpec, screenPixels } from './devices.js';
import { ENVIRONMENTS, MATERIALS, lightAngles } from './environments.js';
import { drawText, newText, TEXT_KINDS, TEXT_COLOURS, TEXT_SWATCHES } from './overlay.js';
import { ARTBOARDS, SCENES, makeDoc, History, load, save } from './store.js';
import { h, svg, ICON, section, row, seg, select as dropdown, swatches, slider, num, toggle, toast, download } from './ui.js';

const $ = (s) => document.querySelector(s);
const D2R = Math.PI / 180;
const KIND_ICON = { laptop: 'laptop', phone: 'phone', tablet: 'tablet', fold: 'fold', display: 'display', prop: 'prop' };
const isProp = (d) => MODELS[d.model]?.kind === 'prop';

const lib = new ScreenLibrary();
const stageEl = $('#stage'), frame = $('#frame'), glCanvas = $('#gl'), ink = $('#ink'), selLayer = $('#sel');
const leftBody = $('#left-body'), rightBody = $('#right-body');

let doc, stage;
const history = new History();
let sel = null;            // { type: 'device' | 'text' | 'camera' | 'light' | 'bg', id }
let hoverId = null;
let tool = 'select';
let leftTab = 'layers', rightTab = 'design';
let textBoxes = [];
let inkDirty = true;
let pickerOpen = false;
const motion = { preset: 'turntable', dur: 6, playing: false, recording: null, t0: 0, base: null };
const exportOpts = { scale: 2, format: 'png', transparent: false };

// ---------------------------------------------------------------- helpers
const ab = () => ARTBOARDS[doc.artboard] || ARTBOARDS.launch;
const textScale = (a = ab()) => Math.min(a.w, a.h) / 1080;
const devSpec = (id) => doc.devices.find((d) => d.id === id);
const txtSpec = (id) => doc.texts.find((t) => t.id === id);
const selected = () => (sel?.type === 'device' ? devSpec(sel.id) : sel?.type === 'text' ? txtSpec(sel.id) : null);

function envOf() {
  doc.env = { id: 'studio', lights: {}, ...(doc.env || {}) };
  if (!ENVIRONMENTS[doc.env.id]) doc.env.id = 'studio';
  return doc.env;
}

function renderOf() {
  doc.render = { quality: 'high', soft: 0.45, dof: 0, floor: 'satin', haze: 0, bloom: 0, vignette: 0, grain: 0, contact: 1, ...(doc.render || {}) };
  return doc.render;
}
const EXPORT_SAMPLES = { draft: 12, high: 72, ultra: 192 };

function bgOf() {
  const base = BACKGROUNDS[doc.bg.preset] || BACKGROUNDS.ink;
  const o = { ...base };
  for (const k of ['top', 'horizon', 'glow', 'glowK', 'beams']) if (doc.bg[k] != null) o[k] = doc.bg[k];
  return o;
}
function isLight() {
  const e = doc.env?.id && ENVIRONMENTS[doc.env.id];
  const c = new THREE.Color(e && doc.env.id !== 'studio' ? e.bg : bgOf().horizon);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.35;
}
const slug = (s) => (s || 'vantage').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vantage';

// ---------------------------------------------------------------- commit
let saveT;
function commit({ devices = false, texts = false, scene = false, layers = true, inspector = false } = {}) {
  if (devices) { stage.syncDevices(doc.devices); stage.setLighting(doc.light.preset, doc.light.dir, doc.light.shadows); }
  if (scene) applyScene();
  if (texts || scene) inkDirty = true;
  if (layers) renderLeft();
  if (inspector) renderRight();
  updateUndo();
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    doc.cam = { ...doc.cam, ...stage.getCam() };
    history.push(doc);
    save(doc);
    updateUndo();
  }, 280);
}

function applyScene() {
  stage.setBackground(bgOf());
  stage.elOverride = doc.light.el ?? null;
  stage.setLighting(doc.light.preset, doc.light.dir, doc.light.shadows);
  const e = envOf();
  stage.setEnvironment(e.id, { floor: e.floor, floorTint: e.floorTint, wall: e.wall, wallTint: e.wallTint, lights: e.lights, gobo: e.gobo });
  stage.setShift(doc.cam.shift?.x || 0, doc.cam.shift?.y || 0);
  stage.controls.enableRotate = doc.cam.mode !== '2d';
  stage.controls.autoRotate = !!doc.cam.orbit && doc.cam.mode !== '2d';
  stage.controls.autoRotateSpeed = 0.7;
  const R = renderOf();
  stage.setQuality({ samples: QUALITY[R.quality]?.samples ?? 40, soft: R.soft, dof: R.dof, floor: R.floor });
  stage.setPost({ haze: R.haze, bloom: R.bloom, vignette: R.vignette, grain: R.grain, contact: R.contact });
  frame.classList.toggle('is-transparent', false);
  inkDirty = true;
}

function applyDoc({ fit = false } = {}) {
  layout();
  stage.syncDevices(doc.devices);
  applyScene();
  if (fit || !doc.cam.pos) frameCamera(0);
  else stage.setCam(doc.cam);
  $('#doc-name').value = doc.name || 'Untitled';
  syncModeSeg();
}

function frameCamera(ms = 700) {
  const preset = CAMERAS[doc.cam.preset] ? doc.cam.preset : 'hero';
  stage.goTo(stage.presetPose(preset, doc.cam.mode === '2d'), ms);
  setTimeout(() => { doc.cam = { ...doc.cam, ...stage.getCam() }; updateZoom(); commit({ layers: false }); }, ms + 30);
}

// ---------------------------------------------------------------- layout
function layout() {
  const r = stageEl.getBoundingClientRect();
  const a = ab();
  const padX = r.width < 600 ? 16 : 48, padTop = r.width < 600 ? 16 : 44, padBot = r.width < 600 ? 56 : 76;
  const aw = r.width - padX * 2, ah = r.height - padTop - padBot;
  const k = Math.min(aw / a.w, ah / a.h);
  const w = Math.max(80, Math.floor(a.w * k)), hgt = Math.max(60, Math.floor(a.h * k));
  Object.assign(frame.style, {
    width: w + 'px', height: hgt + 'px',
    left: Math.round((r.width - w) / 2) + 'px', top: Math.round(padTop + (ah - hgt) / 2) + 'px',
  });
  stage.setSize(w, hgt);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  ink.width = Math.round(w * dpr);
  ink.height = Math.round(hgt * dpr);
  inkDirty = true;
}

// ---------------------------------------------------------------- overlay + selection
function drawInk() {
  const ctx = ink.getContext('2d');
  ctx.clearRect(0, 0, ink.width, ink.height);
  textBoxes = drawText(ctx, doc.texts, ink.width, ink.height, (ink.width / ab().w) * textScale(), isLight());
  inkDirty = false;
  drawSel();
}

const selBox = h('div', { class: 'sel__box' }, h('i'), h('i'), h('i'), h('i'),
  h('span', { class: 'sel__tag' }), h('span', { class: 'sel__dim' }),
  h('span', { class: 'sel__rot', title: 'Drag to rotate' }, svg(ICON.rotate)));
const hovBox = h('div', { class: 'sel__box sel__box--hover' });
selLayer.append(hovBox, selBox);

function boxFor(s) {
  if (!s) return null;
  if (s.type === 'device') return stage.rectOf(s.id);
  if (s.type === 'text') {
    const b = textBoxes.find((t) => t.id === s.id);
    if (!b) return null;
    const k = frame.clientWidth / ink.width;
    return { x: b.x * k - 4, y: b.y * k - 4, w: b.w * k + 8, h: b.h * k + 8 };
  }
  return null;
}

function place(el, r) {
  if (!r || motion.recording) { el.style.display = 'none'; return; }
  Object.assign(el.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
}

// ---------------------------------------------------------------- light handles
// Every light gets a draggable handle in the viewport: drag sideways to swing
// it round its target, up and down to raise or lower it.
const lampEls = new Map();
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
let lampDrag = null;

function lampList() {
  const e = envOf();
  if (e.id === 'studio') {
    return [{ id: 'studio-key', label: 'Key light', color: '#ffffff', pos: stage.key.position }];
  }
  const E = ENVIRONMENTS[e.id];
  return (stage.envLights || []).map((l) => {
    const def = E.lights.find((L) => L.id === l.userData.lightId);
    return { id: def.id, label: def.label, color: e.lights[def.id]?.color || def.color, pos: l.position, def };
  });
}

function showLamps() {
  return tool === 'select' && !motion.recording && !motion.playing && (!sel || sel.type === 'light' || sel.type === 'bg');
}

function drawLamps() {
  const want = showLamps() ? lampList() : [];
  const seen = new Set();
  const W = frame.clientWidth, H = frame.clientHeight, m = 18;
  for (const L of want) {
    seen.add(L.id);
    let el = lampEls.get(L.id);
    if (!el) {
      el = h('div', { class: 'lamp', title: 'Drag to move the light' }, svg(SUN), h('span'));
      el.addEventListener('pointerdown', (ev) => startLampDrag(ev, el));
      selLayer.append(el);
      lampEls.set(L.id, el);
    }
    el.dataset.id = L.id;
    el.style.setProperty('--c', L.color);
    el.querySelector('span').textContent = L.label;
    const v = L.pos.clone().project(stage.camera);
    let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    if (v.z > 1) { x = W - x; y = H - y; } // behind the camera: mirror so it pins to the right edge
    const cx = Math.min(W - m, Math.max(m, x)), cy = Math.min(H - m, Math.max(m, y));
    el.classList.toggle('is-edge', cx !== x || cy !== y || v.z > 1);
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
  }
  for (const [id, el] of lampEls) if (!seen.has(id)) { el.remove(); lampEls.delete(id); }
}

function startLampDrag(ev, el) {
  ev.stopPropagation();
  ev.preventDefault();
  const id = el.dataset.id;
  const e = envOf();
  let base;
  if (id === 'studio-key') base = { dir: doc.light.dir, el: doc.light.el ?? LIGHTS[doc.light.preset].el };
  else {
    const def = ENVIRONMENTS[e.id].lights.find((L) => L.id === id);
    const ov = (e.lights[id] ||= {});
    const a = lightAngles(def);
    base = { az: ov.az ?? a.az, el: ov.el ?? a.el, ov };
  }
  const x0 = ev.clientX, y0 = ev.clientY;
  el.classList.add('is-drag');
  el.setPointerCapture(ev.pointerId);
  const move = (m) => {
    const dx = m.clientX - x0, dy = m.clientY - y0;
    if (id === 'studio-key') {
      doc.light.dir = Math.min(1, Math.max(0, base.dir + dx / 700));
      doc.light.el = Math.round(Math.min(85, Math.max(5, base.el - dy * 0.35)));
    } else {
      let az = base.az + dx * 0.5;
      az = ((az + 540) % 360) - 180;
      base.ov.az = Math.round(az);
      base.ov.el = Math.round(Math.min(88, Math.max(2, base.el - dy * 0.35)));
    }
    applyScene();
  };
  const up = () => {
    el.classList.remove('is-drag');
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    commit({ layers: false, inspector: true });
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
}

function drawSel() {
  drawLamps();
  const r = boxFor(sel);
  place(selBox, r);
  if (r) {
    const spec = selected();
    const a = ab(), k = a.w / frame.clientWidth;
    selBox.querySelector('.sel__tag').textContent = sel.type === 'device' ? spec.name : TEXT_KINDS[spec.kind].label;
    selBox.querySelector('.sel__dim').textContent = `${Math.round(r.w * k)} × ${Math.round(r.h * k)}`;
    selBox.querySelector('.sel__rot').style.display = sel.type === 'device' ? 'grid' : 'none';
  }
  place(hovBox, hoverId && hoverId !== sel?.id ? stage.rectOf(hoverId) : null);
}

function select(s) {
  sel = s;
  pickerOpen = false;
  if (s && rightTab !== 'design') rightTab = 'design';
  renderLeft();
  renderRight();
  drawSel();
}

// ---------------------------------------------------------------- pointer
function local(e) {
  const r = frame.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}
const ndc = (p) => new THREE.Vector2((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);

function hitText(p) {
  const k = ink.width / frame.clientWidth;
  for (let i = textBoxes.length - 1; i >= 0; i--) {
    const b = textBoxes[i];
    const x = p.x * k, y = p.y * k;
    if (x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6) return b;
  }
  return null;
}

frame.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.sel__rot, .lamp')) return;
  if (motion.playing) stopMotion();
  dismissHint();
  const p = local(e);
  if (tool === 'select') {
    const tb = hitText(p);
    if (tb) { e.stopPropagation(); select({ type: 'text', id: tb.id }); dragText(e, p); return; }
    const d = stage.pick(ndc(p));
    if (d) { e.stopPropagation(); if (sel?.id !== d.id) select({ type: 'device', id: d.id }); dragDevice(e, p, d); return; }
  }
  const x0 = e.clientX, y0 = e.clientY;
  const up = (ev) => {
    window.removeEventListener('pointerup', up, true);
    if (tool === 'select' && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4 && sel) select(null);
  };
  window.addEventListener('pointerup', up, true);
}, true);

function capture(e, move, done) {
  frame.setPointerCapture(e.pointerId);
  const mv = (ev) => move(ev);
  const up = () => {
    frame.removeEventListener('pointermove', mv);
    frame.removeEventListener('pointerup', up);
    frame.removeEventListener('pointercancel', up);
    done();
  };
  frame.addEventListener('pointermove', mv);
  frame.addEventListener('pointerup', up);
  frame.addEventListener('pointercancel', up);
}

function dragDevice(e, p, d) {
  const spec = devSpec(d.id);
  const start = stage.floorPoint(ndc(p));
  if (!start) return;
  const off = { x: spec.x - start.x, z: spec.z - start.z };
  let moved = false;
  capture(e, (ev) => {
    const q = stage.floorPoint(ndc(local(ev)));
    if (!q) return;
    moved = true;
    spec.x = +(q.x + off.x).toFixed(2);
    spec.z = +(q.z + off.z).toFixed(2);
    stage.syncDevices(doc.devices);
  }, () => { if (moved) commit({ devices: true, layers: false, inspector: true }); });
}

function dragText(e, p) {
  const spec = txtSpec(sel.id);
  const x0 = spec.x, y0 = spec.y;
  let moved = false;
  capture(e, (ev) => {
    const q = local(ev);
    moved = true;
    spec.x = +Math.min(0.98, Math.max(-0.1, x0 + (q.x - p.x) / q.w)).toFixed(4);
    spec.y = +Math.min(0.98, Math.max(-0.1, y0 + (q.y - p.y) / q.h)).toFixed(4);
    inkDirty = true;
  }, () => { if (moved) commit({ texts: true, layers: false, inspector: true }); });
}

selBox.querySelector('.sel__rot').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  e.preventDefault();
  const spec = selected();
  if (!spec || sel.type !== 'device') return;
  const r0 = spec.rot, x0 = e.clientX;
  capture(e, (ev) => {
    let v = r0 + (ev.clientX - x0) * 0.5;
    if (ev.shiftKey) v = Math.round(v / 15) * 15;
    spec.rot = Math.round(((v + 540) % 360) - 180);
    stage.syncDevices(doc.devices);
  }, () => commit({ devices: true, layers: false, inspector: true }));
}, true);

frame.addEventListener('pointermove', (e) => {
  if (e.buttons || tool !== 'select') { return; }
  const p = local(e);
  const overText = hitText(p);
  const d = overText ? null : stage.pick(ndc(p));
  const id = d?.id || null;
  frame.classList.toggle('over-item', !!(d || overText));
  if (id !== hoverId) { hoverId = id; drawSel(); }
});
frame.addEventListener('pointerleave', () => { hoverId = null; frame.classList.remove('over-item'); drawSel(); });

// drop media onto a screen
frame.addEventListener('dragover', (e) => { e.preventDefault(); frame.classList.add('is-drop'); });
frame.addEventListener('dragleave', (e) => { if (!frame.contains(e.relatedTarget)) frame.classList.remove('is-drop'); });
frame.addEventListener('drop', async (e) => {
  e.preventDefault();
  frame.classList.remove('is-drop');
  const file = [...(e.dataTransfer?.files || [])].find((f) => /^(image|video)\//.test(f.type));
  if (!file) return;
  const hit = stage.pick(ndc(local(e)));
  const target = hit ? devSpec(hit.id) : sel?.type === 'device' ? selected() : doc.devices[0];
  await useFile(file, target);
});

async function useFile(file, target) {
  try {
    const item = await lib.addFile(file);
    if (target) {
      target.screen = item.id;
      target.scroll = 0;
      select({ type: 'device', id: target.id });
      commit({ devices: true });
      toast(`${item.name} is on the ${MODELS[target.model].short}`);
    } else {
      toast(`${item.name} added to Screens`);
      renderLeft();
    }
  } catch {
    toast('That file could not be read');
  }
}

// ---------------------------------------------------------------- top bar
const addMenu = $('#menu-add');
for (const [id, m] of Object.entries(MODELS)) {
  addMenu.append(h('button', { type: 'button', role: 'menuitem', onclick: () => { addDevice(id); addMenu.hidden = true; } },
    h('span', {}, m.label), h('small', {}, m.kind === 'prop' ? 'prop' : m.kind)));
}
$('#btn-add').addEventListener('click', (e) => { e.stopPropagation(); addMenu.hidden = !addMenu.hidden; });
document.addEventListener('click', (e) => { if (!e.target.closest('.menuwrap')) addMenu.hidden = true; });

function addDevice(model) {
  const box = new THREE.Box3();
  for (const d of stage.devices.values()) if (d.root.visible) box.expandByObject(d.root);
  let spec;
  if (MODELS[model].kind === 'prop') {
    // props go in front of or beside the set, where they read as dressing
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const side = doc.devices.filter(isProp).length % 2 ? -1 : 1;
    const x = box.isEmpty() ? 0 : c.x + side * (box.max.x - c.x + (model === 'plant' ? 10 : 6));
    spec = defaultSpec(model, { x: +x.toFixed(1), z: box.isEmpty() ? 0 : +(box.max.z - 4).toFixed(1), rot: Math.round(Math.random() * 60 - 30), tilt: 0, screen: null, fill: 'top' });
  } else {
    const x = box.isEmpty() ? 0 : box.max.x + (model === 'macbook' ? 18 : model === 'display' ? 34 : 8);
    spec = defaultSpec(model, { x: +x.toFixed(1), z: 2, rot: -10 });
  }
  doc.devices.push(spec);
  select({ type: 'device', id: spec.id });
  commit({ devices: true });
  frameCamera();
}

function addText(kind = 'headline') {
  const t = newText(kind, { y: 0.08 + doc.texts.length * 0.12 });
  doc.texts.push(t);
  select({ type: 'text', id: t.id });
  commit({ texts: true });
}

$('#btn-text').addEventListener('click', () => addText(doc.texts.some((t) => t.kind === 'headline') ? 'body' : 'headline'));
$('#btn-light').addEventListener('click', () => select({ type: 'light' }));
$('#btn-snap').addEventListener('click', () => exportImage());
$('#btn-export').addEventListener('click', () => { rightTab = 'export'; renderRight(); });
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
$('#doc-name').addEventListener('change', (e) => { doc.name = e.target.value.trim() || 'Untitled'; commit({}); });

document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
function setTool(t) {
  tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('is-on', b.dataset.tool === t));
  frame.classList.toggle('tool-hand', t === 'hand');
}

function syncModeSeg() {
  document.querySelectorAll('#mode-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === doc.cam.mode)));
}
document.querySelectorAll('#mode-seg button').forEach((b) => b.addEventListener('click', () => {
  doc.cam.mode = b.dataset.v;
  if (doc.cam.mode === '2d' && doc.cam.preset === 'custom') doc.cam.preset = 'front';
  syncModeSeg();
  applyScene();
  frameCamera();
  renderCamDock();
  commit({ inspector: true });
}));

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('kd-theme', t); } catch { /* ignore */ }
}
$('#btn-theme').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
try { applyTheme(localStorage.getItem('kd-theme') || 'dark'); } catch { applyTheme('dark'); }

function updateUndo() {
  $('#btn-undo').disabled = history.i <= 0;
  $('#btn-redo').disabled = history.i >= history.stack.length - 1;
}
function restore(d) {
  if (!d) return;
  doc = d;
  if (sel && !selected() && (sel.type === 'device' || sel.type === 'text')) sel = null;
  stage.syncDevices(doc.devices);
  applyScene();
  stage.setCam(doc.cam);
  $('#doc-name').value = doc.name;
  syncModeSeg();
  layout();
  renderLeft(); renderRight(); renderCamDock();
  save(doc);
  updateUndo();
}
function undo() { clearTimeout(saveT); restore(history.undo()); }
function redo() { clearTimeout(saveT); restore(history.redo()); }

// ---------------------------------------------------------------- camera dock
function renderCamDock() {
  const el = $('#cam-presets');
  el.replaceChildren();
  for (const [id, c] of Object.entries(CAMERAS)) {
    if (doc.cam.mode === '2d' && id !== 'front') continue;
    el.append(h('button', {
      type: 'button', class: 'dock__btn' + (doc.cam.preset === id ? ' is-on' : ''), title: `${c.label} camera`,
      onclick: () => { doc.cam.preset = id; doc.cam.orbit = false; applyScene(); frameCamera(); renderCamDock(); renderLeft(); },
    }, c.label));
  }
  if (doc.cam.mode !== '2d') {
    el.append(h('button', {
      type: 'button', class: 'dock__btn' + (doc.cam.orbit ? ' is-on' : ''), title: 'Auto-orbit (O)',
      onclick: () => { doc.cam.orbit = !doc.cam.orbit; applyScene(); renderCamDock(); commit({ layers: false }); },
    }, svg('<path d="M8 5v14l11-7z"/>'), 'Orbit'));
  }
}
$('#btn-fit').addEventListener('click', () => { if (doc.cam.preset === 'custom') doc.cam.preset = 'hero'; frameCamera(); renderCamDock(); });
$('#btn-zin').addEventListener('click', () => stage.zoomBy(0.85));
$('#btn-zout').addEventListener('click', () => stage.zoomBy(1 / 0.85));
function updateZoom() { $('#zoom').textContent = stage.zoomPct() + '%'; }

// ---------------------------------------------------------------- left panel
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { leftTab = b.dataset.tab; renderLeft(); }));

function layerRow({ icon, name, meta, selectedRow, hidden, child, onSelect, onEye }) {
  return h('li', { class: `layer${selectedRow ? ' is-sel' : ''}${hidden ? ' is-hidden' : ''}${child ? ' layer--child' : ''}`, onclick: onSelect },
    child ? h('span') : svg(ICON[icon] || ICON.screen, 'layer__ico'),
    child ? svg(ICON.screen, 'layer__ico') : h('span'),
    h('span', { class: 'layer__name' }, name),
    onEye ? h('button', {
      type: 'button', class: 'layer__eye', 'aria-label': hidden ? 'Show' : 'Hide',
      onclick: (e) => { e.stopPropagation(); onEye(); },
    }, svg(hidden ? ICON.eyeOff : ICON.eye)) : h('span', { class: 'layer__meta' }, meta || ''));
}

function renderLeft() {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === leftTab)));
  leftBody.replaceChildren(leftTab === 'layers' ? layersPanel() : assetsPanel());
}

function layersPanel() {
  const ul = h('ul', { class: 'layers' });
  const camLabel = doc.cam.mode === '2d' ? '2D · Front' : CAMERAS[doc.cam.preset]?.label || 'Custom';
  ul.append(layerRow({ icon: 'camera', name: `Camera · ${camLabel}`, selectedRow: sel?.type === 'camera', onSelect: () => select({ type: 'camera' }) }));
  ul.append(layerRow({ icon: 'light', name: envOf().id === 'studio' ? `Key light · ${LIGHTS[doc.light.preset].label}` : `Lights · ${ENVIRONMENTS[envOf().id].lights.length}`, selectedRow: sel?.type === 'light', onSelect: () => select({ type: 'light' }) }));
  for (const t of [...doc.texts].reverse()) {
    ul.append(layerRow({
      icon: 'text', name: t.text.split('\n')[0] || TEXT_KINDS[t.kind].label, hidden: t.visible === false,
      selectedRow: sel?.id === t.id, onSelect: () => select({ type: 'text', id: t.id }),
      onEye: () => { t.visible = t.visible === false; commit({ texts: true }); },
    }));
  }
  for (const d of doc.devices) {
    const m = MODELS[d.model];
    ul.append(layerRow({
      icon: KIND_ICON[m.kind], name: d.name, hidden: d.visible === false,
      selectedRow: sel?.id === d.id, onSelect: () => select({ type: 'device', id: d.id }),
      onEye: () => { d.visible = d.visible === false; commit({ devices: true }); },
    }));
    if (isProp(d)) continue;
    const src = lib.get(d.screen);
    ul.append(layerRow({ child: true, name: src?.name || 'Screen', meta: src?.kind === 'video' ? 'video' : '', onSelect: () => select({ type: 'device', id: d.id }) }));
  }
  ul.append(layerRow({ icon: 'bg', name: envOf().id === 'studio' ? `Background · ${BACKGROUNDS[doc.bg.preset]?.label || 'Custom'}` : `Environment · ${ENVIRONMENTS[envOf().id].label}`, meta: 'GL', selectedRow: sel?.type === 'bg', onSelect: () => select({ type: 'bg' }) }));
  return h('div', {}, h('div', { class: 'layers__head' }, h('span', {}, doc.name), h('span', {}, `${doc.devices.length} device${doc.devices.length === 1 ? '' : 's'}`)), ul);
}

function sceneArt(scene) {
  const s = SCENES[scene].make();
  const xs = s.devices.map((d) => d.x);
  const min = Math.min(...xs), max = Math.max(...xs);
  const span = Math.max(1, max - min);
  const parts = s.devices.map((d) => {
    const k = MODELS[d.model].kind;
    const cx = s.devices.length === 1 ? 50 : 22 + ((d.x - min) / span) * 56;
    if (k === 'prop') return `<circle cx="${cx}" cy="44" r="5"/>`;
    const flat = d.support === 'flat';
    if (flat) return `<rect x="${cx - 7}" y="22" width="14" height="30" rx="3"/>`;
    if (k === 'laptop') return `<rect x="${cx - 20}" y="16" width="40" height="26" rx="2"/><path d="M${cx - 25} 46h50l-4 4H${cx - 21}z"/>`;
    if (k === 'display') return `<rect x="${cx - 24}" y="10" width="48" height="28" rx="2"/><path d="M${cx - 5} 38l-2 12h14l-2-12"/>`;
    if (k === 'tablet') return d.pose === 'landscape'
      ? `<rect x="${cx - 15}" y="26" width="30" height="21" rx="2.5"/><rect x="${cx - 10}" y="47" width="20" height="4" rx="2"/>`
      : `<rect x="${cx - 10}" y="18" width="20" height="29" rx="2.5"/><rect x="${cx - 8}" y="47" width="16" height="4" rx="2"/>`;
    if (k === 'fold') return `<path d="M${cx - 15} 22l15-3 15 3v26l-15 3-15-3z"/><path d="M${cx} 19v32"/>`;
    return `<rect x="${cx - 6}" y="24" width="12" height="24" rx="3"/>${d.support === 'dock' ? `<rect x="${cx - 7}" y="48" width="14" height="3.5" rx="1.75"/>` : ''}`;
  }).join('');
  const EV = s.env && ENVIRONMENTS[s.env.id];
  const bg = EV ? { top: EV.swatch[0], horizon: EV.swatch[0], glow: EV.swatch[1] } : BACKGROUNDS[s.bg.preset];
  const el = h('span', { class: 'card__art', style: { background: `radial-gradient(circle at 50% 40%, ${bg.glow}55, transparent 60%), linear-gradient(${bg.top}, ${bg.horizon})` } });
  el.append(svg(`<g fill="none" stroke="${new THREE.Color(bg.horizon).getHSL({}).l > 0.5 ? '#0e0f12' : '#f4f4f6'}" stroke-width="1.6" stroke-linejoin="round" transform="scale(0.24)">${parts}</g>`));
  el.firstChild.setAttribute('viewBox', '0 0 24 15');
  return el;
}

function abArt(a) {
  const k = 34 / Math.max(a.w, a.h);
  const w = a.w * k, hh = a.h * k;
  const el = h('span', { class: 'card__art' });
  el.append(svg(`<rect x="${(40 - w) / 2}" y="${(40 - hh) / 2}" width="${w}" height="${hh}" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>`));
  el.firstChild.setAttribute('viewBox', '0 0 40 40');
  return el;
}

function assetsPanel() {
  const scenes = h('div', { class: 'cards' });
  for (const [id, s] of Object.entries(SCENES)) {
    scenes.append(h('button', {
      type: 'button', class: 'card', title: `Start from ${s.label}`,
      onclick: () => loadScene(id),
    }, sceneArt(id), h('div', { class: 'card__name' }, s.label), h('div', { class: 'card__meta' }, s.note)));
  }
  const layouts = h('div', { class: 'cards' });
  for (const [id, a] of Object.entries(ARTBOARDS)) {
    layouts.append(h('button', {
      type: 'button', class: 'card' + (doc.artboard === id ? ' is-on' : ''),
      onclick: () => setArtboard(id),
    }, abArt(a), h('div', { class: 'card__name' }, a.label), h('div', { class: 'card__meta' }, `${a.w} × ${a.h}`)));
  }
  const devs = h('div', { class: 'adddev' },
    Object.entries(MODELS).filter(([, m]) => m.kind !== 'prop').map(([id, m]) => h('button', { type: 'button', onclick: () => addDevice(id) }, m.label, h('small', {}, '+ Add'))));
  const props = h('div', { class: 'adddev' },
    Object.entries(MODELS).filter(([, m]) => m.kind === 'prop').map(([id, m]) => h('button', { type: 'button', onclick: () => addDevice(id) }, m.label, h('small', {}, '+ Add'))));
  return h('div', {},
    section('Environments', `${Object.keys(ENVIRONMENTS).length}`, envCards()),
    section('Scene presets', `${Object.keys(SCENES).length}`, scenes),
    section('Layout presets', '2D', layouts),
    section('Devices', '3D', devs),
    section('Props', 'Set dressing', props),
    captureSection(),
    section('Screens', null, screenPicker(null)),
    figmaSection(),
  );
}

function loadScene(id) {
  const fresh = makeDoc(id, doc.artboard);
  doc = fresh;
  sel = null;
  stage.syncDevices(doc.devices);
  applyScene();
  frameCamera(900);
  $('#doc-name').value = doc.name;
  syncModeSeg();
  renderCamDock();
  commit({ inspector: true });
  toast(`${SCENES[id].label} loaded — ⌘Z to go back`);
}

function setArtboard(id) {
  doc.artboard = id;
  layout();
  if (doc.cam.preset !== 'custom') frameCamera(500);
  commit({ inspector: true });
}

// screen grid; target = device spec (or null for library view)
function screenPicker(target) {
  const grid = h('div', { class: 'picker' });
  const form = target ? (MODELS[target.model].kind === 'phone' || (MODELS[target.model].kind === 'tablet' && target.pose !== 'landscape') || MODELS[target.model].kind === 'fold' ? 'mobile' : 'desktop') : null;
  const items = lib.list().sort((a, b) => (b.form === form) - (a.form === form));
  for (const it of items) {
    const media = it.kind === 'video'
      ? h('video', { src: it.thumb, muted: true, autoplay: true, loop: true, playsinline: true })
      : h('img', { src: it.thumb, alt: '', loading: 'lazy' });
    grid.append(h('button', {
      type: 'button', class: target?.screen === it.id ? 'is-on' : '', title: it.name,
      onclick: () => {
        const t = target || (sel?.type === 'device' ? selected() : null);
        if (!t) { toast('Select a device first, or drop the file onto one'); return; }
        t.screen = it.id;
        t.scroll = 0;
        pickerOpen = false;
        commit({ devices: true, inspector: true });
      },
    }, media, h('span', {}, it.name)));
  }
  grid.append(h('button', {
    type: 'button', title: 'Upload an image or video', style: { background: 'var(--kd-surface-2)', display: 'grid', placeItems: 'center', color: 'var(--kd-muted)', fontSize: '22px' },
    onclick: () => pickFile(target || (sel?.type === 'device' ? selected() : null)),
  }, '+'));
  return grid;
}

let fileTarget = null;
function pickFile(target) { fileTarget = target; $('#file-in').value = ''; $('#file-in').click(); }
$('#file-in').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) useFile(f, fileTarget); });

// ---------------------------------------------------------------- companion: website capture + Figma
let companion = null;
const capState = { url: '', mode: 'all', full: true, busy: false };

function captureSection() {
  if (!companion?.capture) {
    return section('Capture a website', 'Offline', h('p', { class: 'empty' },
      'Website capture needs the local companion. Clone github.com/kieranduffy87/kd-vantage and run python3 _dev-server.py, then open localhost:8590. Uploads and drag-and-drop work here as normal.'));
  }
  return section('Capture a website', capState.busy ? 'Capturing…' : 'Live',
    h('input', {
      id: 'cap-url', class: 'field', placeholder: 'yourwebsite.com', value: capState.url, spellcheck: 'false',
      oninput: (e) => { capState.url = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') runCapture(); },
    }),
    h('div', { style: { height: '8px' } }),
    seg([['all', 'Every device'], ['desktop', 'Desktop'], ['mobile', 'Mobile']], capState.mode, (v) => { capState.mode = v; }),
    h('div', { style: { marginTop: '10px' } }, toggle('Whole page (scroll it later)', capState.full, (v) => { capState.full = v; })),
    h('button', { type: 'button', class: 'btn btn--primary btn--block', style: { marginTop: '10px' }, disabled: capState.busy, onclick: runCapture },
      capState.busy ? 'Capturing…' : 'Capture'),
    h('p', { class: 'empty', style: { marginTop: '8px' } }, '“Every device” shoots desktop, tablet and mobile layouts and puts each on the right screen.'));
}

const formFor = (d) => {
  const k = MODELS[d.model].kind;
  if (k === 'laptop' || k === 'display') return 'desktop';
  if (k === 'tablet') return d.pose === 'landscape' ? 'desktop' : 'tablet';
  return 'mobile';
};

async function runCapture() {
  const raw = capState.url.trim();
  if (!raw) { toast('Type a web address first'); return; }
  let host;
  try { host = new URL(/^https?:\/\//.test(raw) ? raw : 'https://' + raw).host.replace(/^www\./, ''); } catch { toast('That does not look like a web address'); return; }
  const only = capState.mode !== 'all' && sel?.type === 'device' ? selected() : null;
  let kinds;
  if (capState.mode === 'all') {
    kinds = [...new Set(doc.devices.map(formFor))];
    if (!kinds.length) kinds = ['desktop', 'mobile'];
  } else kinds = [capState.mode];
  capState.busy = true;
  renderLeft();
  const got = {};
  const LABEL = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
  for (const k of kinds) {
    toast(`Capturing ${host} — ${LABEL[k].toLowerCase()} layout…`);
    try {
      const r = await fetch(`/api/capture?url=${encodeURIComponent(raw)}&device=${k}&full=${capState.full ? 1 : 0}`);
      if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.error || 'Capture failed'); continue; }
      const blob = await r.blob();
      got[k] = await lib.upsert(`cap-${host}-${k}`, `${host} / ${LABEL[k]}`, blob,
        { form: k === 'desktop' ? 'desktop' : 'mobile', url: host, source: 'capture' });
    } catch { toast('The companion server stopped responding'); }
  }
  let n = 0;
  for (const d of only ? [only] : doc.devices) {
    if (MODELS[d.model].kind === 'prop') continue;
    const want = formFor(d);
    const item = got[want] || (want === 'tablet' ? got.mobile || got.desktop : null) || (only ? Object.values(got)[0] : null);
    if (!item) continue;
    d.screen = item.id; d.scroll = 0; d.fill = 'top'; d.url = host;
    n++;
  }
  capState.busy = false;
  commit({ devices: true, inspector: true });
  renderLeft();
  if (Object.keys(got).length) toast(n ? `${host} is on ${n} device${n === 1 ? '' : 's'}` : `${host} added to Screens`);
}

function figmaSection() {
  if (!companion?.figma) return null;
  const frames = lib.list().filter((i) => i.source === 'figma');
  return section('Figma', frames.length ? `${frames.length} linked` : 'Waiting',
    h('p', { class: 'empty' }, frames.length
      ? 'Frames sent from the KD Vantage Link plugin. With Live on in the plugin, edits in Figma update these screens within a second or two.'
      : 'In Figma: Plugins → Development → Import plugin from manifest… and pick figma-plugin/manifest.json in the Vantage folder. Select a device here, then send frames from the plugin.'));
}

const figmaSeen = new Map();
let figmaToastT = 0;
async function pollFigma() {
  try {
    const rows = await (await fetch('/api/inbox')).json();
    for (const row of rows) {
      const id = 'fig-' + row.id.replace(/[^a-z0-9-]/gi, '_');
      const have = figmaSeen.get(id) ?? lib.items.get(id)?.ver ?? 0;
      if (row.ver <= have) continue;
      figmaSeen.set(id, row.ver);
      const blob = await (await fetch(`/api/frame?id=${encodeURIComponent(row.id)}&v=${row.ver}`)).blob();
      const isNew = !lib.items.has(id);
      await lib.upsert(id, row.name, blob, { source: 'figma', ver: row.ver });
      if (isNew) {
        const t = sel?.type === 'device' && MODELS[selected()?.model]?.kind !== 'prop' ? selected() : null;
        if (t) {
          t.screen = id; t.scroll = 0;
          commit({ devices: true, inspector: true });
          toast(`“${row.name}” from Figma is on the ${MODELS[t.model].short}`);
        } else toast(`“${row.name}” arrived from Figma — it is under Assets → Screens`);
        renderLeft();
      } else if (performance.now() - figmaToastT > 4000) {
        figmaToastT = performance.now();
        toast(`Live from Figma: ${row.name}`);
      }
    }
  } catch { /* companion gone; keep trying quietly */ }
  setTimeout(pollFigma, 1200);
}

// ---------------------------------------------------------------- right panel
document.querySelectorAll('[data-rtab]').forEach((b) => b.addEventListener('click', () => { rightTab = b.dataset.rtab; renderRight(); }));

function renderRight() {
  document.querySelectorAll('[data-rtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.rtab === rightTab)));
  const top = rightBody.scrollTop;
  let content;
  if (rightTab === 'motion') content = motionPanel();
  else if (rightTab === 'export') content = exportPanel();
  else if (sel?.type === 'device' && selected()) content = deviceInspector(selected());
  else if (sel?.type === 'text' && selected()) content = textInspector(selected());
  else if (sel?.type === 'camera') content = h('div', {}, cameraSection());
  else if (sel?.type === 'light') content = h('div', {}, envOf().id === 'studio' ? lightingSection() : envSection({ compact: true }));
  else if (sel?.type === 'bg') content = h('div', {}, envSection(), envOf().id === 'studio' ? backgroundSection() : null);
  else content = sceneInspector();
  rightBody.replaceChildren(content);
  rightBody.scrollTop = top;
}

const upd = (fn, opts) => (v) => { fn(v); commit({ layers: false, ...opts }); };

function deviceInspector(d) {
  const m = MODELS[d.model];
  const structural = (fn) => (v) => { fn(v); commit({ devices: true, inspector: true }); };
  const live = (fn) => (v) => { fn(v); stage.syncDevices(doc.devices); };
  const done = () => commit({ devices: true, layers: false });

  const head = h('section', { class: 'sec' },
    h('div', { class: 'sec__head' },
      h('h3', { class: 'sec__headline' }, svg(ICON[KIND_ICON[m.kind]]), d.name),
      h('span', { class: 'sec__aside' }, m.px ? `${screenPixels(d).join(' × ')}` : 'Prop')),
    row('Name', h('input', { class: 'field', value: d.name, onchange: (e) => { d.name = e.target.value || m.label; commit({ inspector: true }); } })),
    row(m.kind === 'prop' ? 'Prop' : 'Model', dropdown(Object.entries(MODELS).filter(([, v]) => (v.kind === 'prop') === (m.kind === 'prop')).map(([k, v]) => [k, v.label]), d.model, structural((v) => {
      const nm = MODELS[v];
      const wasDefaultName = d.name === m.label;
      d.model = v;
      if (wasDefaultName) d.name = nm.label;
      if (!nm.finishes.some((f) => f.id === d.finish)) d.finish = nm.finishes[0].id;
      if (!nm.supports.includes(d.support)) d.support = nm.supports[0];
      if (!nm.poses) d.pose = 'portrait';
      if (!nm.cases) d.case = 'none';
      const wantMobile = nm.kind === 'phone' || nm.kind === 'fold' || (nm.kind === 'tablet' && d.pose !== 'landscape');
      const src = lib.get(d.screen);
      if (src && src.form !== 'any' && (src.form === 'mobile') !== wantMobile) {
        const sib = lib.list().find((s) => s.id === d.screen.replace(/-(desktop|mobile)$/, wantMobile ? '-mobile' : '-desktop'));
        if (sib) d.screen = sib.id;
      }
    }))),
  );

  const finish = section('Finish', null, swatches(m.finishes, d.finish, structural((v) => { d.finish = v; })));

  const shape = [];
  if (m.cases) {
    shape.push(row('Case', seg([['none', 'None'], ['silicone', 'Silicone'], ['clear', 'Clear']], d.case, structural((v) => { d.case = v; }))));
    if (d.case === 'silicone') shape.push(row('', swatches(CASE_COLOURS, d.caseColor, structural((v) => { d.caseColor = v; }))));
  }
  if (m.poses) shape.push(row('Pose', seg([['portrait', 'Portrait'], ['landscape', 'Landscape']], d.pose, structural((v) => { d.pose = v; }))));
  if (m.folds) shape.push(row('Fold', slider(70, 180, 1, d.fold, live((v) => { d.fold = v; }), (v) => v + '°', done)));
  if (m.kind === 'laptop') shape.push(row('Lid', slider(15, 135, 1, d.lid, live((v) => { d.lid = v; }), (v) => v + '°', done)));
  const shapeSec = shape.length ? section(m.cases ? 'Case & pose' : m.folds ? 'Hinge' : m.poses ? 'Pose' : 'Lid', null, ...shape) : null;

  const canTilt = ((m.kind === 'phone' || m.kind === 'tablet' || m.kind === 'fold') && d.support !== 'flat') || d.support === 'float';
  const transform = section('Transform', null,
    h('div', { class: 'nums', style: { '--n': 3 } },
      num('R', d.rot, live((v) => { d.rot = v; }), { unit: '°', onDone: done }),
      num('X', d.x, live((v) => { d.x = v; }), { step: 0.5, onDone: done }),
      num('Z', d.z, live((v) => { d.z = v; }), { step: 0.5, onDone: done })),
    canTilt ? row('Tilt', slider(d.support === 'float' ? -60 : -10, d.support === 'float' ? 60 : 30, 1, d.tilt, (v) => { d.tilt = v; stage.syncDevices(doc.devices); }, (v) => v + '°', () => commit({ devices: true, layers: false }))) : null,
    d.support === 'float' ? row('Roll', slider(-45, 45, 1, d.roll || 0, (v) => { d.roll = v; stage.syncDevices(doc.devices); }, (v) => v + '°', () => commit({ devices: true, layers: false }))) : null,
    row('Scale', slider(0.5, 2, 0.05, d.scale, live((v) => { d.scale = v; }), (v) => v.toFixed(2) + '×', done)),
  );

  const support = m.kind === 'prop' ? null : section('Support', null,
    m.supports.length > 1
      ? dropdown(m.supports.map((s) => [s, SUPPORT_LABEL[s]]), d.support, structural((v) => {
        d.support = v;
        if (v === 'dock' && !d.tilt) d.tilt = 9;
        if (v === 'float' && MODELS[d.model].kind === 'laptop') { d.tilt = 0; d.roll = 0; }
      }))
      : h('div', { class: 'empty' }, SUPPORT_LABEL[m.supports[0]]),
    null);

  const src = lib.get(d.screen);
  const screenSec = section('Screen', src?.kind === 'video' ? 'Video' : null,
    h('div', { class: 'screencard' },
      src?.kind === 'video'
        ? h('video', { class: 'screencard__thumb', src: src.thumb, muted: true, autoplay: true, loop: true, playsinline: true })
        : h('img', { class: 'screencard__thumb', src: src?.thumb || '', alt: '' }),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'screencard__name' }, src?.name || 'None'),
        h('div', { class: 'screencard__meta' }, src ? `${src.w} × ${src.h}${src.user ? ' · uploaded' : ''}` : ''))),
    h('div', { class: 'btnrow' },
      h('button', { type: 'button', class: 'btn', onclick: () => { pickerOpen = !pickerOpen; renderRight(); } }, pickerOpen ? 'Close' : 'Swap'),
      h('button', { type: 'button', class: 'btn', onclick: () => pickFile(d) }, 'Upload')),
    h('button', { type: 'button', class: 'btn btn--block', style: { marginTop: '6px', height: '28px' }, onclick: () => {
      leftTab = 'assets'; renderLeft();
      const inp = document.getElementById('cap-url');
      inp?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => inp?.focus(), 250);
    } }, 'Capture a website…'),
    pickerOpen ? screenPicker(d) : null,
    row('Fill', seg([['top', 'Top'], ['fit', 'Fit'], ['fill', 'Fill']], d.fill, structural((v) => { d.fill = v; }))),
    d.fill === 'top' ? row('Scroll', slider(0, 1, 0.01, d.scroll || 0, live((v) => { d.scroll = v; }), (v) => Math.round(v * 100) + '%', done)) : null,
    h('div', { style: { marginTop: '10px' } }, toggle(m.kind === 'laptop' || m.kind === 'display' ? 'Menu bar & browser' : 'Status bar', d.ui !== false, (v) => { d.ui = v; commit({ devices: true, inspector: true }); })),
    d.ui !== false && (m.kind === 'laptop' || m.kind === 'display') && src?.form !== 'mobile'
      ? row('URL', h('input', { class: 'field', value: d.url || src?.url || '', placeholder: 'example.com', onchange: (e) => { d.url = e.target.value.trim(); commit({ devices: true, layers: false }); } }))
      : null,
    row('Glow', slider(0.4, 1.6, 0.05, d.brightness ?? 1, live((v) => { d.brightness = v; }), (v) => Math.round(v * 100) + '%', done)),
    src?.user ? h('button', { type: 'button', class: 'btn btn--danger btn--block', style: { marginTop: '10px', height: '28px' }, onclick: async () => {
      const id = src.id;
      for (const dv of doc.devices) if (dv.screen === id) dv.screen = MODELS[dv.model].kind === 'phone' ? 'kd-mobile' : 'kd-desktop';
      await lib.remove(id);
      commit({ devices: true, inspector: true });
    } }, 'Remove upload from library') : null,
  );

  const actions = section('Layer', null, h('div', { class: 'btnrow', style: { marginTop: 0 } },
    h('button', { type: 'button', class: 'btn', onclick: duplicate }, 'Duplicate'),
    h('button', { type: 'button', class: 'btn btn--danger', onclick: remove }, 'Delete')));

  const lit = envOf().id === 'studio' ? lightingSection() : envSection({ compact: true });
  if (m.kind === 'prop') return h('div', {}, head, finish, transform, lit, actions);
  return h('div', {}, head, finish, shapeSec, transform, support, screenSec, lit, actions);
}

function textInspector(t) {
  const redraw = (fn) => (v) => { fn(v); inkDirty = true; };
  const done = () => commit({ texts: true, layers: false });
  return h('div', {},
    h('section', { class: 'sec' },
      h('div', { class: 'sec__head' }, h('h3', { class: 'sec__headline' }, svg(ICON.text), TEXT_KINDS[t.kind].label)),
      h('textarea', { class: 'field', rows: 3, oninput: (e) => { t.text = e.target.value; inkDirty = true; }, onchange: () => commit({ texts: true }) }, t.text),
      row('Style', seg(Object.entries(TEXT_KINDS).map(([k, v]) => [k, v.label]), t.kind, (v) => {
        t.kind = v; t.size = TEXT_KINDS[v].size; commit({ texts: true, inspector: true });
      })),
    ),
    section('Type', null,
      row('Size', num('', t.size, redraw((v) => { t.size = v; }), { min: 6, max: 400, unit: 'px', onDone: done })),
      t.kind !== 'chip' ? row('Width', slider(0.15, 0.95, 0.01, t.width, redraw((v) => { t.width = v; }), (v) => Math.round(v * 100) + '%', done)) : null,
      row('Colour', h('div', { class: 'txtcols' },
        h('button', { type: 'button', class: 'txtauto' + (t.color === 'auto' ? ' is-on' : ''), title: 'Auto: light on dark backgrounds, ink on light', onclick: () => { t.color = 'auto'; commit({ texts: true, inspector: true }); } }, 'Auto'),
        ...TEXT_SWATCHES.map((c) => h('button', {
          type: 'button', class: 'swatch' + (t.color === c.id ? ' is-on' : ''), title: c.label, 'aria-label': c.label,
          'aria-checked': String(t.color === c.id), style: { background: c.hex, width: '20px', height: '20px' },
          onclick: () => { t.color = c.id; commit({ texts: true, inspector: true }); },
        })),
        colourInput(/^#/.test(t.color) ? t.color : '#ffffff', (v) => { t.color = v; inkDirty = true; }, () => commit({ texts: true, inspector: true })))),
      row('Align', seg([['left', 'Left'], ['center', 'Centre']], t.align, (v) => { t.align = v; commit({ texts: true }); })),
    ),
    section('Position', '% of artboard',
      h('div', { class: 'nums' },
        num('X', +(t.x * 100).toFixed(1), redraw((v) => { t.x = v / 100; }), { step: 0.5, onDone: done }),
        num('Y', +(t.y * 100).toFixed(1), redraw((v) => { t.y = v / 100; }), { step: 0.5, onDone: done })),
      h('div', { class: 'btnrow' },
        h('button', { type: 'button', class: 'btn', onclick: () => { t.align = 'center'; t.x = 0.5; commit({ texts: true, inspector: true }); } }, 'Centre H'),
        h('button', { type: 'button', class: 'btn', onclick: () => { t.align = 'left'; t.x = 0.055; commit({ texts: true, inspector: true }); } }, 'Left margin')),
    ),
    section('Layer', null, h('div', { class: 'btnrow', style: { marginTop: 0 } },
      h('button', { type: 'button', class: 'btn', onclick: duplicate }, 'Duplicate'),
      h('button', { type: 'button', class: 'btn btn--danger', onclick: remove }, 'Delete'))),
  );
}

function lightingSection() {
  const L = doc.light;
  return section('Lighting', null,
    seg(Object.entries(LIGHTS).map(([k, v]) => [k, v.label]), L.preset, (v) => { L.preset = v; delete L.el; applyScene(); commit({ inspector: true }); }),
    row('Direction', slider(0, 1, 0.01, L.dir, (v) => { L.dir = v; stage.setLighting(L.preset, L.dir, L.shadows); }, (v) => Math.round(110 + v * 260) % 360 + '°', () => commit({ layers: false }))),
    row('Height', slider(5, 85, 1, L.el ?? LIGHTS[L.preset].el, (v) => { L.el = v; applyScene(); }, (v) => v + '°', () => commit({ layers: false }))),
    row('Shadows', slider(0, 1, 0.01, L.shadows, (v) => { L.shadows = v; stage.setLighting(L.preset, L.dir, L.shadows); }, (v) => Math.round(v * 100) + '%', () => commit({ layers: false }))),
    h('p', { class: 'empty', style: { marginTop: '8px' } }, 'Drag the sun handle in the view to move the key light.'),
  );
}

const GOBOS = [['none', 'No window'], ['blinds', 'Venetian blinds'], ['window', 'Window panes'], ['leaves', 'Leaves (dappled)']];

function setEnv(id) {
  const E = ENVIRONMENTS[id];
  doc.env = { id, lights: {} };
  if (E?.cam) { doc.cam.preset = E.cam.preset; doc.cam.shift = { ...E.cam.shift }; }
  doc.render = { ...renderOf(), floor: id === 'studio' ? renderOf().floor : 'matte', ...(E?.post || { haze: 0, bloom: 0, vignette: 0, grain: 0, dof: 0 }) };
  applyScene();
  frameCamera(700);
  renderCamDock();
  commit({ inspector: true });
}

function envCards() {
  const e = envOf();
  const grid = h('div', { class: 'envgrid' });
  for (const [id, X] of Object.entries(ENVIRONMENTS)) {
    grid.append(h('button', { type: 'button', class: 'envcard' + (e.id === id ? ' is-on' : ''), title: X.note, onclick: () => setEnv(id) },
      h('span', { class: 'envcard__art', style: { background: `radial-gradient(circle at 72% 28%, ${X.swatch[1]} 0, transparent 62%), ${X.swatch[0]}` } }),
      h('span', { class: 'envcard__name' }, X.label)));
  }
  return grid;
}

const colourInput = (value, onInput, onDone) => h('input', {
  type: 'color', value, class: 'colourbox',
  oninput: (ev) => onInput(ev.target.value), onchange: () => onDone?.(),
});

// Lights (and shadows / window) of the current environment.
function envLights() {
  const e = envOf(), E = ENVIRONMENTS[e.id];
  const rows = E.lights.map((L) => {
    const ov = (e.lights[L.id] ||= {});
    const max = Math.max(1, L.intensity * 2.5);
    return h('div', { class: 'lightrow' + (ov.on === false ? ' is-off' : '') },
      h('label', { class: 'lightrow__head' },
        h('input', { type: 'checkbox', checked: ov.on !== false, onchange: (ev) => { ov.on = ev.target.checked; applyScene(); commit({ inspector: true }); } }),
        h('span', {}, L.label),
        colourInput(ov.color || L.color, (v) => { ov.color = v; applyScene(); }, () => commit({ layers: false }))),
      slider(0, max, max / 100, ov.intensity ?? L.intensity, (v) => { ov.intensity = v; applyScene(); }, (v) => (v / L.intensity * 100).toFixed(0) + '%', () => commit({ layers: false })),
      ov.on === false ? null : h('div', { class: 'lightrow__more' },
        row('Angle', slider(-180, 180, 1, ov.az ?? lightAngles(L).az, (v) => { ov.az = v; applyScene(); }, (v) => v + '°', () => commit({ layers: false }))),
        row('Height', slider(2, 88, 1, ov.el ?? lightAngles(L).el, (v) => { ov.el = v; applyScene(); }, (v) => v + '°', () => commit({ layers: false }))),
        L.kind !== 'point' ? row('Softness', slider(0, 1, 0.01, ov.soft ?? (L.kind === 'spot' ? L.penumbra : 0.375), (v) => { ov.soft = v; applyScene(); }, (v) => Math.round(v * 100) + '%', () => commit({ layers: false }))) : null,
        L.kind === 'spot' ? h('div', { style: { marginTop: '6px' } }, toggle('Casts shadows', ov.shadow ?? !!L.shadow, (v) => { ov.shadow = v; applyScene(); commit({ layers: false }); })) : null));
  });
  return [
    h('div', { class: 'subhead' }, 'Lights'),
    ...rows,
    row('Window', dropdown(GOBOS, e.gobo ?? (E.gobo || 'none'), (v) => { e.gobo = v; applyScene(); commit({ layers: false }); })),
    row('Shadows', slider(0, 1, 0.01, doc.light.shadows, (v) => { doc.light.shadows = v; stage.setLighting(doc.light.preset, doc.light.dir, v); }, (v) => Math.round(v * 100) + '%', () => commit({ layers: false }))),
  ];
}

function envSection({ compact = false } = {}) {
  const e = envOf(), E = ENVIRONMENTS[e.id];
  if (e.id === 'studio') return section('Environment', 'Studio', envCards());
  const mats = Object.entries(MATERIALS).map(([k, v]) => [k, v.label]);
  const kids = compact ? [] : [envCards()];
  if (!compact && (E.floor || e.floor)) {
    const f = e.floor || E.floor;
    kids.push(row('Surface', h('div', { class: 'matrow' },
      dropdown(mats, f, (v) => { e.floor = v; e.floorTint = null; applyScene(); commit({ inspector: true }); }),
      colourInput(e.floorTint || E.floorTint || MATERIALS[f].tint, (v) => { e.floorTint = v; applyScene(); }, () => commit({ layers: false })))));
  }
  if (!compact && (E.wall || e.wall)) {
    const w = e.wall || E.wall;
    kids.push(row('Walls', h('div', { class: 'matrow' },
      dropdown(mats, w, (v) => { e.wall = v; e.wallTint = null; applyScene(); commit({ inspector: true }); }),
      colourInput(e.wallTint || E.wallTint || MATERIALS[w].tint, (v) => { e.wallTint = v; applyScene(); }, () => commit({ layers: false })))));
  }
  kids.push(...envLights());
  return section(compact ? 'Lighting' : 'Environment', E.label, ...kids);
}

function backgroundSection() {
  const b = doc.bg, cur = bgOf();
  const pick = h('div', { class: 'swatches' });
  for (const [id, p] of Object.entries(BACKGROUNDS)) {
    pick.append(h('button', {
      type: 'button', class: 'swatch', title: p.label, 'aria-label': p.label, 'aria-checked': String(b.preset === id && b.top == null),
      style: { background: `radial-gradient(circle at 50% 70%, ${p.glow} 0, transparent 70%), linear-gradient(${p.top}, ${p.horizon})`, width: '28px', height: '28px' },
      onclick: () => { doc.bg = { preset: id }; applyScene(); commit({ inspector: true }); },
    }));
  }
  const colour = (label, key) => row(label, h('input', {
    type: 'color', value: cur[key], style: { width: '100%', height: '28px', border: 0, background: 'none', padding: 0 },
    oninput: (e) => { b[key] = e.target.value; stage.setBackground(bgOf()); inkDirty = true; },
    onchange: () => commit({}),
  }));
  return section('Background', BACKGROUNDS[b.preset]?.label,
    pick,
    h('div', { style: { height: '10px' } }),
    colour('Top', 'top'), colour('Horizon', 'horizon'), colour('Glow', 'glow'),
    row('Glow', slider(0, 1.2, 0.01, cur.glowK, (v) => { b.glowK = v; stage.setBackground(bgOf()); }, (v) => Math.round(v * 100) + '%', () => commit({ layers: false }))),
    row('Beams', slider(0, 1, 0.01, cur.beams, (v) => { b.beams = v; stage.setBackground(bgOf()); }, (v) => Math.round(v * 100) + '%', () => commit({ layers: false }))),
  );
}

function cameraSection() {
  const c = doc.cam;
  return section('Camera', c.mode === '2d' ? '2D' : CAMERAS[c.preset]?.label || 'Custom',
    seg([['3d', 'Perspective'], ['2d', 'Flat 2D']], c.mode, (v) => { c.mode = v; syncModeSeg(); applyScene(); frameCamera(); renderCamDock(); commit({ inspector: true }); }),
    c.mode !== '2d' ? row('Lens', slider(14, 60, 1, Math.round(stage.camera.fov), (v) => {
      const t = stage.controls.target, p = stage.camera.position;
      const k = Math.tan((stage.camera.fov * D2R) / 2) / Math.tan((v * D2R) / 2);
      stage._setCam(p.clone().sub(t).multiplyScalar(k).add(t), t.clone(), v);
    }, (v) => v + '°', () => { c.preset = c.preset === 'custom' ? 'custom' : c.preset; commit({}); })) : null,
    row('Shift X', slider(-0.4, 0.4, 0.01, c.shift?.x || 0, (v) => { c.shift = { ...c.shift, x: v }; stage.setShift(c.shift.x, c.shift.y || 0); }, (v) => Math.round(v * 100) + '%', () => commit({ layers: false }))),
    row('Shift Y', slider(-0.4, 0.4, 0.01, c.shift?.y || 0, (v) => { c.shift = { ...c.shift, y: v }; stage.setShift(c.shift.x || 0, c.shift.y); }, (v) => Math.round(v * 100) + '%', () => commit({ layers: false }))),
    c.mode !== '2d' ? h('div', { style: { marginTop: '10px' } }, toggle('Auto-orbit', !!c.orbit, (v) => { c.orbit = v; applyScene(); renderCamDock(); commit({}); })) : null,
    h('div', { class: 'btnrow' },
      h('button', { type: 'button', class: 'btn', onclick: () => { if (c.preset === 'custom') c.preset = 'hero'; frameCamera(); renderCamDock(); } }, 'Re-frame'),
      h('button', { type: 'button', class: 'btn', onclick: () => { c.shift = { x: 0, y: 0 }; applyScene(); commit({ inspector: true }); } }, 'Reset shift')),
  );
}

function renderSection() {
  const R = renderOf();
  const apply = () => { applyScene(); };
  return section('Render', stage.refining ? `Refining ${stage.acc.n}/${stage.quality.samples}` : QUALITY[R.quality].label,
    row('Quality', seg(Object.entries(QUALITY).map(([k, v]) => [k, v.label]), R.quality, (v) => { R.quality = v; apply(); commit({ layers: false }); })),
    envOf().id !== 'studio' ? null : row('Floor', seg(Object.entries(FLOORS).map(([k, v]) => [k, v.label]), R.floor, (v) => { R.floor = v; apply(); commit({ layers: false }); })),
    h('div', { class: 'subhead' }, 'Atmosphere & depth'),
    row('Haze', slider(0, 1, 0.01, R.haze, (v) => { R.haze = v; apply(); }, (v) => (v ? Math.round(v * 100) + '%' : 'Off'), () => commit({ layers: false }))),
    row('Bloom', slider(0, 1, 0.01, R.bloom, (v) => { R.bloom = v; apply(); }, (v) => (v ? Math.round(v * 100) + '%' : 'Off'), () => commit({ layers: false }))),
    row('Vignette', slider(0, 1, 0.01, R.vignette, (v) => { R.vignette = v; apply(); }, (v) => (v ? Math.round(v * 100) + '%' : 'Off'), () => commit({ layers: false }))),
    row('Grain', slider(0, 1, 0.01, R.grain, (v) => { R.grain = v; apply(); }, (v) => (v ? Math.round(v * 100) + '%' : 'Off'), () => commit({ layers: false }))),
    row('Contact', slider(0, 1.5, 0.01, R.contact, (v) => { R.contact = v; apply(); }, (v) => Math.round(v * 100) + '%', () => commit({ layers: false }))),
    h('div', { class: 'subhead' }, 'Light & lens'),
    row('Soft light', slider(0, 1, 0.01, R.soft, (v) => { R.soft = v; apply(); }, (v) => Math.round(v * 100) + '%', () => commit({ layers: false }))),
    row('Focus blur', slider(0, 1, 0.01, R.dof, (v) => { R.dof = v; apply(); }, (v) => (v ? Math.round(v * 100) + '%' : 'Off'), () => commit({ layers: false }))),
    h('p', { class: 'empty', style: { marginTop: '8px' } }, 'The view refines itself whenever it is still: smoother edges, soft area-light shadows and lens blur focused on the camera target. Exports always render fully.'),
  );
}

function artboardSection() {
  const a = ab();
  return section('Artboard', `${a.w} × ${a.h}`,
    dropdown(Object.entries(ARTBOARDS).map(([k, v]) => [k, `${v.label} — ${v.w}×${v.h}`]), doc.artboard, (v) => setArtboard(v)));
}

function sceneInspector() {
  return h('div', {},
    h('section', { class: 'sec' },
      h('h3', { class: 'sec__headline' }, svg(ICON.bg), doc.name),
      h('p', { class: 'empty', style: { marginTop: '6px' } }, 'Click a device or a line of text to edit it. Drop an image or video straight onto any screen.')),
    artboardSection(), envSection(),
    ...(envOf().id === 'studio' ? [backgroundSection(), lightingSection()] : []),
    renderSection(), cameraSection(),
    section('Add', null, h('div', { class: 'btnrow', style: { marginTop: 0 } },
      h('button', { type: 'button', class: 'btn', onclick: () => { leftTab = 'assets'; renderLeft(); } }, 'Device…'),
      h('button', { type: 'button', class: 'btn', onclick: () => addText('headline') }, 'Text'))),
  );
}

// ---------------------------------------------------------------- layer ops
function duplicate() {
  if (sel?.type === 'device') {
    const s = selected();
    const c = { ...s, id: 'd' + Math.random().toString(36).slice(2, 8), x: s.x + 6, z: s.z + 3 };
    doc.devices.push(c);
    select({ type: 'device', id: c.id });
    commit({ devices: true });
  } else if (sel?.type === 'text') {
    const s = selected();
    const c = { ...s, id: 't' + Math.random().toString(36).slice(2, 8), y: Math.min(0.9, s.y + 0.08) };
    doc.texts.push(c);
    select({ type: 'text', id: c.id });
    commit({ texts: true });
  }
}
function remove() {
  if (sel?.type === 'device') doc.devices = doc.devices.filter((d) => d.id !== sel.id);
  else if (sel?.type === 'text') doc.texts = doc.texts.filter((t) => t.id !== sel.id);
  else return;
  const was = sel.type;
  select(null);
  commit({ devices: was === 'device', texts: was === 'text' });
}

// ---------------------------------------------------------------- motion
const MOTIONS = {
  turntable: 'Turntable', orbit: 'Orbit 360°', push: 'Push in', rise: 'Rise', scroll: 'Scroll page', lid: 'Lid open',
};
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function motionPanel() {
  const hasLaptop = doc.devices.some((d) => MODELS[d.model].kind === 'laptop' || MODELS[d.model].kind === 'fold');
  const recLabel = motion.recording ? 'Recording…' : 'Record video';
  const ab0 = ab();
  const k = Math.min(1, 1920 / Math.max(ab0.w, ab0.h));
  return h('div', {},
    section('Camera move', null,
      seg(Object.entries(MOTIONS).filter(([k2]) => k2 !== 'lid' || hasLaptop).slice(0, 3), motion.preset, (v) => { motion.preset = v; if (motion.playing) startMotion(); }),
      h('div', { style: { height: '6px' } }),
      seg(Object.entries(MOTIONS).filter(([k2]) => k2 !== 'lid' || hasLaptop).slice(3), motion.preset, (v) => { motion.preset = v; if (motion.playing) startMotion(); }),
      row('Duration', slider(3, 12, 0.5, motion.dur, (v) => { motion.dur = v; }, (v) => v + 's')),
      h('div', { class: 'btnrow' },
        h('button', { type: 'button', class: 'btn', onclick: () => { motion.playing ? stopMotion() : startMotion(); renderRight(); } }, motion.playing && !motion.recording ? 'Stop' : 'Preview'),
        h('button', { type: 'button', class: 'btn btn--primary', disabled: !!motion.recording, onclick: record }, h('i', { class: 'rec' }), recLabel)),
      h('div', { class: 'progress' }, h('i', { id: 'rec-progress' })),
      h('p', { class: 'empty', style: { marginTop: '10px' } },
        `Records the artboard with its text at ${Math.round(ab0.w * k)} × ${Math.round(ab0.h * k)}, ${motion.dur}s, as ${recMime().includes('mp4') ? 'MP4' : 'WebM'}. Moves start from the current view.`)),
  );
}

function startMotion() {
  if (!motion.base) {
    const c = stage.getCam();
    motion.base = { pos: new THREE.Vector3(...c.pos), target: new THREE.Vector3(...c.target), fov: c.fov };
  }
  stage.controls.autoRotate = false;
  motion.playing = true;
  motion.t0 = performance.now();
}

function stopMotion() {
  if (!motion.playing) return;
  motion.playing = false;
  if (motion.base) stage._setCam(motion.base.pos, motion.base.target, motion.base.fov);
  motion.base = null;
  for (const d of stage.devices.values()) { d.articulate(d.spec.lid, d.spec.fold); d.paint(true); }
  applyScene();
}

function applyMotion(now) {
  let t = (now - motion.t0) / (motion.dur * 1000);
  if (motion.recording) {
    const bar = document.getElementById('rec-progress');
    if (bar) bar.style.width = Math.min(100, t * 100) + '%';
    if (t >= 1) { finishRecording(); return; }
  } else t %= 1;
  const loopT = motion.recording ? t : (t < 0.5 ? t * 2 : 2 - t * 2);
  const { pos, target } = motion.base;
  const sph = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
  switch (motion.preset) {
    case 'turntable': sph.theta += Math.sin(t * Math.PI * 2) * 0.42; break;
    case 'orbit': sph.theta += t * Math.PI * 2; break;
    case 'push': { const e = easeIO(loopT); sph.radius *= 1.22 - e * 0.32; sph.theta += (e - 0.5) * 0.3; break; }
    case 'rise': { const e = easeIO(loopT); sph.phi = Math.min(88 * D2R, Math.max(0.2, sph.phi + 0.32 - e * 0.5)); break; }
    case 'scroll': {
      // pages scroll inside their screens while the camera drifts in
      const e = easeIO(loopT);
      for (const d of stage.devices.values()) if (d.spec.fill === 'top') d.paint(false, e * 0.85);
      sph.radius *= 1.06 - e * 0.08;
      sph.theta += (e - 0.5) * 0.12;
      stage.dirty = true;
      break;
    }
    case 'lid': {
      const e = easeIO(Math.min(1, loopT * 1.25));
      for (const d of stage.devices.values()) d.articulate(d.spec.lid != null ? 8 + (d.spec.lid - 8) * e : null, d.spec.fold != null ? 180 - (180 - d.spec.fold) * (0.2 + 0.8 * e) : null);
      sph.radius *= 1.12 - e * 0.12;
      sph.phi = Math.min(88 * D2R, sph.phi + (1 - e) * 0.2);
      stage.dirty = true;
      break;
    }
  }
  stage._setCam(new THREE.Vector3().setFromSpherical(sph).add(target), target, motion.base.fov);
}

function recMime() {
  const opts = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return opts.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || 'video/webm';
}

function record() {
  if (!window.MediaRecorder) { toast('Recording is not supported in this browser'); return; }
  stopMotion();
  const a = ab();
  const k = Math.min(1, 1920 / Math.max(a.w, a.h));
  const w = Math.round((a.w * k) / 2) * 2, hgt = Math.round((a.h * k) / 2) * 2;
  const out = h('canvas', { width: w, height: hgt });
  const ctx = out.getContext('2d');
  const mime = recMime();
  const stream = out.captureStream(60);
  const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 18e6 });
  const chunks = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.onstop = () => {
    download(new Blob(chunks, { type: mime.split(';')[0] }), `${slug(doc.name)}-${motion.preset}.${mime.includes('mp4') ? 'mp4' : 'webm'}`);
    toast('Video exported');
  };
  stage.renderer.setPixelRatio(1);
  stage.setSize(w, hgt);
  motion.recording = { mr, ctx, w, h: hgt };
  startMotion();
  mr.start();
  renderRight();
}

function recordFrame() {
  const r = motion.recording;
  r.ctx.drawImage(glCanvas, 0, 0, r.w, r.h);
  drawText(r.ctx, doc.texts, r.w, r.h, (r.w / ab().w) * textScale(), isLight());
}

function finishRecording() {
  const r = motion.recording;
  motion.recording = null;
  r.mr.stop();
  stopMotion();
  stage.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  layout();
  renderRight();
}

// ---------------------------------------------------------------- export
function exportPanel() {
  const a = ab();
  const s = exportOpts.scale;
  const W = a.w * s, H = a.h * s;
  return h('div', {},
    artboardSection(),
    section('Image', `${W} × ${H}`,
      row('Scale', seg([[1, '1×'], [2, '2×'], [3, '3×']], s, (v) => { exportOpts.scale = v; renderRight(); })),
      row('Format', seg([['png', 'PNG'], ['jpg', 'JPG']], exportOpts.format, (v) => { exportOpts.format = v; if (v === 'jpg') exportOpts.transparent = false; renderRight(); })),
      exportOpts.format === 'png' ? h('div', { style: { marginTop: '10px' } }, toggle('Transparent background', exportOpts.transparent, (v) => { exportOpts.transparent = v; frame.classList.toggle('is-transparent', v); stage.transparent = v; stage.dirty = true; })) : null,
      h('button', { type: 'button', class: 'btn btn--primary btn--block', style: { marginTop: '12px' }, onclick: exportImage }, `Export ${exportOpts.format.toUpperCase()}`),
      h('button', { type: 'button', class: 'btn btn--block', style: { marginTop: '8px' }, onclick: exportAll }, `Export every size (${Object.keys(ARTBOARDS).length})`),
    ),
    renderSection(),
    section('Video', null,
      h('p', { class: 'empty' }, 'Turntables, push-ins and lid reveals are in the Motion tab.'),
      h('button', { type: 'button', class: 'btn btn--block', style: { marginTop: '8px' }, onclick: () => { rightTab = 'motion'; renderRight(); } }, 'Open Motion')),
    section('Project', null,
      h('div', { class: 'btnrow', style: { marginTop: 0 } },
        h('button', { type: 'button', class: 'btn', onclick: saveProject }, 'Save .json'),
        h('button', { type: 'button', class: 'btn', onclick: () => { $('#proj-in').value = ''; $('#proj-in').click(); } }, 'Open…')),
      h('p', { class: 'empty', style: { marginTop: '8px' } }, 'Your work autosaves in this browser. Uploaded screens stay in this browser too and are referenced, not embedded, in .json files.')),
  );
}

function exportImage() {
  const a = ab();
  const s = Math.min(exportOpts.scale, Math.floor(8192 / Math.max(a.w, a.h)) || 1);
  const W = a.w * s, H = a.h * s;
  const transparent = exportOpts.format === 'png' && exportOpts.transparent;
  stage.transparent = transparent;
  stage.repaintScreens(true);
  const out = stage.renderAt(W, H, EXPORT_SAMPLES[renderOf().quality] ?? 72);
  stage.transparent = transparent && rightTab === 'export';
  const ctx = out.getContext('2d');
  drawText(ctx, doc.texts, W, H, (W / a.w) * textScale(), isLight());
  let final = out;
  if (exportOpts.format === 'jpg') {
    final = h('canvas', { width: W, height: H });
    const c2 = final.getContext('2d');
    c2.fillStyle = bgOf().horizon;
    c2.fillRect(0, 0, W, H);
    c2.drawImage(out, 0, 0);
  }
  const ext = exportOpts.format === 'jpg' ? 'jpg' : 'png';
  final.toBlob((b) => {
    if (!b) { toast('Export failed — try a smaller scale'); return; }
    download(b, `${slug(doc.name)}-${a.w}x${a.h}@${s}x.${ext}`);
    toast(`Exported ${W} × ${H} ${ext.toUpperCase()}`);
  }, ext === 'jpg' ? 'image/jpeg' : 'image/png', 0.93);
  layout();
  window.__lastExport = final;
}

// Every layout preset, re-framed for each aspect, one file each.
async function exportAll() {
  const keep = doc.artboard;
  const n = Object.keys(ARTBOARDS).length;
  let i = 0;
  for (const id of Object.keys(ARTBOARDS)) {
    toast(`Rendering ${++i} of ${n} — ${ARTBOARDS[id].label}`);
    await new Promise((r) => setTimeout(r, 60));
    doc.artboard = id;
    layout();
    if (doc.cam.preset !== 'custom') stage.goTo(stage.presetPose(doc.cam.preset, doc.cam.mode === '2d'), 0);
    exportImage();
    await new Promise((r) => setTimeout(r, 400));
  }
  doc.artboard = keep;
  layout();
  if (doc.cam.preset !== 'custom') stage.goTo(stage.presetPose(doc.cam.preset, doc.cam.mode === '2d'), 0);
  toast(`Exported ${n} sizes`);
}

function saveProject() {
  doc.cam = { ...doc.cam, ...stage.getCam() };
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${slug(doc.name)}.vantage.json`);
}
$('#proj-in').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d?.v !== 1 || !Array.isArray(d.devices)) throw new Error('bad');
    doc = d;
    sel = null;
    applyDoc();
    renderLeft(); renderRight(); renderCamDock();
    commit({});
    toast(`Opened ${doc.name}`);
  } catch { toast('That is not a Vantage project'); }
});

// ---------------------------------------------------------------- keyboard
window.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { if (typing) return; e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); exportImage(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
  if (mod) return;
  const k = e.key;
  if (k === 'Escape') { if (motion.playing && !motion.recording) { stopMotion(); renderRight(); } else select(null); }
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); remove(); }
  else if (k === 'v' || k === 'V') setTool('select');
  else if (k === 'h' || k === 'H') setTool('hand');
  else if (k === 't' || k === 'T') addText(doc.texts.some((t) => t.kind === 'headline') ? 'body' : 'headline');
  else if (k === 'l' || k === 'L') select({ type: 'light' });
  else if (k === 'f' || k === 'F') $('#btn-fit').click();
  else if (k === 'o' || k === 'O') { doc.cam.orbit = !doc.cam.orbit; applyScene(); renderCamDock(); }
  else if (k >= '1' && k <= '5') { const id = Object.keys(CAMERAS)[+k - 1]; doc.cam.preset = id; doc.cam.orbit = false; applyScene(); frameCamera(); renderCamDock(); renderLeft(); }
  else if (k.startsWith('Arrow') && sel) {
    e.preventDefault();
    const s = selected();
    if (!s) return;
    const step = e.shiftKey ? 5 : 0.5;
    if (sel.type === 'device') {
      if (k === 'ArrowLeft') s.x -= step; if (k === 'ArrowRight') s.x += step;
      if (k === 'ArrowUp') s.z -= step; if (k === 'ArrowDown') s.z += step;
      commit({ devices: true, layers: false, inspector: true });
    } else {
      const st = (e.shiftKey ? 0.02 : 0.004);
      if (k === 'ArrowLeft') s.x -= st; if (k === 'ArrowRight') s.x += st;
      if (k === 'ArrowUp') s.y -= st; if (k === 'ArrowDown') s.y += st;
      commit({ texts: true, layers: false, inspector: true });
    }
  }
});

function dismissHint() { $('#hint').classList.add('is-gone'); }

// ---------------------------------------------------------------- loop
let frames = 0, fpsT = performance.now(), refineShown = -1;
function loop(now) {
  requestAnimationFrame(loop);
  if (motion.playing) applyMotion(now);
  stage.tick(now);
  const vid = stage.hasVideo();
  if (vid) stage.repaintScreens();
  if (stage.dirty || vid || motion.playing) {
    stage.render();
    frames++;
    if (motion.recording) recordFrame();
    else drawSel();
    refineShown = -1;
  } else if (!motion.recording && stage.refine()) {
    const n = stage.acc.n;
    if (n !== refineShown && (n === stage.quality.samples || n - refineShown > 4)) {
      refineShown = n;
      const el = $('#fps');
      el.classList.remove('is-idle');
      el.querySelector('b').textContent = n >= stage.quality.samples ? 'Refined' : `Refining ${Math.round((n / stage.quality.samples) * 100)}%`;
    }
  }
  if (inkDirty) drawInk();
  if (now - fpsT > 500) {
    const fps = Math.round((frames * 1000) / (now - fpsT));
    const el = $('#fps');
    el.classList.toggle('is-idle', fps === 0);
    if (fps || !stage.acc.n || stage.acc.n >= stage.quality.samples) el.querySelector('b').textContent = fps ? `${fps} fps` : stage.quality.samples ? 'Refined' : 'Idle';
    frames = 0; fpsT = now;
  }
}

// ---------------------------------------------------------------- boot
(async function boot() {
  await document.fonts?.ready;
  await lib.init();
  stage = new Stage(glCanvas, lib);
  stage.addEventListener('camera', updateZoom);
  stage.addEventListener('orbitstart', () => {
    dismissHint();
    if (doc.cam.preset !== 'custom') { doc.cam.preset = 'custom'; renderCamDock(); renderLeft(); }
  });
  stage.addEventListener('orbitend', () => commit({ layers: false }));
  lib.addEventListener('change', () => { if (stage) { stage.repaintScreens(true); renderLeft(); } });

  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    if (r.ok) companion = await r.json();
  } catch { companion = null; }
  if (companion?.figma) pollFigma();

  doc = load() || makeDoc('launch');
  // drop references to uploads that are no longer in this browser
  for (const d of doc.devices) if (!lib.items.has(d.screen)) d.screen = MODELS[d.model].kind === 'phone' ? 'kd-mobile' : 'kd-desktop';
  applyDoc({ fit: !doc.cam.pos });
  history.push(doc);
  setTool('select');
  renderLeft(); renderRight(); renderCamDock(); updateUndo();
  new ResizeObserver(() => layout()).observe(stageEl);
  requestAnimationFrame(loop);
  window.vantage = { get doc() { return doc; }, stage, lib, exportImage, loadScene, select, setArtboard, addDevice, applyScene, commit };
})();
