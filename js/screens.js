// Screen sources (built-in captures + uploads) and the per-device canvas that
// paints a source onto a device's display with Top / Fit / Fill framing.
import * as THREE from 'three';

export const BUILTIN = [
  { id: 'kd-desktop', name: 'KD Portfolio / Desktop', src: 'assets/screens/portfolio-desktop.jpg', form: 'desktop', url: 'kieranduffy87.github.io' },
  { id: 'kd-mobile', name: 'KD Portfolio / Mobile', src: 'assets/screens/portfolio-mobile.jpg', form: 'mobile' },
  { id: 'ie-desktop', name: 'Imagination Explorer / Desktop', src: 'assets/screens/explorer-desktop.jpg', form: 'desktop', url: 'theimaginationexplorer.com' },
  { id: 'ie-mobile', name: 'Imagination Explorer / Mobile', src: 'assets/screens/explorer-mobile.jpg', form: 'mobile' },
  { id: 'fkb-desktop', name: 'FKB Glass / Desktop', src: 'assets/screens/fkb-desktop.jpg', form: 'desktop', url: 'fkbglassglazing.ie' },
  { id: 'fkb-mobile', name: 'FKB Glass / Mobile', src: 'assets/screens/fkb-mobile.jpg', form: 'mobile' },
  { id: 'kd-mark', name: 'KD Mark / Lockscreen', gen: 'mark', form: 'any' },
];

// ---------- tiny IndexedDB store for uploaded media ----------
const DB = 'kd-vantage', STORE = 'screens';
function idb() {
  return new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

// ---------- library ----------
export class ScreenLibrary extends EventTarget {
  constructor() {
    super();
    this.items = new Map();   // id -> { id, name, kind, el, w, h, form, user }
  }

  async init() {
    await Promise.all(BUILTIN.map((b) => this._addBuiltin(b)));
    try {
      const rows = await tx('readonly', (s) => s.getAll());
      for (const row of rows || []) await this._addBlob(row.id, row.name, row.blob, false, row.meta || {});
    } catch { /* private window: uploads simply won't persist */ }
    this._emit();
  }

  get(id) { return this.items.get(id) || this.items.get('kd-mark'); }
  list() { return [...this.items.values()]; }

  async _addBuiltin(b) {
    if (b.gen === 'mark') {
      const c = markScreen();
      this.items.set(b.id, { ...b, kind: 'image', el: c, w: c.width, h: c.height, thumb: c.toDataURL('image/jpeg', 0.7) });
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = b.src;
    try { await img.decode(); } catch { return; }
    this.items.set(b.id, { ...b, kind: 'image', el: img, w: img.naturalWidth, h: img.naturalHeight, thumb: b.src });
  }

  // meta: { form, url, source: 'capture' | 'figma', ver }
  async _addBlob(id, name, blob, persist = true, meta = {}) {
    const url = URL.createObjectURL(blob);
    let item;
    if (blob.type.startsWith('video/')) {
      const v = document.createElement('video');
      Object.assign(v, { src: url, muted: true, loop: true, playsInline: true, crossOrigin: 'anonymous' });
      await new Promise((r) => { v.onloadeddata = r; v.onerror = r; });
      v.play().catch(() => {});
      item = { id, name, kind: 'video', el: v, w: v.videoWidth || 1080, h: v.videoHeight || 1920 };
    } else {
      const img = new Image();
      img.src = url;
      await img.decode();
      item = { id, name, kind: 'image', el: img, w: img.naturalWidth, h: img.naturalHeight };
    }
    item.form = item.w > item.h ? 'desktop' : 'mobile';
    Object.assign(item, meta);
    item.thumb = url;
    item.user = true;
    const old = this.items.get(id);
    if (old?.thumb?.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(old.thumb), 5000);
    this.items.set(id, item);
    if (persist) {
      try { await tx('readwrite', (s) => s.put({ id, name, blob, meta })); } catch { /* ignore */ }
    }
    this._emit();
    return item;
  }

  async addFile(file) {
    const id = 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const name = file.name.replace(/\.[^.]+$/, '');
    return this._addBlob(id, name, file);
  }

  // Add or replace in place (same id), so devices showing it update live.
  upsert(id, name, blob, meta = {}) { return this._addBlob(id, name, blob, true, meta); }

  async remove(id) {
    const it = this.items.get(id);
    if (!it?.user) return;
    this.items.delete(id);
    try { await tx('readwrite', (s) => s.delete(id)); } catch { /* ignore */ }
    this._emit();
  }

  hasVideo() { return [...this.items.values()].some((i) => i.kind === 'video'); }
  _emit() { this.dispatchEvent(new Event('change')); }
}

// A lock screen in the house style, generated so it is always available.
function markScreen() {
  const c = document.createElement('canvas');
  c.width = 1206; c.height = 2622;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(603, 900, 50, 603, 1100, 1700);
  grd.addColorStop(0, '#2149ff');
  grd.addColorStop(0.35, '#0339f8');
  grd.addColorStop(0.75, '#01145a');
  grd.addColorStop(1, '#05060a');
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f4f4f6';
  g.textAlign = 'center';
  g.font = '500 92px "Instrument Sans", sans-serif';
  g.fillText('Thursday 2 October', 603, 380);
  g.font = '600 330px "Instrument Sans", sans-serif';
  g.fillText('9:41', 603, 700);
  // the mark
  const s = 26, ox = 603 - 9.31 * s, oy = 1500 - 5.865 * s;
  const poly = (pts, fill) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, ox + x * s, oy + y * s));
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  poly([[18.62, 0], [12, 0], [6, 5.86], [12, 11.73], [18.62, 11.73], [12.62, 5.86]], '#f4f4f6');
  poly([[0, 0], [0, 11.72], [6, 5.86]], 'rgba(244,244,246,0.55)');
  g.font = '500 54px "Instrument Sans", sans-serif';
  g.fillStyle = 'rgba(244,244,246,0.7)';
  g.fillText('Brand and digital design that earns its keep.', 603, 2380);
  return c;
}

