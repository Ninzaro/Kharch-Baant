# Post-audit remediation tracker

Last updated: 2026-09-18

Process: follow [`Master Guideline.md`](./Master%20Guideline.md). Work on one item at a time. Before implementation, document scope, exclusions, risks, decisions, and success criteria; wait for explicit approval; create and push a checkpoint; implement surgically; validate; record production evidence and commit IDs; then assess the next item.

Status meanings:

- `pending` — not started.
- `in progress` — assessment or implementation is active.
- `blocked` — cannot proceed without a named decision or external action.
- `complete` — implementation and required production validation are both recorded.

## Program status

| # | Workstream | Status | Completion evidence |
|---|---|---|---|
| 1 | Reconcile committed migrations against production | **complete** | All 34 timestamped migrations are present in production; live-state drift is classified below. Reconciliation was read-only. |
| 2 | Finish the three remaining money guarantees | **in progress** | 2A (M-09/M-10) implemented locally and validated; production migration and 2B (M-13) remain. |
| 3 | Close membership/ownership authorization gaps | pending | Ownership cannot be reassigned; transaction participants are group members; consent/leave semantics are explicitly decided and enforced. |
| 4 | Finish sign-out data cleanup and auth-failure UX | pending | Logout clears private client state; a second user cannot inherit it; auth failures do not render as empty data. |
| 5 | Add backup/restore and migration-state tracking | pending | Backup policy documented, one restore tested, and migration application has an authoritative repeatable workflow. |
| 6 | Make typecheck/tests clean, then gate Android deployment | pending | `npm run typecheck` and `npm run test:run` pass and both gate the Android publish job. |
| 7 | Add audit/history and durable rate limiting | pending | Append-only actor-attributed history and cross-isolate durable limits have tests and production evidence. |

## Item 1 — production reconciliation

### Success criteria

- Every canonical timestamped file in `supabase/migrations/` is classified as applied, missing, mismatched, superseded, or intentionally excluded.
- Production policies, RLS flags, functions, triggers, grants, constraints, replica identity, Realtime publication membership, and Edge Functions are compared with repository intent.
- Drift is recorded before any corrective migration is proposed.
- Read-only reconciliation queries make no production changes.

### Evidence

| Check | Status | Evidence |
|---|---|---|
| Repository migration inventory | complete | 34 timestamped migrations plus non-ledger `CLERK_AUTH_MIGRATION.sql`. |
| Production migration ledger | complete | 34 entries through `20260917212313_preserve_placeholder_on_person_email_collision`. |
| Migration version/name comparison | complete | Exact 34/34 version-and-name match through `20260917212313_preserve_placeholder_on_person_email_collision`; no timestamped migration is missing or extra. `CLERK_AUTH_MIGRATION.sql` is historical/non-ledger and intentionally excluded. |
| Tables, columns, PK/FK constraints, and RLS | complete | Nine public tables inspected. RLS is enabled on all nine; `FORCE ROW LEVEL SECURITY` is off. Authorship and money constraints are live. Legacy identity/source columns remain and are classified below. |
| Policies and policy expressions | complete | Live policy commands, roles, `USING`, and `WITH CHECK` expressions inspected. Known ownership and membership gaps are assigned to Item 3. |
| Functions, security mode, definitions, and execute grants | complete | All 21 public functions inventoried. Suspicious SECURITY DEFINER definitions and effective `anon`/`authenticated` execute privileges were checked directly with `has_function_privilege`. |
| Triggers and table constraints | complete | Eight enabled non-internal triggers confirmed through `pg_trigger`; FK, check, and unique constraints inspected. |
| Replica identity and Realtime publication | complete | All application tables use default replica identity. Realtime publishes `group_members`, `groups`, `payment_sources`, `people`, and `transactions`. |
| Edge Functions and JWT settings | complete | `send-email` v6 and `suggest-tag` v6 require gateway JWT verification; `native-bridge` v9 intentionally uses custom Clerk verification with gateway JWT verification off. Deployed source was inspected. |
| Security/performance advisors | complete | Security and performance advisors captured. Relevant findings are classified below; Clerk makes the Supabase leaked-password warning inapplicable. |
| Drift report and disposition | complete | No production mutation was made. Each mismatch is assigned to a later workstream or an explicit deployment follow-up. |

### Reconciliation result

The migration ledger is exact, but ledger presence alone does not prove that later dashboard edits, grants, or Edge deployments match repository intent.

