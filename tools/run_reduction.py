#!/usr/bin/env python3
"""Reduce one integral to masters with the published orchestrator logic, on local CPUs.

Follows scripts/eval/hierarchical_reduction.py, replacing Condor with a process
pool.  Each job runs the published onestep_worker unchanged, with the trained
prime.  Writes a job-level trace used by the demo's full-reduction view.
"""
import argparse
import contextlib
import json
import os
import pickle
import sys
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait

from common import CKPT, WORK_DIR, load_trained_model

_MODEL = None


def _init():
    global _MODEL
    import torch
    torch.set_num_threads(1)
    os.nice(10)
    _MODEL = load_trained_model()


def _job(integral, out_dir, beam):
    import onestep_worker
    onestep_worker.load_model = lambda *a, **k: _MODEL
    name = '_'.join(map(str, integral))
    out = f'{out_dir}/{name}.pkl'
    sys.argv = ['w', f"--integral={','.join(map(str, integral))}", '--output', out,
                '--model-checkpoint', str(CKPT), '--beam_width', str(beam), '--prime', '1009',
                '--device', 'cpu', '--paper-masters-only', '--beam-sort', 'mixed']
    with open(os.devnull, 'w') as dn, contextlib.redirect_stdout(dn):
        onestep_worker.main()
    with open(out, 'rb') as f:
        r = pickle.load(f)
    os.remove(out)
    return integral, r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--integral', required=True)
    ap.add_argument('--procs', type=int, default=32)
    ap.add_argument('--beam', type=int, default=20)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    from ibp_env import is_master, set_paper_masters_only, set_prime, weight
    from hierarchical_reduction import apply_substitutions, get_non_masters
    set_prime(1009)
    set_paper_masters_only(True)

    start = tuple(int(x) for x in a.integral.split(','))
    tmp = WORK_DIR / 'reduction_tmp'
    tmp.mkdir(parents=True, exist_ok=True)
    expr, cache, pending = {start: 1}, {}, {}
    depth, parent, jobs = {}, {}, {}
    cache_hits, t0, seq = 0, time.time(), 0

    with ProcessPoolExecutor(a.procs, initializer=_init) as pool:
        while True:
            expr = apply_substitutions(expr, cache, 1009)
            for integral in get_non_masters(expr) - set(cache) - set(pending):
                depth.setdefault(integral, 0)
                pending[integral] = pool.submit(_job, integral, str(tmp), a.beam)
                jobs[integral] = {'seq': seq, 'submit': time.time() - t0}
                seq += 1
            if not pending:
                break
            done, _ = wait(list(pending.values()), return_when=FIRST_COMPLETED)
            for fut in done:
                integral, r = fut.result()
                del pending[integral]
                j = jobs[integral]
                j['finish'] = time.time() - t0
                if not r['success']:
                    cache[integral] = {integral: 1}
                    j['failed'] = True
                    print('FAILED', integral, flush=True)
                    continue
                cache[integral] = r['final_expr']
                new = get_non_masters(r['final_expr'])
                hits = len(new & set(cache))
                cache_hits += hits
                for child in new:
                    if child not in depth:
                        depth[child] = depth[integral] + 1
                        parent[child] = integral
                j.update(time=r['time'], steps=r['steps'], terms=len(r['final_expr']),
                         children=len(new), hits=hits, mem_kb=r['peak_memory_kb'],
                         out=[[list(k), v] for k, v in r['final_expr'].items()])
            if seq and len(cache) % 25 == 0:
                print(f'{time.time()-t0:7.0f}s done={len(cache)} pending={len(pending)} '
                      f'hits={cache_hits}', flush=True)

    expr = apply_substitutions(expr, cache, 1009)
    left = [i for i in expr if not is_master(i)]
    rows = [{'i': list(i), 'parent': list(parent[i]) if i in parent else None, 'depth': depth[i],
             'w': list(weight(i)[:2]), **j} for i, j in jobs.items()]
    with open(a.out, 'w') as f:
        json.dump({'integral': list(start), 'beam': a.beam, 'procs': a.procs, 'jobs': rows,
                   'cache_hits': cache_hits, 'wall_s': time.time() - t0,
                   'final': [[list(k), v] for k, v in sorted(expr.items())],
                   'non_masters_left': len(left)}, f)
    print(f'DONE jobs={len(rows)} hits={cache_hits} left={len(left)} wall={time.time()-t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
