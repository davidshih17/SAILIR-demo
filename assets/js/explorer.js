// Section 3: browse real training-style samples and the model's answers on them.
import { h, section, loadJSON, intStr, pct, comma, barChart, mlNote } from './ui.js';
import { glyph } from './glyph.js';
import { OP_NAMES } from './ibp.js';

const PAGE = 12;

export default async function build() {
  const root = section('data', {
    eyebrow: '3 · Data explorer',
    title: 'What the model actually sees',
    lede: 'These samples come from the published data generator, run on random seeds the model never saw during training. Open any sample to compare the model\'s ranking with the oracle action.',
  });
  const d = await loadJSON('explorer');
  const s = d.summary;
  root.append(h('div', { class: 'panel stack' },
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, comma(s.n)), h('span', {}, `samples from ${comma(s.trajs)} scrambles`)),
      h('div', { class: 'stat' }, h('b', {}, pct(s.top1)), h('span', {}, 'oracle ranked first')),
      h('div', { class: 'stat' }, h('b', {}, pct(s.top5)), h('span', {}, 'oracle in the top 5')),
      h('div', { class: 'stat' }, h('b', {}, String(s.median_actions)), h('span', {}, 'median valid actions'))),
    h('div', { class: 'smalls', style: 'grid-template-columns:repeat(auto-fit,minmax(240px,1fr))' },
      h('div', {}, h('h3', {}, 'Valid actions per sample'), barChart({ bins: s.hist.actions, xLabel: 'number of valid actions' })),
      h('div', {}, h('h3', {}, 'Terms in the expression'), barChart({ bins: s.hist.terms, xLabel: 'terms in the sector' })),
      h('div', {}, h('h3', {}, 'Model accuracy by unscramble step'), barChart({ bins: s.hist.acc_by_step.map((b) => ({ ...b, v: 100 * b.acc })), xLabel: 'unscramble step', yMax: 100, yFormat: (v) => `${v}%`, tipFormat: (b) => `Step ${b.label}: ${pct(b.acc)} of ${comma(b.n)} samples` }))),
  ));

  const level = h('select', { id: 'ex-level', 'aria-label': 'Propagators in the sector' }, h('option', { value: '' }, 'Any sector size'), [...new Set(d.samples.map((x) => x.level))].sort().map((l) => h('option', { value: l }, `${l} propagators`)));
  const result = h('select', { id: 'ex-result', 'aria-label': 'Model result' }, h('option', { value: '' }, 'Right or wrong'), h('option', { value: 'right' }, 'Model ranked oracle first'), h('option', { value: 'wrong' }, 'Model missed the oracle'));
  const tbody = h('tbody');
  const pager = h('div', { class: 'row spread' });
  const detail = h('div', { class: 'stack' });
  root.append(h('div', { class: 'two' },
    h('div', { class: 'panel stack' }, h('div', { class: 'row' }, level, result),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Target', 'Terms', 'Actions', 'Oracle rank'].map((x) => h('th', {}, x)))), tbody)), pager),
    h('div', { class: 'panel' }, detail)),
  mlNote('Why the answer is not always unique', 'Several identities can eliminate the same target. The oracle is simply the one used in the scramble, so a miss in this table is not necessarily a bad reduction step.'));

  let page = 0, sel = null, rows = d.samples;
  function show(x) {
    sel = x;
    const oracleKey = JSON.stringify([x.oracle.op, x.oracle.d]);
    detail.replaceChildren(
      h('div', { class: 'row spread' }, h('div', {}, h('h3', {}, 'Target'), h('div', { class: 'int t' }, intStr(x.target)), h('p', { class: 'note' }, `Weight (${x.w[0]}, ${x.w[1]}), step ${x.step + 1} of its unscramble, ${x.nSubs} earlier substitutions`)), glyph(x.target, { size: 120 })),
      h('h3', {}, 'Expression'),
      h('div', { class: 'terms', style: 'max-height:150px' }, x.expr.map(([a, c]) => h('div', { class: `term${a.join() === x.target.join() ? ' t' : ''}` }, h('span', { class: 'c' }, String(c)), h('span', { class: 'int' }, intStr(a))))),
      h('h3', {}, `Model ranking of ${x.n} valid actions`),
      h('div', { class: 'actions', style: 'max-height:250px' }, x.top.map((a, i) => {
        const isOracle = JSON.stringify([a.op, a.d]) === oracleKey;
        return h('div', { class: `action${isOracle ? ' top' : ''}`, style: 'cursor:default' }, h('span', { class: 'bar', style: `width:${(100 * a.p).toFixed(1)}%` }), h('span', { class: 'rank' }, `#${a.rank ?? i + 1}`),
          h('span', { class: 'what' }, `Op ${a.op}: ${OP_NAMES[a.op]}`, h('small', { class: 'mono' }, `seed ${intStr(x.target.map((v, j) => v + a.d[j]))}`)),
          h('span', { class: 'eff' }, pct(a.p, a.p < 0.01 ? 2 : 1), isOracle ? h('br') : null, isOracle ? 'oracle' : null));
      })),
    );
    renderTable();
  }
  function renderTable() {
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    page = Math.min(page, pages - 1);
    tbody.replaceChildren(...rows.slice(page * PAGE, (page + 1) * PAGE).map((x) => h('tr', { class: `pick${x === sel ? ' sel' : ''}`, tabindex: 0, onclick: () => show(x), onkeydown: (e) => { if (e.key === 'Enter') show(x); } },
      h('td', { class: 'mono' }, intStr(x.target)), h('td', {}, String(x.expr.length)), h('td', {}, String(x.n)), h('td', {}, x.rank === 1 ? '1' : String(x.rank)))));
    pager.replaceChildren(h('span', { class: 'note' }, `${comma(rows.length)} samples, page ${page + 1} of ${pages}`),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: page === 0, onclick: () => { page--; renderTable(); } }, 'Previous'), h('button', { class: 'btn', type: 'button', disabled: page >= pages - 1, onclick: () => { page++; renderTable(); } }, 'Next')));
  }
  const filter = () => {
    rows = d.samples.filter((x) => (!level.value || x.level === Number(level.value)) && (!result.value || (result.value === 'right') === (x.rank === 1)));
    page = 0; renderTable();
    if (rows[0]) show(rows[0]); else detail.replaceChildren(h('p', { class: 'note' }, 'No samples match these filters.'));
  };
  level.addEventListener('change', filter); result.addEventListener('change', filter);
  filter();
}
