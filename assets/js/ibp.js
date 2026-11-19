// IBP arithmetic for the two-loop triangle-box family, ported from sailir/ibp_env.py.
// Expressions are Maps from an integral key "a0,a1,...,a6" to a coefficient in Z_p.
// Maps keep insertion order, matching the Python dicts this code mirrors.
export const PRIME = 1009;
const KIN = { d: 41, m1: 1, m2: 31, m3: 47 };

export const MASTERS = new Set([
  '0,1,1,1,0,0,0', '1,0,1,0,1,0,0', '1,1,0,1,1,0,0', '0,0,1,1,1,0,0',
  '1,0,1,1,1,0,0', '1,-1,1,1,1,0,0', '0,1,1,1,1,0,0', '-1,1,1,1,1,0,0',
  '1,1,1,1,1,0,0', '1,0,1,0,0,1,0', '1,1,0,1,0,1,0', '1,0,1,0,1,1,0',
  '1,-1,1,0,1,1,0', '1,0,0,1,1,1,0', '1,1,0,1,1,1,0', '1,0,1,1,1,1,0',
]);

export const OP_NAMES = [
  '∂/∂k₁ · k₁', '∂/∂k₂ · k₂', '∂/∂k₁ · p₁', '∂/∂k₂ · p₁',
  '∂/∂k₂ · k₁', '∂/∂k₁ · k₂', '∂/∂k₁ · p₂', '∂/∂k₂ · p₂', 'Lorentz invariance',
];

export const key = (a) => a.join(',');
export const parse = (k) => k.split(',').map(Number);
const mod = (x) => ((x % PRIME) + PRIME) % PRIME;

export function modInverse(a) {
  let [r0, r1, s0, s1] = [mod(a), PRIME, 1, 0];
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1);
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return mod(s0);
}

export function weight(a) {
  let r = 0, s = 0;
  for (const x of a) { if (x > 0) r += x; else s -= x; }
  return [r, s];
}

export const sectorOf = (a) => a.slice(0, 6).map((x) => (x > 0 ? 1 : 0));
export const inSector = (a, sector) => a.slice(0, 6).every((x, i) => (x > 0 ? 1 : 0) === sector[i]);
export const isMaster = (a) => MASTERS.has(key(a));

// Templates arrive as [[ [shift...], "coefficient expression" ], ...], one list per operator.
export class IBP {
  constructor(templates) {
    this.ops = templates.map((terms) => terms.map(([shift, src]) => ({
      shift,
      coeff: new Function('a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'd', 'm1', 'm2', 'm3',
        `return ${src.replaceAll('^', '**')};`),
    })));
    this.rawCache = new Map();
  }

  raw(op, seed) {
    const ck = `${op}|${key(seed)}`;
    let eq = this.rawCache.get(ck);
    if (eq) return eq;
    eq = new Map();
    for (const { shift, coeff } of this.ops[op]) {
      const c = mod(coeff(...seed, KIN.d, KIN.m1, KIN.m2, KIN.m3));
      if (c !== 0) eq.set(key(seed.map((x, i) => x + shift[i])), c);
    }
    this.rawCache.set(ck, eq);
    return eq;
  }

  // Valid (op, delta) pairs for a target, in the order enumerate_valid_actions_with_indirect_cache
  // returns them.  Both substitution maps are restricted to the exact sector first.
  validActions(target, state) {
    const sector = sectorOf(target);
    const subs = exactSectorSubs(state.subs, sector);
    const resolved = exactSectorSubs(state.resolved, sector);
    const tk = key(target);
    const valid = [];
    const seen = new Set();
    const consider = (op, seed, eq) => {
      if (outsideSector(eq, target)) return;
      const delta = seed.map((x, i) => x - target[i]);
      const id = `${op}|${key(delta)}`;
      if (!seen.has(id)) { seen.add(id); valid.push({ op, delta }); }
    };
    for (let op = 0; op < this.ops.length; op++) {
      for (const { shift } of this.ops[op]) {
        const seed = target.map((x, i) => x - shift[i]);
        const raw = this.raw(op, seed);
        if (!raw.get(tk)) continue;
        const cached = applyResolved(raw, resolved);
        if (!cached.get(tk)) continue;
        consider(op, seed, cached);
      }
    }
    for (const subKey of subs.keys()) {
      const subInt = parse(subKey);
      for (let op = 0; op < this.ops.length; op++) {
        for (const { shift } of this.ops[op]) {
          const seed = subInt.map((x, i) => x - shift[i]);
          const raw = this.raw(op, seed);
          if (!raw.get(subKey) || raw.get(tk)) continue;
          const cached = applyResolved(raw, resolved);
          if (!cached.get(tk)) continue;
          consider(op, seed, cached);
        }
      }
    }
    return valid;
  }

  // The identity an action uses, after the substitutions made so far.
  equation(state, target, { op, delta }) {
    const seed = target.map((x, i) => x + delta[i]);
    return { seed, raw: this.raw(op, seed), cached: applyResolved(this.raw(op, seed), state.resolved) };
  }

  apply(state, target, action) {
    const tk = key(target);
    const { cached } = this.equation(state, target, action);
    const pivot = cached.get(tk);
    if (!pivot) return null;
    const negInv = mod(PRIME - modInverse(pivot));
    const sol = new Map();
    for (const [k, v] of cached) if (k !== tk) sol.set(k, (negInv * v) % PRIME);
    const subs = new Map(state.subs);
    subs.set(tk, sol);
    return { expr: applySub(state.expr, tk, sol), subs, resolved: addResolved(state.resolved, tk, sol) };
  }
}

