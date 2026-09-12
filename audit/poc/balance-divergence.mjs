// PASS 1.3 PoC - do the app's balance / display pipelines agree on the same data?
// The canonical implementation is imported from the real utils/calculations.ts.
// The component-local implementations live inside .tsx files (cannot be imported in
// node), so they are TRANSCRIBED verbatim from the cited lines. READ-ONLY.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./ts-resolve-hook.mjs', pathToFileURL('./audit/poc/'));
const { calculateGroupBalances, simplifyGroupDebts, getUserFacingDebts, calculateShares } =
  await import('../../utils/calculations.ts');

// -- transcription of components/GroupSummaryCard.tsx:16-29 (Home screen group card)
const groupSummaryCardBalance = (txs, me) => {
  let balance = 0;
  txs.forEach(t => {
    const userShare = calculateShares(t).get(me) || 0;
    if (t.paidById === me) balance += (t.amount - userShare);
    else balance -= userShare;
  });
  return balance;
};

// -- transcription of components/GroupBalancesModal.tsx:23-46 ("Balances" modal)
const groupBalancesModal = (txs, people) => {
  const balances = {};
  people.forEach(p => balances[p] = 0);
  txs.forEach(t => {
    if (t.type === 'settlement') {
      const rec = t.split.participants.find(p => p.personId !== t.paidById);
      if (rec) { balances[t.paidById] += t.amount; balances[rec.personId] -= t.amount; }
    } else if (t.split) {
      balances[t.paidById] += t.amount;
      calculateShares(t).forEach((share, pid) => { balances[pid] -= share; });
    }
  });
  return balances;
};

// -- transcription of components/Dashboard.tsx:17-32 (group screen hero card)
const dashboard = (txs, me) => {
  const transfers = simplifyGroupDebts(calculateGroupBalances(txs));
  let owed = 0, owe = 0;
  for (const t of transfers) {
    if (t.to === me) owed += t.amount; else if (t.from === me) owe += t.amount;
  }
  return { owed: Math.round(owed * 100) / 100, owe: Math.round(owe * 100) / 100,
           net: Math.round((owed - owe) * 100) / 100 };
};

const tx = (o) => ({ id: 't', groupId: 'g1', description: 'd', date: '2026-01-01',
                     tag: 'Food', type: 'expense', ...o });

console.log('====== CASE 1: MULTI-PAYER EXPENSE (a headline feature of this app) ======');
console.log('Dinner 100. A paid 60, B paid 40. Split equally between A and B.');
const multi = [tx({ amount: 100, paidById: 'A',
  payers: [{ personId: 'A', amount: 60 }, { personId: 'B', amount: 40 }],
  split: { mode: 'equal', participants: [{ personId: 'A', value: 1 }, { personId: 'B', value: 1 }] } })];

const canonical = calculateGroupBalances(multi);
console.log('  calculateGroupBalances  (GroupView / MemberBalances / SettleUpModal / App.allSettled)');
console.log('      A =', canonical.get('A'), '  B =', canonical.get('B'));
console.log('  GroupSummaryCard:16-29  (the card on the Home screen)');
console.log('      A =', groupSummaryCardBalance(multi, 'A'), '  B =', groupSummaryCardBalance(multi, 'B'));
console.log('  GroupBalancesModal:23-46 ("Balances" modal inside the group)');
console.log('     ', groupBalancesModal(multi, ['A', 'B']));
console.log('  Dashboard:17-32 (hero card, group screen), for A:', dashboard(multi, 'A'));
const ufd = getUserFacingDebts('A', [{ id: 'g1' }], multi);
console.log('  getUserFacingDebts (HomeScreen totals + BalanceBreakdownModal), for A:');
console.log('      owed =', ufd.totalOwedToUser, ' owes =', ufd.totalUserOwes, ' net =', ufd.netBalance);

