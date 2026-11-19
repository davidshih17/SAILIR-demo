// The reduction as a graph: one integral fans out into many, then collapses onto the masters.
import { h, player, scrolling, showTip, hideTip, intStr, comma } from './ui.js';

const W = 1400, H = 700, STRIP = 150;
const M = { l: 58, r: 40, t: 18, b: 34 };
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => `rgb(${rgb(a).map((v, i) => Math.round(v * t + rgb(b)[i] * (1 - t))).join(',')})`;

const PER_ROW = 3;

export function buildFan(root, d) {
  const n = d.generations;
  const levels = [...new Set(d.nodes.map((x) => x.level))].sort((a, b) => b - a);
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = h('canvas', { id: 'fan-canvas', style: 'width:100%;height:auto;display:block', role: 'img', 'aria-label': 'Graph of the integrals produced during the reduction, by generation' });
  const overlay = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none' });
  const cache = document.createElement('canvas');
  for (const c of [canvas, overlay, cache]) { c.width = W * scale; c.height = H * scale; }
  const ctx = canvas.getContext('2d'), over = overlay.getContext('2d'), cctx = cache.getContext('2d');
  for (const c of [ctx, over, cctx]) c.setTransform(scale, 0, 0, scale, 0, 0);

  const slider = h('input', { type: 'range', min: 0, max: n, value: n, id: 'fan-slider', 'aria-label': 'Generation' });
  const button = h('button', { class: 'btn primary', type: 'button', id: 'fan-play' }, 'Play');
  const stats = h('div', { class: 'stats', id: 'fan-stats' });
  // Stronger color means fewer propagators left, so the eye can follow the descent through subsectors.
  const levelColor = (level) => {
    const t = levels.indexOf(level) / Math.max(levels.length - 1, 1);
    const [teal, ground, ink] = ['--sailir', '--surface', '--ink'].map(css);
    return t < 0.6 ? mix(teal, ground, 0.32 + (t / 0.6) * 0.68) : mix(ink, teal, ((t - 0.6) / 0.4) * 0.55);
  };
  const swatch = (style) => h('i', { style: `display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:5px;vertical-align:-1px;${style}` });
  root.append(
    h('div', { class: 'legend' },
      levels.map((l) => h('span', {}, h('i', { 'data-level': l, style: 'display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:5px;vertical-align:-1px' }), `${l} propagator${l === 1 ? '' : 's'}`)),
      h('span', {}, swatch('border:1.5px solid var(--muted)'), 'Waiting to be reduced'),
      h('span', {}, swatch('background:var(--good)'), 'Master integral')),
    h('div', { style: 'position:relative' }, canvas, overlay),
    h('div', { class: 'row', style: 'flex-wrap:nowrap' }, button, slider), stats,
    h('p', { class: 'note' }, 'Each dot is one integral, and each line means that integral\'s reduction produced the next one. An integral\'s generation is the longest chain of reductions leading to it, so every line points to the right. Hover over a dot to see its connections.'),
    h('div', { class: 'stack' },
      h('h3', {}, `The answer: ${intStr(d.integral)} =`),
      h('div', { class: 'terms' }, d.answer.map(([a, c]) => h('div', { class: 'term' }, h('span', { class: 'c' }, String(c)), h('span', { class: 'int' }, intStr(a))))),
      h('p', { class: 'note' }, `Coefficients are mod 1009, at d = 41, m₁² = 1, m₂² = 31, m₃² = 47. ${comma(d.nodes.length)} reduction jobs ran. For ${d.cancelled_jobs} of them the integral's coefficient cancelled in the end, so their results were not needed.`)),
  );

  // Geometry: columns share one vertical spacing, so a column's height shows how many integrals it holds.
  const plotBottom = H - STRIP - 26, cy = (M.t + plotBottom) / 2;
  const gap = (W - M.l - M.r) / (n + 1);
  const X = (g) => M.l + (g + 0.5) * gap;
  const columns = Array.from({ length: n }, () => []);
  d.nodes.forEach((x, i) => columns[x.g].push(i));
  const most = Math.max(...columns.map((c) => Math.ceil(c.length / PER_ROW)));
  const dy = Math.min((plotBottom - M.t) / most, 9);
  const radius = Math.max(Math.min(dy * 0.42, 3.6), 1.15);
  const pos = d.nodes.map((x) => ({ x: 0, y: 0, ...x }));
  columns.forEach((c, g) => {
    const rows = Math.ceil(c.length / PER_ROW);
    c.forEach((i, j) => {
      const row = Math.floor(j / PER_ROW), inRow = Math.min(PER_ROW, c.length - row * PER_ROW);
      pos[i].x = X(g) + ((j % PER_ROW) - (inRow - 1) / 2) * dy;
      pos[i].y = cy + (row - (rows - 1) / 2) * dy;
    });
  });
  const mGap = Math.min((plotBottom - M.t) / Math.max(d.masters.length, 1), 26);
  const mPos = d.masters.map((m, j) => ({ ...m, x: X(n), y: cy + (j - (d.masters.length - 1) / 2) * mGap }));
  const N = d.nodes.length;
  const at = (i) => (i < N ? pos[i] : mPos[i - N]);

  // Edges by source; each target appears once its first source has been reduced.
  const out = Array.from({ length: N }, () => []), into = Array.from({ length: N + d.masters.length }, () => []);
  for (let k = 0; k < d.edges.length; k += 2) { out[d.edges[k]].push(d.edges[k + 1]); into[d.edges[k + 1]].push(d.edges[k]); }
  const born = into.map((src, v) => (src.length ? Math.min(...src.map((u) => d.nodes[u].g)) + 1 : 0));

  let frame = n, cachedTo = 0;
  const strokeEdges = (c, g, color, alpha, width) => {
    c.beginPath();
    for (const u of columns[g]) for (const v of out[u]) { const q = at(v); c.moveTo(pos[u].x, pos[u].y); c.lineTo(q.x, q.y); }
    c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width; c.stroke(); c.globalAlpha = 1;
  };

  function draw(f) {
    frame = f;
    const [hot, line, muted, good, surface, target] = ['--sailir', '--line-strong', '--muted', '--good', '--surface', '--target'].map(css);
    if (f - 1 < cachedTo) { cctx.clearRect(0, 0, W, H); cachedTo = 0; }
    for (; cachedTo < f - 1; cachedTo++) strokeEdges(cctx, cachedTo, line, 0.2, 0.6);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cache, 0, 0, W, H);
    if (f > 0) strokeEdges(ctx, f - 1, hot, 0.5, 0.8);

    // Reduced integrals are filled by sector size; integrals still waiting are open rings.
    for (const level of levels) {
      ctx.beginPath();
      pos.forEach((p) => { if (p.level === level && p.g < f) { ctx.moveTo(p.x + radius, p.y); ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI); } });
      ctx.fillStyle = levelColor(level); ctx.fill();
    }
    ctx.beginPath();
    pos.forEach((p, i) => { if (p.g >= f && born[i] <= f) { ctx.moveTo(p.x + radius, p.y); ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI); } });
    ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.stroke();
    mPos.forEach((m, j) => {
      if (born[N + j] > f) return;
      ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, 2 * Math.PI);
      if (m.c) { ctx.fillStyle = good; ctx.fill(); } else { ctx.strokeStyle = good; ctx.lineWidth = 1.5; ctx.stroke(); }
    });
    ctx.fillStyle = muted; ctx.font = '600 17px "Source Sans 3", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('masters', X(n), M.t + 8);

    // Strip below the graph: integrals left to reduce after each generation, aligned with its column.
    const top = H - STRIP + 22, base = H - M.b;
    const peak = Math.max(...d.frontier.map((x) => x.left));
    ctx.textAlign = 'left'; ctx.font = '400 17px "Source Sans 3", sans-serif'; ctx.fillStyle = muted;
    ctx.fillText(`Integrals left to reduce after each generation (peak ${comma(peak)})`, M.l, top - 8);
    d.frontier.forEach((x, g) => {
      const ht = Math.max((x.left / peak) * (base - top), x.left ? 2 : 0);
      ctx.fillStyle = g < f ? hot : mix(line, surface, 0.45);
      if (g === f - 1) ctx.fillStyle = target;
      ctx.fillRect(X(g) - gap * 0.36, base - ht, gap * 0.72, ht);
    });
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M.l, base + 0.5); ctx.lineTo(W - M.r, base + 0.5); ctx.stroke();
    ctx.fillStyle = muted; ctx.textAlign = 'center';
    for (let g = 0; g < n; g += Math.max(1, Math.round(n / 12))) ctx.fillText(String(g), X(g), base + 22);
    ctx.textAlign = 'left'; ctx.fillText('generation', 0, base + 22);

    const now = f ? d.frontier[f - 1] : { left: 1, masters: 0 };
    const reduced = columns.slice(0, f).reduce((a, c) => a + c.length, 0);
    stats.replaceChildren(
      h('div', { class: 'stat' }, h('b', {}, `${f} / ${n}`), h('span', {}, 'generations reduced')),
      h('div', { class: 'stat' }, h('b', {}, comma(reduced)), h('span', {}, `of ${comma(N)} integrals reduced`)),
      h('div', { class: 'stat' }, h('b', {}, comma(now.left)), h('span', {}, 'integrals left in the expression')),
      h('div', { class: 'stat' }, h('b', {}, String(now.masters)), h('span', {}, 'masters in the expression')),
    );
  }

  function pick(e) {
    const box = canvas.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W, y = ((e.clientY - box.top) / box.height) * H;
    const g = Math.round((x - M.l) / gap - 0.5);
    if (g === n) { const j = mPos.findIndex((m, i) => born[N + i] <= frame && Math.hypot(m.x - x, m.y - y) < 12); return j < 0 ? null : N + j; }
    if (g < 0 || g > n || !columns[g]?.length) return null;
    let best = null, bestD = Math.max(dy, 7) ** 2;
    for (const i of columns[g]) {
      const dist = (pos[i].x - x) ** 2 + (pos[i].y - y) ** 2;
      if (born[i] <= frame && dist < bestD) { bestD = dist; best = i; }
    }
    return best;
  }
  canvas.addEventListener('pointermove', (e) => {
    if (scrolling()) return;
    const i = pick(e);
    over.clearRect(0, 0, W, H);
    if (i == null) return hideTip();
    const p = at(i), hot = css('--target');
    over.beginPath();
    for (const u of into[i]) { over.moveTo(pos[u].x, pos[u].y); over.lineTo(p.x, p.y); }
    if (i < N) for (const v of out[i]) { const q = at(v); over.moveTo(p.x, p.y); over.lineTo(q.x, q.y); }
    over.strokeStyle = hot; over.lineWidth = 1.3; over.stroke();
    over.beginPath(); over.arc(p.x, p.y, Math.max(radius + 2.5, 5), 0, 2 * Math.PI); over.fillStyle = hot; over.fill();
    showTip(e, i < N
      ? `<b>${intStr(p.a)}</b><br>weight (${p.r}, ${p.s}), ${p.level} propagators<br>generation ${p.g}<br>produced by ${into[i].length} integral${into[i].length === 1 ? '' : 's'}, produces ${out[i].length}`
      : `<b>Master ${intStr(p.a)}</b><br>${p.c ? `coefficient ${p.c} in the answer` : 'cancels in the final answer'}<br>reached from ${into[i].length} integrals`);
  });
  canvas.addEventListener('pointerleave', () => { over.clearRect(0, 0, W, H); hideTip(); });

  const ctl = player({ frames: () => n + 1, delay: 700, onFrame: draw, slider, button });
  const paintLegend = () => root.querySelectorAll('[data-level]').forEach((el) => { el.style.background = levelColor(Number(el.dataset.level)); });
  const redraw = () => { cctx.clearRect(0, 0, W, H); cachedTo = 0; paintLegend(); draw(frame); };
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  paintLegend();
  draw(n);
  return ctl;
}