// ---------- system chrome ----------
function topLuma(ctx, W, h, rot, canvas) {
  try {
    // sample the band in canvas space (it may be rotated)
    const d = rot ? ctx.getImageData(canvas.width - h, 0, h, canvas.height).data : ctx.getImageData(0, 0, W, h).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 37) { sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return sum / n / 255;
  } catch { return 0; }
}

function glyphs(g, x, y, u, col) {
  // signal bars, wi-fi, battery — right-aligned at x, vertically centred at y
  g.fillStyle = col; g.strokeStyle = col;
  // battery
  const bw = 25 * u, bh = 12 * u;
  let cx = x - bw - 2.5 * u;
  g.globalAlpha = 0.4;
  g.lineWidth = 1 * u;
  g.beginPath(); g.roundRect(cx, y - bh / 2, bw, bh, 3.6 * u); g.stroke();
  g.beginPath(); g.roundRect(cx + bw + 1 * u, y - 2 * u, 1.6 * u, 4 * u, 1 * u); g.fill();
  g.globalAlpha = 1;
  g.beginPath(); g.roundRect(cx + 2 * u, y - bh / 2 + 2 * u, bw - 4 * u, bh - 4 * u, 2 * u); g.fill();
  // wi-fi: three arcs
  cx -= 6 * u + 8 * u;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.lineWidth = 2 * u;
    g.arc(cx, y + 5 * u, (3.2 + i * 3.3) * u, -Math.PI * 0.76, -Math.PI * 0.24);
    g.stroke();
  }
  g.beginPath(); g.arc(cx, y + 4.4 * u, 1.4 * u, 0, Math.PI * 2); g.fill();
  // signal
  cx -= 10 * u + 17 * u;
  for (let i = 0; i < 4; i++) {
    const hh = (4 + i * 2.4) * u;
    g.beginPath(); g.roundRect(cx + i * 4.6 * u, y + 5.5 * u - hh, 3.2 * u, hh, 1 * u); g.fill();
  }
}

