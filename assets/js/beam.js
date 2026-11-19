// Section 6: a recorded beam search over one real reduction episode.
import { h, svgEl, section, loadJSON, intStr, player, tip, duration, mlNote } from './ui.js';

const WIDTH = 1000, HEIGHT = 400, M = { l: 44, r: 16, t: 16, b: 30 };

export default async function build() {
  const root = section('beam', {
    eyebrow: '6 · Search',
    title: 'Beam search keeps several reductions alive',
    lede: 'The paper finds that always taking the top-ranked action is not enough for high-weight integrals. So SAILIR keeps the best K partial reductions at each step, expands each with its top-ranked actions, and stops as soon as the highest weight drops.',
  });
  const data = await loadJSON('beam');
  const chips = h('div', { class: 'row' });
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': 'Beam search tree' });
  const slider = h('input', { type: 'range', min: 0, value: 0, id: 'beam-slider', 'aria-label': 'Beam search step' });
  const button = h('button', { class: 'btn primary', type: 'button', id: 'beam-play' }, 'Play');
  const stats = h('div', { class: 'stats' });
  const outcome = h('p', { class: 'note' });
  root.append(h('div', { class: 'panel stack' },
    h('div', { class: 'row spread' }, h('div', { class: 'row' }, h('span', { class: 'note' }, `Episode for ${intStr(data.integral)}, beam width K:`), chips),
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--sailir)' }), 'Path that succeeded'), h('span', {}, h('i', { style: 'background:var(--line-strong)' }), 'Other beam states'))),
    svg, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, button, slider), stats, outcome),
  mlNote('Why the beam has up to 2K states', 'SAILIR runs two beams of width K side by side. One ranks states by their highest remaining weight, the other by the total weight of all remaining integrals. Vertical position in this plot is rank within the step, best at the top.'));

  let run, frames, pos;
  function layout() {
    frames = run.frames;
    const n = Math.max(frames.length, 2);
    const yMax = Math.max(...frames.map((f) => f.states.length));
    pos = frames.map((f, i) => f.states.map((_, j) => ({
      x: M.l + ((i + 1) / n) * (WIDTH - M.l - M.r),
      y: M.t + (yMax > 1 ? (j / (yMax - 1)) * (HEIGHT - M.t - M.b) : (HEIGHT - M.t - M.b) / 2),
    })));
    slider.max = Math.max(frames.length - 1, 0);
  }
  function draw(f) {
    svg.replaceChildren();
    const root0 = { x: M.l, y: M.t + (HEIGHT - M.t - M.b) / 2 };
    const axis = svgEl('text', { x: (M.l + WIDTH - M.r) / 2, y: HEIGHT - 6, 'text-anchor': 'middle' }); axis.textContent = 'search step'; svg.append(axis);
    const yl = svgEl('text', { x: 12, y: HEIGHT / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${HEIGHT / 2})` }); yl.textContent = 'rank in beam'; svg.append(yl);
    const lines = svgEl('g'), hot = svgEl('g'), dots = svgEl('g');
    svg.append(lines, hot, dots);
    for (let i = 0; i <= f && i < frames.length; i++) {
      frames[i].states.forEach((s, j) => {
        const p = pos[i][j];
        const q = s.parent < 0 || i === 0 || frames[i].restart ? (i === 0 ? root0 : null) : pos[i - 1][s.parent];
        if (q) (s.chosen ? hot : lines).append(svgEl('line', { x1: q.x, y1: q.y, x2: p.x, y2: p.y, stroke: s.chosen ? 'var(--sailir)' : 'var(--line-strong)', 'stroke-width': s.chosen ? 2.6 : 0.8 }));
        const c = svgEl('circle', { cx: p.x, cy: p.y, r: s.chosen ? 5 : 3, fill: s.chosen ? 'var(--sailir)' : 'var(--faint)', stroke: 'var(--surface)', 'stroke-width': 1 });
        tip(c, () => `<b>Step ${i + 1}</b>, rank ${j + 1}<br>eliminated ${intStr(s.target)} with Op ${s.op}<br>model probability ${(100 * s.prob).toFixed(1)}%<br>highest weight (${s.w[0]}, ${s.w[1]}), ${s.nm} left`);
        dots.append(c);
      });
      if (frames[i].restart) svg.append(svgEl('line', { x1: pos[i][0].x - 6, x2: pos[i][0].x - 6, y1: M.t, y2: HEIGHT - M.b, stroke: 'var(--line-strong)', 'stroke-width': 1 }));
    }
    const fr = frames[f];
    const best = fr ? fr.states.reduce((a, b) => (b.w[0] < a.w[0] || (b.w[0] === a.w[0] && b.w[1] < a.w[1]) ? b : a)) : null;
    stats.replaceChildren(
      h('div', { class: 'stat' }, h('b', {}, `${f + 1} / ${frames.length}`), h('span', {}, 'search step')),
      h('div', { class: 'stat' }, h('b', {}, String(fr?.states.length ?? 0)), h('span', {}, 'states kept')),
      h('div', { class: 'stat' }, h('b', {}, String(fr?.cands ?? 0)), h('span', {}, 'candidates built this step')),
      h('div', { class: 'stat' }, h('b', {}, best ? `(${best.w[0]}, ${best.w[1]})` : '–'), h('span', {}, 'best highest weight')),
    );
  }
  const ctl = player({ frames: () => frames.length, delay: 420, onFrame: draw, slider, button });
  function choose(k) {
    ctl.stop();
    run = data.runs[k];
    [...chips.children].forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.k === k)));
    layout();
    const all = Object.entries(data.runs);
    const summary = all.map(([K, r]) => (r.success ? `K=${K}: ${r.steps} steps` : `K=${K}: no success`)).join(', ');
    outcome.textContent = `${run.success
      ? `With K=${k} the episode lowered the highest weight after ${run.steps} steps, in ${duration(run.time)} on one CPU core.`
      : `With K=${k} the search did not lower the highest weight within ${data.max_steps} steps.`} Length of the accepted path for this integral: ${summary}.${all.every(([, r]) => r.success) ? ' This integral is small enough that every width succeeds.' : ''}`;
    ctl.show(frames.length - 1);
  }
  for (const k of Object.keys(data.runs)) chips.append(h('button', { class: 'chip', type: 'button', 'data-k': k, onclick: () => choose(k) }, `K=${k}`));
  choose(data.default_k);
}
