#!/usr/bin/env python3
"""Random walks through the Python environment, used to test assets/js/ibp.js exactly."""
import json
import random
import sys

from common import DATA_DIR, SAILIR_DIR, WORK_DIR
from ibp_env import IBPEnvironment, filter_resolved_subs_to_exact_sector, filter_subs_to_exact_sector, is_master, set_paper_masters_only, set_prime, weight
from beam_search_utils import get_sector_mask, filter_to_sector

set_prime(1009)
set_paper_masters_only(True)
env = IBPEnvironment()
random.seed(20261118)

STARTS = [(2,1,2,1,2,2,-4), (1,1,2,1,1,1,-4), (1,1,1,1,1,1,-2), (2,1,0,1,1,1,0), (1,2,1,0,1,1,-1), (1,1,0,1,2,1,-2),
          (2,1,1,1,1,0,-1), (1,0,2,1,1,1,-2), (1,1,1,1,2,0,0), (0,1,2,1,1,0,-1), (2,0,1,0,1,1,-1), (1,1,1,0,1,2,-3)]
walks = []
for w in range(60):
    start = random.choice(STARTS)
    sector = tuple(get_sector_mask(start))
    expr, subs, resolved = {start: 1}, {}, {}
    steps = []
    for _ in range(14):
        nm = [k for k in filter_to_sector(expr, sector) if not is_master(k)]
        if not nm:
            break
        target = sorted(nm, key=lambda x: (-weight(x)[0], -weight(x)[1], weight(x)[2]))[0]
        fs = filter_subs_to_exact_sector(subs, sector)
        fr = filter_resolved_subs_to_exact_sector(resolved, sector)
        cache = env.compute_indirect_cache(fs, fr)
        valid = env.get_valid_actions_with_cache(target, cache, fs, fr, filter_mode='subsector')
        if not valid:
            break
        op, delta = random.choice(valid)
        expr, subs, resolved, ok = env.apply_action_resolved(dict(expr), dict(subs), resolved, target, op, delta)
        assert ok
        steps.append({'target': list(target), 'valid': [[o, list(d)] for o, d in valid], 'pick': [op, list(delta)],
                      'expr': [[list(k), v] for k, v in expr.items()],
                      'subs': [[list(k), [[list(a), b] for a, b in v.items()]] for k, v in subs.items()],
                      'resolved': [[list(k), [[list(a), b] for a, b in v.items()]] for k, v in resolved.items()]})
    walks.append({'start': list(start), 'steps': steps})

templates = [[[list(s), c] for s, c in env.ibp_t[i]] for i in range(8)] + [[[list(s), c] for s, c in env.li_t[0]]]
(DATA_DIR / 'templates.json').write_text(json.dumps(templates))
(WORK_DIR / 'vectors.json').write_text(json.dumps(walks))
print('walks', len(walks), 'steps', sum(len(w['steps']) for w in walks), 'term counts per operator', [len(t) for t in templates])
