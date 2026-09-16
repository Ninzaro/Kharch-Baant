# Pass 1.4 — Money & Domain Correctness

Audit date: 2026-09-07. Repo: `Kharch-Baant-main` (no `.git`, no `node_modules`).
Read-only. Nothing outside `audit/` was modified. No database, no network, no package installs.

PoCs: `audit/poc/money-rounding.mts`, `audit/poc/zero-sum.mts`
(plus `audit/poc/_register.mjs`, `_hook.mjs`, `_types-shim.mts` — an audit-only ESM resolve hook that lets
`node --experimental-strip-types` load the app's own `utils/calculations.ts`, whose `import { Transaction,
SplitMode, SplitParticipant } from '../types'` is extensionless and names three type-only exports).

Run with:

```
node --experimental-strip-types --import ./audit/poc/_register.mjs audit/poc/money-rounding.mts
node --experimental-strip-types --import ./audit/poc/_register.mjs audit/poc/zero-sum.mts
```

Both PoCs import **the real `utils/calculations.ts`** — `calculateShares`, `calculateGroupBalances`,
`simplifyGroupDebts`, `getUserFacingDebts`, `materializeSplit` — and reproduce each display surface's
formatter verbatim from its component. Captured output: `audit/poc/money-rounding.out.txt`,
`audit/poc/zero-sum.out.txt`.

---

## 0. The one-paragraph verdict

There is no ledger. There are no invariants. There is no server-side arithmetic at all.
Every balance in this app is a `Number` recomputed on each device, on every render, from that device's
own (possibly incomplete) copy of the `transactions` table, using unrounded floating-point division.
Nothing anywhere — not the client, not a CHECK constraint, not a trigger, not an RPC — ever asserts that
a group's balances sum to zero, that a multi-payer expense's `payers[]` sum to its `amount`, that a
split's participant values sum to the total, that a participant value is non-negative, or that a
participant is even a member of the group. `split_participants` and `payers` are unconstrained JSONB.
`payers` does not appear in a single `.sql` file in the repository — it was added to production by hand.
Three of the four helper functions that were written to make the arithmetic correct
(`distributeRounding`, `validateSplit`, `materializeSplit`) are called only by tests; the live path uses
none of them. And the gate that protects irreversible deletion — `allSettled` — is
`Array.prototype.every` over a client array that is `[]` during first paint and after any swallowed
fetch error, which evaluates to `true`.

---

## 1. Representation — every float money path

Money is a JavaScript `number` (IEEE-754 double) from the moment the user's finger leaves the keyboard
until the pixels are painted, on every device, with exactly one 2-decimal narrowing (Postgres
`numeric(12,2)` on write) that the client never reads back before it has already shown the user a
different number.

| # | Stage | Location | What happens |
|---|---|---|---|
| 1 | Amount input | `components/TransactionFormModal.tsx:392-403` | `<input type="number">`, `onChange={e => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}`. No `min`, no `step`, no decimal-place cap. |
| 2 | Amount to DTO | `components/TransactionFormModal.tsx:354` | `amount: Number(amount)` |
| 3 | Custom split input | `components/TransactionFormModal.tsx:277-279`, rendered at `:564-572` | `parseFloat(val) \|\| 0`. **No `min` attribute** — negatives accepted. |
| 4 | Multi-payer input | `components/TransactionFormModal.tsx:481-490` | `parseFloat(e.target.value) \|\| 0`. **No `min`.** |
| 5 | Settlement amount | `components/SettleUpModal.tsx:82`, input `:229-238` | `parseFloat(amount) \|\| 0` (`min="1"` on the input, which the browser does not enforce for programmatic/typed decimals and which `parseFloat` ignores). |
| 6 | Wire (insert) | `services/supabaseApiService.ts:539-556` | `amount` / `payers` / `split_participants` sent as raw JSON numbers. |
| 7 | Storage | `supabase-schema.sql:56`, `migrations/COMPLETE_DATABASE_MIGRATION.sql:77` | `amount DECIMAL(12,2) NOT NULL CHECK (amount > 0)`. Postgres rounds half-up to 2 dp on write. `split_participants JSONB NOT NULL` — **no constraint**. `payers jsonb` (`lib/database.types.ts:392`) — **absent from every `.sql` file in the repo; no constraint at all**. |
| 8 | Read back | `services/supabaseApiService.ts:95` | `amount: Number(dbTransaction.amount)` |
| 9 | Read back (payers) | `services/supabaseApiService.ts:88-91` | `amount: Number(p.amount)` |
| 10 | Read back (participants) | `services/supabaseApiService.ts:80` | JSONB cast straight to `SplitParticipant[]` — **no validation, no coercion, no `Number()`** |
| 11 | Share computation | `utils/calculations.ts:30-71` | `amount / participants.length`, `amount * (p.value/100)`, `p.value * (amount/totalShares)` — **unrounded float division** |
| 12 | Balance accumulation | `utils/calculations.ts:4-23` | `balance + payer.amount` … `balance - shareAmount`, unrounded, across every transaction in the group |
| 13 | Transfer rounding | `utils/calculations.ts:192` | `Math.round(pay * 100) / 100` — each transfer rounded **independently** |
| 14 | Totals rounding | `utils/calculations.ts:282-284` | rounds the **sum of already-rounded transfers** |
| 15 | Display | six different formatters — see §1.3 | |

### 1.1 PoC — the app's own arithmetic

```
========================================================================
1. amount 100, equal, 3 ways  (utils/calculations.ts:41 — amount/participants.length)
========================================================================
raw shares            : A=33.333333333333336  B=33.333333333333336  C=33.333333333333336
shares sum            : 100
sum - amount          : 0
balances              : A=66.66666666666666  B=-33.333333333333336  C=-33.333333333333336
Σ balances            : -1.4210854715202004e-14
MemberBalances shows  : A ₹66.67   B -₹33.33   C -₹33.33
  -> B and C each read -₹33.33, A reads ₹66.67; 33.33+33.33 = 66.66 ≠ 66.67 (a cent is invisible)
materializeSplit would: A=33.34  B=33.33  C=33.33  <-- NOT CALLED BY ANY APP CODE

========================================================================
2. amount 10, equal, 3 ways  (the classic non-terminating case)
========================================================================
balances              : A=6.666666666666666  B=-3.3333333333333335  C=-3.3333333333333335
Σ balances            : -8.881784197001252e-16
MemberBalances shows  : A ₹6.67   B -₹3.33   C -₹3.33
simplifyGroupDebts    : B->A 3.33  C->A 3.33
transfers sum         : 6.66 (A is owed 6.666666666666666 )

========================================================================
3. percentage 33.33 / 33.33 / 33.34 of 100  (client validation passes: |100-100|<0.01)
========================================================================
raw shares            : A=33.33  B=33.33  C=33.34
shares sum            : 100
sum - amount          : 0
Σ balances            : 0

========================================================================
4. shares 1:1:1 of amount 1  (₹1 split three ways)
========================================================================
balances              : A=0.6666666666666667  B=-0.3333333333333333  C=-0.3333333333333333
MemberBalances shows  : A ₹0.67   B -₹0.33   C -₹0.33
TransactionItem shows : ₹1  <-- maximumFractionDigits:0 on the amount itself
simplifyGroupDebts    : B->A 0.33  C->A 0.33
  -> Dashboard "Total Balance" for A = ₹0.00 while MemberBalances shows ₹0.67

========================================================================
5. ten separate ₹0.10 expenses, A pays, split A+B  (float accumulation)
========================================================================
A balance             : 0.5000000000000002
B balance             : -0.49999999999999994
Σ balances            : 2.7755575615628914e-16
exact answer          : A=+0.5  B=-0.5
A error               : 2.220446049250313e-16
MemberBalances shows  : A ₹0.50   B -₹0.50
Dashboard transfer    : B->A 0.5

========================================================================
6. ZERO-SUM RESIDUE — 40 equal 3-way expenses of ₹100
========================================================================
balances              : A=66.66666666666666  B=-33.33333333333335  C=-33.33333333333336
Σ balances            : -4.973799150320701e-14  (exact answer: 0)
|Σ| in cents          : 4.973799150320701e-12
App.tsx:138 allSettled: false
```

**Reading.** In the honest paths the zero-sum identity holds only to ~1e-14 — irrelevant at these
magnitudes and *not* a finding on its own. The float noise is the least of the problems. What matters is
everything below it.

### 1.2 Where the leftover cent goes: nowhere

100 split three ways stores `[{A,1},{B,1},{C,1}]` with `split_mode='equal'`. `calculateShares`
(`utils/calculations.ts:41`) returns `33.333333333333336` three times. That number is never rounded,
never allocated, never assigned an owner. It is carried as an unrounded double all the way to
`Intl.NumberFormat`, which rounds it **for display only** — independently, per person, on every surface.

- Each of B and C is told "you owe ₹33.33".
- A is told "you are owed ₹66.67".
- 33.33 + 33.33 = 66.66. **A is shown one paisa more than the app will ever ask anyone to pay.**

`materializeSplit('equal', 100, participants)` returns `A=33.34, B=33.33, C=33.33` — the correct
largest-remainder allocation, summing exactly to 100. It is **never called by application code**:

```
$ grep -rn "materializeSplit\|distributeRounding\|validateSplit" --include=*.ts --include=*.tsx .
utils/calculations.ts          (definitions)
src/test/utils/calculations.test.ts  (only caller)
```

`utils/calculations.ts:118-155` (`materializeSplit`), `:77-89` (`distributeRounding`) and `:92-116`
(`validateSplit`) are three correct functions wired to nothing. `TransactionFormModal.tsx:182-206`
re-implements validation from scratch with a different rule (see §3).

**There is no code in this repository that guarantees shares sum to the total on the live path.**

### 1.3 Six formatters, three locales, two different currencies-per-number

```
========================================================================
10. LOCALE SPLIT-BRAIN — the same total, two different digit groupings
========================================================================
HomeScreen  card  (en-US, no currency): 100,000.50
BalanceBreakdown  (en-IN, no currency): 1,00,000.50
MemberBalances (en-US, INR)          : ₹100,000.50
SettleUpModal  (en-IN, INR)          : ₹1,00,000.5
TransactionItem(en-IN, INR, 0 dp)    : ₹1,00,001
GroupBalancesModal (.toFixed(2)+code): 100000.50 INR
```

| Surface | Location | Formatter | Notes |
|---|---|---|---|
| MemberBalances | `components/MemberBalances.tsx:23-25` | `Intl('en-US', {style:'currency', currency})` | US grouping with an Indian symbol |
| Dashboard | `components/Dashboard.tsx:34-36` | same | but computed from `simplifyGroupDebts`, not raw balances |
| HomeScreen cards | `components/HomeScreen.tsx:31-33` | `Intl('en-US', {min:2,max:2})` | **no currency at all**, label "(across all currencies)" |
| BalanceBreakdownModal | `components/BalanceBreakdownModal.tsx:58-63` | `Intl('en-IN', {min:2,max:2})` | **no currency**; different grouping from the card that opened it |
| SettleUpModal | `components/SettleUpModal.tsx:130-132` | `Intl('en-IN', {style:'currency', currency, min:0, max:2})` | `min:0` drops the trailing zero: `₹1,00,000.5` |
| TransactionItem | `components/TransactionItem.tsx:37-39` | `Intl('en-IN', {style:'currency', currency, maximumFractionDigits:0})` | **whole units only** — ₹100.49 renders as ₹100, ₹100.50 as ₹101 |
| TransactionDetailModal | `components/TransactionDetailModal.tsx:33-37` | `Intl('en-IN', …)` | |
| GroupBalancesModal | `components/GroupBalancesModal.tsx:132,139,146,153,160,172` | `value.toFixed(2) + ' ' + group.currency` | |
| GroupSummaryModal | `components/GroupSummaryModal.tsx:41-43` | `Intl('en-US', {style:'currency', currency})` | |
| Expense form | `components/TransactionFormModal.tsx:391,471,480,678` | **hardcoded `₹`** | ignores `group.currency` entirely |

### 1.4 Two surfaces, same data, different numbers — proven

```
========================================================================
8. SURFACE DISAGREEMENT — same data, four different numbers
========================================================================
raw balances          : A=33.33333333333332  B=33.33333333333332  C=-66.66666666666667
MemberBalances (A)    : ₹33.33    raw 33.33333333333332
Dashboard "you are owed" (A): ₹33.33   raw 33.33
HomeScreen totalOwedToUser  : 33.33  raw 33.33
BalanceBreakdown lines      : C 33.33
GroupSummaryCard (A)  : 33.33333333333332
transfers             : C->A 33.33  C->B 33.33
Σ transfers into A    : 33.33  vs A balance 33.33333333333332  delta -0.0033333333333231963
```

and the sharper case:

```
========================================================================
9. simplifyGroupDebts rounding: 1 creditor of 100, 3 debtors of 33.333…
========================================================================
balances              : A=100  B=-33.333333333333336  C=-33.333333333333336  D=-33.333333333333336
transfers             : B->A 33.33  C->A 33.33  D->A 33.33
Σ transfers           : 99.99  vs creditor balance 100
creditor SHORT by     : 0.0100 (each transfer rounded to cents at calculations.ts:192)
Dashboard shows A owed: ₹99.99  but MemberBalances shows ₹100.00
If all three debtors pay exactly what the app tells them (33.33 each),
A receives 99.99 and the ledger still says A is owed 0.0100
```

This is a **user-visible, same-screen contradiction**: `GroupView.tsx:239-284` renders `Dashboard`
("Total Balance ₹99.99") and `MemberBalances` ("A ₹100.00") side by side on the same page from the same
props. `Dashboard.tsx:19-31` runs `calculateGroupBalances → simplifyGroupDebts → sum of rounded
transfers`; `MemberBalances.tsx:15-19` renders the raw balance. Two numbers, one screen, one paisa apart.

And in the ₹1 case (PoC §4), `BALANCE_EPS = 0.01` at `calculations.ts:157` silently deletes the whole
debt from `Dashboard` (₹0.00) while `MemberBalances` still shows ₹0.67.

### 1.5 Client preview vs stored value

```
========================================================================
11. numeric(12,2) round-trip — what Postgres stores vs what the client believed
========================================================================
typed 0.005     JS toFixed(2)=0.01  stored≈0.01  delta=0.0050
typed 33.335    JS toFixed(2)=33.34  stored≈33.34  delta=0.0050
typed 2.675     JS toFixed(2)=2.67  stored≈2.68  delta=0.0050
typed 1.005     JS toFixed(2)=1.00  stored≈1.00  delta=-0.0050
typed 100.555   JS toFixed(2)=100.56  stored≈100.56  delta=0.0050
note: 2.675.toFixed(2) = 2.67 (JS says 2.67, Postgres numeric says 2.68)
=> a client-side preview and the stored row can differ by a cent before any split maths.
```

`toFixed` rounds the binary double; `numeric(12,2)` rounds the decimal value half-away-from-zero. They
disagree on exactly the values a user types. `TransactionFormModal.tsx:678` shows
`₹{Number(amount).toFixed(0)}` in the footer while the row is being composed, and
`SettleUpModal.tsx:107-128` computes a live "after this settlement" preview from the un-narrowed double.
The client never re-reads the stored amount before showing it (the insert's `.select()` response *is*
read back at `supabaseApiService.ts:559`, so the list eventually corrects itself — but the **preview the
user approved** was a different number).

---

## 2. Rounding and remainders — summary

| Question | Answer |
|---|---|
| Where does 100/3's leftover cent go in balances? | **Nowhere.** It stays as `.333…` on all three balances forever. |
| What does each member see? | B: −₹33.33, C: −₹33.33, A: +₹66.67. The two debtor figures sum to ₹66.66. |
| Who is shown owing the extra cent? | Nobody. It is created by A's display rounding-up. |
| Does `simplifyGroupDebts` produce transfers that sum to the creditor's balance? | **No.** PoC §9: creditor 100, three debtors at 33.333…; transfers are 33.33 × 3 = 99.99. Creditor is short 0.01. Rounding happens per transfer at `calculations.ts:192`, before any reconciliation. |
| Does anything guarantee shares sum to total? | `materializeSplit` (`calculations.ts:118-155`) does. **Nothing calls it.** `calculateShares` (`:30-71`), which the live path uses, does not. |
| Rounding mode used for display | `Intl.NumberFormat` default (half-expand) on some surfaces, `toFixed` (half-even on binary doubles) on `GroupBalancesModal`, `Math.round` (half-up, ties toward +∞) in `simplifyGroupDebts` and `getUserFacingDebts`, and truncation-to-integer in `TransactionItem`. Four different rounding rules in one app. |

---

## 3. Split modes — validation, by layer

### 3.1 Client validation (`components/TransactionFormModal.tsx:182-206`)

```ts
if (splitMode === 'equal' || !amount) {                       // :183
    return { splitTotal: amount || 0, isSplitValid: splitParticipants.length > 0, … };
}
const total = Array.from(customSplitValues.entries())
    .filter(([personId]) => splitParticipants.includes(personId))
    .reduce((sum, [, value]) => sum + value, 0);              // :187-189
