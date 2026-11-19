// Loads and runs the classifier off the main thread, so the page keeps scrolling while it works.
import * as ort from '../../vendor/ort/ort.wasm.min.mjs';

ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = 1;

let session;

async function init() {
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
    self.postMessage({ type: 'progress', fraction: Math.min(got / total, 1) });
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  self.postMessage({ type: 'ready' });
}

async function run({ id, arrays, dims }) {
  const feeds = {};
  for (const name of session.inputNames) feeds[name] = new ort.Tensor('int32', arrays[name], dims[name]);
  const t0 = performance.now();
  const out = await session.run(feeds);
  const logits = Float32Array.from(out.logits.data), attention = Float32Array.from(out.attention.data);
  self.postMessage({ type: 'result', id, logits, attention, ms: performance.now() - t0 }, [logits.buffer, attention.buffer]);
}

self.onmessage = ({ data }) => {
  const job = data.type === 'init' ? init() : run(data);
  job.catch((err) => self.postMessage({ type: 'error', id: data.id, message: err.message }));
};