function drawChrome(g, W, H, ui, sc) {
  const font = (w, px) => `${w} ${px}px "SF Pro Text", -apple-system, "Instrument Sans", "Helvetica Neue", sans-serif`;
  if (ui.kind === 'phone') {
    const u = W / 402;
    const col = topLuma(g, W, Math.round(54 * u), sc.rot, sc.canvas) > 0.6 ? '#000' : '#fff';
    g.fillStyle = col;
    g.font = font(600, 17 * u);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('9:41', 72 * u, 30 * u);
    glyphs(g, W - 26 * u, 30 * u, u, col);
    return;
  }
  if (ui.kind === 'tablet') {
    const u = Math.min(W, H) / 834;
    const col = topLuma(g, W, Math.round(24 * u), sc.rot, sc.canvas) > 0.6 ? '#000' : '#fff';
    g.fillStyle = col;
    g.font = font(600, 13 * u);
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('9:41   Thu 2 Oct', 22 * u, 14 * u);
    g.textAlign = 'right';
    g.font = font(500, 12 * u);
    g.fillText('100%', W - 106 * u, 14 * u);
    glyphs(g, W - 20 * u, 14 * u, u * 0.9, col);
    return;
  }
  // desktop: macOS menu bar + a Safari window toolbar
  const lap = ui.kind === 'laptop';
  const u = H / (lap ? 956 : 1440);
  const mb = (lap ? 37 : 25) * u, tb = 52 * u;
  g.fillStyle = '#e9e9ec';
  g.fillRect(0, 0, W, mb);
  g.fillStyle = '#1d1d1f';
  g.font = font(600, 13 * u);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  let x = 22 * u;
  // the KD mark stands in for the system menu
  g.save();
  g.translate(x, mb / 2 - 4.5 * u);
  const s = 0.78 * u;
  g.beginPath();
  [[18.62, 0], [12, 0], [6, 5.86], [12, 11.73], [18.62, 11.73], [12.62, 5.86]].forEach(([a, b], i) => (i ? g.lineTo : g.moveTo).call(g, a * s, b * s));
  g.closePath(); g.fill();
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 11.72 * s); g.lineTo(6 * s, 5.86 * s); g.closePath(); g.fill();
  g.restore();
  x += 34 * u;
  g.fillText('Safari', x, mb / 2);
  x += g.measureText('Safari').width + 20 * u;
  g.font = font(400, 13 * u);
  for (const m of ['File', 'Edit', 'View', 'History', 'Bookmarks', 'Window', 'Help']) {
    g.fillText(m, x, mb / 2);
    x += g.measureText(m).width + 19 * u;
  }
  g.textAlign = 'right';
  g.fillText('Thu 2 Oct  9:41', W - 18 * u, mb / 2);
  glyphs(g, W - 140 * u, mb / 2, u * 0.85, '#1d1d1f');
  // toolbar
  g.fillStyle = '#f5f5f7';
  g.fillRect(0, mb, W, tb);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, mb + tb - Math.max(1, u), W, Math.max(1, u));
  const cy = mb + tb / 2;
  [['#ff5f57', 20], ['#febc2e', 40], ['#28c840', 60]].forEach(([c, cx]) => {
    g.fillStyle = c; g.beginPath(); g.arc(cx * u, cy, 6 * u, 0, Math.PI * 2); g.fill();
  });
  g.strokeStyle = '#8e8e93'; g.lineWidth = 1.8 * u; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(104 * u, cy - 6 * u); g.lineTo(98 * u, cy); g.lineTo(104 * u, cy + 6 * u); g.stroke();
  g.beginPath(); g.moveTo(126 * u, cy - 6 * u); g.lineTo(132 * u, cy); g.lineTo(126 * u, cy + 6 * u); g.stroke();
  const pw = Math.min(W * 0.42, 620 * u), px = (W - pw) / 2;
  g.fillStyle = '#e3e3e8';
  g.beginPath(); g.roundRect(px, cy - 15 * u, pw, 30 * u, 9 * u); g.fill();
  g.fillStyle = '#3c3c43';
  g.textAlign = 'center';
  g.font = font(500, 13 * u);
  const url = ui.url || 'localhost';
  g.fillText(url, W / 2 + 7 * u, cy + 0.5 * u);
  const tw = g.measureText(url).width;
  // padlock
  const lx = W / 2 - tw / 2 - 8 * u;
  g.fillStyle = '#6e6e73';
  g.beginPath(); g.roundRect(lx - 5 * u, cy - 1 * u, 10 * u, 8 * u, 1.6 * u); g.fill();
  g.strokeStyle = '#6e6e73'; g.lineWidth = 1.6 * u;
  g.beginPath(); g.arc(lx, cy - 1 * u, 3.2 * u, Math.PI, 0); g.stroke();
  // share, new tab, tabs
  g.strokeStyle = '#8e8e93'; g.lineWidth = 1.6 * u;
  const rx = W - 30 * u;
  g.beginPath(); g.roundRect(rx - 8 * u, cy - 7 * u, 13 * u, 13 * u, 2.5 * u); g.stroke();
  g.beginPath(); g.moveTo(rx - 44 * u, cy - 7 * u); g.lineTo(rx - 44 * u, cy + 7 * u); g.moveTo(rx - 51 * u, cy); g.lineTo(rx - 37 * u, cy); g.stroke();
  g.beginPath(); g.moveTo(rx - 80 * u, cy + 7 * u); g.lineTo(rx - 80 * u, cy - 8 * u); g.moveTo(rx - 85 * u, cy - 3 * u); g.lineTo(rx - 80 * u, cy - 8 * u); g.lineTo(rx - 75 * u, cy - 3 * u); g.stroke();
}

