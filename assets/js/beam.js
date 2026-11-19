// Section 6: a recorded beam search over one real reduction episode.
import { h, section, loadJSON, intStr, player, scrolling, showTip, hideTip, duration, mlNote } from './ui.js';

const WIDTH = 1000, HEIGHT = 400, M = { l: 44, r: 16, t: 16, b: 30 };

export default async function build() {
  const root = section('beam', {
    eyebrow: '6 · Search',
    title: 'Beam search keeps several reductions alive',
    lede: 'The paper finds that always taking the top-ranked action is not enough for high-weight integrals. So SAILIR keeps the best K partial reductions at each step, expands each with its top-ranked actions, and stops as soon as the highest weight drops.',
  });
  const data = await loadJSON('beam');
  const chips = h('div', { class: 'row' });
  const canvas = h('canvas', { style: `width:100%;height:auto;aspect-ratio:${WIDTH}/${HEIGHT};display:block`, role: 'img', 'aria-label': 'Beam search tree: one column of beam states per search step' });
  const ctx = canvas.getContext('2d');
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = WIDTH * scale; canvas.height = HEIGHT * scale;
  const slider = h('input', { type: 'range', min: 0, value: 0, id: 'beam-slider', 'aria-label': 'Beam search step' });
  const button = h('button', { class: 'btn primary', type: 'button', id: 'beam-play' }, 'Play');
  const stats = h('div', { class: 'stats' });
  const outcome = h('p', { class: 'note' });
  root.append(h('div', { class: 'panel stack' },
    h('div', { class: 'row spread' }, h('div', { class: 'row' }, h('span', { class: 'note' }, `Episode for ${intStr(data.integral)}, beam width K:`), chips),
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--sailir)' }), 'Path that succeeded'), h('span', {}, h('i', { style: 'background:var(--line-strong)' }), 'Other beam states'))),
    canvas, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, button, slider), stats, outcome),
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
  let shown = 0;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function draw(f) {
    shown = f;
    const [hot, cold, dot, muted, surface] = ['--sailir', '--line-strong', '--faint', '--muted', '--surface'].map(css);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const root0 = { x: M.l, y: M.t + (HEIGHT - M.t - M.b) / 2 };
    ctx.fillStyle = muted; ctx.font = '12px "Source Sans 3", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('search step', (M.l + WIDTH - M.r) / 2, HEIGHT - 6);
    ctx.save(); ctx.translate(14, HEIGHT / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('rank in beam', 0, 0); ctx.restore();
    const parentOf = (i, s) => (i === 0 ? root0 : frames[i].restart || s.parent < 0 ? null : pos[i - 1][s.parent]);
    const stroke = (chosen, color, width) => {
      ctx.beginPath();
      for (let i = 0; i <= f && i < frames.length; i++) {
        frames[i].states.forEach((s, j) => {
          const q = parentOf(i, s);
          if (q && s.chosen === chosen) { ctx.moveTo(q.x, q.y); ctx.lineTo(pos[i][j].x, pos[i][j].y); }
        });
      }
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    };
    stroke(false, cold, 0.8);
    stroke(true, hot, 2.6);
    for (const chosen of [false, true]) {
      ctx.beginPath();
      for (let i = 0; i <= f && i < frames.length; i++) {
        frames[i].states.forEach((s, j) => {
          if (s.chosen !== chosen) return;
          const r = chosen ? 5 : 3;
          ctx.moveTo(pos[i][j].x + r, pos[i][j].y); ctx.arc(pos[i][j].x, pos[i][j].y, r, 0, 2 * Math.PI);
        });
      }
      ctx.fillStyle = chosen ? hot : dot; ctx.strokeStyle = surface; ctx.lineWidth = 1; ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = cold; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= f && i < frames.length; i++) if (frames[i].restart) { ctx.moveTo(pos[i][0].x - 6, M.t); ctx.lineTo(pos[i][0].x - 6, HEIGHT - M.b); }
    ctx.stroke();
    const fr = frames[f];
    const best = fr ? fr.states.reduce((a, b) => (b.w[0] < a.w[0] || (b.w[0] === a.w[0] && b.w[1] < a.w[1]) ? b : a)) : null;
    stats.replaceChildren(
      h('div', { class: 'stat' }, h('b', {}, `${f + 1} / ${frames.length}`), h('span', {}, 'search step')),
      h('div', { class: 'stat' }, h('b', {}, String(fr?.states.length ?? 0)), h('span', {}, 'states kept')),
      h('div', { class: 'stat' }, h('b', {}, String(fr?.cands ?? 0)), h('span', {}, 'candidates built this step')),
      h('div', { class: 'stat' }, h('b', {}, best ? `(${best.w[0]}, ${best.w[1]})` : '–'), h('span', {}, 'best highest weight')),
    );
  }
  canvas.addEventListener('pointermove', (e) => {
    if (scrolling()) return;
    const box = canvas.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * WIDTH, y = ((e.clientY - box.top) / box.height) * HEIGHT;
    let best = null, bestD = 100;
    for (let i = 0; i <= shown && i < frames.length; i++) {
      if (Math.abs(pos[i][0].x - x) > 12) continue;
      frames[i].states.forEach((s, j) => { const d = (pos[i][j].x - x) ** 2 + (pos[i][j].y - y) ** 2; if (d < bestD) { bestD = d; best = { i, j, s }; } });
    }
    if (!best) return hideTip();
    const { i, j, s } = best;
    showTip(e, `<b>Step ${i + 1}</b>, rank ${j + 1}<br>eliminated ${intStr(s.target)} with Op ${s.op}<br>model probability ${(100 * s.prob).toFixed(1)}%<br>highest weight (${s.w[0]}, ${s.w[1]}), ${s.nm} left`);
  });
  canvas.addEventListener('pointerleave', hideTip);
  const ctl = player({ frames: () => frames.length, delay: 420, onFrame: draw, slider, button });
  new MutationObserver(() => draw(shown)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => draw(shown));
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
