#!/usr/bin/env python3
"""Assemble the JSON files the page loads, from published results and the local runs."""
import csv
import json
import math
import pickle
import random
import re
import statistics as st
import sys
from collections import Counter, defaultdict

import numpy as np
import torch

from common import DATA_DIR, SAILIR_DIR, WORK_DIR, load_trained_model
from export_onnx import ExportedClassifier, sample_inputs


REDUCTION = 'reduction_r7s4_v2.json'


def dump(name, obj):
    path = DATA_DIR / f'{name}.json'
    path.write_text(json.dumps(obj, separators=(',', ':')))
    print(f'{name}.json  {path.stat().st_size/1e3:,.0f} kB', flush=True)


def parse_int(text):
    return [int(x) for x in re.search(r'\[([^\]]+)\]', text).group(1).split(',')]


def benchmarks():
    kira = {}
    with open(SAILIR_DIR / 'results/kira_benchmark.csv') as f:
        for r in csv.DictReader(f):
            kira[tuple(parse_int(r['integral']))] = r
    rows = []
    with open(SAILIR_DIR / 'results/sailir_benchmark.csv') as f:
        for r in csv.DictReader(f):
            a = parse_int(r['integral'])
            k = kira[tuple(a)]
            rows.append({'r': int(r['r']), 's': int(r['s']), 'integral': a, 'in_paper': int(r['r']) >= 10,
                         'sailir': {'ideal_s': float(r['ideal_parallel_time_s']), 'wall_s': float(r['time_s']),
                                    'mem_mb': float(r['max_worker_memory_per_cpu_mb']), 'mem_raw_mb': float(r['max_worker_memory_raw_mb']),
                                    'jobs': int(r['total_jobs']), 'steps': int(r['total_steps']), 'cache_hits': int(r['cache_hits']),
                                    'stragglers': int(r['stragglers'])},
                         'kira': {'time_s': float(k['total_time_s']), 'mem_mb': float(k['peak_memory_kb']) / 1024, 'equations': int(k['num_equations'])}})
    dump('benchmarks', {'rows': rows})
    return rows


def training(scored):
    text = (SAILIR_DIR / 'results/training_log/train.log').read_text()
    pat = re.compile(r'Epoch (\d+)/30 \(([\d.]+)s\):\s+Train: loss=([\d.]+), top1=([\d.]+), top5=([\d.]+)\s+Val:\s+loss=([\d.]+), top1=([\d.]+), top5=([\d.]+)')
    epochs = [{'epoch': int(m[0]), 'secs': float(m[1]), 'train_loss': float(m[2]), 'train_top1': float(m[3]), 'train_top5': float(m[4]),
               'val_loss': float(m[5]), 'val_top1': float(m[6]), 'val_top5': float(m[7])} for m in pat.findall(text)]
    assert len(epochs) == 30
    best = min(epochs, key=lambda e: e['val_loss'])['epoch']
    n_train = int(re.search(r'Train: (\d+), Val', text).group(1))
    n_val = int(re.search(r'Val: (\d+)', text).group(1))
    params = int(re.search(r'Model parameters: ([\d,]+)', text).group(1).replace(',', ''))
    base = float(np.mean([math.log(len(s['valid_actions'])) for s in scored['samples']]))
    dump('training', {'epochs': epochs, 'best_epoch': best, 'n_train': n_train, 'n_val': n_val, 'params': params,
                      'fresh': {'n': len(scored['samples']), 'top1': scored['top1'], 'top5': scored['top5'], 'loss': scored['loss'], 'baseline_loss': base}})


def bins_from(values, edges, labels):
    counts = [0] * len(labels)
    for v in values:
        for i in range(len(labels)):
            if edges[i] <= v < edges[i + 1]:
                counts[i] += 1
                break
    return [{'label': l, 'v': c} for l, c in zip(labels, counts)]


