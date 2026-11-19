#!/usr/bin/env python3
"""Score freshly generated samples with the published model.

The samples come from seeds the model never trained on.  Output: per-sample
probabilities for every valid action, plus aggregate accuracy.
"""
import json
import pickle
import sys

import numpy as np
import torch
import torch.nn.functional as F

from common import SAILIR_DIR, WORK_DIR, load_trained_model

sys.path.insert(0, str(SAILIR_DIR / 'scripts/train'))
from train_classifier import collate_fn  # noqa: E402


def as_item(s):
    t = lambda x, dtype: torch.tensor(x, dtype=dtype)
    return {'expr_integrals': t([e[0] for e in s['expr']], torch.long), 'expr_coeffs': t([e[1] for e in s['expr']], torch.long),
            'sub_integrals': torch.zeros(0, 7), 'subs_raw': s['subs'],
            'action_ibp_ops': t([a[0] for a in s['valid_actions']], torch.long),
            'action_deltas': t([a[1] for a in s['valid_actions']], torch.long),
            'sector_mask': t(s['sector_mask'], torch.long), 'target_integral': t(s['target'], torch.long),
            'label': t(s['chosen_action_idx'], torch.long)}


def main():
    torch.set_num_threads(8)
    model = load_trained_model()
    samples = []
    for p in sorted((WORK_DIR / 'scrambles').glob('samples_*.jsonl')):
        shard = int(p.stem.split('_')[1])
        with open(p) as f:
            for line in f:
                s = json.loads(line)
                s['traj'] = f"{shard}-{s['scramble_id']}"
                samples.append(s)
    order = np.argsort([len(s['valid_actions']) for s in samples])
    results = [None] * len(samples)
    loss_sum, top1, top5 = 0.0, 0, 0
    with torch.no_grad():
        for start in range(0, len(order), 128):
            idx = order[start:start + 128]
            b = collate_fn([as_item(samples[i]) for i in idx])
            logits, _ = model(b['expr_integrals'], b['expr_coeffs'], b['expr_mask'], b['sub_keys'], b['sub_repl_ints'],
                              b['sub_repl_coeffs'], b['sub_repl_mask'], b['sub_mask'], b['action_ibp_ops'], b['action_deltas'],
                              b['action_mask'], b['sector_mask'], b['target_integral'])
            loss_sum += F.cross_entropy(logits, b['labels'], reduction='sum').item()
            probs = logits.softmax(-1)
            for j, i in enumerate(idx):
                n = len(samples[i]['valid_actions'])
                p = probs[j, :n].numpy().astype(float)
                rank = int((p > p[samples[i]['chosen_action_idx']]).sum()) + 1
                results[i] = {'probs': p, 'rank': rank}
                top1 += rank == 1
                top5 += rank <= 5
    n = len(samples)
    print(f'{n} fresh samples: loss {loss_sum/n:.4f}  top-1 {top1/n:.4f}  top-5 {top5/n:.4f}', flush=True)
    with open(WORK_DIR / 'scored.pkl', 'wb') as f:
        pickle.dump({'samples': samples, 'results': results, 'loss': loss_sum / n, 'top1': top1 / n, 'top5': top5 / n}, f)


if __name__ == '__main__':
    main()
