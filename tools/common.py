"""Shared paths and model loading for the demo's data-preparation tools.

Set SAILIR_DIR to a checkout of https://github.com/davidshih17/SAILIR.
"""
import os
import sys
from pathlib import Path

DEMO_DIR = Path(__file__).resolve().parents[1]
SAILIR_DIR = Path(os.environ.get('SAILIR_DIR', DEMO_DIR.parent / 'SAILIR')).resolve()
WORK_DIR = Path(os.environ.get('SAILIR_DEMO_WORK', DEMO_DIR / 'work')).resolve()
CKPT = Path(os.environ.get('SAILIR_CKPT', SAILIR_DIR / 'checkpoints/best_model.pt'))
DATA_DIR = DEMO_DIR / 'data'

for sub in ('scripts/eval', 'sailir'):
    sys.path.insert(0, str(SAILIR_DIR / sub))


def load_trained_model(device='cpu'):
    """Build the classifier with the hyperparameters recorded in the checkpoint.

    The prime matters: coefficients above p/2 are folded to negative values
    before encoding, so the model must be built with the prime it was trained on.
    """
    import torch
    from classifier import IBPActionClassifier
    ck = torch.load(CKPT, map_location=device, weights_only=False)
    a = ck['args']
    model = IBPActionClassifier(embed_dim=a['embed_dim'], n_heads=a['n_heads'],
                                n_expr_layers=a['n_expr_layers'], n_cross_layers=a['n_cross_layers'],
                                n_subs_layers=a['n_subs_layers'], prime=a['prime'])
    model.load_state_dict(ck['model_state_dict'])
    model.to(device).eval()
    return model
