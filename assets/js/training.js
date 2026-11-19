// Section 5: the published training log.
import { h, section, loadJSON, lineChart, fmt, pct, comma, mlNote } from './ui.js';

export default async function build() {
  const root = section('train', {
    eyebrow: '5 · Training',
    title: 'Thirty epochs of supervised learning',
    lede: 'Scrambles supply the correct action at every step, so training is ordinary classification. The loss drops quickly, and the validation curve flattens while the training curve keeps improving.',
  });
  const t = await loadJSON('training');
  const x = t.epochs.map((e) => e.epoch);
  const tipFormat = (i) => { const e = t.epochs[i]; return `<b>Epoch ${e.epoch}</b><br>Train: loss ${fmt(e.train_loss, 3)}, top-1 ${pct(e.train_top1)}<br>Validation: loss ${fmt(e.val_loss, 3)}, top-1 ${pct(e.val_top1)}, top-5 ${pct(e.val_top5)}`; };
  const opts = { width: 520, height: 260, x, xLabel: 'epoch', marker: t.best_epoch, tipFormat, xTicks: [1, 5, 10, 15, 20, 25, 30] };
  const series = (a, b) => [{ name: 'Train', color: 'var(--faint)', values: t.epochs.map((e) => e[a]) }, { name: 'Validation', color: 'var(--sailir)', values: t.epochs.map((e) => e[b]) }];
  const best = t.epochs.find((e) => e.epoch === t.best_epoch);
  root.append(
    h('div', { class: 'panel stack' },
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--faint)' }), 'Training data'), h('span', {}, h('i', { style: 'background:var(--sailir)' }), 'Held-out validation data'), h('span', {}, h('i', { style: 'background:var(--line-strong)' }), `Epoch ${t.best_epoch}: saved checkpoint`)),
      h('div', { class: 'two' },
        h('div', {}, h('h3', {}, 'Cross-entropy loss'), lineChart({ ...opts, series: series('train_loss', 'val_loss'), yFormat: (v) => fmt(v, 1), yLabel: 'loss' })),
        h('div', {}, h('h3', {}, 'Top-1 accuracy'), lineChart({ ...opts, series: series('train_top1', 'val_top1'), yFormat: (v) => pct(v, 0), yLabel: 'accuracy' }))),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, pct(best.val_top1)), h('span', {}, 'validation top-1 at the checkpoint')),
        h('div', { class: 'stat' }, h('b', {}, pct(best.val_top5)), h('span', {}, 'oracle action in the top 5')),
        h('div', { class: 'stat' }, h('b', {}, pct(t.fresh.top1)), h('span', {}, `top-1 on ${comma(t.fresh.n)} new samples made for this page`)),
        h('div', { class: 'stat' }, h('b', {}, comma(t.params)), h('span', {}, 'trainable parameters')),
        h('div', { class: 'stat' }, h('b', {}, comma(t.n_train)), h('span', {}, 'training samples')))),
    h('div', { class: 'two' },
      mlNote('Cross-entropy loss', `For each sample the loss is −ln p, where p is the probability the model gave the oracle action. Guessing uniformly among the valid actions would give ${fmt(t.fresh.baseline_loss, 2)} on average here. The checkpoint reaches ${fmt(best.val_loss, 2)}.`),
      mlNote('Why validation data', 'Validation samples are never used to update the weights. When the training loss keeps falling and the validation loss does not, the model has started fitting details of its training set. That is overfitting, so the saved checkpoint is the epoch with the lowest validation loss.')),
  );
}