if (splitMode === 'unequal')   return { isSplitValid: Math.abs(total - numericAmount) < 0.01, … };  // :193-196
if (splitMode === 'percentage')return { isSplitValid: Math.abs(total - 100) < 0.01, … };            // :197-200
if (splitMode === 'shares')    return { isSplitValid: total > 0, … };                               // :201-204
```

| Mode | Rule | What passes that should not |
|---|---|---|
| `equal` | `participants.length > 0` | nothing to type; but the equal share itself is never materialised (§1.2) |
| `unequal` | `\|Σvalue − amount\| < 0.01` | `33.334 × 3 = 100.002` (Δ 0.002) **passes**; `−50 + 150 = 100` **passes** (negative share); `33.33 × 3 = 99.99` (Δ exactly 0.01) is blocked by the strict `<` |
| `percentage` | `\|Σvalue − 100\| < 0.01` | `33.331 × 3 = 99.993` (Δ 0.007) **passes** → 0.007 % of the expense evaporates; `−50 % + 150 %` **passes** |
| `shares` | `Σvalue > 0` | a single participant with 1000 shares and everyone else 0 → the zeros pay nothing (arguably intended); `0` typed for a participant is coerced to `1` on save at `:312` |
| multi-payer | `\|Σ − amount\| < 0.01 && Σ > 0` — **computed at `:208-220` and then never used** | see M-02 |

Both split inputs (`:564-572`) and both payer inputs (`:481-490`) are `<input type="number">` with **no
`min` attribute**, and both parse with `parseFloat(v) || 0`. Negative values are typeable and pass.

The Save button (`:685-691`):

```tsx
disabled={!isSplitValid || !description || !amount}
```

and `handleSubmit` (`:286`):

```ts
if (!isSplitValid || !description || !(Number(amount) > 0) || !paidById || splitParticipants.length === 0) return;
```

`isPayerValid` appears in neither. It is rendered as a red label at `:470-471` and otherwise discarded.

`validateSplit` in `utils/calculations.ts:92-116` — which uses the same epsilon but at least also rejects
`amount <= 0` and empty participants — is **not called by application code**.

### 3.2 Server validation

Nothing beyond column types and three CHECKs:

```sql
-- supabase-schema.sql:52-66 / migrations/COMPLETE_DATABASE_MIGRATION.sql:73-88
amount           DECIMAL(12,2) NOT NULL CHECK (amount > 0),
tag              TEXT NOT NULL CHECK (tag IN (...10 values...)),
split_mode       TEXT NOT NULL CHECK (split_mode IN ('equal','unequal','percentage','shares')),
split_participants JSONB NOT NULL,          -- no shape, no sum, no membership, no count
paid_by_id       UUID NOT NULL REFERENCES people(id)   -- any person in the DB, not just group members
-- type: CHECK (type IN ('expense','settlement','adjustment'))  (scripts/migrations/20251004_add_type_to_transactions.sql:9-12)
-- payers: jsonb — DOES NOT APPEAR IN ANY .sql FILE IN THE REPOSITORY
```

`grep -rn "payers" --include=*.sql .` returns **nothing**. The column exists only in
`lib/database.types.ts:392,409,426`, i.e. it was added directly to production. No CHECK, no default, no
NOT NULL, no trigger.

RLS is the only other server gate, and it is authorisation, not validation
(`supabase/migrations/20260412000005_use_clerk_user_id_in_rls.sql:143-153`,
`…20260412000008_allow_members_to_delete_transactions.sql:12-13`):

```sql
SELECT USING (i_created_group(group_id) OR i_am_member_of(group_id));
INSERT WITH CHECK (i_created_group(group_id) OR i_am_member_of(group_id));
UPDATE USING (i_created_group(group_id) OR i_am_member_of(group_id));
DELETE USING (i_created_group(group_id) OR i_am_member_of(group_id));
```

Any member may insert, edit, or delete any transaction in the group, including one they did not create
and including settlements between two other people.

### 3.3 What `calculateShares` does with invariant-violating stored rows

From `audit/poc/zero-sum.mts`:

```
Z4. STORED ROWS THAT VIOLATE THE INVARIANT (modified client / direct PostgREST; server has no CHECK)
  unequal shares summing to 99 on a 100 expense:
  balances : A=50  B=-49
  Σ        : 1
  VERDICT  : ZERO-SUM BROKEN by +1.00 (money CREATED)
  percentages summing to 110:
  balances : A=44.99999999999999  B=-55.00000000000001
  Σ        : -10.000000000000014
  VERDICT  : ZERO-SUM BROKEN by -10.00 (money DESTROYED)
  EMPTY participants array (calculations.ts:35 returns early; payer still credited):
  balances : A=100
  Σ        : 100
  VERDICT  : ZERO-SUM BROKEN by +100.00 (money CREATED)
  shares mode with every value 0 (calculations.ts:62 breaks out; payer still credited):
  balances : A=100
  Σ        : 100
  VERDICT  : ZERO-SUM BROKEN by +100.00 (money CREATED)
  participant who is NOT a group member (no FK, no CHECK on split_participants):
  balances : A=50  STRANGER=-50
  Σ        : 0
  VERDICT  : zero-sum HOLDS
```

Notes on each:

- **empty participants** (`calculations.ts:35`): `calculateShares` returns an empty map but
  `calculateGroupBalances:8-14` has *already* credited the payer. The payer is credited the full amount
  and nobody is debited. Via the UI this is blocked (`handleSubmit:286` requires
  `splitParticipants.length !== 0`). Via a modified client or a direct `POST /rest/v1/transactions` it is
  accepted — `split_participants JSONB NOT NULL` accepts `[]`.
- **shares with all-zero values** (`calculations.ts:60-68`): `if (totalShares === 0) break;` — same
  outcome, payer credited, nobody debited. Not reachable from the form (`:312` coerces `0 → 1`), but
  reachable via edit-mode round-tripping of a row that already contains a zero, and via direct API.
- **non-member participant**: zero-sum holds, but the debt is owed by a person who is not in the group,
  is not in `people` for any other member (`getPeople` derives its list from `group_members`,
  `supabaseApiService.ts:765-790`), and is therefore invisible everywhere — see M-08.

### 3.4 Multi-payer — the reachable zero-sum break

```
Z1. MULTI-PAYER: payers[] sum != amount  (TransactionFormModal.tsx:286 never checks isPayerValid)
Reachable UI steps:
  Add Expense -> Amount 1000 -> "Multiple Payers?" -> type A=400, B=100 -> Save.
  The form renders "Total: Rs 500.00 / Rs 1000.00" in red (TransactionFormModal.tsx:470-471)
  but the Save button's disabled test is only  !isSplitValid || !description || !amount
  (:687) and handleSubmit's guard (:286) also omits isPayerValid. The row is written.
Stored row: amount=1000, payers=[{A,400},{B,100}], split equal over A,B,C.
calculateGroupBalances (calculations.ts:8-19) credits payers[].amount and debits amount/3.
  balances : A=66.66666666666669  B=-233.33333333333331  C=-333.3333333333333
  Σ        : -499.99999999999994
  VERDICT  : ZERO-SUM BROKEN by -500.00 (money DESTROYED)

Z1b. Same bug via EDIT (most natural path of all)
  Existing multi-payer expense: amount 1000, payers A=600 B=400. Correct.
  User opens Edit and changes only the Amount to 2000. payerMode is seeded to
  'multiple' from the row (TransactionFormModal.tsx:146-150); customPayerValues
  still sum to 1000. isSplitValid is TRUE (equal mode). Save is enabled. Saved.
  BEFORE (amount 1000, payers 1000):
  balances : A=100  B=-100          Σ: 0        zero-sum HOLDS
  AFTER  (amount 2000, payers still 1000):
  balances : A=-400  B=-600         Σ: -1000    ZERO-SUM BROKEN (money DESTROYED)

Z1c. Negative payer amount is silently DROPPED, not rejected
  TransactionFormModal.tsx:481-490 has no min= on the payer input; :325 keeps
  only  val && val > 0. Type A=1500, B=-500 with amount 1000:
  payersTotal = 1000 so the form shows GREEN "Total: Rs 1000.00", yet the row
  written is payers=[{A,1500}] — B's -500 is filtered out of activePayers.
  balances : A=1000  B=-500         Σ: 500      ZERO-SUM BROKEN (money CREATED)
