#!/usr/bin/env python3
"""Run the published data generator on seeds disjoint from the training data.

The generator source is used unchanged except for two injected lines that also
record the expression after every scramble step, which the published script
discards.  Output: samples_<shard>.jsonl and scrambles_<shard>.jsonl.
"""
import argparse
import json
import sys

from common import SAILIR_DIR, WORK_DIR

GEN = SAILIR_DIR / 'scripts/data_gen/generate_multisector_data.py'


def patched_source():
    src = GEN.read_text()
    edits = [
        ("            used_ibps.append((ibp_op, seed))\n",
         "            used_ibps.append((ibp_op, seed))\n"
         "            _SNAP.append({'op': ibp_op, 'seed': list(seed), 'elim': list(elim), 'expr': expr_to_json(expr)})\n"),
        ("            scrambled, used_ibps = scramble(start,",
         "            _SNAP.clear()\n            scrambled, used_ibps = scramble(start,"),
        ("            if success:\n                for sample in scramble_samples:",
         "            if success:\n"
         "                _SNAP_F.write(json.dumps({'scramble_id': scramble_idx, 'sector_id': sector_id,"
         " 'start': expr_to_json(start), 'steps': list(_SNAP), 'n_unscramble': len(scramble_samples)}) + '\\n')\n"
         "                for sample in scramble_samples:"),
    ]
    for old, new in edits:
        assert src.count(old) == 1, old
        src = src.replace(old, new)
    return src


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shard', type=int, required=True)
    ap.add_argument('--n_scrambles', type=int, default=150)
    a = ap.parse_args()
    out = WORK_DIR / 'scrambles'
    out.mkdir(parents=True, exist_ok=True)
    # Training used seeds below 100,000,000 (100 workers x 1,000,000).
    start_seed = 1_000_000_000 + a.shard * 1_000_000
    with open(out / f'scrambles_{a.shard}.jsonl', 'w') as snap_f:
        ns = {'__name__': 'gen', '_SNAP': [], '_SNAP_F': snap_f}
        exec(compile(patched_source(), str(GEN), 'exec'), ns)
        sys.argv = ['gen', '--n_scrambles', str(a.n_scrambles), '--start_seed', str(start_seed),
                    '--output', str(out / f'samples_{a.shard}.jsonl'), '--prime', '1009',
                    '--min_steps', '5', '--max_steps', '25',
                    '--ibp_path', str(SAILIR_DIR / 'scripts/data_gen/IBP'),
                    '--li_path', str(SAILIR_DIR / 'scripts/data_gen/LI')]
        ns['main']()


if __name__ == '__main__':
    main()
