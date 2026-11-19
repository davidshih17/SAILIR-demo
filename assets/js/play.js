// Section 1: reduce an integral by hand, with the real IBP identities and the real model.
import { $, h, section, loadJSON, intStr, pct, mlNote } from './ui.js';
import { glyph } from './glyph.js';
import { IBP, OP_NAMES, initialState, isMaster, inSector, key, nonMasters, parse, pickTarget, sectorOf, weight } from './ibp.js';
import { loadModel, scoreActions } from './model.js';

const wStr = (w) => `(${w[0]}, ${w[1]})`;
const maxW = (list) => list.map(weight).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0] ?? null;

export default async function build() {
  const root = section('play', {
    eyebrow: '1 · The task',
    title: 'Reduce an integral yourself',
    lede: 'Each step picks one IBP or Lorentz-invariance identity and uses it to eliminate the highest-weight integral left in the sector. Choose the identities yourself, then compare your choices with the trained model running live in this browser.',
  });
  const [templates, play] = await Promise.all([loadJSON('templates'), loadJSON('play')]);
  const ibp = new IBP(templates);

  const startRow = h('div', { class: 'row' });
  const status = h('div', { class: 'stats' });
  const exprBox = h('div', { class: 'terms' });
  const lowerNote = h('p', { class: 'note' });
  const glyphBox = h('div');
  const targetLine = h('div', { class: 'stack' });
  const equation = h('div', { class: 'equation' }, 'Hover over an identity to see the equation it gives.');
  const list = h('div', { class: 'actions' });
  const banner = h('div', { class: 'banner', hidden: true });
  const bar = h('i');
  const modelStatus = h('p', { class: 'note' }, 'Preparing the model (31 MB, downloaded once)…');
  const progress = h('div', { class: 'progress' }, bar);
  const revealBtn = h('button', { class: 'btn', type: 'button', id: 'play-reveal' }, 'Show the model\'s ranking');
  const autoBtn = h('button', { class: 'btn primary', type: 'button', id: 'play-auto' }, 'Let the model finish');
  const undoBtn = h('button', { class: 'btn', type: 'button', id: 'play-undo' }, 'Undo');
  const resetBtn = h('button', { class: 'btn', type: 'button', id: 'play-reset' }, 'Restart');

  root.append(
    h('div', { class: 'row' }, h('span', { class: 'note' }, 'Start from:'), startRow),
    h('div', { class: 'two wide-right' },
      h('div', { class: 'stack' },
        h('div', { class: 'panel stack' },
          h('div', { class: 'row spread' }, h('h3', {}, 'Current expression'), glyphBox),
          status, targetLine, exprBox, lowerNote),
        mlNote('In machine-learning terms', 'The <b>state</b> is the expression plus the substitutions made so far. An <b>action</b> is an identity and a seed. A <b>policy</b> is a rule that assigns a probability to every valid action. SAILIR\'s policy is a neural network.')),
      h('div', { class: 'panel stack' },
        h('div', { class: 'row spread' }, h('h3', { id: 'play-count' }, 'Valid identities'), h('div', { class: 'row' }, revealBtn, autoBtn, undoBtn, resetBtn)),
        progress, modelStatus, list, equation)),
  );

  let start, st, history, reveal = false, busy = false, scored = null, token = 0, modelReady = false, showAll = false, lastScroll = 0;
  addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
  const startInfo = () => play.starts.find((s) => key(s.integral) === key(start));

  loadModel((f) => { bar.style.width = `${Math.round(f * 100)}%`; }).then(() => {
    modelReady = true; progress.style.visibility = 'hidden'; modelStatus.textContent = 'Model ready. It runs on this device.';
    render();
  }).catch((err) => {
    console.error(err); progress.style.visibility = 'hidden';
    modelStatus.textContent = 'The model could not start in this browser. You can still play with the identities.';
    revealBtn.disabled = true; autoBtn.disabled = true;
  });

  function effect(target, action) {
    const next = ibp.apply(st, target, action);
    if (!next) return null;
    const left = nonMasters(next.expr, sectorOf(start));
    return { left: left.length, w: maxW(left) };
  }

  function showEquation(target, action) {
    const { seed, cached } = ibp.equation(st, target, action);
    const tk = key(target);
    const entries = [...cached];
    const shown = entries.filter(([k], i) => i < 12 || k === tk);
    const more = entries.length - shown.length;
    equation.replaceChildren(
      h('div', { class: 'note' }, `Op ${action.op} (${OP_NAMES[action.op]}) at seed ${intStr(seed)}, after earlier substitutions:`),
      h('div', {}, shown.flatMap(([k, c], i) => [i ? ' + ' : '', h('span', { class: k === tk ? 't' : '' }, `${c}·I[${k}]`)]), more ? ` + ${more} more term${more === 1 ? "" : "s"}` : '', ' = 0 (mod 1009)'),
    );
  }

  // Scrolling moves rows under a still pointer; only a deliberate hover should update the equation.
  const hoverEquation = (target, action) => { if (performance.now() - lastScroll > 200) showEquation(target, action); };

  function finish() {
    const info = startInfo();
    const n = history.length;
    const masters = [...st.expr.keys()].map(parse).filter(isMaster).length;
    const random = info?.random_median_steps == null
      ? `A random policy finished in ${info?.random_solved ?? 0} of ${info?.random_runs ?? 30} tries within 40 steps.`
      : `A random policy finished in ${info.random_solved} of ${info.random_runs} tries within 40 steps, and needed a median of ${info.random_median_steps} steps when it did.`;
    banner.hidden = false;
    banner.replaceChildren(h('b', {}, `Sector cleared in ${n} step${n === 1 ? '' : 's'}. `),
      `The model's top choice at every step takes ${info?.model_steps ?? '?'} steps. ${random} `,
      `The result has ${st.expr.size} terms, ${masters} of them master integrals.`);
    list.replaceChildren(banner);
  }

  async function render() {
    const me = ++token;
    const sector = sectorOf(start);
    const target = pickTarget(st.expr, sector);
    const left = nonMasters(st.expr, sector);
    const w = maxW(left);
    status.replaceChildren(
      h('div', { class: 'stat' }, h('b', {}, String(history.length)), h('span', {}, 'steps taken')),
      h('div', { class: 'stat' }, h('b', {}, String(left.length)), h('span', {}, 'integrals to eliminate')),
      h('div', { class: 'stat' }, h('b', {}, w ? wStr(w) : 'done'), h('span', {}, 'highest weight (r, s)')),
    );
    glyphBox.replaceChildren(glyph(target ?? start, { size: 104 }));
    targetLine.replaceChildren(target
      ? h('div', { class: 'row' }, h('span', { class: 'note' }, 'Target:'), h('span', { class: 'int t' }, intStr(target)))
      : h('div', { class: 'note' }, 'No integrals left to eliminate in this sector.'));
    const inSec = [...st.expr].filter(([k]) => inSector(parse(k), sector));
    const tk = target ? key(target) : null;
    inSec.sort((a, b) => { const [p, q] = [weight(parse(a[0])), weight(parse(b[0]))]; return (b[0] === tk) - (a[0] === tk) || q[0] - p[0] || q[1] - p[1]; });
    exprBox.replaceChildren(...inSec.slice(0, 14).map(([k, c]) => h('div', { class: `term${target && k === key(target) ? ' t' : ''}` },
      h('span', { class: 'c' }, String(c)), h('span', { class: 'int' }, `I[${k}]`), isMaster(parse(k)) ? h('span', { class: 'note' }, 'master') : null)));
    const lower = st.expr.size - inSec.length;
    lowerNote.textContent = `${inSec.length > 14 ? `Showing the 14 highest-weight of ${inSec.length} integrals in this sector. ` : ''}${lower ? `Plus ${lower} integral${lower === 1 ? '' : 's'} in subsectors, which separate reduction jobs handle later.` : ''}`;
    undoBtn.disabled = !history.length || busy;
    resetBtn.disabled = busy;

    if (!target) { list.replaceChildren(); $('#play-count').textContent = 'Valid identities'; autoBtn.disabled = true; revealBtn.disabled = true; finish(); return; }
    banner.hidden = true;
    autoBtn.disabled = !modelReady || busy; revealBtn.disabled = !modelReady;
    const actions = ibp.validActions(target, st);
    $('#play-count').textContent = `${actions.length} valid identities`;
    const rows = actions.map((a, i) => ({ a, i, eff: effect(target, a) })).filter((r) => r.eff);
    rows.sort((x, y) => x.eff.left - y.eff.left || (x.eff.w?.[0] ?? 0) - (y.eff.w?.[0] ?? 0) || (x.eff.w?.[1] ?? 0) - (y.eff.w?.[1] ?? 0));
    if (modelReady && (reveal || busy)) {
      scored = await scoreActions(st, target, actions);
      if (me !== token) return;
      rows.sort((x, y) => scored.probs[y.i] - scored.probs[x.i]);
    } else scored = null;
    list.replaceChildren(...rows.slice(0, showAll ? 60 : 8).map((r, idx) => {
      const p = scored?.probs[r.i];
      const seed = target.map((x, j) => x + r.a.delta[j]);
      const node = h('button', { class: `action${scored && idx === 0 ? ' top' : ''}`, type: 'button', disabled: busy,
        onclick: () => choose(target, r.a), onpointermove: () => hoverEquation(target, r.a), onfocus: () => showEquation(target, r.a) },
      scored ? h('span', { class: 'bar', style: `width:${(100 * p).toFixed(1)}%` }) : null,
      h('span', { class: 'rank' }, scored ? pct(p, 0) : `${idx + 1}`),
      h('span', { class: 'what' }, `Op ${r.a.op}: ${OP_NAMES[r.a.op]}`, h('small', { class: 'mono' }, `seed ${intStr(seed)}`)),
      h('span', { class: 'eff' }, `${r.eff.left} left`, h('br'), r.eff.w ? wStr(r.eff.w) : 'clear'));
      return node;
    }));
    if (rows.length > 8) {
      const extra = Math.min(rows.length, 60) - 8;
      list.append(h('button', { class: 'btn', type: 'button', id: 'play-more', onclick: () => { showAll = !showAll; render(); } }, showAll ? 'Show fewer identities' : `Show ${extra} more identities`));
    }
    if (rows[0]) showEquation(target, rows[0].a);
    return { target, actions };
  }

  function choose(target, action) {
    const next = ibp.apply(st, target, action);
    if (!next) return;
    history.push(st); st = next; render();
  }

  function begin(s) {
    start = s.integral; st = initialState(start); history = []; banner.hidden = true; reveal = false; showAll = false; revealBtn.textContent = 'Show the model\'s ranking';
    [...startRow.children].forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.k === key(start))));
    render();
  }

  for (const s of play.starts) {
    startRow.append(h('button', { class: 'chip', type: 'button', 'data-k': key(s.integral), onclick: () => { if (!busy) begin(s); } }, intStr(s.integral)));
  }
  revealBtn.addEventListener('click', () => { reveal = !reveal; revealBtn.textContent = reveal ? 'Hide the model\'s ranking' : 'Show the model\'s ranking'; render(); });
  undoBtn.addEventListener('click', () => { if (history.length) { st = history.pop(); render(); } });
  resetBtn.addEventListener('click', () => begin(startInfo()));
  autoBtn.addEventListener('click', async () => {
    if (busy || !modelReady) return;
    busy = true; reveal = true; revealBtn.textContent = 'Hide the model\'s ranking';
    autoBtn.disabled = true; undoBtn.disabled = true; resetBtn.disabled = true;
    const sector = sectorOf(start);
    for (let i = 0; i < 40; i++) {
      const target = pickTarget(st.expr, sector);
      if (!target) break;
      const actions = ibp.validActions(target, st);
      const r = await scoreActions(st, target, actions);
      let best = 0;
      r.probs.forEach((p, j) => { if (p > r.probs[best]) best = j; });
      await render();
      await new Promise((res) => setTimeout(res, matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 850));
      history.push(st);
      st = ibp.apply(st, target, actions[best]);
    }
    busy = false;
    render();
  });
  begin(play.starts[0]);
}
