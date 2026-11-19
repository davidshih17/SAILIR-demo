// Small DOM, formatting and chart helpers shared by every section.
export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

export const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const cache = new Map();
export const loadJSON = (name) => {
  if (!cache.has(name)) cache.set(name, fetch(`data/${name}.json`).then((r) => {
    if (!r.ok) throw new Error(`Could not load data/${name}.json (HTTP ${r.status})`);
    return r.json();
  }));
  return cache.get(name);
};

export const intStr = (a) => `I[${a.join(', ')}]`;
export const fmt = (x, d = 1) => Number(x).toFixed(d);
export const pct = (x, d = 1) => `${(100 * x).toFixed(d)}%`;
export const comma = (x) => Number(x).toLocaleString('en-US');
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function duration(s) {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${(s / 60).toFixed(s < 600 ? 1 : 0)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export function section(id, { eyebrow, title, lede }) {
  const root = document.getElementById(id);
  root.append(h('div', { class: 'head' }, h('div', { class: 'eyebrow' }, eyebrow), h('h2', {}, title),
    lede ? h('p', { class: 'lede', html: lede }) : null));
  return root;
}

export const mlNote = (title, html) => h('div', { class: 'ml' }, h('b', { class: 'tag' }, title), h('span', { html }));

const tipEl = () => document.getElementById('tip');
export function showTip(evt, html) {
  const t = tipEl();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = `${clamp(evt.clientX + 14, 6, innerWidth - r.width - 6)}px`;
  t.style.top = `${clamp(evt.clientY - r.height - 10, 6, innerHeight - r.height - 6)}px`;
}
export const hideTip = () => { tipEl().hidden = true; };
export function tip(node, htmlFn) {
  node.addEventListener('pointermove', (e) => showTip(e, htmlFn(e)));
  node.addEventListener('pointerleave', hideTip);
  return node;
}

// Run a section's builder once it is near the viewport, so the page opens quickly.
export function whenNear(id, build) {
  const root = document.getElementById(id);
  const run = () => build().catch((err) => {
    console.error(err);
    root.append(h('p', { class: 'error' }, `This section could not load: ${err.message}. Reload the page to try again.`));
  });
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); run(); }
  }, { rootMargin: '900px 0px' });
  io.observe(root);
}

// A simple play/pause loop over integer frames, driving a range input.
export function player({ frames, delay, onFrame, slider, button }) {
  let frame = 0, timer = null;
  const stop = () => { clearTimeout(timer); timer = null; button.textContent = 'Play'; };
  const show = (f) => { frame = clamp(f, 0, frames() - 1); slider.value = frame; onFrame(frame); };
  const tick = () => {
    if (frame >= frames() - 1) return stop();
    show(frame + 1);
    timer = setTimeout(tick, typeof delay === 'function' ? delay(frame) : delay);
  };
  button.addEventListener('click', () => {
    if (timer) return stop();
    if (frame >= frames() - 1) show(0);
    button.textContent = 'Pause';
    timer = setTimeout(tick, 150);
  });
  slider.addEventListener('input', () => { stop(); show(Number(slider.value)); });
  return { show, stop, get frame() { return frame; } };
}

// Round tick values covering [lo, hi].
export function niceTicks(lo, hi, count = 5) {
  const raw = (hi - lo) / Math.max(count - 1, 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw);
  const first = Math.floor(lo / step + 1e-9), last = Math.ceil(hi / step - 1e-9);
  return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(10)));
}

