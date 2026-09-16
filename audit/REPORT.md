# Kharch Baant — Pre-Rebuild Forensic Audit: Report

Audit date: 2026-09-07. Repo: `Kharch-Baant-main` (no `.git`, no `node_modules`). Read-only; nothing outside `audit/` was modified, nothing was installed, nothing was executed against a database or a live service. Two arithmetic proofs (`audit/poc/zero-sum.mts`, `audit/poc/money-rounding.mts`) were run offline against the app's own `utils/calculations.ts`.

Source passes: `audit/00-map.md` (orientation), `01-auth.md` (30 findings A-xx), `02-sync.md` (22 findings S-xx), `03-deadcode.md` (32 findings D-xx), `04-money.md` (23 findings M-xx), `05-sweep.md` (findings P0/P1/P2/P3-xx). Every finding below cites its source id; the pass files hold the long-form evidence.

**Confidence tags are mine, not the agents'.** CONFIRMED = I read the full code path in this repo (for SQL, the file in `supabase/migrations/` is treated as the intended live state; whether it was actually applied is Coverage Gap 1 and is not re-flagged on every entry). LIKELY = strong evidence with one named gap. SUSPECTED = pattern-matched, unverified; those live in §10 unless they have a code citation. Where I disagreed with an agent's severity or confidence I say so in the entry.

Severity: **P0** exploitable now with real consequence (auth bypass, cross-tenant read/write, money corruption or loss, data destruction, secret exposure). **P1** will bite under normal use. **P2** real debt with a cost. **P3** hygiene.

---

## 1. Verdict

This app is in production, with real users and real balances, and it has no server: the browser holds the public anon key and a Clerk JWT and talks to Postgres directly. Row-level security is therefore the entire security model, and that model has holes that are exploitable today. Any member can erase a group's whole ledger with one HTTP request. Any new account can claim any unclaimed person's identity, group memberships and debts by naming their email. Any user can pull any other user's full profile by email. The realtime stream pushes every deleted row from every group to every signed-in client. There is no audit trail and no backup procedure, so none of this is recoverable or even detectable after the fact.

Money is in worse shape than auth. Balances are floating-point numbers recomputed on each device from whatever that device happens to have cached. No invariant is enforced anywhere, and the ordinary expense form writes rows that create or destroy money. The reported sync bug is real and structural: the one fallback was never wired in, nothing reconciles after a device sleeps, and the "Live" badge cannot tell the difference.

Worth keeping: the domain types, the invite-accept RPC, the modal shell, the tested split helpers. Not worth keeping: the service layer, the balance surfaces, the migration history, most of the documentation.

---

## 2. Stop-the-bleeding list

Ordered. Each is minutes, needs no rebuild, and is reversible. **Server-side (SQL) changes take effect for every client immediately. Client-side changes do not:** the service worker never updates (R-34) and the Android bundle is baked into the AAB, so a web fix reaches only fresh browser loads until a new release ships. Do the SQL items first.

| # | Action | Where | Minutes | Closes |
|---|---|---|---|---|
| 0 | **Run the four verification queries** in the Supabase SQL editor (read-only): `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,3,2;` · `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';` · `SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';` and `SELECT relname, relreplident FROM pg_class WHERE relname IN ('groups','transactions','people','group_members','payment_sources');` · `SELECT proname, prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace;` | dashboard | 5 | Decides items 1 and 7; closes CG-1, CG-2, CG-3 |
| 1 | If any policy named `*_all` exists: `DROP POLICY IF EXISTS <name> ON <table>;` for all eight (`groups_select_all`, `groups_insert_all`, `groups_update_all`, `groups_delete_all`, `group_members_select_all`, `group_members_insert_all`, `group_members_update_all`, `group_members_delete_all`). Zero functional impact if they were never applied. | SQL | 3 | R-07 |
| 2 | Narrow transaction deletion. Either revert `supabase/migrations/20260412000008` (`DROP POLICY "Users can delete group transactions"; CREATE POLICY ... FOR DELETE USING (i_created_group(group_id));`) — this reintroduces the "non-creator delete reappears" UI bug that migration was papering over — or leave the policy and remove the two bulk deletes at `services/supabaseApiService.ts:12,14` and `:264-265` and rely on `ON DELETE CASCADE`. The SQL option protects against curl; the client option does not. Founder's call; the SQL option is the one that stops the bleeding. | SQL | 5 | R-01 |
| 3 | `find_person_by_email`: redefine with `RETURNS TABLE(id uuid, name text, is_claimed boolean)` and a matching `SELECT id, name, is_claimed ...`. The UI only renders a name and a badge (`components/MemberInviteModal.tsx:139`). | SQL | 10 | R-08 |
| 4 | `REVOKE EXECUTE ON FUNCTION claim_person_by_email(text,text,text) FROM authenticated;` (the app only reaches it on a fallback path, `supabaseApiService.ts:870-882`). Then redefine `ensure_my_person` with the "claim unclaimed placeholder" branch (`20260813020000:35-49`) removed until the Clerk JWT carries a verified `email` claim that the function can compare against. | SQL | 15 | R-02 |
| 5 | `i_can_see_person`: redefine without the fourth disjunct (`20260728000000:66-71`, the "active invite inviter" clause). `get_invite_preview` already serves the pre-auth landing page without it. | SQL | 5 | R-19 |
| 6 | `ALTER TABLE transactions REPLICA IDENTITY DEFAULT;` same for `people`, `groups`, `payment_sources`. Leave `group_members` FULL (its old row is only ids, and the client handler needs `old.person_id`). The four handlers for those tables read only `old.id` (`services/queries.ts:77,103,135,162`). Immediate, no client deploy. | SQL | 3 | R-05 |
| 7 | `DROP POLICY "cache_read" ON ai_item_cache;` Cost: every uncached classification pays a Gemini call (`services/tagClassifier.ts` swallows the read error). Follow up with a `lookup_item_category(key)` RPC when there is time. | SQL | 2 | R-09 |
| 8 | `send-email`: delete the `welcome`, `member_added`, `settle_up`, `new_expense` cases (`supabase/functions/send-email/index.ts:84-97,122-140,142-195,197-226`; nothing calls them) and reject any `inviteUrl` not starting with `https://www.motamaati.in/` or `https://motamaati.in/`. Redeploy the function. | Edge fn | 15 | R-13 |
| 9 | Enable point-in-time recovery if the plan allows; otherwise schedule a nightly `pg_dump` to independent storage and test one restore. | dashboard/CI | 30 | R-33 |
| 10 | `components/TransactionFormModal.tsx`: add `!isPayerValid` to the guard at `:286` and the `disabled` at `:687`; add a `submitting` flag around `onSave`; add `min="0"` to the inputs at `:482` and `:565`. | client | 10 | R-03, R-12, R-31 |
| 11 | `App.tsx`: keep `isLoading` from `useTransactionsQuery` at `:53` and add it to the gate at `:578`; make `allSettled` at `:138` require at least one balance entry. | client | 10 | R-06 |
| 12 | `App.tsx`: add a `visibilitychange`/`online` listener that calls `qc.invalidateQueries()`; six lines (S-06 containment). | client | 10 | R-11 |
| 13 | `index.tsx:19-30`: `sendDefaultPii: false`; `replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true })`; drop `email`/`username` from `Sentry.setUser` at `App.tsx:60`. | client | 5 | R-39 |
| 14 | `components/SettingsModal.tsx:160-181`: call `clerkUser.delete()` first, abort on failure, stop swallowing the error; correct the dialog text at `:321`. Remove the "Reset All App Data" and "Import Data" buttons (`:305-308`, `:156`). | client | 15 | R-29, P2-36 |
| 15 | `package.json`: add `"typecheck": "tsc --noEmit"`; `.github/workflows/android-ci.yml`: run `npm run test:run` and `npm run typecheck` before `bundleRelease`. Expect the typecheck to fail on first run (R-11 proves at least one TS2554; D-02 is a TS2300). | CI | 10 | R-32 |

---

## 3. Top 10 findings by risk

| Rank | Id | Finding | Sev | Conf |
|---|---|---|---|---|
| 1 | R-01 | Any group member can hard-delete a group's entire ledger with one request; no audit, no soft delete, no backup | P0 | CONFIRMED |
| 2 | R-02 | Identity-claim RPCs trust a client-supplied email: any new account claims any unclaimed person, inheriting their groups and debts | P0 | CONFIRMED |
| 3 | R-07 | Eight `USING (true)` hotfix policies on `groups`/`group_members` are dropped by nothing; if live, the boundary does not exist | P0 if live | LIKELY |
| 4 | R-03 + R-04 | The expense form writes multi-payer rows whose payers do not sum to the amount; nothing server-side enforces any money invariant | P0 | CONFIRMED |
| 5 | R-06 | "All settled" is vacuously true on an empty cache and is passed as an argument into the function that deletes the group | P0 | CONFIRMED (code) / LIKELY (reach) |
| 6 | R-05 | Realtime DELETE events bypass RLS and carry the full deleted row of every tenant to every signed-in client | P0 | LIKELY |
| 7 | R-08 | `find_person_by_email` returns the full `people` row (email, photo, Clerk id, claim flag) for any address to any user | P0 | CONFIRMED |
| 8 | R-11 + R-12 | Sync is single-path with the fallback disconnected and no resume reconciliation; the expense form has no in-flight guard and swallows failures — the founder's symptom plus duplicate expenses | P1 | CONFIRMED |
| 9 | R-13 | `send-email` is an authenticated open relay from the app's verified domain with attacker-chosen recipients, names and link targets | P1 | CONFIRMED |
| 10 | R-14 + R-15 | Membership model: every group save deletes and re-inserts all members (ejects concurrent joiners, can orphan the group); anyone can be added without consent, auto-joins from any link, and can never leave | P1 | CONFIRMED |

R-09 (`ai_item_cache` cross-tenant descriptions, P0 LIKELY) is eleventh: real, cheap to close, lower blast radius than the ten above.

---

## 4. Findings by severity

Full entries for every P0 and P1. P2 and P3 are listed compactly with a pointer to the full entry in the pass file (all pass-file entries use the same twelve-field format).

### P0

#### R-01 Any group member can permanently destroy a group's entire ledger
Severity: P0
Confidence: CONFIRMED
Area: Authorization / atomicity / data destruction
Location: policy `supabase/migrations/20260412000008_allow_members_to_delete_transactions.sql:12-13` (`FOR DELETE USING (i_created_group(group_id) OR i_am_member_of(group_id))`); `services/supabaseApiService.ts:8-19` (`deleteGroup`, results of `:12` and `:14` discarded) and `:245-277` (`approveGroupDeletion`, `:264-266`); schema: no `created_by`, no audit table (`00-map.md` §0.4.1). Sources A-13, P0-15, M-12.
What is wrong: The transactions DELETE policy is group-scoped, so `DELETE /rest/v1/transactions?group_id=eq.<uuid>` succeeds for any member. The app already issues exactly that statement inside `deleteGroup`, whose `isOwner`/`allSettled` guards are JavaScript arguments. A non-creator calling the function (or curl) gets: `group_members` delete → 0 rows, silent; `transactions` delete → every row gone; `groups` delete → 0 rows, `error` null; return `{success:true}`. No `created_by`, no `updated_by`, no history table, no soft delete. The migration widened the policy to fix a UI refresh bug ("non-creator members see an apparent delete … reappears on next refresh").
How to reproduce: As any non-creator member, in devtools: `await import('./services/supabaseApiService').then(m => m.deleteGroup('<groupId>', myPersonId, true, true))`, or `curl -X DELETE "$SB/rest/v1/transactions?group_id=eq.<uuid>" -H "apikey: $ANON" -H "Authorization: Bearer $JWT"`. Every expense and settlement is gone; the group survives, empty.
Blast radius: Total, irreversible loss of one group's financial history for every member. No trace of who did it. Other clients learn of it only via the unfiltered realtime DELETE stream (R-05) or on next refetch.
Why it exists: The role model has one role (`groups.created_by`); the transaction table has no authorship column, so "your own row" cannot be expressed; a display bug was fixed by widening authorization; the three-step teardown discards its results.
Containment (minutes): 5. Revert the DELETE policy to `USING (i_created_group(group_id))` (accepting the UI refresh bug it was hiding), and/or remove the bulk deletes at `:12,:14,:264,:265` and rely on cascade. Enable PITR (R-33).
Correct fix: `created_by` on `transactions` set by a `BEFORE INSERT` trigger from `requesting_user_id()`; UPDATE/DELETE policies `USING (created_by = my_person_id() OR i_created_group(group_id))`; an append-only `transactions_audit` table written by trigger; group deletion behind a `SECURITY DEFINER delete_group(uuid)` RPC that recomputes settlement server-side and soft-deletes. Design decision: whether members may edit each other's expenses at all; if yes, an activity feed is the mitigation and must ship with the permission.
Proof of fix: A non-creator's group-scoped DELETE returns 0 rows; a member's DELETE of another member's row returns 0 rows; every accepted change appends an audit row naming the actor.
Depends on: R-06 (same gate), R-33 (recovery), R-36 (audit).

#### R-02 Identity-claim RPCs trust a client-supplied email
Severity: P0
Confidence: CONFIRMED
Area: RPC / identity / cross-tenant
Location: `supabase/migrations/20260813020000_ensure_my_person.sql:35-49` (claim branch: `UPDATE people SET clerk_user_id = v_clerk ... WHERE email = v_email AND is_claimed = false`), `supabase/migrations/20260812000000_phase_b_claim_invites_security.sql:12-53` (`claim_person_by_email`: clerk id checked against JWT at `:29-34`, `p_email` never checked), `supabase/migrations/20260813000000_anonymize_my_account.sql:28-39` (nulls `clerk_user_id`, freeing the UNIQUE at `migrations/20250101_add_clerk_user_id_to_people.sql:7`); callers `services/supabaseApiService.ts:848` (every login) and `:872` (fallback). Sources A-01, P0-01.
What is wrong: Both functions are `SECURITY DEFINER` and take the identity-defining email as a plain argument. `requesting_user_id()` reads only `sub`; no email claim is consulted. A brand-new Clerk account whose first request is `ensure_my_person('x', 'victim@example.com')` takes over the victim's unclaimed placeholder row — its `group_members` rows, its position in every ledger, its name and photo. An existing account can do the same after `anonymize_my_account()` frees its `clerk_user_id`. `DUPLICATE_USER_FIX_SUMMARY.md` shows the `clerk_user_id` uniqueness has not always held in production, in which case the anonymize step is unnecessary.
How to reproduce: (1) `POST /rest/v1/rpc/find_person_by_email {"p_email":"victim@example.com"}` → note `is_claimed:false` (R-08). (2) With a fresh account's JWT, before the app calls it: `POST /rest/v1/rpc/ensure_my_person {"p_name":"x","p_email":"victim@example.com"}`. (3) Reload: the attacker is inside every group the placeholder belonged to.
Blast radius: Every unclaimed `people` row — the majority of rows in a placeholder-first product. Cross-tenant read and write of financial data. Silent: the real user signs up later, gets a fresh row, never learns.
Why it exists: Phase B hardened the Clerk-id half of the argument list and missed that the email is the actual identity assertion.
Containment (minutes): 15. Revoke `claim_person_by_email` from `authenticated`; remove the claim branch from `ensure_my_person` until a verified email claim is available.
Correct fix: Configure Clerk to put a verified `email` claim in the Supabase session token; match on `current_setting('request.jwt.claims',true)::jsonb->>'email'`, ignore `p_email`, reject on mismatch. Design decision: claiming a placeholder is account-linking and needs proof of email control (verified claim or emailed confirmation).
Proof of fix: With a JWT whose email is `attacker@x.com`, `ensure_my_person('x','victim@example.com')` leaves the victim row's `clerk_user_id` NULL and raises `42501`.
Depends on: R-08 (discovery), R-21 (seeding), R-15 (placement).

