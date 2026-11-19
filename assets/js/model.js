// Runs the published SAILIR classifier in the browser with ONNX Runtime Web.
import { modelInputs } from './ibp.js';

let sessionPromise = null;

export function loadModel(onProgress = () => {}) {
  sessionPromise ??= (async () => {
    const ort = await import('../../vendor/ort/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const res = await fetch(new URL('../../model/sailir.onnx', import.meta.url));
    if (!res.ok) throw new Error(`model download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 30947407;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(got / total, 1));
    }
    const bytes = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, session };
  })();
  return sessionPromise;
}

// Probabilities over the valid actions, plus each action's attention over the expression terms.
export async function scoreActions(state, target, actions) {
  const { ort, session } = await loadModel();
  const { arrays, dims, terms } = modelInputs(state, target, actions);
  const feeds = {};
  for (const name of session.inputNames) feeds[name] = new ort.Tensor('int32', arrays[name], dims[name]);
  const t0 = performance.now();
  const out = await session.run(feeds);
  const ms = performance.now() - t0;
  const logits = Array.from(out.logits.data);
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const T = terms.length, A = logits.length;
  const attn = out.attention.data;
  return {
    probs: exps.map((e) => e / sum), terms, ms,
    attention: Array.from({ length: A }, (_, i) => Array.from(attn.subarray(i * T, (i + 1) * T))),
  };
}
