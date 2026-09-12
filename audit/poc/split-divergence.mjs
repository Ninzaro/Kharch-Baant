// PASS 1.3 PoC: does calculateShares (live, used by every balance path) agree with
// materializeSplit (dead, largest-remainder rounding)?  READ-ONLY.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./ts-resolve-hook.mjs', pathToFileURL('./audit/poc/'));

const { calculateShares, materializeSplit, calculateGroupBalances, validateSplit, distributeRounding } =
  await import('../../utils/calculations.ts');

const P = (ids, values) => ids.map((id, i) => ({ personId: id, value: values ? values[i] : 1 }));
const tx = (amount, mode, participants, paidById = 'A') => ({
  id: 't1', groupId: 'g1', description: 'x', amount, paidById, date: '2026-01-01',
  tag: 'Food', splitMode: mode, split: { mode, participants }, type: 'expense',
});

const cases = [
  ['equal, 100 / 3',            100,   'equal',      P(['A','B','C'])],
  ['equal, 0.01 / 3',           0.01,  'equal',      P(['A','B','C'])],
  ['equal, 10 / 3',             10,    'equal',      P(['A','B','C'])],
  ['equal, 100 / 7',            100,   'equal',      P(['A','B','C','D','E','F','G'])],
  ['shares 1:1:1 of 100',       100,   'shares',     P(['A','B','C'], [1,1,1])],
  ['shares 1:2 of 10',          10,    'shares',     P(['A','B'], [1,2])],
  ['percentage 33.33/33.33/33.34 of 100', 100, 'percentage', P(['A','B','C'], [33.33,33.33,33.34])],
  ['percentage 100.009 total',  100,   'percentage', P(['A','B','C'], [33.34,33.34,33.329])],
  ['unequal 33.33/33.33/33.33 of 100', 100, 'unequal', P(['A','B','C'], [33.33,33.33,33.33])],
];

let diverged = 0;
for (const [label, amount, mode, participants] of cases) {
  const live = calculateShares(tx(amount, mode, participants));
  const dead = materializeSplit(mode, amount, participants);
  const ids = [...new Set([...live.keys(), ...dead.keys()])];
  const liveArr = ids.map(i => live.get(i));
  const deadArr = ids.map(i => dead.get(i));
  const liveSum = liveArr.reduce((a,b)=>a+(b??0),0);
  const deadSum = deadArr.reduce((a,b)=>a+(b??0),0);
  const same = ids.every(i => (live.get(i) ?? 0) === (dead.get(i) ?? 0));
  if (!same) diverged++;
  console.log(`\n[${same ? 'SAME' : 'DIVERGES'}] ${label}`);
  console.log(`  calculateShares (LIVE) : ${JSON.stringify(liveArr)}  sum=${liveSum}`);
  console.log(`  materializeSplit (DEAD): ${JSON.stringify(deadArr)}  sum=${deadSum}`);
  console.log(`  sum error vs amount    : live=${(liveSum-amount).toExponential(3)}  dead=${(deadSum-amount).toFixed(4)}`);
}
console.log(`\n=== ${diverged}/${cases.length} cases diverge ===`);

// What the user actually SEES: currency formatting rounds each share to 2dp.
const fmt = n => n.toFixed(2);
const t = tx(100, 'equal', P(['A','B','C']));
const live = [...calculateShares(t).values()];
const dead = [...materializeSplit('equal', 100, P(['A','B','C'])).values()];
console.log('\nDisplayed to user, amount=100, 3-way equal:');
console.log('  live  per-person:', live.map(fmt), ' displayed sum =', live.map(fmt).reduce((a,b)=>a+Number(b),0).toFixed(2));
console.log('  dead  per-person:', dead.map(fmt), ' displayed sum =', dead.map(fmt).reduce((a,b)=>a+Number(b),0).toFixed(2));

// validateSplit (dead) vs the inline check in TransactionFormModal (live).
console.log('\nvalidateSplit(dead) on percentage summing to 100.009:',
  JSON.stringify(validateSplit('percentage', 100, P(['A','B','C'],[33.34,33.34,33.329]))));
console.log('validateSplit(dead) on amount=0.001 equal:',
  JSON.stringify(validateSplit('equal', 0.001, P(['A','B']))));

// distributeRounding invariants
console.log('\ndistributeRounding([33.333..,x3],100) =', distributeRounding([100/3,100/3,100/3], 100));
console.log('distributeRounding with NEGATIVE remainder ([50.006,50.006],100) =', distributeRounding([50.006,50.006],100));