def explorer(scored):
    S, R = scored['samples'], scored['results']
    n_act = [len(s['valid_actions']) for s in S]
    edges = list(range(0, 261, 20)) + [10**6]
    labels = [str(e) for e in edges[:-2]] + ['260+']
    t_edges = list(range(0, 81, 5)) + [10**6]
    t_labels = [str(e) for e in t_edges[:-2]] + ['80+']
    by_step = defaultdict(list)
    for s, r in zip(S, R):
        by_step[s['step']].append(r['rank'] == 1)
    acc = [{'label': str(k + 1), 'acc': float(np.mean(v)), 'n': len(v)} for k, v in sorted(by_step.items()) if len(v) >= 40]
    summary = {'n': len(S), 'trajs': len({s['traj'] for s in S}), 'top1': scored['top1'], 'top5': scored['top5'], 'loss': scored['loss'],
               'median_actions': int(st.median(n_act)),
               'hist': {'actions': bins_from(n_act, edges, labels), 'terms': bins_from([len(s['expr']) for s in S], t_edges, t_labels), 'acc_by_step': acc}}
    rng = random.Random(7)
    idx = [i for i, s in enumerate(S) if len(s['expr']) <= 36 and 4 <= len(s['valid_actions']) <= 220]
    right = [i for i in idx if R[i]['rank'] == 1]
    wrong = [i for i in idx if R[i]['rank'] > 1]
    chosen = rng.sample(right, 330) + rng.sample(wrong, 120)
    rng.shuffle(chosen)
    out = []
    for i in chosen:
        s, p = S[i], R[i]['probs']
        order = np.argsort(-p)
        top = [{'op': s['valid_actions'][j][0], 'd': s['valid_actions'][j][1], 'p': round(float(p[j]), 4), 'rank': int(k + 1)} for k, j in enumerate(order[:6])]
        o = s['chosen_action_idx']
        if R[i]['rank'] > 6:
            top.append({'op': s['valid_actions'][o][0], 'd': s['valid_actions'][o][1], 'p': round(float(p[o]), 4), 'rank': R[i]['rank']})
        out.append({'target': s['target'], 'w': s['target_weight'][:2], 'step': s['step'], 'sector': s['sector_id'], 'level': sum(s['sector_mask']),
                    'expr': s['expr'], 'nSubs': len(s['subs']), 'n': len(s['valid_actions']), 'rank': R[i]['rank'],
                    'oracle': {'op': s['chosen_action'][0], 'd': s['chosen_action'][1]}, 'top': top})
    dump('explorer', {'summary': summary, 'samples': out})


def scrambles(scored):
    S, R = scored['samples'], scored['results']
    by_traj = defaultdict(list)
    for s, r in zip(S, R):
        by_traj[s['traj']].append((s, r))
    picks = []
    for shard in range(8):
        with open(WORK_DIR / f'scrambles/scrambles_{shard}.jsonl') as f:
            for line in f:
                t = json.loads(line)
                tid = f"{shard}-{t['scramble_id']}"
                u = by_traj[tid]
                n = len(t['steps'])
                mask = [(t['sector_id'] >> i) & 1 for i in range(6)]
                inside = lambda a: all((a[i] > 0) == bool(mask[i]) for i in range(6))
                sizes = [sum(inside(a) for a, _ in st_['expr']) for st_ in t['steps']]
                if 10 <= n <= 22 and 8 <= len(u) <= 22 and sum(mask) >= 4 and 8 <= max(sizes) <= 34:
                    picks.append((t, u, mask, inside))
    rng = random.Random(3)
    rng.shuffle(picks)
    seen, trajs = set(), []
    for t, u, mask, inside in picks:
        if t['sector_id'] in seen or len(trajs) >= 8:
            continue
        seen.add(t['sector_id'])
        frames = [{'phase': 'start', 'expr': t['start'], 'lower': 0}]
        for st_ in t['steps']:
            frames.append({'phase': 'scramble', 'op': st_['op'], 'seed': st_['seed'], 'elim': st_['elim'],
                           'expr': [[a, c] for a, c in st_['expr'] if inside(a)], 'lower': sum(not inside(a) for a, _ in st_['expr'])})
        for s, r in sorted(u, key=lambda x: x[0]['step']):
            o = s['chosen_action_idx']
            frames.append({'phase': 'unscramble', 'expr': s['expr'], 'lower': None, 'target': s['target'],
                           'oracle': {'op': s['chosen_action'][0], 'd': s['chosen_action'][1]}, 'nValid': len(s['valid_actions']),
                           'rank': r['rank'], 'prob': round(float(r['probs'][o]), 4)})
        frames.append({'phase': 'done', 'expr': t['start'], 'lower': None})
        trajs.append({'sector': t['sector_id'], 'level': sum(mask), 'n_scramble': len(t['steps']), 'frames': frames})
    cells = lambda x: len({(sum(max(v, 0) for v in a), sum(max(-v, 0) for v in a)) for f in x['frames'] for a, _ in f['expr']})
    trajs.sort(key=lambda x: -cells(x))
    dump('scrambles', {'trajs': trajs})


