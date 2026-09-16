# Pass 1.2 — Cross-Device Sync & Realtime

Audit date: 2026-09-07. Read-only. Repo: `Kharch-Baant-main`.
Founder's reported symptom: *"device A makes a change, device B does not reflect it."*

Every claim below cites `path:LINE-LINE` and carries a confidence tag:
**CONFIRMED** (read end to end in this repo) · **LIKELY** (one unverifiable gap) · **SUSPECTED** (pattern-matched only).
`node_modules/` is absent, so all library-internals claims are backed by version-pinned source fetched from GitHub
(`@supabase/realtime-js` **2.15.5**, `@supabase/supabase-js` **2.58.0**, `@tanstack/query-core` **5.90.6` — versions from
`package-lock.json`) and are marked LIKELY, not CONFIRMED, because the fetched tag is not byte-verified against the
installed tree.

---

## 1. What is the mechanism today?

### 1.1 The complete inventory of propagation mechanisms

There are **five** distinct mechanisms. Only one of them is a real cross-device push, and it has no backstop.

| # | Mechanism | Where it lives | What it actually does |
|---|---|---|---|
| M1 | Supabase Realtime `postgres_changes`, `event:'*'`, **no filter**, on 5 tables | `services/supabaseApiService.ts:389-475` → `services/queries.ts:48-217` → mounted `App.tsx:78-82` | The only genuine cross-device push. |
| M2 | Supabase Realtime **`broadcast`** event `tx` on topic `public:transactions` | published `services/supabaseApiService.ts:479-487`; *intended* consumer `services/queries.ts:107-109` | **Dead.** Published on every tx write, consumed by nobody — see §1.3. |
| M3 | Custom DOM event `groupMemberAdded` | dispatched `components/GroupFormModal.tsx:461-465`, handled `App.tsx:281-301` | Same-tab only. Not cross-device, not cross-tab. |
| M4 | Manual `setQueryData` / `invalidateQueries` after an `await` | `App.tsx:338,352,388,395,443,464-465,511,523,525,547,568,791,796`; `App.tsx:224`; `components/invite/InvitePage.tsx:129,278`; `components/SettingsModal.tsx:60-67` | Writer-local only. Never optimistic (always post-await). |
| M5 | Component-local `useState` refresh | `components/AdminDeletionRequestsPanel.tsx:34-45,65,81`; `components/ArchivedGroupsModal.tsx:16-23,52` | Not in the TanStack cache at all; invisible to every other view. |

### 1.2 What is NOT present (all CONFIRMED by exhaustive grep)

- **No refetch on window focus.** `lib/queryClient.ts:8` — `refetchOnWindowFocus: false`, explicitly disabled with the
  comment "avoid surprise reloads when tab focus changes".
- **No `visibilitychange` / `pageshow` / `resume` handler anywhere.** Grep for `visibilitychange|pageshow|freeze|resume`
  across `App.tsx components/ hooks/ services/ contexts/ lib/` returns zero hits. `hooks/useBackButton.ts` registers
  `click`, `touchstart`, `popstate` and a Capacitor `backButton` listener (`hooks/useBackButton.ts:19,49,50,69`) —
  none of them is a resume hook.
  `index.tsx:44-46` registers a Capacitor `appStateChange` listener whose entire body is `console.log`.
- **No polling.** No `setInterval` anywhere that refetches data. The only interval in the app is the 50 s Realtime-JWT
  refresh (`contexts/SupabaseAuthContext.tsx:67-74`).
- **No persisted query cache.** `lib/queryClient.ts` has no persister; `store/appStore.ts:26-29` persists only
  `selectedGroupId` and `theme`. A reload refetches everything from scratch.
- **No reconnect backfill written by this app.** The only reconnect refetch is TanStack's built-in
  `refetchOnReconnect` (default `true`, not overridden) — see §5 for why that almost never fires here.
- **No `useMutation` anywhere.** `services/queries.ts:2` imports `useMutation` and never calls it. Grep across the whole
  repo: zero `useMutation(` call sites. Therefore `lib/queryClient.ts:11-13` (`mutations.retry: 1`) is dead
  configuration, and there is no mutation cache, no `onError` rollback, no `onSettled` invalidation. CONFIRMED.
- **No optimistic updates.** Every cache write happens *after* `await` resolves. See §8.
- **No version / sequence / `updated_at` comparison.** See §6.
- **No server-side balance.** No balance table, view, or RPC anywhere in `supabase/migrations/` or `migrations/`.
  Balances are recomputed on every render from the client's `transactions` cache
  (`App.tsx:131-135` → `utils/calculations.ts:4-23`). CONFIRMED.

### 1.3 M2 (the `tx` broadcast) is wired to nothing — the fallback does not exist

This is the single most consequential defect in this pass, and it is one line.

`services/queries.ts:92-110` calls the subscribe helper with **three** arguments:

```ts
// services/queries.ts:92-110
const pgSub = api.subscribeToTransactions(
  personId,
  (payload: any) => { /* postgres_changes handler */ },
  (_groupId: string) => {
    qc.invalidateQueries({ queryKey: qk.transactions(personId) })
  },
)
```

`api` is `import * as api from './apiService'` (`services/queries.ts:3`). The façade in `apiService` accepts and
forwards only **two**:

```ts
// services/apiService.ts:15
export const subscribeToTransactions = (personId: string, callback: (payload: any) => void) => supabaseApi.subscribeToTransactions(personId, callback);
```

The real implementation registers the `broadcast` listener **only if `onBroadcast` is truthy**
(`services/supabaseApiService.ts:422-426`). Because the façade drops it, `onBroadcast` is always `undefined`, the
`.on('broadcast', { event: 'tx' }, …)` binding is **never created**, and every `tx` broadcast published by
`_broadcastTxChange` (`services/supabaseApiService.ts:481-487`, called at `:565`, `:658`, `:694`) arrives at every
other client's socket and is discarded.

Why nothing caught it: TypeScript would reject the 3-argument call with TS2554, but there is no `tsc` in CI
(`.github/workflows/*` build with Vite/esbuild only, and `package.json` has no `typecheck` script), and esbuild strips
types without checking them. Confidence: **CONFIRMED** (both files read end to end; grep shows `subscribeToTransactions`
has exactly these three definitions/call sites).

Consequence: the comment at `services/supabaseApiService.ts:564` — *"Notify other group members via broadcast (bypasses
postgres_changes RLS filtering)"* — describes a safety net that does not exist. The system is **single-path**:
if `postgres_changes` misses an event, nothing else will ever deliver it.

### 1.4 Channel topology — six channels, one socket

`supabase.channel(topic)` in realtime-js 2.15.5 **dedupes by topic** (LIKELY — source fetched from tag `v2.15.5`):

```ts
const realtimeTopic = `realtime:${topic}`
const exists = this.getChannels().find((c) => c.topic === realtimeTopic)
if (!exists) { const chan = new RealtimeChannel(...); this.channels.push(chan); return chan } else { return exists }
```

So the app holds exactly **six** channels on one WebSocket:

| Topic | Bindings | Created at |
|---|---|---|
| `public:groups` | `postgres_changes *` on `groups` | `supabaseApiService.ts:390-399` |
| `public:transactions` | `postgres_changes *` on `transactions` (broadcast binding never added — §1.3) | `supabaseApiService.ts:409-428` |
| `public:payment_sources` | `postgres_changes *` on `payment_sources` | `supabaseApiService.ts:434-445` |
| `public:people` | `postgres_changes *` on `people` | `supabaseApiService.ts:451-462` |
| `public:group_members` | `postgres_changes *` on `group_members` | `supabaseApiService.ts:468-473` |
| `heartbeat` | **none** — status callback only | `components/RealtimeStatus.tsx:11-26` |

Because of topic dedupe, `_broadcastTxChange`'s `supabase.channel('public:transactions')`
(`supabaseApiService.ts:483`) returns **the same object** the transactions bridge already created and joined.
`_txPublishChannel.subscribe()` at `:484` is therefore a no-op (in 2.15.5 `subscribe()` guards on
`this.state == CHANNEL_STATES.closed` and returns early otherwise — LIKELY, source fetched; note that *older*
realtime-js threw "tried to subscribe multiple times" here, so this line is a latent upgrade hazard). `.send()` then
pushes over the already-joined WebSocket. Broadcast `self` defaults to `false`
(`RealtimeChannel` constructor: `broadcast: { ack: false, self: false }` — LIKELY), so the writer never receives its own
`tx` event; combined with §1.3, **nobody** receives it.

### 1.5 Realtime authentication

- `lib/supabase.ts:66-70` sets `realtime.params.apikey = <anon key>` — the socket connects with the anon key.
- `lib/supabase.ts:85-90` `setRealtimeAuth(token)` → `supabase.realtime.setAuth(token)`.
- Called at login **before** the person is resolved (`contexts/SupabaseAuthContext.tsx:49-51`, deliberately — see the
  comment at `:45-48`), then on a 50 s interval (`:67-74`), then with `null` on sign-out (`:83`, `:102`).
- `lib/supabase.ts:51-54` also passes `accessToken: async () => …` to `createClient`. In supabase-js 2.58.0 that value
  is forwarded to the RealtimeClient as `accessToken: this._getAccessToken.bind(this)` (LIKELY, source fetched), and
  `_listenForAuthEvents()` is **skipped** when a custom `accessToken` is supplied. Net effect (LIKELY): the socket
  re-fetches a fresh Clerk JWT on every `connect()` via `_setAuthSafely('connect')`, which is *better* than the
  50 s timer alone — but only on a **socket** reconnect, not on a channel-level error.
- `_performAuth` only pushes `access_token` to channels when the token string actually changed
  (`if (this.accessTokenValue != tokenToSend)`) and only to channels where `channel.joinedOnce && channel._isJoined()`
  (LIKELY, source fetched). A channel sitting in `errored`/`joining` state gets nothing.

---

## 2. Subscription authorization

Reported separately from HTTP, as instructed.

### 2.1 Can a client subscribe to a table channel for a group it does not belong to?

**Yes — subscription is unconditional; only per-event *delivery* is filtered, and only for INSERT/UPDATE.**

All five `postgres_changes` bindings use `{ event: '*', schema: 'public', table: '<t>' }` with **no `filter`**
(`supabaseApiService.ts:391, 411, 436, 453, 470`). Nothing scopes them to the user's groups. Joining
`realtime:public:transactions` always succeeds; Supabase then evaluates the table's RLS `SELECT` policy per WAL record
per subscriber.

Supabase docs (fetched 2026-09-07, `https://supabase.com/docs/guides/realtime/postgres-changes`):
> "Postgres Changes authorizes every event against each subscriber."

So for INSERT/UPDATE on `transactions`, delivery requires
`i_created_group(group_id) OR i_am_member_of(group_id)` (`supabase/migrations/20260412000005_use_clerk_user_id_in_rls.sql:143-144`),
evaluated through `requesting_user_id()` = `current_setting('request.jwt.claims')::jsonb->>'sub'`
(`supabase/migrations/20260412000006_fix_requesting_user_id.sql:17-22`). That part is correct. **CONFIRMED** (policies
read; delivery semantics LIKELY, per vendor docs).

### 2.2 DELETE events are broadcast to every subscriber with no RLS filtering

Same vendor page, verbatim:

> "**Caution:** RLS policies are not applied to `DELETE` statements, because there is no way for Postgres to verify that
> a user has access to a deleted record."

And `migrations/enable_realtime.sql:5-9` sets `REPLICA IDENTITY FULL` on all five tables, which means the `old_record`
payload carries **every column of the deleted row**, not just the primary key.

Combine those two facts with §2.1 (unfiltered subscriptions, any authenticated user can join
`realtime:public:transactions`) and the result is:

> **Every signed-in client of this app receives the full contents of every row deleted from `transactions`, `groups`,
> `group_members`, `people` and `payment_sources` across the entire database — every tenant, every group.**

For `transactions` that is `description`, `amount`, `group_id`, `paid_by_id`, `payers`, `date`, `comment`,
`split_participants`, `payment_source_id`. For `people` it is `name`, `email`, `avatar_url` (a base64 data URL),
`clerk_user_id`. Confidence: **LIKELY** (policies + `REPLICA IDENTITY FULL` migration are CONFIRMED in-repo; the
"RLS not applied to DELETE" behaviour is quoted vendor doc, and whether `enable_realtime.sql` was applied to
production is unverifiable — see §15).

The bridges do not *display* this data (they only `.filter(t => t.id !== old.id)`), but it is in the browser's memory
and visible in DevTools' WS frame inspector to anyone who opens it. It is also actively *used* for control flow in one
place — `services/queries.ts:194-205` — which turns the leak into a functional bug (see §3.6 and finding S-02).

### 2.3 Can an anonymous client subscribe to `public:transactions` and send/receive `tx` broadcasts?

**Yes.** Vendor doc (`https://supabase.com/docs/guides/realtime/broadcast`, fetched 2026-09-07):

> "Anyone can subscribe to that topic without authentication."

Nothing in the repo sets `config: { private: true }` on any channel — grep for `private` in
`services/supabaseApiService.ts` and `components/RealtimeStatus.tsx` returns nothing; all six channels are created with
the default (public) config (`supabaseApiService.ts:390,410,435,452,469`, `RealtimeStatus.tsx:11`).
Whether Realtime Settings → "Allow public access" is still enabled on the production project cannot be read from the
repo (§15), but the *client* makes no attempt to use private channels.

If public access is on, then anyone holding the anon key — which ships in the JS bundle, `vite.config.ts:145-147`
inlines `VITE_SUPABASE_ANON_KEY` — can:
1. join `realtime:public:transactions` and read every `tx` broadcast, harvesting a live stream of **group UUIDs**
   system-wide (payload is `{ groupId }`, `supabaseApiService.ts:486`); and
2. *send* `{type:'broadcast', event:'tx', payload:{groupId:'…'}}` on the same topic.

Item 2 would, in a correctly wired app, force every connected client to run a full `getTransactions` refetch
(`queries.ts:107-109`) — a one-packet amplification DoS. **In the current build it is inert only because of the bug in
§1.3.** Fixing the façade bug without also making the channel private would *create* this DoS. Confidence:
**LIKELY** (client side CONFIRMED; server-side "Allow public access" state unverifiable).

### 2.4 Summary table

| Question | Answer | Confidence |
|---|---|---|
| Can any signed-in user subscribe to any table channel? | Yes — no filter, no private channel | CONFIRMED (client) |
| Are INSERT/UPDATE events RLS-filtered per subscriber? | Yes | LIKELY (vendor doc) |
| Are DELETE events RLS-filtered? | **No** — full old row goes to every subscriber | LIKELY (vendor doc, explicit) |
| Can anon (apikey only) join `public:transactions`? | Yes if "Allow public access" is on (default) | LIKELY |
| Can anon *send* a `tx` broadcast? | Yes, same condition | LIKELY |
| Is the HTTP path RLS-protected? | Yes, separately, via PostgREST + the same policies | CONFIRMED (policies read) |

---

## 3. Write → broadcast path, mutation by mutation

Legend for "emits": **PG** = a `postgres_changes` event the app subscribes to; **BC** = a `tx` broadcast (dead, §1.3);
**DOM** = the `groupMemberAdded` window event (same-tab only); **—** = nothing.

### 3.1 Add expense (`App.tsx:353-356`)

UI `TransactionFormModal.handleSubmit` (`components/TransactionFormModal.tsx:283-364`) → `onSave` →
`App.handleSaveTransaction` (`App.tsx:347-362`) → `apiService.addTransaction` (`apiService.ts:22`) →
`supabaseApiService.addTransaction` (`:537-624`) → `POST /rest/v1/transactions?select=*` → RLS
`WITH CHECK (i_created_group OR i_am_member_of)` → row returned → `_broadcastTxChange(groupId)` (`:565`, dead) →
2–3 pointless extra reads for a commented-out email block (`:568-621`) → returns.

`App.tsx:353-355` deliberately **does not write the cache**:

```ts
} else if (selectedGroupId) {
    // Just add to DB; realtime bridge will update cache for all users consistently
    await api.addTransaction(selectedGroupId, transactionData);
}
```

So **the writer's own screen depends on the same realtime round-trip as everyone else's.** If PG delivery is broken for
any reason, the user taps Save, the modal closes (`:357`), and the expense is simply absent from the list until reload.
`catch` at `:359-361` is `console.error` only — no toast, no Sentry capture.

Emits: **PG INSERT** (+ dead BC). Reaches other devices: only via PG.

### 3.2 Edit expense (`App.tsx:350-352`)

`updateTransaction` (`supabaseApiService.ts:626-660`) builds a partial `updateData` — only the fields that are
`!== undefined` — then `.update().eq('id').select().single()`. `.single()` means an RLS-denied update surfaces as
PGRST116, so this one fails loudly. Writer's cache is patched post-await (`App.tsx:352`). Emits **PG UPDATE** + dead BC.

Note `split` and `payers` are sent as **whole objects** (`:643-646`, `:635`) — see §10.

### 3.3 Delete expense (`App.tsx:333-345`)

`deleteTransaction` (`supabaseApiService.ts:686-696`) is `.delete().eq('id', …)` with **no `.select()` and no count
check**. PostgREST returns 204 with zero rows affected when RLS filters the row out — *no error*. `App.tsx:337-338`
then unconditionally removes it from the cache. See §8.3 (phantom deletion).

Emits: **PG DELETE** (unfiltered — §2.2) + dead BC.

### 3.4 Settle-up create / edit (`App.tsx:788-801`)

Create: `addTransaction` then **immediately** `setQueryData` prepending the row (`:794-798`) — the only path that
updates the writer's own UI without waiting for realtime. Edit: `updateTransaction` then `setQueryData` map-replace
(`:790-791`). Both emit **PG INSERT/UPDATE** + dead BC.

The asymmetry with §3.1 is the clearest single symptom in the app: **settlements appear instantly on the writer's
screen, expenses do not.**

### 3.5 Add group (`App.tsx:441-467`)

`addGroup` (`supabaseApiService.ts:168-217`) = two unrelated statements: `INSERT INTO groups … RETURNING *` then
`INSERT INTO group_members` (N rows). Writer's cache appended post-await (`App.tsx:443-446`) with a
timeout-0 re-check and an invalidate/refetch fallback (`:454-467`).

Emits: **PG INSERT on `groups`** (delivered to a member only if the `group_members` row already exists — it does not
yet, so `i_am_member_of(id)` is false at the moment the `groups` INSERT hits the WAL; the only other clause is
`created_by = requesting_user_id()`, which is the creator's person UUID, so **other members do not receive the `groups`
INSERT**) and **PG INSERT on `group_members`** (which *does* reach them, and `queries.ts:186-191` invalidates
`groups` + `transactions` for the person whose row it is). So the new group reaches other members via the
`group_members` bridge, not the `groups` bridge. LIKELY (RLS evaluation order against WAL timing is inferred).

### 3.6 Edit group — the member delete-and-reinsert storm

`updateGroup` (`supabaseApiService.ts:326-373`) does three statements with **no transaction**:

1. `UPDATE groups SET … WHERE id = ? RETURNING *` (`:337-342`)
2. `DELETE FROM group_members WHERE group_id = ?` — **all rows** (`:350-353`)
3. `INSERT INTO group_members` — the new list (`:358-369`)

Every save of the group form, even a rename with no membership change, deletes and re-creates the entire membership.
For an N-member group that is **1 `groups` UPDATE + N `group_members` DELETEs + N `group_members` INSERTs** =
`2N + 1` realtime events, broadcast to every connected client in the database (the DELETEs unconditionally, §2.2).

On another member's device the sequence at `services/queries.ts:182-214` is:

- N DELETE events arrive. The one whose `old.person_id === personId` hits `:194-205` and **removes the group from the
  cache and drops every transaction of that group** (`:198-203`).
- Meanwhile `App.tsx:190-200` observes `selectedGroupId` is no longer in `groups` and calls `setSelectedGroupId(null)`
  (`:198`) — **the other member is kicked out of the group they were looking at.**
- Then the N INSERTs arrive; the one matching `personId` hits `:186-191` and invalidates `groups` + `transactions`,
  which refetches and restores the group. The user is left on the home screen.

If the INSERT batch fails (network drop between statements 2 and 3, or an RLS denial), the other member's cache — and
the database — are left with the group having **zero members**, at which point `i_am_member_of` is false for everyone
and `getGroups` returns it to nobody except the creator via `created_by`. See §12.1 and finding S-03.

Emits: PG UPDATE on `groups` (payload lacks `members`, §7.2), N PG DELETE + N PG INSERT on `group_members`.

### 3.7 Delete group (`App.tsx:540-561` → `supabaseApiService.ts:7-19`)

Three sequential deletes, **the first two completely unchecked** (`await supabase.from(...).delete().eq(...)` with the
result discarded, `:12` and `:14`); only the third's error is inspected (`:16-17`). Writer's cache filtered post-await
(`App.tsx:547`). Emits PG DELETE on `group_members` (N), `transactions` (M), `groups` (1) — all unfiltered.

Other members receive the `group_members` DELETE for their own row → `queries.ts:194-205` removes the group and its
transactions. That path works. But it works *because* DELETE events bypass RLS, not by design.

### 3.8 Archive / unarchive group

- `archiveGroup` (`supabaseApiService.ts:22-31`): `.update({is_archived:true}).eq('id')` — **no `.select()`, no row
  count**. RLS `FOR UPDATE USING (i_created_group(id))` and the function itself throws for owners
  (`:23`), so **only a non-creator can call it, and only the creator's UPDATE would pass RLS**. The two conditions are
  mutually exclusive: for every caller who gets past the JS guard, the SQL updates **zero rows and returns success**.
  Writer's cache is then patched to `isArchived: true` (`App.tsx:568`) and a toast is not shown. The group looks
  archived until reload. Confidence: **CONFIRMED** (both the JS guard and the RLS policy read in full).
- `unarchiveGroup` (`supabaseApiService.ts:2-6`): same unchecked update. Called from
  `components/ArchivedGroupsModal.tsx:51`, which updates only **component-local state** (`:52`) — the TanStack `groups`
  cache is never touched and never invalidated. Emits PG UPDATE, so it self-corrects *if* realtime works; otherwise the
  group stays hidden.

### 3.9 Request / approve / reject group deletion

- `requestGroupDeletion` (`:220-242`): `SELECT … maybeSingle()` then `INSERT`. `group_deletion_requests.group_id` is
  `UNIQUE` (map §0.4.1), so two members requesting concurrently → the loser gets a raw 23505 surfaced as
  `toast.error(e.message)` (`App.tsx:557`). Table is **not** in the realtime publication and has **no bridge** →
  emits **—**. The admin's Settings panel only refreshes when it is re-opened
  (`components/AdminDeletionRequestsPanel.tsx:47-49`).
- `approveGroupDeletion` (`:245-277`): same three unchecked deletes as §3.7 (`:264,:265`) plus an unchecked-row-count
  `UPDATE … status='approved'` (`:270-274`). Emits PG DELETEs. The requester's device learns via the `group_members`
  DELETE bridge.
- `rejectGroupDeletion` (`:317-324`): unchecked update, table not in publication → emits **—**. The requester is never
  told; there is no notification path of any kind.

### 3.10 Add a person to a group

Two entry points, both from `MemberInviteModal` (`components/MemberInviteModal.tsx:71-83`):

- `addPersonToGroup` (`services/apiService.ts:43-73`): optional `findPersonByEmail` RPC, then either
  `INSERT INTO group_members` for the existing person (error swallowed if `23505`, `:55`) or
  `create_unclaimed_person` RPC + a **second, unchecked-by-count `INSERT INTO group_members`** (`:68-71`).
  The two inserts are not in a transaction: a failure between them leaves an orphan `people` row.
  RLS on `group_members` INSERT is `WITH CHECK (i_created_group(group_id))`
  (`20260412000005:131-132`) — so **only the group creator can add members**; any other member gets a 42501 surfaced as
  `setError(err.message)` (`MemberInviteModal.tsx:86-88`).
- Emits: PG INSERT on `people` (new person) and PG INSERT on `group_members`.

On other members' devices the `people` INSERT is RLS-checked against
`i_can_see_person` (`20260728000000:29-75`), which is true once they share a group — but the `people` INSERT hits the
WAL **before** the `group_members` INSERT, so at that instant they do *not* share a group and the event is dropped.
The subsequent `group_members` INSERT is not for *their* `person_id`, so `queries.ts:209-213` only invalidates
`groups` — **not `people`**. Result: other members see the group's member count change but the new person renders as
missing from `people`, so `App.tsx:592` (`people.filter(p => selectedGroup.members.includes(p.id))`) silently omits
them from the member list and from every balance breakdown until a full reload. Confidence: **LIKELY** (event ordering
inferred from statement order; the cache-key gap is CONFIRMED).

`GroupFormModal.tsx:461-465` papers over this **for the adding user's own tab only** by dispatching
`groupMemberAdded`, which `App.tsx:281-301` handles by refetching `people` *and* `groups` and writing both caches
(`:287,:290`). It is a `window` event: not cross-device, not cross-tab, and it fires on a `setTimeout(…, 100)`.

### 3.11 Accept invite (`accept_group_invite` RPC)

`supabaseApiService.acceptInvite` (`:1144-1189`) → RPC. The function body
(`supabase/migrations/20260812000000_phase_b_claim_invites_security.sql:168-265`) is `SECURITY DEFINER`, takes
`FOR UPDATE` on the invite row (`:202` — **good**, this is the only place in the codebase that takes a row lock),
`INSERT INTO group_members` (`:236-237`), bumps `current_uses`, and marks the matching `email_invites` row accepted.

- **Joiner's device:** `App.tsx:224` / `InvitePage.tsx:129,278` invalidate `qk.groups(personId)` only.
  `qk.transactions` and `qk.people` are **not** invalidated. The joiner therefore sees the group appear with **zero
  transactions and no member names** until either the `group_members` PG INSERT for their own row arrives
  (`queries.ts:186-191`, which does invalidate transactions but still not `people`) or they reload. CONFIRMED.
- **Existing members' devices:** they receive the `group_members` INSERT (RLS: they are members, so
  `i_am_member_of(group_id)` is true → delivered). It is not their `person_id`, so `queries.ts:209-213` invalidates
  **`groups` only**. The new joiner's `people` row is never fetched. Same missing-person symptom as §3.10.
- The inviter gets no notification of any kind.

### 3.12 Create invite / deactivate invite

- `createGroupInvite` (`:973-1071`): membership check, `INSERT INTO group_invites`, then a `Promise.all` of N
  `INSERT INTO email_invites` each followed by a fire-and-forget `send-email` call (`:1029-1063`). `group_invites` and
  `email_invites` are **not** in the realtime publication and have no bridge. Emits **—**.
- `deactivateInvite` (`:1209-1220`): unchecked-row-count update; export is **dead** (map §0.6, no importer). Emits **—**.

### 3.13 Update avatar / name

- `updateUserAvatar` (`:1232-1243`): `.update({avatar_url}).eq('id', personId)` — **no `.select()`, no count check**.
  RLS `FOR UPDATE USING (clerk_user_id = requesting_user_id())` (`20260412000005:76-77`). If `personId` is ever not the
  caller's own row, zero rows update and the call reports success.
  Caller `components/SettingsModal.tsx:83-97`: optimistic local `setAvatarUrl(base64)` **before** the await (`:85`),
  then `syncAvatarToCaches` (`:58-68`) which writes **every** `['people', …]` cache via
  `setQueriesData({queryKey:['people']})` and then also invalidates. This is the *only* place in the app with a real
  optimistic write plus a revert path (`:92`).
- `updatePerson` (`:1246-1260`): `.select().single()` — fails loudly. Only caller is the **dead**
  `components/auth/UserProfile.tsx:50-54` (zero importers, map §0.6).
- Both emit **PG UPDATE on `people`**, delivered to co-members (`i_can_see_person`) → `queries.ts:161` replaces the
  whole cached `Person`. Avatars are base64 data URLs in the payload, so every avatar change ships the full image over
  every co-member's WebSocket.

### 3.14 Anonymize account

`anonymizeMyAccount` (`:1294-1307`) → `anonymize_my_account` RPC
(`supabase/migrations/20260813000000_anonymize_my_account.sql`). Emits **PG UPDATE on `people`** → co-members'
`people` cache is replaced wholesale with the anonymized row (`queries.ts:161`), so the name changes to the tombstone
value live on their screens. No group/transaction invalidation, so their historical expense attributions keep the old
name only until the next refetch. LIKELY.

### 3.15 Payment sources

- `addPaymentSource` (`:716-734`): `App.tsx:493-501` deliberately writes **no cache** ("Let realtime bridge add to
  cache for consistency", `:496`) — same failure mode as §3.1.
- `archivePaymentSource` (`:747-756`) and `deletePaymentSource` (`:736-745`): unchecked row counts; caches patched
  post-await (`App.tsx:511`, `:523-525`).
- RLS scopes `payment_sources` to the owning person only (`20260412000005:164-168`), so these PG events reach nobody
  else — which is correct. But note `App.tsx:525` rewrites the *shared* `transactions` cache to null out
  `paymentSourceId` on the deleting user's device only; other devices keep the dangling reference until refetch, and
  the DB keeps the FK (which is why `App.tsx:529` has a toast about FK failure).

### 3.16 Cute-icons batch emoji rewrite

`batchApplyEmojisToGroupTransactions` (`:668-684`): one SELECT then a **sequential `for` loop of N `UPDATE`
statements** (`:677-683`), each of which produces its own WAL record. Triggered from `App.tsx:385-392` when the
group's `enableCuteIcons` flips false→true.

For a 200-expense group that is **200 `postgres_changes` UPDATE events** delivered to every group member, each one
hitting `queries.ts:102` and replacing a cached `Transaction` object → 200 cache writes → 200 React re-renders of the
transaction list and all four balance computations. No `_broadcastTxChange` here (it calls `supabase.from(...)`
directly, not `updateTransaction`), so no BC storm — but `App.tsx:388` then *also* invalidates
`qk.transactions` for a full refetch on top. Confidence: **CONFIRMED**.

The re-entrancy guard is the regex `!/\p{Emoji}/u.test(t.description ?? '')` (`:675`) — it skips any description
containing *any* emoji anywhere, so two admins toggling concurrently cannot double-append (the second run's SELECT sees
the emoji). But it also means a description that legitimately contains an emoji (e.g. "🍕 night") never gets its
category icon. Not a sync bug; noted for completeness.

### 3.17 `ai_item_cache` writes

`services/tagClassifier.ts:30-40` fire-and-forget INSERT into a **global, shared** table. Not in the realtime
publication, no bridge. Emits **—**. Handles `23505` explicitly (`:35`).

### 3.18 Mutations that change the DB and emit nothing the other device listens to

| Mutation | Location | Why nothing propagates |
|---|---|---|
| `requestGroupDeletion` | `supabaseApiService.ts:220-242` | `group_deletion_requests` not in publication, no bridge |
| `rejectGroupDeletion` | `:317-324` | same |
| `approveGroupDeletion` status update | `:270-274` | same (the deletes do propagate) |
| `createGroupInvite` / `email_invites` | `:973-1071` | `group_invites`, `email_invites` not in publication |
| `deactivateInvite` | `:1209-1220` | same |
| `accept_group_invite`'s `current_uses` bump | migration `:239-247` | same |
| `ai_item_cache` insert | `services/tagClassifier.ts:31-33` | not in publication |
| `unarchiveGroup` → other devices' **selected group** | `:2-6` + `ArchivedGroupsModal.tsx:52` | PG UPDATE fires, but the caller never touches the TanStack cache, so on the *caller's own* device it is realtime-only |

### 3.19 Events the other device receives but mishandles

| Event | Handler | Mishandling |
|---|---|---|
| `groups` UPDATE | `queries.ts:63-76` | `payload.new` has no members; the handler substitutes the **cached** `members` (`:71`). If membership changed in the same `updateGroup` call, the cache keeps the stale list until a `group_members` event lands. |
| `groups` INSERT | `queries.ts:55-62` | Appends `mapDbGroupRowBasic(payload.new)` which sets `members: []` (`supabaseApiService.ts:386`). A group added this way renders with **zero members** — `App.tsx:592` then yields an empty `groupMembers`, so the expense form has nobody to split with. |
| `transactions` UPDATE | `queries.ts:102` | `current.map(t => t.id === new.id ? new : t)` — replaces the object **wholesale**, discarding any local field. Combined with §6 this is the last-writer-wins hole. |
| `people` INSERT | `queries.ts:153-159` | Appends any `people` row RLS lets through, including unclaimed placeholders the receiver has no group with (the `i_can_see_person` "active invite inviter" clause, `20260728000000:66-71`, admits strangers). |
| `group_members` DELETE | `queries.ts:194-205` | Fires on an **unauthenticated, unfiltered** event stream (§2.2) using only `oldRow.person_id === personId` as the guard. See S-02. |
| `group_members` INSERT (someone else) | `queries.ts:209-213` | Invalidates `groups` but **never `people`** → new members are invisible (§3.10, §3.11). |
| `payment_sources` UPDATE | `queries.ts:134` | Wholesale replace; same class as transactions. |

---

## 4. Coverage table

Columns: **→B** = propagates to another *device*; **Mech** = by what; **→tab** = propagates to another tab of the same
device/browser profile; **→self** = does the writer's own UI update *without* waiting for realtime?

| # | Mutation | →B | Mech | →tab | →self w/o realtime |
|---|---|---|---|---|---|
| 1 | Add expense | yes | PG INSERT | yes (PG) | **NO** (`App.tsx:353-355`) |
| 2 | Edit expense | yes | PG UPDATE | yes | yes (`App.tsx:352`) |
| 3 | Delete expense | yes | PG DELETE (unfiltered) | yes | yes (`App.tsx:338`) |
| 4 | Settle-up create | yes | PG INSERT | yes | yes (`App.tsx:796-798`) |
| 5 | Settle-up edit | yes | PG UPDATE | yes | yes (`App.tsx:791`) |
| 6 | Add group | partial — via `group_members` INSERT only | PG | yes | yes (`App.tsx:443`) |
| 7 | Edit group (name/currency/type) | yes | PG UPDATE (members preserved from stale cache) | yes | yes (invalidate, `App.tsx:395`) |
| 8 | Edit group (members) | yes, destructively | 2N+1 PG events; kicks viewers out (§3.6) | yes | yes |
| 9 | Delete group | yes | PG DELETE ×(N+M+1) | yes | yes (`App.tsx:547`) |
| 10 | Archive group | **no-op in DB** (§3.8) | — | no | yes (cache lies) |
| 11 | Unarchive group | yes | PG UPDATE | yes | **NO** (`ArchivedGroupsModal.tsx:52` = local state only) |
| 12 | Request deletion | **no** | — | no | n/a (toast only) |
| 13 | Approve deletion | yes (the deletes) | PG DELETE | yes | via `loadRequests()` |
| 14 | Reject deletion | **no** | — | no | via `loadRequests()` |
| 15 | Add person to group | member list yes / person row **no** | PG INSERT `group_members` | partial | yes (DOM event, same tab) |
| 16 | Accept invite | member list yes / person row **no** | PG INSERT `group_members` | partial | groups only (§3.11) |
| 17 | Create invite | **no** | — | no | yes (modal state) |
| 18 | Deactivate invite | **no** | — | no | n/a (dead export) |
| 19 | Update avatar | yes | PG UPDATE `people` | yes | yes + real optimistic (`SettingsModal.tsx:85`) |
| 20 | Update name | yes | PG UPDATE `people` | yes | yes (dead caller) |
| 21 | Anonymize account | yes (name only) | PG UPDATE `people` | yes | sign-out |
| 22 | Add payment source | n/a (private) | PG INSERT (self only) | yes | **NO** (`App.tsx:496`) |
| 23 | Archive payment source | n/a (private) | PG UPDATE (self only) | yes | yes (`App.tsx:511`) |
| 24 | Delete payment source | n/a (private) | PG DELETE (self only) | yes | yes (`App.tsx:523`) |
| 25 | Cute-icons batch | yes | N × PG UPDATE + invalidate | yes | yes |
| 26 | `ai_item_cache` write | **no** | — | no | n/a |

**Same-tab-only mechanisms:** row 15's DOM event. **Nothing at all:** rows 12, 14, 17, 18, 26 (and 10, which does not
even reach the DB).

---

## 5. Reconnect and backfill

### 5.1 What exists

Exactly one automatic recovery mechanism: TanStack Query's `refetchOnReconnect`, which is **not** overridden in
`lib/queryClient.ts` and therefore defaults to `true`. Vendor doc
(`https://tanstack.com/query/v5/docs/framework/react/guides/important-defaults`, fetched 2026-09-07):

> "Stale queries are refetched automatically in the background when: New instances of the query mount, The window is
> refocused, The network is reconnected."

Two qualifiers matter here (LIKELY, from the same page): it only fires for **stale** queries (with
`staleTime: 30_000`, anything older than 30 s qualifies — so that gate is effectively always open), and it only fires
for queries with **active observers**. All four queries are mounted at `App.tsx:52-55` for the lifetime of the signed-in
app, so that gate is also open.

The trigger is TanStack's `onlineManager`, which listens to the browser's `online`/`offline` events. **That is the
whole recovery story.**

### 5.2 Network drop and restore

- WebSocket dies. realtime-js retries with backoff `[1000, 2000, 5000, 10000]` ms (LIKELY, source fetched from
  `v2.15.5`), heartbeat interval 25 s; on heartbeat timeout it force-closes and reconnects.
- On `connect()` it calls `_setAuthSafely('connect')` → `_performAuth(null)` → the `accessToken` callback →
  `getClerkSupabaseToken()` (`lib/supabase.ts:33-43`) → fresh Clerk JWT. So the socket re-authenticates itself on a
  socket-level reconnect. LIKELY.
- The browser fires `online` → TanStack refetches all four stale queries. **This path works.**
- **But**: `postgres_changes` is at-most-once. Every WAL event that occurred while the socket was down is gone.
  Recovery depends entirely on the `online` event firing. If the socket died for a reason that did *not* correspond to
  a browser-visible offline transition (server-side channel error, expired subscription claims, mobile radio handoff
  that keeps `navigator.onLine === true`, Doze-killed socket), **`online` never fires and nothing is refetched**.
  The only remaining hint is `RealtimeStatus` flipping to "Offline" — and see §5.5.

### 5.3 Backgrounding (Android WebView / mobile browser)

This is the founder's most likely scenario and it is the worst case.

1. App is backgrounded. Android suspends the WebView's JS; `setInterval` stops. The 50 s
   `setRealtimeAuth` timer (`contexts/SupabaseAuthContext.tsx:67-74`) stops firing.
2. Clerk session JWTs default to **60 s** TTL (asserted by the code's own comment,
   `contexts/SupabaseAuthContext.tsx:8-12`; unverifiable from the repo — §15). Within ~60 s the token the Realtime
   server holds for these channels is expired.
3. What Supabase Realtime does with an expired token on an open socket is **not documented** on the two pages fetched
   (`postgres-changes`, `authorization`) — neither mentions expiry behaviour. Realtime is known to terminate channels
   on token expiry, but I could not quote a source. **SUSPECTED**, carried to §15.
4. The socket itself is also likely torn down by Doze/network-idle.
5. On resume: no `visibilitychange` handler (§1.2), no `appStateChange` handler that does anything
   (`index.tsx:44-46` is a `console.log`), `refetchOnWindowFocus: false` (`lib/queryClient.ts:8`). The 50 s interval
   resumes and re-pushes a token, but `_performAuth` only pushes `access_token` to channels that are
   `joinedOnce && _isJoined()` (LIKELY) — a channel the server already closed gets nothing.
6. TanStack refetches **only if the OS/browser fires an `online` event on resume.** Android often does not, because the
   network was never reported as lost.

**Conclusion (LIKELY): a device backgrounded for 5 minutes while another device adds expenses will, on resume, show the
stale list.** The only mechanisms that could save it are (a) a browser `online` event, which is not guaranteed, or
(b) the user manually pull-to-refreshing — which does not exist in this app — or (c) a full reload. There is no
mechanism in the codebase that detects "I have been asleep" and reconciles. CONFIRMED for the *absence* of the
mechanism; LIKELY for the platform behaviour.

### 5.4 App restart

Full reload → all four queries refetch from scratch (no persisted cache, §1.2) → correct state. This is why the bug is
self-healing on restart and therefore hard for the founder to reproduce on demand.

### 5.5 The status badge actively misleads

`components/RealtimeStatus.tsx:11-26` subscribes to a channel named `heartbeat` with **no bindings at all** — no
`postgres_changes`, no `broadcast`, no presence. It reports `SUBSCRIBED` as soon as the *socket* is up and the empty
channel joins. That says nothing about whether:

- the five tables are in the `supabase_realtime` publication,
- the subscription's stored JWT claims are still valid,
- the `postgres_changes` channels are joined or errored,
- RLS is delivering anything.

So the app can display a green **"Live"** badge (`RealtimeStatus.tsx:34-43`) while zero data events are being delivered.
The badge's own error message even names the right cause — *"This often means the table is not in the
supabase_realtime publication"* (`:18`) — but it can never fire for that reason, because the heartbeat channel does not
depend on any publication. **CONFIRMED.**

---

## 6. Ordering and staleness

- **No version, sequence, ETag, or `updated_at` comparison anywhere.** Grep across `services/`, `App.tsx`,
  `components/` for `updated_at|updatedAt|version|revision|_rev|etag`: the only hits are
  `deactivateInvite` writing `updated_at` (`supabaseApiService.ts:1214`) and the invite transformers
  (`:951`, `:967`). No read path compares timestamps.
- `transactions.updated_at` **exists in the database** (map §0.4.1, maintained by the
  `update_transactions_updated_at` trigger) and is **dropped on the way in**:
  `transformDbTransactionToAppTransaction` (`supabaseApiService.ts:78-108`) never copies it, and `types.ts` has no such
  field. So even if the app wanted to compare, the value is not in the cache. CONFIRMED.
- **Realtime UPDATE arriving after a local `setQueryData` from an edit.** Sequence: `App.tsx:351` awaits
  `updateTransaction` → `:352` writes the returned row into the cache → the server's PG UPDATE for the *same* write
  arrives ~50-200 ms later → `queries.ts:102` replaces the object again with an equivalent value. Harmless in the
  common case. **Not harmless** when device B edited the same row in the interim: B's UPDATE (which A also receives)
  can arrive *before* A's own PATCH response resolves, and then A's `setQueryData` at `:352` overwrites B's newer
  values with A's stale response. A's screen then shows A's version while the database holds B's. No reconciliation
  ever corrects it (nothing refetches — §5). CONFIRMED for the code shape; the race window is LIKELY.
- **Two events arriving reversed.** Handlers are pure last-write-wins:
  `queries.ts:102` (`transactions`), `:134` (`payment_sources`), `:161` (`people`), `:63-76` (`groups`). If the
  transport ever reorders (or if an UPDATE and a DELETE for the same row cross), the cache keeps whichever landed last.
  For a DELETE-then-INSERT-of-same-id pair the INSERT dedupe guards (`:99`, `:58`, `:129`, `:156`) will *drop* the
  INSERT if the DELETE has not landed yet. Vendor docs state no ordering or delivery guarantee (the page has no such
  section — §15).
- **No idempotency key or client-generated id.** `addTransaction` (`:541-558`) lets the server generate the UUID, so a
  retried or double-submitted insert is indistinguishable from a genuine second expense. See §9.

---

## 7. Cache invalidation

### 7.1 Per incoming event — exactly which keys are touched

| Event | Handler | Keys touched | Kind |
|---|---|---|---|
| `groups` INSERT | `queries.ts:55-62` | `['groups', personId]` | record append (members forced to `[]`) |
| `groups` UPDATE | `queries.ts:63-76` | `['groups', personId]` | record patch, `members` re-used from cache |
| `groups` DELETE | `queries.ts:77` | `['groups', personId]` | record remove |
| `transactions` INSERT | `queries.ts:97-101` | `['transactions', personId]` | record prepend, dedupe by id |
| `transactions` UPDATE | `queries.ts:102` | `['transactions', personId]` | **wholesale record replace** |
| `transactions` DELETE | `queries.ts:103` | `['transactions', personId]` | record remove |
| `tx` broadcast | `queries.ts:107-109` | `['transactions', personId]` | **full list invalidate** — never reached (§1.3) |
| `payment_sources` * | `queries.ts:124-137` | `['paymentSources', personId]` | record ops |
| `people` * | `queries.ts:151-164` | `['people', personId]` | record ops (UPDATE = wholesale replace) |
| `group_members` INSERT, mine | `queries.ts:186-191` | `['groups',…]` **and** `['transactions',…]` | **two full-list invalidates** |
| `group_members` DELETE, mine | `queries.ts:194-205` | `['groups',…]`, `['transactions',…]` | record removes (group + all its txs) |
| `group_members` INSERT/DELETE, someone else's, in one of my groups | `queries.ts:209-213` | `['groups', personId]` | **full-list invalidate** — note: **`people` is never invalidated** |

### 7.2 Over-invalidation

**The `tx` broadcast, if it were wired up.** `queries.ts:107-109` ignores the `groupId` it is handed and invalidates the
entire `['transactions', personId]` key. `getTransactions` (`supabaseApiService.ts:490-535`) is **two sequential HTTP
round trips** — `GET /group_members?person_id=eq.<me>` then
`GET /transactions?group_id=in.(g1,…,gN)&order=date.desc` — returning **every transaction of every group the user
belongs to, unpaginated**. Quantified: with `U` connected clients and `W` writes/second system-wide, every single write
(add, edit, or delete of any transaction, in any group, by any user, anywhere in the database — the broadcast topic is
global and the payload's `groupId` is discarded) would trigger `2 × U` HTTP requests. A group of 10 with 3 active users
doing a 20-expense dinner split produces 20 writes × 3 clients × 2 requests = **120 unbounded table scans in a couple of
minutes**, each returning that user's entire transaction history. This is currently masked by §1.3; fixing the façade
bug without also scoping the invalidate would turn it on. **CONFIRMED** (code read; the amplification is arithmetic).

**Group edits.** §3.6: a rename produces `2N+1` events, and the one that matters (`groups` UPDATE) is the one that
carries stale members.

**Cute icons.** §3.16: N record replaces *plus* a full invalidate on top (`App.tsx:388`).

**`SettingsModal.tsx:60-67`** writes **all** `['people', …]` caches via `setQueriesData({queryKey:['people']})` — a
prefix match across every `personId` — and then *also* invalidates the current one. Belt and braces, but it means an
avatar change refetches `getPeople`, which is 3 sequential queries (`supabaseApiService.ts:759-815`).

### 7.3 Under-invalidation (the more dangerous half)

1. **`groups` UPDATE preserves stale `members`** — `queries.ts:66-72`. If `updateGroup` changed the roster, the cached
   `members` array is wrong until a `group_members` event lands. `App.tsx:592` derives `groupMembers` from
   `selectedGroup.members`, so the expense form and the balance panels use the stale roster.
2. **`people` is never invalidated on membership change** — `queries.ts:209-213` invalidates `groups` only.
   A new member added by someone else is a UUID with no `Person`. This is the mechanism behind both §3.10 and §3.11,
   and it is exactly the class of bug `MEMBER_DISPLAY_BUG_FIX.md` claims to have fixed (it fixed a different instance
   of it, in `GroupFormModal`).
3. **`groups` is not invalidated on other devices after `acceptInvite`** — only the joiner invalidates
   (`App.tsx:224`, `InvitePage.tsx:129,278`). Existing members rely on the `group_members` INSERT PG event.
4. **Balances derive from a possibly-stale `transactions` list.** `App.tsx:131-135` → `utils/calculations.ts:4-23`.
   There is no server balance to disagree with, so a missed `transactions` event does not surface as an error — it
   surfaces as **a wrong number that looks authoritative**. Two devices with different cached transaction sets show two
   different "you are owed" figures, and neither has any way to know it is wrong. This is the money-correctness
   consequence of every sync gap in this document.
5. **`paymentSources` when a source is deleted while referenced** — `App.tsx:525` patches the writer's `transactions`
   cache; other devices never see it (payment sources are per-user, so they never had it). Fine in practice, but the
   `transactions.payment_source_id` FK is left dangling in the DB (map §0.4.1).
6. **`transactions` is not invalidated when a group's membership changes.** Adding a member to a group changes who
   `calculateShares` should split among for *future* expenses only, so this is benign — but removing a member does not
   re-fetch, and the removed person's `split_participants` entries stay in existing rows.

---

## 8. "Optimistic" updates

### 8.1 There is essentially one optimistic update in the app, and it is not any of the ones you'd expect

Every cache write in `App.tsx` happens **after** `await`. Precisely:

| Path | Line | Order |
|---|---|---|
| Delete transaction | `App.tsx:337-338` | `await api.deleteTransaction(...)` **then** `setQueryData` |
| Edit transaction | `App.tsx:351-352` | `await api.updateTransaction(...)` **then** `setQueryData` |
| Settle-up create | `App.tsx:794-798` | `await api.addTransaction(...)` **then** `setQueryData` |
| Settle-up edit | `App.tsx:790-791` | await then set |
| Add group | `App.tsx:441-446` | await then set |
| Archive group | `App.tsx:567-568` | await then set |
| Delete group | `App.tsx:546-547` | await then set |
| Archive payment source | `App.tsx:510-511` | await then set |
| Delete payment source | `App.tsx:522-525` | await then set |
| **Avatar upload** | `components/SettingsModal.tsx:85` | `setAvatarUrl(base64)` **before** `await updateUserAvatar(...)` — genuinely optimistic, with a revert at `:92` |

So the correct description is **post-await cache writes**, not optimistic updates. The distinction matters:

- They cost the user a full network round trip of latency before the UI moves.
- They are **not rolled back**, because there is nothing to roll back — but they *are* wrong whenever the server said
  "OK" while doing nothing (§8.3).
- There is **no rollback path anywhere** except `SettingsModal.tsx:92` / `:106`, because there is no `useMutation` and
  therefore no `onError` (§1.2).

### 8.2 Is anything written before the server confirms?

Only the avatar (`SettingsModal.tsx:85`, `:104`). Everything else waits. **CONFIRMED.**

### 8.3 Silent server rejection — the "phantom" class

This is the class the repo has already been burned by once: `supabase/migrations/20260412000008_allow_members_to_delete_transactions.sql:4-8` says, verbatim:

> "Problem: Only the group creator can delete transactions (`i_created_group` check). Non-creator members see an
> apparent delete (optimistic UI) but the DB silently rejects it, so the transaction reappears on next refresh."

The *policy* was widened, but the *pattern* — a write with no `.select()` and no affected-row check, followed by an
unconditional cache mutation — was never removed. PostgREST + RLS returns **success with zero rows affected** when the
`USING` clause filters the row out; only `.select().single()` converts that into PGRST116.

Every write in the codebase that does **not** check affected rows:

| Function | Location | Statement | Consequence when RLS denies |
|---|---|---|---|
| `deleteTransaction` | `supabaseApiService.ts:686-696` | `.delete().eq('id')` | `App.tsx:337-338` removes it from cache → **phantom deletion**; row reappears on reload, balances silently differ between devices |
| `deleteGroup` | `:7-19` | 3 deletes, first **two** unchecked (`:12`, `:14`) | group row deleted but members/transactions orphaned, or nothing deleted at all while `App.tsx:547` drops it from cache |
| `approveGroupDeletion` | `:245-277` | 2 unchecked deletes (`:264`, `:265`) + unchecked status update (`:270-274`) | same, plus the request can be marked "approved" with nothing deleted |
| `archiveGroup` | `:22-31` | `.update({is_archived:true})` no select | **always** zero rows (§3.8) — `App.tsx:568` lies to the user |
| `unarchiveGroup` | `:2-6` | `.update({is_archived:false})` no select | silent no-op for non-creators |
| `rejectGroupDeletion` | `:317-324` | `.update({status:'rejected'})` no select | `AdminDeletionRequestsPanel.tsx:80` toasts success regardless |
| `deactivateInvite` | `:1209-1220` | `.update(...)` no select | dead export, but same shape |
| `archivePaymentSource` | `:747-756` | `.update({is_active:false})` no select | `App.tsx:511` lies |
| `deletePaymentSource` | `:736-745` | `.delete().eq('id')` | `App.tsx:523-525` lies |
| `updateUserAvatar` | `:1232-1243` | `.update({avatar_url}).eq('id')` no select | `SettingsModal.tsx:86-88` toasts "Profile picture updated!" regardless |
| `batchApplyEmojisToGroupTransactions` | `:668-684` | N × `.update(...)` no select, **no error check at all** | silent partial application |
| `addPersonToGroup` second insert | `services/apiService.ts:68-71` | `.insert(...)` — error *is* checked, count is not | n/a (insert errors do surface) |
| `addPersonToGroup` first insert | `services/apiService.ts:52-55` | `.insert(...)`, `23505` swallowed | correct (idempotent re-add) |

Counter-examples that behave correctly: `updateTransaction` (`:648-655`), `updateGroup`'s groups update
(`:337-342`), `addTransaction` (`:541-558`), `addGroup` (`:180-186`), `addPaymentSource` (`:720-731`),
`updatePerson` (`:1251-1256`) — all use `.select().single()` and therefore throw on an RLS-denied write.

---

## 9. Offline behaviour

- **Write queue: none.** There is no service-worker background sync, no IndexedDB outbox, no TanStack persister, no
  retry-on-reconnect for writes. A write attempted while offline throws `TypeError: Failed to fetch` out of the
  `global.fetch` override (`lib/supabase.ts:56-64`) and is swallowed by `console.error` at `App.tsx:359-361`
  (add/edit expense) or `:341` (delete). **The user gets no feedback at all** for the expense path.
- **The PWA service-worker cache rule is inert.** `vite.config.ts:82` matches
  `/^https:\/\/api\.supabase\.co\/.*/i`. Real project hosts are `<ref>.supabase.co`, never `api.supabase.co`, so the
  `NetworkFirst` rule never matches a single request and the `supabase-api-cache` stays empty. **CONFIRMED** by reading
  the pattern against `lib/supabase.ts:5-8` (URL comes from `VITE_SUPABASE_URL`). With `registerType:'prompt'`,
  `clientsClaim:false`, `skipWaiting:false` (`vite.config.ts:43,78,79`), the SW also never takes over an open page.
  Net: the PWA contributes **nothing** to offline reads and nothing to staleness either — it is neither help nor harm.
- **Idempotency: none.** No client-generated ids, no `Idempotency-Key`, no unique constraint that would catch a repeat.
  `transactions` has PK `id` (server-generated) and no natural unique key.
- **Can a retry double-post?** `mutations.retry: 1` (`lib/queryClient.ts:12`) is dead — no `useMutation` exists
  (CONFIRMED by grep, §1.2). `queries.retry: 1` (`:9`) applies to reads only. So there is no *automatic* retry that can
  double-post. But there is a **manual** one:

  `components/TransactionFormModal.tsx:685-691` — the Save button's only guard is
  ```tsx
  disabled={!isSplitValid || !description || !amount}
  ```
  There is **no `submitting` flag**. `handleSubmit` (`:283`) is `async` and calls `onSave(...)` at `:355` **without
  awaiting it**, so the modal stays mounted and interactive for the whole duration of
  `classifyDescription` (up to an `ai_item_cache` SELECT plus a Gemini Edge Function call, `:290-300`) **plus** the
  `INSERT` round trip **plus** the 2–3 extra reads in the dead email block (`supabaseApiService.ts:568-621`).
  On a slow mobile connection that is comfortably over a second. A double-tap on Save produces **two INSERTs and two
  distinct expenses**, and because §3.1 writes no cache, the user sees *neither* until realtime delivers both — at
  which point two identical rows appear. **CONFIRMED.**

  Contrast `components/SettleUpModal.tsx:85` — `const isValid = payerId && receiverId && !isSelfSelect &&
  amountNumber > 0 && !submitting` — which *is* guarded (`:207` uses `disabled={!isValid}`). And
  `MemberInviteModal.tsx:107` (`disabled={submitting || …}`). The expense form is the outlier.

---

## 10. Conflict policy

**Policy: none. Last PATCH wins, per column set, with no detection and no notification.**

### 10.1 Two devices edit the same expense

`updateTransaction` (`supabaseApiService.ts:626-660`) builds `updateData` from whichever fields the caller supplied.
`TransactionFormModal` always supplies the whole form (`:355-366` of the modal → every field), so in practice every
edit is a full-column PATCH. `split` and `payers` are **whole JSONB objects** (`:635`, `:643-646`) — there is no
merge, so a change to one participant's share replaces the entire participants array.

Interleaving:

```
t0  A and B both open expense X: amount 1000, split equal over [a,b,c]
t1  A changes amount → 1200, saves.  PATCH {amount:1200, split:{equal,[a,b,c]}, payers:…, description:…, …}
t2  B (form still holds amount 1000) changes the split to unequal [600,400,0], saves.
    PATCH {amount:1000, split:{unequal,[600,400,0]}, payers:…, description:…, …}
t3  DB row = amount 1000, unequal [600,400,0].  A's 1200 is gone.
t4  A receives the postgres_changes UPDATE → queries.ts:102 replaces A's cached object wholesale.
    A's screen now silently shows 1000/unequal.  No toast, no conflict marker, no history.
```

What is silently lost: **the entire prior revision**. There is no `updated_by`, no audit table, no revision column
(map §0.4.1: *"No `created_by`, no `updated_by`, no version/revision column, no audit table"*). The only trace is
`updated_at`, which the client drops (§6). Because balances are pure functions of the transaction list, the loss shows
up as a **wrong money figure** on every member's screen, with no indication anything happened. **CONFIRMED.**

### 10.2 `updateGroup` vs. an in-flight `accept_group_invite`

`updateGroup` is delete-all-then-reinsert with **no transaction and no lock** (§3.6). `accept_group_invite` inserts a
`group_members` row under `FOR UPDATE` on the *invite* row — which does not lock `group_members` at all.

```
t0  Group G members = [creator, m1, m2].  Creator opens Group Settings on device A.
    A's GroupFormModal snapshot: members = [creator, m1, m2].
t1  New user N accepts the invite. accept_group_invite INSERTs group_members(G, N).
    DB members = [creator, m1, m2, N].
t2  Creator taps Save on device A (no membership change intended, just a rename).
    updateGroup: UPDATE groups SET name=… ;
                 DELETE FROM group_members WHERE group_id = G;      ← removes N too
                 INSERT INTO group_members VALUES (creator),(m1),(m2);   ← N not in A's snapshot
t3  DB members = [creator, m1, m2].  N has been silently ejected from the group they just joined.
    N's device receives the group_members DELETE for their own row (§2.2 — unfiltered, always delivered),
    queries.ts:194-205 removes the group and all its transactions from N's cache,
    App.tsx:198 clears selectedGroupId, and N is bounced to the home screen with the group gone.
    The invite is already consumed (current_uses bumped, migration :239-247), and if max_uses was 1 the link is
    now is_active = false — so N cannot rejoin.
```

The same interleaving applies to `addPersonToGroup` (`services/apiService.ts:52-71`) racing a group save, and to two
admins saving group settings concurrently (each overwrites the other's roster wholesale). **CONFIRMED** for the code
shape; the exact window is however wide the group-settings modal stays open, which is unbounded.

### 10.3 Who is told

Nobody. There is no conflict UI, no "this changed while you were editing" check, no `If-Unmodified-Since`, and no
refetch-before-save. `TransactionFormModal` seeds its state from the `transaction` prop once (from the cache) and never
re-reads.

---

## 11. Listener lifecycle

### 11.1 The five bridges

Each is a `React.useEffect` keyed on `[personId, qc]` with a cleanup that calls `sub.unsubscribe()`:
`queries.ts:50-84` (groups), `:90-115` (transactions), `:121-142` (payment sources), `:148-169` (people),
`:180-216` (group members). `qc` is stable (`useQueryClient()`), `personId` is a string. So in production each effect
runs exactly once per signed-in session. **Correct.** No per-list-item subscriptions exist anywhere — grep for
`.channel(` returns exactly the six sites in §1.4. **CONFIRMED.**

### 11.2 `_txPublishChannel` is a module-level singleton that aliases a bridge channel

`services/supabaseApiService.ts:479` — `let _txPublishChannel: … | null = null`, assigned once at `:483` and
**never reset, never unsubscribed, never re-authed**. Because `channel()` dedupes by topic (§1.4), it is the *same*
object the transactions bridge owns. Consequences:

- After the bridge's cleanup runs `sub.unsubscribe()` (sign-out, or `personId` change), `_txPublishChannel` points at a
  channel in `closed`/removed state. The next `_broadcastTxChange` call hits `.send()` on a non-pushable channel, which
  in realtime-js 2.15.5 falls back to an **HTTP POST to the broadcast endpoint** with the anon apikey (LIKELY, source
  fetched) — an extra unnecessary request per transaction write, on every write, forever after.
- It survives sign-out. If user B signs in on the same page instance, `_txPublishChannel` still references the channel
  created under A's session.
- On the *first* write of a session it calls `.subscribe()` on an already-joined channel (`:484`). In 2.15.5 that is a
  benign early-return. In realtime-js **< 2.9** the same line threw
  `"tried to subscribe multiple times"` — an uncaught string throw *after* the INSERT had already committed, which
  would leave the row in the DB while `App.tsx:359` swallowed the error and the modal stayed open. This is a live
  upgrade landmine, not a current bug. **SUSPECTED** for the historical behaviour; the current no-op is LIKELY.

### 11.3 React StrictMode double-mount (dev only)

`index.tsx:80` wraps the tree in `React.StrictMode`. In development, React 19 mounts → unmounts → remounts every effect.
Sequence for a bridge:

1. mount: `supabase.channel('public:transactions')` creates the channel, `.on(...)`, `.subscribe()` → state `joining`.
2. cleanup: `sub.unsubscribe()` → state `leaving`; the channel is removed from `socket.channels` only **after** the
   server's LEAVE reply.
3. remount (same tick): `supabase.channel('public:transactions')` → the dedupe lookup still finds the `leaving`
   channel → returns it → `.on(...)` adds a *second* set of bindings → `.subscribe()` sees
   `state != CHANNEL_STATES.closed` and returns early **without joining**.
4. the LEAVE completes; the channel closes and is removed.

Net (LIKELY, depends on the exact timing of the LEAVE reply): **in dev, realtime can be silently dead, or deliver
duplicate callbacks.** This directly explains why a developer testing locally may see the bug intermittently and
conclude "it works sometimes". Production builds do not double-invoke effects, so this is a dev-only hazard —
but it is also the reason local reproduction is unreliable.

### 11.4 `RealtimeStatus`

`components/RealtimeStatus.tsx:7-32` — mounted inside `App` (`App.tsx:848`), so it exists only while signed in, and it
unsubscribes cleanly. Its channel has no bindings (§5.5).

### 11.5 `useBackButton`

`hooks/useBackButton.ts:15-79` — one `useEffect` with `[]` deps, adding `document` `click`/`touchstart` and `window`
`popstate` listeners plus a Capacitor `backButton` listener, all removed on unmount. Not a sync mechanism, not a resume
hook. Note `pushDummyState` (`:34-41`) manipulates history on every click; irrelevant here but worth knowing it is not
a visibility signal.

### 11.6 `SupabaseAuthContext` interval

`contexts/SupabaseAuthContext.tsx:67-74`, cleared at `:94`. Guarded by tests
(`src/test/contexts/SupabaseAuthContext.test.tsx:129-187`, including a "no leaked interval" test at `:172-187`).
The tests assert the *timer* fires and that `setRealtimeAuth` is called before `ensureUserExists` (`:109-126`) — they
do **not** assert anything about channels actually receiving events, and they mock `setRealtimeAuth` entirely (`:44`).

### 11.7 Channel count per client

**Six** (§1.4), all on one WebSocket. Well under Supabase's per-connection limits. Not a scaling problem.

---

## 12. Database concurrency

Every multi-statement operation in this codebase runs as **independent PostgREST requests with no transaction, no
advisory lock, and no optimistic-concurrency token.** PostgREST cannot span a transaction across requests; the correct
tool would be a `SECURITY DEFINER` plpgsql function (which the codebase already uses for
`accept_group_invite` — and only there).

### 12.1 `updateGroup` — delete members, then insert members (`supabaseApiService.ts:326-373`)

Three requests, no transaction:
`UPDATE groups` (`:337-342`) → `DELETE FROM group_members WHERE group_id = ?` (`:350-353`) →
`INSERT INTO group_members` (`:358-369`).

Failure between statements 2 and 3 — a dropped connection, a backgrounded tab, an RLS denial, a browser tab close —
leaves the group with **zero members, including the creator**. Then:

- `getGroups` (`:136-166`) uses `group_members!inner(person_id).eq(person_id, me)` → returns nothing for anyone.
- RLS `"Users can view their groups"` (`20260412000005:88-97`) still lets the **creator** see it via
  `created_by = requesting_user_id()` / the `people.id::text = created_by` clause — but the client's own
  `!inner` join filters it out anyway, so **even the creator loses it from the UI**.
- Every other member's device receives the `group_members` DELETE for their own row → `queries.ts:194-205` drops the
  group and its transactions from their cache too.
- The transactions still exist in the DB, invisible to everyone. Recovery requires SQL.

Also note statement 3 is skipped entirely when `groupData.members.length === 0` (`:358`), so an accidental "remove
everyone" save is *silently* a valid state, not an error.

### 12.2 `deleteGroup` / `approveGroupDeletion` — three unchecked statements

`:12`, `:14`, `:16` and `:264`, `:265`, `:266`. Partial failure leaves orphaned `transactions` (FK to `groups` is
`ON DELETE CASCADE` per map §0.4.1, so if the group *does* go the children follow — but if the group delete is the one
that fails, members and transactions are already gone from a group that still exists). Both functions gate on a
**client-computed** `allSettled` boolean (`App.tsx:138` → passed at `:546`, `:567`; `AdminDeletionRequestsPanel.tsx:63`
passes a hardcoded `true`), which is derived from the possibly-stale local transactions cache — so the "all balances
settled" precondition is enforced by the caller's cache, not the database.

### 12.3 `addGroup` — insert group, then insert members (`:168-217`)

Two requests. Failure between them leaves an **orphan group with no members**, visible only via `created_by` in RLS and
invisible in the client's `!inner`-joined `getGroups`. The code logs `'⚠️ No members to add to group!'` (`:213`) and
returns success.

### 12.4 `createGroupInvite` — invite, then N email_invites, then N emails (`:973-1071`)

`INSERT group_invites` → `Promise.all` of N `INSERT email_invites` (`:1029-1063`), each followed by a fire-and-forget
`sendGroupInviteEmail` (`:1045-1058`). A throw in any one `Promise.all` branch (`:1041`) rejects the whole
`Promise.all` **after** some emails have already been dispatched, so the caller sees an error while invitees have
already received links. No compensation.

### 12.5 `requestGroupDeletion` — select-then-insert on a UNIQUE column (`:220-242`)

Classic TOCTOU. `SELECT … WHERE status='pending' … maybeSingle()` (`:225-230`) then `INSERT` (`:235-239`).
`group_deletion_requests.group_id` is `UNIQUE` (map §0.4.1), so two members requesting simultaneously → the loser gets a
raw `23505` with PostgREST's message, surfaced verbatim to the user by `App.tsx:557`
(`toast.error(e.message || 'Failed to delete group.')`). The correct fix is one statement:
`INSERT … ON CONFLICT (group_id) DO NOTHING RETURNING id`.

Worse: because the constraint is `UNIQUE(group_id)` and not `UNIQUE(group_id) WHERE status='pending'`, once a request
has been **rejected** no one can ever file another one for that group.

### 12.6 `accept_group_invite` — the one that does it right (`20260812000000:168-265`)

`SECURITY DEFINER`, single transaction (a plpgsql function body), `SELECT … FOR UPDATE` on the invite row (`:202`)
before checking `max_uses` and bumping `current_uses`. This correctly serialises concurrent redemptions of the same
link. **Note it as the template the other five operations should follow.** Its one gap: it does not lock or re-check
`group_members`, so it loses to a concurrent `updateGroup` (§10.2).

### 12.7 `ensureUserExists` fallback path (`:846-912`)

RPC-first (`:848`), then `SELECT by clerk_user_id` → `claim_person_by_email` RPC → `INSERT` with an explicit
`23505` retry (`:899-908`). Handles the race correctly *for the insert*, but the three-step read-modify-write above it
can still produce duplicate `people` rows if `clerk_user_id`'s UNIQUE index is missing on production
(the repo's own `DUPLICATE_USER_CLEANUP.sql` and `DUPLICATE_USER_FIX_SUMMARY.md` are evidence this has happened).

### 12.8 `tagClassifier.writeCache` (`services/tagClassifier.ts:30-40`)

Fire-and-forget insert, `23505` explicitly tolerated (`:35`). Correct.

### 12.9 `batchApplyEmojisToGroupTransactions` (`:668-684`)

SELECT then N sequential UPDATEs, **none of which check `error`**. Re-entrant safe *only* because of the
`/\p{Emoji}/u` guard at `:675`: a second concurrent run's SELECT will already see the emoji on rows the first run
committed, and rows it hasn't reached yet get updated once by whichever run gets there. Two admins toggling
simultaneously cannot double-append. **CONFIRMED.** Partial failure mid-loop leaves the group half-emojified with no
error and no retry.

### 12.10 Are balances ever stored?

**No.** No balance column, table, materialised view, or RPC exists — grep for `balance` across `supabase/migrations/`
and `migrations/` returns nothing schema-related. Balances are computed on the client from the `transactions` cache
(`App.tsx:131-135`, `utils/calculations.ts:4-23`, re-derived independently in
`components/Dashboard.tsx`, `MemberBalances.tsx`, `GroupBalancesModal.tsx`, `BalanceBreakdownModal.tsx`,
`SettleUpModal.tsx:96-129`).

**There is therefore no balance read-modify-write to race — and that is not good news.** It means:

1. Correctness depends **entirely** on every device holding the **complete** transaction list for the group. One
   missed realtime INSERT and that device shows a different, confidently-rendered number than everyone else.
2. There is no server-side invariant that can detect the divergence. Nothing checks that balances sum to zero.
3. The two client booleans `allSettled` / `userSettled` (`App.tsx:138-139`) — computed from that possibly-incomplete
   list — are the **only** gate on destructive operations (`deleteGroup` at `:546`, `archiveGroup` at `:567`,
   and `AdminDeletionRequestsPanel.tsx:63` which passes a literal `true`). A device whose cache is missing the last
   three expenses will compute `allSettled === true` and let the user delete a group that is not settled.

That is the direct line from "device B doesn't update" to "money is wrong and a group gets deleted".

---

## 13. Findings

Severity: **P0** = exploitable now with real consequence (money corruption or cross-tenant leakage via realtime) ·
**P1** = will bite under normal use (silent data loss, wrong numbers shown, sync gaps) · **P2** = real debt ·
**P3** = hygiene.

---

### [S-01] The `tx` broadcast fallback is wired to nothing — a façade drops the callback argument
Severity: P1 · Confidence: CONFIRMED · Area: Sync / Realtime

**Location:** `services/apiService.ts:15` (two-parameter façade); `services/queries.ts:92-110` (three-argument call);
`services/supabaseApiService.ts:404-430` (real implementation, `onBroadcast` guard at `:422`);
`services/supabaseApiService.ts:479-487,565,658,694` (publisher).

**What is wrong:** `queries.ts` passes an `onBroadcast` handler as the third argument. The re-export in `apiService.ts`
declares and forwards only two parameters, so the third is silently discarded. `subscribeToTransactions` therefore never
executes `channel.on('broadcast', { event:'tx' }, …)` (`supabaseApiService.ts:422-426`). Every `tx` broadcast published
after add/edit/delete of a transaction is sent to the server, fanned out to every subscriber's socket, and dropped on
arrival. The comment that justifies the whole mechanism — *"Notify other group members via broadcast (bypasses
postgres_changes RLS filtering)"* (`:564`) — describes a safety net that has never existed in this build.
TypeScript would have flagged the call (TS2554); nothing in CI runs `tsc`, and esbuild does not typecheck.

**How to reproduce (two devices):** Sign in as members of the same group on A and B. On B open DevTools → Network → WS →
the `realtime/v1/websocket` frame list. On A add an expense. Observe a frame with `"event":"tx"` arriving at B, and
observe that B issues **no** `GET /rest/v1/transactions` in response. Set a breakpoint on `services/queries.ts:108` —
it is never hit.

**Blast radius:** Removes the only redundancy in the entire sync design. Any `postgres_changes` event that is not
delivered — dropped WAL record, expired subscription claims, table missing from the publication, channel in `errored`
state, socket asleep — is lost permanently, because nothing else will ever ask the server for it. This is the
structural reason the founder's symptom is *sticky* rather than transient.

**Why it exists:** `services/apiService.ts` is a hand-maintained pass-through façade over `supabaseApiService`
(header comment `:1-3`). The third parameter was added to the implementation (`supabaseApiService.ts:407`) and to the
caller (`queries.ts:107`) but not to the façade in between. No typecheck gate to catch it.

**Containment (minutes):** Change `services/queries.ts:92` to call `supabaseApi.subscribeToTransactions` directly, or
widen the façade signature at `apiService.ts:15` to `(personId, callback, onBroadcast?)` and forward it. One line.
**Do not ship this alone** — see S-11 and S-12; enabling the listener without also scoping the invalidate and making the
channel private turns on an amplification path.

**Correct fix:** (1) delete the pass-through façade for the five `subscribe*` functions and import
`supabaseApiService` directly from `queries.ts` — it exists only to add an indirection that has now cost a feature;
(2) add `npx tsc --noEmit` to CI so the next arity mismatch fails the build.

**Proof of fix:** With the listener wired, a breakpoint at `queries.ts:108` hits within one RTT of a write on the other
device; a `tsc --noEmit` run passes on the whole repo.

**Depends on / conflicts with:** must land together with S-11 (private channel) and S-12 (scoped invalidate).

---

### [S-02] Realtime DELETE events bypass RLS: the full contents of every deleted row reach every signed-in client
Severity: P0 · Confidence: LIKELY · Area: Realtime / Security

**Location:** `services/supabaseApiService.ts:391,411,436,453,470` (unfiltered `event:'*'` subscriptions on all five
tables); `migrations/enable_realtime.sql:5-9` (`REPLICA IDENTITY FULL`); `services/queries.ts:77,103,135,162,194-205`
(handlers that consume the unauthenticated stream).

**What is wrong:** Supabase's own documentation states: *"**Caution:** RLS policies are not applied to `DELETE`
statements, because there is no way for Postgres to verify that a user has access to a deleted record."*
(`https://supabase.com/docs/guides/realtime/postgres-changes`, fetched 2026-09-07). Combined with `REPLICA IDENTITY
FULL` — which puts **every column** of the deleted row into `old_record` — and with subscriptions that carry no
`filter` and no group scoping, every client of this app receives the complete contents of every row deleted from
`transactions`, `people`, `groups`, `group_members` and `payment_sources` **across the entire database**, for every
tenant. For `transactions` that is amount, description, comment, group id, payer id, payers, and the full split; for
`people` it is name, email, `clerk_user_id`, and the base64 avatar.

Second, functional half: `services/queries.ts:194-205` makes a **control-flow decision** on this unauthenticated
stream. Its only guard is `oldRow?.person_id === personId`. Any actor able to cause a `group_members` DELETE whose
`person_id` matches a victim's `people.id` — a UUID that is visible to every co-member and is embedded in
`split_participants` on shared rows — causes the victim's client to purge that group and all its transactions from
cache and (via `App.tsx:190-200`) to be bounced out of the group view. Under the current RLS
(`20260412000005:134-135`, delete restricted to `i_created_group`) that requires being a creator of *some* group; the
event delivery, however, is global.

**How to reproduce (two devices):** A and B signed in as **unrelated users with no shared group**. On B, open DevTools →
Network → WS → `realtime/v1/websocket`. On A, delete any expense. B's frame list shows a `postgres_changes` message with
`"eventType":"DELETE"` and an `old_record` containing A's expense description and amount. Repeat with a
`group_members` row and observe `services/queries.ts:194` executing on B.

**Blast radius:** Cross-tenant disclosure of financial data (amount, description, counterparties) and PII (name, email)
to every connected client, continuously, with no audit trail. Plus a remote cache-poisoning primitive against any user
whose `person_id` is known.

**Why it exists:** `event: '*'` with no `filter` was the simplest way to get realtime working (see `ENABLE_REALTIME.md`,
which is a troubleshooting doc for exactly this feature). `REPLICA IDENTITY FULL` was set because DELETE filtering
requires it. Nobody checked what the combination implies for DELETE, and the vendor's caveat is a single line in the
middle of a long page.

**Containment (minutes):** Split each subscription into `INSERT`/`UPDATE` bindings (which *are* RLS-filtered) and stop
subscribing to `DELETE` on the wire. Handle deletions by invalidating instead: on a soft signal, refetch. Concretely,
replace each `{ event: '*' }` with two bindings `{ event: 'INSERT' }` and `{ event: 'UPDATE' }`. That immediately stops
the leak; the cost is that deletions no longer propagate until the next refetch — which S-06's resume-reconcile fixes.

**Correct fix:** Stop using `postgres_changes` for cross-user fan-out. Move to **private** Broadcast channels
scoped per group (`realtime.broadcast_changes()` from a database trigger, with `realtime.messages` RLS keyed on group
membership), so the server decides who may join `group:<id>` before any payload is sent. Until then, at minimum:
drop `REPLICA IDENTITY FULL` back to `DEFAULT` on `people` and `transactions` (so `old_record` carries only the PK),
and add `filter` clauses where the schema allows.

**Proof of fix:** With two unrelated accounts, deleting a row on A produces no `postgres_changes` frame on B's socket.
An automated check: subscribe with the anon key only and assert zero frames on delete.

**Depends on / conflicts with:** S-11 (private channels) is the same fix. Fixing this changes how deletions propagate,
so S-06 must land with it.

---

### [S-03] `updateGroup` deletes and re-inserts the entire membership: kicks viewers out, ejects new joiners, can orphan the group
Severity: P1 · Confidence: CONFIRMED · Area: Concurrency / Sync

**Location:** `services/supabaseApiService.ts:326-373` (statements at `:337-342`, `:350-353`, `:358-369`);
consumers `services/queries.ts:186-213`; `App.tsx:190-200,377-412`.

**What is wrong:** Three independent PostgREST requests with no transaction and no lock. Every save of the group form —
including a pure rename — issues `DELETE FROM group_members WHERE group_id = ?` followed by a re-INSERT of the roster
the form was holding.

Three distinct failures follow:
1. **Every other member is kicked out of the group they are viewing.** The DELETE for their own row hits
   `queries.ts:194-205`, which removes the group and every transaction of that group from their cache; `App.tsx:198`
   then clears `selectedGroupId`. The subsequent INSERT restores the data but not the selection.
2. **A member who joined while the form was open is silently ejected.** The re-INSERT uses the *snapshot* the modal
   loaded. `accept_group_invite` takes `FOR UPDATE` on the invite row but nothing on `group_members`, so it cannot
   defend itself. The invite's `current_uses` is already consumed (`20260812000000:239-247`), so with `max_uses = 1`
   the ejected user cannot rejoin. Full interleaving in §10.2.
3. **A failure between DELETE and INSERT leaves the group with zero members** — including the creator. `getGroups`
   (`:136-166`) uses `group_members!inner`, so the group then disappears from **everyone's** UI while its transactions
   remain in the database, unreachable without SQL. Statement 3 is also skipped entirely when the roster is empty
   (`:358`), so this is a silently-valid state.

**How to reproduce (two devices):**
(a) A (creator) and B both open group G; B is looking at the transaction list. A opens Group Settings, changes only the
name, saves. B is bounced to the home screen and the group briefly vanishes.
(b) A opens Group Settings for G and leaves it open. On a third device, N accepts an invite to G and confirms they see
G. A now taps Save. N's group disappears and their invite is spent.
(c) Throttle A's network to "Offline" in DevTools immediately after the DELETE request completes, then save. The group
has zero members.

**Blast radius:** Silent membership loss, unrecoverable-by-user group orphaning, and `2N+1` realtime events per group
save fanned out to every client (§2.2 means the N DELETEs go to *everyone*, not just members).

**Why it exists:** "Replace the child rows" is the obvious way to express a set update over a REST table API when you
cannot open a transaction. There is no server-side function for group updates, even though the codebase already proves
it knows how to write one (`accept_group_invite`).

**Containment (minutes):** In `updateGroup`, compute the diff instead of the replace: `toAdd = new \ old`,
`toRemove = old \ new`; issue `INSERT` for `toAdd` and `DELETE … WHERE person_id IN (toRemove)`. A rename then emits
zero `group_members` events, which removes failures 1 and 2 for the overwhelmingly common case and shrinks the window
for 3. ~15 lines, no schema change.

**Correct fix:** A `SECURITY DEFINER` plpgsql `update_group(p_group_id, p_name, …, p_members uuid[])` that does the
whole thing in one transaction with `SELECT … FOR UPDATE` on the group row, modelled on `accept_group_invite`. Add
`UNIQUE(group_id, person_id)` reliance for the upsert and refuse an empty roster.

**Proof of fix:** Renaming a group produces exactly one `groups` UPDATE frame and zero `group_members` frames on a
second device's socket; the reproduction in (b) leaves N in the group.

**Depends on / conflicts with:** S-02 (the DELETE fan-out is what makes failure 1 global). Independent of S-01.

---

### [S-04] Adding an expense writes no cache — the writer's own screen depends on the realtime round trip
Severity: P1 · Confidence: CONFIRMED · Area: Sync / Cache

**Location:** `App.tsx:347-362`, specifically `:353-356`; contrast `App.tsx:794-798` (settle-up) and `:352` (edit).
Same pattern for payment sources at `App.tsx:493-501` (`:496`).

**What is wrong:** `handleSaveTransaction` awaits `api.addTransaction(...)`, **discards the returned row**, and closes
the modal. The comment says *"realtime bridge will update cache for all users consistently"* (`:354`). So the one
operation the app exists to perform is the only mutation with no local cache write. If the `postgres_changes` INSERT
does not arrive — for any of the reasons in S-01/S-02/S-06 — the user taps Save, the form closes, and the expense is
simply not there. There is no toast on success and no toast on failure (`catch` at `:359-361` is `console.error`).

**How to reproduce (single device, no second device needed):** In DevTools, block the WebSocket
(`realtime/v1/websocket`) via the Network request-blocking panel, or run the app with realtime disabled. Add an
expense. The modal closes and the list does not change. Reload — the expense is there. Now do the same for a
**settlement** and observe it appears immediately: proof that the asymmetry is in the client, not the server.

**Blast radius:** The headline symptom. Users re-enter expenses they believe failed (see S-07 — the Save button is not
disabled), producing duplicates; balances are wrong for everyone until a reload.

**Why it exists:** A deliberate choice ("for all users consistently") that trades certainty for a single code path. It
is defensible only if realtime delivery is guaranteed, which it is not — postgres_changes is at-most-once and this app
has no backfill.

**Containment (minutes):** Two lines — capture the returned transaction and prepend it to the cache with the same
dedupe guard the settle-up path already uses:
`const created = await api.addTransaction(...); qc.setQueryData<Transaction[]>(qk.transactions(currentUserId),
(prev=[]) => prev.some(t=>t.id===created.id) ? prev : [created, ...prev]);` — copied verbatim from `App.tsx:794-798`.

**Correct fix:** Route every mutation through `useMutation` with `onMutate` (true optimistic write + snapshot),
`onError` (rollback), and `onSettled` (invalidate). That gives instant UI, a rollback path, and removes the
post-await-write pattern everywhere at once. The `queryClient` is already configured for mutations
(`lib/queryClient.ts:11-13`) and no code uses it.

**Proof of fix:** With the WebSocket blocked, a newly added expense appears in the list immediately and survives a
reload.

**Depends on / conflicts with:** Pairs with S-07 (the double-tap guard). Makes S-06 less acute but does not replace it.

---

### [S-05] Writes with no affected-row check followed by unconditional cache mutations — the "phantom" class
Severity: P1 · Confidence: CONFIRMED · Area: Cache / Sync

**Location:** `services/supabaseApiService.ts:2-6, 7-19, 22-31, 245-277, 317-324, 668-684, 686-696, 736-745, 747-756,
1209-1220, 1232-1243`; consumers `App.tsx:337-338, 510-511, 522-525, 546-547, 566-568`,
`components/SettingsModal.tsx:86-88`, `components/AdminDeletionRequestsPanel.tsx:79-81`,
`components/ArchivedGroupsModal.tsx:51-52`.

**What is wrong:** PostgREST returns HTTP success with zero rows affected when RLS filters a row out of an
`UPDATE`/`DELETE`. Only `.select().single()` converts that into an error (PGRST116). Thirteen write paths omit the
select **and** the row count, then the caller mutates the cache as if the write had happened. The repo has already
been bitten by exactly this: `supabase/migrations/20260412000008_allow_members_to_delete_transactions.sql:4-8` says
*"Non-creator members see an apparent delete (optimistic UI) but the DB silently rejects it, so the transaction
reappears on next refresh."* That migration widened one policy; it did not remove the pattern.

Two of these are unconditional, not conditional, failures:
- `archiveGroup` (`:22-31`) throws for owners in JS (`:23`) while RLS only permits owners to `UPDATE groups`
  (`20260412000005:110-111`). The two conditions are **mutually exclusive**, so the statement updates zero rows for
  every caller who reaches it — yet `App.tsx:568` marks the group archived in cache and no error is shown. Archiving a
  group has never worked and always looks like it did.
- `unarchiveGroup` (`:2-6`) has the same RLS gate; `ArchivedGroupsModal.tsx:52` removes it from a **local list**, so
  the modal reports success even for the one caller who could not possibly succeed.

**How to reproduce (two devices):** B is a non-creator member of group G with an expense E.
Before applying migration `…000008`, B deletes E: E vanishes on B, is untouched on A, and reappears on B after reload.
For the always-failing case: as a non-creator with a fully settled group, archive it. The group leaves the list; reload
and it is back, still unarchived, on both devices.

**Blast radius:** The cache and the database disagree with no error anywhere. Because balances are derived from that
cache (§12.10), the two devices show different money. Users learn not to trust the UI.

**Why it exists:** `.delete().eq()` / `.update().eq()` reads naturally and the supabase-js result shape makes the
zero-rows case easy to miss. There is no lint rule and no typecheck that would catch it.

**Containment (minutes):** Append `.select('id')` to every one of the thirteen statements and throw when
`data.length === 0`. Mechanical, no behaviour change on the happy path. Highest-value three first:
`deleteTransaction` (`:686-696`), `archiveGroup` (`:22-31`), `updateUserAvatar` (`:1232-1243`).

**Correct fix:** A single `assertAffected(result, n)` helper used by every write in `supabaseApiService.ts`, plus
`useMutation` `onError` rollback (S-04) so a rejected write visibly reverts instead of silently persisting in cache.

**Proof of fix:** As a non-creator, every destructive action either succeeds in the database or surfaces an error toast;
no action leaves the cache and the database disagreeing.

**Depends on / conflicts with:** `archiveGroup`'s fix also needs the RLS policy or the JS guard corrected (Pass 1.1
material) — the row-count check alone will turn a silent lie into a permanent error toast.

---

### [S-06] No resume or reconnect reconciliation — a backgrounded device never learns what it missed
Severity: P1 · Confidence: CONFIRMED (absence) / LIKELY (platform behaviour) · Area: Sync

**Location:** `lib/queryClient.ts:8` (`refetchOnWindowFocus: false`); `index.tsx:44-46` (`appStateChange` listener that
only logs); absence of any `visibilitychange`/`pageshow`/`resume` handler anywhere in the repo;
`contexts/SupabaseAuthContext.tsx:67-74` (the 50 s timer that stops when the app is suspended);
`hooks/useBackButton.ts:15-79` (not a resume hook).

**What is wrong:** `postgres_changes` is at-most-once. Anything that happens while a client's socket is down is gone.
The app's only recovery mechanism is TanStack's `refetchOnReconnect`, which fires on the browser's `online` event —
and a phone that was in Doze, or a tab that was discarded, or a socket the Realtime server closed on token expiry,
typically does **not** produce an `online` transition, because the network was never reported as lost. Meanwhile
`refetchOnWindowFocus` is explicitly disabled, there is no `visibilitychange` handler, and the Capacitor
`appStateChange` handler that would be the perfect hook is a `console.log`.

**How to reproduce (two devices):** B is an Android/PWA client viewing group G. Background B (home button) for 5
minutes. During that time, A adds three expenses and edits one. Foreground B. B's list and B's "you are owed" figure
are unchanged. Pull down, tap around, switch groups — nothing refetches. Only killing and relaunching the app, or
toggling airplane mode (which *does* produce `online`), corrects it.

**Blast radius:** Every user of the Android build, every day. This is the mechanism that converts any single missed
event into a persistent, user-visible wrong number, and it is what makes the founder's symptom feel like "sync is just
broken" rather than "one event got lost".

**Why it exists:** `refetchOnWindowFocus: false` was chosen to "avoid surprise reloads when tab focus changes"
(`lib/queryClient.ts:8`) — a desktop-shaped decision applied to a mobile-first app, with no replacement for the mobile
resume signal.

**Containment (minutes):** One `useEffect` in `App.tsx`:
```ts
useEffect(() => {
  const onResume = () => { if (document.visibilityState === 'visible') qc.invalidateQueries(); };
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('online', onResume);
  return () => { document.removeEventListener('visibilitychange', onResume); window.removeEventListener('online', onResume); };
}, [qc]);
```
`staleTime: 30_000` already prevents this from thrashing on quick tab switches.

**Correct fix:** The above, plus (a) also force a Realtime rejoin on resume (`supabase.realtime.disconnect();
supabase.realtime.connect()` or re-running `setRealtimeAuth()`), because an invalidate does not repair a dead socket;
and (b) surface real socket health in the UI (S-09) so the user can tell.

**Proof of fix:** The reproduction above shows the three expenses within a second of foregrounding, with a visible
`GET /rest/v1/transactions` in the network log.

**Depends on / conflicts with:** Makes S-02's containment (dropping DELETE subscriptions) viable. Complements S-04.

---

### [S-07] The expense Save button has no in-flight guard — a double-tap creates two expenses, with no idempotency
Severity: P1 · Confidence: CONFIRMED · Area: Sync / Concurrency

**Location:** `components/TransactionFormModal.tsx:685-691` (button, `disabled={!isSplitValid || !description ||
!amount}`), `:283-364` (`handleSubmit`, calls `onSave` at `:355` without awaiting);
`App.tsx:347-362`; `services/supabaseApiService.ts:537-624` (no client id, no idempotency key).

**What is wrong:** The Save button has no `submitting` state. `handleSubmit` is `async` and does not await `onSave`, so
the modal remains mounted and the button remains enabled for the whole of: `classifyDescription`
(`:290-300` — a Supabase `ai_item_cache` SELECT plus a Gemini Edge Function call), the `INSERT` round trip, and the
2–3 dead extra reads in `addTransaction`'s email block (`supabaseApiService.ts:568-621`). On mobile that is often
>1 s. Two taps insert two rows with server-generated UUIDs and no unique constraint to catch them.

This compounds with S-04: because the add path writes no cache, the user gets **no feedback at all** during the wait,
which is precisely what makes people tap again.

**How to reproduce (one device):** Throttle to "Slow 3G". Add an expense and tap Save twice ~300 ms apart. Reload:
two identical expenses, and the group's balances are off by exactly the amount.

**Blast radius:** Duplicate expenses are money corruption. They are also hard to spot — the two rows are identical
except for the id and are adjacent in a date-sorted list.

**Why it exists:** `SettleUpModal.tsx:85` and `MemberInviteModal.tsx:107` both got the guard; the expense form did not.
No shared submit-button component.

**Containment (minutes):** Add `const [submitting, setSubmitting] = useState(false)` to `TransactionFormModal`, set it
around `await onSave(...)`, and add `|| submitting` to the `disabled` expression at `:688`. Four lines, matching
`SettleUpModal.tsx:85` exactly.

**Correct fix:** The above, plus a client-generated `id` (`crypto.randomUUID()`) on the insert payload so a retry — by
the user, by a future `useMutation` retry, or by a flaky network that delivered the request but lost the response —
collides on the primary key instead of creating a second row.

**Proof of fix:** On Slow 3G, the second tap is a no-op; exactly one row exists after reload.

**Depends on / conflicts with:** Should ship with S-04 (a cache write gives the user the feedback that removes the urge
to tap again).

---

### [S-08] The `people` cache is never invalidated when membership changes — new members are invisible on other devices
Severity: P1 · Confidence: CONFIRMED · Area: Cache / Sync

**Location:** `services/queries.ts:209-213` (invalidates `groups` only); `services/apiService.ts:43-73`
(`addPersonToGroup` — the `people` insert precedes the `group_members` insert); `App.tsx:224` and
`components/invite/InvitePage.tsx:129,278` (invite accept invalidates `groups` only); `App.tsx:592` (member list is
derived by intersecting `groups[].members` with the `people` cache).

**What is wrong:** When someone else is added to a group — via `addPersonToGroup` or via `accept_group_invite` — other
members receive the `group_members` INSERT and invalidate `groups`, so the `members` **UUID array** updates. The
`people` query is never invalidated, so the new person's `Person` row is not in the cache. `App.tsx:592`
(`people.filter(p => selectedGroup.members.includes(p.id))`) then silently omits them. The `people` INSERT event that
*would* have supplied the row is dropped by RLS, because at the instant it is written the two users do not yet share a
group (`i_can_see_person`, `20260728000000:29-75`) — the `group_members` row is written afterwards.

The result on every other member's device: the group shows N+1 members in its `members` array but N in every list,
the new person cannot be selected as a payer or a split participant, and `calculateShares` never assigns them a share.

**How to reproduce (two devices):** A (creator) and B are in group G, both with the app open. A opens Group Settings →
Add Member → adds C by name. On A, C appears (the `groupMemberAdded` DOM event, `GroupFormModal.tsx:461-465`, refetches
`people`). On B, open Add Expense: C is **not** in the split list, and the member count in Group Settings disagrees
with the rendered avatars. Reload B — C appears.

**Blast radius:** Expenses created on B silently exclude C from the split. That is a wrong balance for every member of
the group, originating from a UI that gave no indication anything was missing. This is the same bug class
`MEMBER_DISPLAY_BUG_FIX.md` documents fixing in a different component.

**Why it exists:** The `groupMemberAdded` DOM event (`App.tsx:281-301`) was added as a local patch for exactly this
symptom on the *adding* device, and it refetches both `people` and `groups` (`:286-290`). The realtime bridge that
handles the same situation for *other* devices (`queries.ts:209-213`) was never given the second invalidate.

**Containment (minutes):** One line — add `qc.invalidateQueries({ queryKey: qk.people(personId) })` next to
`services/queries.ts:212`, and also at `:189-190` (the "I was added" branch) and after the invite-accept invalidates at
`App.tsx:224` / `InvitePage.tsx:129,278`.

**Correct fix:** The above, plus delete the `groupMemberAdded` DOM event entirely — with the bridge fixed, it is a
redundant same-tab-only duplicate of the realtime path (`GroupFormModal.tsx:461-465`, `App.tsx:281-301`, ~25 lines).

**Proof of fix:** Reproduction above: C appears on B within one RTT with no reload.

**Depends on / conflicts with:** None. Safe to ship alone.

---

### [S-09] The "Live" badge is decorative — the heartbeat channel proves nothing about data delivery
Severity: P2 · Confidence: CONFIRMED · Area: Realtime

**Location:** `components/RealtimeStatus.tsx:7-32`, rendered at `App.tsx:848`.

**What is wrong:** `supabase.channel('heartbeat')` is created with **no bindings whatsoever** — no `postgres_changes`,
no `broadcast`, no presence. It reports `SUBSCRIBED` as soon as the WebSocket is up and an empty channel joins. That is
independent of whether the five tables are in the `supabase_realtime` publication, whether the data channels joined,
whether their stored JWT claims are still valid, and whether RLS is delivering anything. The component's own error
string names the right diagnosis — *"This often means the table is not in the supabase_realtime publication or RLS is
blocking the connection"* (`:18`) — for a condition it structurally cannot detect.

**How to reproduce (one device):** Remove `transactions` from the publication (or simply subscribe with an expired
token). The badge stays green while zero events are delivered.

**Blast radius:** Both the user and the developer are told sync is healthy when it is not. This is the reason the
founder's bug survives triage: the app says "Live".

**Why it exists:** A monitor for the *socket* was needed and a bindingless channel is the cheapest way to get one.
Nobody distinguished socket health from subscription health.

**Containment (minutes):** Derive the badge from the real channels instead: read
`supabase.getChannels().filter(c => c.topic.startsWith('realtime:public:'))` and show green only when **all five** are
in state `joined`. ~10 lines, no new channel.

**Correct fix:** The above, plus an end-to-end liveness probe: on mount, and on resume, compare a cheap
`GET /rest/v1/transactions?select=id&limit=1&order=created_at.desc` against the cache; if they disagree, show
"reconnecting" and invalidate. That measures what the user actually cares about.

**Proof of fix:** Blocking the `postgres_changes` channel while leaving the socket up turns the badge red.

**Depends on / conflicts with:** Feeds S-06 (a real signal gives the resume handler something to act on).

---

### [S-10] Concurrent edits are last-write-wins with whole-object splits, no version, and `updated_at` discarded
Severity: P1 · Confidence: CONFIRMED · Area: Concurrency / Sync

**Location:** `services/supabaseApiService.ts:626-660` (especially `:635`, `:643-646`);
`services/supabaseApiService.ts:78-108` (`updated_at` not mapped); `types.ts` (no version field);
`services/queries.ts:102` (wholesale cache replace); `App.tsx:351-352`.

**What is wrong:** `updateTransaction` sends a PATCH of whichever fields differ from `undefined`; in practice the form
supplies all of them. `split` and `payers` are whole JSONB objects — there is no per-participant merge. There is no
version column, no `If-Unmodified-Since`, no refetch-before-save, and the `updated_at` the database does maintain is
dropped by `transformDbTransactionToAppTransaction`. The realtime UPDATE handler replaces the cached object wholesale
(`queries.ts:102`), so the loser of a race is silently overwritten on their own screen with no notification and no
history (the schema has no `updated_by` and no audit table).

There is a second, subtler ordering hole: A's own post-await `setQueryData` at `App.tsx:352` can land **after** B's
realtime UPDATE for the same row, overwriting newer server state with A's stale response. Nothing ever reconciles it
(§5).

**How to reproduce (two devices):** A and B both open the same expense (₹1000, split equally over three).
A changes the amount to ₹1200 and saves. Without reloading, B changes only the split to unequal and saves.
The database now holds ₹1000 with B's split; A's ₹1200 is gone, and A's screen updates to it with no indication that A's
edit was discarded. Both users' balances change without either understanding why.

**Blast radius:** Silent money loss in the most common collaborative action in an expense splitter. Frequency scales
with how well sync works — ironically, fixing the delivery bugs makes this one more visible, not less.

**Why it exists:** REST-over-table PATCH with no concurrency token is the default shape of a PostgREST client. Nothing
in the stack pushes back.

**Containment (minutes):** Carry `updated_at` through `transformDbTransactionToAppTransaction` (`:91-107`, one line)
into `types.ts`, and add `.eq('updated_at', transactionData.updatedAt)` to the PATCH in `updateTransaction`
(`:648-652`). With `.select().single()` already present, a lost race becomes a PGRST116 — surface it as
"This expense was changed by someone else. Reload and try again."

**Correct fix:** The above plus a real conflict UX: on 409, refetch the row, diff it against the user's draft, and show
what changed rather than discarding their input. Longer term, split-participant edits should be an append-only
operation rather than a whole-array replace.

**Proof of fix:** The reproduction above ends with B seeing an explicit conflict message and A's ₹1200 intact.

**Depends on / conflicts with:** Independent, but reads best alongside S-04's `useMutation` refactor.

---

### [S-11] All Realtime channels are public — anyone with the anon key can join `public:transactions`
Severity: P2 · Confidence: LIKELY · Area: Realtime / Security

**Location:** `services/supabaseApiService.ts:390,410,435,452,469`; `components/RealtimeStatus.tsx:11`;
`lib/supabase.ts:66-70`; `vite.config.ts:145-147` (anon key inlined into the bundle).

**What is wrong:** No channel sets `config: { private: true }`. Supabase's Broadcast documentation states that for a
public topic *"Anyone can subscribe to that topic without authentication."* The anon key ships in the JS bundle. So any
third party can join `realtime:public:transactions` and read every `tx` broadcast — a live feed of **group UUIDs**
system-wide (`supabaseApiService.ts:486`) — and can also *send* forged `tx` events on the same topic.

Today the send side is inert only because of S-01. **Fixing S-01 without this one turns a decorative hole into an
amplification DoS**: one forged broadcast → every connected client runs the unbounded two-request
`getTransactions` refetch (S-12).

**How to reproduce:** From any machine, with only the public anon key and project URL:
```js
const c = createClient(URL, ANON).channel('public:transactions')
c.on('broadcast', {event:'tx'}, p => console.log(p)).subscribe()
```
Observe group UUIDs from other tenants. Then `c.send({type:'broadcast', event:'tx', payload:{groupId:'x'}})`.

**Blast radius:** Group-identifier enumeration today; a one-packet refetch storm the moment S-01 lands. Whether
"Allow public access" is still on for the production project cannot be read from the repo (§15).

**Why it exists:** Private channels require `realtime.messages` RLS policies, which nobody wrote; the default is public
and it "just worked".

**Containment (minutes):** Disable "Allow public access" in Supabase → Realtime Settings, and pass
`{ config: { private: true } }` at the five `supabase.channel(...)` sites — but **only after** writing the
`realtime.messages` policies, or every channel stops joining.

**Correct fix:** Per-group topics (`group:<uuid>`) with `realtime.messages` RLS keyed on
`i_am_member_of(<uuid extracted from topic>)`. That is also the correct destination for S-02.

**Proof of fix:** The anonymous snippet above fails to join.

**Depends on / conflicts with:** **Blocks S-01** — do not enable the broadcast listener until this is done.
Same target architecture as S-02.

---

### [S-12] The (intended) broadcast handler invalidates the entire transactions key on every system-wide write
Severity: P2 · Confidence: CONFIRMED · Area: Cache

**Location:** `services/queries.ts:107-109`; `services/supabaseApiService.ts:490-535` (`getTransactions`);
`services/supabaseApiService.ts:481-487` (publisher sends on a global topic).

**What is wrong:** The handler receives `groupId` and **discards it** (`_groupId`), invalidating
`['transactions', personId]` — the whole list. `getTransactions` is two sequential HTTP requests returning *every*
transaction in *every* group the user belongs to, unpaginated. The broadcast topic is global (`public:transactions`),
not per-group, so this would fire on writes to groups the receiver is not even in. Arithmetic: `U` connected clients ×
`W` writes/second → `2 × U × W` unbounded table scans/second. A three-user group splitting 20 dinner items produces
120 full-history fetches in a couple of minutes.

**How to reproduce:** After fixing S-01, open three clients and add ten expenses on one. Count
`GET /rest/v1/transactions` in the others' network logs: 20 each.

**Blast radius:** Egress and Postgres load that grows as `O(users × writes × history)`. Currently dormant.

**Why it exists:** `invalidateQueries` is the safe default; the `groupId` payload was added but never used.

**Containment (minutes):** Ignore the broadcast for groups the client is not viewing, or drop the broadcast mechanism
entirely once `postgres_changes` is reliable — the `postgres_changes` INSERT already carries the full row and needs no
refetch at all.

**Correct fix:** Make the transactions query per-group (`['transactions', personId, groupId]`) so an invalidate is
scoped, and paginate `getTransactions`. That also fixes the unbounded initial load noted in map §0.8.

**Proof of fix:** A write in group X causes at most one scoped refetch, and none at all on clients not in X.

**Depends on / conflicts with:** Must land with S-01.

---

### [S-13] `archiveGroup` can never succeed but always reports success
Severity: P2 · Confidence: CONFIRMED · Area: Sync / Cache

**Location:** `services/supabaseApiService.ts:22-31` (`:23` throws for owners; `:28` update with no select);
RLS `"Users can update their groups" FOR UPDATE USING (i_created_group(id))`
(`supabase/migrations/20260412000005:110-111`); caller `App.tsx:563-576` (`:568` patches the cache).

**What is wrong:** The JS guard rejects the only role RLS permits. Every caller who gets past `:23` is a non-creator,
whose `UPDATE groups` matches zero rows and returns success. `App.tsx:568` then sets `isArchived: true` in cache and no
error is shown. Archiving appears to work and never does; the group returns on reload, and on every other device
immediately.

**How to reproduce (two devices):** B (non-creator) settles up fully and archives group G. G disappears from B's list.
On A nothing changes. Reload B: G is back.

**Blast radius:** A whole user-facing feature is a no-op that lies. It also keeps `ArchivedGroupsModal` permanently
empty for non-creators, which hides the bug.

**Why it exists:** The JS guard encodes a product rule ("owners delete, members archive") that the RLS policy
(written later, in the Clerk cut-over) does not implement.

**Containment (minutes):** Add `.select('id')` and throw on zero rows (S-05) so the user at least gets an honest
failure.

**Correct fix:** Decide the product rule and implement it in one place. If any member may archive, add an RLS policy
`FOR UPDATE USING (i_am_member_of(id))` restricted to the `is_archived` column (or a
`SECURITY DEFINER archive_group(uuid)` RPC). If archiving is meant to be per-user, it needs a new table — the current
`groups.is_archived` is global, so archiving hides the group from *everyone*, which is probably not the intent either.

**Proof of fix:** A non-creator archives; the group is archived on both devices and survives reload.

**Depends on / conflicts with:** S-05 (row-count checks). Product decision required.

---

### [S-14] `_txPublishChannel` is a module singleton that aliases and outlives a bridge-owned channel
Severity: P2 · Confidence: LIKELY · Area: Realtime

**Location:** `services/supabaseApiService.ts:479-487`; interaction with `services/queries.ts:112-114`
(`pgSub.unsubscribe()`), and with realtime-js 2.15.5 topic dedupe.

**What is wrong:** `supabase.channel('public:transactions')` dedupes by topic, so `_txPublishChannel` is **the same
object** the transactions bridge created, joined, and will later unsubscribe. It is never reset, never unsubscribed,
and never re-authed. After the bridge's cleanup runs (sign-out, or a `personId` change), the singleton points at a
closed channel; the next `_broadcastTxChange` falls back to an **HTTP POST to the broadcast endpoint** on every
subsequent transaction write, for the life of the page. It also survives a sign-out, so a second user on the same page
instance publishes through a channel created under the first user's session.

Separately, `_txPublishChannel.subscribe()` at `:484` is a benign early-return in 2.15.5 but **threw**
(`"tried to subscribe multiple times"`) in older realtime-js. That throw would land *after* the INSERT had committed
and be swallowed by `App.tsx:359`, leaving the row saved and the modal open. It is a live upgrade landmine.

**How to reproduce:** Sign out and back in without reloading, then add an expense; observe a
`POST …/realtime/v1/api/broadcast` in the network log instead of a WS frame.

**Blast radius:** An extra HTTP request per write plus a cross-session reference. Small today; a correctness hazard on
the next `@supabase/supabase-js` bump.

**Why it exists:** The comment at `:477-478` shows the author intended to share the subscriber's authenticated topic —
which is exactly what happens, but the code is written as if it were creating and owning a second channel.

**Containment (minutes):** Delete `_txPublishChannel` and the `subscribe()` call; publish through
`supabase.channel('public:transactions').send(...)` at the call site, relying on the dedupe. Or, better, delete
`_broadcastTxChange` entirely (`:481-487` plus the three call sites `:565`, `:658`, `:694`) — `postgres_changes`
already delivers the row and, per S-12, the broadcast adds only cost.

**Correct fix:** Remove the broadcast mechanism; keep exactly one channel per topic, owned by the bridge.

**Proof of fix:** Grep shows one `supabase.channel(` per topic; no `POST …/broadcast` appears in the network log.

**Depends on / conflicts with:** Overlaps with S-01/S-12 — deleting the broadcast resolves all three.

---

### [S-15] StrictMode double-mount plus channel dedupe can leave realtime silently dead in development
Severity: P2 · Confidence: LIKELY · Area: Realtime

**Location:** `index.tsx:80` (`React.StrictMode`); `services/queries.ts:50-84,90-115,121-142,148-169,180-216`
(effect + `unsubscribe` cleanup); realtime-js 2.15.5 `channel()` dedupe and `subscribe()`'s
`state == CHANNEL_STATES.closed` guard.

**What is wrong:** In development React mounts, unmounts, and remounts each effect. Mount joins the channel; cleanup
calls `unsubscribe()` which moves it to `leaving` and removes it from `socket.channels` only after the server's LEAVE
reply; the synchronous remount's `channel()` lookup still finds the `leaving` instance, returns it, attaches a
**second** set of `.on()` bindings, and calls `subscribe()` — which returns early because the state is not `closed`.
The LEAVE then completes and the channel is gone. Depending on the exact LEAVE timing, dev realtime is either dead or
firing every handler twice.

**How to reproduce:** `npm run dev`, sign in, and watch the console for the bridge callbacks while another device
writes. Compare against a production build.

**Blast radius:** Developers cannot reliably reproduce or verify sync behaviour locally, which is a direct cause of
this bug class surviving. Production builds do not double-invoke effects, so end users are unaffected.

**Why it exists:** The `useEffect` + `unsubscribe` pattern is correct in isolation; it interacts badly with a
topic-deduping client and StrictMode's remount.

**Containment (minutes):** Move the five subscriptions out of per-component effects into a single module-level
registry created once (ref-counted), or await `unsubscribe()` before allowing a re-subscribe.

**Correct fix:** One `useRealtime(personId)` hook that owns all five channels, keyed by `personId`, with a guard flag
that survives StrictMode's remount — the standard pattern for non-idempotent effect resources.

**Proof of fix:** In dev, a write on another device produces exactly one bridge callback.

**Depends on / conflicts with:** Independent, but should be fixed *before* attempting to verify any other finding
locally.

---

### [S-16] The deletion-request workflow and unarchive propagate to nothing
Severity: P2 · Confidence: CONFIRMED · Area: Sync

**Location:** `services/supabaseApiService.ts:220-242,245-277,317-324` (`group_deletion_requests`, not in the realtime
publication and with no bridge); `components/AdminDeletionRequestsPanel.tsx:34-49,65,81` (component-local state, reloads
only when re-opened); `services/supabaseApiService.ts:2-6` + `components/ArchivedGroupsModal.tsx:51-52` (unarchive
updates only local list state).

**What is wrong:** A member files a deletion request; the admin's device learns about it only if the admin happens to
open Settings afterwards. The admin rejects it; the requester is never told, on any device, ever — there is no
notification mechanism in the app at all. Unarchiving updates a modal-local array, so the caller's own `groups` cache
is corrected only if the realtime `groups` UPDATE arrives.

**How to reproduce (two devices):** B requests deletion of group G. A leaves Settings open — nothing appears.
A closes and reopens Settings — it appears. A rejects. B sees nothing, ever.

**Blast radius:** A workflow users will assume is broken. Low data risk; high "the app doesn't work" perception.
(Note map §0.4.3: `group_deletion_requests` has RLS enabled with **zero policies** in the repo, so this feature may be
entirely dead in production regardless — carried to §15.)

**Why it exists:** The feature was built with local component state before the query layer existed and never migrated.

**Containment (minutes):** Move `getPendingDeletionRequests` into a TanStack query and invalidate it from the existing
`groups` bridge; make `ArchivedGroupsModal` use `qc.setQueryData(qk.groups(...))` instead of local state.

**Correct fix:** Add `group_deletion_requests` to the realtime publication with a bridge, or (better) drop the polling
model and return pending requests as part of the `groups` query payload.

**Proof of fix:** A's open Settings panel shows B's new request without being reopened.

**Depends on / conflicts with:** None.

---

### [S-17] `requestGroupDeletion` is a select-then-insert race on a UNIQUE column, and the constraint is permanent
Severity: P2 · Confidence: CONFIRMED · Area: Concurrency

**Location:** `services/supabaseApiService.ts:220-242` (`:225-230` select, `:235-239` insert);
`group_deletion_requests.group_id UNIQUE` (map §0.4.1, from `migrations/20251116…:18`);
error surfaced verbatim at `App.tsx:557`.

**What is wrong:** Two members requesting deletion of the same group concurrently both pass the
`maybeSingle()` check and both insert; the loser receives a raw PostgreSQL `23505` whose message
(`duplicate key value violates unique constraint …`) is shown to the user as a toast. Worse, the constraint is
`UNIQUE(group_id)`, not partial on `status='pending'` — so once any request is **rejected**, no one can ever file
another one for that group, and the error they get is the same duplicate-key string.

**How to reproduce (two devices):** B and C both tap "Request deletion" for G within the same second. One gets a
success toast, the other gets `duplicate key value violates unique constraint "group_deletion_requests_group_id_key"`.
Then have A reject; B tries again and gets the same error forever.

**Blast radius:** A dead-end workflow with a database error string as the UX.

**Why it exists:** Check-then-act is the natural shape without an `ON CONFLICT`; the UNIQUE was added to prevent
duplicates without considering the rejected-then-retry case.

**Containment (minutes):** Replace `:225-239` with a single
`INSERT … ON CONFLICT (group_id) DO NOTHING RETURNING id`, and treat "no row returned" as "already pending".

**Correct fix:** The above, plus change the constraint to
`CREATE UNIQUE INDEX … ON group_deletion_requests(group_id) WHERE status = 'pending'` so a rejected request does not
block future ones.

**Proof of fix:** Concurrent requests both succeed with the same friendly "already pending" message; a request can be
re-filed after a rejection.

**Depends on / conflicts with:** Needs a migration; note the repo's migration-state uncertainty (map §0.4.3).

---

### [S-18] Cute-icons batch rewrite emits one realtime event per transaction, unchecked, then invalidates anyway
Severity: P2 · Confidence: CONFIRMED · Area: Sync / Cache

**Location:** `services/supabaseApiService.ts:668-684` (`for` loop of N updates at `:677-683`, no `error` check);
caller `App.tsx:385-392` (`:388` invalidates the whole transactions key afterwards).

**What is wrong:** Turning on "cute icons" for a group issues N sequential `UPDATE` statements, none of whose results
are inspected. Each produces a `postgres_changes` UPDATE delivered to every group member, each hitting
`queries.ts:102` and replacing a cached object — N cache writes and N re-renders of the list plus all four independent
balance computations. `App.tsx:388` then invalidates the entire key on top, so the writer also refetches everything.
A mid-loop failure leaves the group half-emojified with no error and no retry.

**How to reproduce (two devices):** In a group with 100+ expenses, turn on cute icons on A. Watch B's WS frame list
(100+ UPDATE frames) and B's UI stutter.

**Blast radius:** Not correctness, but a visible freeze and a burst that can starve the socket of the events that
matter.

**Why it exists:** No bulk-update primitive was reached for.

**Containment (minutes):** Replace the loop with a `SECURITY DEFINER` RPC doing one
`UPDATE transactions SET description = description || ' ' || … WHERE group_id = ?`. One WAL record per row is
unavoidable, but one statement removes the partial-failure window and the N round trips. Also remove the redundant
invalidate at `App.tsx:388`.

**Correct fix:** Stop storing the emoji in `description` at all — derive it from `tag` at render time
(`TAG_EMOJIS` already exists at `:662-666`). That deletes this function, its N UPDATEs, and the regex guard, and
makes the feature a per-user preference instead of a destructive group-wide text rewrite.

**Proof of fix:** Toggling the flag produces zero `transactions` UPDATE frames.

**Depends on / conflicts with:** The "derive at render" fix conflicts with the existing emoji-in-description data;
needs a one-time cleanup or a tolerant renderer.

---

### [S-19] The `groups` INSERT bridge inserts a group with an empty member list
Severity: P2 · Confidence: CONFIRMED · Area: Cache

**Location:** `services/queries.ts:55-62`; `services/supabaseApiService.ts:376-387` (`mapDbGroupRowBasic`, `members: []`
at `:386`); consumer `App.tsx:592`.

**What is wrong:** A `groups` INSERT event is appended to the cache as-is. `mapDbGroupRowBasic` hardcodes
`members: []` with a comment saying it "will be populated by full query" — but the INSERT branch never triggers a
query. Any group that enters the cache this way renders with zero members, so `App.tsx:592` yields an empty
`groupMembers`, the expense form has nobody to split with, and every balance panel is blank. The UPDATE branch
(`:63-76`) correctly preserves cached members; the INSERT branch has nothing to preserve.

Today this is mostly latent because a member usually learns about a new group through the `group_members` INSERT
(which invalidates and refetches, `:186-191`) rather than the `groups` INSERT (§3.5). It becomes live whenever the two
events arrive in the other order, or when a `groups` INSERT is delivered to the creator on a second device.

**How to reproduce (two devices, same account):** Sign in on A and B. Create a group on A. On B, if the `groups` INSERT
lands before the `group_members` INSERT, opening the group shows no members and Add Expense has an empty split list.

**Blast radius:** An unusable group view until reload.

**Why it exists:** The lightweight mapper was introduced "to avoid extra DB queries to keep latency low" (`:375`) and
the INSERT path never got the follow-up fetch the comment assumes.

**Containment (minutes):** In the INSERT branch, call
`qc.invalidateQueries({ queryKey: qk.groups(personId) })` instead of appending a members-less row. One line, and it
makes the branch correct by construction.

**Correct fix:** Same, and delete `mapDbGroupRowBasic` — after the change, nothing needs a lossy mapper.

**Proof of fix:** A newly created group opened on a second device always shows its members.

**Depends on / conflicts with:** None.

---

### [S-20] The PWA runtime cache rule targets a hostname that can never match
Severity: P3 · Confidence: CONFIRMED · Area: Sync / Hygiene

**Location:** `vite.config.ts:80-92` (`urlPattern: /^https:\/\/api\.supabase\.co\/.*/i`) against
`lib/supabase.ts:5-8` (URL comes from `VITE_SUPABASE_URL`, always `https://<ref>.supabase.co`).

**What is wrong:** Supabase project endpoints are `<project-ref>.supabase.co`; `api.supabase.co` is not a host this app
ever calls. The `NetworkFirst` rule and its `supabase-api-cache` therefore never match a single request. With
`registerType: 'prompt'`, `clientsClaim: false` and `skipWaiting: false` (`:43,78,79`), the service worker also never
takes over an already-open page.

**What is right about it:** this means the service worker is **not** a source of staleness — worth stating explicitly,
because a 24-hour `NetworkFirst` cache over Supabase reads *would* have been a serious contributor to "device B shows
old data", and it is reasonable to suspect it first.

**How to reproduce:** Build, install the PWA, open DevTools → Application → Cache Storage. `supabase-api-cache` is
absent or empty.

**Blast radius:** None today. It is dead configuration that will mislead the next person debugging staleness.

**Why it exists:** A guessed hostname, never verified.

**Containment (minutes):** Delete the `runtimeCaching` block (`vite.config.ts:80-92`).

**Correct fix:** Delete it. Do **not** "fix" the pattern to `<ref>.supabase.co` — a 24-hour NetworkFirst cache over
authenticated, per-user API responses would serve one user's data to another after a sign-out and would make staleness
dramatically worse.

**Proof of fix:** No `runtimeCaching` entry; `supabase-api-cache` never appears.

**Depends on / conflicts with:** None.

---

### [S-21] Destructive operations are gated on a client-computed "all settled" boolean derived from a possibly-stale cache
Severity: P1 · Confidence: CONFIRMED · Area: Sync / Concurrency

**Location:** `App.tsx:131-139` (`groupBalances`, `allSettled`, `userSettled`); passed as arguments at `App.tsx:546`
(`deleteGroup`) and `:567` (`archiveGroup`); `components/AdminDeletionRequestsPanel.tsx:63` passes a literal `true`;
enforcement at `services/supabaseApiService.ts:10` and `:24-25`; no server-side check anywhere (§12.10).

**What is wrong:** "All balances must be settled before deleting the group" is enforced **only** by a boolean the
client computes from its own `transactions` cache. Every sync gap in this document (S-01, S-02, S-04, S-06) produces
a cache that is missing transactions. A device missing the last three expenses computes `allSettled === true` and the
server accepts the deletion — three unchecked `DELETE` statements later (S-05), the group and every transaction in it
are gone.

`AdminDeletionRequestsPanel.tsx:63` does not even pretend: it calls
`approveGroupDeletion(confirmApprove.id, currentUserId, true)` with a hardcoded `true`, so the admin approval path has
**no settled check at all**.

**How to reproduce (two devices):** A and B in group G, settled. Block B's WebSocket. A adds a ₹5000 expense. B's
`groupBalances` still shows all zeros → B (if B is the creator) deletes G. Every transaction, including A's ₹5000, is
gone from the database with no confirmation that anything was outstanding.

**Blast radius:** Irreversible destruction of financial history, triggered by exactly the staleness this whole audit is
about. This is the finding that turns "device B doesn't update" from an annoyance into data loss.

**Why it exists:** There is no server-side balance (§12.10), so there was nothing to check against; the client had the
number already.

**Containment (minutes):** Force a fresh read before the destructive call —
`await qc.refetchQueries({ queryKey: qk.transactions(currentUserId) })` immediately before `deleteGroup`/`archiveGroup`
in `App.tsx:546,567`, and recompute `allSettled` from the refetched data rather than from the render-time memo. Also
replace the literal `true` at `AdminDeletionRequestsPanel.tsx:63` with a real computation.

**Correct fix:** Move the check server-side. A `SECURITY DEFINER delete_group(uuid)` that recomputes balances in SQL
and raises unless they are all within epsilon — one transaction, one authority, and it also fixes S-05's three
unchecked deletes.

**Proof of fix:** The reproduction above is refused by the server with "group is not settled".

**Depends on / conflicts with:** The correct fix subsumes part of S-05. Requires the balance computation to be
expressible in SQL, which it is (`utils/calculations.ts:30-71` is arithmetic over `split_participants`).

---

### [S-22] Expense add/edit/delete failures are invisible: no toast, no Sentry, no retry
Severity: P2 · Confidence: CONFIRMED · Area: Sync

**Location:** `App.tsx:359-361` (save), `:340-342` (delete), `:498-500` (payment source), `:512-514`, `:527-530`;
contrast `App.tsx:410`, `:471`, `:553`, `:557`, `:572` which do toast.

**What is wrong:** The three most frequent mutations swallow every error into `console.error`. No toast, no
`Sentry.captureException` (Sentry is initialised at `index.tsx:19-31` and is used for user identity at `App.tsx:58-64`
but never for these). Offline saves, RLS denials, and validation failures are all indistinguishable from success —
which, combined with S-04 (no cache write) and S-07 (no submit guard), is the exact recipe for a user retrying and
double-posting.

**How to reproduce:** Go offline in DevTools and add an expense. The modal closes and nothing is reported anywhere.

**Blast radius:** Silent failure is the reason nobody has a bug report with a stack trace to work from. Fixing this is
what makes every other finding here diagnosable in production.

**Why it exists:** `catch (error) { console.error(...) }` as a placeholder that was never revisited. Map §0.2 counts
34 catch blocks whose only action is `console.*`.

**Containment (minutes):** Add `toast.error(...)` and `Sentry.captureException(error)` to the five catch blocks listed
above, and keep the modal open on failure (`App.tsx:357` currently closes it unconditionally inside the try block —
it should only close on success).

**Correct fix:** A shared mutation wrapper (the `useMutation` refactor from S-04) with a single `onError` that toasts
and reports.

**Proof of fix:** An offline expense save produces a visible error, the modal stays open with the data intact, and a
Sentry event appears.

**Depends on / conflicts with:** Best done as part of S-04.

---

## 13.1 Findings index

| Id | Title | Severity | Confidence |
|---|---|---|---|
| S-01 | `tx` broadcast fallback wired to nothing — façade drops the callback argument | P1 | CONFIRMED |
| S-02 | Realtime DELETE events bypass RLS — full deleted rows reach every signed-in client | P0 | LIKELY |
| S-03 | `updateGroup` delete-and-reinsert membership: kicks viewers out, ejects new joiners, can orphan the group | P1 | CONFIRMED |
| S-04 | Adding an expense writes no cache — the writer's own screen waits on realtime | P1 | CONFIRMED |
| S-05 | Writes with no affected-row check + unconditional cache mutation — the "phantom" class | P1 | CONFIRMED |
| S-06 | No resume/reconnect reconciliation — a backgrounded device never backfills | P1 | CONFIRMED / LIKELY |
| S-07 | Expense Save button has no in-flight guard — double-tap double-posts, no idempotency | P1 | CONFIRMED |
| S-08 | `people` cache never invalidated on membership change — new members invisible on other devices | P1 | CONFIRMED |
| S-09 | The "Live" badge is decorative — heartbeat channel proves nothing about data delivery | P2 | CONFIRMED |
| S-10 | Last-write-wins edits: whole-object splits, no version, `updated_at` discarded | P1 | CONFIRMED |
| S-11 | All Realtime channels are public — anon can join `public:transactions` | P2 | LIKELY |
| S-12 | The intended broadcast handler invalidates the entire transactions key on every system-wide write | P2 | CONFIRMED |
| S-13 | `archiveGroup` can never succeed but always reports success | P2 | CONFIRMED |
| S-14 | `_txPublishChannel` module singleton aliases and outlives a bridge-owned channel | P2 | LIKELY |
| S-15 | StrictMode double-mount + channel dedupe can leave dev realtime silently dead | P2 | LIKELY |
| S-16 | Deletion-request workflow and unarchive propagate to nothing | P2 | CONFIRMED |
| S-17 | `requestGroupDeletion` select-then-insert race; UNIQUE constraint permanently blocks re-filing | P2 | CONFIRMED |
| S-18 | Cute-icons batch: N unchecked UPDATEs → N realtime events + a redundant full invalidate | P2 | CONFIRMED |
| S-19 | `groups` INSERT bridge inserts a group with an empty member list | P2 | CONFIRMED |
| S-20 | PWA runtime cache rule targets a hostname that can never match (inert) | P3 | CONFIRMED |
| S-21 | Destructive ops gated on a client-computed "all settled" from a possibly-stale cache | P1 | CONFIRMED |
| S-22 | Expense add/edit/delete failures are invisible: no toast, no Sentry, no retry | P2 | CONFIRMED |

**Suggested landing order** (each row is safe to ship on its own unless a dependency is named):

1. S-22 → S-04 → S-07 (make failures visible, make the write local, stop the double-post). Together these remove the
   founder's headline symptom for the *writer* and stop duplicate expenses.
2. S-06 (resume reconcile) — the single change with the largest effect on the *reader's* symptom.
3. S-08, S-19 (one-line cache-invalidation corrections).
4. S-05 then S-13, S-21 (make silent server rejections loud, then fix the two that are always wrong).
5. S-03 (group-membership diff instead of replace).
6. S-11 → then S-01 + S-12 together, or delete the broadcast entirely (S-14).
7. S-02 (the architectural one: private per-group channels). S-11's fix is the first half of it.
8. S-10, S-15, S-16, S-17, S-18, S-09, S-20 as debt.

---

## 14. Coverage gaps

Things this pass could **not** determine, and what would close each:

1. **Whether the five tables are actually in the `supabase_realtime` publication on production.**
   `migrations/enable_realtime.sql:13-17` would do it, but that whole directory is classified as historical
   (map §0.4.3), and every `supabase/migrations/2026*` file carries "Apply manually via Supabase dashboard SQL editor".
   `ENABLE_REALTIME.md` exists precisely because this was once wrong.
   **Needed:** `SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';`
   This is the **single highest-value query in this audit** — if `transactions` is absent, S-01/S-04/S-06 are the
   complete explanation of the founder's symptom.
2. **Whether `REPLICA IDENTITY FULL` is set** (drives the severity of S-02).
   **Needed:** `SELECT relname, relreplident FROM pg_class WHERE relname IN ('groups','transactions','people','group_members','payment_sources');`
   (`f` = full, `d` = default/PK-only.)
3. **Whether "Allow public access" is enabled in Supabase → Realtime Settings** (drives S-11).
4. **Whether `migrations/HOTFIX_reset_all_policies.sql`'s eight `USING (true)` policies are live** — map §0.4.3 flags
   that nothing in the repo drops them. If they are, every RLS-based claim in §2.1 is void and *all* realtime
   INSERT/UPDATE events go to *all* clients, not just DELETEs.
   **Needed:** `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public';`
5. **Whether `group_deletion_requests` has any RLS policy** (map §0.4.3: RLS enabled, zero policies in the repo). If
   none, the entire deletion-request feature is dead server-side and S-16/S-17 are moot.
6. **The actual Clerk session-JWT TTL.** The code asserts 60 s (`contexts/SupabaseAuthContext.tsx:8-12`) and sizes the
   refresh timer to it. If Clerk's default has changed or the instance is configured differently, the 50 s interval is
   either wasteful or too slow. **Needed:** decode a live token's `exp - iat`, or read the Clerk dashboard's
   session-token lifetime.
7. **What Supabase Realtime does with an expired token on an open socket** — whether it closes the channel, stops
   delivering, or ignores expiry. Neither fetched vendor page addresses it. **Needed:** an empirical test (join, let the
   token expire without refreshing, write from another client, observe).
8. **Empirical delivery rates.** Nothing measures how often `postgres_changes` events are actually lost in the field.
   Sentry is installed but nothing instruments realtime. **Needed:** a counter comparing "events received" against
   "rows that appeared only on the next refetch".
9. **Android WebView behaviour on resume** — whether `online` fires, whether the socket survives Doze.
   **Needed:** a device test with `chrome://inspect` attached across a 5-minute background.
10. **The installed `node_modules` tree.** Not present; all library-internals claims come from GitHub tags matching
    `package-lock.json` and are marked LIKELY, not CONFIRMED.
11. **Whether `tsc --noEmit` currently passes.** It cannot be run (no deps, install forbidden). S-01 proves at least one
    TS2554 exists, so it almost certainly does not — meaning a typecheck gate will surface other errors first.
12. **Multi-tab behaviour** was reasoned about from code, not observed. `lib/queryClient.ts` exports a module singleton,
    so each browser *document* has its own `QueryClient` and its own six channels. There is no `BroadcastChannel` and no
    storage-event sync between tabs; two tabs sync only via the server, exactly like two devices. Not empirically
    verified.
13. **Playwright/unit coverage of any of this.** `src/test/contexts/SupabaseAuthContext.test.tsx` mocks
    `setRealtimeAuth` entirely (`:44`) and asserts only that the timer fires and the call order is right (`:98-187`).
    Nothing in the repo tests a realtime bridge, a cache handler, or a two-client scenario. Running the suite was out of
    scope for this pass.

---

## 15. Suspicions / Unverified

Recorded as suspicions because they are not provable from the repo. None of these is cited as evidence above.

- **S-U1 — The tables may not be in the realtime publication at all.** If so, `postgres_changes` delivers nothing to
  anyone and the founder's symptom has a one-line cause. Evidence pointing this way: `ENABLE_REALTIME.md` opens with
  *"Your friend's changes aren't appearing in real-time because Supabase Realtime needs to be enabled on your database
  tables"* — the exact symptom, already once diagnosed — and `migrations/enable_realtime.sql` lives in the directory the
  map classifies as never-applied. Against it: the founder's phrasing implies device A *does* update, which (given
  §3.1 writes no cache) requires delivery to at least the writer. **Check coverage gap 14.1 first.**
- **S-U2 — Realtime may stop delivering after the socket's JWT expires, without closing the channel.**
  If Realtime evaluates RLS using claims captured at subscribe time and those claims have an `exp` in the past, the
  check could either keep working on the stale `sub` or fail closed and silently stop. The observable difference is
  exactly the founder's symptom. Unverifiable without an empirical test (gap 14.7).
- **S-U3 — `_performAuth`'s change-detection may skip the refresh.** `if (this.accessTokenValue != tokenToSend)`
  means that if Clerk's `getToken()` returns a **cached, unchanged** token string — which it does until ~10 s before
  expiry, per the comment at `contexts/SupabaseAuthContext.tsx:10-12` — the 50 s timer pushes **nothing** to the
  channels. The refresh only takes effect on a tick where the string actually changes. With a 60 s TTL and a 50 s tick
  the token changes on most ticks, but the margin is thin and a single skipped tick (backgrounded tab, throttled timer)
  leaves the socket holding an expired token with no retry. Needs instrumentation to confirm.
- **S-U4 — `i_can_see_person`'s invite clause may leak `people` rows.** `20260728000000:66-71` grants visibility of any
  person who is `invited_by` on any active, unexpired invite — to **every authenticated user**, with no relationship
  requirement. Combined with the unfiltered `public:people` subscription that could deliver `people` UPDATE events for
  strangers. Not verified end to end (Pass 1.1 territory), but it is why `queries.ts:153-159` can append people the
  receiver shares no group with.
- **S-U5 — StrictMode's effect is dev-only.** §11.3 assumes React 19's double-invoke is strictly development-gated,
  which is documented behaviour but was not empirically verified here.
- **S-U6 — realtime-js version drift.** All library claims are read from GitHub tag `v2.15.5`, matching
  `package-lock.json`. The `^2.58.0` range on `@supabase/supabase-js` means a fresh `npm install` today could resolve a
  newer realtime-js in which `subscribe()` on an already-joined channel behaves differently (§11.2) or `channel()`
  stops deduping. Any fix in this area should pin the version.
- **S-U7 — Which client "device B" actually is.** The Android build and a second browser tab have materially different
  failure modes (§5.3 vs §5.2). Worth establishing before choosing between S-06's containment and its full fix.
- **S-U8 — Whether the production project has ever run `COMPLETE_RLS_FIX.sql` / `DATABASE_FIX_DISABLE_RLS.sql`**
  (both disable RLS on 7 tables; map §0.6 lists them as dead-but-present). If either was ever run and not reversed,
  §2.1's entire RLS-filtering premise collapses and every client already receives everything.

---

## Appendix — reading order for the lead auditor

If you read only four things in this document: **§1.3** (the intended fallback does not exist), **§2.2** (DELETE events
bypass RLS), **§5** (nothing ever reconciles), and **§12.10** (there is no server-side balance, so every sync gap is a
money bug). Everything else is downstream of those four.