console.log('');
console.log('====== CASE 2: MULTI-PAYER, ONE PAYER NOT A PARTICIPANT ======');
console.log('Taxi 300. A paid 100, B paid 200. Split equally between B and C.');
const m2 = [tx({ amount: 300, paidById: 'B',
  payers: [{ personId: 'A', amount: 100 }, { personId: 'B', amount: 200 }],
  split: { mode: 'equal', participants: [{ personId: 'B', value: 1 }, { personId: 'C', value: 1 }] } })];
const c2 = calculateGroupBalances(m2);
console.log('  calculateGroupBalances : A =', c2.get('A'), ' B =', c2.get('B'), ' C =', c2.get('C'));
console.log('  GroupSummaryCard       : A =', groupSummaryCardBalance(m2, 'A'),
            ' B =', groupSummaryCardBalance(m2, 'B'), ' C =', groupSummaryCardBalance(m2, 'C'));
console.log('  GroupBalancesModal     :', groupBalancesModal(m2, ['A', 'B', 'C']));

console.log('');
console.log('====== CASE 3 (LATENT, not producible by todays UI): settlement whose ======');
console.log('====== split.participants are equal-mode / have >1 non-payer.        ======');
console.log('SettleUpModal.tsx:152-158 always writes mode=unequal, [payer:0, receiver:amount],');
console.log('which is the ONLY shape under which GroupBalancesModal:28-36 agrees with');
console.log('calculateGroupBalances. Any other shape diverges:');
const s = [tx({ amount: 100, paidById: 'A',
        split: { mode: 'equal', participants: [{ personId: 'A', value: 1 }, { personId: 'B', value: 1 }] } }),
      tx({ id: 's1', amount: 50, paidById: 'B', type: 'settlement',
        split: { mode: 'equal', participants: [{ personId: 'A', value: 1 }, { personId: 'B', value: 1 }] } })];
console.log('  100 expense A -> A,B equal; then a 50 settlement B pays, participants = [A,B]');
const cs = calculateGroupBalances(s);
console.log('  calculateGroupBalances : A =', cs.get('A'), ' B =', cs.get('B'));
console.log('  GroupBalancesModal     :', groupBalancesModal(s, ['A', 'B']));

console.log('');
console.log('====== CASE 4: Dashboard "You are owed" / "You owe" after min-cash-flow ======');
const d = [tx({ id: 'x1', amount: 90, paidById: 'A', split: { mode: 'equal', participants:
                [{ personId: 'A', value: 1 }, { personId: 'B', value: 1 }, { personId: 'C', value: 1 }] } }),
      tx({ id: 'x2', amount: 30, paidById: 'B', split: { mode: 'equal', participants:
                [{ personId: 'A', value: 1 }, { personId: 'B', value: 1 }, { personId: 'C', value: 1 }] } })];
console.log('  raw net balances     :', Object.fromEntries(calculateGroupBalances(d)));
console.log('  Dashboard for A      :', dashboard(d, 'A'));
console.log('  Dashboard for B      :', dashboard(d, 'B'));
console.log('  Dashboard for C      :', dashboard(d, 'C'));

console.log('');
console.log('====== CASE 5: seven formatCurrency() implementations, one number ======');
const v = 123456.78;
const impls = [
  ['Dashboard:35 / MemberBalances:24 / GroupSummaryModal:42 (en-US, default digits)',
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'INR' })],
  ['GroupSummaryCard:32 (en-US, signDisplay auto)',
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'INR', signDisplay: 'auto' })],
  ['SettleUpModal:131 (en-IN, min 0 max 2)',
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 })],
  ['TransactionItem:38 (en-IN, max 0)  <- the expense list itself',
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })],
  ['HomeScreen:32 (en-US, NO currency style, min/max 2)',
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
];
for (const [k, f] of impls) console.log('  ' + f.format(v).padEnd(18) + k);
console.log('  value 1000 ->  SettleUpModal:131:', impls[2][1].format(1000),
            '   Dashboard:35:', impls[0][1].format(1000));
