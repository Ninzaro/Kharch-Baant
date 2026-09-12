# Pass 1.3 dead-code tracker

Last updated: 2026-09-12

Process: the parent implements a finding **only** after the user names an ID and says go ahead. This tracker is updated **only** when told a finding’s status changed. Source of truth for descriptions remains [`audit/03-deadcode.md`](./03-deadcode.md) §9.

| ID | Sev | One-line | Status | Notes |
|---|---|---|---|---|
| D-01 | P1 | Home card and Balances modal ignore `payers[]`, showing balances up to 5x wrong | completed | This session: `GroupSummaryCard` + `GroupBalancesModal` use `calculateGroupBalances`; tests added; commits on main |
| D-02 | P1 | `App.tsx` imports `toast` twice — ES module early SyntaxError | completed | This session: duplicate toast import + unused Capacitor import removed from `App.tsx` |
| D-03 | P1 | `groups.created_by` is a person UUID; four `i_created_group` versions, two reject it | completed | This session: C1 `people.id` + FK `groups_created_by_fkey` ON DELETE RESTRICT + `i_created_group` JOIN people; SQL applied in production (user confirmed `prosrc` + `constraintdef`) |
| D-04 | P1 | Eight `USING (true)` `*_all` policies from `HOTFIX_reset_all_policies.sql` are dropped nowhere | completed | Live `pg_policies`: zero `*_all` rows. User deleted `migrations/HOTFIX_reset_all_policies.sql` (checkpoint `05ba07e`). No DROP migration added. |
| D-05 | P1 | `group_deletion_requests`: RLS on, zero policies, six call sites, JS-only admin check | completed | Option B: request/approve UI and client APIs removed. Creator-only Delete Group. Table left in DB. Group report parked in `docs/features-to-be-added.md`. |
| D-06 | P1 | Email normalisation asymmetry creates permanently unclaimable duplicate people | completed | Live: 0 mixed-case / 0 collisions. Migration `20260912000002` (both-sides match + trigger + unique on lower(trim(email))); fallback insert lowercases. Apply SQL in dashboard. |
| D-07 | P2 | Canonical docs describe a modal system (`useModals` + `ModalContext`) with zero importers | completed | Option B: deleted `useModals.ts`, `useModals.test.ts`, `ModalContext.tsx`. AGENTS.md + ARCHITECTURE.md now describe App.tsx `useState`. |
| D-08 | P2 | `ARCHITECTURE.md` tells the next assistant to delete a live `ErrorBoundary` | completed | Docs: custom `ErrorBoundary` is the live `index.tsx` wrapper. Do not delete. |
| D-09 | P2 | Two documents give opposite orders about RLS | completed | Deleted `GROUP_CREATION_ERROR_FIX.md`, `AUTH_IMPLEMENTATION_SUMMARY.md`, `AUTH_IMPLEMENTATION_PLAN.md`. AGENTS: never run disable-RLS / supabase-auth-setup SQL. `play-store-launch.md` Google path still stale. |
| D-10 | P2 | `MULTI_USER_EXPERIENCE.md` states the app has no data privacy between users | completed | Deleted `MULTI_USER_EXPERIENCE.md` (false “no auth / no privacy” claim). Clerk + RLS unchanged. |
| D-11 | P2 | `SETTLEMENT_RULES_AND_BALANCES.md` has settlement direction inverted | completed | Deleted inverted doc. Code unchanged. |
| D-12 | P2 | Five documents instruct putting API secrets in `VITE_*` variables | completed | README/ENV_SETUP/DEPLOYMENT/MIGRATION corrected; three MAILERSEND howtos deleted. |
| D-13 | P2 | PWA update prompt was never built; users pinned to a stale build | completed | B: prompt + `updateSW(true)`. Icons: PNG 192/512 + apple-touch 180 from existing SVG; deleted 0-byte `manifest.webmanifest`; `includeAssets` only real files. Runtime-cache supabase host still unused (mention-only). |
| D-14 | P2 | Settings “Import Data” reports success and does nothing | pending | skipped this pass |
| D-15 | P2 | `InvitePage` signed-in half is unreachable; two accept paths | completed | Removed dead signed-in/auto-accept. Guest SignIn + `App.tsx` accept remain. |
| D-16 | P2 | `deleteGroup` vs `approveGroupDeletion`; approval audit write is a no-op | completed | `approveGroupDeletion` already removed in D-05 B. |
| D-17 | P2 | Seven `formatCurrency` implementations; expense list rounds money away | completed | `TransactionItem` now 2 fraction digits. Other formatters left. |
| D-18 | P2 | Client validation and persistence disagree in `shares` mode | completed | Shares persist `p.value` (0 stays 0). |
| D-19 | P2 | `email_invites UNIQUE(group_id, email)` blocks re-inviting anyone forever | completed | Migration `20260912000003`: unique is `(group_invite_id, email)`. Apply in dashboard. |
| D-20 | P2 | `group_deletion_requests UNIQUE(group_id)` bricks the feature after one request | completed | Same migration: partial unique pending-only. Request UI still gone (D-05). Apply in dashboard. |
| D-21 | P2 | CI never exports the Clerk key into the Gradle step | pending | §9 |
| D-22 | P2 | `assetlinks.json` does not exist, so Android App Links cannot verify | pending | §9 / §6.1 |
| D-23 | P2 | `numeric(12,2)` silently doubles sub-paisa amounts | pending | §9 / §8.11 |
| D-24 | P2 | Duplicate Supabase auth-token injection (`accessToken` + `global.fetch`) | pending | §9 / §2.10 |
| D-25 | P2 | Playwright can write to production with no guard | pending | §9 / §6.10 |
| D-26 | P2 | No typecheck, no lint, and unit tests never run in CI | pending | §9 / §6.5 |
| D-27 | P3 | 2,961 LOC of orphaned code, 1,009 of it tests for dead code | pending | §9 / §1.1 |
| D-28 | P3 | 19 dead exports inside live files | pending | §9 / §1.3 |
| D-29 | P3 | 55 lines of dead email logic cost 3 DB reads on every expense | pending | §9 / §2.7 |
| D-30 | P3 | Dead dependencies and misplaced prod deps | pending | §9 / §5.1–§5.4 |
| D-31 | P3 | Dead DB objects and duplicated indexes | pending | §9 / §1.4, §8.10 |
| D-32 | P3 | 20 of 46 root markdown files actively contradict the code | pending | §9 |
