# Pass 1.3 — Dead Code & Structural Debt

Audit date: 2026-09-07. Read-only. Repo: `Kharch-Baant-main` (no `.git`, no `node_modules`).
Builds on `audit/00-map.md`; §0.6 of that file is confirmed and extended here with final line counts.

Executable proofs live in `audit/poc/` (`split-divergence.mjs`, `balance-divergence.mjs`,
`ts-resolve-hook.mjs`). They import the real `utils/calculations.ts` through a read-only Node
loader hook and touch nothing else. Run with `node audit/poc/<file>.mjs` from the repo root.

**The headline of this pass is not the dead code.** It is that this app contains **five
independent implementations of "what is my balance"**, two of which ignore the `payers[]`
column entirely, and they disagree by **5x on the same transaction**. That is §2.1.

---

## 0. Executive summary

| | |
|---|---|
| Orphaned app LOC (TS/TSX, zero importers) | **1,222** |
| Orphaned test LOC (tests of dead code) | **1,009** |
| Orphaned script LOC | **730** |
| Dead exports inside live files | **19** |
| Total SQL | 3,703 lines in 43 files across 4 directories, no ordering, no applied-state tracking |
| Dead SQL (historical, several destructive if re-run) | **≈1,890 lines** |
| `CREATE POLICY` statements | **174** in 21 files, for ~24 distinct policies (`"Users can insert groups"` alone: **11 files**) |
| Divergent parallel implementations found | **18** (8 of them user-visible) |
| `TODO`/`FIXME`/`HACK`/`XXX` in code | **0** (confirmed across `.ts/.tsx/.mjs/.js/.kt/.sql`) |
| Known issues that live in markdown instead | ~60 items, inventoried in §4.5 |
| Root `.md` classification | 20 CONTRADICTS-CODE (4,987 lines) · 17 HISTORICAL (3,240) · 9 CANONICAL (1,871) |
| `any` in app code | 103 (`supabaseApiService.ts` 30, dead `useModals.ts` 16, `queries.ts` 9) |
| `@ts-ignore` / `@ts-expect-error` | 0 · `eslint-disable` 2, both inert (no ESLint config exists) |

The findings that will cost money or trust:

1. **D-01** (P1) — the Home-screen group card and the in-group "Balances" modal ignore
   multi-payer expenses and show a balance up to **5x wrong**, on the same screen as a
   correct one.
2. **D-02** (P1) — `import toast` appears twice in `App.tsx` (`:3` and `:921`). This is an ES
   module early SyntaxError; it ships only because **nothing in this repo runs `tsc`**.
3. **D-03 / D-04 / D-05** (P1) — three separate authorization questions the repo cannot
   answer about itself: which of four `i_created_group` bodies is live, whether eight
   `USING (true)` policies survive, and whether `group_deletion_requests` is deny-all or open.
4. **D-06** (P1) — an email-normalisation asymmetry in SQL makes placeholder people findable
   but permanently unclaimable, silently forking a user's history onto a duplicate row.
5. **D-07** (P2) — both "canonical" docs describe a modal system with **zero importers**.
   1,281 LOC of dead code with a passing 663-line test suite. The next modal fix ships nothing.

---

## 1. Unreachable code inventory

Method: static import graph over `App.tsx`, `index.tsx`, `components/ hooks/ contexts/
services/ utils/ lib/ store/`, plus `React.lazy(() => import())` dynamic edges, plus a
whole-repo string grep for every filename and every exported symbol, plus npm-script,
`vercel.json`, `AndroidManifest.xml`, `capacitor.build.gradle` and markdown "run this"
references. Nothing below is called dead without that full sweep.

### 1.1 Orphaned files — genuinely zero references anywhere

| File | LOC | Class | Evidence | Verdict |
|---|---:|---|---|---|
| `hooks/useModals.ts` | 567 | orphaned | only importer is `contexts/ModalContext.tsx`, itself orphaned | CONFIRMED dead |
| `contexts/ModalContext.tsx` | 51 | orphaned | grep `ModalProvider\|useModalContext\|ModalContext` → only its own file + `useModals.test.ts` | CONFIRMED dead |
| `hooks/useModals.test.ts` | 663 | test-only | 40 `it()` blocks exercising a hook the app cannot reach | CONFIRMED dead |
| `services/nativeGoogleAuth.ts` | 236 | orphaned | grep `nativeGoogleAuth` → only its own test; the `@capgo` plugin is still linked into the **Android build** (see §5) | CONFIRMED dead in JS |
| `src/test/services/nativeGoogleAuth.test.ts` | 62 | test-only | | CONFIRMED dead |
| `src/test/utils/paymentSourceMetrics.test.ts` | 284 | test-only | 284 lines testing a 22-line dead function | CONFIRMED dead |
| `components/auth/UserProfile.tsx` | 178 | orphaned | grep `UserProfile` → declaration + its own default export only | CONFIRMED dead |
| `components/auth/SimpleAuth.tsx` | 58 | orphaned | same | CONFIRMED dead |
| `components/auth/AuthLayout.tsx` | 41 | orphaned | same; it references `LoginForm`/`SignupForm`, files that no longer exist | CONFIRMED dead |
| `utils/paymentSourceMetrics.ts` | 39 | orphaned | `App.tsx:145-166` re-implements it inline | CONFIRMED dead |
| `components/CurrencySelector.tsx` | 24 | orphaned | grep → declaration only | CONFIRMED dead |
| `components/LanguageSelector.tsx` | 24 | orphaned | grep → declaration only; the app has no i18n at all | CONFIRMED dead |
| `constants.ts` | 4 | orphaned | `CURRENT_USER_ID` fixed UUID; zero importers | CONFIRMED dead |
| `inspect-db.mjs` | 0 | orphaned | 0-byte file | CONFIRMED dead |
| `test-env.mjs` | 37 | orphaned + broken | imports `./utils/envValidation.js`, which does not exist | CONFIRMED dead |
| `test-gemini.mjs` | 60 | orphaned + broken | `.mjs` importing a `.ts` file; reads the client Gemini key that was removed | CONFIRMED dead |
| `vercel-diagnostic.js` | 72 | orphaned | a browser-console paste snippet with a `#!/usr/bin/env node` shebang; not runnable as Node | CONFIRMED dead |
| `scripts/migrate-design-tokens.mjs` | 261 | orphaned | no npm script, no doc reference; **rewrites source files in place** | CONFIRMED dead (hazardous) |
| `scripts/spotcheck-theme.mjs` | 234 | orphaned | same | CONFIRMED dead |
| `scripts/cleanup-duplicate-tokens.mjs` | 66 | orphaned | same | CONFIRMED dead |

**Totals:** orphaned app LOC (`hooks/`+`contexts/`+`components/`+`utils/`+`services/`+`constants.ts`)
= 567 + 51 + 236 + 178 + 58 + 41 + 39 + 24 + 24 + 4 = **1,222 LOC**.
Orphaned test LOC = 663 + 62 + 284 = **1,009 LOC** — i.e. **29% of the 3,437-line test suite
tests code the app cannot execute.**
Orphaned script LOC = 0 + 37 + 60 + 72 + 261 + 234 + 66 = **730 LOC**.
Grand total orphaned TS/JS = **2,961 LOC**.

### 1.2 Reachable only via dynamic / string reference — NOT dead

Listed so a future cleanup does not delete them by mistake.

| Target | Reached by |
|---|---|
| 10 modal components | `React.lazy(() => import(...))`, `App.tsx:22-31` |
| `utils/preload.ts` factories | `App.tsx:34-37`, called from `requestIdleCallback` (`:67-75`) and `onPointerEnter` (`:632`) |
| `public/privacy.html`, `account-deletion.html`, `native-sso.html`, `check-env.html`, `generate-icons.html` | Vercel rewrites (`vercel.json`) + `components/AboutSection.tsx:11-12` |
| `public/native-sso.html` | Clerk Account-Portal redirect target; also gets the Clerk publishable key injected at build (`vite.config.ts:8-21`) — see §2.11 |
| `android/.../ClerkNativeAuthPlugin.kt` (138 LOC) | registered **by string name** `'ClerkNativeAuth'` from `services/clerkNativeAuth.ts:15` |
| `android/.../ClerkResults.java` (146), `KharchBaantApp.kt` (37) | referenced from the plugin / manifest |
| `supabase/functions/*` | HTTP endpoints; `send-email` and `suggest-tag` invoked from `emailService.ts:86` / `geminiService.ts:34`, `native-bridge` from `nativeAuthBridge.ts:59` |

### 1.3 Dead exports inside live files

| Export | Location | Evidence |
|---|---|---|
| `getGroupInvites` | `supabaseApiService.ts:1194-1204` | knip + grep: zero callers |
| `deactivateInvite` | `supabaseApiService.ts:1209-1220` | zero callers — **invites can be created but never revoked from the UI** |
| `cleanupExpiredInvites` | `supabaseApiService.ts:1225-1229` | zero callers; the DB function it wraps is also never called (no cron) |
| `mergePersonByEmail` | `supabaseApiService.ts:1267-1291` | zero callers; re-exported by `apiService.ts:35`, still zero callers. 5th claiming impl — §2.3 |
| `updatePerson` | `supabaseApiService.ts:1246-1260` | zero callers; re-exported `apiService.ts:35` |
| `unarchiveGroup` | `supabaseApiService.ts:2-6` | zero callers — archived groups are **one-way**; `ArchivedGroupsModal` has no unarchive button |
| `checkConnection` | `apiService.ts:76-83` | zero callers |
| `sendWelcomeEmail`, `sendMemberAddedEmail`, `sendSettleUpEmail`, `sendNewExpenseEmail` | `emailService.ts:115-136` | zero callers; the Edge handlers for all four are live — §2.7 |
| `SortAscIcon`, `SortDescIcon` | `components/icons/Icons.tsx` | knip |
| `startGoogleOAuth`, `openAccountPortal` | `hooks/useNativeOAuth.ts:82-86` | the sole consumer, `App.tsx:925`, destructures only `{ isNative }` — §2.11 |
| `buildAccountPortalOAuthUrl`, `startNativeGoogleOAuth` | `hooks/useNativeOAuth.ts:9,26` | test-only |
| `NATIVE_SSO_REDIRECT` | `components/auth/clerkAppearance.ts:16` | referenced only inside a doc comment |
| `distributeRounding`, `validateSplit`, `materializeSplit` | `utils/calculations.ts:77,92,119` | **test-only** — §2.2 |
| `useMutation` (import) | `services/queries.ts:2` | imported, never used |
| `Capacitor` (import) | `App.tsx:914` | imported, never used |

### 1.4 Dead / unreachable DB objects

Verified against `lib/database.types.ts` (the only artifact generated from a real database)
and a whole-repo grep for each name.

| Object | Where declared | Reachable from any client path? |
|---|---|---|
| function `debug_auth_check()` | `lib/database.types.ts:508` — **no definition in any SQL file in the repo** | No. Exists in production, source unknown. See §10. |
| function `cleanup_expired_invites()` | `migrations/20251019_add_invite_system.sql` | No — its only wrapper (`supabaseApiService.ts:1225`) has zero callers, and there is no cron/pg_cron |
| function `generate_invite_token()` | `migrations/20251019_add_invite_system.sql` | No — the client generates tokens in JS instead (`supabaseApiService.ts:930-938`). §2.9 |
| function `get_current_user_person_id()` | Supabase-Auth era | No — fossil of auth generation 0 |
| table `user_profiles` | `supabase-auth-setup.sql:12` | No — absent from the generated types entirely |
| column `people.auth_user_id` | Supabase-Auth era | Read-only fossil: `transformDbPersonToAppPerson:123` still prefers it over `clerk_user_id`; **never written** (comment at `:884` says writing a Clerk id there fails) |
| column `people.user_id` | `CLERK_AUTH_MIGRATION.sql` | Written by the fallback insert (`:890`) and by the RPCs; **never read by any client code** |
| column `payment_sources.created_by` | FK → `people.clerk_user_id` per generated types | **Never written** (`addPaymentSource:720-729` sets only `user_id`) and never read |
| columns `email_invites.mailersend_message_id` / `mailersend_status` | invite migration | Written only by the (never-invoked) MailerSend callback path; mapped into `EmailInvite` at `:962-963` but no UI renders `EmailInvite` at all |
| value `transactions.type = 'adjustment'` | CHECK allows it (`scripts/migrations/20251004_add_type_to_transactions.sql:11`, `migrations/COMPLETE_DATABASE_MIGRATION.sql:85`); `types.ts:269` allows it | **Never produced.** The only writers are `TransactionFormModal:362` (`transaction?.type ?? 'expense'`) and `SettleUpModal:159` (`'settlement'`). §4.3 |
| values `people.source = 'phonebook' \| 'email_invite'` | `types.ts:1` | Never produced. Code writes only `'manual'` (`apiService.ts:65`) and `'self'` (`supabaseApiService.ts:894`) |

*(SQL-side dead-object detail, index duplicates and policy churn: §8, sourced from the SQL sweep.)*

---

## 2. Parallel implementations

This is the section that matters. Each subsection names the implementations, says which is
live, and states whether they **disagree in behaviour** with a concrete input.

### 2.1 [P1] Balance computation — FIVE implementations, TWO of them ignore `payers[]`

**The implementations**

| # | Implementation | Location | Used by |
|---|---|---|---|
| A | `calculateGroupBalances` | `utils/calculations.ts:4-23` | `App.tsx:134` (drives `allSettled`/`userSettled`), `MemberBalances.tsx:16`, `Dashboard.tsx:19`, `SettleUpModal.tsx:97,103`, `getUserFacingDebts:253` |
| B | inline loop over `calculateShares` | `components/GroupSummaryCard.tsx:16-29` | the **group card on the Home screen** |
| C | inline loop with a settlement special-case | `components/GroupBalancesModal.tsx:23-46` | the in-group **"Balances" modal** |
| D | A → `simplifyGroupDebts` → sum transfers touching me | `components/Dashboard.tsx:17-32` | the **hero "Total Balance" card** on the group screen |
| E | `getUserFacingDebts` (per-group A → simplify → lines) | `utils/calculations.ts:224-286` | `HomeScreen.tsx:23` totals, `BalanceBreakdownModal.tsx:30` |

**Do they disagree? Yes, badly.** `calculateGroupBalances:8-14` credits `t.payers[]` when
present and falls back to `t.paidById` only when it is absent. **B and C have no `payers`
branch at all** — both do `balances[t.paidById] += t.amount`, crediting the *entire* amount
to the primary payer.

Multi-payer is not a corner case: it is a first-class feature with its own UI
(`TransactionFormModal.tsx:321-335` builds `payers[]` and sets `paidById` to the largest payer)
and its own rendering (`TransactionItem.tsx:97` shows "X paid ₹n" per payer).

**Concrete divergence** (`node audit/poc/balance-divergence.mjs`, CASE 1):

> Dinner ₹100. A paid ₹60, B paid ₹40. Split equally between A and B.

| Screen | A's balance | B's balance |
|---|---:|---:|
| Group screen / Member Balances / Settle Up (impl A) | **+10** | **−10** |
| **Home screen group card** (impl B, `GroupSummaryCard:16-29`) | **+50** | **−50** |
| **"Balances" modal** (impl C, `GroupBalancesModal:23-46`) | **+50** | **−50** |
| Group hero card (impl D) | +10 | −10 |
| Home screen totals / Balance Breakdown (impl E) | +10 | −10 |

The Home screen says *"You are owed ₹50.00"* on the card and *"Total you are owed ₹10.00"*
in the summary tile **directly above it, on the same screen**.

CASE 2 (payer who is not a participant) is worse — it silently drops a person's contribution:

> Taxi ₹300. A paid ₹100, B paid ₹200. Split equally between B and C.

| Impl | A | B | C |
|---|---:|---:|---:|
| A (`calculateGroupBalances`) | **+100** | +50 | −150 |
| B (`GroupSummaryCard`) | **0** | +150 | −150 |
| C (`GroupBalancesModal`) | **0** | +150 | −150 |

A paid ₹100 and the Home card tells them they are settled up.

