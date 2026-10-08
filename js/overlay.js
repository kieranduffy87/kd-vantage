// Text layers, drawn with canvas 2D. The same draw() runs for the preview and
// the export, so what you see on the artboard is what you get.

export const TEXT_KINDS = {
  headline: { label: 'Headline', weight: 500, size: 64, track: -0.025, lh: 1.04 },
  body: { label: 'Body', weight: 400, size: 22, track: 0, lh: 1.45 },
  label: { label: 'Label', weight: 600, size: 13, track: 0.14, lh: 1.2, upper: true },
  chip: { label: 'Chip', weight: 500, size: 22, track: 0, lh: 1 },
};

export const TEXT_COLOURS = {
  auto: 'Auto', paper: 'Paper', ink: 'Ink', blue: 'KD Blue',
};

// palette swatches offered in the inspector; any other hex is a custom colour
export const TEXT_SWATCHES = [
  { id: 'paper', label: 'Paper', hex: '#f4f4f6' },
  { id: 'ink', label: 'Ink', hex: '#0e0f12' },
  { id: 'blue', label: 'KD Blue', hex: '#0339f8' },
  { id: 'coral', label: 'Coral', hex: '#ff7a59' },
  { id: 'teal', label: 'Teal', hex: '#21d4b4' },
  { id: 'sand', label: 'Sand', hex: '#e8dcc6' },
];

const HEX = Object.fromEntries(TEXT_SWATCHES.map((s) => [s.id, s.hex]));
const luma = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
export function textHex(color, light) {
  if (!color || color === 'auto') return light ? HEX.ink : HEX.paper;
  return HEX[color] || (/^#[0-9a-f]{6}$/i.test(color) ? color : HEX.paper);
}

export function newText(kind, over = {}) {
  const k = TEXT_KINDS[kind];
  const defaults = {
    headline: 'Your design, from every angle.',
    body: 'Mockups in real-time 3D, straight from your own work.',
    label: 'KD Vantage',
    chip: 'Now on every screen',
  };
  return {
    id: 't' + Math.random().toString(36).slice(2, 8),
    kind, text: defaults[kind], x: 0.06, y: 0.08, size: k.size, color: 'auto',
    align: 'left', width: kind === 'headline' ? 0.5 : 0.42, visible: true, ...over,
  };
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// scale: canvas px per artboard px. Returns hit boxes in canvas px.
export function drawText(ctx, layers, W, H, scale, light) {
  const boxes = [];
  for (const L of layers) {
    if (L.visible === false || !L.text) continue;
    const K = TEXT_KINDS[L.kind] || TEXT_KINDS.body;
    const fs = L.size * scale;
    const col = textHex(L.color, light);
    ctx.save();
    ctx.font = `${K.weight} ${fs}px "Instrument Sans", "Helvetica Neue", Arial, sans-serif`;
    ctx.letterSpacing = `${K.track * fs}px`;
    ctx.textBaseline = 'alphabetic';
    const x = L.x * W, y = L.y * H;
    const text = K.upper ? L.text.toUpperCase() : L.text;

    if (L.kind === 'chip') {
      const padX = fs * 0.95, h = fs * 2.15, dot = fs * 0.36;
      const tw = ctx.measureText(text).width;
      const w = tw + padX * 2 + dot + fs * 0.5;
      const bx = L.align === 'center' ? x - w / 2 : x;
      ctx.beginPath();
      ctx.roundRect(bx, y, w, h, h / 2);
      // the chip is filled with the colour; its label picks ink or paper for contrast
      ctx.fillStyle = col === HEX.paper ? 'rgba(255,255,255,0.94)' : col;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx + padX + dot / 2, y + h / 2, dot / 2, 0, Math.PI * 2);
      ctx.fillStyle = col === HEX.teal ? HEX.ink : '#21d4b4';
      ctx.fill();
      ctx.fillStyle = luma(col) > 0.55 ? HEX.ink : HEX.paper;
      ctx.fillText(text, bx + padX + dot + fs * 0.5, y + h / 2 + fs * 0.36);
      boxes.push({ id: L.id, x: bx, y, w, h });
      ctx.restore();
      continue;
    }

    const maxW = (L.width || 0.5) * W;
    const lines = wrap(ctx, text, maxW);
    const lh = fs * K.lh;
    ctx.fillStyle = L.kind === 'label' && L.color === 'auto' ? (light ? 'rgba(14,15,18,0.55)' : 'rgba(244,244,246,0.6)') : col;
    if (L.kind === 'body' && L.color === 'auto') ctx.globalAlpha = 0.72;
    ctx.textAlign = L.align === 'center' ? 'center' : 'left';
    let widest = 0;
    lines.forEach((ln, i) => {
      ctx.fillText(ln, x, y + fs * 0.92 + i * lh);
      widest = Math.max(widest, ctx.measureText(ln).width);
    });
    const bw = widest, bh = fs * 0.92 + (lines.length - 1) * lh + fs * 0.26;
    boxes.push({ id: L.id, x: L.align === 'center' ? x - bw / 2 : x, y, w: bw, h: bh });
    ctx.restore();
  }
  return boxes;
}
