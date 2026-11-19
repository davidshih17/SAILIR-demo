#!/usr/bin/env python3
"""Record every beam state of a real one-episode reduction.

Runs the published onestep_worker and beam_search with the source unchanged
except for one injected hook, called once per beam step.
"""
import argparse
import contextlib
import json
import math
import os
import pickle
import sys
import types

from common import CKPT, SAILIR_DIR, WORK_DIR, load_trained_model

TRACE = {'calls': []}


def key(path):
    return '|'.join(f"{','.join(map(str, t))}:{op}:{','.join(map(str, d))}" for t, op, d in path)


def hook(step, beam, n_batch, n_cands, weight_beam_end, target_sector, max_weight):
    call = TRACE['calls'][-1]
    states = []
    for idx, s in enumerate(beam):
        t, op, d = s.path[-1]
        parent = key(s.path[:-1])
        prev = call['scores'].get(parent, 0.0)
        mw = max_weight(s.expr, target_sector)
        states.append({'k': key(s.path), 'p': parent, 't': list(t), 'op': op, 'd': list(d),
                       'prob': round(math.exp(s.score - prev), 4), 'w': list(mw),
                       'nm': s.n_non_masters, 'n': len(s.expr),
                       'b': 0 if idx < weight_beam_end else 1})
    call['scores'].update({key(s.path): s.score for s in beam})
    call['steps'].append({'step': step, 'batch': n_batch, 'cands': n_cands, 'states': states})


def load_patched_beam_search():
    path = SAILIR_DIR / 'scripts/eval/beam_search.py'
    src = path.read_text()
    old = "            step += 1\n\n    finally:"
    new = ("            _TRACE_HOOK(step, beam, len(batch_data), len(candidates), weight_beam_end,"
           " target_sector, max_weight)\n            step += 1\n\n    finally:")
    assert src.count(old) == 1
    mod = types.ModuleType('beam_search')
    mod.__file__ = str(path)
    mod._TRACE_HOOK = hook
    sys.modules['beam_search'] = mod
    exec(compile(src.replace(old, new), str(path), 'exec'), mod.__dict__)
    return mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--integral', required=True)
    ap.add_argument('--beam', type=int, default=20)
    ap.add_argument('--max_steps', type=int, default=120)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    mod = load_patched_beam_search()
    import onestep_worker
    from beam_search_utils import max_weight
    model = load_trained_model()
    onestep_worker.load_model = lambda *x, **k: model
    inner = mod.beam_search

    def traced(env, mdl, start_expr, **kw):
        TRACE['calls'].append({'start_terms': len(start_expr), 'scores': {'': 0.0}, 'steps': [],
                               'start_w': list(max_weight(start_expr, kw['target_sector']))})
        return inner(env, mdl, start_expr, **kw)

    onestep_worker.beam_search = traced
    tmp = WORK_DIR / f"beam_{os.getpid()}.pkl"
    sys.argv = ['w', f'--integral={a.integral}', '--output', str(tmp), '--model-checkpoint', str(CKPT),
                '--beam_width', str(a.beam), '--max_steps', str(a.max_steps), '--prime', '1009',
                '--device', 'cpu', '--paper-masters-only', '--beam-sort', 'mixed']
    with open(os.devnull, 'w') as dn, contextlib.redirect_stdout(dn):
        onestep_worker.main()
    with open(tmp, 'rb') as f:
        r = pickle.load(f)
    os.remove(tmp)
    for c in TRACE['calls']:
        del c['scores']
    with open(a.out, 'w') as f:
        json.dump({'integral': [int(x) for x in a.integral.split(',')], 'beam': a.beam,
                   'max_steps': a.max_steps, 'success': r['success'], 'steps': r['steps'],
                   'time': r['time'], 'restart_offsets': r['restart_offsets'],
                   'path': [[list(t), op, list(d)] for t, op, d in r['path']],
                   'final_terms': len(r['final_expr']), 'calls': TRACE['calls']}, f)
    print('DONE', a.integral, 'K', a.beam, 'success', r['success'], 'steps', r['steps'],
          'time %.1f' % r['time'], flush=True)


if __name__ == '__main__':
    main()