def anatomy(scored):
    S, R = scored['samples'], scored['results']
    wrapped = ExportedClassifier(load_trained_model()).eval()
    cand = [i for i, s in enumerate(S) if 5 <= len(s['expr']) <= 12 and 18 <= len(s['valid_actions']) <= 90 and R[i]['rank'] <= 3 and sum(s['sector_mask']) >= 4 and s['step'] >= 1]
    rng = random.Random(5)
    rng.shuffle(cand)
    out, seen = [], set()
    for i in cand:
        s = S[i]
        if s['sector_id'] in seen:
            continue
        seen.add(s['sector_id'])
        with torch.no_grad():
            logits, attn = wrapped(*sample_inputs(s))
        p = logits[0].softmax(-1).numpy()
        a = attn[0].numpy()
        order = list(np.argsort(-p)[:6])
        o = s['chosen_action_idx']
        if o not in order:
            order[-1] = o
        out.append({'target': s['target'], 'sector': s['sector_id'], 'n': len(s['valid_actions']), 'expr': s['expr'],
                    'actions': [{'op': s['valid_actions'][j][0], 'd': s['valid_actions'][j][1], 'p': round(float(p[j]), 4), 'oracle': int(j) == o,
                                 'attn': [round(float(x), 4) for x in a[j]]} for j in order]})
        if len(out) >= 5:
            break
    dump('anatomy', {'samples': out})


def path_key(path):
    return '|'.join(f"{','.join(map(str, t))}:{op}:{','.join(map(str, d))}" for t, op, d in path)


def beam_run(path):
    r = json.load(open(path))
    offs = r['restart_offsets'] + [len(r['path'])]
    chosen = set()
    for c in range(len(r['restart_offsets'])):
        seg = r['path'][offs[c]:offs[c + 1]]
        chosen |= {(c, path_key(seg[:i + 1])) for i in range(len(seg))}
    frames = []
    for c, call in enumerate(r['calls']):
        prev = {}
        for si, step in enumerate(call['steps']):
            states, here = [], {}
            order = sorted(range(len(step['states'])), key=lambda i: (step['states'][i]['w'], step['states'][i]['nm']))
            for j, i in enumerate(order):
                x = step['states'][i]
                here[x['k']] = j
                states.append({'parent': prev.get(x['p'], -1), 'chosen': (c, x['k']) in chosen, 'w': x['w'], 'nm': x['nm'], 'prob': x['prob'], 'op': x['op'], 'target': x['t']})
            frames.append({'restart': c > 0 and si == 0, 'cands': step['cands'], 'states': states})
            prev = here
    return {'success': r['success'], 'steps': r['steps'], 'time': r['time'], 'frames': frames}, r


def beam():
    best = None
    for n in range(1, 5):
        files = {k: WORK_DIR / f'bt_{n}_K{k}.json' for k in (1, 5, 20)}
        if not all(f.exists() for f in files.values()):
            continue
        runs = {k: beam_run(f) for k, f in files.items()}
        if not runs[20][1]['success']:
            continue
        score = (not runs[1][1]['success'], runs[1][1]['steps'] - runs[20][1]['steps'])
        if best is None or score > best[0]:
            best = (score, runs)
    runs = best[1]
    dump('beam', {'integral': runs[20][1]['integral'], 'max_steps': runs[20][1]['max_steps'], 'default_k': '20',
                  'runs': {str(k): v[0] for k, v in runs.items()}})


def reduction(rows):
    d = json.load(open(WORK_DIR / REDUCTION))
    J = {tuple(j['i']): j for j in d['jobs']}
    finish = {}

    def done(k):
        if k in finish:
            return finish[k]
        j = J[k]
        finish[k] = (done(tuple(j['parent'])) if j['parent'] else 0.0) + j['time']
        return finish[k]

    sys.setrecursionlimit(10000)
    jobs = []
    for k, j in J.items():
        end = done(k)
        jobs.append([j['depth'], round(end - j['time'], 2), round(end, 2), j['w'][0], j['w'][1], j['steps'], j['terms'], j['children'], j['hits']])
    jobs.sort(key=lambda x: x[1])
    pub = next(r for r in rows if r['integral'] == d['integral'])
    w = [sum(max(x, 0) for x in d['integral']), sum(max(-x, 0) for x in d['integral'])]
    dump('reduction', {'integral': d['integral'], 'r': w[0], 's': w[1], 'procs': d['procs'], 'cache_hits': d['cache_hits'], 'non_masters_left': d['non_masters_left'],
                       'n_final_masters': len(d['final']), 'wall_s': d['wall_s'], 'ideal_s': max(x[2] for x in jobs),
                       'published': {'jobs': pub['sailir']['jobs'], 'cache_hits': pub['sailir']['cache_hits'], 'ideal_s': pub['sailir']['ideal_s']}, 'jobs': jobs})