export const initialState = (integral) => ({
  expr: new Map([[key(integral), 1]]), subs: new Map(), resolved: new Map(),
});

function outsideSector(eq, target) {
  for (const k of eq.keys()) {
    const a = parse(k);
    for (let i = 0; i < 7; i++) if (target[i] <= 0 && a[i] > 0) return true;
  }
  return false;
}

function exactSectorSubs(subs, sector) {
  const out = new Map();
  for (const [k, repl] of subs) {
    const kept = new Map();
    for (const [t, c] of repl) if (inSector(parse(t), sector)) kept.set(t, c);
    if (kept.size) out.set(k, kept);
  }
  return out;
}

function dropZeros(m) {
  const out = new Map();
  for (const [k, v] of m) if (v !== 0) out.set(k, v);
  return out;
}

export function applySub(expr, subKey, sol) {
  if (!expr.has(subKey)) return expr;
  const coeff = expr.get(subKey);
  const out = new Map();
  for (const [k, v] of expr) if (k !== subKey) out.set(k, v);
  for (const [k, c] of sol) out.set(k, ((out.get(k) ?? 0) + coeff * c) % PRIME);
  return dropZeros(out);
}

export function applyResolved(expr, resolved) {
  if (!resolved.size) return new Map(expr);
  const out = new Map(expr);
  for (const k of [...out.keys()].filter((x) => resolved.has(x))) {
    const coeff = out.get(k);
    if (!coeff) continue;
    out.delete(k);
    for (const [t, c] of resolved.get(k)) out.set(t, ((out.get(t) ?? 0) + coeff * c) % PRIME);
  }
  return dropZeros(out);
}

function addResolved(resolved, target, sol) {
  const rsol = applyResolved(sol, resolved);
  const out = new Map();
  for (const [k, v] of resolved) out.set(k, new Map(v));
  out.set(target, rsol);
  for (const k of resolved.keys()) {
    const value = out.get(k);
    if (!value.has(target)) continue;
    const coeff = value.get(target);
    value.delete(target);
    for (const [t, c] of rsol) value.set(t, ((value.get(t) ?? 0) + coeff * c) % PRIME);
    out.set(k, dropZeros(value));
  }
  return out;
}

// Non-master integrals still to eliminate in the sector being reduced.
export function nonMasters(expr, sector) {
  return [...expr.keys()].map(parse).filter((a) => inSector(a, sector) && !isMaster(a));
}

// Highest weight first; ties broken as the data generator does, by ascending |a|.
export function pickTarget(expr, sector) {
  const cmp = (a, b) => {
    const [wa, wb] = [weight(a), weight(b)];
    if (wa[0] !== wb[0]) return wb[0] - wa[0];
    if (wa[1] !== wb[1]) return wb[1] - wa[1];
    for (let i = 0; i < 7; i++) {
      const d = Math.abs(a[i]) - Math.abs(b[i]);
      if (d) return d;
    }
    return 0;
  };
  return nonMasters(expr, sector).sort(cmp)[0] ?? null;
}

// Int32 tensors for the exported model, following prepare_batched_input_v5.
export function modelInputs(state, target, actions) {
  const sector = sectorOf(target);
  const terms = [...state.expr].filter(([k]) => inSector(parse(k), sector));
  const subs = [...state.subs].slice(-50);
  const nS = Math.max(subs.length, 1), R = 20, T = Math.max(terms.length, 1);
  const A = Math.min(actions.length, 900);
  const f = {
    expr_integrals: new Int32Array(T * 7), expr_coeffs: new Int32Array(T), expr_mask: new Int32Array(T),
    sub_keys: new Int32Array(nS * 7), sub_repl_ints: new Int32Array(nS * R * 7),
    sub_repl_coeffs: new Int32Array(nS * R), sub_repl_mask: new Int32Array(nS * R), sub_mask: new Int32Array(nS),
    action_ibp_ops: new Int32Array(A), action_deltas: new Int32Array(A * 7), action_mask: new Int32Array(A),
    sector_mask: Int32Array.from(sector), target_integral: Int32Array.from(target),
  };
  terms.forEach(([k, c], i) => { f.expr_integrals.set(parse(k), i * 7); f.expr_coeffs[i] = c; f.expr_mask[i] = 1; });
  subs.forEach(([k, repl], j) => {
    f.sub_mask[j] = 1;
    f.sub_keys.set(parse(k), j * 7);
    [...repl].slice(0, R).forEach(([t, c], r) => {
      f.sub_repl_ints.set(parse(t), (j * R + r) * 7);
      f.sub_repl_coeffs[j * R + r] = c;
      f.sub_repl_mask[j * R + r] = 1;
    });
  });
  actions.slice(0, A).forEach((a, i) => { f.action_ibp_ops[i] = a.op; f.action_deltas.set(a.delta, i * 7); f.action_mask[i] = 1; });
  const dims = {
    expr_integrals: [1, T, 7], expr_coeffs: [1, T], expr_mask: [1, T], sub_keys: [1, nS, 7],
    sub_repl_ints: [1, nS, R, 7], sub_repl_coeffs: [1, nS, R], sub_repl_mask: [1, nS, R], sub_mask: [1, nS],
    action_ibp_ops: [1, A], action_deltas: [1, A, 7], action_mask: [1, A], sector_mask: [1, 6], target_integral: [1, 7],
  };
  return { arrays: f, dims, terms: terms.map(([k]) => k) };
}