// ---------- per-device canvas ----------
// `pw`/`ph` are the device's native screen pixels; the canvas is capped so the
// long side stays at or under `cap` (texture memory on regular laptops).
export class ScreenCanvas {
  // `rot` paints the artwork turned 90° so a portrait-built device rotated into
  // landscape still shows it upright; pw/ph are then the landscape pixels.
  constructor(pw, ph, cap = 2048, rot = false) {
    const k = Math.min(1, cap / Math.max(pw, ph));
    this.rot = rot;
    this.lw = Math.round(pw * k);
    this.lh = Math.round(ph * k);
    this.canvas = document.createElement('canvas');
    this.canvas.width = rot ? this.lh : this.lw;
    this.canvas.height = rot ? this.lw : this.lh;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.key = '';
    this.source = null;
  }

  // fill: 'top' (match width, pin to top, scroll), 'fit' (contain), 'fill' (cover)
  // ui: { kind: 'phone' | 'tablet' | 'laptop' | 'display', url } draws the
  // system chrome — status bar, or menu bar + browser window — over the art.
  paint(source, fill = 'top', scroll = 0, force = false, ui = null) {
    const key = `${source?.id}|${fill}|${scroll.toFixed(3)}|${ui?.kind}|${ui?.url}`;
    this.source = source;
    this.fill = fill; this.scroll = scroll;
    if (!force && key === this.key && source?.kind !== 'video') return false;
    this.key = key;
    const { ctx, canvas } = this;
    const W = this.lw, H = this.lh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.rot) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
    // desktop chrome takes space at the top; phone/tablet bars overlay
    const desk = ui && (ui.kind === 'laptop' || ui.kind === 'display');
    const u = desk ? H / (ui.kind === 'laptop' ? 956 : 1440) : 0;
    const top = desk ? Math.round((ui.kind === 'laptop' ? 37 : 25) * u + 52 * u) : 0;
    if (source?.el) {
      const sw = source.kind === 'video' ? source.el.videoWidth || source.w : source.w;
      const sh = source.kind === 'video' ? source.el.videoHeight || source.h : source.h;
      if (sw && sh) {
        const CH = H - top, sa = sw / sh, da = W / CH;
        let dw, dh, dx, dy;
        if (fill === 'fit') {
          if (sa > da) { dw = W; dh = W / sa; } else { dh = CH; dw = CH * sa; }
          dx = (W - dw) / 2; dy = (CH - dh) / 2;
        } else if (fill === 'top' && sa <= da) {
          dw = W; dh = W / sa; dx = 0;
          dy = -(dh - CH) * Math.max(0, Math.min(1, scroll));
        } else {
          if (sa > da) { dh = CH; dw = CH * sa; } else { dw = W; dh = W / sa; }
          dx = (W - dw) / 2; dy = (CH - dh) / 2;
        }
        ctx.save();
        ctx.beginPath(); ctx.rect(0, top, W, CH); ctx.clip();
        try { ctx.drawImage(source.el, dx, dy + top, dw, dh); } catch { /* video not ready */ }
        ctx.restore();
      }
    }
    if (ui) drawChrome(ctx, W, H, ui, this);
    this.texture.needsUpdate = true;
    return true;
  }

  dispose() { this.texture.dispose(); }
}