def fan():
    """Lay the reduction out as a graph, and replay it generation by generation.

    The replay substitutes every job's result exactly, so it must end on the same
    expression as the orchestrator.
    """
    from ibp_env import PAPER_MASTERS
    P = 1009
    d = json.load(open(WORK_DIR / REDUCTION))
    start = tuple(d['integral'])
    out = {tuple(j['i']): {tuple(a): c for a, c in j['out']} for j in d['jobs']}
    children = {u: [a for a in r if a in out] for u, r in out.items()}
    assert all(u not in c for u, c in children.items())
    indeg = Counter(v for c in children.values() for v in c)
    gen = {u: 0 for u in out}
    queue = [u for u in out if not indeg[u]]
    assert queue == [start], queue[:5]
    seen = 0
    while queue:
        u = queue.pop()
        seen += 1
        for v in children[u]:
            gen[v] = max(gen[v], gen[u] + 1)
            indeg[v] -= 1
            if not indeg[v]:
                queue.append(v)
    assert seen == len(out), 'the job graph has a cycle'

    n_gen = max(gen.values()) + 1
    columns = defaultdict(list)
    level = lambda a: sum(x > 0 for x in a[:6])
    wt = lambda a: (sum(max(x, 0) for x in a), sum(max(-x, 0) for x in a))
    for u in out:
        columns[gen[u]].append(u)
    expr, frontier, cancelled = {start: 1}, [], 0
    for g in range(n_gen):
        columns[g].sort(key=lambda a: (-level(a), [-x for x in wt(a)], a))
        for u in columns[g]:
            c = expr.pop(u, 0)
            if not c:
                cancelled += 1
                continue
            for a, v in out[u].items():
                value = (expr.get(a, 0) + c * v) % P
                if value:
                    expr[a] = value
                else:
                    expr.pop(a, None)
        frontier.append({'left': sum(a not in PAPER_MASTERS for a in expr), 'masters': sum(a in PAPER_MASTERS for a in expr)})
    final = {tuple(a): c for a, c in d['final']}
    assert expr == final, 'generation replay disagrees with the orchestrator'
    assert all(a in PAPER_MASTERS for a in expr)

    order = [u for g in range(n_gen) for u in columns[g]]
    index = {u: i for i, u in enumerate(order)}
    masters = sorted({a for r in out.values() for a in r if a in PAPER_MASTERS}, key=lambda a: (-level(a), a))
    for j, m in enumerate(masters):
        index[m] = len(order) + j
    edges = [x for u in order for a in out[u] if a in index for x in (index[u], index[a])]
    answer = sorted(final.items(), key=lambda kv: (-level(kv[0]), kv[0]))
    dump('fan', {'integral': d['integral'], 'generations': n_gen, 'cancelled_jobs': cancelled,
                 'nodes': [{'a': list(u), 'g': gen[u], 'level': level(u), 'r': wt(u)[0], 's': wt(u)[1]} for u in order],
                 'masters': [{'a': list(m), 'c': final.get(m, 0)} for m in masters], 'edges': edges,
                 'frontier': frontier, 'answer': [[list(a), c] for a, c in answer]})
    print('generations', n_gen, 'jobs', len(order), 'edges', len(edges) // 2, 'cancelled jobs', cancelled,
          'peak left', max(f['left'] for f in frontier), 'masters in answer', len(final))
    print('width by generation', [len(columns[g]) for g in range(n_gen)])
    print('left after each generation', [f['left'] for f in frontier])


def play():
    rows = json.load(open(WORK_DIR / 'play_candidates.json'))
    rows = [r for r in rows if 3 <= r['model_steps'] <= 11 and r['max_actions'] <= 120]
    rows.sort(key=lambda r: (r['random_solved'], -r['model_steps']))
    out, sectors = [], set()
    for r in rows:
        if r['sector'] in sectors:
            continue
        sectors.add(r['sector'])
        out.append(r)
        if len(out) == 5:
            break
    out.sort(key=lambda r: (-r['model_steps'], -r['level']))
    dump('play', {'starts': out})
    for r in out:
        print(r)


if __name__ == '__main__':
    which = set(sys.argv[1:])
    scored = pickle.load(open(WORK_DIR / 'scored.pkl', 'rb'))
    rows = benchmarks()
    training(scored)
    explorer(scored)
    scrambles(scored)
    anatomy(scored)
    reduction(rows)
    fan()
    if 'beam' in which:
        beam()
    if 'play' in which:
        play()
