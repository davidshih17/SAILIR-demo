// Runs the published SAILIR classifier in a background worker with ONNX Runtime Web.
import { modelInputs } from './ibp.js';

let worker = null, ready = null, nextId = 0;
const pending = new Map();

export function loadModel(onProgress = () => {}) {
  ready ??= new Promise((resolve, reject) => {
    worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (e) => reject(new Error(e.message || 'the model worker could not start'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data.fraction);
      else if (data.type === 'ready') resolve();
      else if (data.type === 'result') { pending.get(data.id).resolve(data); pending.delete(data.id); }
      else if (data.type === 'error') {
        if (data.id == null) reject(new Error(data.message));
        else { pending.get(data.id).reject(new Error(data.message)); pending.delete(data.id); }
      }
    };
    worker.postMessage({ type: 'init' });
  });
  return ready;
}

// Probabilities over the valid actions, plus each action's attention over the expression terms.
export async function scoreActions(state, target, actions) {
  await loadModel();
  const { arrays, dims, terms } = modelInputs(state, target, actions);
  const id = ++nextId;
  const out = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: 'run', id, arrays, dims }, Object.values(arrays).map((a) => a.buffer));
  });
  const logits = Array.from(out.logits);
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const T = terms.length, A = logits.length;
  return {
    probs: exps.map((e) => e / sum), terms, ms: out.ms,
    attention: Array.from({ length: A }, (_, i) => Array.from(out.attention.subarray(i * T, (i + 1) * T))),
  };
}