```

The asymmetry is structural: `calculateGroupBalances` credits `payers[].amount` (`:8-11`) but debits
`calculateShares(t)` which is derived from `t.amount` (`:16`, `calculations.ts:32`). The row's `amount`
is therefore used for the debit side and **ignored for the credit side**. Any divergence between
`Σ payers[].amount` and `amount` becomes money created or destroyed, one-for-one.

Two components make it worse by ignoring `payers` altogether — see M-07.

---

## 4. The zero-sum invariant

**There is no code anywhere in this repository that enforces, verifies, or even measures
Σ balances = 0 for a group.** Confirmed by exhaustive grep over the client, the SQL, the RPCs and the
edge functions. There is no balance table, no materialised view, no reconciliation job, no assertion, no
test. `src/test/utils/calculations.test.ts:457-472` comes closest (it checks that the breakdown lines sum
to the card total in one hand-built scenario) and never checks the group sum.

A write path *can* violate it — three of them are reachable from the shipped UI without opening a
debugger (Z1, Z1b, Z1c above). Per the brief's rule this is **P0**: see **M-02** and **M-03**.

Epsilon drift on the honest paths, for completeness:

```
Z3. EPSILON DRIFT — unequal split allowed to miss by up to 0.00999 per row
  Amount 100, unequal 33.334 / 33.334 / 33.334 -> sum 100.002, |delta| = 0.002 < 0.01 -> PASSES.
  balances : A=66.666  B=-33.334  C=-33.334
  Σ        : -0.0020000000000095497
  500 such rows (a year of a busy flat-share):
  balances : A=33333.00000000017  B=-16667.000000000146  C=-16667.000000000146
  Σ        : -1.0000000001236913
  VERDICT  : ZERO-SUM BROKEN by -1.00 (money DESTROYED)
  Percentage variant: 33.331 / 33.331 / 33.331 = 99.993 -> |0.007| < 0.01 -> PASSES:
  Σ        : 0.006999999999990791   ZERO-SUM BROKEN by +0.01 (money CREATED)
```

---

## 5. Balances: derived or stored?

**Derived, entirely on the client, on every render, from that device's cache.**

- `App.tsx:131-135` — `groupBalances = Object.fromEntries(calculateGroupBalances(transactions.filter(t => t.groupId === selectedGroupId)))`
- `components/MemberBalances.tsx:15-19` — recomputes independently
- `components/Dashboard.tsx:17-32` — recomputes independently, then `simplifyGroupDebts`
- `components/SettleUpModal.tsx:96-105` — recomputes **twice** (`baseBalances`, `liveBalances`)
- `components/GroupBalancesModal.tsx:23-81` — **its own reimplementation**, not `calculateGroupBalances`
- `components/GroupSummaryCard.tsx:16-29` — **another reimplementation**
- `components/GroupSummaryModal.tsx:50-81` — a third (totals only, not balances)
- `utils/calculations.ts:224-286` `getUserFacingDebts` — used by `HomeScreen`, `BalanceBreakdownModal`

Server involvement in balance computation: **none**. `map §0.8.5` recorded the same.

### 5.1 Consequences

**(a) Correctness depends on each device holding the complete transaction set.**
`getTransactions` (`supabaseApiService.ts:490-535`) fetches *all* transactions for *all* the user's groups
on every load and every invalidation. If any step fails it returns `[]` **without throwing**:

```ts
if (memberError) {
  console.warn('⚠️ Error fetching group memberships for transactions:', memberError);
  return [];                                    // supabaseApiService.ts:508-511
}
if (!memberRows || memberRows.length === 0) {
  return [];                                    // :513-516
}
```

Two devices with different caches show different balances, with no indication that either is stale. The
realtime bridges (`services/queries.ts:88-116`) patch the cache in place with no version or `updated_at`
comparison, so a missed `postgres_changes` event is a permanent divergence until a manual reload.

**(b) There is no server-side number to reconcile against.** If two members disagree about a balance,
there is nothing to appeal to. The transactions table is the only record, and any member can rewrite it
(§6).

**(c) The `allSettled` / `userSettled` gates are computed from the caller's cache and then passed
as booleans across the API boundary:**

```ts
// App.tsx:137-139
const allSettled  = Object.values(groupBalances ?? {}).every(b => typeof b === 'number' && Math.abs(b) < 0.01);
const userSettled = currentUserId && Math.abs((groupBalances?.[currentUserId] ?? 0)) < 0.01;

// App.tsx:546
await deleteGroup(editingGroup.id, currentUserId, true, allSettled);
// App.tsx:567
await archiveGroup(editingGroup.id, currentUserId, editingGroup.createdBy === currentUserId, userSettled, allSettled);

// services/supabaseApiService.ts:8-18
export const deleteGroup = async (groupId, userId, isOwner, allSettled) => {
  if (!isOwner)     throw new Error('Only the group owner can delete the group.');
  if (!allSettled)  throw new Error('All balances must be settled before deleting the group.');
  await supabase.from('group_members').delete().eq('group_id', groupId);
  await supabase.from('transactions').delete().eq('group_id', groupId);
  const { error } = await supabase.from('groups').delete().eq('id', groupId);
  …
};
```

The "gate" is an argument the caller supplies to a function running in the caller's own browser. It is
not a check. RLS permits the three DELETEs for the group creator regardless
(`20260412000005:113-114,134-135`, `…08:12-13`). Same pattern in `approveGroupDeletion`
(`supabaseApiService.ts:243-270`).

### 5.2 Write paths that change balances

Every one of them is a `transactions` row change — there is nothing else to change.

| Path | Row effect | Rebuild |
|---|---|---|
| Add expense (`App.tsx:352-355` → `supabaseApiService.ts:537-624`) | INSERT | automatic (derived) |
| Edit expense (`App.tsx:349-351` → `:626-680`) | UPDATE | automatic |
| Delete expense (`App.tsx:333-346` → `:682-693`) | DELETE | automatic |
| Add settlement (`App.tsx:789-799` → same `addTransaction`) | INSERT `type='settlement'` | automatic |
| Edit settlement (`App.tsx:790-793`) | UPDATE | automatic |
| Delete settlement (`requestDeleteTransaction`, `App.tsx:328-331`) | DELETE | automatic |
| Change payer / split / amount | UPDATE (`supabaseApiService.ts:626-660`) | automatic |
| **Member removal** (`GroupFormModal.tsx:115-118` → `updateGroup`, `supabaseApiService.ts:349-369`) | **no transaction row changes** — deletes and re-inserts `group_members` only | balances unchanged; the removed person keeps their balance and loses their UI row → **M-08** |
| Currency change (`GroupFormModal.tsx:307-316` → `updateGroup:329`) | no transaction row changes | every historical amount keeps its magnitude under a new symbol → **M-20** |
| Group delete (`supabaseApiService.ts:11-17`) | DELETE all rows in the group | irreversible |
| Group archive (`:29`) | `groups.is_archived = true` | `getUserFacingDebts:242` drops archived groups from all home-screen totals; `MemberBalances`/`Dashboard` still show them if the group is opened |
| Anonymize account (`supabase/migrations/20260813000000_anonymize_my_account.sql:28-38`) | UPDATE `people` only: `name='Deleted user'`, `source='deleted'` | transactions and balances survive verbatim; the person becomes "Deleted user" in every balance line |

---

## 6. Editing and deleting historical expenses

**Recompute:** automatic, because balances are derived. That part is fine.

**Audit trail:** none.

- `transactions` has no `created_by`, no `updated_by`, no version/revision column
  (`lib/database.types.ts:380-433`, `supabase-schema.sql:52-66`). Confirmed in §0.4.1 of the map.
- There is no history/audit table anywhere in the schema.
- `updated_at` exists and is maintained by a trigger (`supabase-schema.sql:113`), but
  `transformDbTransactionToAppTransaction` (`supabaseApiService.ts:78-108`) **does not read it**, and no
  UI displays it. The only trace of an edit is discarded at the boundary.
- No email, no toast, no notification on any transaction change. `supabaseApiService.ts:568-622` is a
  55-line block that fetches the group, the payer and the participants and then does nothing — the sends
  are commented out (`:597`, `:617`).

**Who can rewrite:** any group member, for any transaction in the group
(`20260412000005:149-150` UPDATE, `…08:12-13` DELETE). Not just their own; not just expenses; settlements
too. `App.tsx:319-326` routes settlements to `SettleUpModal` and expenses to `TransactionFormModal`, and
`TransactionList`/`TransactionItem` render Edit and Delete affordances for every row regardless of author
(there is no author to compare against).

**Can a settled past be silently rewritten?** Yes. Exact sequence:

1. January: A pays ₹6,000 for a flight, split 3 ways. B and C each owe ₹2,000.
2. February: B and C settle. Every balance is 0. The group shows "settled".
3. September: B opens the January expense (`TransactionList` → `onEdit` → `App.tsx:319-326` →
   `TransactionFormModal` in edit mode), changes the amount to ₹9,000, and saves
   (`App.tsx:349-351` → `updateTransaction`, `supabaseApiService.ts:626-680`).
4. Balances recompute on every device: A is now owed ₹1,000 from B and ₹1,000 from C, retroactively.
5. A and C receive **no notification**. The transaction list shows the same description and the same
   date. The only server-side evidence is `transactions.updated_at`, which the client never reads.
6. Alternatively B deletes the February settlement row (`App.tsx:333-346` →
   `deleteTransaction`, `supabaseApiService.ts:682-693`). It vanishes from the list; balances jump; there
   is nothing to indicate a row ever existed.

Reversal by the other party is symmetric — there is no lock, no approval, no dispute mechanism.

---

## 7. Settlements

A settlement is an ordinary `transactions` row (`SettleUpModal.tsx:144-160`):

```ts
{
  description: `Settlement: ${payerName} → ${receiverName}`,
  amount: amountNumber,
  paidById: payerId,
  tag: 'Other',
  split: { mode: 'unequal', participants: [ {personId: payerId, value: 0}, {personId: receiverId, value: amountNumber} ] },
  type: 'settlement',
}
```

Balances treat it exactly as an expense: payer credited `+amount` (`calculations.ts:13`), receiver debited
`−amount` (`:16-19` via the `unequal` branch `:47-51`). It is subject to the same CHECK `amount > 0` and
the same absence of everything else.

| Case | Client | Server | Outcome |
|---|---|---|---|
| **Partial payment** | allowed — any amount | `amount > 0` | intended behaviour |
| **Over-payment** | **no check against the balance** (`SettleUpModal.tsx:85`: `payerId && receiverId && !isSelfSelect && amountNumber > 0 && !submitting`) | none | silently creates a reverse debt — PoC Z5 below |
| **Settlement against a stale balance** | no version, no `updated_at`, no re-read before submit | none | PoC Z7 below |
| **Same settlement twice, same modal** | guarded — `submitting` state (`:44`, `:85`, `:141`, `:176`) disables the button and blocks `handleSubmit` | — | safe within one modal instance |
| **Network retry** | `retry: 1` is configured on the QueryClient (`lib/queryClient.ts:9,12`) but applies only to `useQuery`/`useMutation`. **`useMutation` is imported at `services/queries.ts:2` and never used.** All writes are bare `await api.x(...)` calls. | — | no automatic retry, and therefore no retry-induced duplicate; also no retry on a genuine transient failure |
| **Two devices settling the same debt** | no idempotency key, no client-generated id, no unique constraint | none | two rows — PoC Z6 below |
| **Settlement to self** | blocked (`:84-85`, `:296-300`) | **no check** | reachable only via a modified client; would produce `+amount` and `−amount` on the same person = net zero, harmless |
| **`amount <= 0`** | blocked (`:85`) | `CHECK (amount > 0)` | safe |
| **Payer not a group member** | dropdown is `members` (`App.tsx:786` → `groupMembers`) | **no check** — `paid_by_id` FK points at `people(id)`, any row | reachable via modified client |
| **Settlement between users who no longer share a group** | see below | none | see below |

```
Z5. SETTLEMENT OVER-PAYMENT — no check against the outstanding balance
  Before: B owes A 50.
  balances : A=50  B=-50        Σ: 0
  B records a Rs 500 settlement to A:
  balances : A=-450  B=450      Σ: 0
  A now owes B 450. No warning, no confirmation, no cap.

Z6. DOUBLE SETTLEMENT — two devices settle the same debt (no idempotency, no version)
  B settles 50 on the phone; A, whose cache has not yet received it, also
  records the same 50 on the laptop. Two rows, no unique constraint:
  balances : A=-50  B=50
  A is now the debtor for the 50 that was already paid.

Z7. STALE-BALANCE SETTLEMENT — device B settles against a balance that is already wrong
  Device B sees only e1: B owes A 50. B settles 50 -> B thinks it is square.
  balances : A=0  B=0    allSettled: true
  Meanwhile A had already added e2 (200, split A+B) that B had not received:
  balances : A=100  B=-100
  B still owes 100. Nothing told B the number moved between reading it and paying.