| Severity | Live-state finding | Evidence | Disposition |
|---|---|---|---|
| high | Production `send-email` is stale. | The deployed function still contains `member_added`, `settle_up`, and `new_expense`; the repository function accepts only `group_invite`. | Redeploy the current repository function as a separately approved production action. Do not combine with a database migration. |
| high | Anonymous callers retain direct `people` insert privilege. | `authenticated` has no INSERT privilege after R-20, but `anon` still does; the public INSERT policy accepts an unclaimed row with a null Clerk id. | Authorization containment follow-up under Item 3. Revoke only after checking the placeholder RPC path. |
| high | Execute grants do not match the R-20/R-21-era least-privilege intent. | `i_am_person(uuid)` has a direct `anon` grant even though its migration revoked `PUBLIC`; `set_transaction_author()` has both `PUBLIC` and direct `anon` grants. Effective privilege checks return true for `anon`. | Create a surgical grant-cleanup migration under Item 3 after enumerating every policy/trigger dependency. |
| medium | Obsolete Supabase-Auth helper survives outside the canonical ledger. | `get_current_user_person_id()` is SECURITY DEFINER, uses `auth.uid()`/`people.auth_user_id`, has no fixed `search_path`, and is executable by `PUBLIC`, `anon`, and `authenticated`. Its source is only in historical `migrations/`, not canonical timestamped migrations. | Remove only after dependency search and production usage check; track with Item 3. |
| medium | Group ownership can still be reassigned by an allowed update. | The `groups` UPDATE policy has creator-only `USING` but no ownership-preserving `WITH CHECK`. | Item 3. |
| medium | Membership creation remains broader than the intended ownership boundary. | A current member can insert `group_members` rows without a database constraint tying the added person to an approved invite/consent flow. | Item 3; requires the consent/leave decision before implementation. |
| medium | Exact-cent enforcement is not live. | The money invariant function accepts differences below `0.01` for unequal splits, percentages, and payers. | Item 2 / M-13. |
| low | Removed deletion-request UI left a locked table behind. | `group_deletion_requests` has RLS enabled and no policies; deletion now uses the `delete_group(uuid)` RPC. | Safe deny-all state. Decide removal separately; no action in Item 1. |
| low | Legacy identity/source columns and an `auth.users` FK remain. | `people.auth_user_id`, `people.user_id`, `payment_sources.created_by`, and `payment_sources.user_id` are live. | Schema-debt review only; do not remove without a data and code dependency audit. |
| advisory | Supabase reports mutable function search paths, exposed SECURITY DEFINER functions, unindexed FKs, one RLS init-plan warning, and unused indexes. | Captured from the production security/performance advisors on 2026-09-18. | Address only when the owning workstream reaches them; unused-index notices alone do not authorize deletion. |

### Git

- Checkpoint: `6750a7a`
- Reconciliation record: `fc03766`

## Item 2 — remaining money guarantees

- M-09: design durable idempotency for transaction and settlement creation.
- M-10: reject duplicate settlements in addition to the existing cap, prefill, and update CAS.
- M-13: replace the `< 0.01` acceptance window with exact minor-unit validation.

### Stage 2A — M-09 and M-10

Status: production deployed and verified; Stage 2B remains pending.

- Expense and settlement submissions retain a client-generated transaction UUID across an identical retry.
- Direct expense inserts return the existing matching row on a primary-key retry and reject UUID reuse with different content.
- New settlements use `settle_up(...)`, which locks the group and its transaction rows, checks the client balance snapshot, rejects overpayment, and returns an existing matching settlement for an idempotent retry.
- Existing settlement edits retain their `updated_at` compare-and-swap path.
- Production was queried read-only to confirm the RPC balance CTE executes against current transaction shapes; the migration was not applied.
- Production deployment recorded two ledger entries for the same idempotent function because the first call completed after its permission-review timeout and the permitted retry also succeeded. The duplicate ledger history is preserved and assigned to Item 5 reconciliation.
- Supabase default privileges granted `anon` direct EXECUTE despite the original `PUBLIC` revocation; follow-up migration `20260918185837_restrict_settle_up_execute.sql` explicitly revokes both. It is a fresh-install no-op until `settle_up` exists; the canonical function migration now performs the same explicit revocation.
- Live verification: `settle_up` is SECURITY DEFINER with an empty `search_path`, contains the locking/stale-balance/overpayment checks, is executable by `authenticated`, and is not executable by `anon`.

Validation:

- `npm run test:run` — 20 files and 129 tests passed.
- `npm run build` — passed.
- `npm run typecheck` — still fails on the pre-existing repository baseline tracked by Item 6; no new 2A error remained after the focused correction.

Git:

- Checkpoint: `9dfb2f8`
- Implementation: `9f56625`

### Stage 2B — M-13

Status: implemented in the repository; production deployment remains pending separate approval.

- Transaction, unequal-split, and payer amounts are rejected when they contain sub-cent precision; they are no longer silently rounded on write.
- Unequal splits and payer arrays must sum to the transaction amount in exact minor units.
- Percentage splits must total exactly 100; percentage values remain ratios and are not restricted to two decimals.
- The database amount column preserves four decimals so its constraint and trigger can reject sub-cent input before PostgreSQL rounds it.
- Production preflight found 5 transactions and no sub-cent amounts or inexact split/payer totals, so no data repair is expected.

## Item 3 — membership and ownership authorization

- Protect `groups.created_by` with database `WITH CHECK` semantics.
- Require `paid_by_id`, `payers[].personId`, and `split_participants[].personId` to belong to the transaction's group.
- Decide and then implement membership consent and non-creator leave behavior.

## Item 4 — logout and auth failures

- Clear TanStack Query data, pending invite state, and selected group on logout.
- Keep the synchronized WebView/native Clerk logout already implemented.
- Render token/profile-sync failure separately from a legitimate empty account.

## Item 5 — recovery and migration operations

- Confirm PITR availability and retention, or define an independent scheduled backup.
- Perform and record one restore exercise.
- Replace dashboard paste-and-hope administration with an authoritative migration workflow.

## Item 6 — release gates

- Fix the existing TypeScript baseline without unrelated refactors.
- Fix the existing `SettleUpModal` test failure.
- Run unit tests and typecheck before `bundleRelease` and Play upload.

## Item 7 — audit and rate limits

- Add append-only transaction history with actor and timestamp attribution.
- Define retention and authorized visibility for audit rows.
- Replace per-isolate Edge `Map` limits with durable shared enforcement on sensitive operations.
