// Replays Python random walks through assets/js/ibp.js and requires identical results.
import { readFileSync } from 'node:fs';
import { IBP, initialState, key, pickTarget, sectorOf } from '../../assets/js/ibp.js';

const [templatesPath, vectorsPath] = process.argv.slice(2);
const ibp = new IBP(JSON.parse(readFileSync(templatesPath)));
const walks = JSON.parse(readFileSync(vectorsPath));
const same = (a, b, what) => { const [x, y] = [JSON.stringify(a), JSON.stringify(b)]; if (x !== y) throw new Error(`${what}\n js ${x.slice(0, 400)}\n py ${y.slice(0, 400)}`); };
const dump = (m) => [...m].map(([k, v]) => [k.split(',').map(Number), v]);
const dumpSubs = (m) => [...m].map(([k, v]) => [k.split(',').map(Number), dump(v)]);
let nSteps = 0, nActions = 0;
for (const w of walks) {
  let st = initialState(w.start);
  const sector = sectorOf(w.start);
  for (const s of w.steps) {
    const target = pickTarget(st.expr, sector);
    same(target, s.target, 'target');
    const valid = ibp.validActions(target, st);
    same(valid.map((a) => [a.op, a.delta]), s.valid, 'valid actions');
    st = ibp.apply(st, target, { op: s.pick[0], delta: s.pick[1] });
    same(dump(st.expr), s.expr, 'expression');
    same(dumpSubs(st.subs), s.subs, 'subs');
    same(dumpSubs(st.resolved), s.resolved, 'resolved subs');
    nSteps++; nActions += valid.length;
  }
}
console.log(`PASS: ${walks.length} walks, ${nSteps} steps, ${nActions} valid actions identical to Python`);
