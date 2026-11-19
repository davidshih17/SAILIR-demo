#!/usr/bin/env python3
"""Export the published classifier to ONNX so the browser can run it.

The exported graph reuses the checkpoint's weights in a branch-free forward pass:
ONNX tracing cannot follow Python branches on tensor values or PyTorch's Transformer
fast paths.  The export is checked against the original model on real samples.
"""
import json
import math
import sys

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from common import DEMO_DIR, WORK_DIR, load_trained_model

INPUTS = ['expr_integrals', 'expr_coeffs', 'expr_mask', 'sub_keys', 'sub_repl_ints', 'sub_repl_coeffs',
          'sub_repl_mask', 'sub_mask', 'action_ibp_ops', 'action_deltas', 'action_mask', 'sector_mask',
          'target_integral']


def attend(mha, q, k, v, key_padding_mask):
    """Multi-head attention with dropout off.  Returns (output, weights averaged over heads)."""
    h, d = mha.num_heads, mha.head_dim
    wq, wk, wv = mha.in_proj_weight.chunk(3)
    bq, bk, bv = mha.in_proj_bias.chunk(3)
    b = q.shape[0]
    Q = F.linear(q, wq, bq).reshape(b, -1, h, d).transpose(1, 2)
    K = F.linear(k, wk, bk).reshape(b, -1, h, d).transpose(1, 2)
    V = F.linear(v, wv, bv).reshape(b, -1, h, d).transpose(1, 2)
    scores = Q @ K.transpose(-1, -2) / math.sqrt(d)
    scores = scores.masked_fill(key_padding_mask[:, None, None, :], float('-inf'))
    weights = scores.softmax(-1)
    out = (weights @ V).transpose(1, 2).reshape(b, -1, h * d)
    return mha.out_proj(out), weights.mean(1)


def encoder_layer(layer, x, pad):
    y, _ = attend(layer.self_attn, x, x, x, pad)
    x = layer.norm1(x + y)
    return layer.norm2(x + layer.linear2(F.gelu(layer.linear1(x))))


def keep_one(mask):
    """Unmask the first slot of rows with nothing valid, so softmax stays finite."""
    has = mask.float().sum(-1) > 0
    first = mask[..., :1] | ~has.unsqueeze(-1)
    return torch.cat([first, mask[..., 1:]], -1), has.float().unsqueeze(-1)