```

The over-payment case is the one users will actually hit: `SettleUpModal` shows a live "after this
settlement" preview (`:107-128`, rendered `:302-345`) that will happily display **"Alice's balance
₹50 → −₹450"** in red, and the Record button stays green and enabled next to it.

### 7.1 Editing a settlement whose counterparty has left the group

`SettleUpModal` derives the receiver from the stored participants (`:31-37`, `:55-56`):

```ts
const p = initialTransaction.split.participants.find(p => p.personId !== initialTransaction.paidById);
setReceiverId(p?.personId || '');
```

The receiver `<select>` (`:277-287`) is populated from `members` = `groupMembers` (`App.tsx:786`), i.e.
`people.filter(p => selectedGroup.members.includes(p.id))` (`App.tsx:580`). If the receiver has been
removed from the group, `receiverId` is set to a value with no matching `<option>`. A React
`<select value=X>` with no matching option renders as blank (and React logs a warning). `isValid` at
`:85` is `payerId && receiverId && !isSelfSelect && amountNumber > 0 && !submitting` — `receiverId` is
still the removed person's UUID, so **`isValid` is true and Save is enabled**. Saving re-writes the
settlement unchanged (or with a new amount) against a person the UI cannot name.

If the user *touches* the dropdown it snaps to a real member and the settlement silently re-points at
someone else. There is no confirmation.

### 7.2 The "settle this debt" shortcut does not exist

```
$ grep -rn "setDefaultSettle" App.tsx
App.tsx:126:    const [defaultSettlePayer, setDefaultSettlePayer] = useState<string | undefined>(undefined);
App.tsx:127:    const [defaultSettleReceiver, setDefaultSettleReceiver] = useState<string | undefined>(undefined);
App.tsx:128:    const [defaultSettleAmount, setDefaultSettleAmount] = useState<number | undefined>(undefined);
App.tsx:804:                        setDefaultSettleAmount(undefined);
```

`setDefaultSettlePayer` and `setDefaultSettleReceiver` are **never called**. `setDefaultSettleAmount` is
called exactly once, with `undefined`, in the `onCreated` cleanup. The three values are threaded into
`SettleUpModal` at `App.tsx:784-786` and are always `undefined`, so `SettleUpModal.tsx:64-66` always seeds
an empty payer, empty receiver and empty amount.

What the balance surfaces actually do on click:

- `MemberBalances.tsx:39-47` — the balance rows are plain `<li>`s. **No click handler at all.**
- `BalanceBreakdownModal.tsx:121-127` — the only button on a debt line is the group name, which calls
  `onSelectGroup(groupId)` (`HomeScreen.tsx:139-142`) and just navigates into the group.
- `GroupView.tsx:231-237` — the "Settle Up" button calls `onSettleUp()` → `App.tsx:612-615`, which clears
  `editingTransaction` and opens the modal with no prefill.

Every settlement starts from a blank form. The user must re-select both people and re-type the amount
they were just shown, from memory, with no cross-check.

---

## 8. Multi-currency

- Currency is stored **per group only**: `groups.currency TEXT NOT NULL DEFAULT 'USD'`
  (`supabase-schema.sql:20`), **no CHECK**. `types.ts:13`: `export type Currency = string`.
  The picker offers the full ISO list (`types.ts:191` `CURRENCIES = allCurrencies`, ~150 entries).
  DB default `'USD'`; UI default `'INR'` (`GroupFormModal.tsx:45`).
- **`transactions` has no currency column.** Every amount in a group is implicitly in whatever
  `groups.currency` currently says.
- **Changing a group's currency relabels all history.** `updateGroup` (`supabaseApiService.ts:329`)
  writes `currency: groupData.currency` and touches no transaction row. ₹5,000 becomes $5,000. There is
  no warning, no conversion, no lock once the group has transactions.
- **No exchange rates anywhere.** grep for `rate`, `convert`, `fx`, `exchange` in `services/` and
  `utils/` returns nothing relevant.
- **Cross-group totals are summed currency-blind.** `getUserFacingDebts` (`calculations.ts:249-284`)
  iterates every active group, computes per-group transfers, and pushes them into one flat
  `owedToUser` / `userOwes` array, then sums:
  ```ts
  const totalOwedToUser = owedToUser.reduce((s, x) => s + x.amount, 0);   // :276
  ```
  A user with a ₹40,000 INR group and a $300 USD group is shown `40,300.00`.
- **What symbol is shown?** *None, globally.* `HomeScreen.tsx:31-33` formats with
  `Intl.NumberFormat('en-US', {min:2,max:2})` — no `style:'currency'`. The three cards
  (`:72`, `:83`, `:89`) show bare numbers with the caption "(across all currencies)" at `:91`.
  `BalanceBreakdownModal.tsx:58-63` does the same with `'en-IN'` — so the modal that explains the card
  groups its digits differently from the card (`1,00,000.50` vs `100,000.50`, PoC §10).
  Per-line amounts in the breakdown are also unlabelled, so a ₹ line and a $ line are visually identical.
- **Inside a group**, the currency *is* passed down (`GroupView.tsx:244,269,281`) and used by
  `MemberBalances`, `Dashboard`, `TransactionItem`, `TransactionDetailModal`, `GroupSummaryModal`,
  `GroupBalancesModal` and `SettleUpModal` — **except the expense form**, which hardcodes `₹` at
  `TransactionFormModal.tsx:391` (amount field), `:471` (payer total), `:480` (payer rows) and `:678`
  (footer "You paid ₹…"). A group with `currency: 'USD'` shows `₹` throughout expense entry and `$`
  everywhere else.
- **Minor-unit assumption is hardwired.** `numeric(12,2)`, `distributeRounding`'s `scale = 100`
  (`calculations.ts:78`), `Math.round(v*100)/100` in `simplifyGroupDebts:192` and
  `getUserFacingDebts:282-284`, and `BALANCE_EPS = 0.01` all assume exactly two decimal places. The
  currency list includes JPY, KRW, VND, IDR, CLP, ISK (0 decimals) and KWD, BHD, OMR, JOD, TND
  (3 decimals). For a JPY group the epsilon is 100× too coarse relative to the smallest coin; for a KWD
  group `numeric(12,2)` silently truncates the smallest unit on every insert.

---

## 9. Idempotency — every write, one by one

No client-generated ids. No idempotency keys. No unique constraints beyond
`group_members(group_id, person_id)`, `group_invites.invite_token`, `group_deletion_requests.group_id`,
`people.email` (partial) and `people.clerk_user_id`. **`useMutation` is imported and never used**
(`services/queries.ts:2`), so the QueryClient's `retry: 1` (`lib/queryClient.ts:9,12`) applies to no write.

| Write | Guard | Verdict |
|---|---|---|
| **addTransaction** (`App.tsx:355`) | **none** | Save button `disabled={!isSplitValid \|\| !description \|\| !amount}` (`TransactionFormModal.tsx:687`) — no `submitting` state exists in the component. `handleSubmit` (`:283-364`) calls `onSave(...)` **without `await`** (`:352`) and returns immediately. `handleSaveTransaction` (`App.tsx:347-362`) closes the modal only *after* `await api.addTransaction(...)`. Between the first click and the response the modal is open and the button is live. **Two clicks = two rows.** |
| **updateTransaction** (`App.tsx:349`) | none | double-tap issues two UPDATEs; last write wins; harmless in isolation but there is no optimistic-concurrency check, so it also silently overwrites another member's concurrent edit |
| **deleteTransaction** (`App.tsx:337`) | `isDeletingTransaction` (`App.tsx:335,344`) | guarded |
| **Settlement create/update** (`App.tsx:791,796`) | `submitting` (`SettleUpModal.tsx:44,85,141,176`) | guarded **per modal instance only** — not across devices, not across reopening the modal |
| **addGroup** (`App.tsx:440`) | none | `GroupFormModal`'s footer Save is `type="submit" form="group-form"` (`:283-290`) with no disabled state and no submitting flag; `handleSubmit` (`:120-152`) has no re-entry guard. Two clicks create two groups. |
| **updateGroup** (`App.tsx:416`) | none | each call **DELETEs every `group_members` row and re-INSERTs** (`supabaseApiService.ts:349-369`). Not atomic: a failure between the delete and the insert leaves the group with **zero members** and no rollback. Concurrent calls from two admins interleave arbitrarily. |
| **createGroupInvite** (`GroupFormModal.handleInvite`, `supabaseApiService.ts:972-1006`) | none | every click mints a new token row. Unlimited. No cap, no dedupe, and `cleanup_expired_invites()` is exported at `supabaseApiService.ts:1225` and never called. |
| **addPersonToGroup** / `MemberInviteModal` | UNIQUE(`group_id`,`person_id`) on `group_members` | a duplicate insert errors rather than duplicating — but the error surfaces as a thrown PostgREST object |
| **requestGroupDeletion** (`supabaseApiService.ts:220-241`) | read-then-insert (`:225-233`) | TOCTOU: two simultaneous requests both read "no pending" and both insert; `group_deletion_requests.group_id` is UNIQUE (`migrations/20251116…:18`) so the loser gets a raw `23505` surfaced through `toast.error(e.message)` (`App.tsx:557`). Also: because the constraint is `UNIQUE(group_id)` and not `UNIQUE(group_id) WHERE status='pending'`, once a request is rejected **no second request can ever be filed for that group**. |
| **addPaymentSource** (`App.tsx` → `supabaseApiService.ts:711-736`) | none | duplicates possible; no unique constraint on `(user_id, name)` |
| **deletePaymentSource** | `isDeletingPaymentSource` | guarded |
| **anonymizeMyAccount** | none needed (idempotent UPDATE) | fine |

---

## 10. Member removal and leaving

### 10.1 Can a non-creator leave?

**No.** Two independent blocks:

1. `GroupFormModal.removeMember` (`:115-118`) starts with `if (personId === currentUserId) return;`, and
   the remove button is not even rendered for self (`:396`: `{p.id !== currentUserId && (<button …>)}`).
   So `removingSelf` in `App.tsx:414-419` can never become true from this UI, and the entire
   "Leave Group?" confirmation modal (`App.tsx:876-905`) plus the `removingSelf` branch of
   `executeGroupSave` (`App.tsx:404-412`) is **unreachable dead code**.
2. Even if it were reachable, `updateGroup` (`supabaseApiService.ts:337-347`) begins with an UPDATE on
   `groups`, and the RLS policy is `FOR UPDATE USING (i_created_group(id))`
   (`20260412000005:110-111`). For a non-creator the UPDATE matches zero rows, `.single()` returns
   PGRST116, and the function throws `Database error: …` before it ever reaches the membership rewrite.
   `group_members` DELETE is likewise creator-only (`20260412000005:134-135`).

Net effect: **only the group creator can remove anyone, and nobody can remove themselves.** A member who
wants out must ask the creator.

### 10.2 Removal with a non-zero balance — the orphaned-money path

`GroupFormModal.removeMember` performs **no balance check**. `App.tsx:414-434` confirms only on
self-removal (which cannot happen). `updateGroup` performs no balance check. There is no server check.

```
Z10. ORPHANED MONEY — a member removed while owing
  A paid 300 split three ways with B and GONE. Then the creator opens Group
  Settings and removes GONE (GroupFormModal.tsx:115-118 — no balance check),
  and updateGroup (supabaseApiService.ts:349-369) DELETEs all group_members
  and re-inserts without GONE. The transaction row is untouched.
  balances (App.tsx:131-135, from transactions): A=200.00  B=-100.00  GONE=-100.00
  allSettled: false -> Delete/Archive stay disabled FOREVER
  MemberBalances (components/MemberBalances.tsx:34-35) is fed people=groupMembers,
  so peopleMap.get("GONE") is undefined and the row RETURNS NULL — the -100 line
  is invisible. getPeople (supabaseApiService.ts:765-810) also stops returning
  GONE because it derives `people` from group_members alone.
  Visible balances only : A=200.00  B=-100.00  -> Σ = 100.00
  The user sees A owed 200 and B owing 100 and no reason why "not settled".
