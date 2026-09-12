// PASS 1.4 PoC — float money representation, rounding and per-surface display.
// Imports the APP'S OWN calculation code. Read-only: no network, no DB, no writes.
// Run: node --experimental-strip-types --import ./audit/poc/_register.mjs audit/poc/money-rounding.mts
import {
  calculateShares,
  calculateGroupBalances,
  simplifyGroupDebts,
  getUserFacingDebts,
  materializeSplit,
} from '../../utils/calculations.ts';

type Tx = any;

const tx = (o: Partial<Tx>): Tx => ({
  id: o.id ?? 't', groupId: o.groupId ?? 'g1', description: 'x',
  amount: o.amount ?? 0, paidById: o.paidById ?? 'A', date: '2026-01-01',
  tag: 'Food', type: o.type ?? 'expense', payers: o.payers,
  split: o.split ?? { mode: 'equal', participants: [] },
});
const eq = (ids: string[]) => ({ mode: 'equal', participants: ids.map(personId => ({ personId, value: 1 })) });

const hr = (t: string) => console.log('\n' + '='.repeat(72) + '\n' + t + '\n' + '='.repeat(72));

// ---- the four display surfaces, verbatim from the components -------------
// components/MemberBalances.tsx:23-25
const fmtMemberBalances = (v: number, ccy = 'INR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy }).format(v);
// components/Dashboard.tsx:34-36 (same formatter, but on simplified+rounded transfers)
const fmtDashboard = fmtMemberBalances;
// components/HomeScreen.tsx:31-33 (NO currency at all)
const fmtHomeScreen = (v: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
// components/BalanceBreakdownModal.tsx:58-63 (en-IN, NO currency)
const fmtBreakdown = (v: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
// components/TransactionItem.tsx:37-39 (ZERO decimals)
const fmtTxItem = (v: number, ccy = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }).format(v);
// components/SettleUpModal.tsx:130-132
const fmtSettle = (v: number, ccy = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: ccy, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
// components/GroupBalancesModal.tsx:132 etc — plain .toFixed(2)

// components/GroupSummaryCard.tsx:16-29 — its OWN balance loop (ignores payers)
const groupSummaryCardBalance = (txs: Tx[], me: string) => {
  let balance = 0;
  for (const t of txs) {
    const userShare = calculateShares(t).get(me) || 0;
    if (t.paidById === me) balance += (t.amount - userShare);
    else balance -= userShare;
  }
  return balance;
};

// ==========================================================================
hr('1. amount 100, equal, 3 ways  (utils/calculations.ts:41 — amount/participants.length)');
{
  const t = tx({ amount: 100, paidById: 'A', split: eq(['A', 'B', 'C']) });
  const shares = calculateShares(t);
  console.log('raw shares            :', [...shares].map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('shares sum            :', [...shares.values()].reduce((a, b) => a + b, 0));
  console.log('sum - amount          :', [...shares.values()].reduce((a, b) => a + b, 0) - 100);
  const bal = calculateGroupBalances([t]);
  console.log('balances              :', [...bal].map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('Σ balances            :', [...bal.values()].reduce((a, b) => a + b, 0));
  console.log('MemberBalances shows  :', [...bal].map(([k, v]) => `${k} ${fmtMemberBalances(v)}`).join('   '));
  console.log('  -> B and C each read -₹33.33, A reads ₹66.67; 33.33+33.33 = 66.66 ≠ 66.67 (a cent is invisible)');
  console.log('materializeSplit would:', [...materializeSplit('equal', 100, t.split.participants)]
    .map(([k, v]) => `${k}=${v}`).join('  '), ' <-- NOT CALLED BY ANY APP CODE');
}

hr('2. amount 10, equal, 3 ways  (the classic non-terminating case)');
{
  const t = tx({ amount: 10, paidById: 'A', split: eq(['A', 'B', 'C']) });
  const bal = calculateGroupBalances([t]);
  console.log('balances              :', [...bal].map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('Σ balances            :', [...bal.values()].reduce((a, b) => a + b, 0));
  console.log('MemberBalances shows  :', [...bal].map(([k, v]) => `${k} ${fmtMemberBalances(v)}`).join('   '));
  const tr = simplifyGroupDebts(bal);
  console.log('simplifyGroupDebts    :', tr.map(t2 => `${t2.from}->${t2.to} ${t2.amount}`).join('  '));
  console.log('transfers sum         :', tr.reduce((s, x) => s + x.amount, 0), '(A is owed', bal.get('A'), ')');
}

hr('3. percentage 33.33 / 33.33 / 33.34 of 100  (client validation passes: |100-100|<0.01)');
{
  const t = tx({
    amount: 100, paidById: 'A',
    split: { mode: 'percentage', participants: [
      { personId: 'A', value: 33.33 }, { personId: 'B', value: 33.33 }, { personId: 'C', value: 33.34 }] },
  });
  const shares = calculateShares(t);
  console.log('raw shares            :', [...shares].map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('shares sum            :', [...shares.values()].reduce((a, b) => a + b, 0));
  console.log('sum - amount          :', [...shares.values()].reduce((a, b) => a + b, 0) - 100);
  console.log('Σ balances            :', [...calculateGroupBalances([t]).values()].reduce((a, b) => a + b, 0));
}

hr('4. shares 1:1:1 of amount 1  (₹1 split three ways)');
{
  const t = tx({
    amount: 1, paidById: 'A',
    split: { mode: 'shares', participants: [
      { personId: 'A', value: 1 }, { personId: 'B', value: 1 }, { personId: 'C', value: 1 }] },
  });
  const bal = calculateGroupBalances([t]);
  console.log('balances              :', [...bal].map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('MemberBalances shows  :', [...bal].map(([k, v]) => `${k} ${fmtMemberBalances(v)}`).join('   '));
  console.log('TransactionItem shows :', fmtTxItem(1), ' <-- maximumFractionDigits:0 on the amount itself');
  const tr = simplifyGroupDebts(bal);
  console.log('simplifyGroupDebts    :', tr.length === 0 ? '(none — every |balance| <= BALANCE_EPS 0.01)'
    : tr.map(t2 => `${t2.from}->${t2.to} ${t2.amount}`).join('  '));
  console.log('  -> Dashboard "Total Balance" for A =', fmtDashboard(0), 'while MemberBalances shows', fmtMemberBalances(bal.get('A')!));
}

hr('5. ten separate ₹0.10 expenses, A pays, split A+B  (float accumulation)');
{
  const txs = Array.from({ length: 10 }, (_, i) =>
    tx({ id: 't' + i, amount: 0.1, paidById: 'A', split: eq(['A', 'B']) }));
  const bal = calculateGroupBalances(txs);
  console.log('A balance             :', bal.get('A'));
  console.log('B balance             :', bal.get('B'));
  console.log('Σ balances            :', bal.get('A')! + bal.get('B')!);
  console.log('exact answer          : A=+0.5  B=-0.5');
  console.log('A error               :', bal.get('A')! - 0.5);
  console.log('MemberBalances shows  :', `A ${fmtMemberBalances(bal.get('A')!)}   B ${fmtMemberBalances(bal.get('B')!)}`);
  const tr = simplifyGroupDebts(bal);
  console.log('Dashboard transfer    :', tr.map(t2 => `${t2.from}->${t2.to} ${t2.amount}`).join('  '));
}

hr('6. ZERO-SUM RESIDUE — 40 equal 3-way expenses of ₹100');
{
  const txs = Array.from({ length: 40 }, (_, i) =>
    tx({ id: 't' + i, amount: 100, paidById: ['A', 'B', 'C'][i % 3], split: eq(['A', 'B', 'C']) }));
  const bal = calculateGroupBalances(txs);
  const sum = [...bal.values()].reduce((a, b) => a + b, 0);
  console.log('balances              :', [...bal].map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('Σ balances            :', sum, ' (exact answer: 0)');
  console.log('|Σ| in cents          :', Math.abs(sum) * 100);
  console.log('App.tsx:138 allSettled:', [...bal.values()].every(b => Math.abs(b) < 0.01));
}

hr('7. THE EPSILON HOLE — allSettled is per-person, so the loss scales with member count');
{
  // Each pair is settled by one ₹0.01 expense split two ways: +0.005 / -0.005.
  // Every |balance| = 0.005 < 0.01, so App.tsx:138 says "all settled".
  const txs: Tx[] = [];
  for (let i = 0; i < 10; i++)
    txs.push(tx({ id: 'p' + i, amount: 0.01, paidById: 'C' + i, split: eq(['C' + i, 'D' + i]) }));
  const bal = calculateGroupBalances(txs);
  const creditors = [...bal.values()].filter(v => v > 0).reduce((a, b) => a + b, 0);
  console.log('20-person group, ten ₹0.01 expenses; every |balance| =', bal.get('C0'));
  console.log('App.tsx:138 allSettled:', [...bal.values()].every(b => Math.abs(b) < 0.01), ' <-- TRUE');
  console.log('real credit outstanding:', creditors.toFixed(4), '(each creditor rounds UP to ₹0.01 on screen)');
  console.log('MemberBalances shows  :', `C0 ${fmtMemberBalances(bal.get('C0')!)}  D0 ${fmtMemberBalances(bal.get('D0')!)}`);
  console.log('=> deleteGroup(..., allSettled=true) is permitted (supabaseApiService.ts:8-10)');
  console.log('   and it hard-deletes every transaction row (supabaseApiService.ts:11-17).');
  console.log('Bound on this hole    : (members/2) x 0.00999 per group. Small on its own;');
  console.log('   the *large* version of the same gate is the empty-cache case — see zero-sum.mts Z8.');
}

hr('8. SURFACE DISAGREEMENT — same data, four different numbers');
{
  // Group of 3. A pays 100 (3-way), B pays 100 (3-way), C pays 0.
  const txs = [
    tx({ id: 't1', amount: 100, paidById: 'A', split: eq(['A', 'B', 'C']) }),
    tx({ id: 't2', amount: 100, paidById: 'B', split: eq(['A', 'B', 'C']) }),
  ];
  const groups = [{ id: 'g1', isArchived: false }];
  const bal = calculateGroupBalances(txs);
  const tr = simplifyGroupDebts(bal);
  const debts = getUserFacingDebts('A', groups, txs);

  console.log('raw balances          :', [...bal].map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('MemberBalances (A)    :', fmtMemberBalances(bal.get('A')!), '   raw', bal.get('A'));
  let owed = 0; for (const t2 of tr) if (t2.to === 'A') owed += t2.amount;
  console.log('Dashboard "you are owed" (A):', fmtDashboard(Math.round(owed * 100) / 100), '  raw', owed);
  console.log('HomeScreen totalOwedToUser  :', fmtHomeScreen(debts.totalOwedToUser), ' raw', debts.totalOwedToUser);
  console.log('BalanceBreakdown lines      :', debts.owedToUser.map(l => `${l.personId} ${fmtBreakdown(l.amount)}`).join('  '));
  console.log('GroupSummaryCard (A)  :', groupSummaryCardBalance(txs, 'A'));
  console.log('transfers             :', tr.map(t2 => `${t2.from}->${t2.to} ${t2.amount}`).join('  '));
  console.log('Σ transfers into A    :', owed, ' vs A balance', bal.get('A'), ' delta', owed - bal.get('A')!);
}

hr('9. simplifyGroupDebts rounding: 1 creditor of 100, 3 debtors of 33.333…');
{
  const txs = [tx({ id: 't1', amount: 100, paidById: 'A', split: eq(['B', 'C', 'D']) })];
  const bal = calculateGroupBalances(txs);
  const tr = simplifyGroupDebts(bal);
  console.log('balances              :', [...bal].map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('transfers             :', tr.map(t2 => `${t2.from}->${t2.to} ${t2.amount}`).join('  '));
  const sum = tr.reduce((s, x) => s + x.amount, 0);
  console.log('Σ transfers           :', sum, ' vs creditor balance', bal.get('A'));
  console.log('creditor SHORT by     :', (bal.get('A')! - sum).toFixed(4), '(each transfer rounded to cents at calculations.ts:192)');
  console.log('Dashboard shows A owed:', fmtDashboard(Math.round(sum * 100) / 100),
    ' but MemberBalances shows', fmtMemberBalances(bal.get('A')!));
  console.log('If all three debtors pay exactly what the app tells them (33.33 each),');
  console.log('A receives 99.99 and the ledger still says A is owed', (bal.get('A')! - 99.99).toFixed(4));
}

hr('10. LOCALE SPLIT-BRAIN — the same total, two different digit groupings');
{
  const v = 100000.5;
  console.log('HomeScreen  card  (en-US, no currency):', fmtHomeScreen(v));
  console.log('BalanceBreakdown  (en-IN, no currency):', fmtBreakdown(v));
  console.log('MemberBalances (en-US, INR)          :', fmtMemberBalances(v));
  console.log('SettleUpModal  (en-IN, INR)          :', fmtSettle(v));
  console.log('TransactionItem(en-IN, INR, 0 dp)    :', fmtTxItem(v));
  console.log('GroupBalancesModal (.toFixed(2)+code):', v.toFixed(2), 'INR');
}

hr('11. numeric(12,2) round-trip — what Postgres stores vs what the client believed');
{
  // Postgres numeric(12,2) rounds half-up on INSERT. Client never re-reads before display.
  const typed = [0.005, 33.335, 2.675, 1.005, 100.555];
  for (const v of typed) {
    const pg = Math.round(v * 100) / 100;               // approximation of numeric(12,2)
    console.log(`typed ${String(v).padEnd(9)} JS toFixed(2)=${v.toFixed(2)}  stored≈${pg.toFixed(2)}  delta=${(pg - v).toFixed(4)}`);
  }
  console.log('note: 2.675.toFixed(2) =', (2.675).toFixed(2), '(JS says 2.67, Postgres numeric says 2.68)');
  console.log('=> a client-side preview and the stored row can differ by a cent before any split maths.');
}
