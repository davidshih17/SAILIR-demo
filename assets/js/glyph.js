// Draws an integral of the triangle-box family on its Feynman graph.
// The graph follows the propagators of the paper's Eq. (10):
//   vertices A, B, C close the triangle (D1, D4, D3); A, E, F, C close the box (D2, D5, D6, D3).
import { svgEl } from './ui.js';

const V = { A: [50, 10], C: [50, 54], B: [14, 32], E: [96, 10], F: [96, 54] };
const EDGES = [['A', 'B'], ['A', 'E'], ['A', 'C'], ['B', 'C'], ['E', 'F'], ['F', 'C']];
const LEGS = [['B', [2, 32], 'p₁'], ['E', [110, 3], 'p₃'], ['F', [110, 61], 'p₂']];

export function glyph(a, { size = 58, labels = false } = {}) {
  const svg = svgEl('svg', { class: 'glyph', viewBox: labels ? '-8 -6 132 76' : '0 0 112 64', width: size, height: size * (labels ? 76 / 132 : 64 / 112), 'aria-hidden': 'true' });
  for (const [v, [x, y], name] of LEGS) {
    const [px, py] = V[v];
    svg.append(svgEl('line', { x1: px, y1: py, x2: x, y2: y, stroke: 'var(--faint)', 'stroke-width': 2 }));
    if (labels) {
      const t = svgEl('text', { x: x + (x < 20 ? -9 : 4), y: y + 3, fill: 'var(--muted)', 'font-size': 7.5 });
      t.textContent = name; svg.append(t);
    }
  }
  EDGES.forEach(([u, w], i) => {
    const [x1, y1] = V[u], [x2, y2] = V[w], on = a[i] > 0;
    svg.append(svgEl('line', { x1, y1, x2, y2, stroke: on ? 'var(--sailir)' : 'var(--line-strong)', 'stroke-width': on ? 3 : 1.6, 'stroke-dasharray': on ? null : '3 3', 'stroke-linecap': 'round' }));
    for (let d = 1; d < a[i]; d++) {
      const f = d / a[i];
      svg.append(svgEl('circle', { cx: x1 + (x2 - x1) * f, cy: y1 + (y2 - y1) * f, r: 3.6, fill: 'var(--target)', stroke: 'var(--surface)', 'stroke-width': 1 }));
    }
    if (labels) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const off = { 0: [-7, -5], 1: [0, -4], 2: [-9, 2], 3: [-7, 9], 4: [4, 2], 5: [0, 9] }[i];
      const t = svgEl('text', { x: mx + off[0], y: my + off[1], fill: 'var(--ink)', 'font-size': 7.5, 'font-weight': 600 });
      t.textContent = `D${'₁₂₃₄₅₆'[i]}`; svg.append(t);
    }
  });
  return svg;
}