```

Traced end to end:

1. `updateGroup` (`supabaseApiService.ts:349-369`) deletes every `group_members` row for the group and
   re-inserts the new list. `transactions` rows keep referencing `GONE`'s `people.id`; there is no FK
   cascade from `group_members` to `transactions` and `paid_by_id`'s FK has no cascade either
   (`supabase-schema.sql:57`).
2. `App.tsx:131-135` still feeds **all** the group's transactions to `calculateGroupBalances`, so the map
   still has a `GONE → −100` entry.
3. `allSettled` (`App.tsx:138`) is therefore permanently `false`. `GroupFormModal.tsx:253,264,273`
   disable **Delete Group**, **Request Delete** and **Archive Group**, with the tooltip "All balances must
   be settled…" — and no member can ever satisfy it, because:
4. `App.tsx:580` computes `groupMembers = people.filter(p => selectedGroup.members.includes(p.id))`.
   `GONE` is no longer in `group.members` → not in `groupMembers`.
5. `MemberBalances.tsx:34-35`: `const person = peopleMap.get(personId); if (!person) return null;` —
   `GONE`'s balance line is **not rendered**. The user sees two lines that do not net to zero and no
   explanation.
6. `getPeople` (`supabaseApiService.ts:765-810`) derives the whole `people` list from `group_members`, so
   `GONE` disappears from every dropdown too: the Settle Up receiver `<select>`
   (`SettleUpModal.tsx:283-286`) cannot select them, and the split participant list
   (`TransactionFormModal.tsx:540`) cannot include them. RLS agrees independently —
   `i_can_see_person` (`20260412000002:48-66`) requires a shared group.
7. **There is no way back short of re-adding the person to the group** (which the creator can do from
   "Add from contacts" only if the person is still visible to them via some *other* shared group — see
   `GroupFormModal.tsx:234` `availableContacts = localPeople.filter(...)` where `localPeople` comes from
   `allPeople` = `getPeople`). If no other shared group exists, the person is unreachable and the group
   is permanently undeletable, unarchivable, and visibly inconsistent.

The `BalanceBreakdownModal` variant of the same bug: `getUserFacingDebts` will emit a transfer line
involving `GONE`, but `BalanceBreakdownModal.tsx:37-39` drops the line when
`peopleMap.get(line.personId)` is undefined — while `totalAmount` (`:50`) comes from
`debts.totalOwedToUser`, which **includes** the dropped line. The footer total no longer equals the sum
of the lines above it (M-15).

---

## 11. Findings

### [P0-01] `allSettled` is `true` for an empty transactions cache — hard-deletes a group with live debts

**Severity** P0 · **Confidence** CONFIRMED (arithmetic + code path) / LIKELY (a real user reaching it) ·
**Area** Money / Domain

**Location**
`App.tsx:53` (transactions `isLoading` discarded), `App.tsx:85,246-278` (`isLoading` tracks the invite
effect only), `App.tsx:131-139` (`groupBalances`, `allSettled`), `App.tsx:578` (`loading` gate),
`App.tsx:546,567`, `components/GroupFormModal.tsx:253,264,273`,
`services/supabaseApiService.ts:8-18,20-31`, `services/supabaseApiService.ts:506-516`.

**What is wrong**

```ts
// App.tsx:131-138
const groupBalances = React.useMemo(() => {
    if (!selectedGroupId) return {};
    const groupTxs = transactions.filter(t => t.groupId === selectedGroupId);
    return Object.fromEntries(calculateGroupBalances(groupTxs));
}, [transactions, selectedGroupId]);
const allSettled = Object.values(groupBalances ?? {}).every(b => typeof b === 'number' && Math.abs(b) < 0.01);
```

`[].every(...) === true`. When `transactions` is `[]`, `groupBalances` is `{}` and `allSettled` is
`true` — "this group is fully settled" is indistinguishable from "I have no data".

`transactions` is `[]` in at least three ordinary situations:

- **First paint.** `App.tsx:578` renders the loading screen only while `isLoading || groupsLoading`.
  `groupsLoading` is `useGroupsQuery(...).isLoading`; `isLoading` is a local `useState(true)`
  (`:85`) whose only job is the invite-acceptance effect (`:246-278`). `useTransactionsQuery`'s own
  `isLoading` is **destructured away** at `:53` (`const { data: transactions = [] } = …`). So the group
  screen, the group-settings modal and the Delete button render before the transactions query resolves.
- **Swallowed fetch failure.** `getTransactions` (`supabaseApiService.ts:506-511`) returns `[]` on a
  `group_members` error with only a `console.warn`.
- **Membership race.** `:513-516` returns `[]` when the `group_members` read comes back empty — which is
  exactly what happens for a few hundred milliseconds after `updateGroup` deletes and re-inserts the
  membership rows (`:349-366`).

**How to reproduce**
Open the app on a cold load (or with the network throttled / an offline-then-online transition). While
the transactions query is still in flight — the group list has already rendered — open a group you
created, tap the settings gear, and press **Delete Group**. The button is enabled because `allSettled`
is `true`. `App.tsx:546` calls `deleteGroup(id, uid, true, true)`; `supabaseApiService.ts:11-17` then
issues `DELETE group_members`, `DELETE transactions`, `DELETE groups`.

**Blast radius**
Total and irreversible loss of a group's entire financial history for every member, while real debts were
outstanding. There is no soft delete, no `deleted_at`, no audit table, no export prompt, no confirmation
that shows balances. Realtime propagates the deletion to every other member's device
(`services/queries.ts` groups + transactions bridges). Recovery requires a Supabase point-in-time restore.

**Why it exists**
The invariant "settled" was expressed as a predicate over a client array instead of over server state,
and `Array.prototype.every` is vacuously true. The refactor to TanStack Query moved transactions out of
the `isLoading` flag and nobody re-checked the consumers of `transactions` for empty-vs-loading.

**Containment (minutes)**
~10 min, one line + one line:

```ts
// App.tsx:53
const { data: transactions = [], isLoading: txLoading } = useTransactionsQuery(person?.id);
// App.tsx:578
const loading = isLoading || groupsLoading || txLoading;
```

Plus make the predicate non-vacuous:

```ts
// App.tsx:138
const entries = Object.values(groupBalances ?? {});
const allSettled = groupTransactions.length > 0 && entries.length > 0 && entries.every(b => Math.abs(b) < 0.01);
```

(Note the deliberate consequence: a genuinely empty group can no longer be deleted by this path; gate
that on `groupTransactions.length === 0` explicitly instead of on a vacuous `every`.)

**Correct fix**
Move the gate to the server. `deleteGroup` must be a `SECURITY DEFINER` RPC that recomputes the balances
in SQL from `transactions` and refuses when any `|balance| >= 0.01`, and that soft-deletes
(`groups.deleted_at`) rather than issuing three `DELETE`s. The client boolean must not cross the API
boundary at all — remove the `allSettled`/`userSettled` parameters from `deleteGroup`, `archiveGroup` and
`approveGroupDeletion`.

**Proof of fix**
A unit test asserting `computeAllSettled([])` is `false`, plus a test that renders `App` with the
transactions query pending and asserts the Delete Group button is disabled, plus a SQL test that the
`delete_group` RPC raises when a non-zero balance exists.

**Depends on** M-03 (the server has no way to compute a balance today).

---

### [P0-02] Multi-payer expenses save with `payers[]` not summing to `amount` — arbitrary money created or destroyed

**Severity** P0 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location**
`components/TransactionFormModal.tsx:208-220` (`isPayerValid` computed), `:286` (submit guard omits it),
`:687` (Save `disabled` omits it), `:321-339` (payers built), `:470-471` (the warning that does nothing),
`:481-490` (payer input, no `min`), `:325` (`val > 0` filter), `utils/calculations.ts:8-19`.

**What is wrong**
`isPayerValid` is computed correctly and then used **only to colour a label**:

```ts
// :208-220
const { payersTotal, isPayerValid, payerValidationReason } = useMemo(() => { … }, [...]);
// :470-471  — the only consumer
<div className={isPayerValid ? 'text-success' : 'text-destructive'}>
  {isPayerValid ? `Total: ₹${payersTotal.toFixed(2)}` : payerValidationReason || 'Total must match amount'}
</div>
// :286  — the submit guard
if (!isSplitValid || !description || !(Number(amount) > 0) || !paidById || splitParticipants.length === 0) return;
// :687  — the Save button
disabled={!isSplitValid || !description || !amount}
```

`calculateGroupBalances` credits `payers[].amount` but debits shares derived from `amount`
(`calculations.ts:8-19` + `:32`). Any gap becomes money.

**How to reproduce**
*Path A (create).* Add Expense → Amount `1000` → description → **Multiple Payers?** → A `400`, B `100` →
Save. The form shows `Total: ₹500.00 / ₹1000.00` in red. The row is written.
Stored: `amount=1000, payers=[{A,400},{B,100}], split_mode='equal', split_participants=[A,B,C]`.

*Path B (edit — the likely one).* Open an existing correct multi-payer expense (amount 1000, A 600,
B 400), change **only the Amount** to `2000`, Save. `payerMode` was seeded to `'multiple'` at `:146-150`
and `customPayerValues` still sums to 1000. `isSplitValid` is `true` (equal mode). Saved.

*Path C (negative).* Amount `1000`, multi-payer, A `1500`, B `-500`. `payersTotal` is 1000 → the label is
**green**. `:325` (`val && val > 0`) drops B, so the row written is `payers=[{A,1500}]`.

**PoC output**

```
Z1 (path A):  balances A=66.67  B=-233.33  C=-333.33   Σ = -499.99999999999994   money DESTROYED 500
Z1b (path B): before  A=100  B=-100  Σ=0
              after   A=-400 B=-600  Σ=-1000          money DESTROYED 1000
Z1c (path C): balances A=1000  B=-500  Σ = 500        money CREATED 500
```

**Blast radius**
Every member's balance in that group is permanently wrong by a user-chosen amount, on every device, with
no server value to reconcile against and no audit trail identifying who wrote the row. Because `payers`
has no constraint at all, the corrupted row survives forever.

**Why it exists**
`isPayerValid` was written for the label and never wired into the two guards. The credit/debit asymmetry
in `calculateGroupBalances` (`payers[].amount` vs `amount`) turns the UI oversight into ledger corruption
rather than a cosmetic error.

**Containment (minutes)**
~5 min. Add `isPayerValid` to both guards:

```ts
// :286
if (!isSplitValid || !isPayerValid || !description || !(Number(amount) > 0) || !paidById || splitParticipants.length === 0) return;
// :687
disabled={!isSplitValid || !isPayerValid || !description || !amount}
```

and add `min="0"` to `:482` and `:565`.

**Correct fix**
Design decision: **store integer minor units** (`amount_minor bigint`) and make the split authoritative
server-side. Add a `CHECK` (or a `BEFORE INSERT OR UPDATE` trigger, since the sum lives in JSONB):

```sql
ALTER TABLE transactions ADD CONSTRAINT payers_sum_matches_amount CHECK (
  payers IS NULL OR
  (SELECT coalesce(sum((p->>'amount')::numeric), 0) FROM jsonb_array_elements(payers) p) = amount
);
```

Better still: replace the JSONB with a `transaction_payers(transaction_id, person_id, amount_minor)` table
and a deferred constraint trigger, so the sum can be enforced relationally and `person_id` can carry a FK
to `group_members`. Client-side, drop the `val > 0` filter in favour of an explicit rejection.

**Proof of fix**
`expect(() => insert({amount: 1000, payers: [{A,400},{B,100}]})).rejects` at the DB level, plus a
component test asserting the Save button is disabled while `payersTotal !== amount`, plus a property test
asserting `Σ calculateGroupBalances(txs) === 0` over generated transaction sets.

**Depends on** —

---

### [P0-03] No server-side validation of splits or payers; the zero-sum invariant is enforced nowhere

**Severity** P0 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location**
`supabase-schema.sql:52-66`, `migrations/COMPLETE_DATABASE_MIGRATION.sql:73-88`,
`scripts/migrations/20251004_add_type_to_transactions.sql`, `lib/database.types.ts:380-433`,
`supabase/migrations/20260412000005_use_clerk_user_id_in_rls.sql:143-153`,
`services/supabaseApiService.ts:537-561,626-660`, `utils/calculations.ts:30-71`.

**What is wrong**
The only server-side constraints on a money row are `amount > 0`, the `tag` enum, the `split_mode` enum,
the `type` enum, and two FKs. `split_participants` is `JSONB NOT NULL` with no shape check.
`payers` is `jsonb` with **no constraint whatsoever and no definition in any SQL file in the repo** —
`grep -rn "payers" --include=*.sql .` returns nothing. There is no balance table, no view, no RPC, no
trigger, and no test that asserts Σ balances = 0 for a group.

**How to reproduce**
Any of the rows in PoC Z4, sent as a single `POST /rest/v1/transactions` with a valid member's Clerk JWT
(RLS only checks group membership, `20260412000005:146-147`):

```json
{"group_id":"…","description":"x","amount":100,"paid_by_id":"A","date":"2026-01-01",
 "tag":"Food","split_mode":"unequal","split_participants":[{"personId":"A","value":50},{"personId":"B","value":49}]}
