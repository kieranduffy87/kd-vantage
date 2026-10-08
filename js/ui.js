// Small DOM kit for the panels. Every control takes a value and a callback;
// the app re-renders the inspector whenever the selection changes.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const svg = (inner, cls = '') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner;
  return s;
};

export const ICON = {
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/>',
  tablet: '<rect x="5" y="2.5" width="14" height="19" rx="2"/>',
  fold: '<path d="M12 4v16M4 5.5l8-1.5 8 1.5v13l-8 1.5-8-1.5z"/>',
  display: '<rect x="2.5" y="3.5" width="19" height="12" rx="1.5"/><path d="M10 15.5l-1 5h6l-1-5"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2"/>',
  bg: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 16l5-5 4 4 3-3 6 6"/>',
  screen: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3 3.9M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.6 9.6 0 005.4-1.6"/>',
  prop: '<path d="M8 21h8M12 21v-6M12 15c-4 0-6-3-6-7 3 0 6 2 6 7zM12 15c4 0 6-3 6-7-3 0-6 2-6 7z"/>',
  rotate: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
};

export function section(title, aside, ...kids) {
  return h('section', { class: 'sec' },
    h('div', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, title), aside ? h('span', { class: 'sec__aside' }, aside) : null),
    ...kids);
}

export function row(label, ...control) {
  return h('div', { class: 'row' }, h('span', { class: 'row__label' }, label), h('div', {}, ...control));
}

export function seg(options, value, onPick, cls = 'seg seg--full') {
  const el = h('div', { class: cls, role: 'radiogroup' });
  for (const [v, label] of options) {
    el.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value),
      onclick: () => {
        el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', 'false'));
        el.querySelector(`[data-v="${CSS.escape(String(v))}"]`)?.setAttribute('aria-checked', 'true');
        onPick(v);
      },
      'data-v': v,
    }, label));
  }
  return el;
}

export function select(options, value, onPick) {
  const el = h('select', { class: 'field', onchange: (e) => onPick(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
  return el;
}

export function swatches(list, value, onPick) {
  const label = h('div', { class: 'swatch-label' }, list.find((s) => s.id === value)?.label || '');
  const wrap = h('div', { class: 'swatches', role: 'radiogroup' });
  for (const s of list) {
    wrap.append(h('button', {
      type: 'button', class: 'swatch', role: 'radio', title: s.label, 'aria-label': s.label,
      'aria-checked': String(s.id === value), style: { background: s.hex },
      onclick: () => {
        wrap.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-checked', 'false'));
        wrap.querySelector(`[aria-label="${CSS.escape(s.label)}"]`).setAttribute('aria-checked', 'true');
        label.textContent = s.label;
        onPick(s.id);
      },
    }));
  }
  return h('div', {}, wrap, label);
}

export function slider(min, max, step, value, onInput, fmt = (v) => v, onDone) {
  const out = h('output', {}, fmt(value));
  const paint = (inp) => inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%');
  const inp = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => { const v = +e.target.value; out.textContent = fmt(v); paint(e.target); onInput(v); },
    onchange: () => onDone?.(),
  });
  paint(inp);
  return h('div', { class: 'slider' }, inp, out);
}

// Number field with a draggable label, like Figma's scrubbable inputs.
export function num(label, value, onInput, { step = 1, min = -Infinity, max = Infinity, unit = '', onDone } = {}) {
  const inp = h('input', { type: 'text', inputmode: 'decimal', value: fmt(value) });
  function fmt(v) { return (Math.round(v * 100) / 100) + unit; }
  const set = (v, done) => {
    v = Math.max(min, Math.min(max, v));
    inp.value = fmt(v);
    onInput(v);
    if (done) onDone?.();
  };
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) set(v, true); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = parseFloat(inp.value) || 0;
      set(v + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), true);
    }
    if (e.key === 'Enter') inp.blur();
  });
  const lab = h('span', {}, label);
  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lab.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = parseFloat(inp.value) || 0;
    const move = (ev) => set(+(v0 + Math.round((ev.clientX - x0) / 2) * step).toFixed(3));
    const up = () => { lab.removeEventListener('pointermove', move); lab.removeEventListener('pointerup', up); onDone?.(); };
    lab.addEventListener('pointermove', move);
    lab.addEventListener('pointerup', up);
  });
  return h('label', { class: 'num' }, lab, inp);
}

export function toggle(label, on, onChange) {
  return h('label', { class: 'toggle' }, h('span', {}, label),
    h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => onChange(e.target.checked) }), h('i')));
}

let toastT;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('is-on'), 2200);
}

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