**Additional divergence in impl D.** `Dashboard.tsx:17-32` feeds a *single group's* balances
through `simplifyGroupDebts`, which nets every person to exactly one side. So on the group
screen the two boxes "You are owed" and "You owe" **can never both be non-zero** — one is
always ₹0.00 (PoC CASE 4). The comment at `Dashboard.tsx:16` claims the opposite ("so 'you
are owed' and 'you owe' can both show"). It is copied from `HomeScreen.tsx:20-21`, where the
claim *is* true because that aggregates across groups.

**Additional latent divergence in impl C.** `GroupBalancesModal:30` resolves a settlement's
recipient as `participants.find(p => p.personId !== payerId)` — the *first* non-payer. It
agrees with impl A only because `SettleUpModal.tsx:152-158` always writes exactly
`mode:'unequal', participants:[{payer, 0}, {receiver, amount}]`. Any other shape (a hand-written
row, a future multi-recipient settlement, a legacy row) diverges — PoC CASE 3 shows impl C
reporting "settled" (0/0) where impl A reports +25/−25.

**Also**: `GroupBalancesModal:25` seeds `balances` only from the `people` prop; `:42` then does
`balances[personId] -= share` for every share. A share belonging to a person not in `people`
(e.g. a member removed from the group but still on old transactions) yields `undefined - share`
= `NaN`, which then poisons that row's display.

**Severity: P1.** Money numbers, shown side by side, disagreeing by 5x on a shipped feature.

---

### 2.2 [P3→P2] Share computation — `calculateShares` (live) vs `materializeSplit` (dead)

| | `calculateShares` | `materializeSplit` |
|---|---|---|
| Location | `utils/calculations.ts:30-71` | `utils/calculations.ts:119-155` |
| Rounding | none — raw float division | largest-remainder to 2dp via `distributeRounding:77-89` |
| Used by | **everything** (`calculateGroupBalances:16`, `GroupBalancesModal:39,60`, `GroupSummaryCard:19`, `GroupView.tsx:3`, `TransactionDetailModal.tsx:3`) | **nobody in app code** |

`materializeSplit`, `validateSplit` and `distributeRounding` are referenced **only** by
`src/test/utils/calculations.test.ts` (lines 5-7, 151-360). Confirmed by whole-repo grep.

**Concrete divergence** (`node audit/poc/split-divergence.mjs`): **8 of 9 cases diverge.**

| Input | `calculateShares` (LIVE) | `materializeSplit` (DEAD) |
|---|---|---|
| ₹100 equal / 3 | `33.333…, 33.333…, 33.333…` | `33.34, 33.33, 33.33` |
| ₹0.01 equal / 3 | `0.00333…` ×3 | `0.01, 0, 0` |
| ₹10 shares 1:2 | `3.333…, 6.666…` | `3.33, 6.67` |
| ₹100 unequal `33.33×3` | `33.33×3` (sums to **99.99**) | `33.34, 33.33, 33.33` (sums to 100) |

**Why it matters even though the dead one is dead.** The rounding bug is in the *live* path.
Every UI that shows a per-person share calls `.toFixed(2)` on the raw float, so a ₹100
three-way split renders as **33.33 + 33.33 + 33.33 = 99.99** — one paisa evaporates on screen
on every odd split, forever. `materializeSplit` is the fix, already written, already tested,
and wired to nothing. The next assistant told to "fix the rounding" will find two functions
and no signal about which is live.

Also note `distributeRounding:85-87` — `for (let k = 0; k < remainderTotal; k++) floored[remainders[k].i] += 1`.
If `remainderTotal > participants.length` (reachable when percentages sum to <100, e.g. three
people at 10% of ₹100 → `remainderTotal = 7000`), `remainders[k]` is `undefined` and it throws
`TypeError`. If `remainderTotal < 0` (percentages sum >100) the loop never runs and the result
does not sum to the total. So the dead implementation is also not correct as written.

---

### 2.3 [P1] Person identity / claiming — FIVE implementations

| # | Implementation | Location | Live? |
|---|---|---|---|
| 1 | RPC `ensure_my_person` | SQL; called `supabaseApiService.ts:848` | **live — every login** |
| 2 | direct `select … eq('clerk_user_id')` | `supabaseApiService.ts:861-868` | fallback strategy 2 |
| 3 | RPC `claim_person_by_email` | called `supabaseApiService.ts:872-876` | fallback strategy 3 |
| 4 | direct `insert into people` | `supabaseApiService.ts:885-897` | fallback strategy 4 |
| 5 | `mergePersonByEmail` | `supabaseApiService.ts:1267-1291` | **dead** (zero callers) |

`ensureUserExists` (`:846-912`) runs 1→2→3→4 sequentially, each falling through on error.
Four strategies for one operation, in one function, on the login hot path.

**They disagree on what a claimed person row looks like.** Comparing what each writer sets:

| Writer | `clerk_user_id` | `user_id` | `is_claimed` | `source` | `email` | name policy |
|---|---|---|---|---|---|---|
| #4 direct insert (`:887-895`) | set | **set** | `true` | **`'self'`** | set | uses passed name |
| #5 `mergePersonByEmail` (`:1284`) | set | **NOT set** | `true` | **NOT set** (stays `'manual'`) | not touched | **name never updated** |

So a person claimed through the dead path #5 ends up with `user_id = NULL` and
`source = 'manual'` while the same person claimed through #4 gets `user_id` populated and
`source = 'self'` — two different row shapes for the same real-world event, and `user_id` is
one of the three identity columns RLS may key on. *(The `ensure_my_person` /
`claim_person_by_email` SQL bodies are compared in §8.)*

Email normalisation is also inconsistent on the client:
- `ensureUserExists:850` → `userEmail.trim().toLowerCase()`
- `ensureUserExists:873` → `userEmail.trim().toLowerCase()`
- `findPersonByEmail:836` → `email.toLowerCase().trim()` (same result, different order)
- `mergePersonByEmail:1268` → `email.trim().toLowerCase()`
- `createGroupInvite:1035` → `email.toLowerCase().trim()`
- `validateInvite:1127` → `String(e?.email || '').toLowerCase().trim()`

Six call sites, six hand-rolled normalisations, no shared helper. They happen to agree today;
nothing enforces it. See §3.2 for the server-side half of this.

**Severity: P1** — identity is the root of every RLS decision in this app.

---

### 2.4 [P2] Group deletion — `deleteGroup` vs `approveGroupDeletion`

| | `deleteGroup` | `approveGroupDeletion` |
|---|---|---|
| Location | `supabaseApiService.ts:8-19` | `supabaseApiService.ts:245-277` |
| Authorisation | `isOwner` — a **client-supplied boolean** (`App.tsx:544-546` computes it) | `group.created_by !== approverId` — read from the server |
| Settled gate | `allSettled` — client boolean | `allSettled` — client boolean |
| Delete sequence | `group_members` → `transactions` → `groups` (`:12,14,16`) | **identical**, `:264,265,266` |
| Error handling | errors from the first two deletes are **discarded** (no `error` destructure) | same |

Two copies of the same three-step cascade, with **different authorisation models**.
`deleteGroup` trusts a boolean the browser computed; `approveGroupDeletion` re-reads
`created_by`. Neither deletes `group_invites`, `email_invites`, or `group_deletion_requests`.

**A concrete bug caused by the duplication.** `approveGroupDeletion` deletes the group at
`:266` and then, at `:270-274`, updates `group_deletion_requests.status = 'approved'` for that
request. But `group_deletion_requests.group_id` is `FK → groups ON DELETE CASCADE`
(`migrations/20251116…:18`) — the request row is already gone. PostgREST treats an `UPDATE`
matching zero rows as success, so the "mark approved" step is a **permanent silent no-op**
and no audit trail of the approval survives.

**Severity: P2.**

### 2.5 [P2] Modal state — 19 `useState` flags (live) vs `useModals` + `ModalContext` (dead, documented as canonical)

`App.tsx:110-128` + `:140-143` declares **19** independent state hooks. `hooks/useModals.ts`
(567 LOC) + `contexts/ModalContext.tsx` (51 LOC) implement the same thing as one reducer-ish
state object with 46 typed actions — and have **zero importers**. `AGENTS.md` and
`ARCHITECTURE.md` §6/§8/§15.6 describe the dead hook as the live modal system and mark it
"resolved 2026-04-25" (see `audit/00-map.md` §0.9).

**Behaviours the dead hook has that the live `App.tsx` does not:**

| Behaviour | `useModals` | `App.tsx` |
|---|---|---|
| `closeAll()` | `:510-512` | **absent** |
| Per-modal `isProcessing` flag | `confirmDeleteGroup.isProcessing`, `confirmArchiveGroup.isProcessing`, `confirmLeaveGroup.isProcessing` (`:196-198`) | **one shared** `isProcessingGroupAction` (`:123`) for delete *and* archive |
| Stale-closure guard on async confirms | `stateRef` (`:209-213`), read at `:362,402,440,465,494` | plain closure capture |
| Reset `isProcessing` on failure **and rethrow** | `:446-449, :471-474, :500-503` | swallows into a toast (`:556-560, :571-575`); the caller can never react |
| Input validation before opening | `:223-254`, `:351-354`, `:391-394`, `:432-435`, `:457-460`, `:482-489` | none |
| Opening a modal resets its stale payload | `{...initialState[key], ...payload, isOpen:true}` (`:265`) | every call site must remember to `setEditingTransaction(null)` by hand |
| `confirmLeaveGroup` as a first-class modal | `:99-104, :481-508` | an inline `<BaseModal>` literal at `App.tsx:876-908` |

**Behaviour the live `App.tsx` has that the dead hook does not:** Android hardware-back
handling (`useBackButton`, `App.tsx:168-187`).

**And that live handler is incomplete.** `useBackButton` closes 10 of the 13 open-able
surfaces. It does **not** handle `isConfirmDeleteModalOpen`, `isConfirmArchiveModalOpen`, or
`isConfirmLeaveModalOpen` (`:112-114`). So on Android, pressing Back while the **"Delete
group?"** confirmation is up falls through to `if (selectedGroupId) setSelectedGroupId(null)`
(`:181-184`) — the app navigates Home **with the destructive confirmation still mounted and
visible over the Home screen**. `useModals.closeAll()` exists precisely for this and is dead.

**Severity: P2** — not because 19 `useState`s are ugly, but because the two canonical docs
point the next fix at 618 lines of code that cannot run.

### 2.6 [P2] Split validation — inline (live) vs `validateSplit` (dead), and validation ≠ persistence

| | inline | `validateSplit` |
|---|---|---|
| Location | `TransactionFormModal.tsx:182-206` | `utils/calculations.ts:92-116` |
| Live? | **yes** | no (test-only) |
| `equal` | `participants.length > 0`; no amount check here (amount is checked separately at `:286`) | requires `amount > 0` **and** `participants.length > 0` |
| `unequal` | `Math.abs(total - amount) < 0.01` → valid | `Math.abs(sum - amount) > 0.01` → invalid |
| `percentage` | `Math.abs(total - 100) < 0.01` | `Math.abs(sumPct - 100) > 0.01` |
| `shares` | `total > 0` | `totalShares > 0` |

The epsilon comparisons are inverted forms of each other and are **boundary-inconsistent**:
at a difference of exactly `0.01`, `validateSplit` says *valid* (`0.01 > 0.01` is false) and
the inline check says *invalid* (`0.01 < 0.01` is false). Float arithmetic hides this most of
the time; it is still two rules for one invariant.

**The reachable divergence is between validation and persistence, in the live path.**
`handleSubmit:311-313` coerces shares: `baseParticipants.map(p => ({...p, value: p.value || 1}))`.
So the total that was *validated* is not the total that is *stored*:

> Shares mode, 2 participants, user types `3` and `0`.
> Validation (`:201-203`): `total = 3 > 0` → **valid**, UI preview divides by 3.
> Persisted (`:312`): `[{value:3},{value:1}]` → `calculateShares` divides by **4**.
> A ₹100 expense previews as ₹100/₹0 and is stored as ₹75/₹25.

`validateSplit` has the same blind spot, so wiring it in would not fix this.

**There is no server-side split validation at all** — see §3.1.

### 2.7 [P3] Email — 5 senders, 4 dead, plus a 55-line dead block on the write path

`services/emailService.ts:115-136` exports `sendWelcomeEmail`, `sendGroupInviteEmail`,
`sendMemberAddedEmail`, `sendSettleUpEmail`, `sendNewExpenseEmail`. Only
`sendGroupInviteEmail` has a caller (`supabaseApiService.ts:1045`). The other four are dead
on the client — **but the Edge Function handlers for all five types are live and reachable by
anyone holding a JWT** (`EmailType` union, `emailService.ts:65`). That is Pass 2 material.

Worse, `supabaseApiService.ts:567-621` is a 55-line block inside `addTransaction` that:
- gates on `emailService.isEmailServiceEnabled()` (`:568`), which is true whenever
  `VITE_SUPABASE_URL` is set (`emailService.ts:75-78`) — i.e. **always, in production**;
- performs **2 extra DB round trips** unconditionally (`groups` `:570-574`, `people` `:577-581`),
  plus a **third** for the participants (`:605-608`) on every expense;
- computes `splitWithNames` (`:611`), `expenseUrl` (`:612`) and `receiverData` (`:587-591`);
- then does **nothing** — every send is a comment (`:597`, `:617`).

Every expense any user creates pays for three pointless queries so that three unused local
variables can be assigned.

It also contains a convention bug: `:586` reads
`const receiverId = transactionData.split.participants[0].personId` as the *receiver*, but
`SettleUpModal.tsx:154-157` writes the **payer** at index 0 and the receiver at index 1.
Dead code, but it is the kind of thing that gets copied.

### 2.8 [P2] Currency formatting — 7 implementations, 3 locales, 3 digit policies

No shared formatter exists. Every component rolls its own:

| Location | Locale | Digits |
|---|---|---|
| `Dashboard.tsx:35` | `en-US` | default (2) |
| `MemberBalances.tsx:24` | `en-US` | default (2) |
| `GroupSummaryModal.tsx:42` | `en-US` | default (2) |
| `GroupSummaryCard.tsx:32` | `en-US` | default + `signDisplay:'auto'` |
| `HomeScreen.tsx:32` | `en-US` | min 2 / max 2, **no currency style at all** — no symbol |
| `SettleUpModal.tsx:131` | **`en-IN`** | **min 0** / max 2 |
| `TransactionItem.tsx:38` | **`en-IN`** | **max 0** |
| `BalanceBreakdownModal.tsx:59`, `TransactionDetailModal.tsx:34` | `en-IN` | — |

**Concrete divergence** (PoC CASE 5), one transaction of `123456.78` INR:

| Rendered as | Where |
|---|---|
| `₹123,456.78` | Dashboard, Member Balances, Group Summary, Home group card |
| `₹1,23,456.78` | Settle Up modal (Indian lakh grouping) |
| **`₹1,23,457`** | **the expense list itself** (`TransactionItem:38`, `maximumFractionDigits: 0`) |
| `123,456.78` | Home screen "Total you are owed" (no currency symbol) |

The transaction list — the primary screen — is the only place that **rounds the amount away**,
and it is the only place that does so. A ₹1,23,456.78 expense reads as ₹1,23,457 in the list
and ₹1,23,456.78 the moment you tap it. `SettleUpModal`'s `minimumFractionDigits: 0` also
means ₹1,000.00 shows as "₹1,000" there and "₹1,000.00" everywhere else.

`GroupSummaryModal:42` and `Dashboard:35` hard-code `en-US` while the app's default currency
is INR and the production audience is Indian.

### 2.9 [P3] Invite token generation — client JS vs SQL

`supabaseApiService.ts:930-938` `generateInviteToken()` builds a 32-char base64url token from
`crypto.getRandomValues(new Uint8Array(24))`. The database also has
`generate_invite_token()` (`migrations/20251019_add_invite_system.sql`), never called.
Two token formats could coexist in `group_invites.invite_token`; only the JS one is produced.

### 2.10 [P2] Supabase auth-token injection — two mechanisms on the same request

`lib/supabase.ts` sets **both**:
- `accessToken: async () => getClerkSupabaseToken()` (`:51-54`) — supabase-js v2's official
  third-party-auth hook, and
- a `global.fetch` override that calls `getClerkSupabaseToken()` again and sets the
  `Authorization` header by hand (`:55-65`).

Both run on every PostgREST call, so **every request makes two `clerk.session.getToken()`
calls**. If the token refreshes between them the two mechanisms disagree about which JWT the
request carries, and whichever supabase-js applies last wins. One of the two is redundant.

### 2.11 [P2] Native auth — three generations, one live, two still shipped

| Gen | Files | Status |
|---|---|---|
| 0 — Supabase Auth | `supabase-auth-setup.sql`, `migrations/20250126_migrate_to_supabase_auth.sql`, `components/auth/SimpleAuth.tsx`, `AuthLayout.tsx`, `UserProfile.tsx`, `people.auth_user_id`, `user_profiles`, `get_current_user_person_id()`, `SUPABASE_AUTH_MIGRATION_PLAN.md` (26 KB) | **dead**, 277 LOC of TSX + ~650 SQL |
| 1 — `@capgo/capacitor-social-login` | `services/nativeGoogleAuth.ts` (236) + test (62) | **dead in JS but still in the Android build** — `android/app/capacitor.build.gradle:17` and `android/capacitor.settings.gradle:20-21` still link `:capgo-capacitor-social-login`, and `package.json:35` still declares it. The plugin is compiled into every shipped AAB. |
| 2 — Clerk Account Portal + HTTPS bounce | `hooks/useNativeOAuth.ts:9-70`, `components/auth/clerkAppearance.ts:16,22`, `public/native-sso.html`, `vite.config.ts:8-21` (key injection), `vercel.json:8-13` (two rewrites), `App.tsx:931,980` (routing), `AndroidManifest.xml` (`kharchbaant://sso-callback`) | **initiator dead, receiver live.** `startGoogleOAuth` / `openAccountPortal` are returned by `useNativeOAuth():82-86` but the only consumer (`App.tsx:925`) destructures just `{ isNative }`. Zero callers outside `src/test/components/clerkAppearance.test.ts`. |
| 3 — `ClerkNativeAuthPlugin` + `native-bridge` Edge fn | `services/clerkNativeAuth.ts`, `services/nativeAuthBridge.ts`, `hooks/useNativeGoogleSignIn.ts`, `components/auth/AuthScreen.tsx:34,63`, `android/.../ClerkNativeAuthPlugin.kt` | **LIVE** |

Generation 2 is the dangerous one: it is half-removed. `https://www.motamaati.in/native-sso.html`
is still deployed, still has the Clerk publishable key injected into it at build time
(`vite.config.ts:14-17`), still auto-redirects to `kharchbaant://sso-callback`
(`public/native-sso.html:43,61`) — and nothing in the app can start the flow that would land
there. `SsoFinish.tsx` and `utils/nativeDeepLinks.ts` remain live only because the same deep-link
listener also carries `/invite/*`.

`AGENTS.md` says this path "must not be used" while the repo ships every piece of it.

### 2.12 [P3] Tag → emoji mapping duplicated

`TAG_EMOJIS` (`services/supabaseApiService.ts:662-666`) and `getIconForCategory`
(`services/geminiService.ts:64-78`) map the same 10 tags to the same 10 emojis.
They **agree today**, character for character. Two sources of truth, no test pinning them
together; `batchApplyEmojisToGroupTransactions:678` uses the first, `TransactionFormModal:344`
uses the second, so a one-line "change the Food emoji" prompt will fix exactly half the app.

### 2.13 [P3] Realtime transaction propagation — two mechanisms, one event

`services/supabaseApiService.ts:404-430` subscribes to **both** `postgres_changes` on
`transactions` **and** a client-sent `broadcast` event `tx`, on the same topic
`public:transactions`. `_broadcastTxChange` (`:481-487`) publishes to that same topic from
`addTransaction:565`, `updateTransaction:658` and `deleteTransaction:694`.

Every write therefore triggers two independent cache paths in `queries.ts:92-110`: a
surgical `setQueryData` patch **and** `invalidateQueries` → a full refetch of *all* the user's
transactions across *all* groups. The broadcast handler receives `groupId` in the payload
(`:424`) and **ignores it** (`queries.ts:107-109`), so the invalidation is maximally broad.

### 2.14 [P3] Payment-source usage metrics — dead util vs inline

`utils/paymentSourceMetrics.ts:12-22` `computePaymentSourceMetrics` returns `{counts, lastUsed}`.
`App.tsx:145-166` computes exactly the same two maps inline in two `useMemo`s.
The logic is **identical**, including the `prev < t.date` lexical-compare trick and its comment.
The dead version has 284 lines of tests; the live version has none.

`utils/paymentSourceMetrics.ts:25-38` also contains an `if (process.argv[1].includes(...))`
self-test that would run on import in any Node context — harmless in the browser, but it is a
`process` reference in a file meant for the client bundle.

### 2.15 [P3] Env reading — four mechanisms

| Mechanism | Location | Consumers |
|---|---|---|
| `utils/env.ts getEnvValue()` | `:32-49` | **only** `services/nativeAuthBridge.ts:52,53,90` |
| direct `import.meta.env.X` | `lib/supabase.ts:5-12`, `index.tsx:29,30,63`, `emailService.ts:76`, `App.tsx:44` | everywhere else |
| `vite.config.ts` `define` block | `:132-160` | injects 7 vars at build time |
| `process.env.X` in browser code | `apiService.ts:88-89` | `assertSupabaseEnvironment` |

`getEnvValue`'s `KNOWN` table (`utils/env.ts:19-30`) lists 10 keys; only 3 are ever passed to
it. `VITE_API_MODE`, `VITE_DEBUG_ENABLED`, `VITE_DEV_MODE`, `REACT_APP_API_MODE` are
registered there and **never requested by any caller** — `VITE_API_MODE` is even given a
default of `'supabase'` in `vite.config.ts:148-150` and read by nobody.

`apiService.ts:88-89` reads `process.env.VITE_SUPABASE_URL` in code that runs in the browser.
`process` exists there only because `vite-plugin-node-polyfills` is installed (`vite.config.ts:34-37`).

### 2.18 [P2] Invite acceptance — three documented generations, two live code paths, one unreachable

| Gen | Mechanism | Where documented | Where in code |
|---|---|---|---|
| 1 | client reads `group_invites`, inserts `group_members` itself, `alert()` + `window.location.reload()` | `INVITE_SYSTEM.md:139-149,165-166`, `INVITE_FLOW_DIAGRAM.md:138-151`, `INVITE_TESTING.md:86,97,110`, and the smoking gun `INVITE_DEBUG_CHECKLIST.md:68-71` — `CREATE POLICY "Anyone can join via invite" ON group_members FOR INSERT WITH CHECK (true);` | **gone** |
| 2 | no reload; `getGroups()` refetch + a `localStorage['pendingInviteToken']` breadcrumb | `INVITE_BUG_FIX.md:31-33`, `INVITE_FIX_SUMMARY.md:90-92`, `INVITE_LOCALSTORAGE_FIX.md:47,75-80` | **partially live** — the breadcrumb is the trigger for the accept that actually runs |
| 3 | `SECURITY DEFINER` RPCs `get_invite_preview` / `accept_group_invite`; membership inserted server-side from the JWT | **only** `docs/security-phase-a.md:107-108` — not in any of the eight root invite docs | **live** — `supabaseApiService.ts:1078, 1147` |

Phase B (`20260812000000…:279-281`) re-enables RLS on `group_invites`, `email_invites` and
`group_members`, directly closing the `WITH CHECK (true)` hole that
`INVITE_DEBUG_CHECKLIST.md:68-71` still instructs a reader to open.

**Two live accept implementations, and the second is unreachable.**

- `App.tsx:203-242 handleInviteAcceptance`, fired from `App.tsx:262` off the localStorage
  breadcrumb. **This is the one that runs.**
- `components/invite/InvitePage.tsx:117-143` (auto-accept, requires `user && person`) plus the
  "Join Group" button at `:270-293` and the whole `:259-298` signed-in branch.
  **None of it can ever render**: `App.tsx:1029` mounts `<InvitePage />` only under
  `if (!user && inviteInfo?.token)`, and the moment `user` is truthy `AppWithAuth` returns
  `<App />` instead.

**Leftovers from generation 1 that still ship:**
- `InvitePage.tsx:83-86` — a raw direct `group_members` table read that bypasses the RPC,
  importing the Supabase client at `:8`, with an inline comment at `:81` conceding it "may be
  empty pre-auth under RLS".
- `InvitePage.tsx:124` — `localStorage.setItem('pendingInviteToken', token); // Also leave a
  breadcrumb for legacy flow` — a self-labelled generation-2 remnant.
- `AcceptInviteRequest.personId` (`types.ts:360`) is still required and still passed by
  `App.tsx:216` and `InvitePage.tsx:125,275`, and is **discarded** by
  `supabaseApiService.ts:1145`. §7.4.
- Three dead invite exports (`getGroupInvites`, `deactivateInvite`, `cleanupExpiredInvites`) —
  the read side of the "invite analytics dashboard" promised at `INVITE_SYSTEM.md:280` was
  written and never wired.

There is also a **bug in the surviving path** that the docs mask:
`INVITE_LOCALSTORAGE_FIX.md:154-157` claims the token "is only cleared after a successful
join". `App.tsx:261` calls `localStorage.removeItem` **before** `handleInviteAcceptance` runs
at `:262` — so a failed join loses the token permanently.

### 2.16 [P3] Group-creator identity — app writes a person UUID, RLS accepts either

`App.tsx:441` passes `currentUserId` = `person.id` (a `people` UUID) into
`addGroup(groupData, personId)`, which writes it to `groups.created_by`
(`supabaseApiService.ts:178`). `groups.created_by` is `text` with **no FK**
(`lib/database.types.ts`, `Relationships: []`). Meanwhile `i_created_group()` exists in ≥3
versions across the migrations, the later ones matching on `clerk_user_id`. Detail in §8.

Client-side, `App.tsx:544` (`editingGroup.createdBy === currentUserId`) and
`supabaseApiService.ts:260` (`group.created_by !== approverId`) both compare against
`person.id`. So the client's notion of "admin" and the database's notion are keyed on
different columns and only coincide by luck of which migration ran last.

### 2.17 [P3] `allSettled` — three sources

- `App.tsx:138` computes it from `groupBalances`, which is `{}` unless `selectedGroupId` is
  set (`:131-135`). `Object.values({}).every(...)` is **`true`**, so `allSettled` defaults to
  *settled* when no group is selected.
- It is then passed as an **argument** into `deleteGroup(…, allSettled)` (`:546`) and
  `archiveGroup(…, userSettled, allSettled)` (`:567`), where it is enforced as if it were an
  authorisation check (`supabaseApiService.ts:10, 24-25`).
- `GroupFormModal` receives `allSettled` and `userSettled` as props (`App.tsx:693-694`) and
  gates its own buttons on them.
- `SettleUpModal.tsx:117-119` computes its own `balancesUnchanged` with the same 0.01 epsilon.

A client that omits the argument deletes an unsettled group. The server has no equivalent
check — see §3.

---

## 3. Split-brain logic (same rule on client and server)

### 3.1 Split integrity — client only, nothing server-side

| Rule | Client | Server |
|---|---|---|
| `split_participants` sums to `amount` (unequal) | `TransactionFormModal.tsx:194` | **nothing** |
| percentages sum to 100 | `:198` | **nothing** |
| shares total > 0 | `:202` | **nothing** |
| `payers[]` sums to `amount` | `:213` | **nothing** |
| participants are group members | **nothing** | **nothing** |
| `paid_by_id` is a group member | **nothing** | FK to `people` only — any person id in the database is accepted |

`split_participants` and `payers` are `jsonb` with no CHECK. A client that skips the form can
store a ₹1,000 expense split `[{A, 1}]` where A is not in the group, and every balance screen
will happily divide by it.

### 3.2 Email normalisation — client lowercases, server may not

Client normalises at six sites (§2.3). The server-side `get_invite_preview` /
`accept_group_invite` / `claim_person_by_email` normalisation is compared in §8. The
partial unique index is `people_email_unique … WHERE email IS NOT NULL` on the **raw**
`email` column (`supabase/migrations/20260405000000:35`), not on `lower(trim(email))` — so
`Bob@x.com` and `bob@x.com` are two distinct rows as far as the constraint is concerned, and
only the client's discipline keeps them apart.

### 3.3 `amount > 0` — client float vs `numeric(12,2)` CHECK

Client: `TransactionFormModal.tsx:286` `!(Number(amount) > 0)` blocks submit; `SettleUpModal.tsx:85`
`amountNumber > 0`.
Server: `transactions.amount numeric(12,2)` with `CHECK (amount > 0)`.

**Concrete divergence.** Postgres coerces a value to the column's type *on assignment*, before
row constraints are evaluated. `0.001` inserted into `numeric(12,2)` becomes `0.00`, and
`CHECK (amount > 0)` then fails — so the row is rejected with a constraint violation, not
stored as 0. The client, however, considers `0.001 > 0` valid and submits it, so the user sees
a raw PostgREST error toast rather than a validation message. Anything in `(0, 0.005)` behaves
this way. Confidence: LIKELY (reasoned from Postgres assignment-cast semantics; not executed
against a database).

The mirror case is worse: `0.005` rounds to `0.01` (Postgres `numeric` rounds half away from
zero), so a client that submits `0.005` gets a row storing **double** what was typed.

### 3.4 Tag list — three copies

`TAGS` in `types.ts:216-227` (10 values), a copy in `supabase/functions/suggest-tag/index.ts:20-31`,
and a `CHECK` constraint in SQL. Plus `ai_item_cache.category` has its own CHECK. See §8 for
whether the SQL copies match; the two TS copies are compared in §5 of the docs sweep.

### 3.5 Invite expiry / max-uses / active — server-side, then the client re-reads

`validateInvite` (`supabaseApiService.ts:1077-1138`) delegates entirely to `get_invite_preview`,
and `acceptInvite` (`:1144-1189`) to `accept_group_invite` — good. But `acceptInvite:1174`
then calls `validateInvite` **again** after a successful accept, purely to fetch the group name,
with a comment acknowledging the preview may now fail because the invite just hit `max_uses`
(`:1171-1172`). Two round trips and a documented race to display one string.

`App.tsx:203-242 handleInviteAcceptance` also calls `validateInvite` *before* `acceptInvite`
(`:205`, `:214`) — so accepting an invite is **three** RPCs where the server-side one is
authoritative and sufficient.

### 3.6 `is_archived` / `is_active` — stored server-side, filtered client-side

- `getGroups` (`supabaseApiService.ts:136-166`) does **not** filter `is_archived`. Every
  archived group is fetched on every load and dropped in the browser at `App.tsx:83`.
- `getPaymentSources` (`:699-714`) does **not** filter `is_active`. Archived payment sources
  are returned; `TransactionFormModal.tsx:169` filters `isActive !== false` at the point of use.
- `getArchivedGroups` (`:34-47`) is a *third* query that fetches the same table with
  `is_archived = true`.

---

## 4. Abandoned scaffolding

### 4.1 [P2] "Import Data" is a lie

`components/SettingsModal.tsx:156`:

```ts
const handleImport = (file: File) => toast.success(`Importing from ${file.name}`);
```

The Settings screen renders a real file input (`DataExport.tsx:21-26`, accepting `.json,.csv`),
the user picks a file, and the app shows a **green success toast** saying it is importing.
Nothing is read, parsed, or written. This is not dead code — it is a functioning UI that
reports success for work it never does.

Its partner `handleExport` (`:121-155`) does work, but exports only `groups` and
`transactions` — not `people`, not `paymentSources` — so the output cannot reconstruct
anything: transactions reference `paidById`/`personId` UUIDs whose names are not in the file.

### 4.2 [P2] The PWA update flow was never built — users are pinned to a stale build

`vite.config.ts:38-94` configures `VitePWA` with `registerType: 'prompt'`,
`skipWaiting: false` and `clientsClaim: false` (`:43, :78-79`), with the comment
"We'll switch to a prompt-based update flow" (`:41-42`).

A prompt-based update flow requires the app to import `virtual:pwa-register` (or
`virtual:pwa-register/react`) and render something off `needRefresh`. Whole-repo grep for
`registerSW`, `useRegisterSW`, `virtual:pwa`, `needRefresh`, `serviceWorker` returns
**exactly one hit**: `vite.config.ts:74` (the `workbox:` config key). **The prompt was never
built.**

Because `injectRegister` is left at its default `'auto'`, the plugin injects its own
`registerSW.js` when the virtual module is not imported — so a service worker *is* installed
and *does* precache. The consequence is therefore not "no PWA" but something worse for a
shipped app:

> A new service worker installs, then sits in `waiting` **forever**. With
> `skipWaiting:false` and `clientsClaim:false` and no code to call `updateServiceWorker()`,
> the only way a user ever gets a new build is to close **every** tab/instance of the app.
> On the Android WebView that is effectively "until the OS kills the process".

Confidence: the missing prompt is CONFIRMED (grep); the exact `injectRegister:'auto'`
behaviour is LIKELY (cannot run the build).

Everything else about the PWA config is broken too:

- the runtime-cache rule at `:82` targets `^https://api\.supabase\.co/.*` — real Supabase
  hosts are `<project-ref>.supabase.co` (`.env.example:5`). **The rule matches nothing.**
- `public/manifest.webmanifest` exists and is **0 bytes**. VitePWA emits its own
  `manifest.webmanifest` as a rollup asset, and Vite copies `public/` in the same write
  phase. Vite writes the public dir before rollup's emitted assets, so the plugin's manifest
  *probably* wins — but this is ordering-dependent, undocumented, and exactly what
  vite-plugin-pwa tells you not to do. If the ordering ever flips (Vite bump,
  `copyPublicDir` change, a Vercel static-copy step) production silently serves a 0-byte
  manifest **with no build error**.
- `includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg']` (`:44`) lists
  **two files that do not exist**. `public/` holds only `favicon.ico`, `pwa-192x192.svg`,
  `pwa-512x512.svg`, five `.html` and `ICON_SETUP.md`.
- every manifest icon is `image/svg+xml` (`:55-72`). Chrome requires raster 192/512 PNGs for
  installability, so the app is not installable even when the manifest survives.
- `index.html:32-33` sets `apple-touch-icon` to an `.svg`, which iOS ignores.
- `globPatterns` (`:75`) omits `webmanifest` and `json`.

Correction to `audit/00-map.md:380`: **`workbox-window` is not a dead dependency.** It is a
non-optional `peerDependency` of `vite-plugin-pwa@1.1.0`. It has zero imports because nothing
imports the virtual module, but deleting it breaks peer resolution.

`PWA_SETUP_COMPLETE.md` exists at the repo root.

### 4.3 `adjustment` transaction type

`types.ts:269` and the DB CHECK both allow `'adjustment'`. No code path produces it. The
feature it belongs to is specified in `MISSING_MODALS.md:114,152` ("Creates an adjustment
transaction to correct legacy or rounding issues") and was never built.

### 4.4 Other half-built features

| Feature | Evidence | State |
|---|---|---|
| Deletion-request workflow | `supabaseApiService.ts:220-324`, `AdminDeletionRequestsPanel.tsx` | UI + 4 API functions exist; the table has **zero RLS policies anywhere in the repo** while Phase A enables RLS on it (`20260728000000:19`) → every read/write is either denied or wide open. `approveGroupDeletion`'s audit update is a no-op (§2.4). `UNIQUE(group_id)` means one rejected request blocks the group forever (§8). |
| `unarchiveGroup` | `supabaseApiService.ts:2-6` | implemented, zero callers — archiving is one-way |
| `deactivateInvite` / `getGroupInvites` | `:1194-1220` | implemented, zero callers — invite links cannot be revoked |
| Settle-up prefill | `SettleUpModal` accepts `defaultPayerId`/`defaultReceiverId`/`defaultAmount` (`:18-20`), `App.tsx:126-128` holds the state and passes it (`:784-786`) | **`setDefaultSettlePayer` and `setDefaultSettleReceiver` are never called** (grep: declarations at `:126-127` only). Both props are permanently `undefined`. `setDefaultSettleAmount` is called once — to reset it to `undefined` (`:804`). Tested at `src/test/components/SettleUpModal.test.tsx:93-94`. |
| `people.source = 'phonebook' \| 'email_invite'` | `types.ts:1` | never produced |
| `LanguageSelector` | `components/LanguageSelector.tsx` | no i18n exists |
| `CurrencySelector` | `components/CurrencySelector.tsx` | `GroupFormModal` rolls its own currency picker |
| `AboutSection` version string | `components/AboutSection.tsx:8` says "Version: 1.0.0" | `android/app/build.gradle` says `versionName 1.0.6`. Hard-coded, never updated. |
| `mailersend_status` tracking | `email_invites.mailersend_*`, `types.ts:325-326` | no webhook receiver exists; the columns are write-once-never |

### 4.5 TODO/FIXME inventory — zero in code, all of it in markdown

Confirmed: `grep -rn "TODO\|FIXME\|HACK\|XXX"` across `*.ts *.tsx *.mjs *.js *.kt *.sql`
returns **nothing**. The backlog lives in root markdown instead. Extracted in full below, with
each item checked against the code.

**`ARCHITECTURE.md` §15 "Known debt"**

| doc:line | Claim | Status now |
|---|---|---|
| `:490` | Realtime `groups` UPDATE preserves `members` from local state | still true (`queries.ts:66-72`) |
| `:491` | `VITE_API_MODE` defaults `'supabase'`, `REACT_APP_API_MODE` defaults `'mock'` | **already false** — no `REACT_APP_API_MODE` define exists (`vite.config.ts:148-150`) |
| `:492`, `:428`, `:435` | `utils/envValidation.ts` lists `VITE_API_MODE` as required | **the file does not exist.** There is no env validation anywhere. `test-env.mjs:2` imports it and is broken as a result |
| `:495` | "`App.tsx` is 912 LOC" | **1,050** — worse |
| `:496` | "`supabaseApiService.ts` is 1343 LOC" | 1,308, still unsplit |
| `:497` | ~~Modal state bifurcated~~ "Resolved 2026-04-25" | **false** — D-07 |
| `:498` | TS not strict | true (`tsconfig.json`, no `strict`, `allowJs`) |
| `:499` | no `.prettierrc` / `.eslintrc` | true — and no `lint`/`format`/`typecheck` script |
| `:502` | Sentry DSN hardcoded | true (`index.tsx:20`) |
| `:503` | Vercel headers present, no CSP | true |
| `:504` | must not ship `server.url` | true, and correctly guarded (`scripts/assert-android-release.mjs`) |
| `:505` | ~~hardcoded LAN IP~~ | resolved |
| `:506` | `(window as any).Clerk` | true (`lib/supabase.ts:34`) |
| `:507` | email/AI fire-and-forget on the client | true (`supabaseApiService.ts:1051-1057`) |
| `:508` | ~~client Gemini key~~ | resolved |
| `:509` | live RLS must be verified after Phase A+B | **open** — §10.1 |
| `:512` | `/src/` vestigial | true — only `src/test/` |
| `:513` | "47 root `.md`" | 46; none archived |
| `:514` | Tailwind double-installed; README says CDN | true (`README.md:93` vs `postcss.config.js:3`) |
| `:517` | Playwright gaps: invite, archive, deletion-request, multi-payer | **still open** — 4 specs only |
| `:518` | coverage 10.76/68.94/31.29, thresholds 8/65/28/8 | true — but `:386-388` of the same file states 85/70 as "verified". The document contradicts itself |

**`USER_FLOW_ANALYSIS_AND_BUGS.md`**

| doc:line | Item | Status |
|---|---|---|
| `:100-137` | BUG #1 self-removal leaves group visible | **FIXED** — `App.tsx:424-431` detects `removingSelf`, opens the confirm-leave modal, `:395` invalidates, `:398` clears the selection |
| `:189-206` | BUG #2 creator not in members ("actually working") | correct — `supabaseApiService.ts:189-191` |
| `:297` P1.1, `:298` P1.2 | fix self-removal + add confirmation | **DONE** (`App.tsx:430`, modal at `:876-908`) |
| `:302` P2.4 | creator badge in member list | **open** |
| `:303` P2.5 | prevent removing the last member | **open** — `GroupFormModal.tsx:115 removeMember` has no floor |
| `:304` P2.6 | loading state during group updates | partial (`isProcessingGroupAction`) |
| `:307` P3.7 | member count on group cards | **open** |
| `:308` P3.8 | show "You" next to the current user | **open** — only the `'Me'` fallback at `GroupFormModal.tsx:224` |
| `:309` P3.9 | tooltips | **open** |
| `:15` | "Supabase Auth check" in the login flow | wrong — Clerk |
| `:407` | cross-references `FIX_SUMMARY_auth_user_id_to_clerk_user_id.md` | **the file does not exist** |

**`MISSING_MODALS.md`** — built: `BaseModal`, `SettleUpModal`, `ConfirmDeleteModal`,
`PaymentSourceFormModal`+`PaymentSourceManageModal` (its `status='archived'` shipped as
`is_active`), `MemberInviteModal`, `TransactionDetailModal`, `ArchivePromptModal`+
`ArchivedGroupsModal`, `SettingsModal`. **Not built:** `ReceiptUploadModal` (`:73` — no
component, no `receipts` table, no Storage bucket at all), `AdjustBalanceModal` (`:113` — the
`'adjustment'` type in §4.3 is its only trace), `CategoryManager`, `BulkImport`, `ActivityLog`,
`WhatsNew`, `PrivacyNotice`, `ReAuth` (`:126-144`). Tables `receipts`, `categories`,
`tags`/`transaction_tags`, `audit_log` (`:154-157`) — **none exist**. `OptimizeSettlementsModal`
(`:98`) is partial: no modal, but the algorithm exists as `simplifyGroupDebts` and is consumed
by `Dashboard.tsx:20`. `ExportDataModal` (`:120`) is partial — `DataExport.tsx` exists and its
import half is fake (D-14). `:262` instructs keeping this file updated with a Status column;
never done.

**`PRODUCTION_CHECKLIST.md`** — 40 boxes, all still unticked in the file. Actually done since:
bundle splitting (`:6`), `.env.example` (`:12`), env docs (`:14`), error boundaries (`:18`),
crash reporting (`:21`), CORS (`:25`), Gemini rate limiting (`:26`), service worker (`:36`),
CI/CD (`:62`), data export (`:69`), GDPR/anonymise (`:70`). Still not done: **environment
validation (`:13`)** — the file `ARCHITECTURE.md` cites for it does not exist; server-side
input validation (`:27`, client-only today — §3.1); APM/uptime/alerts/analytics (`:46-50`);
DB backup strategy (`:67`); API docs, user manual, troubleshooting (`:53-56`).

**Fix documents whose claimed fix is absent or wrong** (full table in the docs sweep):
`DUPLICATE_USER_FIX_SUMMARY.md:22-38` claims `ensureUserExists` does name-similarity matching,
merges duplicates, re-points transactions and memberships, and deletes duplicate rows —
**none of that exists** in `supabaseApiService.ts:846-912`; the only merge helper
(`mergePersonByEmail`) has zero callers. `USER_ISOLATION_FIXES.md:30-34` claims payment sources
are filtered on `created_by`; the code filters `user_id` (§8.9). `USER_CODE_ERROR_REPORT.md`
item #4 (rename `Person.authUserId` → `clerkUserId`) is still not done (`types.ts:8`), and its
item #3 is worse than reported: `components/auth/SignupForm.tsx` is gone, but
`components/auth/AuthLayout.tsx:2-3` still imports `./LoginForm` and `./SignupForm` — **two
non-existent modules**. It only survives because `AuthLayout` has zero importers, so Vite never
resolves them. Several fix docs also instruct readers to look for console logs
(`INVITE_FIX_SUMMARY.md:69-77`, `TEST_INVITE_FIX.md:37-43`) that no longer exist in the code.

### 4.6 Commented-out and vestigial code

| Location | What |
|---|---|
| `supabaseApiService.ts:597, 617` | `// emailService.sendSettleUpEmail({...})` / `sendNewExpenseEmail({...})` — the two commented-out calls that make §2.7's 55-line block pointless |
| `supabaseApiService.ts:1-47` | four exported functions declared **before** the file's `import` statements (`:48`) |
| `supabaseApiService.ts:919-927` | a **second** import block, 900 lines into the file |
| `App.tsx:914-921` | a **second** import block after the `App` component ends, including a duplicate `toast` import (D-02) |
| `App.tsx:84` | `// Moved to TanStack Query: transactions, people, paymentSources` — a migration note left in the state block |
| `App.tsx:303-304` | two comment lines where realtime code used to be |
| `supabaseApiService.ts:26-27` | `// Mark group as archived for this user (add to archived_groups table…)` — describes a per-user archive design that was never built; the code sets a global flag instead |
| `supabaseApiService.ts:521` | `// Optional pre-check: ensure no transactions reference it. For now we allow deletion even if referenced.` (in `App.tsx:521`) — the deferred check that produces the FK-error toast at `:529` |

---

## 5. Dependency debt

`package.json` declares **23 `dependencies` + 20 `devDependencies`** (`audit/00-map.md:74`
says 21 dev — corrected). Lockfile: 835 packages, lockfileVersion 3.

### 5.1 Unused — delete

| Package | Declared | Evidence |
|---|---|---|
| `madge` | devDep | **zero references repo-wide** — no `.madgerc`, no npm script, no CI step, no doc |
| `terser` | devDep | zero references; build is `minify: 'esbuild'` (`vite.config.ts:99`). Vite's `terser` peer is `optional:true`. It only resolves because `@rollup/plugin-terser` (via `vite-plugin-pwa → workbox-build`) depends on it — the transitive copy stays whether you declare it or not |
| `supabase` (CLI 2.113.0) | devDep | **no npm script and no CI step invokes it.** Referenced only in prose (`CORS_EMAIL_SOLUTION.md:42-54`, `docs/security-phase-a.md:26-35`). A large CLI binary installed for zero automation — consistent with §8's finding that every migration is applied by hand |
| `@capacitor/keyboard` | dep | **zero references anywhere** — no JS/TS import, no `android/app/src/**` reference, no `Keyboard` block in `capacitor.config.ts`. Still linked into the Android build at `android/capacitor.settings.gradle:11-12` and `android/app/capacitor.build.gradle:14`, so it is compiled into every shipped AAB |

### 5.2 `vite-plugin-node-polyfills` — nothing forced it

`vite.config.ts:34-37` enables it with `protocolImports: true`. Grep across all app source:

- `node:`-prefixed imports — **0**. `protocolImports: true` therefore polyfills nothing.
- `Buffer` — **0**. Bare node builtins (`crypto|stream|buffer|util|events|path|fs|os|http|https|zlib|url|assert`) — **0**.
- `global` as an identifier — **0 real hits**. `lib/supabase.ts:55` is supabase-js's `global:`
  *option key*, not the JS global. And `vite.config.ts:159` already maps `global: 'globalThis'`
  via `define`, independently of the plugin.
- **The only thing it rescues is `services/apiService.ts:88-89`** — two unguarded
  `process.env.VITE_SUPABASE_*` reads that would `ReferenceError` in a browser without a
  `process` shim. (`utils/env.ts:41-43` and `paymentSourceMetrics.ts:25` are both guarded by
  `typeof process !== 'undefined'` and are safe without it.)

Those two lines already check `import.meta.env` on the same line, so the `&& !process.env.…`
clauses are pure redundancy. **A 3-character deletion removes the last justification for the
plugin.** Cost of keeping it: it is the sole source of two of the lockfile's five deprecated
packages (`rollup-plugin-inject@3.0.2`, `sourcemap-codec@1.4.8`) plus `magic-string@0.25.9`
and `estree-walker@0.6.1`, and it declares **no peerDependencies at all**, so nothing
constrains it against Vite 6.

### 5.3 Duplicate systems

**Two icon systems for a four-icon payoff.** `lucide-react@0.546.0` is imported at exactly
three sites for **4 icons** — `ChevronDown`, `ChevronUp` (`Dashboard.tsx:4`), `ListFilter`
(`FilterBar.tsx:4`), `X` (`GroupBalancesModal.tsx:4`). `components/icons/Icons.tsx` hand-rolls
**17** SVG exports and is imported from 11 sites. They overlap directly: `Icons.tsx:31 CloseIcon`
≡ lucide `X`; `Icons.tsx:130 ChevronDownIcon` ≡ lucide `ChevronDown`. Adding `ChevronUp` and
`ListFilter` to `Icons.tsx` (~14 lines) removes a whole dependency.

**Two Playwright packages.** `playwright@1.59.1` is a **prod** dependency; `@playwright/test@1.59.1`
is a devDependency and already pulls `playwright-core@1.59.1`. The only importer of bare
`playwright` is `scripts/spotcheck-theme.mjs:8` — an orphaned codemod-verification script
(§1.1). **A dead script is the sole reason a browser-automation package ships in `dependencies`.**

### 5.4 Misplaced — should be `devDependencies`

| Package | Why |
|---|---|
| `@capacitor/cli` | `capacitor.config.ts:1` imports it **type-only**; otherwise `npx cap` in scripts |
| `dotenv` | `playwright.config.ts:2,5,6` and `scripts/seed-schema.js:13,18` only — never bundled |
| `playwright` | see §5.3 |
| `vite-plugin-pwa` | build-time plugin |
| `workbox-window` | move with the plugin it is a peer of (do **not** delete — §4.2) |

### 5.5 Version and peer-range risks

1. **`vitest@5.0.0` requires peer `vite: ^6.4.0 || ^7 || ^8` (not optional).** The root
   declares `vite: ^6.2.0` (`package.json:69`). The lock resolved `vite@6.4.3` so it holds
   *today*, but the declared range **admits 6.2.x/6.3.x, which violate the peer**. A fresh
   install against a pinned registry, or `npm ci` on an older lock, can produce an
   unsatisfiable tree. Tighten to `^6.4.0`.
2. **`@clerk/clerk-react@5.61.9` peers on `react: ^18 || ~19.0.3 || ~19.1.4 || ~19.2.3 || ~19.3.0-0`
   — a tilde list.** The root declares `react: ^19.2.0`, which permits `19.4.x` and would fall
   outside Clerk's peer. The lock sits at `19.2.4`, inside `~19.2.3`, by luck of resolution.
   Given the `manualChunks` comment at `vite.config.ts:105-108` about Clerk touching React
   internals at module-init time, this is not a theoretical risk.
3. **Deprecated packages in the lockfile (5):** `rollup-plugin-inject@3.0.2` (L9120),
   `sourcemap-codec@1.4.8` (L9605), `workbox-build/node_modules/source-map` (L11182),
   `sucrase/node_modules/glob` (L9973), `glob@11.1.0` (L6476). The first two come exclusively
   from `vite-plugin-node-polyfills` (§5.2).
4. 33 packages resolve at ≥2 different majors; all transitive, none an app dependency.

### 5.6 Real usage confirmed (no action)

`@capacitor/{app,browser,core,splash-screen,status-bar,android}`, `@clerk/clerk-react`,
`@sentry/react`, `@supabase/supabase-js`, `@tanstack/react-query`, `html2canvas`
(`GroupSummaryModal.tsx:4→:90`, `GroupView.tsx:8→:134`), `react`, `react-dom`,
`react-hot-toast`, `zustand`; dev: `@playwright/test`, `@testing-library/*` (`user-event` at
exactly one site: `src/test/components/WelcomeScreen.test.tsx:3`), `@types/node`,
`@vitejs/plugin-react`, `@vitest/coverage-v8`, `@vitest/ui`, `autoprefixer`, `jsdom`,
`postcss`, `tailwindcss`, `typescript`, `vite`, `vitest`.

Note `typescript` is installed and `tsconfig.json` sets `noEmit`, but **no npm script ever runs
`tsc`** and no workflow does either. See §7.3 and §6.5.

---

## 6. Configuration debt

### 6.1 Config that points at things that do not exist

| Config | Points at | Reality |
|---|---|---|
| `vercel.json:15-18` — rewrite `/.well-known/assetlinks.json` → itself, with `Content-Type: application/json` (`:32-70`) | `public/.well-known/assetlinks.json` | **The file does not exist.** `public/.well-known/` is absent. |
| `AndroidManifest.xml:49` — `android:autoVerify="true"` for `www.motamaati.in` + `motamaati.in` on `/sso-callback` and `/invite` | requires that assetlinks file | **App Links verification cannot succeed.** Both deep-link families silently fall back to the "open with" disambiguation dialog — including the invite links the whole invite feature depends on. |
| `vite.config.ts:44` `includeAssets` | `apple-touch-icon.png`, `masked-icon.svg` | neither exists |
| `vite.config.ts:82` SW runtime cache | `https://api.supabase.co/*` | not a real host for this project |
| `package.json:17` `test:e2e:auth` → `--project=chromium-auth` | a project defined only when `TEST_USER_EMAIL`+`TEST_USER_PASSWORD` are set (`playwright.config.ts:8,59-71`) | fails with "unknown project" without `.env.test` |
| `.github/workflows/playwright.yml:3-6` | branches `main` **and `master`** | `master` does not exist |

### 6.2 [P1] The Android release ships an empty Clerk key

`android/app/build.gradle:26-27`:
```gradle
resValue "string", "clerk_publishable_key", System.getenv("VITE_CLERK_PUBLISHABLE_KEY") ?: ""
```
This is the key the **live** native sign-in path reads (`ClerkNativeAuthPlugin.kt`, reached
from `AuthScreen.tsx:63` → `useNativeGoogleSignIn` → `nativeAuthBridge` → `clerkNativeAuth`).

`.github/workflows/android-ci.yml` sets `VITE_CLERK_PUBLISHABLE_KEY` **only in the environment
of the `npm run build` step (`:45-48`)**. The Gradle `bundleRelease` step (`:76-82`) does not
export it. `System.getenv` therefore returns null and the resource is compiled as `""`.

Every CI-built AAB ships an empty `clerk_publishable_key` to the native plugin. Confidence:
LIKELY (read from the workflow; not observed in a built artifact). This deserves an immediate
check against a real release.

### 6.3 Hardcoded values

| Value | Occurrences | Assessment |
|---|---|---|
| `motamaati.in` | **11 places, 4 languages**: `capacitor.config.ts:18,27,28`, `components/auth/clerkAppearance.ts:22`, `hooks/useNativeOAuth.ts:7`, `index.html:19,26`, `public/native-sso.html:36`, `AndroidManifest.xml:53-56`, `supabase/functions/native-bridge/index.ts:27,30`, `.env.example:23`, `.env.test.example:7` | public domain, not a secret; a domain change is a cross-platform, multi-file edit with no single source of truth |
| Sentry DSN | `index.tsx:20` | **Not a credential leak** — a DSN is a public write-only ingest key. The problem is what surrounds it: `sendDefaultPii: true` (`:28`), `replaysOnErrorSampleRate: 1.0` (`:27`), `Sentry.setUser({id, email, username})` (`App.tsx:60`), and `sourcemap: false` (`vite.config.ts:100`) with no source-map upload. **User emails and full session replays of an expense tracker are shipped to Sentry, and the stack traces are unsymbolicated.** The public DSN also means anyone can forge events into the project. |
| device serial `RZCW308ZM5Y` | `scripts/deploy_test.ps1:10,11,12` | orphan script, machine-locked |
| `JAVA_HOME` absolute paths | `package.json:20,21` (`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot` — **pinned to a point release**, twice); `scripts/deploy_test.ps1:1`; `scripts/android-release.ps1:10` and `scripts/install-android-sdk.ps1:8` both reference **`C:\Users\NINAD\...`, a different developer's home directory** | `install-android-sdk.ps1` hard-fails on this machine (repo is under `C:\Users\91626\`) |
| `CURRENT_USER_ID = '00000000-…-0001'` | `constants.ts:4` | dead sentinel from the pre-Supabase mock era |
| `kharch-baant-psi.vercel.app` | `vercel-diagnostic.js:7` (comment) | stale, in a dead file |
| `192.168.*` | **zero in shipped code** — two comments (`capacitor.config.ts:4`, `scripts/assert-android-release.mjs:4`) and 7 markdown files | the former hardcoded `server.url` was correctly refactored to `CAPACITOR_DEV_SERVER_URL` |

**No genuine credential leak was found.** Zero `eyJ…` JWT literals, zero real `pk_`/`sk_`
values (only the placeholder in `ENV_SETUP.md:7`), zero real Supabase project refs, keystores
correctly gitignored (`.gitignore:41,46,47`) and CI-decoded from secrets.

### 6.4 Env-name drift

| Var | Verdict |
|---|---|
| `VITE_API_MODE` | **defined-but-never-read.** Registered in `utils/env.ts:23`, but `getEnvValue` is never called with it (all 5 call sites are `nativeAuthBridge.ts:52,53,90`). `vite.config.ts:148-150` injects it into **every bundle with a default of `'supabase'`** for nobody. |
| `VITE_DEBUG_ENABLED` | defined-but-never-read. In `utils/env.ts:25` and `.env.example:31`; no caller. |
| `VITE_DEV_MODE` | **fully dead** — in `utils/env.ts:26` only. Not in `.env.example`, not in `vite-env.d.ts`, not in `define`, no caller. |
| `REACT_APP_API_MODE` | dead — `utils/env.ts:29`, written by `setup-local.sh:19`, read by nobody |
| `REACT_APP_SUPABASE_URL` / `_ANON_KEY` | **live** fallbacks (`lib/supabase.ts:7,11`) but **absent from `.env.example`** |
| `VITE_APP_URL` | declared in `vite-env.d.ts:8`, commented in `.env.example:12`, read nowhere |
| `VITE_GOOGLE_WEB_CLIENT_ID` | injected by `vite.config.ts:139`; the only reader is `services/nativeGoogleAuth.ts:14` — **dead file** (§2.11). Effectively never read. |
| `CAPACITOR_DEV_SERVER_URL` | **genuinely used and correctly release-guarded** (`capacitor.config.ts:7`, `scripts/assert-android-release.mjs:28`) |
| `SUPABASE_DB_URL`, `SMOKE_SUPABASE_JWT`, `SPOTCHECK_URL`, `JWT_SECRET`/`SUPABASE_JWT_SECRET` | read by code, documented nowhere |

`envPrefix: ['VITE_', 'REACT_APP_']` (`vite.config.ts:96`) means **every** `REACT_APP_*` in a
local `.env` leaks into the client bundle, not just the two in the `define` block.

### 6.5 CI / quality gates

- **No workflow runs `vitest`.** `android-ci.yml` builds and publishes; `playwright.yml` runs
  only the unauthenticated `chromium` project (it has no secrets, so `hasAuthCreds` is false).
  The 18 unit-test files — including the 1,009 LOC that test dead code (§1.1) — **never
  execute in CI**.
- **No `typecheck` or `lint` script exists** anywhere, despite `typescript` being installed
  and `tsconfig.json` being `noEmit`. This is what allows D-02 (the duplicate `toast` import)
  to ship.
- `vitest.config.ts:41-50` sets coverage thresholds to `lines: 8, statements: 8,
  functions: 28, branches: 65` against a measured 10.76% — an 8% line-coverage gate is not a
  gate, and nothing runs it anyway.
- `vitest.config.ts` does **not** `mergeConfig` with `vite.config.ts`, so tests run without
  the `@` alias, without the `define` block and without the polyfills.
  `src/test/setup.ts:8` hand-stubs `VITE_SUPABASE_URL` to compensate — a second, divergent
  environment definition.
- `android-ci.yml` runs on `pull_request`, and its "Validate build secrets" step therefore
  fails on every fork PR by design.
- CI version drift: `android-ci.yml` uses node `20`, `playwright.yml` uses `lts/*`.
- `android/app/build.gradle:47` — `minifyEnabled false` on the **release** build type. No R8,
  no shrinking, no obfuscation on the Play artifact.
- Local `versionCode 7` / `versionName "1.0.6"` (`build.gradle:24-25`) are overridden by CI
  with `github.run_number`. A local `android:build:release` therefore produces `versionCode 7`
  forever and will be rejected by Play as a duplicate.

### 6.6 Vercel / headers

Six rewrites, of which **three are identity no-ops** (`/native-sso.html`, `/privacy.html`,
`/account-deletion.html` → themselves) whose only purpose is to shadow the SPA catch-all
`/(.*) → /index.html` (`:27-30`). Fragile idiom, but it works — except for the assetlinks one,
which cannot work because the source file is absent (§6.1) and would therefore fall through to
the SPA and return HTML where Android expects JSON.

Headers present (`:32-70`): HSTS `max-age=63072000; includeSubDomains; preload`,
`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy: same-origin-allow-popups`.

**There is no `Content-Security-Policy`** — on an app that loads a remote Clerk script from
`clerk.motamaati.in` (`public/native-sso.html:36`), runs Sentry session replay, and executes
an inline blocking `<script>` in `index.html:38-51`. No `Cross-Origin-Embedder-Policy`, no
cache policy for hashed assets. (Pass 1.2/2 material; recorded here as configuration debt.)

### 6.7 `capacitor.config.ts` — what `hostname: 'www.motamaati.in'` actually does

`:18` does **not** make the WebView fetch from that domain. Capacitor serves the bundled
`dist/` through the local `WebViewAssetLoader` but stamps the document **origin** as
`https://www.motamaati.in`. Consequences:

- Clerk's `pk_live_*` origin allowlist accepts it — the stated reason (`:16-17`);
- `localStorage` / IndexedDB / cookies are keyed to that origin, so the native app and a real
  browser visit to the real site are two independent storage buckets that look identical to
  Clerk and Supabase;
- an XHR to `https://www.motamaati.in/<path>` is same-origin to the WebView but is
  **intercepted locally** — a path not present in `dist/` 404s from the asset loader, not from
  Vercel;
- Edge-Function CORS therefore depends on a **spoofable** `Origin` header, which is why
  `supabase/functions/native-bridge/index.ts:27` has to hard-code
  `CAPACITOR_ORIGIN = 'https://www.motamaati.in'` as an allow-list entry.

`allowNavigation` (`:24-29`) deliberately excludes `accounts.google.com` and
`www.motamaati.in`, with a correct explanatory comment (`:19-23`).

### 6.8 Committed files that should not be

- `public/manifest.webmanifest` — **0 bytes** (§4.2).
- `public/check-env.html` (1,997 B) and `public/generate-icons.html` (3,574 B) are **published
  to production**. `check-env.html:36-51` renders a diagnostic panel keyed on
  `hostname.includes('vercel.app')` (`:38-39`), which is **false on `www.motamaati.in`** — so
  on the real production domain it renders a red "Local/Other" error box. Leaks nothing
  secret, but it is a live, unlinked, wrong-answer diagnostic page. `public/ICON_SETUP.md` is
  served as a raw file too.
- `knip-report.json` (98,156 B, UTF-16) — stale tool output, **not gitignored**.
- `structure.txt`, `components.txt` — UTF-16 `tree` dumps listing files that no longer exist.
- `.agent/rules/byterover-rules.md` is **committed** while the eight sibling AI-tool rule
  directories are ignored (`.gitignore:25-32`: `.clinerules/`, `.kilocode/`, `.roo/`,
  `.windsurf/`, `.cursor/`, `.kiro/`, `.qoder/`, `.augment/`, plus `.claude/` at `:61`).
  **Nine different AI assistants left configuration behind.**
- `deploy-main.ps1:23` runs `git add -A` on a tree whose `.gitignore` covers none of
  `knip-report.json`, `audit/`, `vite.pid`, `vite.out.log`, `vite.err.log` (the last three
  produced by `scripts/start-detached.mjs`). Every "deploy" commit sweeps them in.

`deploy-main.cmd` is **not** a duplicate of `deploy-main.ps1` — it is a 2-line `cmd.exe` shim
(`powershell -ExecutionPolicy Bypass -File "%~dp0deploy-main.ps1" %*`) providing a
double-clickable entry point. Legitimate.

### 6.9 The three design-token codemods are a pipeline, not rivals

`scripts/migrate-design-tokens.mjs` (261) → `cleanup-duplicate-tokens.mjs` (66) →
`spotcheck-theme.mjs` (234). Stage 1 does ~200 ordered literal replacements and collapses
`dark:` variants into unprefixed tokens (`:34-46`), which produces duplicates like
`bg-card bg-card`; **stage 2 exists solely to repair stage 1's own damage** (`:22-37`, `:44-53`).
They contradict once: stage 1 leaves `bg-primary … text-foreground` (wrong contrast on primary
buttons) until stage 2 rewrites it to `text-primary-foreground` (`:57`) — so running stage 1
alone produces a visually broken build. Stage 1 is **not idempotent** despite its
"Idempotent-ish" claim (`:4`): `from-emerald-500 to-teal-600 → from-success to-success` is
lossy and unreversible.

Both stages call `fs.writeFileSync` on repo source (`migrate-design-tokens.mjs:250`,
`cleanup-duplicate-tokens.mjs:61`) with **no dry-run flag, no backup, and no git-clean check**.
They finished their job — the token layer now lives in `tailwind.config.js:31-74` and
`index.css` — and are 561 LOC of loaded footguns sitting in a repo an AI assistant is invited
to run scripts from. **Not run during this audit.**

`tailwind.config.js`'s `content` globs (`:4-12`) cover `index.html`, `src/**`, `components/**`,
`App.tsx`, `index.tsx`, `contexts/**`, `hooks/**` — and **omit `utils/**`, `store/**`,
`lib/**`, `services/**`**. Any class string constructed there is purged.

### 6.10 Playwright can write to production

`playwright.config.ts:28` — `baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'`,
and `:96` disables the local `webServer` whenever that var is set.
`.env.test.example:7` documents `PLAYWRIGHT_BASE_URL=https://www.motamaati.in` literally.
Combined with `chromium-auth` (`:59-71`) signing in with real Clerk credentials, and
`tests/authenticated.expense.spec.ts` / `authenticated.settle-up.spec.ts` **creating expenses
and settlements**, a `.env.test` pointing at production writes real rows into the production
Supabase project. **There is no guard against this.**

## 7. Type debt

### 7.1 `any` clusters

| File | count | note |
|---|---:|---|
| `services/supabaseApiService.ts` | 30 | 6 of them `(supabase as any)` — §7.2 |
| `hooks/useModals.ts` | 16 | **dead file** |
| `services/queries.ts` | 9 | every realtime payload is `any`, then cast: `newRow as Group`, `as Transaction`, `as PaymentSource`, `as Person` (`:56,68,98,127,154`) — an unchecked cast on data arriving from the network |
| `services/apiService.ts` | 5 | |
| `components/invite/InvitePage.tsx` | 5 | |
| others | 38 | |

`@ts-ignore` / `@ts-expect-error`: **0**. `eslint-disable`: **2**
(`apiService.ts:91`, `paymentSourceMetrics.ts:37`), both `no-console`, in a repo with **no
ESLint config committed** — so both directives are inert.

### 7.2 `(supabase as any)` × 6 — an unnecessary cast that is now load-bearing

`supabaseApiService.ts:225, 235, 251, 270, 281, 318` all cast the client to `any` to touch
`group_deletion_requests`. **The generated types include that table** —
`lib/database.types.ts:112-163`, with all three foreign keys. The cast is a fossil from before
the types were regenerated.

It is not harmless: it is applied to the *one* table in the schema with **zero RLS policies**
and the least-tested workflow, and it silences exactly the errors that would have caught
§2.4's dead `status` update.

### 7.3 Non-strict `tsconfig` — what would break under `strict`

`tsconfig.json` has no `strict` and sets `allowJs`. Concrete failures:

1. `App.tsx:239` — `error.message` where `error` is the `unknown` catch binding. Same at
   `:266` (`error?.message`), `:471`, `:557`, `:572`. Under `strict`, `TS18046`.
2. `supabaseApiService.ts:1108` — `currency: (g.currency as Group['currency']) ?? undefined`
   assigned to `Group.currency`, which is **required** (`types.ts:207`). `TS2322`.
3. `supabaseApiService.ts:1109` — same for `groupType`, required at `types.ts:208`.
4. `supabaseApiService.ts:1180-1184` — `{ id, name, members } as Group` omits the required
   `currency` and `groupType`; only the `as` cast hides it.
5. `supabaseApiService.ts:848-855` — `ensure_my_person` is typed `Returns: unknown`
   (`lib/database.types.ts:517`, the only RPC in the file not returning the `people` row
   shape). `transformDbPersonToAppPerson(row)` on `unknown` is `TS2345`.
6. `App.tsx:352` — `qc.setQueryData<Transaction[]>(…, prev => prev.map(t => … ? updatedTransaction : t))`
   where `updatedTransaction`'s inferred type flows from an `any`-returning path.
7. `hooks/useModals.ts:218-219` — `createAction` is a plain function that calls `useCallback`;
   the React hooks lint rule would reject it (there is no lint config, so nothing does).

### 7.4 Client/server contract drift

| Type | Declares | Reality |
|---|---|---|
| `AcceptInviteRequest.personId` | required (`types.ts:360`) | `acceptInvite:1145` destructures only `inviteToken` — **the field is passed by `App.tsx:216` and silently ignored** |
| `Transaction.type` | required `TransactionType` (`types.ts:288`) | DB column has a default; `transformDbTransactionToAppTransaction:102` coerces `null → 'expense'` |
| `Group.members` | required `string[]` (`types.ts:206`) | not a column — assembled by an **N+1 query** in `transformDbGroupToAppGroup:56-59`, and set to `[]` by `mapDbGroupRowBasic:386` on every realtime UPDATE (`queries.ts:66-72` then patches the old members back) |
| `Group.currency` / `groupType` | required | built as `undefined` in `validateInvite:1108-1109` and omitted in `acceptInvite:1180-1184` |
| `Person.authUserId` | optional string | mapped from **either** `auth_user_id` **or** `clerk_user_id`, whichever is non-null (`:123`) — two different identity spaces collapsed into one field |
| `EmailInvite.mailersendStatus` | 6-value union, non-nullable (`types.ts:326`) | DB column is free text and nullable; `:963` assigns it raw |
| `EmailInvite.status` | `'pending'\|'accepted'\|'expired'` | free text in DB |
| `PaymentSource` | no `userId`, no `createdBy` | DB has both; the app writes `user_id` and never `created_by` |
| `CreateInviteResponse.emailInvites` | optional | always `undefined` in practice — no UI passes `emails` |

---

## 8. Schema debt

43 SQL files, **3,703 lines**, in four directories with no ordering and no applied-state
tracking. Every `supabase/migrations/2026*` file carries "Apply manually via Supabase dashboard
SQL editor."

| Directory | Files | Lines |
|---|---:|---:|
| `supabase/migrations/` | 17 | 1,767 |
| `migrations/` | 17 | 1,299 |
| repo root | 6 | 547 |
| `scripts/migrations/` | 2 | 22 |
| `scripts/rls-beta-audit.sql` | 1 | 68 |

### 8.1 [P1] `i_created_group` — four versions, two incompatible semantics

| Ver | File:line | Predicate |
|---|---|---|
| V1 | `supabase/migrations/20260412000002…:23-31` | `created_by = requesting_user_id()` |
| V2 | `…20260412000003…:59-67` | byte-identical to V1 |
| V3 | `…20260412000004…:20-39` | `g.created_by = requesting_user_id() OR EXISTS(SELECT 1 FROM people WHERE id::text = g.created_by AND **user_id** = requesting_user_id())` |
| V4 | `…20260412000005…:38-57` | same, but the inner lookup uses **`clerk_user_id`** |

**Last applied by filename order: V4.** Nothing later redefines it.

**Divergence A (V1/V2 vs V3/V4) — the production bug the migrations were chasing.**
The app writes a **person UUID** into `created_by` (`supabaseApiService.ts:178`, §2.16).
With `groups.created_by = '2c134a55-…'` and JWT `sub = 'user_3BcYVO0…'`:
- V1/V2 → `'2c134a55-…' = 'user_3BcYVO0…'` → **FALSE**. The group's own creator is locked out
  of `groups UPDATE/DELETE`, `group_members INSERT/DELETE`, `transactions DELETE`, and (post
  Phase B) all four verbs on `group_invites`/`email_invites`.
- V3/V4 → **TRUE**.
The header comment at `20260412000004…:6-11` states this explicitly.

**Divergence B (V3 vs V4).** A `people` row with `user_id = 'user_3Bc…'` but
`clerk_user_id IS NULL` → V3 **TRUE**, V4 **FALSE**. Reachable: `create_unclaimed_person`
(`20260813010000…:26-42`) never sets `user_id`, and `supabase-auth-setup.sql:28` declares
`user_id` as `UUID` while `CLERK_AUTH_MIGRATION.sql:56-58` re-types it to `TEXT`.

### 8.2 [P1] `ensure_my_person` vs `claim_person_by_email` disagree on the claimed-row shape

`claim_person_by_email` exists in **3 versions** (`20260412000000…:25-36`,
`20260412000002…:182-192`, `20260812000000…:37-47` — the last takes identity from the JWT
rather than the client parameter). `ensure_my_person` (`20260813020000…:5-72`) has three paths.

| Writer | `clerk_user_id` | `user_id` | `is_claimed` | `source` | `email` | name |
|---|---|---|---|---|---|---|
| `ensure_my_person` path A "already claimed" (`:21-32`) | — | — | **—** | **—** | **overwrites** | `COALESCE(v_name, name)` |
| `ensure_my_person` path B "claim placeholder" (`:36-49`) | set | set | `true` | `'self'` | — | `COALESCE(v_name, name)` |
| `ensure_my_person` path C "insert" (`:51-70`) | set | set | `true` | `'self'` | set | passed, else email local-part |
| `claim_person_by_email` V3 (`:37-47`) | set | set | `true` | `'self'` | **never** | `COALESCE(NULLIF(trim(p_name),''), name)` |
| `claim_person_by_email` **V1** (`20260412000000…:28`) | set | set | `true` | `'self'` | — | — **plus `auth_user_id = p_clerk_id`** — a text Clerk id into a `uuid` column |
| client `mergePersonByEmail` (`supabaseApiService.ts:1284`) | set | **—** | `true` | **—** | — | **—** |

Five divergences: (1) path A never sets `source`/`is_claimed`, so a row claimed that way keeps
`source='manual'` forever; (2) `ensure_my_person` **overwrites** `email`, `claim_person_by_email`
never touches it; (3) only V1 wrote `auth_user_id`; (4) `ensure_my_person` sets `updated_at`
explicitly, `claim_person_by_email` relies on a trigger; (5) name precedence is the one thing
all of them agree on (passed-name-wins-if-non-blank).

### 8.3 [P1] Email normalisation asymmetry → permanently unclaimable placeholders

| Function | Expression | Normalises |
|---|---|---|
| `claim_person_by_email` (`20260812000000…:45`) | `email = lower(trim(p_email))` | **parameter only** |
| `ensure_my_person` (`:14`, used at `:44`) | `NULLIF(lower(trim(COALESCE(p_email,''))),'')` | **parameter only** |
| `create_unclaimed_person` (`20260813010000…:36`) | same, applied **on write** | column |
| `find_person_by_email` (`20260728000000…:113`) | `lower(trim(email)) = lower(trim(p_email))` | **both sides** |

**Concrete consequence.** A `people` row stored as `email = 'Bob@Example.com'` — anything not
written by `create_unclaimed_person`, e.g. the direct insert at `supabaseApiService.ts:892`, or
any row predating `20260813010000` — is **findable** by `find_person_by_email` but **never
claimable** by `claim_person_by_email` or `ensure_my_person` path B. Bob signs up and silently
gets a **duplicate person row** via path C instead of claiming his placeholder. His existing
transactions and memberships stay on the orphan. This is the mechanism behind
`DUPLICATE_USER_FIX_SUMMARY.md` — and §8.9 shows the fix that document claims was never built.

The partial unique index is `people_email_unique ON people(email) WHERE email IS NOT NULL`
(`20260405000000…:35`) — on the **raw** column. `'bob@x.com'` and `'Bob@X.com '` both insert
cleanly and then both match the same `find_person_by_email` call, whose `LIMIT 1` silently
picks one.

### 8.4 [P1] `HOTFIX_reset_all_policies.sql` is dropped by nothing

`migrations/HOTFIX_reset_all_policies.sql:21,26,31,37,43,48,53,59` creates eight `USING (true)`
policies: `groups_select_all`, `groups_insert_all`, `groups_update_all`, `groups_delete_all`,
`group_members_select_all`, `group_members_insert_all`, `group_members_update_all`,
`group_members_delete_all`. **No file in the repo drops them.**

- Phase A's cleanup (`20260728000000…:23-27`) only drops policies literally named
  `"Allow all operations"`.
- The blanket drop loop at `20260412000003…:23-35` would catch them, but it is dated *earlier*.
- The repo's own audit script only flags `policyname ILIKE '%allow all%'`
  (`scripts/rls-beta-audit.sql:19-27`) and checks `people` only — **it reports PASS on a
  database carrying all eight**.

Postgres RLS policies are **OR-combined** (permissive by default; none of these is
`AS RESTRICTIVE`). A surviving `groups_select_all` makes every carefully-scoped policy written
since irrelevant: any authenticated user sees every group and every `group_members` row.
And `QUICK_FIX.md:19-23` / `migrations/enable_realtime.sql:19-23` **grant `SELECT` on
`groups`, `transactions`, `payment_sources`, `people`, `group_members` to `anon` and
`authenticated`** — grep for `REVOKE .* ON TABLE` returns **zero hits repo-wide**. RLS is the
only thing standing between `anon` and those tables.

### 8.5 [P1] `group_deletion_requests` — RLS on, zero policies, six call sites

Complete repo-wide inventory of the table in SQL:
```
migrations/20251116_group_admin_and_deletion_requests.sql:8    CREATE TABLE …
migrations/20251116…:21,22                                     two indexes
supabase/migrations/20260728000000…:19                         ENABLE ROW LEVEL SECURITY
```
**No `CREATE POLICY` on this table exists in any of the 43 SQL files.** RLS enabled + zero
policies = deny-all for `authenticated` on every verb.

The app uses it at `supabaseApiService.ts:226, 236, 252, 271, 282, 319`. Every one fails
silently once `20260728000000…:19` is applied (SELECT → `[]`, INSERT/UPDATE → 42501). And the
admin check for approving a deletion is done **in JavaScript**
(`supabaseApiService.ts:294`, `filter(req => req.groups?.created_by === userId)`) — there is no
server-side authorisation for it at all.

Same file enables RLS on `ai_item_cache` (`:20`); that table's policies exist only in
`supabase-schema.sql:91-98`. If the database was built from `COMPLETE_DATABASE_MIGRATION.sql`
(which contains neither, §8.6), `ai_item_cache` is also deny-all and `tagClassifier.ts:17,32`
fails closed.

### 8.6 [P2] Two competing "full schema" files that disagree, and both are wrong

| Table | `supabase-schema.sql` | `migrations/COMPLETE_DATABASE_MIGRATION.sql` | Delta |
|---|---|---|---|
| `people` | `:8-14` | `:23-30` | COMPLETE adds `clerk_user_id TEXT UNIQUE`. **Neither** has `email`, `is_claimed`, `source`, `user_id`, `auth_user_id` |
| `groups` | `:17-30` | `:33-50` | COMPLETE adds `created_by TEXT` (no FK) and `is_archived`. Neither has `enable_cute_icons` |
| `group_members` | `:33-39` | `:53-59` | identical |
| `payment_sources` | `:42-49` | `:62-70` | COMPLETE adds `is_active`. Neither has `user_id` or `created_by` |
| `transactions` | `:52-66` | `:73-88` | COMPLETE adds `type … CHECK IN ('expense','settlement','adjustment')`. Otherwise identical |
| `ai_item_cache` | `:77-86` | **absent** | |
| `group_invites`, `email_invites` | **absent** | `:95-134` | |

**Neither file defines the `payers` JSONB column that `supabaseApiService.ts:548` inserts into.**
`grep -rn "payers" --include=*.sql` returns **zero hits repo-wide**. The multi-payer feature has
no schema definition anywhere in this repository.

And the two files fail in opposite directions:
- `COMPLETE_DATABASE_MIGRATION.sql` contains **zero `ENABLE ROW LEVEL SECURITY` and zero
  `CREATE POLICY`** — yet its own header (`:10`) says "Run this script in your NEW Supabase
  project's SQL Editor". A database built from it has **RLS entirely off on every table**.
- `supabase-schema.sql:158-162` enables RLS on all five core tables and creates **no policies
  for them** (only `ai_item_cache` gets policies at `:91-98`) — total deny-all until something
  from `supabase/migrations/` is run.

`migration-add-columns.sql:61` uses the **psql meta-command `\d groups`** and `:63` a bare
top-level `RAISE NOTICE` — both are syntax errors in the Supabase SQL Editor, where its own
header tells you to run it. Same defect at `migrations/20250126_fix_groups_created_by.sql:45`.

### 8.7 Enums as free text (no CHECK)

- **`groups.currency TEXT NOT NULL DEFAULT 'USD'`** (`supabase-schema.sql:20`,
  `COMPLETE…:36`) — no CHECK anywhere. The DB accepts `'BANANA'`. UI default is `'INR'`.
- **`people.source TEXT NOT NULL DEFAULT 'manual'`** (`20260405000000…:13`) — no CHECK. Four
  values written in the wild: `'self'`, `'manual'`, `'deleted'` (`anonymize_my_account:37`),
  plus whatever `types.ts:1` implies.
- **`transactions.type`** via the `scripts/` path (`20251004_add_type_to_transactions.sql:2`)
  is created constraint-free; the CHECK is added *conditionally* inside a `DO` block probing
  `information_schema` (`:4-13`). If the probe misses, the column is unconstrained.
  `COMPLETE…:85` adds it **with** NOT NULL. **Two production shapes.**
- `email_invites.mailersend_status` and `.status` **do** have CHECKs (`20251019…:34,37`),
  which is why `types.ts:326`'s 6-value union is only half wrong (it also declares
  non-nullable against a nullable column).

### 8.8 Nullable columns that must not be

- **`groups.created_by`** — nullable in every definition, and *explicitly* stripped of NOT NULL
  by `migrations/20250126_fix_groups_created_by.sql:17,28`. Every ownership check in the
  codebase keys on it. NULL = an ownerless group nobody can administer.
- `group_invites.is_active` / `current_uses` / `max_uses` — all nullable (`20251019…:12-14`).
  The RPCs defensively `COALESCE` them (`20260812000000…:97,201,241,244`) — **but forget to at
  `:109` and `:213`**, so a NULL `current_uses` makes `NULL >= max_uses` evaluate to NULL and
  **defeats the max-uses cap entirely**.
- `email_invites.status` nullable (`20251019…:37`); `accept_group_invite:257` filters
  `status = 'pending'`, which NULL never matches — a NULL-status invite is never marked accepted.
- `groups.is_archived`, `payment_sources.is_active`, `transactions.type` (scripts path), all
  `created_at`/`updated_at`. The client compensates with `?? true` / `Boolean(...)` /
  `|| 'expense'` — the workarounds are the evidence.

### 8.9 Missing, wrong and duplicated constraints

**`groups.created_by` has four mutually incompatible definitions**: `UUID REFERENCES auth.users(id) ON DELETE CASCADE`
(`supabase-auth-setup.sql:33`), `UUID REFERENCES people(id)` (`20251011…:3`, `20251116…:5`),
`TEXT` with no FK (`20251019_add_clerk_user_columns.sql:3`, `COMPLETE…:40`). The FK is
explicitly destroyed at `CLERK_AUTH_MIGRATION.sql:47` and the column re-typed to TEXT at
`:63/:65`. **Net: unconstrained TEXT holding a `people.id` UUID.**

**`payment_sources.created_by TEXT REFERENCES people(clerk_user_id)`**
(`20250101_add_user_to_payment_sources.sql:6`) — a FK to a **nullable** unique column that
`anonymize_my_account:33` sets to NULL. Nulling `clerk_user_id` on a person who owns payment
sources would raise an FK violation (no `ON DELETE`/`ON UPDATE` action declared). Moot only
because the column is never populated. `USER_ISOLATION_FIXES.md:30-34` claims the app filters
on this column; it filters on `user_id` (`supabaseApiService.ts:707,726`).

**`UNIQUE(group_id, email)` on `email_invites`** (`20251019…:43-44`, `COMPLETE…:132-133`) —
the comment says "no duplicate email invites for **same group**", but the constraint is on the
wrong pair. **A group can email a given address exactly once, ever, across all invite links.**
Re-inviting after a link expires raises a unique violation at `supabaseApiService.ts:1032-1041`,
which `throw`s. Meanwhile `get_invite_preview:122-123` and `accept_group_invite:256` both key
on `group_invite_id` — the pair that is *not* constrained.

**`UNIQUE(group_id)` on `group_deletion_requests`** (`20251116…:17-18`), comment says
"prevent duplicate **pending** requests", constraint is unconditional.
`requestGroupDeletion` (`supabaseApiService.ts:225-241`) looks only for `status='pending'`,
finds none, and inserts → **23505**. So once any request exists — including one already
`rejected` — **the group can never have another deletion request, forever**, and the user sees
a raw PostgREST error. A partial unique index `WHERE status='pending'` is what the comment
describes.

**`people.user_id` is not UNIQUE anywhere** (`supabase-auth-setup.sql:28`,
`CLERK_AUTH_MIGRATION.sql:56` both add it plain), while `people.clerk_user_id` is UNIQUE three
times over. Two person rows can carry the same Clerk id in `user_id`.

**Missing `updated_at`:** `group_deletion_requests` has no such column at all (`20251116…:9-19`),
so the status transitions at `supabaseApiService.ts:271` leave no modification timestamp;
`email_invites` likewise (`20251019…:25-45`).

### 8.10 Indexes: duplicated, and none of them match the actual queries

**Created 2–3 times** (most without `IF NOT EXISTS`, so a re-run errors):
`idx_people_clerk_user_id` (**3×** — `20250101…:10`, `20251019_add_clerk_user_columns.sql:11`,
`COMPLETE…:141`), `idx_groups_created_by`, `idx_groups_is_archived`, both `group_members`
indexes, all four `transactions` indexes, all eight invite indexes.

**Same name, different definition** — `idx_payment_sources_is_active`:
`ON payment_sources(is_active)` (`scripts/migrations/20251004…:3`) vs
`ON payment_sources(is_active) WHERE is_active = true` (`COMPLETE…:150`). Whichever runs
second is skipped or errors; **you cannot tell from the repo which shape production has.**

**Indexes that cannot serve the queries they were built for:**

| Index | Query it was meant for | Why it fails |
|---|---|---|
| `people_email_unique ON people(email)` (`20260405000000…:35`), `idx_people_email` (`20250126…:18`) | `find_person_by_email:113` — `lower(trim(email)) = …` | plain btree cannot serve a functional predicate → **seq scan on `people` on every invite lookup** |
| `idx_email_invites_email ON email_invites(email)` (`20251019…:53`) | `accept_group_invite:258` — `lower(trim(email)) = …` | same |
| `idx_transactions_date` (`supabase-schema.sql:73`) | `supabaseApiService.ts:522-525` — `WHERE group_id IN (…) ORDER BY date DESC` | **no `transactions(group_id, date)` composite exists anywhere.** The pair of single-column btrees forces a bitmap scan plus a sort |
| `idx_transactions_tag` (`:74`) | — | the app never filters by tag server-side; `GroupView.tsx:89-90` filters in the browser |
| `idx_payment_sources_created_by` (`20250101…:9`) | — | indexes a column nothing ever queries (§1.4) |

### 8.11 [P2] `numeric(12,2)` — the CHECK sees the rounded value

`amount DECIMAL(12,2) NOT NULL CHECK (amount > 0)` — identical in `supabase-schema.sql:56` and
`COMPLETE…:77`. (`DECIMAL` is an exact alias for `NUMERIC`.)

Postgres coerces the supplied expression to the column's declared type **including its
typmod** as an assignment cast, which for `numeric(p,s)` rounds **half away from zero** to `s`
digits. Only then does `ExecConstraints` evaluate the CHECK — against the already-rounded value.

| Client sends | Stored as | CHECK | Outcome |
|---|---:|---|---|
| `0.001` | `0.00` | fail | 23514 — user typed a positive number, gets "must be > 0" |
| `0.004` | `0.00` | fail | 23514 |
| **`0.005`** | **`0.01`** | pass | **silently doubled** |
| `0.014` | `0.01` | pass | silently truncated |
| `1.005` | `1.01` | pass | silent half-cent inflation |

The client (`TransactionFormModal.tsx:286`, `SettleUpModal.tsx:85`) accepts all of these. For a
bill-splitter the `0.005 → 0.01` band is the real defect: sub-paisa per-person shares produced
by the unrounded `calculateShares` (§2.2) round **up** on write, so the sum of stored shares can
exceed the stored total — and **no CHECK ties `split_participants` to `amount`** (§3.1).

### 8.12 Server-side invite logic — what `get_invite_preview` actually leaks

`get_invite_preview` is granted to **`anon`** (`20260812000000…:161`) and returns, at
`:120-124`, `jsonb_agg(jsonb_build_object('email', lower(trim(ei.email))))` for **every**
`email_invites` row on that invite. **Anyone holding an invite token gets the full invitee
email list, pre-authentication.** (The inviter's own email is deliberately withheld, `:150-155`.)

It is also declared `STABLE` (`:80`) while performing an `UPDATE` at `:105`
(`SET is_active = false` on expiry) — a write inside a function labelled read-only.

Acceptance is **never gated** on the accepter's email matching an `email_invites` row: the
email comparison at `:250-259` only marks rows `accepted` after the fact. Any token holder joins.

### 8.13 Policy churn

**174 `CREATE POLICY` statements across 21 files** for ~24 distinct policies on 9 tables.
Same-name creations by distinct file: `"Users can insert groups"` **11×**,
`"Users can insert group members"` **11×**, `"Users can view group members"` **10×**,
`"Users can view their groups"` **8×**, `"Users can update their groups"` **8×**,
`"Users can update their people"` / `"Users can insert people"` **7×** each, three delete
policies **7×** each, the payment-sources quartet **6×** each.

Same names, **three incompatible identity models**: `auth.uid()` (`supabase-auth-setup.sql`,
`20250126_migrate_to_supabase_auth.sql`), `people.user_id = requesting_user_id()`
(`CLERK_AUTH_MIGRATION.sql`, `20260412000001/2/3`), `people.clerk_user_id = requesting_user_id()`
(`20260412000005` onward). Which one is live depends entirely on undocumented manual apply order.

### 8.14 Dropped and undefined functions

- **`i_am_person(uuid)`** — created `20260412000002…:70-77`, **dropped** `20260412000003…:41`,
  never re-created. Zero references anywhere, not even in the generated types.
- **`i_can_see_person(uuid)`** — dropped at `20260412000003…:40`, re-created by Phase A
  (`20260728000000…:30-72`).
- **`debug_auth_check()`** — declared in `lib/database.types.ts:508`;
  `grep -rn "debug_auth_check" --include=*.sql` returns **zero hits across all 43 files**. It
  exists in production and **has no source in this repository.** A database rebuilt from this
  repo will not have it. This is the clearest single proof that the production schema is not
  reconstructible from the repo.
- `handle_new_user` + trigger `on_auth_user_created` (`supabase-auth-setup.sql:188-205`) —
  dropped at `CLERK_AUTH_MIGRATION.sql:213-214`. Note it inserted a
  `https://i.pravatar.cc/150?u=` avatar (`:195`) that `20260726000000…:5` later has to scrub.
- `requesting_user_id()` exists in **3 versions**; the first two read
  `request.jwt.claim.sub` (**always NULL**), fixed only at `20260412000006…:17-22` to
  `request.jwt.claims::jsonb->>'sub'`.

---

## 9. Findings

Severity key: **P1** — can show or store wrong money, or wrongly grant/deny access.
**P2** — will cause the next fix to land in the wrong place, or degrades a shipped user flow.
**P3** — cleanliness.

### [P1-01] D-01 · Home card and Balances modal ignore `payers[]`, showing balances up to 5x wrong
Severity P1 · Confidence **CONFIRMED** · Area: money/correctness
**Location** `components/GroupSummaryCard.tsx:16-29`, `components/GroupBalancesModal.tsx:23-46`
vs `utils/calculations.ts:4-23`.
**What is wrong** Both re-implement balance accumulation and credit `t.amount` to
`t.paidById`. Neither has a `payers[]` branch. `calculateGroupBalances:8-14` does.
**How to reproduce** `node audit/poc/balance-divergence.mjs`. ₹100 dinner, A paid ₹60, B paid
₹40, split equally: canonical says A **+10**/B −10; the Home card and the Balances modal both
say A **+50**/B −50. With a payer who is not a participant (₹300, A paid 100, B paid 200, split
B+C) the Home card reports A as **settled up** while the canonical figure is **+100**.
**Blast radius** Every multi-payer group. The Home screen shows both numbers **on the same
screen** — the group card says "You are owed ₹50.00", the summary tile above it says "Total you
are owed ₹10.00".
**Why it exists** Multi-payer (`payers` JSONB) was added after these two components were
written; `calculateGroupBalances` was updated and the two inline copies were not.
**Containment** ~20 min: replace both inline loops with `calculateGroupBalances(transactions)`
and read the current user's entry.
**Correct fix** Delete both inline implementations. Every balance surface calls
`calculateGroupBalances`, or `getUserFacingDebts` for netted per-person lines.
**Proof of fix** Extend `src/test/utils/calculations.test.ts` with the PoC's CASE 1/CASE 2
fixtures and assert all five surfaces agree.
**Depends on** nothing.

### [P1-02] D-02 · `App.tsx` imports `toast` twice — an ES module early SyntaxError
Severity P1 · Confidence **CONFIRMED** (duplication) / **LIKELY** (build tolerance) · Area: build integrity
**Location** `App.tsx:3` (`import toast, { Toaster } from 'react-hot-toast'`) and
`App.tsx:921` (`import toast from 'react-hot-toast'`).
**What is wrong** Two `import` declarations bind the same identifier in one module. Verified
against Node 24: `SyntaxError: Identifier 'toast' has already been declared` — an early error,
not a runtime one. `tsc` would report TS2300.
**How to reproduce** `node audit/poc/../../scratchpad` equivalent: two default imports of the
same name in one `.mjs` fails to parse. The app ships because **no npm script or workflow ever
runs `tsc`** (§6.5) and esbuild's TS parser tolerates it.
**Blast radius** The whole app module. It works today only by grace of one bundler's leniency;
any change to the build chain — a `tsc` step, a different minifier, Vite's Rolldown migration —
turns it into a hard build failure with no prior warning.
**Why it exists** `App.tsx:914-921` is a **second import block appended after the `App`
component ends**, the signature of an AI appending code without reading the file head. The same
pattern appears twice in `supabaseApiService.ts` (`:1-47` before its imports at `:48`, and a
second import block at `:919-927`).
**Containment** 30 seconds: delete `App.tsx:921`; also delete the unused
`import { Capacitor }` at `:914`.
**Correct fix** Add `"typecheck": "tsc --noEmit"` to `package.json` and run it in CI.
**Proof of fix** `npx tsc --noEmit` exits 0.
**Depends on** installing dependencies.

### [P1-03] D-03 · `groups.created_by` holds a person UUID; `i_created_group` has 4 versions, 2 of which reject it
Severity P1 · Confidence CONFIRMED (code) / LIKELY (which version is live) · Area: authorization
**Location** `supabaseApiService.ts:178` writes `person.id`; `i_created_group` V1/V2
(`20260412000002…:23-31`, `20260412000003…:59-67`) vs V3/V4 (`…04:20-39`, `…05:38-57`).
**What is wrong** V1/V2 compare `created_by` directly to the Clerk `sub`. With a person UUID
stored there they are always FALSE, locking the creator out of update/delete on their own
group, its members, its transactions and its invites. §8.1.
**Blast radius** Every group, if V1/V2 is what production actually has. Undeterminable from the
repo — apply order is manual and untracked.
**Containment** Run `SELECT prosrc FROM pg_proc WHERE proname='i_created_group'` on production.
**Correct fix** Pick one identity column, add a real FK on `created_by`, delete the other three
function versions.
**Depends on** production DB access (§10).

### [P1-04] D-04 · `HOTFIX_reset_all_policies.sql`'s eight `USING (true)` policies are dropped nowhere
Severity P1 · Confidence CONFIRMED (repo) / UNVERIFIED (production) · Area: authorization
See §8.4. Permissive policies OR together, so a single survivor voids every scoped policy
written since — and the repo's own audit script (`scripts/rls-beta-audit.sql:19-27`) is blind
to them. Compounded by the never-revoked `GRANT SELECT … TO anon, authenticated` in
`QUICK_FIX.md:19-23`.
**Containment** `SELECT tablename, policyname, qual FROM pg_policies WHERE schemaname='public'`.

### [P1-05] D-05 · `group_deletion_requests`: RLS enabled, zero policies, six call sites, JS-only admin check
Severity P1 · Confidence CONFIRMED · Area: authorization / dead feature
See §8.5 and §2.4. Either the whole deletion-request feature is silently dead, or RLS was never
enabled and it is wide open. Both are wrong; which is live is unknown. Independently, the
approval flow's admin check runs in the browser (`supabaseApiService.ts:294`).

### [P1-06] D-06 · Email normalisation asymmetry creates permanently unclaimable duplicate people
Severity P1 · Confidence CONFIRMED · Area: identity
See §8.3. `find_person_by_email` normalises both sides; the two claim functions normalise only
the parameter. Any row with a mixed-case stored email is findable but unclaimable, so signup
creates a duplicate person and the user's history stays on the orphan.
**Correct fix** One functional unique index on `lower(trim(email))`, and normalise on write in
every path.

### [P2-07] D-07 · The canonical docs describe a modal system that has zero importers
Severity P2 · Confidence CONFIRMED · Area: maintainability / doc drift
**Location** `ARCHITECTURE.md:258, 296, 497`; `AGENTS.md:86, 299, 328, 494` vs `App.tsx:110-128`.
**What is wrong** Both "canonical" docs state the `useModals` + `ModalContext` refactor is live
and "Resolved 2026-04-25". `App.tsx` imports none of it. 1,281 LOC (hook + context + 663-line
test suite) are dead, and the test suite passes, which is exactly what makes the claim credible.
`contexts/ModalContext.tsx:15` carries the same false assertion in a code comment.
**Why it exists** `docs/superpowers/plans/2026-04-25-modal-context.md` has 9 tasks; tasks 1-3
landed, tasks 4-8 (the `App.tsx` migration) did not — but task 9, "update ARCHITECTURE.md"
(`:1643-1654`), **was** done. The plan's own verification greps (`:1623-1640`) still fail.
**Blast radius** Any future modal change lands in dead code and ships nothing. Also masks the
real bug in §2.5: `useBackButton` does not handle the three confirm modals, so Android Back
during "Delete group?" navigates Home with the destructive dialog still mounted.
**Containment** 5 min: add a one-line "NOT WIRED UP — see audit/03-deadcode.md §2.5" banner at
the top of `hooks/useModals.ts` and correct the three doc sites.
**Correct fix** Either finish tasks 4-8 or delete all 1,281 lines. Do not leave it ambiguous.

### [P2-08] D-08 · `ARCHITECTURE.md:250` tells the next assistant to delete a live ErrorBoundary
Severity P2 · Confidence CONFIRMED · Area: doc drift
`ARCHITECTURE.md:250` — "`ErrorBoundary.tsx` … is **not** in this stack. Likely dead — verify
before deletion." It is rendered at `index.tsx:17, 81, 91` and wraps the entire application.
Deleting it removes the app's only crash boundary. Same document lists `DebugPanel.tsx`,
`ApiStatusIndicator.tsx`, `SimpleApp.tsx` and `archive/` as existing — none do — and cites
`utils/envValidation.ts` three times (`:428, :435, :492`) for a file that does not exist and
never did; `test-env.mjs:2` imports it and is broken as a result.

### [P2-09] D-09 · Two documents give opposite orders about RLS
Severity P2 · Confidence CONFIRMED · Area: doc drift / security
`GROUP_CREATION_ERROR_FIX.md:98, 171` — "**Required:** Run `DATABASE_FIX_DISABLE_RLS.sql` in
Supabase" (which does `ALTER TABLE people DISABLE ROW LEVEL SECURITY`, `:11`) versus
`docs/security-phase-a.md:68` — "**do not run** root files like `DATABASE_FIX_DISABLE_RLS.sql`
on production". Both files ship. Same shape: `AUTH_IMPLEMENTATION_SUMMARY.md:48` orders you to
run `supabase-auth-setup.sql`, which `20260412000005…:5-16` documents as breaking every RLS
policy under Clerk. And `docs/play-store-launch.md:27,31` prescribes the exact Android Google
sign-in path that `docs/superpowers/specs/2026-09-06-native-android-google-auth.md:70,82`
forbids — the spec matches the code.

### [P2-10] D-10 · `MULTI_USER_EXPERIENCE.md` states the app has no data privacy between users
Severity P2 · Confidence CONFIRMED · Area: doc drift
`MULTI_USER_EXPERIENCE.md:37-40` — "No User Authentication / No data privacy between users."
The app has Clerk auth (`index.tsx:82`) and per-user RLS. A shipped document making a false
*privacy* claim about a production app with real users is a liability independent of the code.

### [P2-11] D-11 · `SETTLEMENT_RULES_AND_BALANCES.md` has the settlement direction inverted
Severity P2 · Confidence CONFIRMED · Area: doc drift
`:31` and `:211-212` say the payer's balance **decreases** and the receiver's **increases**.
`utils/calculations.ts:13` credits `paidById` by `+t.amount` and `SettleUpModal.tsx:155` gives
the payer `value: 0`, so the payer's balance **rises**. Line 31 also contradicts lines 29-30 of
the same file, and the whole document contradicts `SETTLEMENT_BALANCE_FIX.md:34-49`, which is
correct. Anyone "fixing" the code to match this doc inverts every settlement.

### [P2-12] D-12 · Five documents instruct putting API secrets in `VITE_*` variables
Severity P2 · Confidence CONFIRMED · Area: doc drift / security
`ENV_SETUP.md:17,23-31`, `MAILERSEND_QUICK_START.md:21-22,86-87`,
`MAILERSEND_SETUP_GUIDE.md:68-69,145-149,196`, `MAILERSEND_IMPLEMENTATION_SUMMARY.md:107-108`,
`MIGRATION_GUIDE.md:96`, `README.md:47`, `DEPLOYMENT_GUIDE.md:41` all tell you to set
`VITE_MAILERSEND_API_KEY` / `VITE_GEMINI_API_KEY`. `vite.config.ts:157` explicitly refuses to
define them and `.env.example:14-20` says they are Edge-only. Any `VITE_`-prefixed value is
inlined into the browser bundle. Seven documents describe the exact mistake the code was
changed to prevent.

### [P2-13] D-13 · The PWA update prompt was never built; users are pinned to a stale build
Severity P2 · Confidence CONFIRMED (missing prompt) / LIKELY (SW registers anyway) · Area: delivery
See §4.2. A new service worker installs and then waits forever, because nothing calls
`updateServiceWorker()` and both `skipWaiting` and `clientsClaim` are false. Plus: an inert
runtime-cache rule, a 0-byte `public/manifest.webmanifest`, two `includeAssets` files that do
not exist, and SVG-only icons that make the app non-installable.

### [P2-14] D-14 · Settings "Import Data" reports success and does nothing
Severity P2 · Confidence CONFIRMED · Area: user-facing correctness
`components/SettingsModal.tsx:156` — `const handleImport = (file: File) => toast.success(...)`.
A real file input (`DataExport.tsx:21-26`) with a green success toast for work never done.
`handleExport` (`:121-155`) omits `people` and `paymentSources`, so its output cannot be
restored even if an importer existed.
**Containment** 2 min: remove the Import button, or make the toast say "not implemented".

### [P2-15] D-15 · `InvitePage`'s entire signed-in half is unreachable
Severity P2 · Confidence CONFIRMED · Area: dead code / duplicate flow
`App.tsx:1029` renders `<InvitePage />` only when `!user && inviteInfo?.token`. The moment
`user` is truthy, `AppWithAuth` returns `<App />`. So `InvitePage.tsx:117-143` (auto-accept,
which requires `user && person`), the "Join Group" button at `:270-293` and the whole
`:259-298` branch **can never render**. The accept that actually runs is `App.tsx:203-242`,
fired off the `localStorage` breadcrumb. Two accept implementations, one unreachable.
`InvitePage.tsx:83-86` also keeps a raw `group_members` table read from the pre-RPC generation,
with an inline comment conceding it "may be empty pre-auth under RLS".

### [P2-16] D-16 · `deleteGroup` vs `approveGroupDeletion`; the approval audit write is a no-op
Severity P2 · Confidence CONFIRMED · Area: duplicate implementation
See §2.4. Two copies of the same 3-step cascade with **different authorisation models** (client
boolean vs server read). `approveGroupDeletion:270-274` updates a row that
`ON DELETE CASCADE` already removed four lines earlier — PostgREST reports success on zero
rows, so approvals leave no audit trail.

### [P2-17] D-17 · Seven `formatCurrency` implementations; the expense list rounds money away
Severity P2 · Confidence CONFIRMED · Area: user-facing correctness
See §2.8. `TransactionItem.tsx:38` uses `maximumFractionDigits: 0`, so ₹1,23,456.78 renders as
**₹1,23,457** in the transaction list and ₹1,23,456.78 the moment you tap it. Three locales
(`en-US`, `en-IN`, none), three digit policies, no shared helper.

### [P2-18] D-18 · Client validation and persistence disagree in `shares` mode
Severity P2 · Confidence CONFIRMED · Area: money/correctness
`TransactionFormModal.tsx:201-203` validates the raw share total; `:312` then coerces every
zero to 1 (`p.value || 1`). Shares `3, 0` validate against a total of 3 and are stored with a
total of 4: a ₹100 expense previews ₹100/₹0 and stores ₹75/₹25. §2.6.

### [P2-19] D-19 · `email_invites UNIQUE(group_id, email)` blocks re-inviting anyone, forever
Severity P2 · Confidence CONFIRMED · Area: schema
See §8.9. The constraint is on the wrong pair; the pair the RPCs key on (`group_invite_id, email`)
is unconstrained. Re-inviting an address after their link expires throws at
`supabaseApiService.ts:1041`.

### [P2-20] D-20 · `group_deletion_requests UNIQUE(group_id)` bricks the feature after one request
Severity P2 · Confidence CONFIRMED · Area: schema
`migrations/20251116…:17-18` is unconditional despite a comment saying "pending".
`requestGroupDeletion` (`supabaseApiService.ts:225-241`) checks only for `status='pending'`,
finds none, inserts, and gets 23505. **One rejected request blocks that group forever**, with a
raw PostgREST error surfaced to the user via `App.tsx:557`.

### [P2-21] D-21 · CI never exports the Clerk key into the Gradle step
Severity P2 · Confidence LIKELY · Area: build/config
`android/app/build.gradle:26-27` reads `System.getenv("VITE_CLERK_PUBLISHABLE_KEY")`;
`.github/workflows/android-ci.yml` sets it only on the `npm run build` step (`:45-48`), not on
`bundleRelease` (`:76-82`). Every CI-built AAB therefore compiles
`clerk_publishable_key = ""` for the **live** native sign-in plugin. Verify against a real
release before acting.

### [P2-22] D-22 · `assetlinks.json` does not exist, so Android App Links cannot verify
Severity P2 · Confidence CONFIRMED · Area: config
`AndroidManifest.xml:49` sets `autoVerify="true"` for `/sso-callback` and `/invite` on
`motamaati.in`. `public/.well-known/` does not exist, and `vercel.json:15-18` rewrites the path
to itself — which falls through to the SPA catch-all and returns HTML. Invite deep links fall
back to the disambiguation dialog.

### [P2-23] D-23 · `numeric(12,2)` silently doubles sub-paisa amounts
Severity P2 · Confidence LIKELY (reasoned from Postgres assignment-cast semantics) · Area: money
See §8.11. `0.005` stores as `0.01`; `0.001` is rejected with a confusing constraint error.
No CHECK ties `split_participants` or `payers` to `amount` (§3.1).

### [P2-24] D-24 · Duplicate Supabase auth-token injection
Severity P2 · Confidence CONFIRMED · Area: duplicate implementation
`lib/supabase.ts:51-54` (`accessToken` hook) and `:55-65` (`global.fetch` override) both call
`getClerkSupabaseToken()` on every request. Two `clerk.session.getToken()` calls per PostgREST
call, and a refresh between them makes the two mechanisms disagree. §2.10.

### [P2-25] D-25 · Playwright can write to production with no guard
Severity P2 · Confidence CONFIRMED · Area: config
`playwright.config.ts:28,96` + `.env.test.example:7` (which literally documents
`PLAYWRIGHT_BASE_URL=https://www.motamaati.in`) + authenticated specs that create expenses and
settlements. §6.10.

### [P2-26] D-26 · No typecheck, no lint, and unit tests never run in CI
Severity P2 · Confidence CONFIRMED · Area: quality gates
§6.5. No `tsc` script anywhere, no ESLint/Prettier config (the two `eslint-disable` comments
are inert), no workflow runs `vitest`, and the coverage gate is 8% lines. This is the direct
cause of D-02 surviving to production.

### [P3-27] D-27 · 2,961 LOC of orphaned code, 1,009 of it tests for dead code
Severity P3 · Confidence CONFIRMED · Area: dead code
§1.1. Includes 561 LOC of source-rewriting codemods with no dry-run and no git-clean check
sitting in a repo AI assistants are invited to run scripts from (§6.9).

### [P3-28] D-28 · 19 dead exports inside live files
Severity P3 · Confidence CONFIRMED · Area: dead code
§1.3. Two of them are features users would notice are missing: `deactivateInvite` (invite links
cannot be revoked) and `unarchiveGroup` (archiving is one-way).

### [P3-29] D-29 · 55 lines of dead email logic cost 3 DB reads on every expense
Severity P3 · Confidence CONFIRMED · Area: dead code / performance
`supabaseApiService.ts:567-621`. §2.7. Gate is always true in production; all sends are
commented out; three queries run so three unused locals can be assigned.

### [P3-30] D-30 · Dead dependencies and misplaced prod deps
Severity P3 · Confidence CONFIRMED · Area: dependencies
§5.1-§5.4. Delete `madge`, `terser`, `supabase` CLI, `@capacitor/keyboard`; drop
`vite-plugin-node-polyfills` after a 3-character edit to `apiService.ts:88-89`; move
`@capacitor/cli`, `dotenv`, `playwright`, `vite-plugin-pwa`, `workbox-window` to devDeps;
pick one of the two icon systems. Note `@capgo/capacitor-social-login` and
`@capacitor/keyboard` are still compiled into every shipped AAB despite being unreachable
from any JS (§2.11).

### [P3-31] D-31 · Dead DB objects and duplicated indexes
Severity P3 · Confidence CONFIRMED · Area: schema
§1.4, §8.10. Plus `debug_auth_check` existing in production with no source in the repo.

### [P3-32] D-32 · 20 of 46 root markdown files actively contradict the code
Severity P3 (cleanliness) but see D-07…D-12 for the P2 subset · Confidence CONFIRMED
4,987 lines of CONTRADICTS-CODE documentation, 3,240 lines HISTORICAL, 1,871 CANONICAL — and
the two files that claim to be canonical (`AGENTS.md`, `ARCHITECTURE.md`) contradict **each
other** in 11 places (§10.3) and `ARCHITECTURE.md` contradicts itself on coverage thresholds
(`:386-388` says 85/70 "verified"; `:396` and `:518` say 8/65/28/8; `vitest.config.ts:46-49`
says 8/65/28/8).

---

## 10. Coverage gaps and unverified suspicions

### 10.1 Could not be verified — needs production access

1. **Which SQL was actually applied, and in what order.** This is the single largest gap. It
   determines whether `i_created_group` is V1 or V4 (D-03), whether
   `HOTFIX_reset_all_policies.sql`'s eight `USING (true)` policies are live (D-04), and whether
   `group_deletion_requests` is deny-all or wide open (D-05). Needed:
   `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public'`;
   `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'`;
   `SELECT proname, prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace`;
   `\d+ transactions` (to see whether `payers` and the `type` CHECK exist, and what shape
   `idx_payment_sources_is_active` has).
2. **`debug_auth_check`** — in the generated types, no source anywhere. Its body is unknown and
   it is callable via RPC.
3. **Build output.** Could not run `vite build`, so: which `manifest.webmanifest` wins (§4.2),
   whether esbuild really tolerates the duplicate `toast` import (D-02), and whether the
   released AAB truly ships an empty Clerk key (D-21).
4. **`npx tsc --noEmit`** — no `node_modules`. The seven `strict` failures in §7.3 are read
   from source, not from a compiler.
5. **Test suite** — never run. The claim that `hooks/useModals.test.ts`'s 40 tests pass is
   taken from the docs, not observed.

### 10.2 Suspicions I could not close

- **`GroupBalancesModal:42` can produce `NaN`.** `balances` is seeded only from the `people`
  prop (`:25`); a share belonging to someone not in that array yields `undefined - share`.
  Reachable if a member is removed from a group while their transactions remain. I could not
  construct the exact UI sequence — flagged SUSPECTED.
- **`App.tsx:138` `allSettled` defaults to `true`** when no group is selected
  (`Object.values({}).every(...)`), and is then passed as an authorisation argument into
  `deleteGroup`/`archiveGroup`. In today's flows `editingGroup` implies `selectedGroupId`, so
  it appears unreachable — but the coupling is one refactor away from letting an unsettled
  group be deleted. SUSPECTED.
- **`AndroidManifest.xml:29-34` registers `scheme="kharchbaant"` with no host**, so any
  installed app can push an arbitrary URI into `MainActivity` (`launchMode="singleTask"`) and
  it reaches `utils/nativeDeepLinks.ts`. Reported here as structural surface; the exploitability
  analysis belongs to the auth/security pass.
- **`_broadcastTxChange` creates a second channel on the same topic** (`supabaseApiService.ts:483`)
  as the subscriber (`:410`). supabase-js's `channel()` dedupe semantics for a shared topic
  used as both publisher and subscriber are vendor behaviour I could not verify offline.
- Whether `injectRegister: 'auto'` in this plugin version registers the SW at all (D-13).

### 10.3 Not covered by this pass

- Runtime/perf profiling, bundle size measurement, accessibility, visual regression.
- The security consequences of the findings above — `get_invite_preview` leaking the invitee
  email list to `anon` (§8.12), the four live `send-email` handlers with no client caller
  (§2.7), the never-revoked `GRANT SELECT … TO anon` (§8.4), Sentry `sendDefaultPii: true`
  with 100%-on-error replay (§6.3), and the missing CSP (§6.6) are all recorded as structural
  facts here and handed to the security pass.
- Whether the 20 CONTRADICTS-CODE markdown files should be deleted or corrected is a judgement
  call for the owner; this pass only establishes that they contradict the code.

