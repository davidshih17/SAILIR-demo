// Section 2: how training data is made, replayed from real scrambles.
import { h, svgEl, section, loadJSON, intStr, player, mlNote, tip } from './ui.js';
import { OP_NAMES, key } from './ibp.js';

const W = 560, H = 380, M = { l: 46, r: 12, t: 12, b: 40 };

export default async function build() {
  const root = section('scramble', {
    eyebrow: '2 · Training data',
    title: 'Labels for free: scramble, then unscramble',
    lede: 'Start from the simplest integrals of a sector. Apply random IBP identities to build a complicated expression that is still equal to the starting point. Then undo the scramble, always eliminating the highest-weight integral first. Every undo step is a labeled example, and no reduction program is needed.',
  });
  const data = await loadJSON('scrambles');
  const pick = h('select', { id: 'scramble-pick', 'aria-label': 'Trajectory' });
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Integrals in the expression by weight' });
  const slider = h('input', { type: 'range', min: 0, value: 0, id: 'scramble-slider', 'aria-label': 'Step' });
  const button = h('button', { class: 'btn primary', type: 'button', id: 'scramble-play' }, 'Play');
  const phase = h('div', { class: 'eyebrow' });
  const title = h('h3');
  const detail = h('p', { class: 'note' });
  const stats = h('div', { class: 'stats' });
  const ledger = h('div', { class: 'stack' });
  const eq = h('div', { class: 'ml' });
  root.append(h('div', { class: 'two wide-left' },
    h('div', { class: 'panel stack' }, h('div', { class: 'row spread' }, h('h3', {}, 'Integrals in the expression, by weight'), pick), svg,
      h('div', { class: 'row', style: 'flex-wrap:nowrap' }, button, slider)),
    h('div', { class: 'stack' },
      h('div', { class: 'panel stack' }, phase, title, detail, stats),
      h('div', { class: 'panel stack' }, h('h3', {}, 'Labeled samples collected'), ledger),
      eq)));
  try { window.katex.render('E_N = M + \\sum_{i=1}^{N} \\alpha_i R_i, \\qquad R_i \\equiv 0', eq); } catch { eq.textContent = 'E_N = M + Σ αᵢ Rᵢ, with every Rᵢ = 0'; }
  eq.append(h('p', { class: 'note', style: 'margin-top:6px' }, 'The identities are linear, so they can be undone in any order. Undoing them in weight order makes the training examples look like a real reduction.'));

  let t, frames, prev = new Set(), rMax, rMin, sMax;
  data.trajs.forEach((x, i) => pick.append(h('option', { value: i }, `Sector ${x.sector}: ${x.n_scramble} scramble steps`)));

  function draw(f) {
    const fr = frames[f];
    svg.replaceChildren();
    const nr = rMax - rMin + 1, ns = sMax + 1;
    const cw = (W - M.l - M.r) / ns, ch = (H - M.t - M.b) / nr;
    const X = (s) => M.l + s * cw, Y = (r) => H - M.b - (r - rMin + 1) * ch;
    for (let s = 0; s <= sMax; s++) {
      for (let r = rMin; r <= rMax; r++) svg.append(svgEl('rect', { x: X(s) + 1, y: Y(r) + 1, width: cw - 2, height: ch - 2, fill: 'var(--surface-2)', rx: 3 }));
      const l = svgEl('text', { x: X(s) + cw / 2, y: H - M.b + 15, 'text-anchor': 'middle' }); l.textContent = s; svg.append(l);
    }
    for (let r = rMin; r <= rMax; r++) { const l = svgEl('text', { x: M.l - 8, y: Y(r) + ch / 2 + 4, 'text-anchor': 'end' }); l.textContent = r; svg.append(l); }
    const xl = svgEl('text', { x: (M.l + W - M.r) / 2, y: H - 5, 'text-anchor': 'middle' }); xl.textContent = 'numerator power s'; svg.append(xl);
    const yl = svgEl('text', { x: 12, y: H / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${H / 2})` }); yl.textContent = 'denominator power r'; svg.append(yl);
    const cells = new Map();
    for (const [a, c] of fr.expr) {
      const r = a.reduce((x, v) => x + Math.max(v, 0), 0), s = a.reduce((x, v) => x + Math.max(-v, 0), 0), k = `${r}|${s}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push({ a, c, r, s });
    }
    const now = new Set();
    for (const items of cells.values()) {
      const cols = Math.ceil(Math.sqrt(items.length));
      const step = Math.min((cw - 8) / cols, (ch - 8) / Math.ceil(items.length / cols), 20);
      items.forEach((it, i) => {
        const k = key(it.a); now.add(k);
        const cx = X(it.s) + cw / 2 + ((i % cols) - (cols - 1) / 2) * step;
        const cy = Y(it.r) + ch / 2 + (Math.floor(i / cols) - (Math.ceil(items.length / cols) - 1) / 2) * step;
        const isT = fr.target && k === key(fr.target);
        const c = svgEl('circle', { cx, cy, r: Math.max(Math.min(step * 0.42, 8), 2.5), fill: isT ? 'var(--target)' : 'var(--sailir)', class: prev.has(k) ? '' : 'pop' });
        tip(c, () => `${it.c} · ${intStr(it.a)}<br>weight (${it.r}, ${it.s})`);
        svg.append(c);
      });
    }
    prev = now;
    const labels = { start: 'Start', scramble: 'Scramble', unscramble: 'Unscramble', done: 'Recovered' };
    phase.textContent = labels[fr.phase];
    if (fr.phase === 'start') { title.textContent = 'The simplest integrals of the sector, with random coefficients'; detail.textContent = `Sector ${t.sector}. This is the answer the unscramble must recover.`; }
    if (fr.phase === 'scramble') { title.textContent = `Apply Op ${fr.op}: ${OP_NAMES[fr.op]}`; detail.textContent = `Seed ${intStr(fr.seed)}. The identity is solved for ${intStr(fr.elim)}, and the solution replaces that integral.`; }
    if (fr.phase === 'unscramble') { title.textContent = `Eliminate ${intStr(fr.target)}`; detail.textContent = `The recorded answer is Op ${fr.oracle.op}, chosen from ${fr.nValid} valid identities. The model ranks that identity number ${fr.rank}, with probability ${(100 * fr.prob).toFixed(0)}%.`; }
    if (fr.phase === 'done') { title.textContent = 'Back to the starting expression'; detail.textContent = 'The expression matches the starting point exactly, so every recorded step is verified.'; }
    stats.replaceChildren(
      h('div', { class: 'stat' }, h('b', {}, String(fr.expr.length)), h('span', {}, 'integrals in this sector')),
      h('div', { class: 'stat' }, h('b', {}, fr.lower == null ? '–' : String(fr.lower)), h('span', {}, 'in subsectors')),
      h('div', { class: 'stat' }, h('b', {}, `${f + 1} / ${frames.length}`), h('span', {}, 'frame')),
    );
    const got = frames.slice(0, f + 1).filter((x) => x.phase === 'unscramble');
    ledger.replaceChildren(got.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Target (input)', 'Oracle (label)', 'Choices'].map((x) => h('th', {}, x)))),
      h('tbody', {}, got.slice(-5).map((x) => h('tr', {}, h('td', { class: 'mono' }, intStr(x.target)), h('td', {}, `Op ${x.oracle.op}`), h('td', {}, String(x.nValid)))))))
      : h('p', { class: 'note' }, 'Samples appear once the unscramble starts.'),
    h('p', { class: 'note' }, `${got.length} of ${frames.filter((x) => x.phase === 'unscramble').length} samples from this trajectory. The published training set has about 1.06 million.`));
  }
  const ctl = player({ frames: () => frames.length, delay: (f) => (frames[f].phase === 'unscramble' ? 800 : 560), onFrame: draw, slider, button });
  function choose(i) {
    ctl.stop();
    t = data.trajs[i]; frames = t.frames; prev = new Set();
    const all = frames.flatMap((f) => f.expr.map(([a]) => a));
    const rs = all.map((a) => a.reduce((x, v) => x + Math.max(v, 0), 0));
    rMin = Math.min(...rs); rMax = Math.max(...rs);
    sMax = Math.max(...all.map((a) => a.reduce((x, v) => x + Math.max(-v, 0), 0)));
    slider.max = frames.length - 1;
    ctl.show(0);
  }
  pick.addEventListener('change', () => choose(Number(pick.value)));
  choose(0);
}
