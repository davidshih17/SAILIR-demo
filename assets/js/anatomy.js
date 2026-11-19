// Section 4: the architecture, explained for physicists, on a real sample.
import { h, svgEl, section, loadJSON, intStr, pct, mlNote } from './ui.js';
import { OP_NAMES } from './ibp.js';

const BLOCKS = {
  actions: [20, 20, 150, 56, 'Actions', 'op + seed'], expr: [205, 20, 165, 56, 'Expression', '{ I[a] : c }'], subs: [405, 20, 165, 56, 'Substitutions', 'key → values'], sector: [605, 20, 135, 56, 'Sector', '6-bit mask'],
  action_emb: [20, 120, 150, 56, 'Action encoder', '256 dim'], expr_t: [205, 120, 165, 56, 'Transformer', '2 layers, 4 heads'], subs_t: [405, 120, 165, 56, 'Transformer', '2 layers, 4 heads'], sector_emb: [605, 120, 135, 56, 'Bit embedding', '256 dim'],
  cross: [20, 245, 300, 60, 'Cross-attention', 'actions ask, expression terms answer'], state: [405, 245, 335, 60, 'Global state h', '[CLS] + [TARGET] + subs + sector'],
  mlp: [205, 360, 330, 56, 'Scoring MLP', 'one number per action'], softmax: [205, 450, 330, 50, 'Softmax', 'probabilities over valid actions'],
};
const LINKS = [['actions', 'action_emb'], ['expr', 'expr_t'], ['subs', 'subs_t'], ['sector', 'sector_emb'], ['action_emb', 'cross'], ['expr_t', 'cross'], ['expr_t', 'state'], ['subs_t', 'state'], ['sector_emb', 'state'], ['cross', 'mlp'], ['state', 'mlp'], ['mlp', 'softmax']];

const STAGES = [
  { name: 'Embed', on: ['actions', 'expr', 'subs', 'sector'], title: 'Turn symbols into vectors',
    body: 'A neural network works on real vectors. Each possible value of each index a<sub>i</sub> gets its own learned vector, and so does each small coefficient. These vectors start random and are tuned during training. For the model an integral is a point in a 256-dimensional space, and integrals that behave alike can end up close together.' },
  { name: 'Transformer', on: ['expr', 'expr_t'], title: 'Let the terms read each other',
    body: 'In self-attention, every term computes a weighted average over all terms, with weights it learns to choose. After two rounds each term\'s vector reflects the rest of the expression. No position information is added, so reordering the terms of the sum changes nothing, which matches the mathematics.' },
  { name: 'Global state', on: ['subs', 'subs_t', 'sector', 'sector_emb', 'expr_t', 'state'], title: 'Summarize the state in one vector',
    body: 'Two extra tokens, [CLS] and [TARGET], travel with the terms and collect a summary. They are joined with encodings of the substitution history and the sector, then compressed into one 256-dimensional vector h.' },
  { name: 'Actions', on: ['actions', 'action_emb'], title: 'Encode each candidate identity',
    body: 'The number of valid identities changes at every step, from a few to hundreds. A fixed output layer cannot handle that. So each candidate goes in as an input, described by its template and its seed relative to the target. This design comes from learning-to-rank systems such as search engines.' },
  { name: 'Cross-attention', on: ['action_emb', 'expr_t', 'cross'], title: 'Each action inspects the expression',
    body: 'Each candidate action asks which terms of the expression matter to it. The result is one row of the heat map below. Bright cells mark the terms that action attends to most.' },
  { name: 'Score', on: ['cross', 'state', 'mlp', 'softmax'], title: 'Rank the candidates',
    body: 'A small network combines each attended action with h to give a single score. Softmax converts the scores into probabilities that add up to 1 over the valid actions. Training pushes the oracle action\'s probability up.' },
];

const center = ([x, y, w, ht]) => ({ x: x + w / 2, top: y, bottom: y + ht });