```

**PoC output** — see §3.3. `unequal` summing to 99 creates ₹1; percentages summing to 110 destroy ₹10;
an empty participants array creates the full amount; `shares` with all-zero values creates the full
amount; a non-member participant creates an invisible debtor.

**Blast radius**
Every invariant this domain has. Any member (or anyone who can read the anon key and a session token —
the app is a browser SPA talking to PostgREST directly, `lib/supabase.ts:33-71`) can write a row that
makes the group's balances sum to any number they choose. Combined with M-01, that number can then be
deleted.

**Why it exists**
Validation was implemented once, in `utils/calculations.ts:92-116` (`validateSplit`), and then
re-implemented differently in the form and never called at either layer. There is no application server,
so "server-side validation" would have to be CHECK constraints or RPCs, and neither was written.

**Containment (minutes)**
Cannot be contained client-side; every client rule is advisory. Minimum viable server guard,
~30 min of SQL:

```sql
ALTER TABLE transactions ADD CONSTRAINT split_participants_shape CHECK (
  jsonb_typeof(split_participants) = 'array'
  AND jsonb_array_length(split_participants) > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(split_participants) p
    WHERE (p->>'value')::numeric < 0 OR p->>'personId' IS NULL
  )
);
ALTER TABLE transactions ADD CONSTRAINT split_sums CHECK (
  CASE split_mode
    WHEN 'unequal'   THEN abs((SELECT sum((p->>'value')::numeric) FROM jsonb_array_elements(split_participants) p) - amount) < 0.005
    WHEN 'percentage'THEN abs((SELECT sum((p->>'value')::numeric) FROM jsonb_array_elements(split_participants) p) - 100)    < 0.005
    WHEN 'shares'    THEN (SELECT sum((p->>'value')::numeric) FROM jsonb_array_elements(split_participants) p) > 0
    ELSE true
  END
);
```

(Both need `IMMUTABLE`-safe subqueries — in practice write them as a `BEFORE INSERT OR UPDATE` trigger
function instead, which also lets you check `personId ∈ group_members`.)

**Correct fix**
The design decision this app has been avoiding: **a stored double-entry ledger in integer minor units.**
`transaction_entries(transaction_id, person_id, delta_minor)` with a deferred
`SUM(delta_minor) = 0 PER transaction` constraint, written by a `SECURITY DEFINER` RPC
(`create_expense`, `update_expense`, `settle_up`) that performs the split arithmetic in SQL using
largest-remainder allocation. Balances become `SELECT person_id, SUM(delta_minor) FROM transaction_entries
JOIN transactions USING… GROUP BY person_id` — one server number every device agrees on. This subsumes
M-02, M-04, M-05, M-06, M-07 and gives M-01 something real to gate on.

**Proof of fix**
A DB-level test suite: every row in PoC Z4 must be rejected; a property test that
`SUM(delta_minor) = 0` for every group after a random sequence of the six write operations.

**Depends on** —

---

### [P1-04] Negative split values are accepted — a participant can be credited on someone else's bill

**Severity** P1 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/TransactionFormModal.tsx:564-572` (split input, no `min`), `:277-279`
(`parseFloat(val) || 0`), `:182-206` (validation checks only the sum), `utils/calculations.ts:47-58`.

**What is wrong** The unequal and percentage validators check `|Σ − target| < 0.01` and nothing else.
`−50 + 150 = 100` passes. `calculateShares` returns `−50` as A's share; `calculateGroupBalances:18`
computes `balance − (−50)` = `balance + 50`.

**How to reproduce** Add Expense → Amount `100` → **Unequally** → A `-50`, B `150` → Save. The header
even reads "All allocated" (`:510-512`).

**PoC output**

```
Z2:  balances : B=-50  A=50   Σ: 0   zero-sum HOLDS
     (A owes MINUS fifty, i.e. B now owes A 50 on a bill B paid.)
Z2b: same with -50% / 150%
```

**Blast radius** Zero-sum holds, so no automated check would ever notice; the money simply moves the
wrong way. A member can grant themselves a credit on any expense in the group and the only evidence is a
negative number in a JSONB blob that no UI renders as unusual.

**Why it exists** The validator was written to catch the honest "these don't add up" case, not the
adversarial one, and HTML `min` was never added to the numeric inputs.

**Containment (minutes)** ~5 min: `min="0"` on `:565` and `:482`, and extend the memo at `:193-204`
with `&& Array.from(customSplitValues.values()).every(v => v >= 0)`.