// Line chart with shared x, hover crosshair and tooltip.  series: [{name,color,values}]
export function lineChart({ width = 520, height = 240, x, series, yLabel, xLabel, yFormat = (v) => v, log = false, yDomain, marker, tipFormat, xTicks }) {
  const m = { t: 12, r: 14, b: 36, l: 52 };
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img' });
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  let [lo, hi] = yDomain ?? [Math.min(...all), Math.max(...all)];
  const f = log ? Math.log10 : (v) => v;
  const linTicks = log ? null : niceTicks(lo, hi);
  if (linTicks) { lo = linTicks[0]; hi = linTicks[linTicks.length - 1]; }
  if (log) { lo = 10 ** Math.floor(Math.log10(lo)); hi = 10 ** Math.ceil(Math.log10(hi)); }
  const X = (v) => m.l + ((v - x[0]) / (x[x.length - 1] - x[0])) * (width - m.l - m.r);
  const Y = (v) => height - m.b - ((f(v) - f(lo)) / (f(hi) - f(lo))) * (height - m.t - m.b);
  const ticks = log
    ? Array.from({ length: Math.round(Math.log10(hi / lo)) + 1 }, (_, i) => lo * 10 ** i)
    : linTicks;
  for (const t of ticks) {
    svg.append(svgEl('line', { class: 'grid', x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t) }));
    const lab = svgEl('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }); lab.textContent = yFormat(t); svg.append(lab);
  }
  svg.append(svgEl('line', { class: 'axis', x1: m.l, x2: width - m.r, y1: height - m.b, y2: height - m.b }));
  for (const t of xTicks ?? x) {
    const lab = svgEl('text', { x: X(t), y: height - m.b + 15, 'text-anchor': 'middle' }); lab.textContent = t; svg.append(lab);
  }
  if (xLabel) { const l = svgEl('text', { x: (m.l + width - m.r) / 2, y: height - 4, 'text-anchor': 'middle' }); l.textContent = xLabel; svg.append(l); }
  if (yLabel) { const l = svgEl('text', { x: 12, y: height / 2 - 6, 'text-anchor': 'middle', transform: `rotate(-90 12 ${height / 2 - 6})` }); l.textContent = yLabel; svg.append(l); }
  if (marker != null) svg.append(svgEl('line', { x1: X(marker), x2: X(marker), y1: m.t, y2: height - m.b, stroke: 'var(--line-strong)', 'stroke-width': 1.5 }));
  for (const s of series) {
    const pts = s.values.map((v, i) => (v == null ? null : [X(x[i]), Y(v)])).filter(Boolean);
    svg.append(svgEl('path', { d: `M${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join('L')}`, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (s.dots) for (const p of pts) svg.append(svgEl('circle', { cx: p[0], cy: p[1], r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
  }
  const cross = svgEl('line', { y1: m.t, y2: height - m.b, stroke: 'var(--faint)', 'stroke-width': 1, visibility: 'hidden' });
  svg.append(cross);
  const hit = svgEl('rect', { x: m.l, y: m.t, width: width - m.l - m.r, height: height - m.t - m.b, fill: 'transparent' });
  svg.append(hit);
  hit.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    let best = 0;
    x.forEach((v, i) => { if (Math.abs(X(v) - px) < Math.abs(X(x[best]) - px)) best = i; });
    cross.setAttribute('x1', X(x[best])); cross.setAttribute('x2', X(x[best])); cross.setAttribute('visibility', 'visible');
    showTip(e, tipFormat ? tipFormat(best) : series.map((s) => `${s.name}: ${yFormat(s.values[best])}`).join('<br>'));
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  return svg;
}

export function barChart({ width = 340, height = 170, bins, xLabel, color = 'var(--sailir)', tipFormat, yFormat, yMax }) {
  const m = { t: 8, r: 8, b: 34, l: 42 };
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img' });
  const ticks = niceTicks(0, yMax ?? Math.max(...bins.map((b) => b.v)), 4);
  const max = ticks[ticks.length - 1];
  const w = (width - m.l - m.r) / bins.length;
  const Y = (v) => height - m.b - (v / max) * (height - m.t - m.b);
  for (const v of ticks) {
    svg.append(svgEl('line', { class: 'grid', x1: m.l, x2: width - m.r, y1: Y(v), y2: Y(v) }));
    const t = svgEl('text', { x: m.l - 5, y: Y(v) + 4, 'text-anchor': 'end' });
    t.textContent = yFormat ? yFormat(v) : v >= 1000 ? `${v / 1000}k` : v;
    svg.append(t);
  }
  bins.forEach((b, i) => {
    const bar = svgEl('rect', { x: m.l + i * w + 1, y: Y(b.v), width: Math.max(w - 2, 1), height: Math.max(height - m.b - Y(b.v), 0.5), fill: color, rx: 1.5 });
    tip(bar, () => (tipFormat ? tipFormat(b) : `${b.label}: ${comma(b.v)}`));
    svg.append(bar);
    if (bins.length <= 12 || i % Math.ceil(bins.length / 8) === 0) {
      const t = svgEl('text', { x: m.l + i * w + w / 2, y: height - m.b + 13, 'text-anchor': 'middle' }); t.textContent = b.label; svg.append(t);
    }
  });
  const l = svgEl('text', { x: (m.l + width - m.r) / 2, y: height - 3, 'text-anchor': 'middle' }); l.textContent = xLabel; svg.append(l);
  svg.append(svgEl('line', { class: 'axis', x1: m.l, x2: width - m.r, y1: height - m.b, y2: height - m.b }));
  return svg;
}