class ExportedClassifier(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.m = model

    def encode_subs(self, keys, repl_ints, repl_coeffs, repl_mask, sub_mask):
        enc, E = self.m.subs_enc, self.m.embed_dim
        n_subs, n_repl = keys.shape[1], repl_ints.shape[2]
        key_emb = enc.key_integral_enc(keys).reshape(-1, E)
        terms = enc.replacement_term_proj(torch.cat([enc.replacement_integral_enc(repl_ints),
                                                     enc.replacement_coeff_enc(repl_coeffs)], -1))
        terms = terms.reshape(-1, n_repl, E)
        mask, has_terms = keep_one(repl_mask.reshape(-1, n_repl))
        query = enc.replacement_pool_query.repeat(terms.shape[0], 1, 1)
        pooled, _ = attend(enc.replacement_pool_attn, query, terms, terms, ~mask)
        pooled = pooled.squeeze(1) * has_terms
        subs = enc.sub_combine(torch.cat([key_emb, pooled], -1)).reshape(1, -1, E)
        subs = subs * sub_mask.float().unsqueeze(-1) + enc.pos_encoding[:n_subs].unsqueeze(0)
        safe, has_subs = keep_one(sub_mask)
        for layer in enc.transformer.layers:
            subs = encoder_layer(layer, subs, ~safe)
        out, _ = attend(enc.final_pool_attn, enc.final_pool_query, subs, subs, ~safe)
        return out.squeeze(1) * has_subs

    def forward(self, expr_integrals, expr_coeffs, expr_mask, sub_keys, sub_repl_ints, sub_repl_coeffs,
                sub_repl_mask, sub_mask, action_ibp_ops, action_deltas, action_mask, sector_mask,
                target_integral):
        m = self.m
        expr_mask, sub_mask = expr_mask.bool(), sub_mask.bool()
        enc = m.expr_enc
        terms = enc.term_proj(torch.cat([enc.integral_enc(expr_integrals.long()),
                                         enc.coeff_enc(expr_coeffs.long())], -1))
        target = enc.target_proj(enc.target_integral_enc(target_integral.long())).unsqueeze(1)
        seq = torch.cat([enc.cls_token, target, terms], 1)
        pad = ~torch.cat([torch.ones((1, 2), dtype=torch.bool), expr_mask], 1)
        for layer in enc.transformer.layers:
            seq = encoder_layer(layer, seq, pad)
        cls, tgt, per_term = enc.cls_output_proj(seq[:, 0]), enc.target_output_proj(seq[:, 1]), seq[:, 2:]

        subs = self.encode_subs(sub_keys.long(), sub_repl_ints.long(), sub_repl_coeffs.long(),
                                sub_repl_mask.bool(), sub_mask)
        sector = m.sector_enc(sector_mask.long())
        state = m.state_combine(torch.cat([cls, tgt, subs, sector], -1))
        actions = m.action_enc(action_ibp_ops.long(), action_deltas.long())

        sc = m.scorer
        attended = sc.action_proj(actions)
        expr_p = sc.expr_term_proj(per_term)
        attn = None
        for i in range(len(sc.cross_attn_layers)):
            out, attn = attend(sc.cross_attn_layers[i], attended, expr_p, expr_p, ~expr_mask)
            attended = sc.cross_attn_norms[i](attended + out)
            attended = sc.cross_attn_ffn_norms[i](attended + sc.cross_attn_ffn[i](attended))
        state_x = sc.state_proj(state).unsqueeze(1).repeat(1, attended.shape[1], 1)
        logits = sc.scorer(torch.cat([state_x, attended], -1)).squeeze(-1)
        return logits, attn


def sample_inputs(s):
    """Batch of one from a generator sample, in the order the training collate uses."""
    subs = s['subs'][:50] or []
    n_sub, n_repl = max(len(subs), 1), 20
    t = lambda x, **k: torch.tensor(x, dtype=torch.int32, **k)
    keys, ri, rc, rm, sm = (torch.zeros((1, n_sub, 7), dtype=torch.int32),
                            torch.zeros((1, n_sub, n_repl, 7), dtype=torch.int32),
                            torch.zeros((1, n_sub, n_repl), dtype=torch.int32),
                            torch.zeros((1, n_sub, n_repl), dtype=torch.int32),
                            torch.zeros((1, n_sub), dtype=torch.int32))
    for j, (k, repl) in enumerate(subs):
        keys[0, j], sm[0, j] = t(k), 1
        for r, (ki, c) in enumerate(repl[:n_repl]):
            ri[0, j, r], rc[0, j, r], rm[0, j, r] = t(ki), c, 1
    acts = s['valid_actions']
    return (t([[x[0] for x in s['expr']]]), t([[x[1] for x in s['expr']]]), torch.ones((1, len(s['expr'])), dtype=torch.int32),
            keys, ri, rc, rm, sm, t([[a[0] for a in acts]]), t([[a[1] for a in acts]]),
            torch.ones((1, len(acts)), dtype=torch.int32), t([s['sector_mask']]), t([s['target']]))


def load_samples(n):
    out = []
    for path in sorted((WORK_DIR / 'scrambles').glob('samples_*.jsonl')):
        with open(path) as f:
            for line in f:
                out.append(json.loads(line))
                if len(out) >= n:
                    return out
    return out


def main():
    model = load_trained_model()
    wrapped = ExportedClassifier(model).eval()
    samples = load_samples(400)
    example = next(s for s in samples if 3 <= len(s['subs']) <= 12 and len(s['expr']) > 4)
    args = sample_inputs(example)

    with torch.no_grad():
        for s in samples[:200]:
            a = sample_inputs(s)
            ref, _ = model(*[x.long() if x.dtype == torch.int32 else x for x in
                             (a[0], a[1], a[2].bool(), a[3], a[4], a[5], a[6].bool(), a[7].bool(),
                              a[8], a[9], a[10].bool(), a[11], a[12])])
            mine, _ = wrapped(*a)
            err = (ref - mine).abs().max().item()
            assert err < 1e-3, err
    print('wrapper matches the original model on 200 samples', flush=True)

    out = DEMO_DIR / 'model' / 'sailir.onnx'
    axes = {'expr_integrals': {1: 'T'}, 'expr_coeffs': {1: 'T'}, 'expr_mask': {1: 'T'}, 'sub_keys': {1: 'S'},
            'sub_repl_ints': {1: 'S', 2: 'R'}, 'sub_repl_coeffs': {1: 'S', 2: 'R'}, 'sub_repl_mask': {1: 'S', 2: 'R'},
            'sub_mask': {1: 'S'}, 'action_ibp_ops': {1: 'A'}, 'action_deltas': {1: 'A'}, 'action_mask': {1: 'A'},
            'logits': {1: 'A'}, 'attention': {1: 'A', 2: 'T'}}
    torch.onnx.export(wrapped, args, str(out), input_names=INPUTS, output_names=['logits', 'attention'],
                      dynamic_axes=axes, opset_version=17, dynamo=False, do_constant_folding=True)
    print('exported', out, round(out.stat().st_size / 1e6, 1), 'MB', flush=True)

    import onnxruntime as ort
    sess = ort.InferenceSession(str(out), providers=['CPUExecutionProvider'])
    used = set(i.name for i in sess.get_inputs())
    worst, top = 0.0, 0
    with torch.no_grad():
        for s in samples:
            a = sample_inputs(s)
            ref, _ = wrapped(*a)
            feed = {n: x.numpy() for n, x in zip(INPUTS, a) if n in used}
            logits, attn = sess.run(None, feed)
            worst = max(worst, float(np.abs(logits - ref.numpy()).max()))
            top += int(logits.argmax() == ref.numpy().argmax())
    print(f'onnxruntime vs PyTorch on {len(samples)} samples: max logit error {worst:.2e}, '
          f'same top action {top}/{len(samples)}', flush=True)


if __name__ == '__main__':
    main()