**Correct fix** Server-side non-negativity (see M-03's `split_participants_shape` CHECK). Client
`min="0"` is a UX affordance, not a control.

**Proof of fix** A test that a split containing a negative value is rejected by the DB and disables Save.

**Depends on** M-03

---

### [P1-05] The live split path never rounds to cents; the three functions that do are dead code

**Severity** P1 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `utils/calculations.ts:30-71` (`calculateShares`, live), `:77-89` (`distributeRounding`,
dead), `:92-116` (`validateSplit`, dead), `:118-155` (`materializeSplit`, dead).
Sole callers of the dead three: `src/test/utils/calculations.test.ts`.

**What is wrong** `calculateShares` returns `33.333333333333336` and nothing ever allocates the
remainder. `materializeSplit` returns `33.34 / 33.33 / 33.33` and is called by no application code.

**How to reproduce** PoC §1: `materializeSplit would: A=33.34  B=33.33  C=33.33  <-- NOT CALLED BY ANY
APP CODE`. Then open any group where an expense was split unevenly and compare the debtor lines against
the creditor line in `MemberBalances`.

**Blast radius** Every uneven split in the product. Debtor figures never sum to the creditor figure; the
gap is `(participants − 1) × 0.005` per transaction in the worst case and accumulates across the group's
history. Users who add up the numbers on screen find them inconsistent.

**Why it exists** The correct implementation was written (largest remainder, with tests) and then the
balance path was built around `calculateShares` instead of `materializeSplit`. Both survive.

**Containment (minutes)** ~15 min: make `calculateShares` delegate to `materializeSplit` for
`equal`/`shares`/`percentage`. That single change fixes every consumer at once, because all seven balance
surfaces route through `calculateShares` or `calculateGroupBalances`. Note the ordering dependency: the
allocation must be deterministic given the stored participant order, or two devices will assign the
leftover cent to different people.

**Correct fix** Move the split to the server and store the materialised per-person minor-unit amounts
(M-03). Then "who gets the extra paisa" is decided once, stored, and identical on every device forever.
Keep `materializeSplit`'s largest-remainder rule; drop `calculateShares`'s float division.

**Proof of fix** A property test: for any amount and participant count,
`Σ calculateShares(t).values() === t.amount` exactly, in integer minor units.

**Depends on** —

---

### [P1-06] `simplifyGroupDebts` rounds each transfer independently — paying what the app says leaves a residue

**Severity** P1 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `utils/calculations.ts:186-199`, specifically `amount: Math.round(pay * 100) / 100` at `:192`;
consumers `components/Dashboard.tsx:19-31`, `utils/calculations.ts:254` (`getUserFacingDebts`).

**What is wrong** Each transfer is rounded to cents at the moment it is emitted; the residue is neither
carried into the next transfer nor reconciled against the creditor's balance.

**How to reproduce / PoC output**

```
9. simplifyGroupDebts rounding: 1 creditor of 100, 3 debtors of 33.333…
balances              : A=100  B=-33.333333333333336  C=-33.333333333333336  D=-33.333333333333336
transfers             : B->A 33.33  C->A 33.33  D->A 33.33
Σ transfers           : 99.99  vs creditor balance 100
creditor SHORT by     : 0.0100
Dashboard shows A owed: ₹99.99  but MemberBalances shows ₹100.00
```

Both figures are rendered on the same screen: `GroupView.tsx:240-245` (`Dashboard`) and `:278-283`
(`MemberBalances`).

**Blast radius** Every group with an uneven split. The number the app tells people to pay and the number
the app says they owe differ; after everyone pays exactly as instructed, the group never reaches
"settled", which is also the gate on deleting or archiving it (M-01's gate, used correctly this time).

**Why it exists** Rounding was bolted onto the greedy matcher at the emit site rather than being a
property of the balances themselves.

**Containment (minutes)** ~20 min: round the *balances* to minor units before entering the matcher and
allocate the residue to the largest creditor, so the emitted transfers are already exact:

```ts
const cents = new Map([...balances].map(([id, b]) => [id, Math.round(b * 100)]));
// force Σ = 0 by adjusting the largest-magnitude entry, then match in integer cents
```

**Correct fix** Integer minor units end to end (M-03). Greedy matching over integers cannot produce a
residue.

**Proof of fix** A property test asserting that for any balance map, `Σ transfers into c` equals
`round(balance(c))` for every creditor `c`.

**Depends on** M-05, M-03

---

### [P1-07] Two balance surfaces ignore `payers` entirely; six surfaces format money differently

**Severity** P1 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location**
Ignore `payers`: `components/GroupSummaryCard.tsx:16-29`, `components/GroupBalancesModal.tsx:27-46`.
Reimplement balances: those two plus `components/GroupSummaryModal.tsx:50-81` (totals).
Formatters: `MemberBalances.tsx:23-25`, `Dashboard.tsx:34-36`, `HomeScreen.tsx:31-33`,
`BalanceBreakdownModal.tsx:58-63`, `SettleUpModal.tsx:130-132`, `TransactionItem.tsx:37-39`,
`TransactionDetailModal.tsx:33-37`, `GroupBalancesModal.tsx:132…172`, `GroupSummaryModal.tsx:41-43`.

**What is wrong**

```ts
// GroupSummaryCard.tsx:18-27 — the card on the home screen
transactions.forEach(t => {
    const userShare = calculateShares(t).get(currentUserId) || 0;
    if (t.paidById === currentUserId) balance += (t.amount - userShare);
    else                              balance -= userShare;
});
```

For a multi-payer expense this credits the *primary* payer the **full** `amount` and credits every
**secondary** payer **nothing**. `GroupBalancesModal.tsx:40` does the same
(`balances[transaction.paidById] += transaction.amount`). `calculateGroupBalances` uses `payers[].amount`.
The home-screen card and the in-group "Balances" modal therefore disagree with `MemberBalances`,
`Dashboard`, `SettleUpModal` and `getUserFacingDebts` for every multi-payer expense.

Separately, nine formatters across three locales (`en-US`, `en-IN`), two decimal policies (2 dp, 0 dp) and
two currency policies (with symbol, without) — see §1.3 and PoC §10.

**How to reproduce** Create a multi-payer expense (A ₹600, B ₹400, split equally A+B). The home-screen
`GroupSummaryCard` for A shows `+₹500` (600+400 credited to A, minus A's ₹500 share); `MemberBalances`
inside the group shows `+₹100`. Both are on screen within one tap of each other.

For the formatter split: any balance ≥ 100000 shows `100,000.50` on the HomeScreen card and
`1,00,000.50` in the modal that card opens.

**Blast radius** Users cannot trust any single number. The disagreement is largest exactly where the
product's differentiating feature (multi-payer) is used.

**Why it exists** Three independent reimplementations of the same computation, written at different
times; `payers` was added later to only one of them.

**Containment (minutes)** ~20 min: delete the loops in `GroupSummaryCard.tsx:16-29` and
`GroupBalancesModal.tsx:23-46` and call `calculateGroupBalances`. ~15 min more: extract one
`formatMoney(amount, currency)` into `utils/` and use it in all nine places.

**Correct fix** One balance source (M-03's server view) and one formatter module. Delete the
reimplementations; a lint rule banning bare `Intl.NumberFormat` outside that module keeps them deleted.

**Proof of fix** A test that renders `GroupSummaryCard`, `GroupBalancesModal` and `MemberBalances` from
one multi-payer fixture and asserts identical strings for the same person.

**Depends on** —

---

### [P1-08] Orphaned money: a member removed while owing becomes an invisible, permanent, unsettleable balance

**Severity** P1 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/GroupFormModal.tsx:115-118` (no balance check), `:396-401` (remove button),
`App.tsx:414-434`, `services/supabaseApiService.ts:349-369` (`updateGroup` rewrites `group_members`),
`App.tsx:131-138` (balances still include the removed id), `App.tsx:580` (`groupMembers`),
`components/MemberBalances.tsx:34-35` (`if (!person) return null`),
`services/supabaseApiService.ts:765-810` (`getPeople` derives from `group_members`),
`components/GroupFormModal.tsx:253,264,273` (the disabled buttons).

**What is wrong / How to reproduce / Blast radius** See §10.2 for the full seven-step trace and PoC Z10.
Short version: A paid ₹300 split three ways with B and GONE; the creator removes GONE; the group's
balances still contain `GONE = −100` so `allSettled` is permanently `false` and Delete/Archive/Request
Delete are permanently disabled with the tooltip "All balances must be settled…"; meanwhile GONE's
`−100` line is not rendered anywhere, GONE is not selectable in any dropdown, and the two visible balance
lines (A +200, B −100) do not net to zero. There is no path back unless the creator can still see GONE
via some other shared group.

**Why it exists** Membership and history were treated as the same thing. `updateGroup`'s
delete-all-and-reinsert makes removal a one-line action with no hook to check anything.

**Containment (minutes)** ~15 min: in `GroupFormModal.removeMember`, refuse when
`Math.abs(groupBalances[personId] ?? 0) >= 0.01` (the prop is already passed in at `App.tsx:692`), and in
`MemberBalances` render unknown person ids as "Former member" instead of `return null` so the money is at
least visible.

**Correct fix** Server-side: `remove_group_member(group_id, person_id)` RPC that refuses on a non-zero
balance, and a `former_member` flag on `group_members` (soft removal) so history stays renderable. Never
delete membership rows that transactions reference.

**Proof of fix** A test that removing a member with a non-zero balance is rejected, and a render test
that a transaction referencing a non-member still produces a named balance row.

**Depends on** M-01 (they share the `allSettled` gate)

---

### [P1-09] No idempotency on any money write; the expense Save button stays enabled during the request

**Severity** P1 · **Confidence** CONFIRMED (code) / LIKELY (a user double-taps on mobile) ·
**Area** Money / Domain

**Location** `components/TransactionFormModal.tsx:283-364` (`handleSubmit`, no re-entry guard; `:352`
calls `onSave` without `await`), `:685-691` (Save button, `disabled` has no submitting term),
`App.tsx:347-362` (`handleSaveTransaction` closes the modal only after the await),
`services/supabaseApiService.ts:537-561` (insert, no client id, no idempotency key),
`lib/queryClient.ts:9,12` + `services/queries.ts:2` (`useMutation` imported, never used).
Full table in §9.

**What is wrong** There is no `submitting` state in `TransactionFormModal` at all. `handleSubmit` is
`async` but fires `onSave(...)` synchronously at `:352` and returns; the button's only disabled condition
is `!isSplitValid || !description || !amount`, none of which change while the POST is in flight. On a
slow connection the modal sits open with a live green Save button for the duration of the round trip.

**How to reproduce** Throttle to Slow 3G. Add Expense, fill it in, double-tap Save. Two
`POST /rest/v1/transactions` requests, two rows, doubled balances. There is no unique constraint on
`(group_id, description, amount, date, paid_by_id)` to catch it. Contrast `SettleUpModal.tsx:44,85,141`,
which does have the guard.

**Blast radius** Duplicated expenses double the debt for every participant. The duplicate is
indistinguishable from a legitimate repeat (two coffees on the same day), so it is not reliably
detectable after the fact — by the app or by the users. Same class of exposure on `addGroup`,
`createGroupInvite` and `addPaymentSource` (§9).

**Why it exists** The settle-up modal was written with the guard and the expense modal was not; nothing
enforces the pattern.

**Containment (minutes)** ~10 min:

```ts
const [submitting, setSubmitting] = useState(false);
// handleSubmit: if (submitting) return; setSubmitting(true); try { await onSave(...) } finally { setSubmitting(false) }
// :687: disabled={submitting || !isSplitValid || !isPayerValid || !description || !amount}
```

(and make `onSave`/`handleSaveTransaction` return the promise so the `await` is real).

**Correct fix** Client-generated UUID v4 as the row `id`, sent on insert, with the PK doing the
deduplication. That makes every retry — user, network or code — safe by construction, and is a
prerequisite for offline support. Add a `submitting` guard to `GroupFormModal` and rate-limit
`createGroupInvite`.

**Proof of fix** A component test that two synchronous clicks produce exactly one `addTransaction` call,
plus a service test that inserting the same client id twice yields one row.

**Depends on** —

---

### [P1-10] Settlements have no cap, no version check and no duplicate detection

**Severity** P1 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/SettleUpModal.tsx:85` (`isValid`), `:139-178` (`handleSubmit`), `:107-128`
(the preview that shows the over-payment and does nothing about it),
`services/supabaseApiService.ts:537-561`.

**What is wrong** `isValid = payerId && receiverId && !isSelfSelect && amountNumber > 0 && !submitting`.
The outstanding balance is computed three lines away (`baseBalances`, `:96-99`) and used only to render a
preview. There is no comparison of `amountNumber` against it, no confirmation for an over-payment, no
`updated_at`/version sent with the write, and no unique constraint to catch a duplicate.

**How to reproduce**
*Over-payment (Z5):* B owes A ₹50. B opens Settle Up, types `500`, Records. The preview shows
"Alice's balance ₹50 → −₹450" in red; the button is green and enabled. Saved. A now owes B ₹450.
*Double settlement (Z6):* B settles ₹50 on the phone; A, whose cache has not yet received it, records the
same ₹50 on the laptop. Two rows. B is now the creditor for money that was already paid.
*Stale balance (Z7):* B's device holds only `e1` and settles ₹50 believing it is square; A had already
added `e2` that B never received. B still owes ₹100 and was told otherwise.

**Blast radius** A reverse debt appears out of nowhere with no explanation and no audit trail, in a
product whose whole purpose is agreeing on who owes whom. The double-settlement case is a real cash loss
for whoever paid twice.

**Why it exists** The settlement was modelled as "just another transaction" and inherited all of a
transaction's (absent) validation.

**Containment (minutes)** ~15 min: in `SettleUpModal`, block or confirm when
`amountNumber > (baseBalances.get(receiverId) ?? 0) + 0.01`, and show the resulting reverse debt
explicitly in the confirm text.

**Correct fix** A `settle_up(group_id, from, to, amount_minor, expected_balance_minor)` RPC that
recomputes the balance server-side, refuses when it differs from `expected_balance_minor` (optimistic
concurrency), and refuses an amount exceeding it unless an explicit `allow_overpay` flag is set.
Client-generated id for idempotency (M-09).

**Proof of fix** RPC tests: over-payment rejected without the flag; a stale `expected_balance_minor`
rejected; the same client id twice yields one row.

**Depends on** M-03, M-09

---

### [P1-11] Cross-currency balances are summed into one unlabelled number

**Severity** P1 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `utils/calculations.ts:249-284` (`getUserFacingDebts` iterates all active groups and sums),
`components/HomeScreen.tsx:22-33,72,83,89,91`, `components/BalanceBreakdownModal.tsx:30-63,90-92,133`,
`types.ts:13` (`Currency = string`), `supabase-schema.sql:20` (no CHECK), `groups.currency` only —
`transactions` has no currency column.

**What is wrong** `totalOwedToUser = owedToUser.reduce((s, x) => s + x.amount, 0)` (`:276`) adds ₹ lines
to $ lines. `HomeScreen` renders the result with `Intl.NumberFormat('en-US', {min:2,max:2})` — **no
currency style at all** — under the label "Total you are owed" with the caption "(across all currencies)".
The breakdown modal lists the individual lines, also unlabelled, also currency-blind, in a *different*
locale.

**How to reproduce** Create an INR group where you are owed ₹40,000 and a USD group where you are owed
$300. The home screen shows `40,300.00`.

**Blast radius** The single most prominent number in the app is meaningless for any multi-currency user.
Because the label admits it ("across all currencies") the bug is documented rather than fixed.

**Why it exists** Currency was modelled per group and the aggregate view was written as if there were
one currency.

**Containment (minutes)** ~30 min: group the debt lines by currency and render one row per currency
instead of one total; label every amount.

**Correct fix** Currency on the transaction (denormalised from the group at write time, so a later group
currency change cannot rewrite history — see M-20), and either per-currency totals or an explicit
conversion with a stored rate and a visible "as of" date.

**Proof of fix** A test asserting `getUserFacingDebts` returns per-currency buckets and that a mixed
fixture never produces a single scalar total.

**Depends on** M-20

---

### [P1-12] Any member can silently rewrite or delete any transaction, including settled history

**Severity** P1 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `supabase/migrations/20260412000005_use_clerk_user_id_in_rls.sql:149-150` (UPDATE),
`supabase/migrations/20260412000008_allow_members_to_delete_transactions.sql:12-13` (DELETE),
`lib/database.types.ts:380-433` (no `created_by`/`updated_by`/version),
`services/supabaseApiService.ts:78-108` (`updated_at` not read),
`App.tsx:319-346`, `services/supabaseApiService.ts:626-693`,
`services/supabaseApiService.ts:568-622` (the notification block whose sends are commented out).

**What is wrong** No authorship, no versioning, no history, no notification. RLS grants UPDATE and DELETE
on every transaction to every member. The `20260412000008` migration deliberately widened DELETE from
creator-only to member-only to fix a UI bug ("the transaction reappears on next refresh"), trading the
last remaining restriction for a cosmetic fix.

**How to reproduce** See the six-step sequence in §6. A six-month-old, fully-settled expense can be
re-priced by anyone in the group; the counterparty learns nothing.

**Blast radius** The ledger has no integrity property at all. Disputes are unresolvable because there is
no record of what the numbers were, who changed them, or when — `updated_at` exists on the row and is
thrown away at the transform.

**Why it exists** The schema was written before multi-user editing was a real scenario, and the RLS
widening in `…08` chose the smallest fix for a refresh bug.

**Containment (minutes)** ~10 min for visibility only: read `updated_at` and `created_at` in
`transformDbTransactionToAppTransaction` and render "edited <date>" in `TransactionDetailModal`. This
does not restore integrity; it makes tampering visible.

**Correct fix** `created_by`, `updated_by` (defaulted from `requesting_user_id()` by a trigger), a
`transaction_revisions` append-only table written by the same trigger, and RLS narrowed so that editing
another member's transaction is either forbidden or explicitly flagged. Notify participants on any
change to a transaction they are part of.

**Proof of fix** A SQL test that an UPDATE writes a revision row and stamps `updated_by`, and that a
member cannot delete a settlement they are not party to.

**Depends on** —

---

### [P2-13] The 0.01 validation epsilon lets every split row drift by up to a cent

**Severity** P2 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/TransactionFormModal.tsx:194,198`, `utils/calculations.ts:100,105`.

**What is wrong** `Math.abs(total - numericAmount) < 0.01` accepts a discrepancy of up to 0.00999 per
transaction, in the direction of the user's choosing, with no correction applied afterwards
(`materializeSplit`'s unequal branch at `:143-152` would shift the residue to the first participant —
it is not called).

**How to reproduce / PoC output**

```
Z3: unequal 33.334 x 3 on amount 100  ->  Σ balances = -0.002   (PASSES validation)
    500 such rows                     ->  Σ balances = -1.00    money DESTROYED
    percentage 33.331 x 3             ->  Σ balances = +0.007   money CREATED
```

**Blast radius** Slow, invisible drift in long-lived groups. Combined with M-01's per-person epsilon it
means a group can be declared settled while a rupee is unaccounted for.

**Why it exists** The epsilon was chosen to tolerate float noise (~1e-14) but is 12 orders of magnitude
larger than the noise it was protecting against.

**Containment (minutes)** ~5 min: tighten to `< 0.005` and round the typed value to 2 dp on entry.

**Correct fix** Integer minor units make the comparison exact (M-03): `Σ values === amount_minor`.

**Proof of fix** A test that `33.334 × 3` against `100` is rejected.

**Depends on** M-03

---

### [P2-14] The transaction list rounds every amount to whole units

**Severity** P2 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/TransactionItem.tsx:37-39`, used at `:97` (per-payer) and `:121` (total).

```ts
new Intl.NumberFormat('en-IN', { style:'currency', currency, maximumFractionDigits: 0 }).format(amount)
```

**What is wrong** ₹100.49 renders as ₹100; ₹100.50 renders as ₹101. The transaction list — the primary
record users scan — is systematically wrong by up to half a unit per row, and the per-payer breakdown at
`:97` has the same problem, so a multi-payer expense's displayed parts need not add to its displayed
total.

**How to reproduce** Add an expense for ₹100.50. The list shows ₹101; the detail modal
(`TransactionDetailModal.tsx:33-37`, 2 dp) shows ₹100.50.

**Blast radius** Cosmetic per row, but it is the surface users reconcile against a bank statement.

**Containment (minutes)** ~2 min: remove `maximumFractionDigits: 0`.

**Correct fix** The shared `formatMoney` module from M-07, with decimal places derived from the currency.

**Proof of fix** A render test asserting `₹100.50`.

**Depends on** M-07

---

### [P2-15] The balance breakdown's footer total does not equal the sum of the lines above it

**Severity** P2 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/BalanceBreakdownModal.tsx:35-51` — lines are filtered at `:39`
(`if (!person || !group || group.isArchived) return null`) while `totalAmount` at `:50` comes from
`debts.totalOwedToUser`, computed at `utils/calculations.ts:276` over the **unfiltered** list.

**What is wrong** Any debt line involving a person no longer in `people` (M-08's removed member, or a
participant who was never a member) is dropped from the list and kept in the total.

**How to reproduce** Trigger M-08 (remove a member who owes you), then open Home → "Total you are owed" →
the modal. The footer total exceeds the sum of the visible rows by the removed person's debt.

**Containment (minutes)** ~5 min: compute `totalAmount` from `lines` after filtering, or render a
"Former member" placeholder instead of dropping the line.

**Correct fix** Do not drop money from a UI. Render unknown participants as "Former member" everywhere
(same fix as M-08's containment).

**Proof of fix** A test with an unknown `personId` asserting `footer total === Σ rendered rows`.

**Depends on** M-08

---

### [P2-16] "Import Data" reports success and does nothing

**Severity** P2 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/SettingsModal.tsx:155`:

```ts
const handleImport = (file: File) => toast.success(`Importing from ${file.name}`);
```

wired to the file input at `components/DataExport.tsx:19-27`.

**What is wrong** The button parses nothing, writes nothing, and shows a green success toast. Export
(`SettingsModal.tsx:121-154`) is real and produces a JSON file of every group and transaction, so a user
reasonably believes the pair round-trips.

**Blast radius** A user restoring after a group deletion (M-01) is told the restore succeeded. Their data
is still gone.

**Containment (minutes)** ~2 min: remove the Import button, or replace the toast with
`toast.error('Import is not available yet')`.

**Correct fix** Implement it, or delete it. A success toast for a no-op on a data-recovery path is worse
than no feature.

**Proof of fix** The button is gone, or a test that importing an exported file restores the rows.

**Depends on** —

---

### [P2-17] The expense form hardcodes `₹` regardless of the group's currency

**Severity** P2 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/TransactionFormModal.tsx:391` (amount field), `:471` (payer total),
`:480` (per-payer rows), `:678` (footer). The component is not even passed `currency`
(`App.tsx:668-678` passes `people`, `currentUserId`, `paymentSources`, `enableCuteIcons` — no currency).

**What is wrong** A USD group's expense entry screen shows `₹` on every money field; every other surface
in that group shows `$`.

**Containment (minutes)** ~10 min: pass `currency={selectedGroup.currency}` and use the shared
`formatMoney`/symbol lookup (`types.ts:CURRENCIES` already carries symbols).

**Depends on** M-07

---

### [P2-18] The "settle this debt" prefill is dead code — every settlement starts blank

**Severity** P2 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `App.tsx:126-128` (three `useState`s), `App.tsx:784-786` (passed to `SettleUpModal`),
`App.tsx:804` (the only setter call, with `undefined`), `components/SettleUpModal.tsx:64-66`,
`components/MemberBalances.tsx:39-47` (no click handler), `components/BalanceBreakdownModal.tsx:121-127`
(the only button navigates to the group).

**What is wrong** `setDefaultSettlePayer` and `setDefaultSettleReceiver` are never called anywhere in the
codebase (grep in §7.2). The user must re-select both parties and re-type the amount from memory.

**Blast radius** Every settlement is a fresh opportunity to type the wrong number or pick the wrong
person, in a flow that has no cap (M-10) and no undo (M-12). This is the primary human-error surface in
the product.

**Containment (minutes)** ~20 min: make the `MemberBalances` rows and the `BalanceBreakdownModal` lines
buttons that call the three setters and open the modal.

**Correct fix** As above, plus an explicit "Settle this debt" affordance on each balance row with the
amount pre-filled from the same `getUserFacingDebts` line the user is looking at.

**Depends on** —

---

### [P2-19] Nobody can leave a group; the Leave Group flow is unreachable

**Severity** P2 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/GroupFormModal.tsx:116` (`if (personId === currentUserId) return;`), `:396`
(button not rendered for self), `App.tsx:414-419,404-412,876-905` (the unreachable confirm flow),
`supabase/migrations/20260412000005:110-111,134-135` (groups UPDATE and group_members DELETE are
creator-only).

**What is wrong** Two independent blocks (§10.1). A member who has settled and wants out must ask the
creator, who must use the members list. The "Leave Group?" modal, `removingSelf`, `pendingGroupSaveData`
and the `executeGroupSave(data, true)` branch are all dead.

**Blast radius** Product gap plus dead code that reads as a working feature to the next person to touch
this file.

**Containment (minutes)** ~2 min: delete the dead branch, or ~30 min to implement leaving as a
`leave_group()` RPC that checks the caller's balance is zero.

**Depends on** M-08

---

### [P2-20] Changing a group's currency silently relabels all history

**Severity** P2 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/GroupFormModal.tsx:307-316` (an always-enabled `<select>` over ~150 currencies),
`services/supabaseApiService.ts:329-337` (`updateGroup` writes `currency` and touches no transaction),
`supabase-schema.sql:20` (`currency TEXT NOT NULL DEFAULT 'USD'`, **no CHECK**), `types.ts:13`
(`Currency = string`).

**What is wrong** A group with ₹80,000 of history, switched to USD, instantly reads as $80,000 on every
device. No warning, no conversion, no restriction once transactions exist. Also: no CHECK on the column,
so any string is storable, and `Intl.NumberFormat` **throws** on an invalid currency code — which would
crash every balance surface in that group.

**Containment (minutes)** ~10 min: disable the currency `<select>` when the group has transactions;
wrap the `Intl` calls in a try/catch fallback.

**Correct fix** Denormalise `currency` onto `transactions` at write time and make the group setting the
default for new rows only (this also unblocks M-11). Add `CHECK (currency ~ '^[A-Z]{3}$')`.

**Depends on** M-11

---

### [P2-21] The delete/archive gates are arguments supplied by the caller's own browser

**Severity** P2 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `services/supabaseApiService.ts:8-10` (`deleteGroup(..., allSettled)`),
`:21-24` (`archiveGroup(..., userSettled, allSettled)`), `:244-270` (`approveGroupDeletion(..., allSettled)`; the check is at `:261`),
called from `App.tsx:546,567`.

**What is wrong** `if (!allSettled) throw new Error(...)` runs in the browser that computed
`allSettled`. RLS permits the three DELETEs for the creator unconditionally
(`20260412000005:113-114,134-135`, `…08:12-13`). Anyone able to run JS in their own tab can call
`deleteGroup(id, me, true, true)`.

**Blast radius** The stated business rule ("all balances must be settled before deleting") does not exist
as a control. It is a comment with a `throw`.

**Containment (minutes)** None available client-side.

**Correct fix** Move to a `SECURITY DEFINER` RPC (M-01's correct fix) and revoke direct DELETE on
`transactions`/`groups` from `authenticated`.

**Depends on** M-01, M-03

---

### [P3-22] The amount input accepts unbounded precision and negative-looking input

**Severity** P3 · **Confidence** CONFIRMED · **Area** Money / Domain

**Location** `components/TransactionFormModal.tsx:392-403` (no `min`, no `step`),
`components/SettleUpModal.tsx:229-238` (`min="1"` — wrong: it forbids ₹0.50 settlements while not
enforcing anything against `parseFloat`).

**What is wrong** `parseFloat('33.3333333')` is accepted, sent, and silently rounded by
`numeric(12,2)`; the client's preview showed the un-rounded value. `amount > 0` at the DB is the only
lower bound, and `12,2` caps the group at ₹9,999,999,999.99 with a raw PostgREST numeric-overflow error
surfaced as an unhandled throw (`App.tsx:359-361` logs to console and shows nothing).

**Containment (minutes)** ~5 min: `min="0.01" step="0.01"` on both inputs; round to 2 dp on blur.

**Depends on** M-03

---

### [P3-23] The settlement notification path identifies the payer as the receiver

**Severity** P3 · **Confidence** CONFIRMED (the bug) — dead code today · **Area** Money / Domain

**Location** `services/supabaseApiService.ts:586`:

```ts
const receiverId = transactionData.split.participants[0].personId;
```

`SettleUpModal.tsx:154-157` writes `participants[0]` as **the payer** (`{personId: payerId, value: 0}`);
the receiver is `participants[1]`. The block then looks up the wrong person and does nothing with them —
the `emailService.sendSettleUpEmail` call is commented out at `:597`. If the sends are ever
uncommented, every settlement notification goes to the payer.

**Containment (minutes)** ~2 min: `participants.find(p => p.personId !== transactionData.paidById)`,
matching the (correct) derivation in `SettleUpModal.tsx:33` and `GroupBalancesModal.tsx:30`.
Better: delete the whole `:568-622` block, which costs 2–3 extra database reads per expense insert and
produces nothing.

**Depends on** —

---

## 12. Coverage gaps

1. **The production schema is unknown.** `payers` exists only in `lib/database.types.ts`; no `.sql` file
   creates it. Whether production has any constraint on it, on `split_participants`, or on
   `transactions.type` cannot be determined from the repo. Needed:
   `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'transactions'::regclass;`
2. **`numeric(12,2)` is inferred, not observed.** Both `.sql` files say `DECIMAL(12,2)`, and
   `lib/database.types.ts:384` says `amount: number`, which tells us PostgREST serialises it as a JSON
   number but not its precision. Needed: `\d+ transactions` from production.
3. **No test could be executed.** `node_modules` is absent and installing is out of scope, so
   `src/test/utils/calculations.test.ts` and `src/test/components/SettleUpModal.test.tsx` were read but
   not run. The PoCs here import the same source those tests import, so the arithmetic claims stand
   independently.
4. **No live UI trace.** Every "how to reproduce" is derived from reading the component tree
   (`App.tsx` → modal props → handlers → service). Timing-dependent claims — M-01's first-paint window in
   particular, and M-09's double-tap window — are LIKELY rather than CONFIRMED for that reason. They need
   a browser with the network throttled to promote.
5. **Realtime delivery semantics unverified.** Whether `postgres_changes` reliably delivers to every
   member's socket under RLS (and what happens to a DELETE with `REPLICA IDENTITY FULL`) determines how
   often two devices actually diverge — the substrate under M-01(c) and M-10's stale-balance case.
   Vendor behaviour, not repo behaviour.
6. **`group_deletion_requests` RLS state is unknown** (Pass 0 §0.10 item 1 carried forward). It has RLS
   enabled by `20260728000000:19` and zero policies anywhere in the repo, so `requestGroupDeletion` /
   `approveGroupDeletion` are either fully open or fully denied. Both change M-21's blast radius.
7. **Whether `HOTFIX_reset_all_policies.sql` was ever applied to production.** It creates eight
   `USING (true)` policies on `groups` and `group_members` that no file in the repo drops. If it is live,
   M-08 and M-21 become far worse (any user could rewrite any group's membership).
8. **Sentry.** `App.tsx:359-361` and `:264-266` swallow save failures into `console.error`. Whether the
   Sentry integration's automatic console/breadcrumb capture surfaces them is untested; it would change
   how detectable a silent write failure is today.

---

## 13. Suspicions / Unverified

1. **Precision loss on very large amounts.** PostgREST serialises `numeric` as a JSON number, and
   JS parses it as a double. At `numeric(12,2)`'s ceiling (9,999,999,999.99 ≈ 2^33) doubles are still
   exact to the cent, so this is *not* a live problem. It becomes one the moment the column is widened.
   Flagged, not claimed.
2. **`updateGroup` non-atomicity.** `supabaseApiService.ts:349-366` deletes every `group_members` row and
   re-inserts. A network failure between the two leaves the group with zero members. The subsequent
   read path (`getGroups`, `getTransactions`, `getPeople`) all key on `group_members`, so every member
   would see the group and its transactions vanish while the rows still exist. Reachable in principle;
   not reproduced.
3. **`Intl.NumberFormat` throwing on an invalid currency code.** `groups.currency` has no CHECK and
   `Currency = string`. A row with `currency: ''` or an arbitrary string would make
   `MemberBalances.tsx:24` throw during render, taking down the group view. The UI only offers valid ISO
   codes, so this needs a direct write — but nothing prevents one. Not reproduced.
4. **Whether the `payers`-ignoring surfaces (M-07) are actually reachable together.**
   `GroupSummaryCard` renders on the home screen and `MemberBalances` inside the group; a user must
   navigate between them to see the contradiction. The arithmetic divergence is CONFIRMED; "the user
   notices" is SUSPECTED.
5. **`transactions.type` CHECK in production.** `scripts/migrations/20251004_add_type_to_transactions.sql`
   guards its `ADD CONSTRAINT` behind an `information_schema.constraint_column_usage` lookup that is a
   known-unreliable way to test for a CHECK constraint's existence. Whether the constraint landed is
   unknown. If it did not, `types.ts:269`'s `'adjustment'` and any other string are storable, and
   `calculateGroupBalances` treats every non-settlement type identically — so an `adjustment` row would
   behave as an expense.
6. **Realtime `broadcast` fan-out cost as a correctness issue.** `_broadcastTxChange`
   (`supabaseApiService.ts:481-487`) makes every recipient invalidate **all** of their transactions
   across **all** groups (`services/queries.ts:107-109` → `getTransactions`, 2 round trips, unbounded).
   Under load this widens the window in which a device holds `[]` — the precondition for M-01. Plausible
   amplification; not measured.
7. **`GroupSummaryModal`'s `byPayer` chart.** `:56-63` does handle `payers` correctly, unlike
   `GroupSummaryCard` and `GroupBalancesModal`. That makes three different `payers` policies in one
   codebase. Whether the chart's totals reconcile with the balances was not checked.
