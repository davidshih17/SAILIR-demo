// Section 8: the benchmark against Kira, from the published CSV files.
import { h, section, loadJSON, lineChart, comma, fmt, duration } from './ui.js';

const METRICS = {
  memory: { label: 'Peak memory', axis: 'Peak memory', sailir: (r) => r.sailir.mem_mb, kira: (r) => r.kira.mem_mb,
    format: (v) => (v >= 1000 ? `${fmt(v / 1000, v >= 10000 ? 0 : 1)} GB` : `${Math.round(v)} MB`) },
  ideal: { label: 'Time: ideal parallel', axis: 'Time', sailir: (r) => r.sailir.ideal_s, kira: (r) => r.kira.time_s, format: duration },
  wall: { label: 'Time: measured wall clock', axis: 'Time', sailir: (r) => r.sailir.wall_s, kira: (r) => r.kira.time_s, format: duration },
};
const NOTES = {
  memory: 'SAILIR values are peak memory per worker, per CPU. Kira values are the peak of the whole run. Workers rerun as stragglers used 8 CPUs, so their total was higher, up to 8.6 GB at r=12, s=7.',
  ideal: 'Ideal parallel time is the longest chain of dependent jobs, assuming unlimited workers and no scheduling delay. It is the time quoted in the paper.',
  wall: 'Wall clock is what the run took on a shared HTCondor cluster with about 330 slots, including queueing and a 5-second polling loop.',
};

export default async function build() {
  const root = section('results', {
    eyebrow: '8 · Results',
    title: 'SAILIR and Kira on 16 integrals',
    lede: 'Kira\'s memory grows with the size of its linear system. SAILIR\'s memory per worker barely moves. Kira is still faster on every integral here, and the gap closes as the integrals get harder.',
  });
  const data = await loadJSON('benchmarks');
  const rows = data.rows.filter((r) => r.in_paper);
  const rs = [10, 11, 12, 13], ss = [4, 5, 6, 7];
  let metric = 'memory', showTable = false;

  const chips = h('div', { class: 'row' });
  const charts = h('div', { class: 'smalls' });
  const summary = h('div', { class: 'stats' });
  const note = h('p', { class: 'note' });
  const table = h('div', { class: 'table-wrap', hidden: true });
  const tableBtn = h('button', { class: 'btn', type: 'button', id: 'results-table' }, 'Show the numbers');
  root.append(h('div', { class: 'panel stack' }, h('div', { class: 'row spread' }, chips,
    h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--sailir)' }), 'SAILIR'), h('span', {}, h('i', { style: 'background:var(--kira)' }), 'Kira 3.1'))),
  charts, summary, note, h('div', {}, tableBtn), table));

  const at = (r, s) => rows.find((x) => x.r === r && x.s === s);
  function render() {
    const M = METRICS[metric];
    [...chips.children].forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.m === metric)));
    const vals = rows.flatMap((r) => [M.sailir(r), M.kira(r)]);
    const domain = [Math.min(...vals), Math.max(...vals)];
    charts.replaceChildren(...rs.map((r) => {
      const pts = ss.map((s) => at(r, s));
      return h('div', {}, h('h3', {}, `r = ${r}`), lineChart({
        width: 300, height: 250, x: ss, log: true, yDomain: domain, xLabel: 'numerator power s', yLabel: M.axis, yFormat: M.format,
        series: [{ name: 'SAILIR', color: 'var(--sailir)', values: pts.map(M.sailir), dots: true }, { name: 'Kira', color: 'var(--kira)', values: pts.map(M.kira), dots: true }],
        tipFormat: (i) => `<b>r=${r}, s=${ss[i]}</b><br>SAILIR ${M.format(M.sailir(pts[i]))}<br>Kira ${M.format(M.kira(pts[i]))}<br>SAILIR / Kira = ${fmt(M.sailir(pts[i]) / M.kira(pts[i]), 2)}`,
      }));
    }));
    summary.replaceChildren(...rs.map((r) => {
      const p = at(r, 7);
      return h('div', { class: 'stat' }, h('b', {}, `${fmt(M.sailir(p) / M.kira(p), 2)}×`), h('span', {}, `SAILIR / Kira at r=${r}, s=7`));
    }));
    note.textContent = NOTES[metric];
    table.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, ['r', 's', 'Integral', 'SAILIR memory', 'Kira memory', 'SAILIR ideal', 'SAILIR wall', 'Kira time', 'Jobs', 'Kira equations'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((x) => h('tr', {}, [x.r, x.s, `I[${x.integral.join(',')}]`, METRICS.memory.format(x.sailir.mem_mb), METRICS.memory.format(x.kira.mem_mb), duration(x.sailir.ideal_s), duration(x.sailir.wall_s), duration(x.kira.time_s), comma(x.sailir.jobs), comma(x.kira.equations)].map((t) => h('td', {}, String(t))))))));
  }
  for (const [k, m] of Object.entries(METRICS)) chips.append(h('button', { class: 'chip', type: 'button', 'data-m': k, onclick: () => { metric = k; render(); } }, m.label));
  tableBtn.addEventListener('click', () => { showTable = !showTable; table.hidden = !showTable; tableBtn.textContent = showTable ? 'Hide the numbers' : 'Show the numbers'; });
  render();
}
