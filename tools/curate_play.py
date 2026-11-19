#!/usr/bin/env python3
"""Find good starting integrals for the hands-on section.

For each candidate, play one episode by always taking the model's top action, and
compare with a policy that picks valid actions uniformly at random.
"""
import json
import multiprocessing as mp
import random
import statistics

import torch

from common import DATA_DIR, WORK_DIR, load_trained_model
from ibp_env import IBPEnvironment, filter_resolved_subs_to_exact_sector, filter_subs_to_exact_sector, is_master, set_paper_masters_only, set_prime, weight
from beam_search import prepare_batched_input_v5
from beam_search_utils import filter_to_sector, get_sector_mask

set_prime(1009)
set_paper_masters_only(True)
env = IBPEnvironment()
torch.set_num_threads(1)
model = load_trained_model()
CAP = 40


def play(start, policy):
    sector = tuple(get_sector_mask(start))
    expr, subs, resolved = {start: 1}, {}, {}
    n_actions = []
    for step in range(CAP):
        nm = [k for k in filter_to_sector(expr, sector) if not is_master(k)]
        if not nm:
            return step, n_actions, expr
        target = sorted(nm, key=lambda x: (-weight(x)[0], -weight(x)[1], weight(x)[2]))[0]
        fs = filter_subs_to_exact_sector(subs, sector)
        fr = filter_resolved_subs_to_exact_sector(resolved, sector)
        valid = env.get_valid_actions_with_cache(target, env.compute_indirect_cache(fs, fr), fs, fr, filter_mode='subsector')
        if not valid:
            return None, n_actions, expr
        n_actions.append(len(valid))
        if policy == 'model':
            batch, _ = prepare_batched_input_v5([(expr, subs, valid, sector, target)], 'cpu')
            with torch.no_grad():
                logits, _ = model(*[batch[k] for k in ('expr_integrals', 'expr_coeffs', 'expr_mask', 'sub_keys', 'sub_repl_ints',
                                                       'sub_repl_coeffs', 'sub_repl_mask', 'sub_mask', 'action_ibp_ops', 'action_deltas',
                                                       'action_mask', 'sector_mask', 'target_integral')])
            op, delta = valid[int(logits[0].argmax())]
        else:
            op, delta = random.choice(valid)
        expr, subs, resolved, ok = env.apply_action_resolved(dict(expr), dict(subs), resolved, target, op, delta)
        if not ok:
            return None, n_actions, expr
    return None, n_actions, expr


random.seed(11)
cands = set()
for sid in range(1, 64):
    mask = [(sid >> i) & 1 for i in range(6)]
    if sum(mask) < 3:
        continue
    for _ in range(14):
        a = [m for m in mask] + [0]
        for _ in range(random.randint(0, 2)):
            on = [i for i in range(6) if mask[i]]
            a[random.choice(on)] += 1
        for _ in range(random.randint(0, 2)):
            off = [i for i in range(7) if i == 6 or not mask[i]]
            a[random.choice(off)] -= 1
        cands.add(tuple(a))



def evaluate(c):
    random.seed(sum((i + 3) * (x + 11) for i, x in enumerate(c)))
    steps, acts, expr = play(c, 'model')
    if steps is None or not 3 <= steps <= 14 or max(acts) > 120:
        return None
    rnd = [play(c, 'random')[0] for _ in range(20)]
    ok = [r for r in rnd if r is not None]
    return {'integral': list(c), 'sector': sum(b << i for i, b in enumerate(get_sector_mask(c))), 'level': sum(get_sector_mask(c)),
            'w': list(weight(c)[:2]), 'model_steps': steps, 'mean_actions': round(statistics.mean(acts), 1), 'max_actions': max(acts),
            'final_terms': len(expr), 'random_solved': len(ok), 'random_runs': len(rnd),
            'random_median_steps': statistics.median(ok) if ok else None}


if __name__ == '__main__':
    todo = [c for c in sorted(cands) if not is_master(c)]
    random.shuffle(todo)
    with mp.Pool(24) as pool:
        rows = [r for r in pool.imap_unordered(evaluate, todo[:260]) if r]
    rows.sort(key=lambda r: (r['random_solved'], -r['model_steps']))
    (WORK_DIR / 'play_candidates.json').write_text(json.dumps(rows, indent=0))
    print(len(todo), 'candidates;', len(rows), 'kept', flush=True)
    for r in rows[:24]:
        print(r, flush=True)
