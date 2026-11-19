# SAILIR demo

An interactive tour of [SAILIR](https://github.com/davidshih17/SAILIR), a self-supervised
transformer that reduces Feynman loop integrals one IBP identity at a time
([arXiv:2604.05034](https://arxiv.org/abs/2604.05034)).

**Live page: https://davidshih17.github.io/SAILIR-demo/**

The page is static. All computation happens in the visitor's browser, including the trained
model, which runs through ONNX Runtime Web.

## Run it locally

No build step and no network connection are needed after cloning:

```bash
git clone https://github.com/davidshih17/SAILIR-demo.git
cd SAILIR-demo
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from disk does not work, because
browsers block the data and model downloads on `file://` pages.

Keys `1` to `8` jump between sections.

## Where the numbers come from

| Page section | Source |
|---|---|
| Results, Training curves | `results/` in the SAILIR repository, unchanged |
| Reduce an integral yourself | `assets/js/ibp.js` and the published checkpoint, exported to `model/sailir.onnx` |
| Training data, Data explorer, Model | The published data generator, run on seeds outside the training range |
| Beam search, Full reduction | The published worker and orchestrator logic, rerun with the published checkpoint |

## Regenerating the data

The scripts in `tools/` need a checkout of the SAILIR repository and PyTorch.

```bash
export SAILIR_DIR=/path/to/SAILIR
cd tools
for k in 0 1 2 3 4 5 6 7; do python gen_scrambles.py --shard $k & done; wait
python eval_samples.py
python export_onnx.py
python make_vectors.py
python run_reduction.py --integral 1,1,2,1,1,1,-4 --out ../work/reduction_r7s4_v2.json
python curate_play.py
python build_data.py play
```

`tools/tests/test_ibp_port.mjs` replays random walks from the Python environment through the
JavaScript port and requires identical valid actions, expressions and substitutions.

Beam-search traces come from `tools/trace_beam.py`, which writes `../work/bt_<n>_K<K>.json`, one per
integral `n` and beam width `K`. Run `python build_data.py beam` after producing them.

## License

MIT. Third-party files in `vendor/` keep their own licenses.