#### R-03 Multi-payer expenses save with payers not summing to the amount
Severity: P0
Confidence: CONFIRMED
Area: Money / domain
Location: `components/TransactionFormModal.tsx:208-220` (`isPayerValid` computed), `:286` (submit guard omits it), `:687` (Save `disabled` omits it), `:470-471` (rendered as a red label only), `:481-490` (payer input, no `min`), `:325` (`val && val > 0` silently drops negatives); `utils/calculations.ts:8-19` (credits `payers[].amount`, debits shares from `amount`). Sources M-02; PoC `audit/poc/zero-sum.out.txt` Z1/Z1b/Z1c. Re-read by me at `:286` and `:687`.
What is wrong: The form computes whether the payers total matches the amount and uses the result only to colour text. Both guards omit it. Because `calculateGroupBalances` credits the payer array but debits shares derived from `amount`, any gap becomes money created or destroyed one-for-one. The most natural path is editing: open a correct multi-payer expense, change only the amount, save — the payers are stale and the group's balances no longer sum to zero.
How to reproduce: Add Expense → Amount 1000 → Multiple Payers → A 400, B 100 → Save (label shows "Total: ₹500.00 / ₹1000.00" in red; row is written). PoC: Σ balances = −500. Edit path: amount 1000 payers 600/400 → change amount to 2000 → Save → Σ = −1000. Negative path: A 1500, B −500 → label green, B dropped, Σ = +500.
Blast radius: Every member's balance in the group is wrong by a user-chosen amount, on every device, permanently; `payers` has no constraint so the row is never rejected.
Why it exists: `isPayerValid` was written for the label; the credit/debit asymmetry turns a UI oversight into ledger corruption.
Containment (minutes): 5. Add `!isPayerValid` to both guards; `min="0"` on the inputs.
Correct fix: Server-enforced `Σ payers = amount` (trigger, since it is JSONB), and ultimately a relational `transaction_payers` table in integer minor units (R-04).
Proof of fix: A DB insert with mismatched payers is rejected; a component test asserts Save is disabled while `payersTotal !== amount`; a property test asserts Σ balances = 0 over generated transaction sets.
Depends on: R-04.

#### R-04 No server-side validation of any money invariant
Severity: P0
Confidence: CONFIRMED
Area: Money / domain
Location: `supabase-schema.sql:52-66` and `migrations/COMPLETE_DATABASE_MIGRATION.sql:73-88` (the only CHECKs: `amount > 0`, tag, split_mode, type); `split_participants JSONB NOT NULL` unconstrained; `payers` appears in **no** `.sql` file in the repo (only `lib/database.types.ts:392`); policies `20260412000005:146-150` reference only `group_id`; `utils/calculations.ts:30-71` (float division, no rounding). Sources M-03, D-18, A-16; PoC Z4.
What is wrong: Nothing anywhere — client, CHECK, trigger, RPC, test — asserts that a group's balances sum to zero, that split values sum to the amount or to 100, that values are non-negative, or that participants and payers are group members. Balances are derived per device from a possibly incomplete cache. `validateSplit`/`materializeSplit`/`distributeRounding` (`calculations.ts:77-155`) are correct and called only by tests.
How to reproduce: One `POST /rest/v1/transactions` as any member with `split_participants` summing to 99 on amount 100 (Σ = +1), percentages summing to 110 (Σ = −10), an empty participants array (payer credited, nobody debited, Σ = +100), or a participant UUID who is not a member (invisible debtor).
Blast radius: Every invariant this domain has. Any member, or anyone with the anon key and a session token, can make a group's balances sum to any number.
Why it exists: There is no application server, so validation would have to be SQL, and none was written; the client re-implemented the rule differently from the tested helper and called neither.
Containment (minutes): 30 of SQL. A `BEFORE INSERT OR UPDATE` trigger on `transactions` checking array shape, non-negative values, per-mode sums, payer sum, and membership of every `personId` and `paid_by_id` in `group_members` for `NEW.group_id` (also closes A-16 and the group-move case in `01-auth.md` §3.1).
Correct fix: Design decision the app has been avoiding: a stored ledger in integer minor units (`transaction_entries(transaction_id, person_id, delta_minor)`) with a deferred `SUM = 0` constraint, written by `SECURITY DEFINER` RPCs that do the split arithmetic in SQL with largest-remainder allocation. Balances become one server query every device agrees on.
Proof of fix: Every row in PoC Z4 rejected at the DB; a property test that per-group `SUM(delta_minor) = 0` after a random sequence of writes.
Depends on: —

#### R-05 Realtime DELETE events bypass RLS and carry the full deleted row to every client
Severity: P0
Confidence: LIKELY (mechanism vendor-confirmed and subscriptions confirmed; the gap is whether `migrations/enable_realtime.sql` was applied — `ENABLE_REALTIME.md` instructs it as required setup)
Area: Realtime / cross-tenant read
Location: `services/supabaseApiService.ts:391,411,436,453,470` (five `postgres_changes` subscriptions, `event:'*'`, no filter); `migrations/enable_realtime.sql:5-9` (`REPLICA IDENTITY FULL` on all five tables); handlers `services/queries.ts:77,103,135,162,194-205`. Sources S-02, A-22.
What is wrong: Supabase's docs: "RLS policies are not applied to `DELETE` statements, because there is no way for Postgres to verify that a user has access to a deleted record." The WALRUS engine README: "When a delete occurs, the contents of `old_record` will be broadcast to all subscribers to that table so ensure that each table's replica identity only contains information that is safe to expose publicly." With replica identity FULL, `old_record` is the whole row. So every deletion of a transaction (amount, description, payer, split), a person (name, email, `clerk_user_id`, base64 photo), a group or a membership, anywhere in the database, is pushed to every signed-in client. `deleteGroup` deletes all of a group's transactions first, so one group deletion emits that group's entire history. The app also makes a control-flow decision on this unauthenticated stream (`queries.ts:194-205` purges a group from cache when `old.person_id` matches).
How to reproduce: Two unrelated accounts, no shared group. On B, DevTools → Network → WS frames. On A, delete an expense. B's frame list shows a `DELETE` with `old_record` containing A's description and amount.
Blast radius: Continuous cross-tenant disclosure of financial data and PII to every connected client; invisible in the UI, so never noticed in normal use.
Why it exists: `REPLICA IDENTITY FULL` was set so DELETE handlers could read `old.id`/`old.person_id`; the vendor caveat is one line on a long page.
Containment (minutes): 3, server-side: `REPLICA IDENTITY DEFAULT` on `transactions`, `people`, `groups`, `payment_sources` (handlers use only `old.id`); keep `group_members` FULL (ids only). Client-side later: subscribe to INSERT/UPDATE only.
Correct fix: Private per-group Broadcast channels (`group:<uuid>`) with a `realtime.messages` policy of `i_am_member_of`, fed by a database trigger; stop using unfiltered `postgres_changes` for cross-user fan-out. Same fix as R-24.
Proof of fix: An unrelated account's socket receives no DELETE frame when A deletes; deletions still disappear from co-members' UIs.
Depends on: R-24 (same fix), R-11 (deletions must then propagate via reconcile).

