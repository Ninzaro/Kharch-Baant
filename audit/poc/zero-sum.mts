// PASS 1.4 PoC — the zero-sum invariant. Every scenario below is a row the app's
// own write paths can produce. Uses the APP'S OWN calculateGroupBalances.
// Read-only: no network, no DB, no writes to app files.
// Run: node --experimental-strip-types --import ./audit/poc/_register.mjs audit/poc/zero-sum.mts
import { calculateGroupBalances, calculateShares } from '../../utils/calculations.ts';

type Tx = any;
const tx = (o: Partial<Tx>): Tx => ({
  id: o.id ?? 't', groupId: 'g1', description: 'x',
  amount: o.amount ?? 0, paidById: o.paidById ?? 'A', date: '2026-01-01',
  tag: 'Food', type: o.type ?? 'expense', payers: o.payers,
  split: o.split ?? { mode: 'equal', participants: [] },
});
const eq = (ids: string[]) => ({ mode: 'equal', participants: ids.map(personId => ({ personId, value: 1 })) });

const report = (label: string, txs: Tx[]) => {
  const bal = calculateGroupBalances(txs);
  const sum = [...bal.values()].reduce((a, b) => a + b, 0);
  console.log(`  balances : ${[...bal].map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`  Σ        : ${sum}`);
  console.log(`  VERDICT  : ${Math.abs(sum) < 1e-9 ? 'zero-sum HOLDS' : `ZERO-SUM BROKEN by ${sum > 0 ? '+' : ''}${sum.toFixed(2)} (${sum > 0 ? 'money CREATED' : 'money DESTROYED'})`}`);
  console.log(`  allSettled (App.tsx:138): ${[...bal.values()].every(b => Math.abs(b) < 0.01)}`);
  return sum;
};
const hr = (t: string) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

// ============================================================================
hr('Z1. MULTI-PAYER: payers[] sum != amount  (TransactionFormModal.tsx:286 never checks isPayerValid)');
console.log(`Reachable UI steps:
  Add Expense -> Amount 1000 -> "Multiple Payers?" -> type A=400, B=100 -> Save.
  The form renders "Total: Rs 500.00 / Rs 1000.00" in red (TransactionFormModal.tsx:470-471)
  but the Save button's disabled test is only  !isSplitValid || !description || !amount
  (:687) and handleSubmit's guard (:286) also omits isPayerValid. The row is written.
Stored row: amount=1000, payers=[{A,400},{B,100}], split equal over A,B,C.
calculateGroupBalances (calculations.ts:8-19) credits payers[].amount and debits amount/3.`);
report('Z1', [tx({ id: 'z1', amount: 1000, paidById: 'A', payers: [{ personId: 'A', amount: 400 }, { personId: 'B', amount: 100 }], split: eq(['A', 'B', 'C']) })]);

hr('Z1b. Same bug via EDIT (most natural path of all)');
console.log(`  Existing multi-payer expense: amount 1000, payers A=600 B=400. Correct.
  User opens Edit and changes only the Amount to 2000. payerMode is seeded to
  'multiple' from the row (TransactionFormModal.tsx:146-150); customPayerValues
  still sum to 1000. isSplitValid is TRUE (equal mode). Save is enabled. Saved.`);
console.log('  BEFORE (amount 1000, payers 1000):');
report('ok', [tx({ id: 'z1b', amount: 1000, paidById: 'A', payers: [{ personId: 'A', amount: 600 }, { personId: 'B', amount: 400 }], split: eq(['A', 'B']) })]);
console.log('  AFTER  (amount 2000, payers still 1000):');
report('bad', [tx({ id: 'z1b', amount: 2000, paidById: 'A', payers: [{ personId: 'A', amount: 600 }, { personId: 'B', amount: 400 }], split: eq(['A', 'B']) })]);

hr('Z1c. Negative payer amount is silently DROPPED, not rejected');
console.log(`  TransactionFormModal.tsx:481-490 has no min= on the payer input; :325 keeps
  only  val && val > 0. Type A=1500, B=-500 with amount 1000:
  payersTotal = 1000 so the form shows GREEN "Total: Rs 1000.00", yet the row
  written is payers=[{A,1500}] — B's -500 is filtered out of activePayers.`);
report('Z1c', [tx({ id: 'z1c', amount: 1000, paidById: 'A', payers: [{ personId: 'A', amount: 1500 }], split: eq(['A', 'B']) })]);

hr('Z2. NEGATIVE SHARE via unequal split (no min= on the split input, :564-572)');
console.log(`  Amount 100, mode "Unequally", type A = -50, B = 150.
  isSplitValid: |(-50+150) - 100| = 0 < 0.01 -> PASSES (:194).
  Server: split_participants is unconstrained JSONB.
  Result: A is CREDITED 50 by a debit of -50 (calculations.ts:48-51).`);
report('Z2', [tx({ id: 'z2', amount: 100, paidById: 'B', split: { mode: 'unequal', participants: [{ personId: 'A', value: -50 }, { personId: 'B', value: 150 }] } })]);
console.log('  (zero-sum holds — but A owes MINUS fifty, i.e. B now owes A 50 on a bill B paid.)');

hr('Z2b. NEGATIVE PERCENTAGE — same trick, -50% / 150%');
console.log('  isSplitValid: |(-50+150) - 100| = 0 < 0.01 -> PASSES (:198).');
report('Z2b', [tx({ id: 'z2b', amount: 100, paidById: 'B', split: { mode: 'percentage', participants: [{ personId: 'A', value: -50 }, { personId: 'B', value: 150 }] } })]);

hr('Z3. EPSILON DRIFT — unequal split allowed to miss by up to 0.00999 per row');
console.log('  Amount 100, unequal 33.334 / 33.334 / 33.334 -> sum 100.002, |delta| = 0.002 < 0.01 -> PASSES.');
{
  const one = tx({ id: 'z3', amount: 100, paidById: 'A', split: { mode: 'unequal', participants: [{ personId: 'A', value: 33.334 }, { personId: 'B', value: 33.334 }, { personId: 'C', value: 33.334 }] } });
  report('one row', [one]);
  const many = Array.from({ length: 500 }, (_, i) => ({ ...one, id: 'z3_' + i }));
  console.log('  500 such rows (a year of a busy flat-share):');
  report('500 rows', many);
}
console.log('  Percentage variant: 33.33 / 33.33 / 33.33 = 99.99, |99.99-100| = 0.01 -> BLOCKED (strict <).');
console.log('  Percentage variant: 33.331 / 33.331 / 33.331 = 99.993 -> |0.007| < 0.01 -> PASSES:');
report('pct 99.993', [tx({ id: 'z3b', amount: 100, paidById: 'A', split: { mode: 'percentage', participants: [{ personId: 'A', value: 33.331 }, { personId: 'B', value: 33.331 }, { personId: 'C', value: 33.331 }] } })]);

hr('Z4. STORED ROWS THAT VIOLATE THE INVARIANT (modified client / direct PostgREST; server has no CHECK)');
console.log('  unequal shares summing to 99 on a 100 expense:');
report('unequal 99', [tx({ id: 'z4a', amount: 100, paidById: 'A', split: { mode: 'unequal', participants: [{ personId: 'A', value: 50 }, { personId: 'B', value: 49 }] } })]);
console.log('  percentages summing to 110:');
report('pct 110', [tx({ id: 'z4b', amount: 100, paidById: 'A', split: { mode: 'percentage', participants: [{ personId: 'A', value: 55 }, { personId: 'B', value: 55 }] } })]);
console.log('  EMPTY participants array (calculations.ts:35 returns early; payer still credited):');
report('empty split', [tx({ id: 'z4c', amount: 100, paidById: 'A', split: { mode: 'equal', participants: [] } })]);
console.log('  shares mode with every value 0 (calculations.ts:62 breaks out; payer still credited):');
report('shares all 0', [tx({ id: 'z4d', amount: 100, paidById: 'A', split: { mode: 'shares', participants: [{ personId: 'A', value: 0 }, { personId: 'B', value: 0 }] } })]);
console.log('  participant who is NOT a group member (no FK, no CHECK on split_participants):');
report('outsider', [tx({ id: 'z4e', amount: 100, paidById: 'A', split: eq(['A', 'STRANGER']) })]);

hr('Z5. SETTLEMENT OVER-PAYMENT — no check against the outstanding balance');
{
  const expense = tx({ id: 's1', amount: 100, paidById: 'A', split: eq(['A', 'B']) });
  console.log('  Before: B owes A 50.');
  report('before', [expense]);
  const settle = tx({ id: 's2', amount: 500, paidById: 'B', type: 'settlement', split: { mode: 'unequal', participants: [{ personId: 'B', value: 0 }, { personId: 'A', value: 500 }] } });
  console.log('  B records a Rs 500 settlement to A (SettleUpModal.tsx:139-160 checks only');
  console.log('  payer && receiver && payer!=receiver && amount>0 — never the balance):');
  report('after', [expense, settle]);
  console.log('  A now owes B 450. No warning, no confirmation, no cap.');
}

hr('Z6. DOUBLE SETTLEMENT — two devices settle the same debt (no idempotency, no version)');
{
  const expense = tx({ id: 's1', amount: 100, paidById: 'A', split: eq(['A', 'B']) });
  const s = (id: string) => tx({ id, amount: 50, paidById: 'B', type: 'settlement', split: { mode: 'unequal', participants: [{ personId: 'B', value: 0 }, { personId: 'A', value: 50 }] } });
  console.log('  B settles 50 on the phone; A, whose cache has not yet received it, also');
  console.log('  records the same 50 on the laptop. Two rows, no unique constraint:');
  report('double', [expense, s('x1'), s('x2')]);
  console.log('  A is now the debtor for the 50 that was already paid.');
}

hr('Z7. STALE-BALANCE SETTLEMENT — device B settles against a balance that is already wrong');
{
  const e1 = tx({ id: 'e1', amount: 100, paidById: 'A', split: eq(['A', 'B']) });
  console.log('  Device B sees only e1: B owes A 50. B settles 50 -> B thinks it is square.');
  const s1 = tx({ id: 's1', amount: 50, paidById: 'B', type: 'settlement', split: { mode: 'unequal', participants: [{ personId: 'B', value: 0 }, { personId: 'A', value: 50 }] } });
  report('device B view', [e1, s1]);
  console.log('  Meanwhile A had already added e2 (200, split A+B) that B had not received:');
  const e2 = tx({ id: 'e2', amount: 200, paidById: 'A', split: eq(['A', 'B']) });
  report('truth', [e1, e2, s1]);
  console.log('  B still owes 100. Nothing told B the number moved between reading it and paying.');
}

hr('Z8. THE allSettled GATE — an empty transactions cache reads as "fully settled"');
{
  console.log('  App.tsx:131-139:');
  console.log('    groupBalances = Object.fromEntries(calculateGroupBalances(groupTxs))');
  console.log('    allSettled    = Object.values(groupBalances).every(b => Math.abs(b) < 0.01)');
  const empty: Record<string, number> = {};
  console.log('  With groupTxs = [] -> groupBalances = {} -> allSettled =',
    Object.values(empty).every((b: any) => Math.abs(b) < 0.01), ' <-- Array.prototype.every on [] is TRUE');
  console.log(`
  Three ways groupTxs is [] while real debts exist:
   (a) FIRST PAINT. App.tsx:578 gates the loading screen on  isLoading || groupsLoading.
       isLoading (App.tsx:85,246-278) tracks only the invite-acceptance effect, and
       useTransactionsQuery's own isLoading is DISCARDED (App.tsx:53). So the group
       screen renders with transactions = [] until the transactions query resolves.
   (b) TRANSIENT FETCH FAILURE. getTransactions (supabaseApiService.ts:506-512) swallows
       a group_members error with console.warn and returns [].
   (c) RLS/REALTIME GAP. Balances are per-device; a device missing rows is silently wrong.

  Consequence: GroupFormModal.tsx:253 enables "Delete Group" (disabled={!allSettled}),
  App.tsx:546 calls deleteGroup(id, uid, true, allSettled=true), and
  supabaseApiService.ts:8-18 then DELETEs every group_members row, every transactions
  row, and the group. Unrecoverable: no soft delete, no audit table, no backup path.`);
}

hr('Z9. AGGREGATE EPSILON LOSS — everybody under 0.01, real money outstanding');
{
  // 10 pairs, each pair settled by a 0.01 expense split two ways.
  const txs: Tx[] = [];
  for (let i = 0; i < 10; i++) {
    txs.push(tx({ id: 'p' + i, amount: 0.01, paidById: 'C' + i, split: eq(['C' + i, 'D' + i]) }));
  }
  const bal = calculateGroupBalances(txs);
  const creditors = [...bal.values()].filter(v => v > 0).reduce((a, b) => a + b, 0);
  console.log('  20-person group, ten Rs 0.01 expenses. Every |balance| = 0.005:');
  console.log('  allSettled :', [...bal.values()].every(b => Math.abs(b) < 0.01));
  console.log('  real credit outstanding:', creditors.toFixed(4), '(each creditor rounds up to Rs 0.01 on screen)');
  console.log('  Upper bound on this hole: (members/2) x 0.00999 per group, deleted without trace.');
}

hr('Z10. ORPHANED MONEY — a member removed while owing');
{
  const txs = [tx({ id: 'o1', amount: 300, paidById: 'A', split: eq(['A', 'B', 'GONE']) })];
  const bal = calculateGroupBalances(txs);
  console.log('  A paid 300 split three ways with B and GONE. Then the creator opens Group');
  console.log('  Settings and removes GONE (GroupFormModal.tsx:115-118 — no balance check),');
  console.log('  and updateGroup (supabaseApiService.ts:349-369) DELETEs all group_members');
  console.log('  and re-inserts without GONE. The transaction row is untouched.');
  console.log('  balances (App.tsx:131-135, from transactions):',
    [...bal].map(([k, v]) => `${k}=${v.toFixed(2)}`).join('  '));
  console.log('  allSettled:', [...bal.values()].every(b => Math.abs(b) < 0.01), '-> Delete/Archive stay disabled FOREVER');
  console.log('  MemberBalances (components/MemberBalances.tsx:34-35) is fed people=groupMembers,');
  console.log('  so peopleMap.get("GONE") is undefined and the row RETURNS NULL — the -100 line');
  console.log('  is invisible. getPeople (supabaseApiService.ts:765-810) also stops returning');
  console.log('  GONE because it derives `people` from group_members alone.');
  console.log('  Visible balances only :', [...bal].filter(([k]) => k !== 'GONE').map(([k, v]) => `${k}=${v.toFixed(2)}`).join('  '),
    ' -> Σ =', [...bal].filter(([k]) => k !== 'GONE').reduce((s, [, v]) => s + v, 0).toFixed(2));
  console.log('  The user sees A owed 200 and B owing 100 and no reason why "not settled".');
}

hr('SUMMARY');
console.log(`  Nothing in the client, in PostgREST, in a CHECK constraint, in a trigger or in
  an RPC ever asserts that Sum(balances) = 0 for a group, that Sum(payers[].amount) =
  amount, that Sum(split_participants[].value) = amount / 100 / >0, that a
  participant's value is non-negative, or that a participant is a group member.
  grep -rn "payers" over every .sql in the repo returns nothing: the column was
  added to production by hand and has no constraint at all.`);
