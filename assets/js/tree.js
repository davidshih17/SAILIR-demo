// Section 7: one complete reduction, replayed job by job.
import { h, section, loadJSON, intStr, player, comma, duration, mlNote } from './ui.js';

export default async function build() {
  const root = section('tree', {
    eyebrow: '7 · Full reduction',
    title: 'Thousands of small, independent jobs',
    lede: 'One job lowers one integral by one weight level. Its result can contain new integrals, and each new integral becomes another job unless it has been solved already. Every worker starts with an empty substitution history, so its memory does not depend on the size of the whole reduction.',
  });
  const d = await loadJSON('reduction');
  const canvas = h('canvas', { width: 1400, height: 560, style: 'width:100%;height:auto;display:block', role: 'img', 'aria-label': 'Timeline of reduction jobs by depth' });
  const slider = h('input', { type: 'range', min: 0, max: 200, value: 200, id: 'tree-slider', 'aria-label': 'Reduction time' });
  const button = h('button', { class: 'btn primary', type: 'button', id: 'tree-play' }, 'Play');
  const stats = h('div', { class: 'stats' });
  root.append(h('div', { class: 'panel stack' },
    h('div', { class: 'row spread' }, h('h3', {}, `Reducing ${intStr(d.integral)} (r=${d.r}, s=${d.s}) to masters`),
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--sailir)' }), 'Finished'), h('span', {}, h('i', { style: 'background:var(--target)' }), 'Running'), h('span', {}, h('i', { style: 'background:var(--line)' }), 'Not started'))),
    h('p', { class: 'note' }, `Each bar is one job, and its row is the job's dependency depth: the number of jobs in the chain that led to its integral. The starting integral has depth 0. An integral first produced by a job at depth d has depth d + 1. This reduction reaches depth ${Math.max(...d.jobs.map((j) => j[0]))}.`),
    canvas, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, button, slider), stats,
    h('p', { class: 'note' }, `Job durations were measured when this reduction was rerun for this page on ${d.procs} CPU cores. The timeline places each job right after the job that discovered it, which is the ideal parallel schedule. The published run of this integral used ${comma(d.published.jobs)} jobs; this rerun used ${comma(d.jobs.length)}.`)),
  mlNote('Why the cache matters', `The same integrals keep reappearing on different branches. In this run, ${comma(d.cache_hits)} lookups found an integral that was already solved, so no job had to run again.`));

  const jobs = d.jobs.map(([depth, start, end, r, s, steps, terms, children, hits]) => ({ depth, start, end, r, s, steps, terms, children, hits }));
  const T = Math.max(...jobs.map((j) => j.end));
  const maxDepth = Math.max(...jobs.map((j) => j.depth));
  const laneEnds = Array.from({ length: maxDepth + 1 }, () => []);
  for (const j of [...jobs].sort((a, b) => a.start - b.start)) {
    const ends = laneEnds[j.depth];
    let lane = ends.findIndex((e) => e <= j.start);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = j.end; j.lane = lane;
  }
  const lanes = laneEnds.map((e) => Math.max(e.length, 1));
  const total = lanes.reduce((a, b) => a + b + 1.5, 0);
  const top = []; let acc = 0;
  lanes.forEach((n, i) => { top[i] = acc; acc += n + 1.5; });

  const ctx = canvas.getContext('2d');
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let frame = 200;
  function draw(f) {
    frame = f;
    const now = (f / 200) * T;
    const W = canvas.width, H = canvas.height, L = 70, R = 14, B = 40, Tp = 8;
    ctx.clearRect(0, 0, W, H);
    const X = (t) => L + (t / T) * (W - L - R), rowH = (H - Tp - B) / total;
    const [done, run, wait, muted] = ['--sailir', '--target', '--line', '--muted'].map(css);
    ctx.font = '20px "Source Sans 3", sans-serif'; ctx.fillStyle = muted; ctx.textAlign = 'right';
    lanes.forEach((n, i) => { if (i % Math.ceil((maxDepth + 1) / 12) === 0) ctx.fillText(String(i), L - 12, Tp + (top[i] + n / 2) * rowH + 7); });
    ctx.textAlign = 'center';
    for (let i = 0; i <= 5; i++) {
      ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
      ctx.fillText(duration((T * i) / 5), X((T * i) / 5), H - 12);
    }
    ctx.textAlign = 'center';
    ctx.save(); ctx.translate(20, (H - B) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('dependency depth', 0, 0); ctx.restore();
    for (const pass of [wait, done, run]) {
      ctx.fillStyle = pass;
      for (const j of jobs) {
        const state = now >= j.end ? done : now >= j.start ? run : wait;
        if (state !== pass) continue;
        ctx.fillRect(X(j.start), Tp + (top[j.depth] + j.lane) * rowH, Math.max(X(j.end) - X(j.start) - 0.5, 1.5), Math.max(rowH * 0.8, 1));
      }
    }
    const started = jobs.filter((j) => now >= j.start), finished = jobs.filter((j) => now >= j.end);
    stats.replaceChildren(
      h('div', { class: 'stat' }, h('b', {}, duration(now)), h('span', {}, 'ideal parallel time')),
      h('div', { class: 'stat' }, h('b', {}, comma(finished.length)), h('span', {}, `of ${comma(jobs.length)} jobs finished`)),
      h('div', { class: 'stat' }, h('b', {}, comma(started.length - finished.length)), h('span', {}, 'jobs running at once')),
      h('div', { class: 'stat' }, h('b', {}, comma(finished.reduce((a, j) => a + j.steps, 0))), h('span', {}, 'identities applied')),
      h('div', { class: 'stat' }, h('b', {}, comma(finished.reduce((a, j) => a + j.hits, 0))), h('span', {}, 'cache hits')),
    );
  }
  player({ frames: () => 201, delay: 60, onFrame: draw, slider, button });
  draw(200);
  new MutationObserver(() => draw(frame)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => draw(frame));
}