export default async function build() {
  const root = section('model', {
    eyebrow: '4 · The model',
    title: 'Inside the action classifier',
    lede: 'A 7.7-million-parameter transformer takes the current state and every valid identity, and returns one probability per identity. Step through it below, using a real sample and the real attention weights.',
  });
  const data = await loadJSON('anatomy');
  const svg = svgEl('svg', { class: 'arch', viewBox: '0 0 760 510', role: 'img', 'aria-label': 'Architecture of the action classifier' });
  const paths = LINKS.map(([a, b]) => {
    const p = center(BLOCKS[a]), q = center(BLOCKS[b]), my = (p.bottom + q.top) / 2;
    const node = svgEl('path', { d: `M${p.x},${p.bottom} C${p.x},${my} ${q.x},${my} ${q.x},${q.top}`, 'data-a': a, 'data-b': b });
    svg.append(node); return node;
  });
  const blocks = Object.entries(BLOCKS).map(([id, [x, y, w, ht, label, sub]]) => {
    const g = svgEl('g', { class: 'blk', 'data-id': id });
    g.append(svgEl('rect', { x, y, width: w, height: ht, rx: 5 }));
    const t = svgEl('text', { x: x + w / 2, y: y + ht / 2 - 3 }); t.textContent = label;
    const d = svgEl('text', { x: x + w / 2, y: y + ht / 2 + 14, class: 'd' }); d.textContent = sub;
    g.append(t, d); svg.append(g); return g;
  });

  const nav = h('div', { class: 'steps-nav', role: 'tablist' });
  const title = h('h3');
  const body = h('p', {});
  const prev = h('button', { class: 'btn', type: 'button', id: 'model-prev' }, 'Previous');
  const next = h('button', { class: 'btn primary', type: 'button', id: 'model-next' }, 'Next');
  const pick = h('select', { id: 'model-sample', 'aria-label': 'Sample' }, data.samples.map((s, i) => h('option', { value: i }, `${intStr(s.target)}, ${s.n} valid actions`)));
  const heat = h('div', { class: 'heat' });
  const cap = h('p', { class: 'note' });
  root.append(h('div', { class: 'two' },
    h('div', { class: 'panel' }, svg),
    h('div', { class: 'stack' },
      h('div', { class: 'panel stack' }, nav, title, body, h('div', { class: 'row' }, prev, next)),
      mlNote('Size of the model', 'About 7.7 million numbers are learned, trained on about a million examples. This is small by the standards of modern language models, and it runs on one CPU core in tens of milliseconds per state.'))),
  h('div', { class: 'panel stack' }, h('div', { class: 'row spread' }, h('h3', {}, 'Where each action looks: real attention weights'), pick), heat, cap));

  let stage = 0;
  function showStage(i) {
    stage = i;
    const s = STAGES[i];
    [...nav.children].forEach((b, j) => b.classList.toggle('on', j === i));
    title.textContent = s.title; body.innerHTML = s.body;
    blocks.forEach((g) => g.classList.toggle('on', s.on.includes(g.dataset.id)));
    paths.forEach((p) => p.classList.toggle('on', s.on.includes(p.dataset.a) && s.on.includes(p.dataset.b)));
    prev.disabled = i === 0; next.disabled = i === STAGES.length - 1;
  }
  STAGES.forEach((s, i) => nav.append(h('button', { type: 'button', onclick: () => showStage(i) }, s.name)));
  prev.addEventListener('click', () => showStage(stage - 1));
  next.addEventListener('click', () => showStage(stage + 1));

  function showSample(i) {
    const s = data.samples[i];
    const T = s.expr.length;
    const maxA = Math.max(...s.actions.flatMap((a) => a.attn));
    heat.style.gridTemplateColumns = `minmax(190px,auto) repeat(${T}, minmax(26px, 1fr)) 60px`;
    const cells = [h('span'), ...s.expr.map(([a, c]) => h('span', { class: 'col', title: `${c} · ${intStr(a)}`, style: a.join() === s.target.join() ? 'color:var(--target);font-weight:600' : '' }, a.join(','))), h('span', { class: 'lab', style: 'align-self:end' }, 'prob.')];
    for (const a of s.actions) {
      cells.push(h('span', { class: 'lab', title: OP_NAMES[a.op] }, `${a.oracle ? '★ ' : ''}Op ${a.op} · [${a.d.join(',')}]`));
      a.attn.forEach((v, j) => cells.push(h('span', { class: 'cell', title: `${(100 * v).toFixed(1)}% attention on ${intStr(s.expr[j][0])}`, style: `background:color-mix(in oklab, var(--sailir) ${Math.round((v / maxA) * 100)}%, var(--surface-2))` })));
      cells.push(h('span', { class: 'lab', style: 'text-align:right' }, pct(a.p, a.p < 0.01 ? 2 : 0)));
    }
    heat.replaceChildren(...cells);
    cap.textContent = `Rows are the model's top-ranked actions, with ★ marking the oracle. Columns are the ${T} terms of the expression, and the target's column label is highlighted. Each cell is the attention weight from the final cross-attention layer, averaged over its 4 heads.`;
  }
  pick.addEventListener('change', () => showSample(Number(pick.value)));
  showStage(0); showSample(0);
}
