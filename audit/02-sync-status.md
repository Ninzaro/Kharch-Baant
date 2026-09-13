# Pass 1.2 sync tracker

Last updated: 2026-09-13

Process: parent implements only after user names a batch and says go ahead.

Source of truth for findings: [`audit/02-sync.md`](./02-sync.md). This file is the durable board — open it instead of scrolling chat.

Standing job: when the parent reports a batch complete, update **Status** here. Do not implement product code from this tracker.

## Status

| Batch | IDs | Status | Notes |
|---|---|---|---|
| 1. Resume | S-06, S-09 | **done** | Commit `148272e` on main. Checkpoint `a3f0eda`. Resume: skipCache JWT then setRealtimeAuth then invalidateQueries. Triggers: visibilitychange, online, Capacitor appStateChange. Live badge = five public:* data channels joined. JWT interval still 50s. Review: see [`audit/02-sync-review-batch1.md`](./02-sync-review-batch1.md) if present. |
| 2. Expense write | S-04 + S-07 + S-22 | **done** | Cache prepend + submitting + toast/Sentry. Payment-source/delete errors not in this batch. |
| 3. DELETE leak | S-02 (R-05) | **done** | Client: INSERT/UPDATE only. SQL: REPLICA IDENTITY DEFAULT (apply in dashboard). |
| 4. Broadcast | S-11 + S-12 + S-01 + S-14 OR delete | **done (A)** | Deleted `tx` publish/listen. `deleteTransaction(groupId?)` param kept unused. |
| 5. Membership | S-03 + S-08 + S-19 | **done** | Diff vs open snapshot + fresh SELECT; INSERT then DELETE; people invalidate; groups INSERT refetches. |
| 6. Destructive / phantoms | S-21 + S-13 + S-05 | **done (A)** | Refetch-or-abort; archive honest 0-row throw; remaining write paths still unchecked. |
| 7. Leftovers | S-10, S-15, S-18, S-20 | **done** | updatedAt CAS + follow-up GET; cancelled+removeChannel; emoji errors throw; runtimeCaching removed. |

## Original grouping (Why together / Notes)

| Batch | IDs | Why together | Notes |
|---|---|---|---|
| 1. Resume | S-06, S-09 | Same resume path: reconcile missed WAL, then show whether data channels are actually joined. S-06's correct fix already names S-09. | skipCache JWT → `setRealtimeAuth` → `invalidateQueries`. Triggers: `visibilitychange`, `online`, Capacitor `appStateChange`. Live badge = five `public:*` data channels joined. JWT interval stays 50s. **Shipped** (`148272e`; checkpoint `a3f0eda`). |
| 2. Expense write | S-04 + S-07 + S-22 | One mutation path: local cache write, in-flight Save guard, visible failure (toast + Sentry). Audit landing order 1. | Writer-side headline. Do not split; S-04 without S-07 still double-posts; S-07 without S-22 still fails silently. |
| 3. DELETE leak | S-02 (R-05) | Single P0: unfiltered `postgres_changes` DELETE + `REPLICA IDENTITY FULL`. | Containment: `REPLICA IDENTITY DEFAULT` on tables whose handlers use only `old.id`, or drop DELETE subscriptions (INSERT/UPDATE only). Deletions then wait on refetch — **S-06 must already be live** (it is). |
| 4. Broadcast | S-11 + S-12 + S-01 + S-14 **or delete the broadcast** | Public `public:transactions` + unscoped invalidate + unwired listener + module singleton. Wiring S-01 alone turns on amplification. | Private/scoped channel **and** scoped invalidate, **or** delete broadcast (`_txPublishChannel`) and leave postgres_changes + resume. Do not ship S-01 by itself. |
| 5. Membership | S-03 + S-08 + S-19 | All three are roster/cache: replace-all membership, people cache never invalidated, INSERT bridge with empty members. | Diff membership instead of delete-and-reinsert; invalidate `people` on membership change; populate members on group INSERT. |
| 6. Destructive / phantoms | S-21 + S-13 + S-05 | Silent success / cache ahead of the server: stale “all settled”, archive that cannot succeed, writes with no affected-row check. | Assert affected rows; stop treating RLS/no-op as success; do not gate destroy on a client-computed settled flag from a possibly-stale cache. |
| 7. Leftovers | S-10, S-15, S-18, S-20 | Remaining P2/P3 debt; no shared code path that requires a joint ship. | Last-write-wins edits; StrictMode channel death in dev; cute-icons N-update storm; inert PWA host rule. **S-16 / S-17 already closed as D-05** (deletion-request UI/API removed). |

## Batch 1 checkpoint (done)

- Commit `148272e` on `main`; checkpoint `a3f0eda`.
- Resume order: skipCache JWT → `setRealtimeAuth` → `invalidateQueries`.
- Triggers: `visibilitychange`, `online`, Capacitor `appStateChange`.
- Live badge = five `public:*` data channels joined.
- JWT refresh interval still 50s.
- Reviewer output: [`audit/02-sync-review-batch1.md`](./02-sync-review-batch1.md) (file may not exist until the reviewer writes it).

## Next

Wait for the user to name a pending batch and say go ahead. Default next is **batch 2 (Expense write: S-04 + S-07 + S-22)**.