#### R-06 "All settled" is vacuously true on an empty cache and is a client-supplied argument to the destructive functions
Severity: P0
Confidence: CONFIRMED (arithmetic and code path) / LIKELY (a real user hitting the first-paint window)
Area: Money / authorization
Location: `App.tsx:138` (`Object.values(groupBalances ?? {}).every(...)` — `[].every` is `true`); `App.tsx:53` (`useTransactionsQuery`'s `isLoading` discarded); `App.tsx:578` (loading gate is `isLoading || groupsLoading` only); `App.tsx:546,567` (booleans passed as arguments); `services/supabaseApiService.ts:8-10,22-25` (the "checks" are `throw`s on those arguments); `:506-516` (`getTransactions` returns `[]` on a swallowed error); `components/AdminDeletionRequestsPanel.tsx:63` (passes literal `true`). Sources M-01, S-21, A-12, M-21. Re-read by me at `App.tsx:53,131-139,578`.
What is wrong: "No transactions loaded" and "fully settled" are the same value. The transactions query is not part of the loading gate, so the group screen, settings modal and Delete button render before it resolves; a swallowed fetch error, an RLS denial, or the membership gap during `updateGroup` (R-14) also yield `[]`. The database enforces only creator-ness; settlement is not a concept it has. A modified client passes `true` regardless.
How to reproduce: Cold load with the network throttled; open a group you created while the transactions request is in flight; Settings → Delete Group is enabled; confirm. Three DELETEs run. Or, from devtools, call `deleteGroup(id, me, true, true)` on an unsettled group.
Blast radius: Irreversible deletion of a group with live debts. Combined with R-01 the same path is open to non-creators for the transactions half.
Why it exists: The invariant was expressed as a predicate over a client array; the TanStack migration moved transactions out of the loading flag and nobody re-checked consumers for empty-vs-loading.
Containment (minutes): 10. Include the transactions `isLoading` in the gate; make `allSettled` require at least one entry; refetch before the destructive call.
Correct fix: Server-side `delete_group` RPC that recomputes balances in SQL and refuses when any `|balance| >= 0.01`; remove the boolean parameters from `deleteGroup`, `archiveGroup`, `approveGroupDeletion`.
Proof of fix: `computeAllSettled([])` is false; a render test with the query pending shows Delete disabled; the RPC raises on an unsettled group.
Depends on: R-04 (a server-side balance must exist).

#### R-07 `HOTFIX_reset_all_policies.sql` creates eight `USING (true)` policies that nothing drops
Severity: P0 if live (total loss of the `groups`/`group_members` boundary); unknown otherwise
Confidence: LIKELY (file present, named "NUCLEAR OPTION", never reverted; whether it was applied is CG-1)
Area: RLS / operations
Location: `migrations/HOTFIX_reset_all_policies.sql:21-62` (policies), `:65-69` (`GRANT ALL ... TO authenticated`); non-removal: Phase A drops only `"Allow all operations"` (`20260728000000:23-27`); the blanket drop loop at `20260412000003:23-35` predates it in filename order; the repo's own check `scripts/rls-beta-audit.sql:19-27` greps `%allow all%` and would report PASS. Sources A-02, D-04.
What is wrong: Permissive policies are OR'ed. If these exist, any authenticated user reads every group and membership, adds themselves to any group (then reads its transactions), renames/deletes any group, and `updateGroup`'s delete-all-then-reinsert (R-14) becomes "any user rewrites any group's membership".
How to reproduce: `SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' AND policyname LIKE '%\_all';` Any row is the finding. Behavioural: `GET /rest/v1/groups?select=id` with a zero-group account's JWT returns a non-empty array.
Blast radius: Total, silent.
Why it exists: A production outage was fixed by disabling authorization and the follow-up hardening targeted different policy names; there is no applied-state tracking for SQL.
Containment (minutes): 3. Eight `DROP POLICY IF EXISTS`.
Correct fix: Adopt migration tooling with applied-state tracking; make the audit script assert the exact expected policy set per table and fail on any `qual = 'true'`.
Proof of fix: `pg_policies` for `groups` and `group_members` contains exactly the expected Clerk policies.
Depends on: CG-1; R-14, R-15 change severity depending on the answer.

#### R-08 `find_person_by_email` returns the full `people` row for any email to any user
Severity: P0
Confidence: CONFIRMED
Area: RPC / cross-tenant PII
Location: `supabase/migrations/20260728000000_phase_a_rls_people_visibility.sql:103-117` (`RETURNS SETOF people`, `SECURITY DEFINER`, `SELECT *`, granted to `authenticated`); client `services/supabaseApiService.ts:833-843`; UI `components/MemberInviteModal.tsx:39-49`; no rate limit anywhere (A-17). Sources A-03, P1-06. Re-read by me.
What is wrong: Any signed-in user, for any address they can guess, gets `id`, `name`, `avatar_url` (the real photo as base64), `email`, `clerk_user_id` (the RLS subject), `user_id`, `is_claimed` (the targeting flag for R-02), `source`, timestamps. Bypasses `i_can_see_person`. It is also a sequential scan (functional predicate, plain index).
How to reproduce: `for e in $(cat emails.txt); do curl -s "$SB/rest/v1/rpc/find_person_by_email" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "{\"p_email\":\"$e\"}"; done`
Blast radius: Every user, for one attacker with one account and an email list. Feeds R-02 and R-13.
Why it exists: Introduced as the fix for an open `people` SELECT; replaced a broad leak with a targeted one.
Containment (minutes): 10. `RETURNS TABLE(id, name, is_claimed)`; better `(found, id, name)`.
Correct fix: The containment plus a per-caller lookup budget inside the function (a small log table and a count), plus a functional index on `lower(trim(email))`.
Proof of fix: The response for a stranger contains no `email`, `clerk_user_id` or `avatar_url`; the 51st lookup in an hour errors.
Depends on: R-02, R-15.

#### R-09 The global AI tag cache stores every user's novel expense descriptions and every user can read them
Severity: P0 (cross-tenant read of free-text financial data)
Confidence: LIKELY (one inferential gap: the policy uses `auth.role() = 'authenticated'`; the `people` policies are `TO authenticated` and the app works in production, so the JWT carries the role claim and `auth.role()` evaluates true — reasoned, not observed)
Area: Privacy / cross-tenant
Location: `supabase-schema.sql:88-99` (`cache_read USING (auth.role() = 'authenticated')`, `cache_insert`, no UPDATE/DELETE); `services/tagClassifier.ts:10` (key = `description.toLowerCase().trim()`), `:17-19` (read), `:32-33` (write); triggered on every save `components/TransactionFormModal.tsx:291-301`; not touched by `anonymize_my_account`; not disclosed in `public/privacy.html`. Sources P1-07, A-21, P2-08. Re-read by me.
What is wrong: Every description that misses the keyword list and the cache goes to Gemini and is then written verbatim as a globally readable primary key. Rows are immortal. The unusual descriptions are exactly the sensitive ones.
How to reproduce: Any signed-in user: `GET /rest/v1/ai_item_cache?select=*&order=created_at.desc`.
Blast radius: Chronological feed of other users' unusual expense text; survives account deletion. Also a permanent poisoning surface (insert `('uber','Health')`).
Why it exists: A shared cache to avoid paying Gemini twice; the raw string as key was never reconsidered.
Containment (minutes): 2. Drop `cache_read`; accept the extra Gemini calls until a lookup RPC exists.
Correct fix: `lookup_item_category(key)` RPC returning only the category; key on a SHA-256 of the normalised text; writes only from the `suggest-tag` Edge Function; retention policy; privacy-policy update.
Proof of fix: `SELECT * FROM ai_item_cache` as a user returns 0 rows; suggestions still work.
Depends on: —

### P1

#### R-10 `send-email` is an authenticated open relay from the app's verified domain
Severity: P1 (abuse and reputation rather than data; treat as tonight's work regardless — it is a 15-minute containment)
Confidence: CONFIRMED
Area: Edge Function / abuse
Location: `supabase/functions/send-email/index.ts:57-65` (only gate: any valid JWT + email format), `:84-97, :99-120, :122-140, :142-195, :197-226` (five handlers; four have no client caller — `services/emailService.ts:115-136`); rate limit `supabase/functions/_shared/auth.ts:44-59` is a per-isolate `Map`. Sources A-08, P0-02, P1-04.
What is wrong: No handler receives a group id, so no authorization is possible as written. Recipient addresses, sender display names and link targets all come from the request body; `new_expense` takes 25 recipients per call, `settle_up` sends two mails.
How to reproduce: `POST /functions/v1/send-email {"type":"group_invite","data":{"inviteeEmail":"target@example.com","inviterName":"Accounts Team","groupName":"Payment Verification Required","inviteUrl":"https://evil.example/","expiresInDays":1}}` with any account's JWT.
Blast radius: DKIM-signed phishing from the product's domain; MailerSend suspension; domain reputation.
Why it exists: Written as a generic mail proxy for a trusted caller; the caller became the browser.
Containment (minutes): 15. Delete the four dead handlers; require `inviteUrl` on the app's origin.
Correct fix: Accept only a `groupInviteId`; look up group, inviter and recipients server-side with the service role; verify the caller is a member; compose the URL from a constant; durable rate limit in Postgres.
Proof of fix: Foreign `inviteUrl` → 400; non-member group → 403; disabled types → 400.
Depends on: A-17 (rate limits), R-20.

#### R-11 Sync is single-path with the fallback disconnected, no resume reconciliation, and a decorative "Live" badge
Severity: P1
Confidence: CONFIRMED (façade bug re-read by me at `services/apiService.ts:15`, `services/queries.ts:3,92-110`, `services/supabaseApiService.ts:404-430`)
Area: Sync / realtime
Location: `services/apiService.ts:15` (two-parameter façade drops the third argument); `services/queries.ts:92-110` (passes three); `services/supabaseApiService.ts:422-426` (broadcast listener registered only `if (onBroadcast)`); `lib/queryClient.ts:8` (`refetchOnWindowFocus: false`); no `visibilitychange`/`pageshow`/resume handler anywhere; `index.tsx:44-46` (Capacitor `appStateChange` handler is a `console.log`); `contexts/SupabaseAuthContext.tsx:67-74` (50 s JWT re-push stops when backgrounded); `components/RealtimeStatus.tsx:11-26` (channel with zero bindings). Sources S-01, S-06, S-09, A-28.
What is wrong: The `tx` broadcast published on every write (`supabaseApiService.ts:565,658,694`) is received and discarded by every client because the listener is never registered — the comment at `:564` describes a safety net that does not exist. That leaves at-most-once `postgres_changes` as the only delivery. Nothing backfills after a dropped socket, a backgrounded tab, or an expired subscription token except TanStack's `refetchOnReconnect`, which fires only on a browser `online` event that a Doze-suspended WebView typically never emits. The badge reports green whenever the socket is up. TypeScript would have flagged the arity mismatch (TS2554); no `tsc` runs anywhere.
How to reproduce: Two devices, same group. On B, DevTools → WS frames; on A add an expense. B receives an `"event":"tx"` frame and issues no refetch; a breakpoint at `queries.ts:108` never hits. Then background B for five minutes while A adds three expenses; foreground B: list unchanged, badge green.
Blast radius: Any single missed event is permanent until a full reload. Because balances are per-device (R-04), a missed event is a wrong money number that looks authoritative. This is the founder's reported symptom.
Why it exists: A hand-maintained pass-through façade; a desktop-shaped `refetchOnWindowFocus:false` applied to a mobile app; no typecheck gate.
Containment (minutes): 10. A `visibilitychange`/`online` listener that invalidates all queries; drop the 50 s interval to 30 s and re-push the token on visibility. Do **not** simply widen the façade signature first — enabling the listener without R-24 and S-12 turns on a global refetch amplifier.
Correct fix: Delete the façade for the subscribe functions; per-group private channels (R-05/R-24); a real liveness probe for the badge; `tsc --noEmit` in CI.
Proof of fix: Foregrounding after five minutes shows the change within a second with a visible `GET /rest/v1/transactions`; `tsc --noEmit` passes.
Depends on: R-24, S-12 (must land together with any broadcast re-enable).

#### R-12 The expense form has no in-flight guard, no idempotency, and swallows failures
Severity: P1
Confidence: CONFIRMED (code; the double-tap window is LIKELY without a browser trace)
Area: Money / sync
Location: `components/TransactionFormModal.tsx:685-691` (Save `disabled` has no submitting term), `:283-364` (`handleSubmit` calls `onSave` without awaiting at `:352`); `App.tsx:347-362` (no cache write on create at `:353-355` — "realtime bridge will update cache"; `catch` at `:359-361` is `console.error` only); `services/supabaseApiService.ts:537-561` (no client-generated id); contrast `components/SettleUpModal.tsx:85` which has the guard. Sources S-04, S-07, S-22, M-09, P0-13.
What is wrong: On a slow connection the modal sits open with a live Save button for the whole request (classification call + insert + three dead extra reads, `supabaseApiService.ts:568-621`). Two taps insert two rows. The writer's own screen shows nothing until realtime delivers, and on failure shows nothing at all — which is precisely what makes people tap again. Settlements, by contrast, are guarded and written to cache immediately (`App.tsx:794-798`).
How to reproduce: Throttle to Slow 3G; add an expense; tap Save twice ~300 ms apart; reload: two identical rows. Or go offline and save: the modal closes, nothing is reported, the expense does not exist.
Blast radius: Duplicate expenses double every participant's debt and are indistinguishable from a legitimate repeat; silent failures present as data loss.
Why it exists: The settle-up modal got the guard and the expense modal did not; a deliberate "single code path" decision that assumed delivery is guaranteed.
Containment (minutes): 10. `submitting` flag around `onSave`; capture the returned row and prepend it to the cache exactly as `App.tsx:794-798` does; `toast.error` + `Sentry.captureException` in the catch; keep the modal open on failure.
Correct fix: Client-generated UUID as the row id (retries collide on the PK); every mutation through `useMutation` with `onMutate`/`onError`/`onSettled` — the QueryClient is already configured for it (`lib/queryClient.ts:11-13`) and nothing uses it.
Proof of fix: Two synchronous clicks produce one insert; with the WebSocket blocked a new expense appears immediately and survives reload; an offline save shows an error and keeps the form.
Depends on: —

#### R-13 `updateGroup` rewrites membership as delete-all-then-reinsert, with no transaction
Severity: P1
Confidence: CONFIRMED
Area: Concurrency / data integrity
Location: `services/supabaseApiService.ts:326-373` (`:337-342` update, `:350-353` delete all members, `:358-369` re-insert; `:358` skips the insert entirely for an empty roster); consumers `services/queries.ts:186-213`, `App.tsx:190-200`; `accept_group_invite` locks only the invite row (`20260812000000:202`). Sources S-03, A-30, P0-14, D-15 (leftover).
What is wrong: Every save of the group form, including a pure rename, deletes and re-creates the whole membership. Three failures: (1) every other member viewing the group is bounced to Home when the DELETE for their row arrives; (2) a member who accepted an invite while the form was open is silently ejected by the re-insert of the stale snapshot, with their invite already consumed; (3) any failure between the two statements leaves the group with zero members — invisible to everyone (the client's `group_members!inner` join hides it even from the creator) while its transactions remain. Also `2N+1` realtime events per save, the DELETEs going to every client (R-05).
How to reproduce: (a) A renames while B views: B is bounced. (b) A opens settings, N accepts an invite on a third device, A saves: N is gone. (c) Go offline right after the DELETE completes: the group is memberless.
Blast radius: Silent membership loss and unrecoverable-by-user orphaning; with R-07 live, any user can do this to any group.
Why it exists: Set replacement is the simplest expression over a table API with no transaction; the codebase already knows how to write a transactional RPC (`accept_group_invite`) and did not here.
Containment (minutes): 15. Diff on the client: `DELETE ... WHERE person_id IN (removed)` + `INSERT (added)`; a rename then emits no membership events.
Correct fix: `SECURITY DEFINER set_group_members(group_id, person_ids[])` in one transaction with `FOR UPDATE` on the group row, refusing an empty roster.
Proof of fix: A rename produces one `groups` UPDATE frame and zero `group_members` frames on another device; scenario (b) leaves N in the group.
Depends on: R-05 (fan-out), R-07.

#### R-14 The membership model: added without consent, auto-joined from any link, and unable to leave
Severity: P1
Confidence: CONFIRMED
Area: Authorization / product
Location: policy `supabase/migrations/20260812000000:334-336` (`group_members` INSERT `WITH CHECK (i_created_group OR i_am_member_of)` — constrains only the caller); `services/apiService.ts:43-73` (`addPersonToGroup` inserts any `person_id` from R-08's result); `App.tsx:256-263` (signed-in user accepts unconditionally from the path or `localStorage['pendingInviteToken']`), `:1029` (`InvitePage` only when `!user`); `utils/nativeDeepLinks.ts:57-61` + `android/app/src/main/AndroidManifest.xml:29-34` (hostless `kharchbaant` scheme, `BROWSABLE`); leaving: `components/GroupFormModal.tsx:115-118,396` (self-removal blocked in UI) and `supabaseApiService.ts:337-347` (a non-creator's `updateGroup` throws at the `groups` UPDATE, policy `20260412000005:110-111`); archive: `supabaseApiService.ts:22-31` throws for owners while RLS permits only owners; `unarchiveGroup` `:2-6` has no gate and no `.single()`. Sources A-07, A-11, A-14, M-19, S-13, P1-03.
What is wrong: Any member can place any real user (found via R-08) in a group the member controls, in two requests; a signed-in user who taps a link — or whose device had a `pendingInviteToken` left by a previous user (A-18) — joins with no confirmation; on Android any installed app can fire `kharchbaant://invite/<token>`. Once in, a non-creator can never leave: the only path routes through `updateGroup`, which the `groups` UPDATE policy rejects, after a modal that promised "You will no longer have access". Archive is dead for everyone (JS rejects owners, RLS rejects non-owners) and reports success anyway.
How to reproduce: `PID=$(... find_person_by_email ...)`; `POST /rest/v1/group_members {"group_id":"<mine>","person_id":"$PID"}`. Victim's group list gains the group; the attacker now passes `i_can_see_person` for them and can attribute expenses to them (A-16). Victim opens settings, removes themselves, saves: "Failed to save group updates."
Blast radius: Every non-creator in every group; forced association with financial visibility both ways; a GDPR/Play-policy problem as well as UX.
Why it exists: Phase B relaxed the INSERT policy on the wrong half of the relationship; the pre-auth invite path was hardened (email match) and the post-auth path was not; "leave" was implemented as "edit the group".
Containment (minutes): 20. `WITH CHECK` on `group_members` INSERT additionally requiring the added person to be unclaimed (claimed users join only via `accept_group_invite`); a self-removal DELETE policy (`USING (EXISTS (SELECT 1 FROM people p WHERE p.id = group_members.person_id AND p.clerk_user_id = requesting_user_id()))`) and a `leaveGroup` call; a confirmation modal at `App.tsx:260-263`; restrict the Android scheme filter to `sso-callback`.
Correct fix: Invitation as a pending state for claimed users; per-user archive (`group_members.archived_at`); one invite-landing component for both auth states; `.select().single()` on every update.
Proof of fix: Inserting a claimed `person_id` returns `42501`; a non-creator's Leave removes their row; `kharchbaant://invite/x` from another app routes nowhere.
Depends on: R-08, R-02, R-13, R-17.

#### R-15 Balance surfaces disagree: two ignore multi-payer, one rounds per transfer, the live split never rounds
Severity: P1
Confidence: CONFIRMED (both inline loops read by me earlier; PoC executed)
Area: Money / display
Location: `components/GroupSummaryCard.tsx:16-29` and `components/GroupBalancesModal.tsx:23-46` (credit `t.amount` to `paidById`, no `payers` branch) vs `utils/calculations.ts:4-23` (credits `payers[]`); `utils/calculations.ts:192` (`simplifyGroupDebts` rounds each transfer independently); `:30-71` (`calculateShares` unrounded) vs `:118-155` (`materializeSplit`, correct, test-only); `components/Dashboard.tsx:17-32` (single-group balances through the simplifier, so "owed" and "owe" can never both be non-zero); nine formatters in three locales (`03-deadcode.md` §2.8). Sources D-01, M-05, M-06, M-07, M-14, M-15; PoC `money-rounding.out.txt` §1, §8, §9, `balance-divergence.mjs`.
What is wrong: ₹100 dinner, A paid 60 and B paid 40, split equally: the group screen says A +10; the Home card and the in-group Balances modal say A +50, on adjacent screens. With a payer who is not a participant the card says A is settled while A is owed ₹100. One creditor of 100 and three debtors of 33.33…: the transfers sum to 99.99, Dashboard shows ₹99.99 and MemberBalances ₹100.00 on the same page, and paying exactly as instructed never settles the group. Every uneven split renders 33.33 + 33.33 against 66.67. The transaction list rounds every amount to whole units (`TransactionItem.tsx:38`).
How to reproduce: `node audit/poc/balance-divergence.mjs`; `node --experimental-strip-types --import ./audit/poc/_register.mjs audit/poc/money-rounding.mts`.
Blast radius: Users cannot trust any single number, worst exactly where the product's differentiator (multi-payer) is used.
Why it exists: Five independent balance implementations written at different times; `payers` added to one; the correct rounding helper written, tested, and never wired.
Containment (minutes): 35. Replace both inline loops with `calculateGroupBalances`; make `calculateShares` delegate to `materializeSplit`; round balances to minor units before the simplifier; one `formatMoney(amount, currency)`; remove `maximumFractionDigits: 0`.
Correct fix: One server-side balance in integer minor units (R-04) and one formatter module; a lint rule banning bare `Intl.NumberFormat` outside it.
Proof of fix: One multi-payer fixture renders identical strings on every surface; Σ transfers into each creditor equals their rounded balance; Σ shares equals the amount exactly.
Depends on: R-04.

#### R-16 Writes that affect zero rows report success, so RLS denials look like they worked
Severity: P1
Confidence: CONFIRMED
Area: Error handling / cache integrity
Location: `services/supabaseApiService.ts:2-6, 7-19, 22-31, 245-277, 317-324, 668-684, 686-696, 736-745, 747-756, 1209-1220, 1232-1243` (thirteen mutation sites with no `.select()` and no count); callers then mutate the cache unconditionally: `App.tsx:337-338, 510-511, 522-525, 546-547, 566-568`, `components/SettingsModal.tsx:86-88`, `components/ArchivedGroupsModal.tsx:51-52`. The repo already documents the class (`20260412000008:4-8`). Sources S-05, A-23, P2-17.
What is wrong: PostgREST returns success with zero rows when RLS filters a row out. Only `.select().single()` turns that into an error. So a phantom delete vanishes locally and returns on reload; archive "works" and never does; avatar upload toasts success for someone else's id. Every RLS bug in the system is invisible during testing for this reason.
How to reproduce: As a non-creator, archive a settled group: it leaves the list; reload: it is back. `updateUserAvatar('<other uuid>', ...)` resolves `{success:true}`.
Blast radius: Cache and database disagree with no error; balances differ per device; users learn not to trust the UI.
Why it exists: `.delete().eq()` reads naturally and the result shape makes zero rows easy to miss.
Containment (minutes): 15. Append `.select('id')` and throw on an empty array at all thirteen sites (three first: `deleteTransaction`, `archiveGroup`, `updateUserAvatar`).
Correct fix: An `assertAffected(result, n)` helper used by every write; `useMutation` `onError` rollback (R-12).
Proof of fix: Every destructive action either succeeds in the database or surfaces an error; no action leaves cache and DB disagreeing.
Depends on: R-14 (archive semantics must also be decided).

#### R-17 Auth and profile-sync failures render as "you have no data"
Severity: P1
Confidence: CONFIRMED
Area: Authentication / failure mode
Location: `lib/supabase.ts:33-43` (returns `''` on no-session and on throw; `:57-63` then omits the `Authorization` header — the request goes out as `anon`); `contexts/SupabaseAuthContext.tsx:75-79` (`setPerson(null)` on any sync error); `services/queries.ts` (all four queries `enabled: !!personId`); consumers `supabaseApiService.ts:154-165, 507-515, 771-779` treat `[]` as "no data". Sources A-19, P1-16.
What is wrong: A transient Clerk token failure, an expired JWT, or a failed `ensure_my_person` produces a fully rendered, completely empty app — no error, no retry, no Sentry event. Indistinguishable from data loss. Likely behind several of the repo's "fix" documents (`USER_ISOLATION_FIXES.md`, `MEMBER_DISPLAY_BUG_FIX.md`).
How to reproduce: In devtools on a signed-in session, `delete window.Clerk.session`, trigger a refetch: the UI empties silently.
Blast radius: Every user, whenever a token fetch transiently fails, in the most alarming way an expense app can fail.
Why it exists: `getClerkSupabaseToken` was written non-throwing so callers would not need error handling.
Containment (minutes): 15. Throw when a session exists but `getToken()` failed; an explicit error state with Retry in `SupabaseAuthContext` instead of `setPerson(null)`; `Sentry.captureException` in both.
Correct fix: Distinguish "signed out" from "auth failed" at the query layer; never resolve a query to `[]` on an auth error.
Proof of fix: With `getToken` stubbed to throw, the app shows an auth-error state; no query resolves to `[]`.
Depends on: R-11 (JWT refresh margin).

#### R-18 Every person with an active invite link is visible, full row, to every authenticated user
Severity: P1
Confidence: CONFIRMED (re-read by me)
Area: RLS / privacy
Location: `supabase/migrations/20260728000000_phase_a_rls_people_visibility.sql:66-71` — the fourth disjunct of `i_can_see_person` is `EXISTS (SELECT 1 FROM group_invites gi WHERE gi.invited_by = p_person_id AND COALESCE(gi.is_active,true) AND gi.expires_at > now())`, with no reference to the caller; `getPeople` uses `select('*')` (`supabaseApiService.ts:803-806`); the UI creates invites with `maxUses: null` and 30-day expiry (`components/GroupFormModal.tsx:166`, `supabaseApiService.ts:974`). Sources P1-05, A-03 (folded), S-U4.
What is wrong: Name, email, photograph and Clerk user id of every user who has shared an invite link, readable by the whole user base for 30 days at a time, through the table and through the realtime `people` stream. `get_invite_preview` already serves the landing page without this clause.
How to reproduce: A creates an invite. Unrelated B: `GET /rest/v1/people?select=*` returns A's row.
Blast radius: PII of the most active users, continuously.
Why it exists: The landing page needed the inviter's name before join; the clause satisfies that read for every reader.
Containment (minutes): 5. Drop the disjunct.
Correct fix: The containment plus `getPeople` selecting only rendered columns so Clerk identifiers never reach a browser.
Proof of fix: B's `GET /people` no longer returns A.
Depends on: —

#### R-19 `get_invite_preview` hands anonymous callers the group profile and every invited email address
Severity: P1
Confidence: CONFIRMED (re-read by me)
Area: RPC / data exposure
Location: `supabase/migrations/20260812000000:120-124` (email aggregation), `:126-157` (return object incl. `trip_start_date`, `trip_end_date`, `created_by`, inviter photo), `:161` (`GRANT ... TO anon`); render `components/invite/InvitePage.tsx:79`. Also declared `STABLE` while performing an UPDATE at `:105`. Sources A-09, D-08.12.
What is wrong: One unauthenticated POST with a token — tokens travel by WhatsApp, SMS and clipboard — returns the invitee list, travel dates, creator id and the inviter's photo. The comment "email intentionally omitted" refers to the inviter, three lines after emitting everyone else's.
How to reproduce: `curl -s "$SB/rest/v1/rpc/get_invite_preview" -H "apikey: $ANON" -d '{"p_token":"<token>"}'` with no `Authorization`.
Blast radius: Per token, one group's social graph, dates and every invitee's email; feeds R-08 and R-02.
Why it exists: The email-match auto-join check was done client-side, which required shipping the list.
Containment (minutes): 15. Drop `email_invites`, the dates and `created_by` from the response; return a server-computed `email_matches_invite` boolean from the caller's JWT.
Correct fix: Reduce the preview to what the page renders.
Proof of fix: An anon response has no `email_invites` key; the targeted auto-join still works.
Depends on: R-08.

#### R-20 `people` INSERT lets any user create unlimited placeholders with attacker-chosen emails
Severity: P1
Confidence: CONFIRMED (policy) / LIKELY (the pre-registration hijack, which needs R-02's claim branch)
Area: RLS / identity seeding
Location: `supabase/migrations/20260728000000:88-92` (`WITH CHECK (clerk_user_id = requesting_user_id() OR (COALESCE(is_claimed,false)=false AND clerk_user_id IS NULL))`); `20260813010000` (`create_unclaimed_person`, unbounded); claim path `20260813020000:35-49`; no rate limit (A-17); `avatar_url` unbounded `TEXT` (P2-09). Sources A-06, A-17.
What is wrong: Unbounded row creation with any name, email or blob; and a placeholder seeded with a future user's email is claimed by them on sign-up, landing them inside the attacker's group with their real identity visible.
How to reproduce: `POST /rest/v1/people` with `Prefer: return=minimal` and `{"name":"x","avatar_url":"","is_claimed":false,"email":"victim@example.com"}` in a loop; then `POST /rest/v1/group_members`.
Blast radius: Every prospective user; storage abuse.
Why it exists: Placeholders are a core feature and the policy permits them with no bound.
Containment (minutes): 10. Revoke direct INSERT on `people` from `authenticated`; force creation through `create_unclaimed_person` as the single chokepoint.
Correct fix: Self-insert-only policy; placeholder creation only when simultaneously adding to a group the caller belongs to; per-caller budget; `CHECK (length(avatar_url) <= 200000)`; and R-02's verified-email claim so seeding is harmless.
Proof of fix: Direct `POST /people` with `is_claimed:false` → `42501`; the 21st placeholder in an hour is rejected.
Depends on: R-02, R-14.

#### R-21 `native-bridge` upgrades any Clerk session JWT into a durable session with no audience check
Severity: P1
Confidence: LIKELY (what `verifyToken` validates without `authorizedParties` lives in `@clerk/backend`, not readable here — CG-10)
Area: Edge Function / authentication
Location: `supabase/functions/native-bridge/index.ts:104-107` (`verifyToken(token, { secretKey, clockSkewInMs })`, no `authorizedParties`), `:60-67` (only `sub` prefix checked), `:115-133` (mints a sign-in ticket), `:126` (rate limit after the expensive verify); `supabase/config.toml` (`verify_jwt = false`). Sources A-10.
What is wrong: Any valid, unexpired session JWT for the instance — the same token sprayed on every PostgREST call and into Sentry replays — converts into a one-time ticket that creates a new full session. Any token leak becomes account takeover that outlives the token.
How to reproduce: Copy the bearer from any Supabase request in devtools; `POST /functions/v1/native-bridge` with it; redeem the ticket via `signIn.create({strategy:'ticket'})`.
Blast radius: Every user, from any token disclosure (proxy log, replay, XSS with no CSP).
Why it exists: The check written was "valid token for this instance", not "the Android app's token".
Containment (minutes): 5. Pass `authorizedParties` with the native client's `azp` (check a real native token first — CG-6); move `rateLimit` above `verifyToken`.
Correct fix: A second factor the web client cannot produce (a compiled-in shared secret header), or complete the session natively and drop the bridge; durable rate limit.
Proof of fix: A web-minted token returns 401; a native token returns a ticket.
Depends on: A-17, R-39, P2-10.

#### R-22 `group_deletion_requests` has RLS enabled and zero policies; the workflow is enforced in JavaScript
Severity: P1
Confidence: CONFIRMED (repo state, re-checked by grep) / LIKELY (which live state)
Area: RLS / dead or open feature
Location: `supabase/migrations/20260728000000:19` (enables RLS); DDL `migrations/20251116_group_admin_and_deletion_requests.sql:8-19`; no `CREATE POLICY` on the table in any of 43 SQL files; client `services/supabaseApiService.ts:220-324` (`requestedBy` client-supplied at `:237`; creator check in JS at `:260`; `rejectGroupDeletion` `:317-324` has no check; `:294` filters in JS after rows crossed the wire; six `(supabase as any)` casts); `UNIQUE(group_id)` is unconditional (`20251116:17-18`) so one rejected request blocks the group forever (S-17, D-20). Sources A-05, D-05, S-16, S-17.
What is wrong: Either every operation is denied and the feature is dead while the button reports success (`App.tsx:553`), or RLS was never enabled and any user reads, forges and rejects requests for any group. Both are wrong.
How to reproduce: `SELECT relrowsecurity FROM pg_class WHERE relname='group_deletion_requests'; SELECT count(*) FROM pg_policies WHERE tablename='group_deletion_requests';`
Blast radius: If open: forged/rejected requests system-wide; if closed: a shipped feature that silently never works.
Why it exists: Added in the unmaintained `migrations/` directory with no policies; Phase A's blanket enable swept it in.
Containment (minutes): 5 to determine the state; then either write three policies or remove the UI.
Correct fix: Policies (SELECT for creator or requester; INSERT with server-derived `requested_by`; UPDATE for creator), delete the JS checks, partial unique index `WHERE status='pending'`, `INSERT ... ON CONFLICT DO NOTHING`.
Proof of fix: A non-creator's PATCH returns 0 rows; the raw and filtered response lengths are equal; a request can be re-filed after rejection.
Depends on: R-07 (same root cause), R-06.

#### R-23 The realtime broadcast topic is public; the write amplifier is dormant only because of R-11
Severity: P1
Confidence: LIKELY (client side confirmed; whether "Allow public access" is on for the project is CG-3)
Area: Realtime
Location: `services/supabaseApiService.ts:479-487` (publisher, `supabase.channel('public:transactions')` with no `config`, module singleton), `:410` (subscriber, same topic), `services/queries.ts:107-109` (intended handler discards `groupId` and invalidates the whole transactions key); `vite.config.ts:145-147` (anon key inlined). Sources A-04, S-11, S-12, S-14.
What is wrong: Anyone with the public anon key and no user JWT can subscribe and receive `{groupId}` for every write system-wide (a live activity feed of group UUIDs and timing), and can send forged `tx` events. Today no client listens (R-11), so the send side is inert. The moment the façade is fixed without making the channel private and scoping the invalidate, one forged packet makes every connected client run an unbounded two-request `getTransactions`.
How to reproduce: `createClient(URL, ANON).channel('public:transactions').on('broadcast',{event:'tx'},console.log).subscribe()` from any machine.
Blast radius: Group-id enumeration now (composes with A-27's membership oracle); a one-packet refetch storm the day R-11 is "fixed".
Why it exists: The broadcast was added to bypass `postgres_changes` RLS filtering; `private: true` and `realtime.messages` policies were never written.
Containment (minutes): 5 (dashboard): disable "Allow public access" in Realtime settings; then `{ config: { private: true } }` only after writing the `realtime.messages` policy.
Correct fix: Per-group private topics; delete `_broadcastTxChange` and the singleton (S-14) — `postgres_changes` already carries the row.
Proof of fix: The anonymous snippet fails to join.
Depends on: Blocks any re-enable of R-11's listener; same architecture as R-05.

#### R-24 Concurrent edits are last-write-wins with whole-object splits, no version, `updated_at` discarded
Severity: P1
Confidence: CONFIRMED
Area: Concurrency / money
Location: `services/supabaseApiService.ts:626-660` (`:635`, `:643-646` whole JSONB objects), `:78-108` (`updated_at` never mapped), `types.ts` (no version field), `services/queries.ts:102` (wholesale replace), `App.tsx:351-352` (post-await write can land after B's newer realtime UPDATE). Sources S-10.
What is wrong: Two members editing the same expense: the second PATCH overwrites the first entirely; the loser's screen silently updates to the other's values; no history, no notification, no `updated_by`. Frequency rises as sync improves.
How to reproduce: A changes amount to 1200 and saves; B (form still holding 1000) changes the split and saves; database holds 1000 with B's split; A's 1200 is gone.
Blast radius: Silent money loss in the most common collaborative action.
Why it exists: REST-over-table PATCH with no concurrency token is the default shape.
Containment (minutes): 15. Carry `updated_at` through the transform and add `.eq('updated_at', draft.updatedAt)` to the PATCH; `.single()` then raises on a lost race; surface as "changed by someone else, reload".
Correct fix: Conflict UX (refetch, diff, show); append-only participant edits.
Proof of fix: The reproduction ends with B seeing a conflict and A's value intact.
Depends on: R-12 (mutation refactor).

#### R-25 Settlements: no cap, no version check, no duplicate detection, no prefill
Severity: P1
Confidence: CONFIRMED
Area: Money
Location: `components/SettleUpModal.tsx:85` (`isValid` never compares to the balance), `:107-128` (preview shows the reverse debt in red while Record stays enabled), `:139-178`; `App.tsx:126-128, 784-786, 804` (`setDefaultSettlePayer`/`Receiver` never called — every settlement starts blank); `MemberBalances.tsx:39-47` (rows have no click handler). Sources M-10, M-18; PoC Z5, Z6, Z7.
What is wrong: B owes A 50, records 500: A now owes B 450 with no warning. Two devices settle the same 50: two rows, B becomes the creditor for money already paid. A stale device settles a number that has since moved. And the user re-types both parties and the amount from memory every time.
How to reproduce: PoC Z5/Z6/Z7; Settle Up → type an amount larger than the shown balance → Record.
Blast radius: Reverse debts from nowhere; real cash loss for whoever pays twice; the primary human-error surface has no guard rails.
Why it exists: A settlement is "just another transaction" and inherited a transaction's absent validation; the prefill was scaffolded and never connected.
Containment (minutes): 30. Block or confirm over-payment against `baseBalances`; make balance rows open the modal with payer, receiver and amount pre-filled.
Correct fix: `settle_up(group, from, to, amount_minor, expected_balance_minor)` RPC with optimistic concurrency and an explicit over-pay flag; client-generated id.
Proof of fix: Over-payment rejected without the flag; a stale expected balance rejected; the same client id twice yields one row.
Depends on: R-04, R-12.

#### R-26 Orphaned money on member removal; breakdown footer does not equal its lines
Severity: P1
Confidence: CONFIRMED
Area: Money / membership
Location: `components/GroupFormModal.tsx:115-118` (no balance check on remove); `services/supabaseApiService.ts:349-369` (membership rewritten, transactions untouched); `App.tsx:131-138` (balances still include the removed id → `allSettled` permanently false); `App.tsx:580` + `components/MemberBalances.tsx:34-35` (`if (!person) return null` — the line is not rendered); `services/supabaseApiService.ts:765-810` (`getPeople` derives from `group_members`, so the person vanishes from every dropdown); `components/BalanceBreakdownModal.tsx:35-51` (lines filtered, total not). Sources M-08, M-15, Z10.
What is wrong: A paid 300 split with B and GONE; the creator removes GONE. Balances now show A +200, B −100 and nothing else; Delete, Archive and Request Delete are disabled forever with "All balances must be settled"; GONE cannot be selected to settle; the Home total exceeds the visible lines by GONE's debt. No way back unless the creator can still see GONE through another group.
How to reproduce: Z10 in `zero-sum.out.txt`.
Blast radius: Visibly inconsistent, permanently unmanageable groups; money that exists in the ledger and nowhere on screen.
Why it exists: Membership and history were treated as the same thing.
Containment (minutes): 15. Refuse removal when `|balance| >= 0.01` (the prop is already passed at `App.tsx:692`); render unknown ids as "Former member"; compute the footer from the rendered lines.
Correct fix: `remove_group_member` RPC refusing on non-zero balance; soft removal (`former_member`) so history stays renderable.
Proof of fix: Removal with a balance is rejected; a transaction referencing a non-member still renders a named row; footer equals Σ rows.
Depends on: R-06, R-13, R-14.

#### R-27 Cross-currency totals, a hardcoded ₹ form, and a currency change that relabels history
Severity: P1
Confidence: CONFIRMED
Area: Money / multi-currency
Location: `utils/calculations.ts:249-284` (`getUserFacingDebts` sums all groups into one scalar at `:276`); `components/HomeScreen.tsx:31-33,72-91` (no currency style, caption "across all currencies"); `components/TransactionFormModal.tsx:391,471,480,678` (hardcoded `₹`; component is not passed `currency`); `components/GroupFormModal.tsx:307-316` + `supabaseApiService.ts:329` (currency change touches no transaction); `groups.currency TEXT` with no CHECK, `transactions` has no currency column; `Intl.NumberFormat` throws on an invalid code. Sources M-11, M-17, M-20.
What is wrong: ₹40,000 owed plus $300 owed renders as `40,300.00`. A USD group's expense form shows ₹ everywhere. Switching a group with ₹80,000 of history to USD reads as $80,000 on every device instantly. A garbage currency string would crash every balance surface in the group.
How to reproduce: Two groups in different currencies; look at the Home total. Create a USD group; add an expense.
Blast radius: The most prominent number in the app is meaningless for any multi-currency user.
Why it exists: Currency modelled per group; the aggregate written as if there were one.
Containment (minutes): 40. Group debt lines by currency and render one row each; pass `currency` to the form; disable the currency picker once transactions exist; try/catch the formatters.
Correct fix: Currency denormalised onto `transactions` at write time; `CHECK (currency ~ '^[A-Z]{3}$')`; per-currency totals or explicit conversion with a stored rate.
Proof of fix: A mixed fixture never produces a single scalar total; the form shows the group's symbol.
Depends on: R-15 (formatter).

#### R-28 "Delete Account" does not do what its dialog says, and a Clerk failure creates a duplicate identity
Severity: P1
Confidence: CONFIRMED (re-read by me at `SettingsModal.tsx:158-182,321`)
Area: Privacy / compliance / atomicity
Location: `components/SettingsModal.tsx:160-181` (anonymize first, `clerkUser.delete()` second inside a swallowed catch, success toast regardless), `:321` ("will permanently delete your profile and remove you from all groups"); `supabase/migrations/20260813000000:28-39` (touches one `people` row only); re-login path `20260813020000:51-70` inserts a fresh row. Sources P1-08, A-01 (step 2), D-..; `docs/play-store-launch.md:11` lists Clerk self-deletion as an unchecked manual prerequisite.
What is wrong: The user stays in every group as "Deleted user"; `payment_sources` (card issuer + last 4, UPI ids), `email_invites`, `group_invites.invited_by` and `ai_item_cache` survive; if Clerk deletion is disabled the user can sign in again and becomes a second person with no history, orphaning the original ledger — the duplicate-identity class already seen in production (`DUPLICATE_USER_FIX_SUMMARY.md`). The anonymized row's `clerk_user_id` is now NULL, which is step one of R-02 for an existing account.
How to reproduce: With Clerk deletion disabled: Settings → Delete Account → sign in again.
Blast radius: Erasure obligations unmet for financial-instrument data while the user is told otherwise; a stranded ledger per occurrence.
Why it exists: The RPC was scoped to "strip identity from the people row"; the surrounding flow was never checked against the dialog.
Containment (minutes): 15. Clerk first, abort on failure, stop swallowing; correct the dialog text.
Correct fix: Extend the RPC to delete payment sources, redact invited emails, and decide explicitly whether the person leaves groups; one server-side operation for both halves; update `privacy.html` and the Play Data Safety answers (P2-12).
Proof of fix: After deletion, `payment_sources` for that person is empty and re-login creates no second row.
Depends on: R-02, P2-12.

#### R-29 The `people` cache is never invalidated on membership change; new members are invisible on other devices
Severity: P1
Confidence: CONFIRMED
Area: Cache / sync
Location: `services/queries.ts:209-213` (someone else's membership change invalidates `groups` only), `:186-191`; `App.tsx:224`, `components/invite/InvitePage.tsx:129,278` (invite accept invalidates `groups` only); `App.tsx:592` (member list = intersection of `groups[].members` and the `people` cache); `services/queries.ts:55-62` + `supabaseApiService.ts:386` (`groups` INSERT bridge inserts a group with `members: []`); the `people` INSERT event is dropped by RLS because the membership row is written after it. Sources S-08, S-19, D-..; same class as `MEMBER_DISPLAY_BUG_FIX.md`.
What is wrong: On every other member's device the new person is a UUID with no `Person`: not in the split list, not selectable as payer, silently excluded from `calculateShares`. Expenses created there exclude them — a wrong balance for everyone.
How to reproduce: A adds C by name; on B open Add Expense: C is absent; reload B: C appears.
Blast radius: Wrong balances originating from a UI that gave no sign anything was missing.
Why it exists: The same-tab `groupMemberAdded` window event patched the adding device only.
Containment (minutes): 5. Invalidate `qk.people(personId)` at `queries.ts:212`, `:189-190`, and after the invite-accept invalidates; in the `groups` INSERT branch invalidate instead of appending a members-less row.
Correct fix: The containment; delete the window-event bus (`GroupFormModal.tsx:461-465`, `App.tsx:281-301`) and `mapDbGroupRowBasic`.
Proof of fix: C appears on B within one round-trip with no reload.
Depends on: —

#### R-30 Negative split values are accepted, crediting a participant on someone else's bill
Severity: P1
Confidence: CONFIRMED
Area: Money
Location: `components/TransactionFormModal.tsx:564-572` (no `min`), `:277-279` (`parseFloat || 0`), `:182-206` (validators check only the sum); `utils/calculations.ts:47-58`. Sources M-04; PoC Z2/Z2b.
What is wrong: Unequal −50/150 on ₹100 passes (`|100 − 100| < 0.01`); A's share is −50 so A is credited 50 on a bill B paid; the header even reads "All allocated". Zero-sum holds, so no automated check would notice.
How to reproduce: Add Expense → Amount 100 → Unequally → A −50, B 150 → Save.
Blast radius: A member grants themselves credit on any expense; the only evidence is a negative number in a JSONB blob no UI renders as unusual.
Why it exists: The validator was written for the honest "doesn't add up" case.
Containment (minutes): 5. `min="0"` on the inputs and `every(v => v >= 0)` in the memo.
Correct fix: Server-side non-negativity (R-04's trigger).
Proof of fix: A negative value is rejected by the DB and disables Save.
Depends on: R-04.

#### R-31 One `git push` publishes web and Android with no tests, no typecheck, no staging, no gate
Severity: P1
Confidence: CONFIRMED
Area: Release process
Location: `deploy-main.ps1:22-33` (`git add -A; git commit -m "chore: deploy latest changes"; git push origin main`); `.github/workflows/android-ci.yml` (no test, `tsc` or lint step between `npm ci` at `:26` and the Play upload at `:94-106`, `status: completed`); `.github/workflows/playwright.yml:127` (no env, so the sign-in test cannot pass); no `typecheck`/`lint` script; `vitest` invoked by no workflow; `vercel.json` `installCommand: npm install` (not `ci`) vs Android `npm ci`. Sources P1-25, P1-28, P2-26, P2-31, D-26.
What is wrong: Every push reaches Play testers within minutes with zero verification; the two artifacts are built from different dependency trees; TS errors (R-11's TS2554, D-02's TS2300) ship because nothing checks.
How to reproduce: Push any commit to `main`.
Blast radius: Every release; also why every other finding here survived.
Why it exists: The workflow solved "get an AAB to Play"; the tests were written separately.
Containment (minutes): 10. Run `npm run test:run` and `npx tsc --noEmit` before `bundleRelease`; `npm ci` on Vercel; gate the Play upload on a tag or `workflow_dispatch`.
Correct fix: A staging Supabase project and preview environment, a promote step, branch protection.
Proof of fix: A deliberately failing test blocks the Play upload.
Depends on: —

#### R-32 No backup, restore, down-migration or applied-state tracking exists in the repo
Severity: P1 (P0 in combination with R-01; the Supabase plan's PITR status is CG-5)
Confidence: CONFIRMED (absence)
Area: Disaster recovery / operations
Location: Absence across 43 SQL files (zero `DOWN`/rollback); every `supabase/migrations/2026*` header says "Apply manually via Supabase dashboard SQL editor"; SQL in four directories with no ordering; `PRODUCTION_CHECKLIST.md:66-67` (backup box unchecked); `BACKEND_IMPLEMENTATION.md:110` asserts PITR (a paid add-on) without qualification; `.gitignore` `backup_*.sql` is the only trace of any dump; `debug_auth_check()` exists in the generated types with no source anywhere (A-26) — the live schema is not reconstructible from the repo. Sources P0-30, A-02, A-26, D-31, D-03.
What is wrong: Any data-loss event (R-01, R-06, a mis-pasted DELETE, running one of the two committed `DISABLE ROW LEVEL SECURITY` scripts — `COMPLETE_RLS_FIX.sql:5-13`, `DATABASE_FIX_DISABLE_RLS.sql:11` — next to `GRANT SELECT ... TO anon` in `enable_realtime.sql:20-24`) is unrecoverable; which SQL is live is unknowable.
How to reproduce: Delete a group's transactions; attempt recovery.
Blast radius: Permanent.
Why it exists: Manual dashboard administration; the tooling that accompanies migrations was never adopted.
Containment (minutes): 30. Confirm the plan; enable PITR or schedule a nightly `pg_dump` and test one restore; delete the three RLS-disabling SQL files from the tree.
Correct fix: Supabase CLI migrations with a tracked history; reconcile the live function and policy set against the repo (CG-1/CG-2); a down-script for every future migration.
Proof of fix: A restore of a test table from a backup, performed once and written down; the live policy set equals the repo's.
Depends on: R-01, R-07.

#### R-33 The service worker never updates, so users run stale bundles against a live-migrating database
Severity: P1
Confidence: LIKELY (the missing prompt is CONFIRMED by grep; `injectRegister: 'auto'` behaviour and whether the 0-byte `public/manifest.webmanifest` shadows the generated one are read from plugin docs, not a build)
Area: Delivery
Location: `vite.config.ts:43,78-79` (`registerType: 'prompt'`, `skipWaiting: false`, `clientsClaim: false`); no `virtual:pwa-register`, `useRegisterSW`, `needRefresh` anywhere; `workbox-window` declared and never imported; `public/manifest.webmanifest` is 0 bytes; `includeAssets` names two files that do not exist; `:82` runtime-cache rule targets `api.supabase.co`, a host that cannot match (inert). Sources P1-32, D-13, S-20, P2-33.
What is wrong: A new service worker installs and waits until every tab of the app closes at once — for an installed PWA, potentially never. Every RLS or schema change becomes a partial outage for stale clients, whose failures are silent (R-12, R-17). The Android WebView bundle is likewise baked in.
How to reproduce: Load the app, deploy, reload: the old bundle persists.
Blast radius: Every client-side fix in §2 reaches only fresh loads.
Why it exists: "We'll switch to a prompt-based update flow" (`vite.config.ts:41-42`) — the prompt was never built.
Containment (minutes): 15. `useRegisterSW` with a "New version — Reload" toast, or `registerType: 'autoUpdate'` with `skipWaiting: true`; delete the empty manifest.
Correct fix: The containment plus `Sentry.init({ release })` so stale bundles are identifiable (R-35).
Proof of fix: After a deploy an open tab shows the prompt within one navigation.
Depends on: R-35.

#### R-34 `assetlinks.json` does not exist, so HTTPS invite links never open the Android app
Severity: P1
Confidence: CONFIRMED (absence re-checked by me)
Area: Mobile / growth
Location: `android/app/src/main/AndroidManifest.xml:49-57` (`autoVerify="true"` for `/invite` and `/sso-callback` on both hosts); `vercel.json:15-18,63` (a rewrite and a header reserving the path); no `public/.well-known/` anywhere; invite URLs built from `window.location.origin` (`supabaseApiService.ts:1011`); `docs/play-store-launch.md:26` claims a `kharchbaant://invite` scheme that nothing generates. Sources P1-34, D-22.
What is wrong: App Link verification fails, so every emailed or WhatsApp'd invite opens in the browser on an installed device, where the user must sign in again. The rewrite falls through to the SPA and returns HTML where Android expects JSON. Invites created from a Vercel preview point at a domain that will be torn down (CG-11).
How to reproduce: Install the app; tap an invite link; it opens in Chrome.
Blast radius: The product's only growth and onboarding path, on Android, silently.
Why it exists: Written in anticipation of a file that requires the release signing fingerprint, which lives in a later manual step.
Containment (minutes): 15. Write `public/.well-known/assetlinks.json` with the Play App Signing certificate's SHA-256; redeploy.
Correct fix: The containment plus a Playwright assertion that the path returns 200 with the right package.
Proof of fix: `adb shell pm verify-app-links --re-verify com.kharchbaant.app` reports verified.
Depends on: Access to the signing fingerprint.

#### R-35 "User X says their balance is wrong" cannot be answered in production
Severity: P1
Confidence: CONFIRMED (absence)
Area: Observability
Location: No `created_by`/`updated_by`/version on `transactions`; no audit table; hard deletes; `index.tsx:19-31` sets no `release`; `vite.config.ts` `sourcemap: false` with no upload step; replays only on thrown errors with text masked; balances 100 % client-derived; 112 `console.*` calls that never leave the device; 34 catch blocks that only `console.*` (`00-map.md` §0.2). Sources P1-27, P1-16, P2-24, A-20.
What is wrong: No record of who entered or changed a row, no previous values, no trace of deletions, no request correlation, no client version, no readable stack traces, no server number to compare against. The only procedure is to export rows and recompute by hand, and even that cannot separate bad data from a stale client.
How to reproduce: Take any wrong-balance report and try to determine what changed.
Blast radius: Every correctness dispute — the core failure mode of the product — is unresolvable; destructive actions are untraceable.
Why it exists: No server layer to put logging in; nobody added one.
Containment (minutes): 45. `created_by` defaulted from `requesting_user_id()`; an append-only `transactions_audit` trigger capturing `to_jsonb(OLD)`/`to_jsonb(NEW)` and the actor; `Sentry.init({ release })` from the build; `Sentry.captureException` plus a toast in the fourteen silent catches (P1-16).
Correct fix: The containment plus `sourcemap: 'hidden'` with a Sentry upload step.
Proof of fix: For any transaction, the audit table returns its full history with actor and timestamp.
Depends on: R-01, R-33.

#### R-36 Sentry runs with `sendDefaultPii`, identified users and inherited replay masking
Severity: P2 (listed here because it is on the stop-the-bleeding list)
Confidence: LIKELY (masking defaults in `@sentry/react` v10 are read from vendor docs, not the installed tree)
Area: Third-party data exposure
Location: `index.tsx:19-30` (`sendDefaultPii: true`, `replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`, `replayIntegration()` with no options), `App.tsx:58-64` (`setUser({id, email, username})`); `public/privacy.html:26` says replay is captured "if enabled" — it is enabled unconditionally. Sources A-20, P2-11.
What is wrong: A name↔email↔IP↔behaviour record in a US-hosted third party for every erroring user; masking relies on caret-ranged defaults nobody stated; the never-cleared query cache (A-18) is what a replay would record.
How to reproduce: Trigger any production error; open the replay.
Blast radius: A second copy of personal and financial context under a different access model and retention.
Why it exists: Beta debuggability defaults never revisited.
Containment (minutes): 5. `sendDefaultPii: false`; explicit `maskAllText`, `maskAllInputs`, `blockAllMedia`; `setUser({ id })` only.
Correct fix: The containment plus a `beforeSend` stripping bodies, and a privacy-policy statement that matches.
Proof of fix: A replay of an authenticated session is fully masked and the event's user object has no email.
Depends on: A-18, R-21.

### P2

Compact. Full twelve-field entries are in the pass file named.

| Id | Finding | Conf | Location | Full entry |
|---|---|---|---|---|
| A-15 | `groups` UPDATE has no `WITH CHECK`; `i_created_group` is `STABLE SECURITY DEFINER` and re-reads the old row, so a creator can set `created_by` to anything and permanently orphan the group | LIKELY | `20260412000005:110-111`, `:38-57` | `01-auth.md` A-15 |
| A-16 | `paid_by_id`, `payers[]`, `split_participants[]` never checked against membership; any `people.id` in the database is accepted | CONFIRMED | `20260412000005:146-150`, `supabaseApiService.ts:541-556` | `01-auth.md` A-16 (subsumed by R-04's trigger) |
| A-17 | No rate limit on any PostgREST/RPC write; Edge limits are per-isolate `Map`s that reset per cold start | CONFIRMED / LIKELY | `_shared/auth.ts:44-59` | `01-auth.md` A-17, `05-sweep.md` P1-04 |
| A-18 | Sign-out clears neither the query cache, nor `pendingInviteToken`, nor `selectedGroupId`; next user on the device auto-joins the previous user's pending invite | CONFIRMED | `contexts/SupabaseAuthContext.tsx:98-108`, `App.tsx:258-262` | `01-auth.md` A-18 |
| A-21 | `ai_item_cache` is globally user-writable and immutable: permanent category poisoning; policy uses pre-Clerk `auth.role()` | CONFIRMED (design) / SUSPECTED (role) | `supabase-schema.sql:88-99` | `01-auth.md` A-21, `05-sweep.md` P2-08 |
| A-24 | Two RLS-disabling SQL files sit in the tree (one with no warning banner) next to `GRANT SELECT ... TO anon` on all five tables; the audit script checks seven of nine tables | CONFIRMED (presence) / SUSPECTED (ever applied) | `COMPLETE_RLS_FIX.sql:5-13`, `DATABASE_FIX_DISABLE_RLS.sql:11`, `migrations/enable_realtime.sql:20-24` | `01-auth.md` A-24 |
| A-26 | `debug_auth_check()` and `get_current_user_person_id()` exist in the live database (generated types) with no source in the repo; body, security mode and grants unknown | SUSPECTED | `lib/database.types.ts` | `01-auth.md` A-26 |
| A-27 | RLS helper functions are `SECURITY DEFINER`, granted to `authenticated`, and callable as RPCs — a membership/existence oracle over group ids harvested from R-23 | CONFIRMED | `20260412000003:69-70`, `20260728000000:74` | `01-auth.md` A-27 |
| A-29 | Every UI-created invite is unlimited-use for 30 days; `deactivateInvite` has zero callers; a removed member re-accepts the same link; any member can extend any invite to the year 3000 (no `WITH CHECK` on `group_invites` UPDATE) | CONFIRMED | `GroupFormModal.tsx:166`, `supabaseApiService.ts:1209-1220`, `20260812000000:306-308` | `01-auth.md` A-29, `05-sweep.md` §1.3 |
| S-14 | `_txPublishChannel` is a module singleton aliasing the bridge's channel; outlives sign-out; latent throw on older realtime-js | LIKELY | `supabaseApiService.ts:479-487` | `02-sync.md` S-14 |
| S-15 | StrictMode double-mount plus topic dedupe can leave dev realtime silently dead — why local reproduction of the sync bug is unreliable | LIKELY | `index.tsx:80`, `queries.ts` bridges | `02-sync.md` S-15 |
| S-18 | Cute-icons batch: N sequential unchecked UPDATEs → N realtime events plus a full invalidate; descriptions rewritten group-wide | CONFIRMED | `supabaseApiService.ts:668-684`, `App.tsx:385-392` | `02-sync.md` S-18 |
| D-03 | `i_created_group` has four versions across migrations, two of which reject the person UUID the app writes into `created_by`; which is live is unknown | CONFIRMED (code) / LIKELY (V4 live, since creators can edit today) | `20260412000002..05` | `03-deadcode.md` §8.1 |
| D-06 | Email normalisation asymmetry: claim functions normalise only the parameter, the partial unique index is on the raw column; a mixed-case stored email is findable but never claimable → duplicate person on sign-up | LIKELY (rows must predate the lowercasing insert path) | `20260812000000:45`, `20260813020000:44`, `20260405000000:35` | `03-deadcode.md` §8.3 |
| D-07 | Both canonical docs describe `useModals`/`ModalContext` (1,281 LOC incl. a 663-line passing test suite) as the live modal system; it has zero importers | CONFIRMED | `ARCHITECTURE.md:258,296,497`, `AGENTS.md:86,299,328,494` | `03-deadcode.md` D-07 |
| D-08..D-12 | Docs that instruct harm: delete the live `ErrorBoundary`; run `DATABASE_FIX_DISABLE_RLS.sql` "(Required)"; "no data privacy between users"; settlement direction inverted; seven docs put API secrets in `VITE_*` | CONFIRMED | see entries | `03-deadcode.md` D-08..D-12 |
| D-14 / P2-36 | "Import Data" and "Reset All App Data" are success-toast stubs that do nothing, one behind an "irreversible" warning | CONFIRMED | `SettingsModal.tsx:156,305-308` | `03-deadcode.md` D-14, `05-sweep.md` P2-36 |
| D-16 | `deleteGroup` vs `approveGroupDeletion`: two copies of the cascade with different authorization models; the approval "audit" update targets a row already cascaded away | CONFIRMED | `supabaseApiService.ts:8-19, 245-277` | `03-deadcode.md` §2.4 |
| D-18 | Shares mode: validation uses the typed total, persistence coerces zeros to 1 — a ₹100 expense previews 100/0 and stores 75/25 | CONFIRMED | `TransactionFormModal.tsx:201-203, 312` | `03-deadcode.md` §2.6 |
| D-19 | `email_invites UNIQUE(group_id, email)` is on the wrong pair: an address can be emailed once per group, ever | CONFIRMED | `20251019:43-44` | `03-deadcode.md` §8.9 |
| D-21 | CI sets `VITE_CLERK_PUBLISHABLE_KEY` only on the `npm run build` step, not on `bundleRelease`; the live native plugin may ship with an empty key | LIKELY | `android-ci.yml:45-48, 76-82`, `build.gradle:26-27` | `03-deadcode.md` §6.2 |
| D-23 / M-13 | `numeric(12,2)` rounds before the CHECK: `0.005` stores as `0.01`; the 0.01 validation epsilon lets every split drift a cent; `toFixed` and Postgres disagree on ties | LIKELY / CONFIRMED | `supabase-schema.sql:56`, `TransactionFormModal.tsx:194,198` | `03-deadcode.md` §8.11, `04-money.md` M-13 |
| D-24 | Two token-injection mechanisms on every request (`accessToken` hook and a `global.fetch` override) — two `getToken()` calls per call | CONFIRMED | `lib/supabase.ts:51-65` | `03-deadcode.md` §2.10 |
| D-25 | Playwright authenticated specs create expenses and settlements against whatever `PLAYWRIGHT_BASE_URL` says; `.env.test.example` documents the production URL; no guard | CONFIRMED | `playwright.config.ts:28,96` | `03-deadcode.md` §6.10 |
| M-16 / P2-20 | `createGroupInvite` is non-atomic: partial inserts and partial sends, then a retry mints a new token and re-sends to everyone | CONFIRMED | `supabaseApiService.ts:973-1071` | `05-sweep.md` P2-20 |
| P2-09 | `avatar_url` is unbounded server-side and rides on every `getPeople` and every realtime `people` event | CONFIRMED | `SettingsModal.tsx:74`, `supabaseApiService.ts:803-806` | `05-sweep.md` P2-09 |
| P2-10 / A-25 | No Content-Security-Policy, not even report-only, in an architecture where one XSS yields a JWT that R-21 upgrades | CONFIRMED | `vercel.json:32-60` | `05-sweep.md` P2-10 |
| P2-12 | `privacy.html` and the Play Data Safety draft contradict the system on replay, retention, deletion and the AI cache | CONFIRMED | `public/privacy.html:26,42-52` | `05-sweep.md` P2-12 |
| P2-19 | Fire-and-forget promises with no handler on the propagation path (`_broadcastTxChange`, `writeCache`) | CONFIRMED | `supabaseApiService.ts:481-487`, `tagClassifier.ts:30-40` | `05-sweep.md` P2-19 |
| P2-21 | `ensureUserExists` residual race: a `23505` from the email index is not recovered; the RPC's claim branch takes no lock | LIKELY | `supabaseApiService.ts:846-912` | `05-sweep.md` P2-21 |
| P2-23 | `html2canvas` (~200 KB) statically imported on every boot for a Share-only feature | CONFIRMED | `GroupView.tsx:8`, `App.tsx:8` | `05-sweep.md` P2-23 |
| P2-24 | 112 `console.*` calls ship to production, several emitting group ids and PostgREST error bodies | CONFIRMED | `vite.config.ts` (no `drop`) | `05-sweep.md` P2-24 |
| P2-29 | Four version numbers; local Android builds collide with CI's `run_number`; the one users see ("1.0.0") is wrong | CONFIRMED | `build.gradle:24-25`, `AboutSection.tsx:8` | `05-sweep.md` P2-29 |
| P2-35 | `android:allowBackup="true"` with no exclusions may back up WebView session material to Google Drive | LIKELY | `AndroidManifest.xml:6` | `05-sweep.md` P2-35 |
| P2-37 | `AGENTS.md` instructs every AI agent to push project knowledge to an external service; nine assistant rule directories in `.gitignore` | CONFIRMED | `AGENTS.md` (Byterover section) | `05-sweep.md` P2-37 |
| D-15 | `InvitePage`'s entire signed-in half (auto-accept, Join button) is unreachable; a raw `group_members` read from the pre-RPC generation survives | CONFIRMED | `App.tsx:1029`, `InvitePage.tsx:83-86,117-143,259-298` | `03-deadcode.md` D-15 |
| A-28 | 50 s realtime JWT refresh against an assumed 60 s TTL, clamped in background tabs, no re-push on visibility or reconnect | SUSPECTED | `SupabaseAuthContext.tsx:13,67-74` | `01-auth.md` A-28 |

### P3

| Id | Finding | Conf | Full entry |
|---|---|---|---|
| D-02 | `App.tsx` imports `toast` twice (`:3`, `:921`, both top-level). **Downgraded from the agent's P1**: this is TS2300 for `tsc`, but the app is demonstrably deployed, so esbuild's TypeScript mode is tolerating the duplicate (LIKELY). It is evidence that `tsc` has never been run clean, not a shipping breakage. | CONFIRMED (dup) / LIKELY (tolerated) | `03-deadcode.md` D-02 |
| D-27 | 2,961 LOC orphaned (1,222 app, 1,009 tests of dead code, 730 scripts incl. two source-rewriting codemods with no dry-run) | CONFIRMED | `03-deadcode.md` §1.1 |
| D-28 | 19 dead exports in live files; two are user-visible gaps (`deactivateInvite`, `unarchiveGroup`) | CONFIRMED | `03-deadcode.md` §1.3 |
| D-29 | 55-line dead email block inside `addTransaction` costs 2–3 extra reads per expense; also mis-identifies the settlement receiver (M-23) | CONFIRMED | `03-deadcode.md` §2.7 |
| D-30 | Dead/misplaced dependencies: `madge`, `terser`, `supabase` CLI, `@capacitor/keyboard` (still compiled into the AAB), `vite-plugin-node-polyfills` (justified by two redundant `process.env` reads), duplicate icon and Playwright packages; `vitest@5` peer range admits an unsatisfiable `vite` | CONFIRMED | `03-deadcode.md` §5 |
| D-31 | Dead DB objects and duplicated indexes; no index serves `find_person_by_email` or the `transactions` list query; `payers` has no DDL anywhere | CONFIRMED | `03-deadcode.md` §1.4, §8.10 |
| D-32 | 20 of 46 root markdown files contradict the code (4,987 lines); the two "canonical" docs contradict each other in 11 places | CONFIRMED | `03-deadcode.md` §10.3 |
| S-20 | PWA runtime-cache rule targets a hostname that cannot match — inert, and therefore not a staleness source | CONFIRMED | `02-sync.md` S-20 |
| P3-14 | Diagnostic pages (`check-env.html`, `generate-icons.html`) and four broken root scripts shipped/committed | CONFIRMED | `05-sweep.md` P3-14 |
| P3-18 | Raw PostgREST error text (policy and constraint names) shown in toasts | CONFIRMED | `05-sweep.md` P3-18 |
| P3-38/39/40/41/42 | Clerk session/user id logged to logcat; MailerSend error bodies logged; `google-services.json` unignored; dead SW rule; CORS `allowed[0]` fallback | CONFIRMED | `05-sweep.md` |
| M-22 | Amount inputs accept unbounded precision; settlement `min="1"` forbids ₹0.50 | CONFIRMED | `04-money.md` M-22 |
| A-25 | Sentry DSN hardcoded (public by design; enables quota flooding only) | CONFIRMED | `01-auth.md` §8 |

---

## 5. Authorization matrix

Reproduced in full from `01-auth.md` §2 with my verdicts. I re-read every policy row against the migration text. Two global caveats: (1) permissive policies are OR'ed, so the "If hotfix live" column applies if R-07's eight policies exist; (2) PostgREST adds nothing — the `.eq(...)` filters in `supabaseApiService.ts` are client query params that a modified client omits; only the policy text matters. Abbreviations: `MEM` = `i_am_member_of(group_id)`, `CRE` = `i_created_group(group_id)`, `ME` = `clerk_user_id = requesting_user_id()`, `sub` = `requesting_user_id()`.

### 5.1 PostgREST table endpoints

| Endpoint / op | What it does | Who SHOULD be allowed | Check that actually exists | Where | VERDICT | If hotfix live |
|---|---|---|---|---|---|---|
| `groups` SELECT | list groups | members + creator | `created_by = sub OR MEM OR EXISTS(people id::text=created_by AND ME)` | `20260412000005:88-97` | ENFORCED | ALL rows to any user |
| `groups` INSERT | create group | anyone, `created_by` = self | `created_by = sub OR EXISTS(... AND ME)` | `…005:100-108` | ENFORCED (client picks the value; must resolve to self) | any `created_by` |
| `groups` UPDATE | rename/archive/retype/currency | creator | `USING (CRE)`; no `WITH CHECK` → USING reused | `…005:110-111` | ENFORCED but leaky (A-15: `created_by` mutable) | any user, any group |
| `groups` DELETE | delete group | creator, settled | `USING (CRE)`; settlement not checked in SQL | `…005:113-114` | ENFORCED for creator; `allSettled` CLIENT-ONLY (R-06) | any user |
| `group_members` SELECT | member list | members + creator | `CRE OR MEM` | `20260412000007:20-24` | ENFORCED | ALL rows |
| `group_members` INSERT | add a member | creator (arguably) | `WITH CHECK (CRE OR MEM)`; the added `person_id` is unconstrained | `20260812000000:334-336` | MISSING (no consent, R-14) | any user, any group |
| `group_members` UPDATE | — | nobody | no policy | — | ENFORCED-by-absence | allowed |
| `group_members` DELETE | remove a member | creator; self for leaving | `USING (CRE)` | `…005:134-135` | ENFORCED; self-removal impossible (R-14) | any user |
| `transactions` SELECT | read expenses | members | `CRE OR MEM` | `…005:143-144` | ENFORCED | ENFORCED (hotfix does not touch it) |
| `transactions` INSERT | add expense | members | `WITH CHECK (CRE OR MEM)`; `paid_by_id`/participants unchecked | `…005:146-147` | ENFORCED at group level; A-16/R-04 | same |
| `transactions` UPDATE | edit expense | row author or creator | `USING (CRE OR MEM)`, no `WITH CHECK` | `…005:149-150` | ENFORCED at group level; any member edits any row (R-01/R-24) | same |
| `transactions` DELETE | delete expense | row author or creator | `USING (CRE OR MEM)` | `20260412000008:12-13` | **MISSING per-row; bulk delete by group id open to any member (R-01)** | same |
| `payment_sources` SELECT/INSERT/UPDATE/DELETE | own cards | owner | `EXISTS(people id::text=user_id AND ME) OR user_id = sub` | `…005:164-186` | ENFORCED | same |
| `people` SELECT | read a person | self + co-members + creator's members | `TO authenticated USING (i_can_see_person(id))` | `20260728000000:80-82`, fn `:30-72` | ENFORCED except the fourth disjunct (R-18) and bypassed by `find_person_by_email` (R-08) | same |
| `people` INSERT | create person | self, or a placeholder | `ME OR (COALESCE(is_claimed,false)=false AND clerk_user_id IS NULL)` | `20260728000000:88-92` | MISSING bound (R-20) | same |
| `people` UPDATE | edit profile | self | `USING (ME)`, no `WITH CHECK` (email/is_claimed/source self-settable) | `20260728000000:94-96` | ENFORCED (zero-row UX lies, R-16) | same |
| `people` DELETE | delete profile | self | `USING (ME)` | `20260728000000:98-100` | ENFORCED | same |
| `group_invites` SELECT | list invites (plaintext tokens) | members | `TO authenticated USING (CRE OR MEM)` | `20260812000000:298-300` | ENFORCED | same |
| `group_invites` INSERT | create link | members | `WITH CHECK (CRE OR MEM)`; `invited_by`, `max_uses`, `expires_at`, token client-chosen | `:302-304` | ENFORCED (coarse) | same |
| `group_invites` UPDATE | deactivate / extend | creator of the invite | `USING (CRE OR MEM)`, no `WITH CHECK` | `:306-308` | ENFORCED (coarse): any member extends/resets any invite (A-29) | same |
| `group_invites` DELETE | delete link | members | `USING (CRE OR MEM)` | `:310-312` | ENFORCED | same |
| `email_invites` SELECT | who was emailed | members | `USING (CRE OR MEM)` | `:314-316` | ENFORCED via table; leaked to anon by `get_invite_preview` (R-19) | same |
| `email_invites` INSERT | record an email invite | members | `WITH CHECK (CRE OR MEM)`; address arbitrary | `:318-320` | ENFORCED at group level (R-10) | same |
| `email_invites` UPDATE / DELETE | mark accepted / remove | members | `USING (CRE OR MEM)` | `:322-328` | ENFORCED (coarse) | same |
| `group_deletion_requests` all four | approval workflow | requester + creator | RLS enabled at `20260728000000:19`; **zero policies in the repo** | — | INCONSISTENT (R-22): deny-all, or never enabled and fully open | unchanged |
| `ai_item_cache` SELECT | read shared cache | nobody directly (via RPC) | `USING (auth.role() = 'authenticated')` | `supabase-schema.sql:91-94` | MISSING scope (R-09) | unchanged |
| `ai_item_cache` INSERT | write shared cache | server only | `WITH CHECK (auth.role() = 'authenticated')` | `:96-99` | MISSING (A-21 poisoning) | unchanged |
| `ai_item_cache` UPDATE/DELETE | — | operator | no policy | — | denied (rows immortal) | unchanged |

### 5.2 RPC endpoints (`POST /rest/v1/rpc/<name>`)

| RPC | What it does | Who SHOULD | Check that exists | Where | VERDICT |
|---|---|---|---|---|---|
| `ensure_my_person(p_name, p_email)` | upsert my row; claims any unclaimed row matching `p_email` | self, email from the IdP | JWT `sub` non-empty; `p_email` trusted verbatim | `20260813020000:16-18`, claim `:35-49` | **MISSING (R-02)** |
| `claim_person_by_email(p_email, p_clerk_id, p_name)` | claim an unclaimed row by email | self | clerk id must equal `sub` (`:29-34`); `p_email` unverified | `20260812000000:12-53` | **MISSING (R-02)** |
| `create_unclaimed_person(name, email, avatar)` | insert a placeholder | signed-in users, bounded | auth + non-empty name | `20260813010000:17-23` | ENFORCED weakly; unbounded (R-20) |
| `find_person_by_email(p_email)` | full `people` row for any email | co-members only | auth only; `SECURITY DEFINER`, `SETOF people`, `SELECT *` | `20260728000000:103-117` | **MISSING (R-08)** |
| `get_invite_preview(p_token)` | landing payload | token holder | token knowledge; granted to `anon` | `20260812000000:77-162` | ENFORCED-by-design, over-shares (R-19) |
| `accept_group_invite(p_token)` | join a group | token holder bound to JWT | person from `sub`; `FOR UPDATE` on the invite; expiry and uses checked; group from the invite row | `20260812000000:168-273` | **ENFORCED — the model to copy** |
| `anonymize_my_account()` | strip identity from my row | self | `sub` → own row | `20260813000000:15-39` | ENFORCED; nulls `clerk_user_id` (R-02 step, R-28) |
| `cleanup_expired_invites()` | deactivate expired invites | scheduler | INVOKER, no auth, never called | `migrations/20251019:64-86` | MISSING (benign) |
| `generate_invite_token()` | random token | — | INVOKER, never called | `20251019:89-95` | MISSING (nil impact) |
| `get_current_user_person_id()` | Supabase-Auth-era helper | — | no definition in the repo | `lib/database.types.ts` | UNKNOWN (CG-2) |
| `debug_auth_check()` | unknown | — | no definition in the repo; exists live | `lib/database.types.ts` | UNKNOWN — flag (A-26, CG-2) |
| `requesting_user_id()` | JWT `sub` | internal | default grants | `20260412000006:17-22` | callable; harmless |
| `i_am_member_of(uuid)` / `i_created_group(uuid)` / `i_can_see_person(uuid)` | RLS helpers | internal | `SECURITY DEFINER`, granted to `authenticated` | `20260412000003:69-70`, `20260728000000:74` | CLIENT-CALLABLE oracle (A-27) |

### 5.3 Edge Functions

| Endpoint | What it does | Who SHOULD | Check that exists | Where | VERDICT |
|---|---|---|---|---|---|
| `send-email` `welcome` | mail an arbitrary address with arbitrary `userName`/`appUrl` | nobody (no client caller) | any valid JWT + `isValidEmail` | `send-email/index.ts:57-60, 84-97` | **MISSING (R-10)** |
| `send-email` `group_invite` | mail arbitrary address with arbitrary `inviterName`/`groupName`/`inviteUrl` | a member of the group | any valid JWT; no group id is passed, so no check is possible | `:99-120` | **MISSING (R-10)** |
| `send-email` `member_added` | arbitrary address and strings | members | any valid JWT | `:122-140` | MISSING (R-10) |
| `send-email` `settle_up` | two mails, arbitrary addresses/amounts/names | members | any valid JWT | `:142-195` | MISSING (R-10) |
| `send-email` `new_expense` | up to 25 recipients per call | members | any valid JWT | `:197-226`, cap `:39,202` | MISSING (R-10) |
| `suggest-tag` | Gemini call, ≤200 chars | authenticated | `requireAuthSub` + 30/min/isolate | `suggest-tag/index.ts:44-52` | ENFORCED-ish (cost bounded only by the fake limit, A-17) |
| `native-bridge` | Clerk session JWT → sign-in ticket | the Android app | `verifyToken` without `authorizedParties`; `sub` prefix; 10/min/isolate after the verify | `native-bridge/index.ts:104-133` | CLIENT-ONLY-equivalent (R-21) |

### 5.4 Realtime

| Channel / event | Publisher | Subscriber | Authorization that exists | Where | VERDICT |
|---|---|---|---|---|---|
| `public:groups` `postgres_changes *` | WAL | every signed-in client | RLS per subscriber for INSERT/UPDATE; **none for DELETE** | `supabaseApiService.ts:389-401` | ENFORCED for INSERT/UPDATE; MISSING for DELETE (R-05) |
| `public:transactions` `postgres_changes *` | WAL | every client | same | `:404-418` | same (R-05) |
| `public:payment_sources` `postgres_changes *` | WAL | every client | same | `:433-447` | same |
| `public:people` `postgres_changes *` | WAL | every client | same (full row incl. avatar and `clerk_user_id` on DELETE) | `:450-464` | same |
| `public:group_members` `postgres_changes *` | WAL | every client | same; `old.person_id` drives cache purge | `:467-475` | same (R-05) |
| `public:transactions` broadcast `tx` | the client (`_broadcastTxChange`) | every client on the topic (none registered today) | none; channel not private | publisher `:479-487`, listener never attached (`apiService.ts:15`) | MISSING (R-23); dormant via R-11 |
| `heartbeat` | — | status badge | none needed; no bindings | `components/RealtimeStatus.tsx:11` | n/a (decorative, R-11) |

### 5.5 App-level composite operations

| Operation | Underlying ops | Server-side check | Where | VERDICT |
|---|---|---|---|---|
| `deleteGroup(groupId, userId, isOwner, allSettled)` | `group_members` DELETE → `transactions` DELETE → `groups` DELETE, first two unchecked | JS throws on client booleans; DB: `CRE`, `CRE OR MEM`, `CRE` | `supabaseApiService.ts:8-19`; `App.tsx:546` | CLIENT-ONLY for settlement; transactions half open to any member (R-01, R-06) |
| `archiveGroup(groupId, userId, isOwner, userSettled, allSettled)` | `groups` UPDATE `is_archived` | JS rejects owners; RLS `CRE` permits only owners | `:22-31`; `App.tsx:567` | INCONSISTENT — dead for everyone, reports success (R-14, R-16) |
| `unarchiveGroup(groupId)` | `groups` UPDATE | no JS gate; DB `CRE`; no `.single()` | `:2-6`; `ArchivedGroupsModal.tsx:51` | ENFORCED by RLS; silent 0-row for non-creators (R-16) |
| `updateGroup(groupId, data)` | `groups` UPDATE `.single()` → `group_members` DELETE all → INSERT set | `CRE` on the update (throws for non-creators before the wipe); member ops `CRE` / `CRE OR MEM` | `:326-373` | Non-transactional (R-13); with hotfix live, any user wipes any membership (R-07) |
| `requestGroupDeletion(groupId, requestedBy)` | `group_deletion_requests` SELECT + INSERT | `requested_by` client-supplied; no policies | `:220-242` | MISSING (R-22) |
| `approveGroupDeletion(requestId, approverId, allSettled)` | read → three deletes → status update | creator check in JS on client-fetched data; `allSettled` in JS (panel passes literal `true`); deletes re-checked by RLS as above | `:245-277`; `AdminDeletionRequestsPanel.tsx:63` | CLIENT-ONLY workflow; transactions delete open to any member (R-01) |
| `rejectGroupDeletion(requestId)` | `group_deletion_requests` UPDATE | none anywhere | `:317-324` | MISSING (R-22) |
| `getPendingDeletionRequests(userId)` | SELECT + embed, filtered in JS | `.filter(created_by === userId)` after the wire | `:280-314` | CLIENT-ONLY (R-22) |
| `addPersonToGroup(groupId, {name,email})` | `find_person_by_email` → direct `group_members` INSERT with the returned id, else `create_unclaimed_person` → INSERT | `WITH CHECK (CRE OR MEM)` on the caller only | `apiService.ts:43-73` | MISSING consent (R-14) |
| `createGroupInvite(...)` | JS membership pre-check → `group_invites` INSERT → N× `email_invites` INSERT → N× `send-email` | DB `CRE OR MEM` on both tables; email list unbounded and arbitrary | `supabaseApiService.ts:973-1071` | ENFORCED for the group; R-10 for the mail |
| `deactivateInvite(inviteId)` | `group_invites` UPDATE | `CRE OR MEM` | `:1209-1220` | ENFORCED (coarse); zero callers |
| `updateUserAvatar(personId, url)` | `people` UPDATE, no `.single()` | `USING (ME)` | `:1232-1243` | ENFORCED; 0-row success (R-16) |
| `updatePerson(personId, updates)` | `people` UPDATE `.select().single()` | `USING (ME)` | `:1246-1260` | ENFORCED (by accident of `.single()`); dead caller |
| `mergePersonByEmail(email, clerkUserId)` | `people` SELECT unclaimed → UPDATE set `clerk_user_id` | `people` UPDATE `USING (ME)` fails (target row's id is NULL) | `:1267-1291` | ENFORCED-by-accident; dead code whose intent is R-02 |
| `batchApplyEmojisToGroupTransactions(groupId)` | SELECT + N× UPDATE unchecked | `CRE OR MEM` per row | `:668-684` | ENFORCED; any member rewrites every description (S-18) |
| `acceptInvite({inviteToken, personId})` | RPC | person resolved from `sub`; client `personId` ignored | `:1144-1189` | ENFORCED |
| `anonymizeMyAccount()` | RPC | `sub` | `:1294-1307` | ENFORCED (see R-28 for what it does not do) |

---

## 6. Sync coverage table

Reproduced in full from `02-sync.md` §4. Columns: →B = propagates to another device; Mech = by what; →tab = another tab of the same browser; →self = does the writer's own UI update without waiting for realtime. PG = `postgres_changes`; the `tx` broadcast (BC) is published on every transaction write and consumed by nobody (R-11). Mechanisms that exist: PG (five unfiltered table channels), a same-tab `groupMemberAdded` window event, post-await `setQueryData`/`invalidateQueries`, and component-local `useState`. Absent: refetch on focus, any visibility/resume handler, polling, a persisted cache, `useMutation`, optimistic writes, any version or `updated_at` comparison, any server-side balance.

| # | Mutation | →B | Mech | →tab | →self without realtime |
|---|---|---|---|---|---|
| 1 | Add expense | yes | PG INSERT | yes (PG) | **NO** (`App.tsx:353-355`) |
| 2 | Edit expense | yes | PG UPDATE | yes | yes (`App.tsx:352`) |
| 3 | Delete expense | yes | PG DELETE (unfiltered, R-05) | yes | yes (`App.tsx:338`) — phantom on RLS denial (R-16) |
| 4 | Settle-up create | yes | PG INSERT | yes | yes (`App.tsx:796-798`) |
| 5 | Settle-up edit | yes | PG UPDATE | yes | yes (`App.tsx:791`) |
| 6 | Add group | partial — via `group_members` INSERT only (the `groups` INSERT fails RLS for members at WAL time) | PG | yes | yes (`App.tsx:443`) |
| 7 | Edit group (name/currency/type) | yes | PG UPDATE, members preserved from stale cache | yes | yes (invalidate, `App.tsx:395`) |
| 8 | Edit group (members) | yes, destructively | 2N+1 PG events; kicks viewers out (R-13) | yes | yes |
| 9 | Delete group | yes | PG DELETE ×(N+M+1), unfiltered | yes | yes (`App.tsx:547`) |
| 10 | Archive group | **no-op in DB** (R-14) | — | no | yes (cache lies) |
| 11 | Unarchive group | yes | PG UPDATE | yes | **NO** (`ArchivedGroupsModal.tsx:52` local state only) |
| 12 | Request deletion | **no** | — (table not in publication, no bridge) | no | n/a (toast only) |
| 13 | Approve deletion | yes (the deletes) | PG DELETE | yes | via `loadRequests()` |
| 14 | Reject deletion | **no** | — | no | via `loadRequests()` |
| 15 | Add person to group | member list yes / person row **no** (R-29) | PG INSERT `group_members` | partial | yes (DOM event, same tab) |
| 16 | Accept invite | member list yes / person row **no** (R-29) | PG INSERT `group_members` | partial | groups only |
| 17 | Create invite | **no** | — | no | yes (modal state) |
| 18 | Deactivate invite | **no** | — | no | n/a (dead export) |
| 19 | Update avatar | yes | PG UPDATE `people` (full row incl. blob) | yes | yes + the app's only real optimistic write (`SettingsModal.tsx:85`) |
| 20 | Update name | yes | PG UPDATE `people` | yes | yes (dead caller) |
| 21 | Anonymize account | yes (name only) | PG UPDATE `people` | yes | sign-out |
| 22 | Add payment source | n/a (private) | PG INSERT (self only) | yes | **NO** (`App.tsx:496`) |
| 23 | Archive payment source | n/a | PG UPDATE (self) | yes | yes (`App.tsx:511`) |
| 24 | Delete payment source | n/a | PG DELETE (self) | yes | yes (`App.tsx:523`) |
| 25 | Cute-icons batch | yes | N× PG UPDATE + full invalidate (S-18) | yes | yes |
| 26 | `ai_item_cache` write | **no** | — | no | n/a |

Nothing at all propagates for rows 12, 14, 17, 18, 26 (and 10, which never reaches the database). Reconnect and backfill: only TanStack's `refetchOnReconnect` on a browser `online` event; no catch-up read after backgrounding, a server-closed channel, or an expired subscription token (R-11). Ordering: none; handlers are last-write-wins (R-24). Offline: no write queue, no idempotency; the PWA cache rule is inert (S-20). Listener lifecycle: one effect per bridge, cleaned up correctly; six channels on one socket; the publisher singleton aliases the bridge's channel (S-14); StrictMode double-mount can kill dev realtime (S-15). Database concurrency: not one transaction in the codebase except `accept_group_invite`; every multi-statement write (`addGroup`, `updateGroup`, `deleteGroup`, `approveGroupDeletion`, `createGroupInvite`, `requestGroupDeletion`, the emoji batch) is independent HTTP requests with no rollback (`02-sync.md` §12).

---

## 7. Salvage assessment

Verdicts per module. PORT AS-IS = usable in a rebuild unchanged; PORT WITH FIXES = keep the design, apply the named findings; REWRITE = the responsibility is needed, the code is not; DELETE = neither.

**Domain and arithmetic**
- `types.ts` — PORT WITH FIXES (drop `authUserId` dual-space field; `Currency` needs a CHECK counterpart; `adjustment` type is unproduced).
- `utils/calculations.ts` — `calculateGroupBalances`, `simplifyGroupDebts`, `getUserFacingDebts`: PORT WITH FIXES (R-15: minor-unit rounding before the simplifier; per-currency buckets). `materializeSplit`, `validateSplit`, `distributeRounding`: PORT WITH FIXES (fix `distributeRounding`'s over/under-100 % behaviour; make them the live path). `calculateShares` float path: REWRITE (replace with `materializeSplit`). Long-term the whole file becomes a server-side ledger (R-04).
- `src/test/utils/calculations.test.ts` — PORT WITH FIXES (add the zero-sum, sum-to-amount and multi-payer invariants; 20 of 49 tests currently cover dead code).

**Database**
- `supabase/migrations/` Phase A/B objects: `accept_group_invite` PORT AS-IS (the one correctly built write); `requesting_user_id` (V3, `20260412000006`) PORT AS-IS; `i_am_member_of`, `i_created_group` (V4) PORT WITH FIXES (revoke public grants, resolve the `created_by` type ambiguity); `i_can_see_person` PORT WITH FIXES (drop the fourth disjunct); `get_invite_preview` PORT WITH FIXES (R-19); `ensure_my_person` PORT WITH FIXES (R-02); `claim_person_by_email` REWRITE; `find_person_by_email` REWRITE (R-08); `create_unclaimed_person` PORT WITH FIXES (R-20); `anonymize_my_account` PORT WITH FIXES (R-28).
- Table policies: `groups`, `group_members`, `people`, `group_invites`, `email_invites`, `payment_sources` PORT WITH FIXES (add `WITH CHECK` everywhere, narrow `group_members` INSERT, add self-removal DELETE, per-row transaction ownership); `transactions` UPDATE/DELETE policies REWRITE (R-01); `group_deletion_requests` DELETE the feature or REWRITE server-side (R-22); `ai_item_cache` REWRITE (R-09).
- Schema: `transactions` REWRITE (`created_by`, audit trigger, constraints on `payers`/`split_participants`, currency, ideally a ledger table); `groups` PORT WITH FIXES (`created_by` FK, currency CHECK); `people` PORT WITH FIXES (functional unique index on email, avatar length, drop `auth_user_id`/`user_id`); `group_invites`/`email_invites` PORT WITH FIXES (correct UNIQUE pair, NOT NULL on `current_uses`/`is_active`); indexes REWRITE (none serve the real queries).
- `migrations/` (17 files), root `*.sql` (6), `scripts/migrations/` (2), `supabase-schema.sql`, `COMPLETE_DATABASE_MIGRATION.sql` — DELETE after reconciling the live schema (CG-1/CG-2); three of them disable RLS.
- `lib/database.types.ts` — PORT AS-IS as the only artifact generated from the real database; regenerate after reconciliation.

**Client data layer**
- `lib/supabase.ts` — PORT WITH FIXES (one token-injection mechanism, D-24; throw on token failure, R-17).
- `lib/queryClient.ts` — PORT WITH FIXES (refetch on focus/visibility; per-group transaction keys).
- `services/queries.ts` — query hooks PORT WITH FIXES (R-29 invalidations); realtime bridges REWRITE (private per-group channels, INSERT/UPDATE only, reconcile on resume).
- `services/supabaseApiService.ts` — read transforms PORT WITH FIXES (map `updated_at`, drop the N+1 in `getGroups`, paginate `getTransactions`); every write and composite REWRITE behind transactional RPCs; the 55-line dead email block DELETE.
- `services/apiService.ts` façade — DELETE (R-11 is its only contribution).
- `services/emailService.ts` — PORT WITH FIXES (one type, id-based); `services/tagClassifier.ts`/`geminiService.ts` — PORT WITH FIXES (writes via the Edge Function, hashed keys).
- `store/appStore.ts` — PORT AS-IS (clear on sign-out).
- `contexts/SupabaseAuthContext.tsx` — PORT WITH FIXES (error state, cache clear on sign-out, resume re-auth).
- `hooks/useModals.ts` + `contexts/ModalContext.tsx` + `hooks/useModals.test.ts` — DELETE (zero importers; or finish tasks 4–8 of its plan — pick one, do not leave both).
- `utils/paymentSourceMetrics.ts`, `constants.ts`, `components/CurrencySelector.tsx`, `LanguageSelector.tsx`, `auth/UserProfile.tsx`, `SimpleAuth.tsx`, `AuthLayout.tsx`, `services/nativeGoogleAuth.ts`, root scripts `inspect-db.mjs`, `test-env.mjs`, `test-gemini.mjs`, `vercel-diagnostic.js`, the three design-token codemods — DELETE (2,961 LOC).

**Components**
- `components/BaseModal.tsx` — PORT AS-IS (genuinely well built: dialog roles, focus restore, Escape).
- `TransactionFormModal.tsx` — PORT WITH FIXES (R-03, R-12, R-30, R-27, D-18); `SettleUpModal.tsx` — PORT WITH FIXES (R-25); `GroupFormModal.tsx` — PORT WITH FIXES (R-14, R-26, invite defaults); `MemberInviteModal.tsx` — PORT WITH FIXES (R-08's narrower response).
- `GroupSummaryCard.tsx`, `GroupBalancesModal.tsx` — REWRITE the balance loops (R-15) or delete in favour of the canonical calculator; `Dashboard.tsx`, `MemberBalances.tsx`, `HomeScreen.tsx`, `BalanceBreakdownModal.tsx`, `TransactionItem.tsx`, `GroupSummaryModal.tsx` — PORT WITH FIXES (one formatter, R-26 "former member", R-27 per-currency).
- `SettingsModal.tsx` — PORT WITH FIXES (R-28); `DangerZone.tsx` "Reset", `DataExport.tsx` import half — DELETE the fakes.
- `AdminDeletionRequestsPanel.tsx` — DELETE with the feature, or REWRITE once R-22 has policies.
- `ArchivedGroupsModal.tsx` — PORT WITH FIXES (cache, not local state; `.single()`); `RealtimeStatus.tsx` — REWRITE (real channel health).
- `invite/InvitePage.tsx` — PORT WITH FIXES (remove the unreachable signed-in half and the raw table read; one landing component for both auth states).
- `App.tsx` (1,050 lines, 19 modal states, business logic inline) — REWRITE; keep the routing intent and the back-button handling (`useBackButton`, PORT WITH FIXES: cover the three confirm modals).
- `ErrorBoundary.tsx`, `Avatar.tsx`, `icons/Icons.tsx` — PORT AS-IS (pick one icon system).

**Auth and native**
- Generation 3 (`services/clerkNativeAuth.ts`, `nativeAuthBridge.ts`, `hooks/useNativeGoogleSignIn.ts`, `android/.../ClerkNativeAuthPlugin.kt`, `KharchBaantApp.kt`) — PORT WITH FIXES (R-21, D-21).
- `utils/nativeDeepLinks.ts`, `components/auth/SsoFinish.tsx`, `AndroidManifest.xml` intent filters — PORT WITH FIXES (restrict the custom scheme to `sso-callback`; `assetlinks.json`).
- Generation 2 (`hooks/useNativeOAuth.ts` initiators, `public/native-sso.html`, its `vercel.json` rewrite and `vite.config.ts` key injection, `clerkAppearance.ts:16,22`) — DELETE (initiator dead, receiver is an unauthenticated app-launcher gadget).
- Generation 1 (`@capgo/capacitor-social-login` in `package.json`, `capacitor.settings.gradle`, `MainActivity.java` wiring) and generation 0 (Supabase-Auth SQL and components) — DELETE.
- `components/auth/AuthScreen.tsx`, `WelcomeScreen.tsx`, `UserMenu.tsx` — PORT AS-IS.

**Edge Functions**
- `_shared/auth.ts` — PORT WITH FIXES (durable rate limit, CORS fallback); `native-bridge` — PORT WITH FIXES (R-21); `suggest-tag` — PORT WITH FIXES (write the cache from here); `send-email` — REWRITE (R-10).

**Build, config, CI, docs**
- `vite.config.ts` — PORT WITH FIXES (PWA block rewritten or `autoUpdate`; drop node polyfills after the 3-character edit; `drop: ['console']`; `release` define); `vercel.json` — PORT WITH FIXES (`npm ci`, CSP report-only, assetlinks); `capacitor.config.ts` — PORT AS-IS; `android/` — PORT WITH FIXES (`allowBackup`, `minifyEnabled`, version source); `.github/workflows/*` — PORT WITH FIXES (R-31); `playwright.config.ts` and specs — PORT WITH FIXES (refuse a production `baseURL`; supply env in CI); `tailwind.config.js` — PORT WITH FIXES (content globs omit `utils/`, `lib/`, `services/`, `store/`).
- `AGENTS.md`, `ARCHITECTURE.md` — REWRITE from the code, after the code (they currently describe dead systems and instruct harmful actions; D-07..D-12, P2-37).
- The 20 CONTRADICTS-CODE root documents and the 17 historical ones (`03-deadcode.md` §10.3) — DELETE; `docs/security-phase-a.md`, `docs/superpowers/specs/2026-09-06-native-android-google-auth.md`, `docs/play-store-launch.md` (corrected) — PORT AS-IS as history.
- `knip-report.json`, `structure.txt`, `components.txt`, `.vercel-rebuild-trigger`, `public/check-env.html`, `public/generate-icons.html`, the 0-byte `public/manifest.webmanifest`, `scripts/deploy_test.ps1` — DELETE.

---

## 8. Root-cause analysis

These are process causes. Each is stated with the evidence that ties it to more than one finding.

1. **The database is administered by pasting SQL into a dashboard, with no applied-state tracking.** Forty-three SQL files in four directories, every 2026 migration headed "Apply manually", 174 `CREATE POLICY` statements for ~24 policies, four versions of one helper function, a hotfix that disabled authorization and was never reverted, a function that exists live with no source anywhere. R-07, R-22, R-32, D-03, A-26 and the entire "if hotfix live" column are one cause.

2. **There is no server, and nobody wrote the SQL that a server would have contained.** The browser-direct architecture puts validation, authorization, atomicity, rate limiting and audit all into Postgres. The repo has policies (authorization) and almost nothing else: no CHECK on money, no triggers, one transactional RPC, no audit, no counters. R-01, R-03, R-04, R-06, R-13, R-25, R-35 follow directly.

3. **Authorization was treated as a client concern.** `isOwner` and `allSettled` are function arguments; the admin filter runs after the rows crossed the wire; UI buttons are the only gate on settlement; a display bug was fixed by widening a DELETE policy. R-01, R-06, R-14, R-22.

4. **Nothing checks the code.** No `tsc`, no lint config, no `vitest` in CI, an 8 % coverage gate nobody runs, a Playwright job that cannot pass, and a push to `main` that publishes to Play. A TS2554 disconnected the sync fallback (R-11) and shipped; a TS2300 duplicate import shipped; thirteen zero-row writes shipped. R-11, R-12, R-16, R-31.

5. **Multiple assistants, one-line prompts, no plan.** The signature is parallel implementations that disagree: five balance calculators (two ignoring `payers`), five identity-claim paths, three generations of native auth all still shipped, two modal systems, two accept-invite flows (one unreachable), nine currency formatters, three copies of the tag list, two token-injection mechanisms, a façade that drifted from what it wraps. R-15, R-11, R-2's five writers, D-07, D-24, and 2,961 orphaned lines.

6. **Documentation was written as memory for the assistants and drifted into instruction for harm.** `ARCHITECTURE.md` marks the dead modal system "Resolved"; one doc says run `DATABASE_FIX_DISABLE_RLS.sql` "(Required)", another says never run it; seven docs put secrets in `VITE_*`; the settlement doc has the direction inverted. The next agent that reads the "canonical" docs fixes dead code. D-07..D-12, P2-37.

7. **Symptoms were fixed where they appeared, not where they came from.** The realtime broadcast was added to bypass RLS filtering it did not understand; `REPLICA IDENTITY FULL` was set to get `old.id`; a member-display bug got a same-tab window event; a phantom-delete bug got a wider policy; the duplicate-user incident got a document claiming a merge routine that does not exist. R-05, R-23, R-29, R-01, R-28.

8. **Errors are logged to a console nobody sees.** Thirty-four catch blocks that only `console.*`, fourteen of them on money or auth paths; success toasts on no-ops; a green "Live" badge with no bindings; no `release` in Sentry and no source maps. Every finding in this report survived because the system cannot say what is wrong. R-12, R-16, R-17, R-35.

9. **Money was modelled as a UI concern.** Floats from keyboard to pixel, balances recomputed per device from a partial cache, the correct rounding helper written and never wired, no invariant anywhere. The sync bug and the money bug are the same bug because there is no server number. R-04, R-15, R-24, R-27.

10. **Release is a side effect of saving work.** `deploy-main.ps1` commits everything with a fixed message and pushes; that push deploys web and publishes to Play; nothing is staged, gated or reversible; stale service-worker and Android bundles then run against a live-migrating database. R-31, R-33, R-34.

---

## 9. Coverage gaps

What this audit could not determine, and the single artifact that closes each.

| # | Gap | Closing artifact |
|---|---|---|
| CG-1 | **The live policy set and RLS state.** Everything in §5 is the repo's intended state. R-07, R-22, A-21, A-24 hinge on this. | `SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,3,2;` and `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';` |
| CG-2 | **The live function set.** `debug_auth_check`, `get_current_user_person_id`, which `i_created_group` and `requesting_user_id` bodies are live, whether `ensure_my_person` matches the repo. | `SELECT proname, prosecdef, pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace;` |
| CG-3 | **Realtime configuration**: publication membership, replica identity, "Allow public access". Decides R-05's severity and whether R-11/S-U1 is the whole story. | `SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime';` · `SELECT relname, relreplident FROM pg_class WHERE relname IN (...);` · the Realtime settings page. |
| CG-4 | **Live constraints on `transactions`** (`payers`, `split_participants`, `type` CHECK, `amount` precision). | `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='transactions'::regclass;` and `\d+ transactions`. |
| CG-5 | **Supabase dashboard**: Clerk third-party auth and the `role` claim; Edge secrets (`ALLOWED_ORIGINS`, `MAILERSEND_*`, `GEMINI_*`, `CLERK_SECRET_KEY`); `verify_jwt` per function; plan tier and PITR; PostgREST log retention. | Screenshots/export of Auth → Third-party, Edge Functions → Secrets, Settings → Add-ons. |
| CG-6 | **Clerk dashboard**: session-token TTL (the code assumes 60 s), `azp`/`aud` of a native token (R-21's fix needs it), self-deletion enabled (R-28), attack-protection limits, cookie flags, allowed origins. | A decoded live session JWT plus the dashboard settings. |
| CG-7 | **Git history is absent.** Nothing can be said about secrets committed and removed, when policies were introduced, deploy cadence, or authoring styles. | The upstream repo with full history; `git log -p --all -S 'eyJ' -S 'service_role' -S 'mlsn.'`. |
| CG-8 | **Nothing was built, typechecked, linted or unit-tested** (no `node_modules`; installs forbidden). D-02's tolerance, D-21's empty key, P2-33's manifest, and the full list of `tsc` errors are unobserved. | `npm ci && npx tsc --noEmit && npm run test:run && npm run build` on a clean checkout. |
| CG-9 | **Nothing was executed against a database or a browser.** Every reproduction is derived from source; timing windows (R-06 first paint, R-12 double-tap, R-13 race) are LIKELY for that reason. | A staging project seeded from the intended migration set plus two test accounts; run §4's reproductions. |
| CG-10 | **Library internals** — realtime-js topic dedupe and `subscribe()` guard, supabase-js `accessToken` plumbing, `@clerk/backend` `verifyToken` without `authorizedParties`, clerk-js `handleRedirectCallback`, Sentry v10 replay defaults — were read from GitHub tags matching `package-lock.json`, not the installed tree. | The installed tree, or the vendor source at the pinned versions. |
| CG-11 | **Vercel project settings**: env per environment; whether preview deployments point at the production Supabase project (R-34's preview-origin invites). | Vercel → Environment Variables. |
| CG-12 | **On-device Android behaviour**: App Links verification, Auto Backup contents, logcat in a release build, Doze and the `online` event. | A device test with `chrome://inspect`; `adb shell pm verify-app-links`. |
| CG-13 | **MailerSend account state**: sending domain, quota, whether abuse has occurred (R-10). | The MailerSend dashboard. |
| CG-14 | **Whether `supabase-schema.sql`'s seed rows** (fixed UUIDs `00000000-…-0001` "You", Alice, Bob) exist in production — if so, they are unclaimed rows with known ids, direct R-02/R-14 targets. | `SELECT id, name, email, is_claimed FROM people WHERE id::text LIKE '00000000-%';` |

---

## 10. Suspicions / Unverified

Pattern-matched, not provable from the repo. None is cited as evidence above.

1. **`native-sso.html` may be more than a UI gadget.** It is a public, unauthenticated launcher that forwards arbitrary query parameters (including `__clerk_created_session`) into `clerk.handleRedirectCallback` with no validation by app code (`public/native-sso.html:64-70,88,126-133`; `utils/nativeDeepLinks.ts:134-144`). Exploitability lives in clerk-js (CG-10). If a crafted session id can influence the victim's client, this is P0; today it is a suspicion. Deleting the page (§7) removes the question.
2. **`auth.role()` may not evaluate under Clerk** (A-21). I reasoned above that it must (the `TO authenticated` policies work), which is what makes R-09 a leak; the negative case would instead mean every classification is a paid Gemini call forever. One `SELECT auth.role();` with a real JWT settles both.
3. **The tables may not be in the realtime publication at all** (S-U1). `ENABLE_REALTIME.md` exists because this was once wrong, and `enable_realtime.sql` lives in the never-applied directory. Against it: the founder's phrasing implies device A does update, which (with no cache write on add) requires delivery to the writer. CG-3.
4. **Realtime may stop delivering after the socket's JWT expires without closing the channel** (S-U2), and `_performAuth`'s change-detection may skip the 50 s re-push when Clerk returns a cached token (S-U3). Both would look exactly like the founder's symptom. Needs an empirical test.
5. **`i_created_group` divergence** (D-03): V3 compares `people.user_id`, V4 `people.clerk_user_id`; `anonymize_my_account` nulls both, `create_unclaimed_person` sets neither. If the two columns ever diverge, group ownership silently changes. CG-2.
6. **Preview deployments probably share the production database** (CG-11); if so, every preview URL is another origin holding a live anon key, and preview-created invites are broken links in production data.
7. **`ai_item_cache` probably already contains sensitive descriptions.** Cheap to confirm, but confirming means reading other users' data — the operator should do it, not an auditor.
8. **Clerk account self-deletion is probably not enabled** (`docs/play-store-launch.md:11`), making R-28's duplicate-identity path routine rather than hypothetical.
9. **The Playwright workflow is probably red and ignored** (P2-26); nothing in the repo could make the sign-in test pass without Clerk env.
10. **`GroupBalancesModal:42` can produce `NaN`** when a share belongs to someone not in the `people` prop (a removed member); the exact UI sequence was not constructed.
11. **`allSettled` also defaults to `true` when no group is selected** (`App.tsx:131` returns `{}`); today `editingGroup` implies a selection, so unreachable — one refactor away.
12. **`transactions.type` may have no CHECK in production**; its migration guards on an unreliable `information_schema` probe. If absent, `type` is free text and the settlement/expense distinction is client fiction.
13. **`Intl.NumberFormat` throws on an invalid currency code**; `groups.currency` has no CHECK, so one bad row would crash every balance surface in that group.
14. **The member-display bug the docs "fixed" may actually be R-13's delete-window** rather than the read-side cause `MEMBER_DISPLAY_BUG_FIX.md` diagnoses; only one of the two was fixed.
15. **`user_profiles`** (Supabase-Auth era) is absent from the generated types — probably never created or dropped; nothing references it.
16. **`REPLICA IDENTITY FULL` on `people` may already be pushing avatar blobs at scale** on every name change; unmeasurable from here.
17. **`i_can_see_person` may already be a performance problem**: four correlated `EXISTS` per row, one calling another `EXISTS`-heavy function, with no functional index for the email lookup; nothing would show it (R-35).
