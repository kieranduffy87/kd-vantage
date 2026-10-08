// KD Vantage Link — sends selected frames to KD Vantage running locally and,
// with Live on, re-sends them whenever they change.
figma.showUI(__html__, { width: 300, height: 380, themeColors: true });

const linked = new Map(); // node id -> name
let live = false;
let listening = false;
let timer = null;
const dirty = new Set();

function exportable() {
  return figma.currentPage.selection.filter((n) => 'exportAsync' in n);
}

function postSelection() {
  const sel = exportable();
  figma.ui.postMessage({
    type: 'selection',
    items: sel.map((n) => ({ id: n.id, name: n.name, w: Math.round(n.width), h: Math.round(n.height) })),
  });
}

function postLinked() {
  figma.ui.postMessage({ type: 'linked', items: Array.from(linked, ([id, name]) => ({ id, name })) });
}

async function push(node) {
  // aim for a crisp ~2400 px long side, whatever the frame size
  const scale = Math.max(1, Math.min(4, 2400 / Math.max(node.width, node.height)));
  const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
  figma.ui.postMessage({ type: 'push', id: node.id, name: node.name, bytes });
}

async function flush() {
  const ids = Array.from(dirty);
  dirty.clear();
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (node && 'exportAsync' in node) await push(node);
    else linked.delete(id);
  }
  postLinked();
}

function onDocumentChange(e) {
  if (!live || linked.size === 0) return;
  for (const c of e.documentChanges) {
    let n = c.node;
    try {
      while (n) {
        if (linked.has(n.id)) { dirty.add(n.id); break; }
        n = n.parent;
      }
    } catch (err) { /* removed nodes have no parent */ }
  }
  if (dirty.size) {
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  }
}

figma.on('selectionchange', postSelection);

figma.ui.onmessage = async (m) => {
  if (m.type === 'ready') { postSelection(); postLinked(); }
  if (m.type === 'send') {
    const sel = exportable();
    if (!sel.length) { figma.notify('Select one or more frames to send'); return; }
    for (const n of sel) { linked.set(n.id, n.name); await push(n); }
    postLinked();
  }
  if (m.type === 'live') {
    live = m.on;
    if (live && !listening) {
      await figma.loadAllPagesAsync();
      figma.on('documentchange', onDocumentChange);
      listening = true;
    }
  }
  if (m.type === 'unlink') { linked.clear(); postLinked(); }
  if (m.type === 'notify') figma.notify(m.text);
};
