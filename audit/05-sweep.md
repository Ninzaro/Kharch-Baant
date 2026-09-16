# Pass 2 — Self-Directed Sweep

Audit date: 2026-09-07. Read-only. Repo: `Kharch-Baant-main` (no `.git`, no `node_modules`, nothing installed, nothing executed against a live service).

Scope: everything **except** auth/authz policy design, realtime/sync semantics, dead-code inventory, and money arithmetic — those are other passes. Where a finding sits on a boundary it is reported here from *this* pass's angle and cross-referenced.

Confidence tags: **CONFIRMED** = read directly in this repo and the conclusion follows from the code alone. **LIKELY** = follows from code plus documented vendor/platform behaviour I did not execute. **SUSPECTED** = plausible, not proven; parked in §19.

Every heading below carries either findings or an explicit "No findings — checked …" list.

---

## 1. Input validation

### 1.1 What actually validates a write

There is no application server. Every write is a PostgREST `POST`/`PATCH`/`DELETE` or an RPC call issued by the browser with a Clerk JWT. The complete server-side validation surface is:

| Layer | What it enforces |
|---|---|
| Postgres column types | uuid / numeric(12,2) / date / boolean / jsonb well-formedness |
| `NOT NULL` | `people.name`, `people.avatar_url`, `groups.name`, `groups.currency`, `transactions.description/amount/paid_by_id/date/tag/split_mode/split_participants` |
| `CHECK` constraints | 9 total, listed below |
| Foreign keys | `group_members.group_id/person_id`, `transactions.group_id/paid_by_id/payment_source_id`, invite/deletion-request FKs |
| RLS `USING` / `WITH CHECK` | row-level authorization only — see §1.3 |
| RPC body guards | 6 `SECURITY DEFINER` functions, guards listed in §1.4 |

The complete `CHECK` inventory (grep over `supabase-schema.sql`, `supabase/migrations/`, `migrations/`, `scripts/migrations/`):

- `supabase-schema.sql:21` `groups.group_type IN (trip, family_trip, flat_sharing, expense_management, other)`
- `supabase-schema.sql:24-27` trip types require both dates; non-trip types require both NULL
- `supabase-schema.sql:45` `payment_sources.type IN (Credit Card, UPI, Cash, Other)`
- `supabase-schema.sql:56` `transactions.amount > 0`
- `supabase-schema.sql:59` `transactions.tag IN (…10 tags)`
- `supabase-schema.sql:62` `transactions.split_mode IN (equal, unequal, percentage, shares)`
- `supabase-schema.sql:80-84` `ai_item_cache.category IN (…10 tags)`, `ai_item_cache.source IN (keyword, gemini)`
- `scripts/migrations/20251004_add_type_to_transactions.sql:11` `transactions.type IN (expense, settlement, adjustment)`
- `migrations/20251019_add_invite_system.sql:19-20` `group_invites.current_uses >= 0`, `max_uses IS NULL OR max_uses > 0`
- `migrations/20251116_group_admin_and_deletion_requests.sql:12` `group_deletion_requests.status IN (pending, approved, rejected)`
- `migrations/20251019_add_invite_system.sql:34,37` `email_invites.mailersend_status`, `email_invites.status`

**Not validated anywhere on the server:**

- `transactions.split_participants` (jsonb) — no shape, no sum, no membership, no count, no upper bound. `[]`, `[{"personId":"<any uuid>","value":-1e9}]`, or a 10 MB array all insert cleanly. Only the client (`components/TransactionFormModal.tsx:182-206` `isSplitValid`) checks sums, with an ε of 0.01.
- `transactions.payers` (jsonb) — same. Nothing enforces `Σ payers[].amount = amount`, nothing enforces payers are group members.
- `groups.currency` — free `TEXT`, `NOT NULL`, default `'USD'`. No CHECK, no ISO-4217 list. `supabaseApiService.ts:172` writes whatever the client sends.
- `people.source` — free `TEXT`, default `'manual'`. App writes `manual`/`self`/`deleted`; `types.ts` also allows `phonebook`/`email_invite`. No CHECK.
- **String length: zero limits, anywhere.** No `varchar(n)`, no `CHECK (length(...) < n)` in any SQL file. `people.name`, `people.email`, `people.avatar_url`, `groups.name`, `transactions.description`, `transactions.comment`, `payment_sources.name`, `email_invites.email` are all unbounded `TEXT` (Postgres cap ≈1 GB, practical cap = the 1 GB TOAST limit per value). The only client-side length limit in the whole UI is `maxLength={4}` on the card last-4 field (`components/PaymentSourceFormModal.tsx:93`).
- Email format: the client does `email.toLowerCase().trim()` (`supabaseApiService.ts:836,1035`, `ensure_my_person` normalises with `lower(trim())`). There is **no** email format validation in SQL. The Edge function has one (`supabase/functions/_shared/auth.ts:132-138`), but that is on the *email-sending* path, not the *storage* path, so `email_invites.email` can hold arbitrary text while the email itself is refused.

### 1.2 Per-endpoint validation table

| Write | Callsite | Server-side validation | Trusted from client |
|---|---|---|---|
| `POST /groups` | `supabaseApiService.ts:180-184` | group_type enum, trip-date CHECK, RLS `created_by` must resolve to me | `name` (unbounded), `currency` (free text), `enable_cute_icons` |
| `PATCH /groups` | `:337-342` | same CHECKs; RLS `USING (i_created_group(id))`, **no `WITH CHECK`** | every column — see §1.3 |
| `POST /group_members` | `:198-205`, `:359-366` | FKs, UNIQUE(group_id, person_id), RLS `WITH CHECK (i_created_group OR i_am_member_of)` | `person_id` — any `people.id` in the database |
| `DELETE /group_members` | `:350-353`, `:264` | RLS `USING (i_created_group(group_id))` | nothing |
| `POST /transactions` | `:541-558` | `amount>0`, tag/split_mode/type enums, FKs, RLS member check | `paid_by_id` (any person), `split_participants` (any shape), `payers` (any shape), `date` (any date incl. future/1900), `description`, `comment` |
| `PATCH /transactions` | `:648-653`, `:679-682` | same CHECKs; RLS `USING (member)`, **no explicit `WITH CHECK`** | as above, plus `group_id` — see §1.3 |
| `DELETE /transactions` | `:687-690`, `:14`, `:265` | RLS `USING (i_created_group OR i_am_member_of)` | nothing |
| `POST /payment_sources` | `:720-727` | `type` enum, RLS `user_id` resolves to me | `name`, `details` jsonb (card issuer / last4 / UPI id — **no format check server-side**) |
| `PATCH /payment_sources` | `:747-751` | RLS `USING`, no `WITH CHECK` | any column |
| `PATCH /people` (avatar) | `:1232-1236` | `NOT NULL`, RLS `USING (clerk_user_id = requesting_user_id())` | `avatar_url` — **unbounded TEXT, no MIME check, no size check** |
| `PATCH /people` (name/email) | `:1251-1256` | partial UNIQUE on `email` | `name`, `email` (no format check) |
| `POST /group_invites` | `:994-1006` | `current_uses>=0`, `max_uses>0`, RLS member check | `expires_at`, `max_uses`, `is_active`, `invite_token` (client-generated!) |
| `PATCH /group_invites` | `:1210-1216` | RLS `USING (member)`, no `WITH CHECK` | all of the above |
| `POST /email_invites` | `:1030-1039` | FKs, RLS member check | `email` (arbitrary text) |
| `POST /group_deletion_requests` | `:235-239` | `status` CHECK, UNIQUE(group_id) | `requested_by` (client-supplied person id) |
| `PATCH /group_deletion_requests` | `:270-273`, `:318-321` | `status` CHECK | `approved_by`, `approved_at` |
| `POST /ai_item_cache` | `services/tagClassifier.ts:410-412` | `category`/`source` CHECK, PK uniqueness | `normalized_name` (arbitrary text, unbounded) |
| RPC `ensure_my_person` | `:848-851` | JWT `sub` required | **`p_email` fully client-controlled** — see §1.4 |
| RPC `claim_person_by_email` | `:871-876` | JWT `sub` required, `p_clerk_id` must match JWT | **`p_email` fully client-controlled** |
| RPC `create_unclaimed_person` | `:821-825` | JWT required, name non-empty | `p_name`, `p_email`, `p_avatar_url` (unbounded) |
| RPC `find_person_by_email` | `:835-837` | JWT required | `p_email` — arbitrary; returns the whole `people` row |
| RPC `get_invite_preview` | `:1078-1080` | token ≥ 8 chars; **`anon` may call** | `p_token` |
| RPC `accept_group_invite` | `:1147-1149` | JWT `sub`, token ≥ 8 chars, expiry, max_uses | `p_token` |
| RPC `anonymize_my_account` | `:1295` | JWT `sub` | — |
| Edge `send-email` | `services/emailService.ts:86` | JWT `sub`, `isValidEmail`, 500-char clip, 25-recipient cap | **every recipient address, sender display name, body strings, and link target** — see §6 |
| Edge `suggest-tag` | `services/geminiService.ts:34` | JWT `sub`, 4–200 char description | description text |
| Edge `native-bridge` | `services/nativeAuthBridge.ts:78-85` | Clerk `verifyToken`, `sub` must start `user_` | — |

**Unvalidated endpoints (nothing beyond a type check and an RLS row test):** `PATCH /groups`, `PATCH /transactions`, `PATCH /payment_sources`, `PATCH /people`, `PATCH /group_invites`, `PATCH /email_invites`, `PATCH /group_deletion_requests`, `POST /ai_item_cache`.

### 1.3 Mass assignment — per table

PostgREST writes any column in the request body that the role holds the privilege for. `migrations/HOTFIX_reset_all_policies.sql:65-69` and `supabase-auth-setup.sql:209` both contain `GRANT ALL … TO authenticated`, and no later file narrows column privileges. So the only gate is the RLS `WITH CHECK` expression.

**PostgreSQL semantics that matter here** (`CREATE POLICY` docs): *if an `UPDATE` policy has no `WITH CHECK`, the `USING` expression is used for the new row as well.* Every `UPDATE` policy in this repo omits `WITH CHECK`. So the "new row" test is whatever the `USING` clause says.

| Table / column | Can a modified client set it? | Consequence |
|---|---|---|
| `transactions.created_at` / `updated_at` | **Yes** — `updated_at` is immediately overwritten by the `update_transactions_updated_at` trigger (`supabase-schema.sql:113`), but `created_at` on **INSERT** is client-settable and has no trigger. | Audit timestamps are forgeable. Since `created_at` is the only creation record (no `created_by`, no audit table), a transaction can be made to look like it was entered weeks ago. **CONFIRMED.** |
| `transactions.group_id` on PATCH | **Yes, within your own groups.** `USING (i_created_group(group_id) OR i_am_member_of(group_id))` doubles as `WITH CHECK`, so the target group must also be one you belong to. Moving a transaction from group A to group B when you are in both is allowed. | Silently rewrites two groups' balances at once. No UI does this, so no user would ever expect it. **CONFIRMED** (semantics LIKELY — from the documented `WITH CHECK` fallback). |
| `groups.created_by` on PATCH | **Yes.** `USING (i_created_group(id))` is re-used as `WITH CHECK`, but `i_created_group` is a `STABLE SECURITY DEFINER` function that re-reads `groups` — inside `WITH CHECK` it sees the pre-update snapshot, so it still returns true no matter what the new `created_by` is. | The creator can hand ownership to anyone, or to garbage, and lock **themselves** out of `UPDATE`/`DELETE` on their own group with no undo. **LIKELY** (needs a live `EXPLAIN`/probe to be CONFIRMED — see §18). |
| `groups.is_archived` by a **non-creator** | **No** — and that is the bug. `archiveGroup` (`supabaseApiService.ts:22-31`) is the *non-creator* path (`if (isOwner) throw`), and it issues a bare `.update({is_archived:true})`. The `groups` UPDATE policy is `USING (i_created_group(id))`, so a non-creator matches **zero rows**, PostgREST returns 204/`[]` with **no error**, and the function returns `{success:true}`. | Non-creators are told "archived", the cache is patched (`App.tsx:568`), the group vanishes from their sidebar, and on the next reload it is back. **CONFIRMED — see [P1-03].** |
| `people.email` / `is_claimed` / `source` / `name` / `avatar_url` on own row | **Yes.** `USING (clerk_user_id = requesting_user_id())` doubles as `WITH CHECK`, which only pins `clerk_user_id`. | You can set your own `email` to any address not already present (the partial unique index blocks duplicates), flip `is_claimed`, set `source` to anything. Setting your email to a *future* user's address poisons the claim flow — see §1.4. **CONFIRMED.** |
| `people.clerk_user_id` on own row | **No** — `WITH CHECK` pins it to your JWT `sub`. | Correct. |
| `payment_sources.user_id` | **Yes, to your own person id only.** `WITH CHECK` requires the row to resolve to you. | Correctly constrained. |
| `group_invites.expires_at` / `max_uses` / `current_uses` / `is_active` / `invite_token` | **Yes — any group member.** `20260812000000:306-308` `USING (i_created_group OR i_am_member_of)`, no `WITH CHECK`. | Any member can extend any invite to the year 3000, reset `current_uses` to 0, and set `max_uses` to NULL — making a "single-use, 30-day" link permanent and unlimited. Nothing in the UI exposes this, and nothing notifies the creator. **CONFIRMED.** |
| `email_invites.status` / `accepted_by` / `accepted_at` / `mailersend_*` | **Yes — any group member** (`20260812000000:322-324`). | Invite bookkeeping is member-writable; `accepted_by` can name anyone. **CONFIRMED.** |
| `group_deletion_requests.status` / `approved_by` | **Unknown.** RLS was **enabled** on the table by `20260728000000:19` and **no policy for it exists in any file in the repo**. Either every read/write is denied (feature dead), or RLS was never actually enabled and everything is open. | Both states are wrong. Carried as a coverage gap, and it is the same gap Pass 0 §0.10 opened. **SUSPECTED**, see §19. |
| `ai_item_cache.normalized_name` / `category` | **Yes — any authenticated user, insert-only** (`supabase-schema.sql:96-99`). No UPDATE/DELETE policy exists, so entries are **permanent**. | Poisoning: `INSERT ('uber', 'Health')` makes every future user's Uber expense classify as Health, forever, with no admin path to fix it short of a manual SQL delete as `postgres`. **CONFIRMED — see [P2-08].** |

### 1.4 Client-controlled email in the identity RPCs

`ensure_my_person(p_name, p_email)` (`supabase/migrations/20260813020000_ensure_my_person.sql:100-167`) takes the email **as a parameter from the browser**, not from the JWT. `contexts/SupabaseAuthContext.tsx:156-162` passes `user.primaryEmailAddress?.emailAddress`, but nothing on the server requires that. A first-login client that sends `p_email = victim@example.com` reaches the block at `:130-144`:

```sql
UPDATE people SET clerk_user_id = v_clerk, ... , is_claimed = true
WHERE email = v_email AND is_claimed = false;
```

— which hands the attacker the victim's unclaimed placeholder row, including all of its `group_members` rows and its position in every ledger. `claim_person_by_email` (`20260812000000:36-47`) has the identical unguarded `WHERE email = lower(trim(p_email)) AND is_claimed = FALSE`.

This is an authorization hole and the auth/authz pass owns the verdict; **from the input-validation angle the finding is that `p_email` is an unauthenticated attacker-controlled parameter on a privileged `SECURITY DEFINER` write, and the fix is to read the verified email from the JWT claim rather than the argument.** Cross-referenced as [P0-01].

### 1.5 Avatar size limit — traced

`components/SettingsModal.tsx:70-97` `handleFileChange`:

- `:74` `if (file.size > 100 * 1024)` → toast, return. **A 100 KB client-side limit exists** (the brief's "no size limit is known" is resolved: there is one, and it is client-side only).
- `:212` `accept="image/*"` — a UI filter, not a check.
- `:80-96` `FileReader.readAsDataURL(file)` → base64 string ~1.37× the file size, so ≤ ~137 KB per row.
- `:85` → `updateUserAvatar(currentUserId, base64)` → `supabaseApiService.ts:1232-1236` → `PATCH /people?id=eq.<me>` with `avatar_url`.

There is **no server-side size or MIME check at all**. A modified client (or curl with the same JWT) can `PATCH` `avatar_url` with an arbitrary-length string — the row-size ceiling is Postgres's ~1 GB TOAST limit. See §3 for the blast radius.

`components/auth/UserProfile.tsx` is dead (zero importers per Pass 0 §0.6); the live upload path is Settings only.

---

## 2. Injection and untrusted input

### 2.1 SQL injection

**No findings.** Checked:

- Every database call goes through `supabase-js` (`services/supabaseApiService.ts`, `services/apiService.ts`, `services/tagClassifier.ts`, `components/AdminDeletionRequestsPanel.tsx`), which serialises filters into PostgREST query parameters. No raw SQL string is built in application code.
- Grep for `.or(`, `.ilike(`, `.like(`, `.filter(\`` across `services/ components/ lib/ utils/ hooks/`: **zero matches.** The only filters used are `.eq()`, `.in()`, `.maybeSingle()`, `.order()` — all parameterised.
- All 6 `SECURITY DEFINER` RPCs use parameter binding, never `EXECUTE format(...)` or string concatenation. Verified by reading `20260728000000`, `20260812000000`, `20260813000000/010000/020000`.
- All `SECURITY DEFINER` functions set `SET search_path = public`, which closes the classic search-path hijack on definer functions.

### 2.2 JSONB "injection"

`transactions.split_participants` and `transactions.payers` are stored verbatim and read back with an unchecked cast (`supabaseApiService.ts:79-89`). This is a data-integrity problem (§1.1), not an injection: the values are never interpolated into SQL or HTML. Balance code (`utils/calculations.ts:30-71`) does `p.value` arithmetic on whatever comes back — a `null`/string value yields `NaN` and poisons the whole group's balance map silently. That is money-pass territory; flagged here only as the *input* half.

### 2.3 Command execution

`scripts/seed-schema.js:11,32-40` imports `execSync` and runs `psql` with `SUPABASE_DB_URL` from the environment. It writes the SQL to a temp file and passes `-f`, which avoids the worst of shell quoting, but the connection string is still interpolated into a shell command line. This is a **local-only developer script** invoked by `npm run seed:schema`; it is not reachable from the app, not run by CI, and its own header calls itself destructive. **P3, informational.**

No other `execSync` / `child_process` / `spawn` in application code (grep).

### 2.4 Template injection in the email Edge function

`supabase/functions/send-email/index.ts` builds HTML by interpolation. `escapeHtml` (`:30-37`) escapes `& < > " '` — correct and complete for both text nodes and quoted attribute values, so **attribute-breakout XSS is not possible**. Every interpolation into HTML is wrapped: `:93` (`userName`, `appUrl`), `:113-115` (`inviterName`, `groupName`, `inviteUrl`), `:132-135` (`memberName`, `addedByName`, `groupName`, `groupUrl`), `:163` (settle-up body), `:218-221` (`groupName`, `formatAmount`, `description`, `paidByName`, `splitWith`, `expenseUrl`). No unescaped sink found.

**But escaping is not the real problem here.** `href="${inviteUrl}"` accepts any scheme, including `javascript:` and `data:`, and — far more importantly — the function will send *any* URL to *any* address on behalf of *any* signed-in user. See §6 and [P0-02]; the injection angle alone is P3 (mail clients do not execute `javascript:`), the abuse angle is P0.

### 2.5 DOM XSS sinks

Grep for `dangerouslySetInnerHTML` / `innerHTML` / `eval(` / `new Function` / `document.write` over the whole tree excluding `node_modules`:

- `dangerouslySetInnerHTML`: **0 occurrences.** React escapes all rendered strings, so user names, descriptions, comments and group names are safe in the SPA.
- `eval` / `new Function` / `document.write`: **0.**
- `public/check-env.html:37-51` — `info.innerHTML = \`…${window.location.hostname}…${window.location.protocol}…\``. `location.hostname` is normalised by the browser and cannot carry `<`/`>` on a real host, and the page takes no query/hash/path input. **Not exploitable as XSS.** It is still a diagnostic page shipped to production — see [P3-14].
- `vercel-diagnostic.js:23-24` only *reads* `innerHTML.length`; the file is a console-paste snippet, not bundled.

### 2.6 URL handling

- `App.tsx:256-262` and `:969-990` parse `/invite/<token>` out of `window.location.pathname` with `match(/^\/invite\/(.+)$/)` and stash it in `localStorage['pendingInviteToken']`. The token goes straight into the `accept_group_invite` RPC as a bound parameter and is never rendered. Safe.
- `window.history.replaceState({}, '', '/')` at `App.tsx:209,221,235,240,994` — same-origin path only, no user string. Safe.
- `utils/nativeDeepLinks.ts` — `historyPathForAppUrl` (`:57-69`) extracts `invite/([^/?#]+)` and `decodeURIComponent`s it, otherwise builds `/sso-callback${query}${hash}` from the raw intent URL (`:34-55`). That string is passed to `window.history.replaceState` (`:191,204`) and then read back by `AppWithAuth`. **Any app on the device can fire `kharchbaant://sso-callback?<arbitrary query>`** (the intent filter at `AndroidManifest.xml:29-34` matches the whole `kharchbaant` scheme with `BROWSABLE`), and `applyNativeAppUrl:187-195` will hand that query to `clerk.handleRedirectCallback(HANDLE_REDIRECT_PARAMS, …)` (`:134`). The parameters Clerk consumes from the URL are the OAuth handshake nonce and `__clerk_created_session`; forging them requires forging a Clerk-signed handshake, which a third-party app cannot do — a bogus callback ends at `:158-165` "handleRedirectCallback failed". **The residual risk is a denial-of-service / confusing-state nuisance, not session injection. LIKELY** (rests on Clerk's own callback validation, which I did not read; see §19).
- `components/GroupFormModal.tsx:185` `window.open(\`https://wa.me/?text=${encodeURIComponent(message)}\`)` and `:192` `window.location.href = \`sms:?body=${encodeURIComponent(message)}\``. Both encode. The message body contains the group name and an invite URL, both first-party. `window.open(..., '_blank')` without `noopener` — WhatsApp Web gets a `window.opener` handle; modern browsers imply `noopener` for `_blank` on cross-origin navigations, so **P3 at most**.
- `components/invite/InvitePage.tsx:173` `window.location.href = '/'` — constant.
- `hooks/useNativeOAuth.ts:69` `Browser.open({url: externalUrl})` where `externalUrl` comes from Clerk's `signIn.create()` response — first-party API, not user input.

### 2.7 Share-image rendering

`components/GroupView.tsx:134` and `components/GroupSummaryModal.tsx:90` run `html2canvas` over a live DOM subtree containing member names and expense descriptions. Those are already React-escaped text nodes; html2canvas rasterises them. No injection path. The emoji-strip regex at `components/TransactionFormModal.tsx:347` (`/\s*[\p{Extended_Pictographic}\p{Emoji_Presentation}]️?$/u`) is anchored, single-character, no nesting — **no ReDoS**.

---

## 3. File uploads and attachments

**One upload path exists: the profile avatar.** Receipts: none (no such feature). Share images: generated client-side in a canvas and never uploaded (`GroupView.tsx:134-160`, `GroupSummaryModal.tsx:90`). No Supabase Storage bucket is configured anywhere.

### Avatar, end to end

| Question | Answer | Evidence |
|---|---|---|
| Accepted MIME types | Anything the OS reports for the chosen file. `accept="image/*"` is a file-picker hint only; `FileReader` embeds whatever MIME the browser assigned. | `SettingsModal.tsx:212`, `:96` |
| Size cap | **100 KB, client-side only.** Base64 inflates that to ~137 KB stored. Server: none. | `SettingsModal.tsx:74`; no SQL length constraint |
| Downscaled / re-encoded | **No.** The file bytes are base64'd as-is. | `SettingsModal.tsx:80-96` |
| Stored where | `people.avatar_url TEXT NOT NULL` as a `data:` URL. | `supabaseApiService.ts:1232-1236` |
| Who can read it | Anyone who passes `i_can_see_person(id)` (`20260728000000:30-72`): yourself, any co-member of any shared group, anyone whose group you created — **and any authenticated user at all while you hold an active invite** (`:65-71` matches on `group_invites.invited_by` with no relationship test). | migration `20260728000000` |
| Rendered how | `<img src={usableUrl}>` in `components/Avatar.tsx:113-120`, with `referrerPolicy="no-referrer"` and an `onError` fallback to initials. | `Avatar.tsx` |
| SVG data URLs | **Accepted.** `accept="image/*"` matches `image/svg+xml`, and `Avatar.tsx:31` explicitly treats *all* `data:` URLs as legitimate uploads. However, an SVG loaded through `<img src>` runs in a restricted mode — scripts and external references are disabled by every current browser. **Not an XSS vector. LIKELY** (browser behaviour, not tested here). |

### The real avatar problem: unbounded server-side, on hot paths

There is no server constraint, so a modified client can write a multi-megabyte `avatar_url`. That value then rides on three paths that were never designed for it:

1. **`getPeople`** (`supabaseApiService.ts:803-806`) does `.select('*').in('id', uniquePersonIds)` — every co-member's full row, avatar included, on every app load and after every `people` invalidation.
2. **Realtime.** `migrations/enable_realtime.sql:8` sets `REPLICA IDENTITY FULL` on `people`, and `subscribeToPeople` (`:450-464`) listens to `event:'*'` unfiltered. Every `people` UPDATE therefore pushes the **entire row, including the avatar blob**, over the WebSocket to every client that passes RLS. A user toggling their name pushes their whole avatar to everyone in every group they share.
3. **TanStack cache.** The blob sits in `qk.people(personId)` in memory on every device and is copied on every `setQueryData` map (`services/queries.ts:401`, `SettingsModal.tsx:63-66`).

At the sanctioned 137 KB this is merely wasteful. Uncapped it is a cheap way for one account to degrade every co-member's app. **[P2-09].**

---

## 4. SSRF and outbound requests

**No SSRF.** Every outbound request from server-side code has a hardcoded destination host:

| Caller | Destination | Attacker control |
|---|---|---|
| `send-email` | `https://api.mailersend.com/v1/email` — literal, `:153` and `:236` | body only (recipients, strings) — that is §6, not SSRF |
| `suggest-tag` | `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` — `:74`. `model` comes from the `GEMINI_MODEL` **server secret**, not the request. Path segment only, and the host is fixed. | none |
| `native-bridge` | Clerk's API via `@clerk/backend` `createClerkClient` — `:121-124`, host fixed by the SDK | none |

Client-side outbound: `supabase.functions.invoke` (fixed project URL from build-time env), `Browser.open` (Clerk-supplied URL, §2.6), `window.open('https://wa.me/…')` (fixed host).

Also checked and clean: no `fetch(userInput)`, no image/iframe proxying, no webhook registration UI, no user-supplied avatar *URL* field (avatars are `data:` only; remote URLs from the legacy seed era are actively suppressed by `Avatar.tsx:22-33`).

---

## 5. Transport and headers

### Present

- **HTTPS + HSTS preload**: `vercel.json:355-357` `max-age=63072000; includeSubDomains; preload`. Two years, subdomains, preload token. Note that `includeSubDomains` + preload covers `clerk.motamaati.in` and `accounts.motamaati.in` too — intended, but it is a one-way door.
- `X-Content-Type-Options: nosniff` (`:359-360`), `X-Frame-Options: DENY` (`:362-363`), `Referrer-Policy: strict-origin-when-cross-origin` (`:366-367`), `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` (`:370-371`), `Cross-Origin-Opener-Policy: same-origin-allow-popups` (`:374-376`).
- Android: `usesCleartextTraffic="false"` + `networkSecurityConfig` with `cleartextTrafficPermitted="false"` and system trust anchors only (`AndroidManifest.xml:12-13`, `res/xml/network_security_config.xml`).

### Missing

- **No `Content-Security-Policy`.** With no CSP, the mitigations that would contain a compromised third-party script are absent. Third-party script origins in play: Clerk (`clerk.motamaati.in`, loaded by `@clerk/clerk-react` at runtime), Sentry's ingest endpoint, Google Fonts is not used, and `cdn.tailwindcss.com` is **not** used (Tailwind is compiled via PostCSS — `postcss.config.js`, `tailwind.config.js`; the old CDN was removed, see the comment at `index.html:130`). React escapes output and there is no `dangerouslySetInnerHTML`, so the *reflected* XSS surface is genuinely small; CSP's value here would be (a) blocking exfiltration if a dependency is compromised in the supply chain, and (b) `frame-ancestors` as a modern replacement for `X-Frame-Options`. Given a live app handling financial data and a build that pulls 834 npm packages, **the absence of even a report-only CSP is a real gap. [P2-10].**
- No `Cross-Origin-Embedder-Policy`, no `Cross-Origin-Resource-Policy`. Low priority for this app.
- `X-Frame-Options: DENY` applies to the SPA. Because Clerk's Account Portal is a separate origin, no conflict.

### CORS

- **PostgREST/Realtime CORS is Supabase-managed** and effectively `*` for the anon key. This is by design for the browser-direct architecture: RLS, not CORS, is the boundary. Unverifiable from the repo.
- **Edge `send-email` / `suggest-tag`**: `supabase/functions/_shared/auth.ts:12-31`. When `ALLOWED_ORIGINS` is unset, `allowOrigin = '*'` (`:20`, with the comment "allow any origin (local / early beta)"). `docs/security-phase-a.md:127` instructs setting it in production. **Whether it is set on the live project is unverifiable from the repo** (§18). Even if unset, the practical impact is small: both functions require a Bearer JWT, and `*` cannot be combined with credentials — the attack it enables is a malicious page using a *stolen* token, which is already game over. **P3.**
- A subtle bug in the same helper: when `ALLOWED_ORIGINS` *is* set and the request Origin is not in it, `:22` returns `allowed[0]` rather than refusing. That echoes a valid-looking `Access-Control-Allow-Origin` for a disallowed origin — the browser will still block (mismatch), so it fails closed by accident, but the code reads as though it fails open. **P3, code smell.**
- **Edge `native-bridge`**: `supabase/functions/native-bridge/index.ts:33-50` uses its own allow-list defaulting to `https://www.motamaati.in` + `https://motamaati.in`, never `*`. Correct. `supabase/config.toml:4-5` sets `verify_jwt = false` for it, which is deliberate and compensated by `verifyToken` at `:104`.

### Cookies

The app sets no cookies of its own (grep: no `document.cookie`, no `Set-Cookie`). All session cookies are Clerk-managed on `clerk.motamaati.in` / `.motamaati.in`; their `Secure` / `SameSite` / `HttpOnly` flags are set by Clerk and are **unverifiable from this repo** (§18).

### The Capacitor origin collision

`capacitor.config.ts:404-407`: `androidScheme: 'https'`, `hostname: 'www.motamaati.in'`. The Android WebView therefore serves the **bundled local assets** on the origin `https://www.motamaati.in` — the same origin as the live website. Consequences, all deliberate and all worth stating:

- Clerk `pk_live_` origin validation passes (that is the stated reason, `:405-406`).
- WebView `localStorage`, `sessionStorage`, IndexedDB and cookies for `https://www.motamaati.in` are shared between the app shell and anything the WebView loads from that origin.
- **The bundled JS wins over the network JS.** The WebView never fetches `index.html` from Vercel, so a web-side hotfix does not reach installed apps until a new AAB ships. Any RLS or schema change that the web bundle adapts to will hit stale app bundles. This is the same failure class as the PWA stale-SW problem in §14.
- `allowNavigation` (`:413-418`) is limited to Clerk hosts (`*.clerk.accounts.dev`, `*.clerk.com`, `clerk.motamaati.in`, `accounts.motamaati.in`) and deliberately excludes `accounts.google.com` and `www.motamaati.in` itself. Tight and correct; the comment at `:408-412` explains why.

### Service worker cache rule that can never match

`vite.config.ts:238` — `urlPattern: /^https:\/\/api\.supabase\.co\/.*/i`. Supabase project URLs are `https://<ref>.supabase.co`, never `api.supabase.co`. **The runtime-caching rule matches nothing and has never done anything.** Harmless in effect, but it is the only reason anyone would believe API responses are cached offline. **CONFIRMED, P3.**

---

## 6. Rate limiting and abuse

### What exists

| Surface | Limit | Where |
|---|---|---|
| `send-email` | 20 / 60 s / user | `send-email/index.ts:63` via `_shared/auth.ts:44-59` |
| `suggest-tag` | 30 / 60 s / user | `suggest-tag/index.ts:50` |
| `native-bridge` | 10 / 60 s / user | `native-bridge/index.ts:126` |
| Clerk sign-in / sign-up | Clerk's own attack protection | dashboard, unverifiable |
| PostgREST inserts/updates/deletes | **none** | — |
| Realtime broadcast sends | **none** | — |

### The rate limiter does not survive a cold start

`_shared/auth.ts:46` `const rateBuckets = new Map<...>()` — **module-scoped in-isolate state**, with the honest comment "best-effort; resets per cold start". Supabase Edge Functions run on Deno Deploy: isolates are per-region, spun up on demand, torn down on idle, and there can be many concurrent isolates for one function. A caller who spreads requests across regions, or simply waits for a cold start, gets a fresh bucket. **The effective global limit is unbounded; only a naive single-threaded loop from one client is caught. LIKELY** (Deno Deploy isolate lifecycle is vendor behaviour I did not fetch docs for).

### `send-email` is an open, authenticated mail relay

`supabase/functions/send-email/index.ts` verifies **that** the caller is signed in (`:57`) and then never checks **anything about the relationship** between the caller and the payload:

- The caller picks the recipient(s): `inviteeEmail` (`:100`), `memberEmail` (`:123`), `payerEmail`/`receiverEmail` (`:143-144`), `memberEmails[]` up to 25 (`:198-203`).
- The caller picks the sender display name shown to the recipient: `inviterName` (`:101`), `addedByName` (`:133`), `settledByName` (`:174-175`).
- The caller picks the link target: `inviteUrl` (`:103`), `appUrl` (`:87`), `groupUrl` (`:135`), `expenseUrl` (`:221`) — any scheme, any host, 500 chars.
- There is **no check** that a group named in the payload exists, that the caller belongs to it, or that the recipients are members.

So any signed-in account can emit, from the app's verified MailerSend sender identity and domain:

> **Priya Sharma** invited you to **"Family Trip 2026"**.
> [Join group] → `https://kharch-baant.attacker.example/steal`

to any address it likes. **[P0-02].**

Worst case for one abusive account per minute, assuming the isolate limit binds (the optimistic case):

- 20 `send-email` calls × 25 recipients each (`new_expense`) = **500 phishing emails/minute** from the app's own domain, or 40/min via the two-send `settle_up` path.
- 30 `suggest-tag` calls/minute → 30 Gemini generate-content calls, on the project's key, uncapped by any budget in code.
- Unlimited `POST /people` (`create_unclaimed_person` — one row per call, no cap), `POST /groups`, `POST /transactions`, `POST /group_invites`, `POST /email_invites`, `POST /ai_item_cache`. PostgREST has no per-user write throttle; the practical rate is one HTTP round-trip each, so **thousands of rows per minute per account**. Every `POST /transactions` also fires a `tx` broadcast, so every insert forces a full transactions refetch on **every** connected client (§11), turning a write flood into a read amplifier.
- Unlimited Realtime `broadcast` sends on `public:transactions` — `_broadcastTxChange` (`:481-487`) never awaits and never throttles.

If the isolate limit does **not** bind (the likely case), the email number is bounded only by MailerSend's own quota and the project's billing. There is no alerting on either. **[P0-02] and [P1-04].**

---

## 7. Secrets management

### Grepped the whole tree (excluding `node_modules`) for credential shapes

| Pattern | Result |
|---|---|
| `sk_live_` / `sk_test_` | only as documentation placeholders in `.env.example:21` and `docs/play-store-launch.md` |
| `mlsn.` | only as a placeholder in `.env.example:17`, `docs/security-phase-a.md:28` |
| `AIza` | only as a placeholder in `.env.example:19`, `suggest-tag/index.ts:7` (comment) |
| `service_role` | named only as "never commit" in `.env.example:26` |
| eyJ… (JWT literal) | none |
| Sentry DSN | **hardcoded**: `index.tsx:20` `https://241dafbc…@o4511203625795584.ingest.us.sentry.io/4511203644342272`. A DSN is a public ingest key by design; the exposure is event-spoofing / quota-burning, not data theft. **P3.** |
| Clerk publishable key | build-time env only (`index.tsx:63`, `vite.config.ts:292-294`); a `pk_` is public by design. |
| Supabase anon key | build-time env only (`lib/supabase.ts:9-12`); public by design. |

**No live secret is committed.** This is genuinely good and matches what `docs/security-phase-a.md` says was done.

### Android

`find android -name 'google-services.json' -o -name 'keystore.properties' -o -name '*.jks' -o -name 'local.properties'` → **nothing.** `.gitignore` covers `android/keystore.properties`, `android/local.properties`, `*.jks`, `*.keystore`, `*.aab`, `*.apk`. `android/app/build.gradle:4-8,37-42` reads the keystore from `keystore.properties` only if present, degrading to unsigned. `google-services.json` is **not** in `.gitignore` (`build.gradle:88` reads it if present) — nothing is committed today, so this is a latent gap: **P3, add the ignore line.**

### CI secret handling

`.github/workflows/android-ci.yml:70` `echo "${{ secrets.KEYSTORE_FILE }}" | base64 -d > android/app/release-key.jks` — writes to an ephemeral runner, never uploaded. `:79-82` passes the store/key passwords as Gradle `-P` properties, which puts them on the **process command line** — visible in `ps` on the runner and, more relevantly, echoed into the build log unless the value happens to be masked by Actions' secret redaction (it is, since they come from `secrets.*`). Acceptable; the standard alternative is `ORG_GRADLE_PROJECT_*` env vars. **P3.**

`:102` `serviceAccountJsonPlainText: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}` — a Play publishing service account with upload rights, held as a repo secret. Correct pattern; note that anyone with write access to `.github/workflows/` can exfiltrate it, and there are no branch protections or required reviews evidenced anywhere (deploys are `git push origin main`, §14).

### Token logging

Grepped `console.*` calls whose text mentions token/ticket/jwt/session/key/email/password:

- `lib/supabase.ts:40` — `console.warn('Failed to get Clerk session token:', e)` — logs the **error**, not the token. Clean.
- `services/nativeAuthBridge.ts:121,122,125,128` — `console.log('Native session token obtained')` etc. Fixed strings, **no values**. Clean.
- `utils/nativeDeepLinks.ts:79-88` `logClerkAuthState` — logs `{isSignedIn, hasSession, sessionId, userId, signedInSessions}`. **`sessionId` and Clerk `userId` are logged** to the Android WebView console → `logcat`. Not a bearer credential (a session id cannot be replayed without the session cookie/JWT), but it is an identifier in device logs readable by anyone with ADB. `:123-127` and `:172-179` additionally log booleans about which Clerk params were present — no values. **P3.**
- `supabase/functions/native-bridge/index.ts:140` `console.log('Native session verified; sign-in token created')` — fixed string; the ticket itself is not logged. Clean.
- `supabase/functions/send-email/index.ts:247` `console.error('MailerSend API error:', errorText)` — MailerSend error bodies can echo recipient addresses into function logs. **P3, PII-in-logs.**
- `services/nativeGoogleAuth.ts:147,182` `MY_DEBUG:` logs — file is dead (Pass 0 §0.6), no runtime impact.
- `public/native-sso.html` — logs booleans and phase strings only (read; no token values).

### Other

- `scripts/deploy_test.ps1:10-12` hardcodes an ADB device serial `RZCW308ZM5Y` — a developer's physical phone. Not a secret; it is an artefact that makes the script useless to anyone else. **P3.**
- `.gitignore` contains `backup_*.sql`, which means someone produced manual database dumps at some point and chose not to commit them. Good instinct; also the only evidence of any backup activity (§14).
- **Git history is unavailable** (no `.git`). I cannot check whether a secret was ever committed and later removed. `docs/security-phase-a.md:15-20` says "if those values ever hit git history … treat them as burned", which implies the author already knows keys may be in history. **Carried as a coverage gap (§18).**

---

## 8. Privacy and PII

### 8.1 Inventory

| Table.column | Category | Notes |
|---|---|---|
| `people.name` | identity | free text |
| `people.email` | identity, contact | partial-unique |
| `people.avatar_url` | **biometric-adjacent (photograph)** | base64 data URL, inline in row |
| `people.clerk_user_id`, `people.user_id`, `people.auth_user_id` | pseudonymous identifiers | three columns for one identity |
| `groups.name` | inferred social graph | e.g. "Divorce lawyer fund" |
| `transactions.description` | **financial + inferable health/legal/religious** | free text, emoji appended |
| `transactions.comment` | as above | free text |
| `transactions.amount`, `date`, `payers`, `split_participants` | **financial** | |
| `payment_sources.name`, `payment_sources.details` (jsonb) | **financial instrument** | card issuer + last 4 digits, or UPI VPA (`components/PaymentSourceFormModal.tsx`) |
| `email_invites.email` | contact of a **non-user** | people who never consented and may never sign up |
| `ai_item_cache.normalized_name` | **financial, global, permanent** | see 8.3 |
| Sentry: user id + email + username, session replays | identity + screen contents | `App.tsx:58-64`, `index.tsx:19-31` |

### 8.2 Who can read what

- **`people`** — `i_can_see_person(id)` (`20260728000000:30-72`). Four disjuncts: self; share ≥1 group; you created a group containing them; **or `EXISTS (SELECT 1 FROM group_invites WHERE invited_by = p_person_id AND is_active AND expires_at > now())`** (`:65-71`). That last clause has **no relationship test at all** — while any of your invites is live (default 30 days, `supabaseApiService.ts:990-991`, and the UI creates them with `maxUses: null`, `GroupFormModal.tsx:163-169`), **every authenticated user on the platform can read your full `people` row**: name, email, avatar photo, and Clerk user id. **CONFIRMED. [P1-05].**
- **`getPeople` over-fetches.** `supabaseApiService.ts:803-806` `.select('*')`. The app uses `name`, `avatar_url`, `email`, `is_claimed`, `source` (`transformDbPersonToAppPerson:122-133`) — but the wire payload also carries `clerk_user_id`, `user_id`, `auth_user_id` for every co-member. Anyone with devtools can read their group-mates' Clerk identifiers. **P2, part of [P1-05]'s fix.**
- **`find_person_by_email(p_email)`** (`20260728000000:103-115`) — `RETURNS SETOF people`, `SECURITY DEFINER`, granted to `authenticated`. Any signed-in user can guess any address and, on a hit, receive the **entire row**: name, email, avatar, `clerk_user_id`, `is_claimed`. That is an unauthenticated-to-the-victim membership + identity oracle over the whole user base, callable at PostgREST speed with no rate limit (§6). **CONFIRMED. [P1-06].**
- **`get_invite_preview(p_token)`** (`20260812000000:77-159`) — granted to **`anon`**. Given a token it returns the group name, the inviter's name and avatar (`:150-155`; email is deliberately omitted, good), and **every email address invited under that invite** (`:120-124`, `:156`). Knowing the token is the intended secret, but the token is emailed to N people and shared over WhatsApp/SMS (`GroupFormModal.tsx:181-192`), so in practice every invitee learns every other invitee's address. **P2.**
- **Realtime.** `enable_realtime.sql:5-9` `REPLICA IDENTITY FULL` on all five tables → full-row payloads including `people.email`, `people.clerk_user_id` and the avatar blob, delivered to every subscribed client that passes RLS (`subscribeToPeople:450-464`). Same over-exposure as `getPeople`, continuously.
- `enable_realtime.sql:20-24` `GRANT SELECT … TO anon` on all five tables. With RLS on and no `anon` policy this yields nothing today, but it means **the moment RLS is disabled on any of those tables — as `COMPLETE_RLS_FIX.sql` and `DATABASE_FIX_DISABLE_RLS.sql` in this very repo do — the anon key reads the entire table.** Latent, and the loaded gun is committed next to it. **P2.**

### 8.3 The global AI cache leaks every user's novel expense descriptions

`services/tagClassifier.ts:430-459` `classifyDescription` runs on **every expense save** (`TransactionFormModal.tsx:291-301`). Layer 4 (`:453-457`): when keywords and cache miss, Gemini is called and the result is written back with `writeCache(key, tag)` (`:409-419`) → `INSERT INTO ai_item_cache (normalized_name, category, source)`. `normalized_name` is `description.toLowerCase().trim()` (`:388-389`) — **the raw text the user typed.**

`ai_item_cache` has no owner column and its SELECT policy is `USING (auth.role() = 'authenticated')` (`supabase-schema.sql:96-99`). Therefore:

- Any signed-in user can `GET /rest/v1/ai_item_cache?select=*` and read **every novel expense description ever typed by anyone**, with timestamps. "gynaecologist appointment", "bail money", "divorce lawyer retainer", "rehab deposit" — anything a keyword rule did not already catch, which is precisely the unusual, sensitive ones.
- There is no DELETE/UPDATE policy, so these rows are **immortal**, and `anonymize_my_account` does not touch them.
- The privacy policy (`public/privacy.html:30,37`) discloses Gemini as a processor for "category suggestion from expense descriptions" but **never says descriptions are retained in a shared, cross-tenant table readable by every other user.**

**CONFIRMED. [P1-07].** This is, in my judgement, the most surprising single finding in this pass: it is a cross-tenant data leak hiding inside a performance optimisation.

### 8.4 Sentry

`index.tsx:19-31`:

```
integrations: [browserTracingIntegration(), replayIntegration()],
replaysSessionSampleRate: 0.1, replaysOnErrorSampleRate: 1.0,
sendDefaultPii: true, enabled: import.meta.env.PROD
```

`App.tsx:58-64` adds `Sentry.setUser({id: person.id, email: person.email, username: person.name})`.

- `replayIntegration()` is called with **no options**. In `@sentry/react` v10, the defaults are `maskAllText: true` and `blockAllMedia: true` — text is replaced with blocks in the replay. **LIKELY** (vendor default; I did not fetch the v10 docs and the version in `package.json:37` is a caret range `^10.48.0`, so a minor bump could in principle change it). If that default holds, replays do **not** carry amounts or names in readable form. **If it does not, or if anyone adds `maskAllText: false` later, 10 % of all sessions and 100 % of erroring sessions ship a pixel-accurate recording of a financial ledger to a US-region Sentry project.** Given the value at stake, the options should be **explicit** rather than inherited: `replayIntegration({ maskAllText: true, blockAllMedia: true, maskAllInputs: true })`. **[P2-11].**
- `sendDefaultPii: true` attaches IP address and request headers to every event. Combined with `setUser({email})`, Sentry holds a name↔email↔IP↔behaviour record for every user who errors. That is a processor relationship the privacy policy does discloses in general terms (`privacy.html:26,38`) but the "may capture on-screen content **if enabled**" hedge at `:26` is misleading — it *is* enabled, unconditionally, in production.
- `release` is **not set** in `Sentry.init`, and `vite.config.ts:256` sets `sourcemap: false`. See §13 — this makes the replays and stack traces far less useful than the privacy cost implies.

### 8.5 Console logging of PII

112 `console.*` calls in app code, none stripped from the production bundle (§11). Ones that emit data rather than fixed strings:

- `supabaseApiService.ts:518` `console.log('📊 Fetching transactions for groups:', groupIds)` — array of group UUIDs.
- `:532` `console.log(\`📊 Fetched ${data?.length} transactions from DB\`)`.
- `:208,211,214` group-member insert results.
- `:867,878` `console.warn('⚠️ Error checking clerk_user_id:', authIdError)` / `claim_person_by_email` errors — PostgREST error bodies, which include column and policy names.
- `RealtimeStatus.tsx:8,13,18,21,29` — connection lifecycle.
- `utils/nativeDeepLinks.ts:81-87` — Clerk `sessionId` + `userId` (§7).

All of these are visible only in devtools/logcat on the user's own device, so the exposure is to the device owner and to anyone with physical/ADB access. **P3 individually; P2 collectively** because it is also the reason the production bundle carries a payload of debug strings (§11).

### 8.6 What actually survives "Delete Account"

`components/SettingsModal.tsx:160-181` `confirmDeleteAccount` → `anonymizeMyAccount()` → `anonymize_my_account()` (`20260813000000:28-39`), which sets on **one row only**:

```
name='Deleted user', email=NULL, avatar_url='', clerk_user_id=NULL,
auth_user_id=NULL, user_id=NULL, is_claimed=FALSE, source='deleted'
```

Then `clerkUser.delete()` in a **swallowed** try/catch (`:167-173`).

**Enumerated survivors:**

| What survives | Where | Contains |
|---|---|---|
| Every transaction you created or were split into | `transactions` | amount, date, description (**your typed text**), comment, your person id in `payers`/`split_participants`/`paid_by_id` |
| **All your payment sources** | `payment_sources` — `anonymize_my_account` **never touches this table** | card issuer + last 4 digits, UPI VPA, still joined to your surviving `people.id` |
| Your group memberships | `group_members` — untouched | you remain a member of every group as "Deleted user" |
| Every email address you invited | `email_invites.email` | third parties' addresses, `invited_by` still points at your row |
| Every invite you created | `group_invites.invited_by` | FK to your surviving row |
| **Every novel expense description you typed** | `ai_item_cache.normalized_name` | global, permanent, readable by all users (§8.3) |
| Sentry events and session replays | Sentry US project | subject only to Sentry's own retention |
| Group deletion requests you filed | `group_deletion_requests.requested_by` | |
| Your Clerk account | Clerk | **if `user.delete()` failed** — the failure is caught and logged, and the user is still shown "Your account data has been deleted" (`:174`) |

The confirmation dialog tells the user this "will permanently delete your profile **and remove you from all groups**" (`SettingsModal.tsx:321`). **It does not remove you from any group.** That is a false statement in a GDPR/DPDP-relevant flow. **[P1-08].**

Worse, the ordering is anonymize-then-delete: if Clerk deletion fails (it is disabled by default and must be turned on in the dashboard — `docs/play-store-launch.md:11` lists it as a manual blocker), the user can sign in again. `ensure_my_person` then finds no row with their `clerk_user_id`, and no unclaimed row with their email (it was nulled), so it **creates a brand-new person row** (`20260813020000:146-165`). The old row stays behind as an unreachable ghost member holding their entire ledger. This is exactly the duplicate-identity class that `DUPLICATE_USER_FIX_SUMMARY.md` documents happening in production before. **[P1-08], and see §10.**

### 8.7 `privacy.html` vs reality

| Claim (`public/privacy.html`) | Reality |
|---|---|
| `:26` "session replay **may** capture on-screen content **if enabled**" | It is enabled unconditionally in production (`index.tsx:23,26-27`) |
| `:43` "Group members you add can see names, amounts, and related activity in shared groups" | Understates it: `find_person_by_email` exposes any user's row to any user (§8.2); `ai_item_cache` exposes descriptions to all users (§8.3); an active invite exposes your row platform-wide (§8.2) |
| `:46` "We keep account and expense records until you delete your account" | `payment_sources`, `email_invites`, `ai_item_cache` and `group_members` survive deletion (§8.6) |
| `:50` "Access and export: Settings → Data Management (**where available**)" | Export works (`SettingsModal.tsx:121-155`). **Import is a lie** — `handleImport` (`:156`) shows a success toast and does nothing |
| `:52` "Deletion: Settings → Delete Account" | Succeeds in the DB, may silently fail at Clerk (§8.6) |
| `:42` heading "Legal basis / sharing" | No legal basis is actually stated anywhere in the document |
| `:19` "Contact: the email listed on the Google Play Store listing" | No controller name, no address, no DPO. Thin for GDPR Art. 13; India's DPDP Act requires a named Data Protection Officer or contact for a Data Fiduciary |
| Not mentioned at all | `ai_item_cache` retention; that Sentry is US-hosted (cross-border transfer); a retention period for anything |

**[P2-12].**

### 8.8 Play Data Safety draft vs reality

`docs/play-store-launch.md:49-55` declares: Name, email, user IDs, photos, financial info, app activity/diagnostics; shared with service providers; encrypted in transit; deletion available; not for children.

Accurate as far as it goes. Two gaps against Google's Data Safety form:

- **"Financial info → Purchase history / Other financial info"** must be declared as *collected and stored*, and Play requires you to say whether data is **processed ephemerally**. Expense descriptions going to Gemini and *persisting* in `ai_item_cache` is not ephemeral processing.
- The form asks whether users can **request data deletion** *and* whether data is actually deleted. Given §8.6, "Yes" is not accurate for payment sources and cached descriptions.

**P2, folded into [P2-12].**

---

## 9. Error handling

### 9.1 Empty catches

**Confirmed: 0 truly empty catch blocks in application code.** The closest are deliberate no-ops with a comment: `index.html:143` `catch(e) {}` around the FOUC theme script (correct — localStorage can throw in private mode), `TransactionFormModal.tsx:298-300` `catch { /* keep current tag */ }` (correct — tag suggestion is best-effort), `nativeDeepLinks.ts:151` `Browser.close().catch(() => {})`, `App.tsx:965` `sub.then(...).catch(() => {})`.

### 9.2 Catch-and-console-only on paths that matter

Of ~70 catch sites in app code, these are the ones on money or auth paths where the user is left with **no signal at all**:

| Location | Function | What the user sees |
|---|---|---|
| `App.tsx:359-361` | `handleSaveTransaction` | **The modal closes as if the expense saved.** No toast, no retry, no cache entry. The expense simply does not exist. This is the single most damaging one: it is the primary write path of the entire product. |
| `App.tsx:340-342` | `handleConfirmDeleteTransaction` | Delete dialog closes; row is removed from the cache at `:338` **only on success**, so on failure the row stays and the user thinks nothing happened. Silent. |
| `App.tsx:498-500` | `handleSavePaymentSource` | Modal closes (`:497` runs before the catch is possible — actually `:497` is inside `try`, so on failure the modal stays open with no message). Silent. |
| `App.tsx:512-514` | `handleArchivePaymentSource` | Silent. |
| `App.tsx:291-293` | `groupMemberAdded` refresh | Silent stale data. |
| `contexts/SupabaseAuthContext.tsx:75-79` | `syncUser` | **`setPerson(null)` on *any* error.** Every query is `enabled: !!personId` (`services/queries.ts:260,268,276,284`), so the user lands on a fully rendered, completely empty app — no groups, no expenses, no error, no retry. Indistinguishable from "you have no data". A transient `ensure_my_person` failure looks like data loss. |
| `services/emailService.ts:91,96,106` | all senders | `console.warn` only; `createGroupInvite` fires the send with `.then/.catch` (`supabaseApiService.ts:1051-1057`) so a failed invite email is invisible to the inviter, who believes the person was emailed. |
| `services/tagClassifier.ts:403,414-418` | `lookupCache` / `writeCache` | Silent by design; acceptable. |
| `services/geminiService.ts:497-503,514-519` | `suggestTagForDescription` | Silent by design, and gated on `import.meta.env.DEV`. Acceptable. |
| `utils/nativeDeepLinks.ts:158-165` | `consumeCapturedSsoCallback` | Returns `false`; `SsoFinish` is left to time out. The user sees a spinner. |

**[P0-13]** covers the expense-save case; the rest are folded into **[P1-16]**.

### 9.3 Errors returning success

Three functions return `{success: true}` after an operation that may have affected zero rows, because supabase-js only populates `error` on an actual failure, not on an empty result set:

- `deleteTransaction` (`supabaseApiService.ts:686-696`)
- `deletePaymentSource` (`:736-745`), `archivePaymentSource` (`:747-756`)
- `unarchiveGroup` (`:2-6`), **`archiveGroup` (`:22-31`)** — the latter is the §1.3 non-creator case, where zero rows is the *normal* outcome.

None passes `{ count: 'exact' }` or checks `data.length`. **The API contract is wrong: these functions claim "I did it" when the correct answer is "RLS refused, or the row is gone."** Every caller then patches the local cache on the strength of that lie. The *cache* consequence is the sync pass's; the *contract* consequence is that there is no way for any caller — present or future — to distinguish success from denial. **[P1-03]** and **[P2-17]**.

### 9.4 Raw backend errors shown to users

`toast.error(error.message)` with a raw PostgREST/Postgres message at:

- `App.tsx:239` — `Failed to process invite: ${error.message || error}`
- `App.tsx:266` — `Error loading data: ${error?.message || error}`
- `App.tsx:471` — `Error saving group: ${error?.message || error}`
- `App.tsx:557` — `e.message || 'Failed to delete group.'`
- `App.tsx:571` — `e.message || 'Failed to archive group.'`
- `supabaseApiService.ts:346` — rethrows as `Database error: ${groupError.message}`, which then reaches `:471`

PostgREST error bodies contain the constraint name, the column name, and — for RLS denials — text of the form `new row violates row-level security policy for table "people"`. Users are shown internal schema and policy names in a toast. Not a serious information leak (the schema is inferable from the client bundle anyway) but it is a poor experience and it puts policy names in screenshots and support tickets. **P3, [P3-18].**

`components/ErrorBoundary.tsx` is clean: the stack trace block at `:62-69` is gated on `import.meta.env.DEV`, so production users get only "Something went wrong" + Try Again / Refresh. `componentDidCatch:24-27` reports to Sentry with the component stack. **No findings here.**

### 9.5 Unhandled promise rejections

- `_broadcastTxChange` (`supabaseApiService.ts:481-487`) — `_txPublishChannel.subscribe()` and `.send({...})` are both **un-awaited and un-caught**. `send()` returns a promise; a rejection (channel not yet `SUBSCRIBED`, socket down, JWT expired) becomes an unhandled rejection. Because the write already committed, the visible symptom is "my expense didn't appear on the other phone" with no error anywhere. Sync pass owns the consequence; the error-handling defect is that a fire-and-forget promise on the critical propagation path has no handler.
- `writeCache` (`tagClassifier.ts:410-418`) — `.then()` with no `.catch()`. A network failure here is an unhandled rejection on every expense save that reaches Gemini.
- `SettingsModal.tsx:67` `void queryClient.invalidateQueries(...)` — `void` marks it deliberate but still leaves no handler.
- `sendGroupInviteEmail` (`supabaseApiService.ts:1051-1057`) — correctly has both `.then` and `.catch`.

**[P2-19].**

### 9.6 Partial-write failure modes

See §10 — every one of them surfaces here as "the promise rejected in the middle and the caller has no idea which half committed".

---

## 10. Transactions (atomicity)

**There is not one database transaction anywhere in this codebase.** Every multi-step write is a sequence of independent PostgREST HTTP calls issued from a browser, on a mobile network, with no rollback and no idempotency key. Here is each one and exactly what a mid-failure leaves behind.

### `addGroup` — `supabaseApiService.ts:168-217`

Steps: (1) `INSERT groups`; (2) `INSERT group_members` (creator + selected members, one bulk insert).

If (2) fails, `:207-210` logs and rethrows. **Left behind: a group row with zero members.** The creator still sees it — the `groups` SELECT policy is `created_by = requesting_user_id() OR i_am_member_of(id) OR (created_by resolves to me)` (`20260412000005:88-97`) — so the group appears in *their* sidebar forever with an empty member list. Nobody else can see it (`i_am_member_of` is false for everyone). `App.tsx:469-474` shows `Error saving group: …` and keeps the modal open, so the user hits Save again and creates a **second** orphan. There is no cleanup path and no way to delete an empty group from the UI except via the group-edit modal, which requires selecting it.

### `updateGroup` — `supabaseApiService.ts:326-373`

Steps: (1) `UPDATE groups`; (2) **`DELETE FROM group_members WHERE group_id = …`** — all of them; (3) `INSERT` the new member list.

Between (2) and (3) the group has **no members at all**. If (3) fails — network drop, a `person_id` that no longer exists, the unique constraint, RLS — the group is left permanently memberless:

- `i_am_member_of(group_id)` is now false for **everyone**, so no member can read the group, its transactions, or its invites.
- The creator still sees the group (the `created_by` disjunct) but with an empty member list.
- **The transactions are all still there**, referencing person ids that are no longer members. Balances render against ghosts.
- Realtime `group_members` DELETE events fire for every removed member, and `useRealtimeGroupMembersBridge:434-444` **removes the group and all its transactions from every other member's cache immediately**. So every other member watches the group vanish from their app in real time, and it does not come back.

`MEMBER_DISPLAY_BUG_FIX.md` describes members disappearing from group displays. I read it: it attributes the symptom to `getPeople` filtering and a `groupMemberAdded` refresh gap, and its fix is on the read side. **The delete-then-reinsert window is a second, independent cause of the same symptom that that document does not mention.** Whether it is *the* cause of the production reports cannot be determined without logs. **[P0-14].**

The same window is also a plain correctness bug even when nothing fails: for the duration of two round-trips, every member's RLS check is false, so any concurrent read by any member returns 403/empty.

### `deleteGroup` — `supabaseApiService.ts:8-19`

```js
if (!isOwner) throw new Error('Only the group owner can delete the group.');
if (!allSettled) throw new Error('All balances must be settled …');
await supabase.from('group_members').delete().eq('group_id', groupId);   // result ignored
await supabase.from('transactions').delete().eq('group_id', groupId);    // result ignored
const { error } = await supabase.from('groups').delete().eq('id', groupId);
```

The `isOwner` and `allSettled` guards are **client-side arguments** — `App.tsx:544-546` computes `isAdmin` from `editingGroup.createdBy === currentUserId` and passes `allSettled` from a client-side balance computation (`App.tsx:138`). Neither reaches the database. Now trace the three deletes for a **non-creator** who calls this function directly (a modified client, a console call, or curl with their own JWT):

| Step | Policy | Result for a non-creator member |
|---|---|---|
| `DELETE group_members WHERE group_id=…` | `USING (i_created_group(group_id))` — `20260412000005:134-135` | **0 rows.** No error. Result discarded. |
| `DELETE transactions WHERE group_id=…` | `USING (i_created_group(group_id) OR i_am_member_of(group_id))` — **`20260412000008:244-245`** | **ALL ROWS DELETED.** No error. Result discarded. |
| `DELETE groups WHERE id=…` | `USING (i_created_group(id))` | **0 rows.** `error` is `null`, so `:17` does not throw. |

The function returns `{success: true}`.

**Net effect: any member of a group can permanently destroy the entire group ledger — every expense, every settlement, for every member — while the group itself survives, intact and empty.** No confirmation reaches the server, no `allSettled` check reaches the server, no audit row is written, and `deleteTransaction`'s own broadcast is not even fired so other clients discover it on their next refetch. There is no soft delete, no `deleted_at`, and no backup procedure documented anywhere (§14) — **the data is simply gone.**

`approveGroupDeletion` (`:245-277`) runs the identical three deletes at `:264-266` after checking `group.created_by !== approverId` **in JavaScript** (`:260`). Same exposure via the same path.

This straddles the auth pass (the policy asymmetry introduced by `20260412000008`) and this pass (the unchecked, non-atomic, result-discarding delete sequence). **I am reporting it here as [P0-15] because the atomicity angle is what makes it unrecoverable:** even a correct fix to the DELETE policy leaves a three-step non-transactional teardown that can strand a group half-deleted.

### `createGroupInvite` — `supabaseApiService.ts:973-1071`

Steps: (1) `SELECT group_members` membership check (client-side gate, `:977-986`); (2) `INSERT group_invites`; (3) for each email, `INSERT email_invites` **and** fire `send-email` — all inside `Promise.all` (`:1029-1063`).

`Promise.all` rejects on the **first** failure, but the other inserts and the other emails are already in flight and will complete. So a partial failure leaves: the `group_invites` row committed, an arbitrary subset of `email_invites` rows committed, an arbitrary subset of emails **sent**, and the caller sees `Failed to create invite link. Please try again.` (`GroupFormModal.tsx:176-179`). Retrying creates a **second** invite token and **re-sends** to everyone who already got one. Recipients get duplicate invites with different tokens; the group accumulates orphan invites that never expire from the UI's point of view (`deactivateInvite` is exported but never called — Pass 0 §0.6). **[P2-20].**

### `ensureUserExists` — `supabaseApiService.ts:846-912`

Chain: `ensure_my_person` RPC → on error, `SELECT people WHERE clerk_user_id` → `claim_person_by_email` RPC → plain `INSERT people` → on `23505`, re-`SELECT`.

The `23505` handler (`:899-907`) re-selects by `clerk_user_id` and returns the row if found, otherwise rethrows. `migrations/20250101_add_clerk_user_id_to_people.sql:7` adds `UNIQUE` on `clerk_user_id`, so **two concurrent first-logins for the same Clerk user now collide on the constraint and one of them recovers via the retry.** That closes the specific race described in `DUPLICATE_USER_FIX_SUMMARY.md` / `DUPLICATE_KEY_ERROR_FIX.md`.

Two residual holes:
- The `23505` could equally come from the **email** partial-unique index (`20260405000000:35`), in which case the re-select by `clerk_user_id` finds nothing and the error is rethrown — the user is logged in with `person = null` (§9.2) and sees an empty app.
- `ensure_my_person` itself is not idempotent across the *email* branch: if a placeholder with your email exists and is claimed by a racing request between the `EXISTS` check (`:116`) and the `UPDATE` (`:131-139`), you fall through to `INSERT` and get a second identity. Narrow, but the RPC is `plpgsql` without `FOR UPDATE` on that path, unlike `accept_group_invite` which does lock (`20260812000000:202`).

**[P2-21], LIKELY.**

### `acceptInvite` → re-`validateInvite` — `supabaseApiService.ts:1144-1189`

`accept_group_invite` is properly atomic inside the database: it takes `FOR UPDATE` on the invite row (`20260812000000:202`), inserts the membership, increments `current_uses`, and deactivates when `max_uses` is hit — all in one function call, one transaction. **This is the only correctly-transactional write in the codebase.**

The client then calls `validateInvite` again (`:1174`) purely to fetch the group name, and correctly falls back to the RPC's own `group_id`/`group_name` when the second preview says "invalid" because the invite just hit `max_uses` (`:1171-1186`). Handled.

### `batchApplyEmojisToGroupTransactions` — `supabaseApiService.ts:668-684`

A `for` loop of sequential `UPDATE`s, one HTTP round-trip each, no error handling inside the loop, no transaction. On a 200-expense group that is 200 serial round-trips (≈20–60 s on mobile); a failure at #137 leaves 136 descriptions mutated and 64 not. The caller (`App.tsx:386-391`) catches and `console.warn`s, so the user sees nothing. Re-running is safe-ish (the `/\p{Emoji}/u` filter at `:675` skips already-tagged rows) but any description that *legitimately* contains an emoji is skipped forever. **[P2-22].**

### `anonymizeMyAccount` + Clerk delete — `components/SettingsModal.tsx:160-181`

Order: DB anonymize **first**, Clerk delete **second**, Clerk failure **swallowed**, success toast shown **regardless**, then `signOut()`.

The failure mode is fully traced in §8.6: a surviving Clerk account plus an anonymized-and-orphaned `people` row equals a duplicate identity on the next login and a permanently stranded ledger. The correct order is Clerk-first (so a failure aborts before the irreversible DB mutation), or better, one server-side operation that does both. **[P1-08].**

---

## 11. Performance

### N+1 and unbounded queries

- **`getGroups` is N+1.** `supabaseApiService.ts:136-166` fetches the groups, then `transformDbGroupToAppGroup` (`:54-75`) issues **one extra `GET /group_members` per group** inside `Promise.all`. 20 groups = 21 round-trips. `getArchivedGroups` (`:34-47`) does the same. The join is already available — `.select('*, group_members(person_id)')` would collapse it to one request.
- **`getTransactions` is unbounded and cross-group.** `:490-535`: fetch all my `group_id`s, then `GET /transactions?group_id=in.(…)&order=date.desc` with **no `.limit()`, no `.range()`, no date window**. Every load, and every `tx` broadcast, pulls the user's entire lifetime of expenses across every group. There is no pagination anywhere in the app (grep: zero `.range(` and zero `.limit(` on list queries).
- **`getPeople` is three sequential queries** (`:766-806`) — my memberships, then all members of those groups, then all those people with `select('*')`. Each waits on the previous.
- **Every `people` SELECT runs `i_can_see_person` per row.** `20260728000000:37-71` is four `EXISTS` subqueries, two of which join `group_members` twice, and one of which calls `i_created_group` (itself another `EXISTS` over `groups` + `people`). For a `getPeople` returning 100 rows that is **400 correlated subqueries**, several of them scanning `group_members` without a covering index for the `their_gm.person_id = p_person_id` shape. At 100 people this is milliseconds; at 10,000 rows in `people` and a user in 20 groups it degrades non-linearly. Also `find_person_by_email` (`:113`) filters on `lower(trim(email))` while the index is on plain `email` (`20260405000000:35`) — **no functional index exists, so that RPC is a sequential scan of `people` on every invite-by-email lookup**, and it is callable by anyone with no rate limit (§6, §8.2).

### Realtime fan-out

`_broadcastTxChange` (`:481-487`) sends a `tx` broadcast on **every** transaction insert, update and delete. `services/queries.ts:107-109` turns every received `tx` into `qc.invalidateQueries(qk.transactions(personId))` — a **full, unbounded `getTransactions` refetch across all of that user's groups**, regardless of which group the broadcast named (`_groupId` is received and discarded).

The broadcast channel `public:transactions` is a **single shared topic with no filter**, so every client in the entire application receives every other client's `tx` event. **One user adding one expense causes every connected client in the product to refetch their entire transaction history.** That is O(users²) work per write at the population level. At the current scale it is invisible; it does not have a scale at which it starts working better.

On top of that, the `postgres_changes` INSERT for the same row arrives separately and *also* patches the cache (`queries.ts:96-100`), so each write is processed twice.

### Rendering

- `calculateGroupBalances` runs in `App.tsx:131-135` (memoized on `[transactions, selectedGroupId]` — good), **and independently, unmemoized-per-mount, in** `components/Dashboard.tsx:19-20` (plus `simplifyGroupDebts`), `components/MemberBalances.tsx:16`, `components/GroupBalancesModal.tsx:39,60`, `components/GroupSummaryCard.tsx:19`, `components/GroupView.tsx`, and `SettleUpModal.tsx:96-129`. Six or seven independent recomputations of the same numbers from the same props. Cheap per pass; the real cost is that they can and do **disagree** when one memo is stale — which is the money pass's problem, not mine, but the performance angle is that nothing caches a single derived result.
- **No virtualization.** `components/TransactionList.tsx:32` maps the array directly. `:28` rebuilds `peopleMap` on **every render** (not `useMemo`'d). A 500-expense group renders 500 `TransactionItem`s.
- `components/Avatar.tsx` decodes a base64 data URL per avatar per render context; with the §3 uncapped case that is megabytes of decode per list render.

### Bundle

- **`html2canvas` is statically imported by `components/GroupView.tsx:8`**, and `GroupView` is a **static** import in `App.tsx:8`. `vite.config.ts:121-122` puts html2canvas in its own `vendor-html2canvas` chunk, but a static import from an eagerly-loaded module keeps that chunk in the initial module graph — **~200 KB minified ships and executes on every app boot** for a feature used only when someone taps Share. The fix is a one-line `await import('html2canvas')` inside the two handlers (`GroupView.tsx:134`, `GroupSummaryModal.tsx:90`). **[P2-23].**
- `lucide-react` is imported per-icon in `components/icons/Icons.tsx`, so ESM tree-shaking applies. Fine.
- `vite-plugin-node-polyfills` with `protocolImports: true` (`vite.config.ts:190-192`) injects Buffer/process/stream shims into a **browser-only** bundle. Nothing in app code imports a node builtin (grep). This was almost certainly added to silence a transitive warning and now adds dead weight to every build. **P3.**
- **`console.*` is not stripped.** `build.minify: 'esbuild'` (`:255`) with **no `esbuild: { drop: ['console', 'debugger'] }`** and no `pure` config. All 112 `console.*` calls, including their emoji-laden template strings, ship to production and execute on every user's device. **[P2-24].**
- `sourcemap: false` (`:256`) — see §13.
- `terser` is a declared devDependency (`package.json:67`) but `minify` is `'esbuild'`, so it is never used.

### Other

- `React.StrictMode` (`index.tsx:80`) double-invokes effects in **dev only**; no production cost.
- `RealtimeStatus` (`components/RealtimeStatus.tsx:11`) opens a **sixth** WebSocket channel (`heartbeat`) purely to render a 40×16 px badge.
- `requestIdleCallback` preloads three modal chunks (`App.tsx:67-75`) — correctly guarded and correctly cancelled. Good.
- `App.tsx:454` `await new Promise(resolve => setTimeout(resolve, 0))` to "ensure cache update is processed" — a scheduling guess, not a synchronisation primitive, followed at `:457-467` by a re-check and a full invalidate+refetch fallback. Works by accident. **P3.**

---

## 12. Testing

### Inventory

| Suite | Files | Assertions | Runs where |
|---|---|---|---|
| Vitest unit | 17 in `src/test/` + **`hooks/useModals.test.ts` at repo root** (`vitest.config.ts:464-472` excludes only `node_modules`, `dist`, `build`, `.claude`, `tests/`, `android/` — so the root-level test **is** collected) | ~150 `it()` | **Nowhere in CI.** No workflow invokes `vitest`. |
| Playwright unauth | `tests/app.spec.ts` (9 tests) | title, sign-in heading, manifest, legal pages | `.github/workflows/playwright.yml` |
| Playwright authed | `tests/authenticated.expense.spec.ts`, `authenticated.settle-up.spec.ts` | expense + settle-up flows | **Skipped in CI** |

### What is mocked

`src/test/setup.ts:92-105` `vi.mock('../lib/supabase')` replaces the client with a chainable stub. **Every database interaction — RLS, constraints, RPCs, realtime — is replaced by `vi.fn()`.** No test in this repo has ever executed a real query.

### Direct answer: is there ONE test asserting a money invariant?

**No.**

- `src/test/utils/calculations.test.ts` has **49 `it()` blocks**. There is **no `describe('calculateGroupBalances')` at all** — the function that produces every balance the app displays (`App.tsx:134`, `Dashboard.tsx:19`, `MemberBalances.tsx:16`) has **zero tests**. So **Σ balances = 0 is never asserted anywhere.**
- `calculateShares` has 6 tests (`:14,34,54,78,102,126`). The `equal` test (`:54-77`) splits **100 between 2 people** and asserts `50` and `50` — a case that divides exactly. **There is no 100/3 case, and no test asserts that the returned shares sum back to `amount`** in any mode.
- The suite's most rigorous tests — `distributeRounding` (3), `materializeSplit` (6), `validateSplit` (11) — cover **functions that are not called from anywhere in the application.** I grepped every `.ts`/`.tsx` outside `utils/calculations.ts` and `src/test/`: `distributeRounding`, `materializeSplit` and `validateSplit` have **zero non-test callers.** 20 of 49 tests in the money test file exercise dead code.
- The one thing that comes closest is `getUserFacingDebts` → `'card totals match sum of breakdown lines'` (`:457`). That asserts two *derived views* agree with each other; it does not assert either is correct, and it does not touch `calculateGroupBalances`.

**Coverage of money invariants: 0 tests.** (1 if you count the derived-view consistency test generously.)

### Direct answer: is there ONE test asserting an authorization boundary?

**No.** Zero. Supabase is mocked at the module level, so a non-member reading a group, a non-creator archiving, an RLS `WITH CHECK` on `people`, or the `deleteGroup` policy asymmetry in §10 **cannot be expressed** in this suite. RLS — the *only* server-side authorization in the entire system — has no automated test of any kind. `scripts/rls-beta-audit.sql` exists but is a manual `pg_policies` query, not a test, and (per Pass 0 §0.4.3) it only greps for policy names matching `%allow all%`, so it would not catch the `HOTFIX_reset_all_policies.sql` `*_all` policies either.

**Coverage of auth paths: 0 tests.**

### Dead-code test tax

| File | LOC | Target |
|---|---|---|
| `hooks/useModals.test.ts` | 663 | `hooks/useModals.ts` — zero importers |
| `src/test/utils/paymentSourceMetrics.test.ts` | 284 | `utils/paymentSourceMetrics.ts` — zero importers; `App.tsx:145-166` re-implements it inline |
| `src/test/services/nativeGoogleAuth.test.ts` | 62 | `services/nativeGoogleAuth.ts` — zero importers |
| ~20 of 49 in `calculations.test.ts` | ~200 | `validateSplit` / `materializeSplit` / `distributeRounding` |

**≈1,200 of 3,185 unit-test lines (≈38 %) test code that cannot execute in the running app.** They still count toward the 10.76 % coverage figure, so the real coverage of *reachable* code is lower than the number in `vitest.config.ts:494`.

### CI

- **`.github/workflows/android-ci.yml` never runs a test.** Read end to end: checkout → `npm ci` → validate 3 secrets exist → `npm run build` → `cap sync` → JDK → Android SDK → decode keystore → `bundleRelease` → upload artifact → **upload to Google Play internal track**. There is **no `npm run test:run`, no `tsc --noEmit`, no lint** anywhere in the file. Every push to `main` publishes to real testers with zero automated verification. **CONFIRMED. [P1-25].**
- `.github/workflows/playwright.yml:127` runs `npx playwright test` with **no `env:` block and no secrets**. Consequences: (a) `hasAuthCreds` is false (`playwright.config.ts:8`), so the `chromium-auth` project and the `auth setup` project are **not even created** — the two authenticated specs silently do not run; (b) `PLAYWRIGHT_BASE_URL` is unset, so `webServer` starts `npm run dev` (`:96-101`) **with no `VITE_CLERK_PUBLISHABLE_KEY` and no Supabase env** — `index.tsx:67-77` then renders the "Configuration Error" screen. `tests/app.spec.ts:25` expects a `heading` named `/sign in/i` within 15 s and `:66-75` expects the legal pages. **The sign-in test must fail on every CI run** unless Vercel/Actions injects those vars some other way (nothing in the repo does). Either the job is red and ignored, or something outside the repo is supplying env. **LIKELY. [P2-26].**
- **Nothing invokes `vitest` in CI.** `test:coverage` and its thresholds (`vitest.config.ts:496-501`) exist but are never enforced by any automation. **CONFIRMED.**

---

## 13. Observability

### The question: "user X says their balance is wrong." Can it be answered in production?

**No — not without manually reading raw rows and recomputing by hand, and even then you cannot prove what the user saw.**

Here is everything that exists and why each one fails to answer it:

| Signal | Present? | Why it doesn't help |
|---|---|---|
| Server logs of writes | **No.** No app server exists. PostgREST request logs live in the Supabase dashboard; retention is plan-dependent and unverifiable from the repo, and they record HTTP verbs and paths, not row contents. |
| Audit table | **No.** Grepped every SQL file: no audit/history/event table, no triggers other than the five `update_*_updated_at`. |
| `created_by` on `transactions` | **No.** The table has `paid_by_id` (who *paid*) but no record of **who entered the row**. So "who added this expense?" is unanswerable *by design*. |
| Row history | **No.** `updated_at` only — one timestamp, overwritten on every edit. Previous amounts, previous splits, previous participants are gone. No soft delete. |
| Deleted rows | **Gone.** Hard `DELETE`. §10 shows any member can wipe a group's ledger with no trace at all. |
| Request ids / correlation ids | **No.** Nothing generated, nothing propagated. |
| Client version in errors | **No.** `Sentry.init` (`index.tsx:19-31`) sets `environment` but **not `release`**. Every event says "production" and nothing else. You cannot tell whether a report comes from the current web bundle, a stale cached service worker (§14), or an Android build from three versions ago. |
| Readable stack traces | **No.** `vite.config.ts:256` `sourcemap: false`, `minify: 'esbuild'`, and no Sentry source-map upload step in either workflow. **Every Sentry stack trace points into minified single-letter identifiers with no mapping.** |
| Session replay | Partially — 10 % of sessions, 100 % of erroring sessions. But: replays only exist where an error was *thrown*, and the balance bug throws nothing; text is masked by default (§8.4), so the numbers on screen are unreadable anyway. |
| Event/analytics logging | **No.** No product analytics of any kind. |
| Client console logs | 112 of them, shipped to production, **invisible** unless the user opens devtools or you have ADB on their phone. |
| A server-side balance to compare against | **No.** Balances are 100 % client-derived (`utils/calculations.ts`); there is no balances table, no view, no RPC. There is **no server number to compare the user's number against.** |

**The complete answerable procedure today is:** open the Supabase table editor, filter `transactions` by `group_id`, export the rows, re-implement `calculateGroupBalances` by hand in a spreadsheet, and hope the discrepancy is in the data rather than in a stale client cache, a float-rounding path, an unmemoized recomputation, a `NaN` from a malformed `split_participants`, or a row that a member deleted and no longer exists. You cannot distinguish "the data is wrong" from "this user's client is showing stale data" from "someone edited it and edited it back", because none of those leave a trace. **[P1-27].**

The single cheapest fix that would change this answer: add `created_by` + an `INSERT`/`UPDATE`/`DELETE` audit trigger writing to an append-only `transactions_audit` table, and set `Sentry.init({ release })` from the build. Both are hours, not weeks.

---

## 14. Build, environments, release

### How it deploys

`deploy-main.ps1` (read in full): `Set-Location $PSScriptRoot` → assert branch is `main` → `git add -A` → `git commit -m "chore: deploy latest changes"` → `git push origin main`. That single push simultaneously triggers:

1. **Vercel production deploy** of `www.motamaati.in` (`vercel.json`, framework auto-detect).
2. **`android-ci.yml`** → build → sign → **upload AAB to the Google Play internal track with `status: completed`** (`:105-106`).

There is **no staging environment, no preview gate, no test gate, no approval, no branch protection evidenced anywhere, and no changelog** beyond `distribution/whatsnew/en-US.txt`. Commit messages are a fixed string by default (`deploy-main.ps1:7`), so the git history — if it existed — would carry no information about what shipped. **[P1-28].**

### Does production run this code?

Unknowable. No `.git`, no build fingerprint in the app, no `release` in Sentry, no `/version` endpoint. `components/AboutSection.tsx:8` hardcodes `Version: 1.0.0` — which matches neither `android/app/build.gradle:25` (`1.0.6`) nor the CI scheme (`1.0.${{ github.run_number }}`) nor `package.json:4` (`1.0.0`, coincidentally). **Four version numbers, no single source of truth, and the one the user can actually see is the one that is definitely wrong.**

### Version-code collision

`android/app/build.gradle:24-25` defaults to `versionCode 7 / versionName "1.0.6"`; CI overrides with `-PversionCode=${{ github.run_number }} -PversionName="1.0.${{ github.run_number }}"`. `npm run android:build:release` (`scripts/android-release.ps1`) runs **locally** with no `-PversionCode`, so it produces **versionCode 7** every time. Once `github.run_number` passes 7 (it certainly has), a locally-built AAB is rejected by Play as a duplicate/lower version code — and if it *were* accepted first, CI builds below that number would be rejected instead. `docs/play-store-launch.md:20` still says "versionName 1.0.0, versionCode 1" and `:95` says "increment versionCode in build.gradle" — advice that directly conflicts with the CI scheme. **[P2-29].**

### Rollback

| Layer | Rollback path |
|---|---|
| Vercel web | Instant rollback exists in the Vercel dashboard — **vendor feature, LIKELY, unverified** |
| Google Play | **None scripted.** Halting a rollout is manual in the Play Console; installed apps cannot be downgraded |
| Android WebView bundle | **None.** The bundle is baked into the AAB (`capacitor.config.ts` has no `server.url` in release), so a bad client requires a new store release |
| PWA / service worker | **None, and worse — see below** |
| Database schema | **None.** Grepped all 43 SQL files: **zero `DOWN` migrations, zero rollback scripts.** Every `supabase/migrations/2026*` file carries "Apply manually via Supabase dashboard SQL editor" |
| Database data | **No backup or restore is mentioned, scripted, or documented anywhere.** `PRODUCTION_CHECKLIST.md:66-67` lists "Database backup strategy" as an unchecked box. `BACKEND_IMPLEMENTATION.md:110` asserts Supabase provides "Automatic backups and point-in-time recovery" — PITR is a paid add-on, not a default. `.gitignore` has `backup_*.sql`, which is the only evidence anyone ever took a dump. **[P0-30].** |

Combine [P0-30] with [P0-15] (any member can hard-delete a group's whole ledger): **there is a one-request, unauthenticated-by-any-server-check path to permanent, unrecoverable destruction of a group's financial history, and no restore capability of any kind.**

### Schema and secret deployment

Both by hand, into the production SQL editor and the Supabase secrets UI, with no ordering, no applied-state tracking, and four separate directories of SQL that partly contradict each other (Pass 0 §0.4.3). Edge functions likewise (`supabase functions deploy …` from a laptop). Nothing in CI touches the database or the functions, so **the schema the client was built against and the schema in production can drift silently, and nothing detects it.**

### Build configuration

- `vercel.json:323` `"installCommand": "npm install"` — **not `npm ci`.** With a caret-ranged `package.json` (React `^19.2.0`, Sentry `^10.48.0`, Clerk `^5.61.9`, supabase-js `^2.58.0`), every Vercel build is free to resolve different minor/patch versions than the committed `package-lock.json`. **The web build is not reproducible, and it does not match the Android build**, which correctly uses `npm ci` (`android-ci.yml:26`). Two artifacts from one commit, built from different dependency trees. **[P2-31].**
- **No `engines` field** in `package.json`. Android CI pins Node 20, Playwright CI uses `lts/*`, Vercel picks its own default, the developer machine runs Node 24 (Pass 0 §0.1). Four Node versions.
- `vite.config.ts:288-316` `define` re-declares six `import.meta.env.VITE_*` values that Vite already inlines from `loadEnv`. Harmless duplication, but it means an env var added to `.env` will **not** reach the bundle unless it is also added to this list — a trap for the next person.
- No lint config, no formatter, no `tsc --noEmit` in any script or workflow. `tsconfig.json` has no `strict`, and `allowJs: true`.

### PWA update flow — the stale-bundle trap

`vite.config.ts:199` `registerType: 'prompt'`, `:234-235` `clientsClaim: false, skipWaiting: false`. That configuration is correct **only if the app renders an update prompt**. Grepped the entire tree for `virtual:pwa-register`, `registerSW`, `useRegisterSW`, `needRefresh`, `updateSW`, `workbox-window`: **zero matches in application code.** `workbox-window` is a declared dependency (`package.json:48`) that is never imported.

So: vite-plugin-pwa's default `injectRegister: 'auto'` injects a bare registration script, the service worker installs, a new SW enters `waiting`, and **because `skipWaiting` is false and nothing ever calls `update()` or prompts, it stays waiting until every tab of the app is closed simultaneously.** For an installed PWA that a user never fully closes, that can be indefinite.

**Concrete consequence:** you push an RLS migration and a matching client change. The web deploy succeeds. A subset of users keep running the **previous** bundle — talking to the **new** policies — for days. Their writes get denied and, per §9.2, they see nothing. **[P1-32].**

Two more PWA problems:
- `public/manifest.webmanifest` is a **0-byte file**. `public/` is copied verbatim into `dist/` and vite-plugin-pwa emits its own `manifest.webmanifest`. Whichever writes last wins. If the empty one wins, `tests/app.spec.ts:42-59` (`manifest.name`, `manifest.display`, `manifest.icons`) fail on JSON parse, and the app is not installable. Cheap to check, cheap to fix: **delete the empty file.** **LIKELY, [P2-33].**
- The runtime-cache rule targets a host that cannot exist (§5).

### Missing `assetlinks.json` — Android App Links do not verify

`android/app/src/main/AndroidManifest.xml:49-57` declares `android:autoVerify="true"` for `https://www.motamaati.in/invite/*`, `https://motamaati.in/invite/*` and the two `/sso-callback` prefixes. Android App Link verification requires `https://<host>/.well-known/assetlinks.json` to serve a JSON statement naming `com.kharchbaant.app` and the release signing certificate's SHA-256 fingerprint.

`vercel.json:333-336` even contains a rewrite reserving that path — but:

```
$ find . -name "assetlinks.json" -not -path "./node_modules/*"
$ find . -name ".well-known" -not -path "./node_modules/*"
(no output)
```

**The file does not exist anywhere in the repository, and there is no build step that generates it.** Vercel will therefore 404 that path, verification fails, and `https://www.motamaati.in/invite/<token>` links **open in the browser instead of the installed app** — which is precisely the flow every emailed and WhatsApp'd invite uses (`supabaseApiService.ts:1011` builds the URL from `window.location.origin`). `docs/play-store-launch.md:26` claims "Invite deep link: `kharchbaant://invite/<token>`", but nothing in the app ever generates a `kharchbaant://` invite URL.

**CONFIRMED. [P1-34].** This is a silent, complete failure of the app's primary growth path on Android, and no test covers it.

### Invite URLs are built from `window.location.origin`

`supabaseApiService.ts:1011`. An invite created from a Vercel **preview deployment** (`kharch-baant-xyz.vercel.app`) produces an invite link pointing at that preview — which will be torn down, and which does not match the App Links host. Whether preview deployments share the production Supabase project is unverifiable (§18), but if they do, a preview-created invite is a permanently broken link written into `group_invites` and mailed to a real person. **P2, folded into [P1-34].**

### `.vercel-rebuild-trigger`

A committed file dated 2025-10-19 whose entire purpose is to be edited to force a rebuild. Harmless, but it is a marker that cache-invalidation was being handled by hand. **P3.**

---

## 15. Platform hygiene and accessibility

Brief, P3 unless it actually breaks something.

**Good:**
- `components/BaseModal.tsx` is genuinely well built: `role="dialog"` + `aria-modal="true"` (`:126-127`), `aria-labelledby`/`aria-describedby` wired to generated ids (`:128-129`), Escape handling (`:72-76`), focus moved to `[data-autofocus]` on open and **restored to the previously focused element on close** (`:99-106`), backdrop `aria-hidden` (`:135`), close button labelled (`:153`) with a visible `focus-visible:ring`. This is better than most production React apps.
- `AndroidManifest.xml:74` explicitly removes `com.google.android.gms.permission.AD_ID` via `tools:node="remove"` — a deliberate, correct privacy choice that also simplifies the Play Data Safety form.
- Only two permissions total: `INTERNET`, plus the AD_ID removal. Minimal.
- `index.html:132-145` theme script wrapped in try/catch — correct, `localStorage` throws in some privacy modes.
- `Avatar.tsx` has `title` + `aria-label` and an `onError` fallback to initials (`:110-119`).

**Issues:**
- **`android:allowBackup="true"`** (`AndroidManifest.xml:6`) with no `android:fullBackupContent` / `dataExtractionRules` exclusions. Android Auto Backup copies the app's data directory to the user's Google Drive, and for a Capacitor app that directory includes the **WebView's `localStorage`, cookies and IndexedDB for `https://www.motamaati.in`** — i.e. Clerk session material and `pendingInviteToken`. Restoring that backup onto a different device can carry an authenticated session with it. For a financial app, backup should be off or scoped. **[P2-35], LIKELY** (depends on whether the Clerk Android SDK and the WebView store tokens in backed-up paths, which I did not verify on-device).
- `android/app/src/main/res/xml/file_paths.xml` declares `<external-path name="my_images" path="." />` — the **entire external storage root** — plus the whole cache dir. The provider is `exported="false"` so only this app can mint URIs, but the scope is far wider than any feature needs (nothing in the app uses the FileProvider at all; it is Capacitor boilerplate). **P3.**
- `minifyEnabled false` in the release build type (`android/app/build.gradle:47`). No R8, no obfuscation, no shrinking. Most of the app is a WebView so the impact is small, but the native `ClerkNativeAuthPlugin` and `ClerkResults` ship as readable class names, and the APK is larger than it needs to be. **P3.**
- `components/RealtimeStatus.tsx:36-56` conveys connection state **by colour and a 10 px uppercase label**, with `pointer-events-none` on the badge — which means the `title` tooltip explaining it (`:37,49`) **can never be shown**. No `role="status"`, no `aria-live`, so screen readers never announce going offline. Colour-only + unreachable tooltip. **P3.**
- Money inputs are `type="number"` (`components/TransactionFormModal.tsx:394,482,565`, `components/SettleUpModal.tsx:231`) then read with `Number(amount)` / `parseFloat`. `type="number"` on mobile gives a numeric keypad (good) but accepts `e`, `+`, `-` and exponent notation, permits scroll-wheel changes on desktop, and in some locales rejects comma decimal separators. `inputMode="decimal"` on a `type="text"` with an explicit pattern is the usual fix. **P3** (the money pass owns the parsing consequences).
- `index.html:96` `lang="en"` only, and `components/LanguageSelector.tsx` is dead (zero importers). No i18n exists; the selector is a UI promise with nothing behind it. **P3** — delete it or wire it.
- `components/CurrencySelector.tsx` likewise dead, while `groups.currency` is an unconstrained free-text column (§1.1).
- Missing `key` props: grepped `.map(` render sites in `TransactionList`, `GroupList`, `MemberBalances`, `Dashboard`, `GroupSelectionList` — **all supply `key`**. No findings.
- `components/AboutSection.tsx:8` shows `Version: 1.0.0` — wrong (§14). Users cannot report which build they are on. **P3, but it compounds §13.**
- React 19 + `StrictMode`: no double-effect issues found; all effects with subscriptions clean up (`queries.ts` bridges, `SupabaseAuthContext:194-197`, `RealtimeStatus:28-31`, `BaseModal`).

---

## 16. Anything else

Things that do not fit a heading above but that a founder should know.

1. **"Reset All App Data" does nothing.** `components/SettingsModal.tsx:305-308`: the confirm dialog says *"This will permanently delete all your local settings, cached data, and preferences. This action is irreversible."* and `onConfirm` is `() => { toast.success('App data reset!'); setIsResetModalOpen(false); }`. No `localStorage.clear()`, no cache reset, nothing. The user is shown a scary irreversible warning, clicks through it, and is told it worked. **[P2-36].**
2. **"Import Data" does nothing.** `SettingsModal.tsx:156` `const handleImport = (file: File) => toast.success(\`Importing from ${file.name}\`)`. The button is rendered (`components/DataExport.tsx:49-57`) and the privacy policy cites Data Management as the mechanism for the user's data rights (`privacy.html:50`). **[P2-36].**
3. **`window` events as an IPC channel.** `App.tsx:281-301` listens for a `groupMemberAdded` `CustomEvent` on `window` and refetches people + groups. This is a global, untyped, un-namespaced message bus between two React components in the same tree — any script on the page can fire it, and there is no payload validation beyond destructuring `event.detail.groupId`. It exists because the two components have no shared state owner. **P3, but it is a smell that predicts more of the same.**
4. **`setTimeout(resolve, 0)` as a synchronisation primitive.** `App.tsx:454`, with a comment claiming it "ensures React Query has updated". It does not; `:457-467` then re-checks and falls back to invalidate+refetch. The fallback is what actually works. **P3.**
5. **`check-env.html` is a production diagnostic page.** `public/check-env.html` is served at `https://www.motamaati.in/check-env.html` and tells any visitor how the build reads environment variables. Not a leak (it prints only `location.hostname`/`protocol`), but it is unlinked debug surface on a production financial app. Delete it. **[P3-14].**
6. **`generate-icons.html`** is likewise a developer tool shipped to production.
7. **Empty `public/manifest.webmanifest`** — see §14.
8. **`AGENTS.md` instructs every AI agent to push project knowledge to an external service.** The Byterover MCP block tells the assistant to store and retrieve project knowledge from a third-party knowledge base. In a repo whose markdown contains schema, policy names, production hostnames and operational fix logs, that is an uncontrolled egress channel for internal architecture. It is also why `.agent/`, `.github/copilot-instructions.md`, `.clinerules/`, `.kilocode/`, `.roo/`, `.windsurf/`, `.cursor/`, `.kiro/`, `.qoder/`, `.augment/` all appear in `.gitignore`. **P2 as a process finding; [P2-37].**
9. **`AGENTS.md`'s own "Hard rules" are already violated by the code it describes** (Pass 0 §0.9 lists 14 doc-vs-code contradictions in `ARCHITECTURE.md` alone). Onboarding documentation that is wrong is worse than none: the next contributor — human or AI — will fix the modal system in `ModalContext.tsx`, which nothing imports.
10. **`knip-report.json` (98 KB, UTF-16) is committed** and references `.claude/worktrees/quizzical-wescoff/` — a path from someone's parallel AI worktree. Committed tool output that points at a machine-local path.
11. **`structure.txt` and `components.txt`** are committed UTF-16 `tree` dumps listing files that no longer exist. Three generations of stale inventory in the repo root.
12. **46 markdown files in the repo root**, ~10,300 lines, which `AGENTS.md` itself classifies as mostly historical. Six of them describe the *same* invite bug.
13. **`enable_realtime.sql:20-24` grants `SELECT … TO anon`** on all five core tables (§8.2) — inert today, catastrophic the moment anyone runs one of the two committed `DISABLE RLS` scripts.
14. **`inspect-db.mjs` is a 0-byte file**; `test-env.mjs` imports `./utils/envValidation.js`, which does not exist; `test-gemini.mjs` imports a `.ts` from `.mjs` and reads a key that was deliberately removed; `vercel-diagnostic.js` is a browser-console paste script with a `#!/usr/bin/env` shebang. Four broken scripts in the root.

---

## 17. Findings

### [P0-01] Identity RPCs take the email as a client parameter, so any new account can claim any unclaimed person
**Severity P0 · Confidence CONFIRMED · Input validation / identity** *(primary owner: auth pass — reported here for the unvalidated-parameter angle)*
**Location** `supabase/migrations/20260813020000_ensure_my_person.sql:100,109,130-144`; `supabase/migrations/20260812000000_phase_b_claim_invites_security.sql:12-49`; callers `services/supabaseApiService.ts:846-882`.
**What is wrong** `ensure_my_person(p_name, p_email)` and `claim_person_by_email(p_email, …)` are `SECURITY DEFINER` and take the email **as an argument from the browser**. `ensure_my_person` binds `clerk_user_id` from the JWT (correct) but selects the row to claim by `WHERE email = v_email AND is_claimed = false` — where `v_email` is attacker-supplied. `claim_person_by_email` validates that `p_clerk_id` matches the JWT but never validates `p_email` at all.
**Reproduce** Sign up a fresh Clerk account. Before any UI call, `POST /rest/v1/rpc/ensure_my_person {"p_name":"x","p_email":"<victim placeholder email>"}` with the new JWT. The victim's unclaimed `people` row — with its group memberships and its ledger position — is now yours.
**Blast radius** Full takeover of any placeholder identity whose email an attacker can guess, including their group memberships, their debts, and visibility of every transaction in those groups. Placeholder emails are enumerable through `find_person_by_email` ([P1-06]) and through `get_invite_preview` (§8.2).
**Why it exists** The claim-by-email feature is the app's headline differentiator from Splitwise; the email was threaded through as a parameter before Phase B hardened the *clerk id* to come from the JWT, and the email was never given the same treatment.
**Containment (minutes)** ~15: in both functions, replace the parameter with the verified email from the JWT — `current_setting('request.jwt.claims',true)::jsonb->>'email'` — and reject when it is absent. Deploy via the SQL editor.
**Correct fix** Claim only on the JWT's verified email claim; require the Clerk email to be marked verified; log every claim to an audit table; consider requiring an explicit confirmation step in the UI.
**Proof of fix** With account A's JWT, `ensure_my_person('x','b@example.com')` must not modify B's row. A pgTAP or Supabase-hosted integration test asserting exactly that.
**Depends on** Nothing.

### [P0-02] `send-email` is an open mail relay: any signed-in user can send arbitrary links to arbitrary addresses from the app's sender identity
**Severity P0 · Confidence CONFIRMED · Abuse / reputation / phishing**
**Location** `supabase/functions/send-email/index.ts:57-230` (all five branches); recipient fields `:100,123,143-144,198-203`; display-name fields `:101,133,174-175`; link fields `:87,103,135,221`.
**What is wrong** The function authenticates the caller (`:57`) and then performs **no authorization at all**: it never checks that the caller belongs to the group named in the payload, that the recipients are members of anything, or that the link points at the app's own domain. All five email types are reachable by any signed-in user, even though the UI only ever triggers `group_invite` (`services/emailService.ts:365-367`); `sendWelcomeEmail`, `sendMemberAddedEmail`, `sendSettleUpEmail`, `sendNewExpenseEmail` are dead in the client but **live on the server**.
**Reproduce** With any account's JWT: `POST /functions/v1/send-email {"type":"group_invite","data":{"inviteeEmail":"target@example.com","inviterName":"Kharch Baant Support","groupName":"Account verification required","inviteUrl":"https://attacker.example/phish","expiresInDays":1}}`. A DKIM-signed email from the app's verified domain arrives at the target with a "Join group" button pointing at the attacker's site.
**Blast radius** Domain reputation destroyed (SPF/DKIM/DMARC all pass, so it lands in inboxes); MailerSend account suspension; a phishing campaign attributable to the product; billing exposure. At the nominal rate limit that is 500 emails/minute per account via `new_expense`; the limit is per-isolate and does not hold (§6), so the practical ceiling is the MailerSend quota. Recipients need never have used the app.
**Why it exists** The five handlers were written as a generic email microservice before the RLS model existed, and the JWT check was added in Phase B as "auth" without anyone re-asking "authorized to do *what*".
**Containment (minutes)** ~10: comment out the four unreachable types (`welcome`, `member_added`, `settle_up`, `new_expense`) — the UI does not call them. Then in `group_invite`, refuse any `inviteUrl` that does not start with the app's own origin. That closes the phishing vector immediately.
**Correct fix** Stop taking content from the client entirely. The function should accept only an **invite id**, then look up the group, the inviter and the recipient list **server-side** with the service role, verify the caller is a member of that group, and construct the URL from a server-side constant. Add a durable per-user rate limit (a Postgres table, not an in-isolate `Map`) and a daily global cap with alerting.
**Proof of fix** A request with a foreign `inviteUrl` returns 400. A request naming a group the caller is not a member of returns 403. A request for a disabled type returns 400.
**Depends on** Nothing.

### [P0-14] `updateGroup` deletes every member before re-inserting; a mid-failure leaves the group permanently memberless
**Severity P0 · Confidence CONFIRMED · Atomicity / data loss**
**Location** `services/supabaseApiService.ts:326-373` — `:350-353` delete-all, `:359-366` re-insert. Realtime consequence: `services/queries.ts:434-444`.
**What is wrong** Editing a group's member list issues `DELETE FROM group_members WHERE group_id = $1` (all rows) followed by a separate `INSERT`. There is no transaction. If the insert fails — network drop, a stale `person_id`, RLS, the unique constraint — the group is left with zero members. `i_am_member_of` then returns false for everyone, so nobody but the creator can read the group, its transactions, or its invites. The transactions remain, referencing people who are no longer members.
**Reproduce** Open a group's edit modal, change the member list, and kill the network between the two requests. Or: add a member id that fails the FK. The group is now memberless and cannot be repaired from the UI by anyone except the creator.
**Blast radius** Every member of the affected group loses access to the group and all its expenses, immediately and permanently. `useRealtimeGroupMembersBridge` (`queries.ts:434-444`) makes it worse: the DELETE events cause every other client to **purge the group and its transactions from cache in real time**, so members watch their data disappear. Recovery requires manual SQL as `postgres`. There is no backup ([P0-30]).
**Why it exists** Delete-all-then-reinsert is the simplest way to express "set the member list" against a table with no upsert helper; the failure window was never considered because the app is written as if HTTP calls do not fail.
**Containment (minutes)** ~20: compute the diff client-side and issue only `DELETE … WHERE person_id IN (removed)` + `INSERT (added)`. That removes the window in which the group has zero members and makes a partial failure survivable.
**Correct fix** A `SECURITY DEFINER` RPC `set_group_members(p_group_id uuid, p_person_ids uuid[])` that does the whole diff in one transaction with the authorization check inside it.
**Proof of fix** With the insert forced to fail, the group's member list is unchanged afterwards. A test asserting `group_members` count is never 0 for a group that had members.
**Depends on** Nothing.

### [P0-15] Any group member can permanently destroy a group's entire ledger via `deleteGroup`, and the function reports success
**Severity P0 · Confidence CONFIRMED · Atomicity + authorization**
**Location** `services/supabaseApiService.ts:8-19` (`deleteGroup`) and `:245-277` (`approveGroupDeletion`, `:264-266`). Policies: `supabase/migrations/20260412000005:134-135` (members DELETE = creator only), **`20260412000008:244-245`** (transactions DELETE = any member), `20260412000005:113-114` (groups DELETE = creator only). Caller: `App.tsx:540-561`.
**What is wrong** The `isOwner` and `allSettled` guards are **JavaScript arguments** supplied by the caller (`App.tsx:544-546`), not server checks. The three deletes discard their results (`:12`, `:14` have no `error` destructuring at all). For a non-creator member the sequence resolves as: members delete → 0 rows, silent; **transactions delete → ALL rows deleted, allowed by `20260412000008`**; group delete → 0 rows, `error` null so `:17` does not throw. The function returns `{success:true}`.
**Reproduce** As a non-creator member of any group, from the browser console: `deleteGroup('<groupId>', myPersonId, true, true)`. Every expense and settlement in that group is permanently gone. The group survives.
**Blast radius** Total, irreversible loss of a group's financial history for every member. Hard `DELETE`, no soft delete, no audit table, no `created_by`, no backup or restore procedure of any kind ([P0-30]). The other members' first indication is that their balances are all zero.
**Why it exists** `20260412000008` widened transaction DELETE from creator-only to any-member to fix "non-creator deletes reappear after refresh", without noticing that `deleteGroup` performs a bulk `DELETE … WHERE group_id = …` through the same policy. The client-side `isOwner` gate was assumed to be the control.
**Containment (minutes)** ~5: delete lines `:12` and `:14` and let the `groups` DELETE cascade (`group_members.group_id` and `transactions.group_id` both have `ON DELETE CASCADE` per `supabase-schema.sql`). A non-creator's group delete then affects nothing at all. Same edit at `:264-266`.
**Correct fix** One `SECURITY DEFINER` RPC `delete_group(p_group_id)` that verifies `i_created_group` **and** recomputes settlement server-side, then deletes in one transaction. Separately: narrow the transactions DELETE policy so a member can delete only individual rows, not a bulk group-scoped set (e.g. require `id = ` a single value, or move deletion behind an RPC).
**Proof of fix** As a non-creator, `deleteGroup` leaves `SELECT count(*) FROM transactions WHERE group_id = …` unchanged and returns an error rather than `{success:true}`.
**Depends on** Coordinate with the auth pass on the policy change.

### [P0-13] Saving an expense fails silently — the modal closes and the expense does not exist
**Severity P0 · Confidence CONFIRMED · Error handling / data loss (user-perceived)**
**Location** `App.tsx:347-362`, catch at `:359-361`.
**What is wrong** `handleSaveTransaction` awaits `api.addTransaction`, and on rejection does `console.error('Failed to save transaction', error)` and nothing else. There is no toast, no Sentry capture, no retry, no optimistic entry to roll back — and because `addTransaction` has no optimistic write at all (`:353-355`, with the comment "realtime bridge will update cache"), the UI shows **no change whatsoever**. The modal closes at `:357` only on success, so on failure the user is left staring at a filled-in form with no explanation; if they close it, the expense is gone.
**Reproduce** Put the device in airplane mode, or let the Clerk JWT expire (60 s TTL), and save an expense. Nothing happens. No error. The expense is not saved.
**Blast radius** The primary write path of the entire product loses data silently. Every constraint violation (`amount > 0`, tag enum), every RLS denial, and every network failure lands here. Because balances are derived from transactions, a silently-dropped expense makes every member's balance wrong — and §13 shows that is then undiagnosable.
**Why it exists** The realtime-only propagation design (no optimistic update) means the success path is also "nothing visible happens immediately", so the failure path looks identical and nobody noticed.
**Containment (minutes)** ~5: `catch (error) { Sentry.captureException(error); toast.error('Could not save this expense. Please try again.'); }` — and do **not** close the modal.
**Correct fix** An optimistic `setQueryData` insert with a rollback on failure (TanStack `useMutation` with `onMutate`/`onError`), plus an explicit error state in the modal. The same treatment for `:340-342` (delete) and `:498-500` (payment source).
**Proof of fix** With the network offline, saving an expense shows an error toast and keeps the form open. A Sentry event exists.
**Depends on** Nothing.

### [P0-30] No database backup, no restore, no down-migrations — combined with [P0-15], destruction is permanent
**Severity P0 · Confidence CONFIRMED (absence) · Release / disaster recovery**
**Location** Absence across the whole repo. `PRODUCTION_CHECKLIST.md:66-67` (unchecked box); `.gitignore` `backup_*.sql`; `BACKEND_IMPLEMENTATION.md:110` (claims PITR without qualification); all 43 SQL files (zero `DOWN`/rollback).
**What is wrong** There is no backup script, no restore script, no documented procedure, no scheduled dump, no export job, and no down-migration for any of the 34 migration files. The only recovery mechanism that might exist is Supabase's own PITR — a paid add-on whose status on this project cannot be determined from the repo.
**Reproduce** Delete a group's transactions ([P0-15]). Attempt recovery. There is no path.
**Blast radius** Any data loss event — a member using [P0-15], a mis-pasted `DELETE` in the SQL editor, running one of the two committed `DISABLE RLS` scripts, or a bad hand-applied migration — is unrecoverable.
**Why it exists** Schema and data operations are entirely manual via the dashboard, so the operational tooling that would normally accompany migrations was never written.
**Containment (minutes)** ~30: confirm the Supabase plan; if PITR is available, turn it on. Otherwise add a scheduled `pg_dump` (GitHub Actions on a cron, encrypted artifact or object storage) and **test a restore once**.
**Correct fix** PITR on a paid plan, plus a nightly logical dump to independent storage, plus a documented and rehearsed restore runbook, plus a down-script for every future migration.
**Proof of fix** A restore of a test table from a backup, performed once and written down.
**Depends on** Prioritize alongside [P0-15].

### [P1-03] Non-creators cannot archive a group, but the app tells them they did
**Severity P1 · Confidence CONFIRMED · Correctness / API contract**
**Location** `services/supabaseApiService.ts:22-31`; policy `supabase/migrations/20260412000005:110-111`; caller `App.tsx:563-576`, cache write `:568`.
**What is wrong** `archiveGroup` is the non-creator path (`:23` throws if `isOwner`). It issues `.update({is_archived:true}).eq('id', groupId)` against a table whose UPDATE policy is `USING (i_created_group(id))`. A non-creator matches zero rows; PostgREST returns success with an empty result; `error` is null; the function returns `{success:true}`. `App.tsx:568` then patches the local cache, the group disappears from the sidebar, and on the next reload it is back.
**Reproduce** As a non-creator member of a fully settled group, use Archive. It appears to work. Reload. The group is back.
**Blast radius** Every non-creator archive attempt, on every group. Also the general contract defect in §9.3: `deleteTransaction`, `deletePaymentSource`, `archivePaymentSource`, `unarchiveGroup` all report success on zero-row operations.
**Why it exists** supabase-js only populates `error` on a real failure, and no callsite in this codebase ever checks affected-row counts.
**Containment (minutes)** ~10: add `.select('id')` to each of these mutations and throw when the returned array is empty.
**Correct fix** Decide what "archive" means for a non-creator — per-user archive needs a `group_member_archived` flag on `group_members` (which members *can* write), not a group-level column only the creator can set. Then add the row-count check as a general rule for every mutation helper.
**Proof of fix** A non-creator archive returns an error and the UI says so.
**Depends on** Coordinate the policy question with the auth pass.

### [P1-04] Per-user rate limits reset on every cold start, so there is effectively no abuse ceiling
**Severity P1 · Confidence LIKELY · Abuse / cost**
**Location** `supabase/functions/_shared/auth.ts:44-59`; used at `send-email/index.ts:63`, `suggest-tag/index.ts:50`, `native-bridge/index.ts:126`.
**What is wrong** `const rateBuckets = new Map()` is module-scoped inside a Deno Deploy isolate. Isolates are created per-region and on demand and are discarded when idle. State is therefore per-instance, not per-user. The code says so itself: "best-effort; resets per cold start".
**Reproduce** Not safely testable against production. The mechanism is plain from the code.
**Blast radius** Amplifies [P0-02] from 500 phishing emails/minute to whatever MailerSend allows; removes the Gemini cost ceiling; removes the native-bridge sign-in-token ceiling.
**Why it exists** An in-memory `Map` is the zero-dependency way to add a limiter, and the author documented the caveat rather than solving it.
**Containment (minutes)** ~20: back the limiter with a Postgres table (`edge_rate_limits(user_id, bucket, window_start, count)`) written with the service role; a single upsert per request.
**Correct fix** As above, plus a global daily cap per function with alerting when it is approached.
**Proof of fix** Two requests routed to different isolates share a counter.
**Depends on** Best fixed together with [P0-02].

### [P1-05] An active invite makes your full `people` row readable by every user on the platform
**Severity P1 · Confidence CONFIRMED · Privacy**
**Location** `supabase/migrations/20260728000000_phase_a_rls_people_visibility.sql:65-71` (the fourth disjunct of `i_can_see_person`); over-fetch at `services/supabaseApiService.ts:803-806`.
**What is wrong** The clause is `EXISTS (SELECT 1 FROM group_invites WHERE invited_by = p_person_id AND is_active AND expires_at > now())` — with **no relationship between the reader and the invite**. Anyone who has created an invite is visible to every authenticated user for as long as that invite lives. The UI creates invites with `maxUses: null` and 30-day expiry (`components/GroupFormModal.tsx:163-169`, `supabaseApiService.ts:990-991`), and `cleanup_expired_invites` is never called. Compounding it, `getPeople` uses `select('*')`, so the exposed row includes `email`, `clerk_user_id`, `user_id`, `auth_user_id`, and the base64 avatar photo.
**Reproduce** User A creates an invite link. Unrelated user B runs `GET /rest/v1/people?select=*` and receives A's row.
**Blast radius** Name, email address, photograph and Clerk user id of every user who has ever shared an invite link, exposed to the whole user base for 30 days at a time.
**Why it exists** The invite landing page needs the inviter's name and avatar before the visitor joins. The clause was written to satisfy that read without noticing it applies to *every* reader, not just the invitee — and the pre-auth case is already served by `get_invite_preview`, which is `SECURITY DEFINER` and does not need this policy at all.
**Containment (minutes)** ~10: **delete the fourth disjunct.** `get_invite_preview` (`20260812000000:150-155`) already returns the inviter's name and avatar to `anon` without touching this policy, so nothing in the UI breaks.
**Correct fix** As above, plus narrow `getPeople` to `.select('id,name,avatar_url,email,is_claimed,source')` so Clerk identifiers never reach any browser.
**Proof of fix** With an active invite from A, B's `GET /people` does not return A's row.
**Depends on** Verify no other caller depends on the clause (grep shows none).

### [P1-06] `find_person_by_email` is an unrestricted identity oracle over the whole user base
**Severity P1 · Confidence CONFIRMED · Privacy / enumeration**
**Location** `supabase/migrations/20260728000000:103-117`; caller `services/supabaseApiService.ts:833-843`.
**What is wrong** `RETURNS SETOF people`, `SECURITY DEFINER`, `GRANT EXECUTE … TO authenticated`. Given any email address it returns the **entire row** — name, email, avatar, `clerk_user_id`, `is_claimed`, `source`. No rate limit (§6), no logging, no restriction to addresses the caller has any relationship with. It is also a sequential scan (`lower(trim(email))` against a plain-column index), so it is slow *and* free to abuse.
**Reproduce** Any signed-in user: `POST /rest/v1/rpc/find_person_by_email {"p_email":"someone@example.com"}`.
**Blast radius** Confirms whether any given email address has an account, and returns that person's real name, photo and Clerk id. A dictionary run against a leaked address list enumerates the entire user base. Feeds directly into [P0-01] (finding claimable placeholders) and [P0-02] (targeting).
**Why it exists** The "add a member by email" UX needs to know whether an address already has a person row, and returning the whole row was the least code.
**Containment (minutes)** ~10: change the return type to `TABLE(id uuid, name text, is_claimed boolean)` — the UI (`supabaseApiService.ts:840-842` → `transformDbPersonToAppPerson`) only needs enough to render a suggestion. Drop `email`, `clerk_user_id`, `user_id`, `auth_user_id`, `avatar_url`.
**Correct fix** As above, plus a per-user call budget recorded in a table, plus a functional index `CREATE INDEX ON people (lower(trim(email)))` so it stops being a table scan.
**Proof of fix** The RPC response contains no `clerk_user_id` and no `email`.
**Depends on** Nothing.

### [P1-07] The global AI tag cache stores every user's novel expense descriptions and lets every user read them, forever
**Severity P1 · Confidence CONFIRMED · Privacy / cross-tenant leak**
**Location** `services/tagClassifier.ts:388-389` (key = raw description), `:409-419` (`writeCache`), `:453-457` (write path); table + policies `supabase-schema.sql:77-99`; triggered on every save at `components/TransactionFormModal.tsx:291-301`.
**What is wrong** Every expense description that misses the keyword list and the cache is sent to Gemini and then **written verbatim into a global, unowned, permanently readable table**. `cache_read` is `USING (auth.role() = 'authenticated')` — every signed-in user can `SELECT *`. There is no DELETE or UPDATE policy, so rows are immortal, and `anonymize_my_account` does not touch them.
**Reproduce** Any signed-in user: `GET /rest/v1/ai_item_cache?select=*&order=created_at.desc`. The result is a chronological feed of other users' unusual expense descriptions.
**Blast radius** Cross-tenant leak of the most sensitive free text in the product — precisely the *unusual* descriptions, since common ones are caught by keywords and never reach the cache. Medical, legal, and personal-situation inferences. Survives account deletion. Not disclosed in `public/privacy.html`.
**Why it exists** A shared cache is the natural way to avoid paying Gemini twice for "starbucks", and the privacy consequence of using the raw user-typed string as a globally-readable primary key was not considered.
**Containment (minutes)** ~10: drop the `cache_read` policy and replace it with nothing, then route lookups through a `SECURITY DEFINER` RPC `lookup_item_category(p_key text)` that returns only the category for an exact key. Clients can still hit the cache; nobody can enumerate it.
**Correct fix** As above, and stop storing raw text: key the cache on `encode(digest(normalized_name,'sha256'),'hex')` so the table holds no readable descriptions at all. Add a retention policy. Update the privacy policy.
**Proof of fix** `SELECT * FROM ai_item_cache` as an authenticated user returns 0 rows; tag suggestions still work.
**Depends on** Nothing.

### [P1-08] "Delete Account" does not do what its dialog says, and a Clerk failure creates a duplicate identity
**Severity P1 · Confidence CONFIRMED · Privacy / compliance / atomicity**
**Location** `components/SettingsModal.tsx:160-181` (order + swallowed catch), `:321` (the false dialog text); RPC `supabase/migrations/20260813000000_anonymize_my_account.sql:28-39`; re-login path `20260813020000_ensure_my_person.sql:146-165`.
**What is wrong** Three defects in one flow: (a) the confirmation says it "will permanently delete your profile **and remove you from all groups**" — `anonymize_my_account` never touches `group_members`, so the user stays in every group as "Deleted user"; (b) `payment_sources` (card issuer + last 4, UPI VPA), `email_invites.email`, `group_invites.invited_by` and `ai_item_cache` all survive untouched; (c) the DB is anonymized **first** and `clerkUser.delete()` second inside a swallowed catch (`:167-173`), with the success toast shown regardless (`:174`) — so if Clerk deletion is not enabled in the dashboard (`docs/play-store-launch.md:11` lists it as a manual prerequisite), the user can sign in again, `ensure_my_person` finds no matching row (email was nulled), and **creates a second identity**, orphaning the entire original ledger.
**Reproduce** With Clerk account-deletion disabled, use Settings → Delete Account, then sign in again. You are a new person with no history; the old row is an unreachable ghost member of every group.
**Blast radius** GDPR Art. 17 / DPDP erasure obligations are not met for financial-instrument data; the user is told otherwise; the failure mode is exactly the duplicate-identity class already documented as a production incident in `DUPLICATE_USER_FIX_SUMMARY.md`.
**Why it exists** The RPC was scoped to "strip identity from the people row" (its own header comment) and the surrounding flow was never re-checked against what the dialog promises.
**Containment (minutes)** ~15: reverse the order (Clerk first, abort on failure), stop swallowing the Clerk error, and correct the dialog text to state what actually happens.
**Correct fix** Extend `anonymize_my_account` to delete `payment_sources` for that person, null/redact `email_invites.email` where `invited_by` is that person, and either remove the person from groups with zero activity or clearly document that they remain as "Deleted user". Update `public/privacy.html` and the Play Data Safety answers to match.
**Proof of fix** After deletion, `SELECT * FROM payment_sources WHERE user_id = '<person>'` returns 0 rows and re-login does not create a second `people` row.
**Depends on** Coordinate with [P2-12] (policy text).

### [P1-16] Fourteen catch blocks on money and auth paths log to a console the user cannot see and do nothing else
**Severity P1 · Confidence CONFIRMED · Error handling**
**Location** `App.tsx:340-342, 291-293, 498-500, 512-514`; `contexts/SupabaseAuthContext.tsx:75-79`; `services/emailService.ts:91,96,106`; `services/supabaseApiService.ts:867,878,1053,1056`; `App.tsx:386-391`.
**What is wrong** Each swallows a failure with `console.*` and no user-visible signal and no Sentry capture. The worst is `SupabaseAuthContext.tsx:75-79`: any error during profile sync calls `setPerson(null)`, and because all four queries are `enabled: !!personId` (`services/queries.ts:260,268,276,284`), the user gets a fully-rendered, completely empty application — no groups, no expenses, no error, no retry button. A transient failure is indistinguishable from total data loss.
**Reproduce** Force `ensure_my_person` to fail (expired JWT, RLS change). Sign in. The app loads and shows nothing.
**Blast radius** Silent data-loss perception on the auth path; silently un-sent invite emails; silently failed deletes and archives.
**Why it exists** `console.error` in a catch is the default reflex, and nothing in CI or review flags it.
**Containment (minutes)** ~30 for all of them: `Sentry.captureException(e)` plus a specific `toast.error(...)` in each. For `SupabaseAuthContext`, add an explicit error state with a Retry button instead of `setPerson(null)`.
**Correct fix** As above, plus a lint rule (`no-console` with an allowlist) once ESLint exists.
**Proof of fix** Each path produces a Sentry event and a visible message.
**Depends on** Ships naturally with [P0-13].

### [P1-25] The Android workflow publishes to Google Play with zero automated verification
**Severity P1 · Confidence CONFIRMED · Release**
**Location** `.github/workflows/android-ci.yml` in full — no test step exists between `npm ci` (`:26`) and the Play upload (`:94-106`).
**What is wrong** Every push to `main` builds, signs and uploads an AAB to the internal testing track with `status: completed`. No `vitest`, no `tsc --noEmit`, no lint, no Playwright, no smoke test.
**Reproduce** Push any commit to `main`.
**Blast radius** A syntax-clean but broken build reaches testers within minutes with nothing standing in the way. The unit suite exists and is fast (Supabase is mocked, so it is safe to run in CI); it is simply never invoked anywhere.
**Why it exists** The workflow was written to solve "get an AAB to Play", and the test suite was written separately.
**Containment (minutes)** ~5: insert `- run: npm run test:run` after `:26`, and `- run: npx tsc --noEmit` after it.
**Correct fix** As above, plus gate the Play upload on a tag or a manual `workflow_dispatch` rather than every push, so a deploy is a decision rather than a side effect of saving work.
**Proof of fix** A deliberately failing test blocks the Play upload.
**Depends on** Nothing.

### [P1-27] "User X says their balance is wrong" cannot be answered in production
**Severity P1 · Confidence CONFIRMED · Observability**
**Location** Absence. `transactions` has no `created_by` (`supabase-schema.sql:52-68`); no audit table anywhere; `index.tsx:19-31` sets no `release`; `vite.config.ts:256` `sourcemap: false`; balances are client-only (`utils/calculations.ts`).
**What is wrong** See §13 in full. There is no record of who entered or changed a transaction, no history of previous values, no trace of deletions, no request correlation, no client version on error reports, no readable stack traces, and no server-side balance to compare against.
**Reproduce** Pick any user report of a wrong balance. Attempt to determine what changed and who changed it.
**Blast radius** Every correctness dispute — the core failure mode of an expense-splitting product — is unresolvable. Support becomes "please check the list yourself". Combined with [P0-15], destructive actions are also untraceable.
**Why it exists** The browser-direct architecture has no natural place to put server-side logging, and nobody added one.
**Containment (minutes)** ~45: (1) `ALTER TABLE transactions ADD COLUMN created_by text DEFAULT requesting_user_id()`; (2) an append-only `transactions_audit` table with an `AFTER INSERT OR UPDATE OR DELETE` trigger capturing `to_jsonb(OLD)`/`to_jsonb(NEW)` plus `requesting_user_id()`; (3) `Sentry.init({ release: __APP_VERSION__ })` fed from `vite.config.ts define`.
**Correct fix** As above, plus `sourcemap: 'hidden'` with a Sentry source-map upload step in CI so stack traces are readable without shipping maps to users.
**Proof of fix** For any transaction, `SELECT * FROM transactions_audit WHERE row_id = …` returns its full change history with actor and timestamp.
**Depends on** Nothing.

### [P1-28] One `git push` deploys web and mobile simultaneously with no staging, no gate, and no rollback plan
**Severity P1 · Confidence CONFIRMED · Release**
**Location** `deploy-main.ps1:22-33`; `.github/workflows/android-ci.yml:3-6,94-106`; `vercel.json`.
**What is wrong** `git add -A; git commit -m "chore: deploy latest changes"; git push origin main` triggers a Vercel production deploy and a Google Play upload at the same instant. No staging environment exists, no preview gate, no test gate, no approval, no per-change commit message.
**Blast radius** Web and mobile ship together with no ability to canary either. The Android artifact cannot be rolled back at all ([P0-30] table), and the two artifacts are not even built from the same dependency tree ([P2-31]).
**Containment (minutes)** ~20: gate the Play upload on `workflow_dispatch` or a `v*` tag; add the test steps from [P1-25]; make `deploy-main.ps1` require a real commit message.
**Correct fix** A staging Supabase project + a Vercel preview environment pointing at it, and a promote step.
**Depends on** [P1-25].

### [P1-32] The service worker never updates: `registerType: 'prompt'` with no prompt anywhere
**Severity P1 · Confidence CONFIRMED · Release / correctness**
**Location** `vite.config.ts:199,234-235`; absence of any `virtual:pwa-register` / `registerSW` / `useRegisterSW` / `needRefresh` import in the entire tree; `workbox-window` declared at `package.json:48` and never imported.
**What is wrong** `skipWaiting: false` + `clientsClaim: false` + `registerType: 'prompt'` requires the app to render an update prompt and call `updateSW()`. Nothing does. A new service worker installs and sits in `waiting` until **every** tab of the app closes at once — for an installed PWA, potentially never.
**Reproduce** Load the app, deploy a change, reload. The old bundle persists.
**Blast radius** Users run arbitrarily old client code against a live-migrating database. Every RLS or schema change becomes a partial outage for the subset of users on a stale bundle — and per [P0-13]/[P1-16] those failures are invisible to them. Also makes [P1-27] worse: with no `release` in Sentry you cannot even tell which bundle a report came from.
**Containment (minutes)** ~15: import `useRegisterSW` from `virtual:pwa-register/react` and render a small "New version available — Reload" toast wired to `updateServiceWorker(true)`.
**Correct fix** As above. If a prompt is not wanted, switch to `registerType: 'autoUpdate'` with `skipWaiting: true` and accept the reload.
**Proof of fix** After a deploy, an open tab shows the update prompt within one navigation.
**Depends on** Best done with [P1-27] (`release`).

### [P1-34] `assetlinks.json` does not exist, so HTTPS invite links never open the Android app
**Severity P1 · Confidence CONFIRMED · Mobile / growth**
**Location** `android/app/src/main/AndroidManifest.xml:49-57` (`autoVerify="true"` on `/invite` and `/sso-callback` for both hosts); `vercel.json:333-336` (a rewrite reserving the path); **no `assetlinks.json` and no `.well-known` directory anywhere in the repo**; URL construction at `services/supabaseApiService.ts:1011`.
**What is wrong** Android App Link verification fetches `https://<host>/.well-known/assetlinks.json` and requires it to name the package and the release signing certificate's SHA-256 fingerprint. The file does not exist and nothing generates it, so Vercel 404s the path, verification fails, and every `https://www.motamaati.in/invite/<token>` link opens in the browser instead of the installed app.
**Reproduce** Install the app, tap an invite link from an email or WhatsApp. It opens in Chrome.
**Blast radius** The invite flow is the product's only growth mechanism and its only onboarding path. On Android it lands installed users in a browser, where they must sign in again. `docs/play-store-launch.md:26` claims `kharchbaant://invite/<token>` is the deep link, but nothing generates that scheme for invites.
**Why it exists** The manifest and the Vercel rewrite were both written in anticipation of the file, which was then never created — plausibly because the SHA-256 fingerprint only exists after the keystore is generated, which `docs/play-store-launch.md:65-78` treats as a later manual step.
**Containment (minutes)** ~15: run `keytool -list -v -keystore <release keystore>` (or copy the fingerprint from Play Console → Setup → App signing — **use the Play App Signing key, not the upload key**), write `public/.well-known/assetlinks.json`, redeploy.
**Correct fix** As above, and add a Playwright assertion that `GET /.well-known/assetlinks.json` returns 200 with the right package name, so it cannot silently rot.
**Proof of fix** `adb shell pm verify-app-links --re-verify com.kharchbaant.app` reports verified, and an invite link opens the app.
**Depends on** Access to the release signing fingerprint.

### [P2-08] Any user can permanently poison the global AI classification cache
**Severity P2 · Confidence CONFIRMED · Data integrity**
**Location** `supabase-schema.sql:92-99` (`cache_insert` with `WITH CHECK (auth.role() = 'authenticated')`, no UPDATE/DELETE policy); write path `services/tagClassifier.ts:409-419`.
**What is wrong** Any authenticated user can insert `(normalized_name, category)` for any key. The primary key makes the first writer permanent, and with no UPDATE or DELETE policy nobody — including the operator, through the API — can correct it. `INSERT ('uber','Health')` misclassifies Uber for every future user of the product.
**Blast radius** Silent, permanent degradation of a user-facing feature across the whole product; wrong categories on every user's spending breakdown. Repairable only by direct SQL as `postgres`.
**Containment (minutes)** ~10: revoke `cache_insert` and move writes behind a `SECURITY DEFINER` RPC that only accepts a category the server itself just obtained from Gemini.
**Correct fix** As above, plus a `source`/`confidence` column and periodic revalidation.
**Depends on** Ships naturally with [P1-07].

### [P2-09] `people.avatar_url` is unbounded server-side and rides on every list fetch and every realtime event
**Severity P2 · Confidence CONFIRMED · Performance / abuse**
**Location** Client cap only at `components/SettingsModal.tsx:74`; write at `services/supabaseApiService.ts:1232-1236`; no SQL length constraint; amplifiers at `:803-806` (`select('*')`), `:450-464` + `migrations/enable_realtime.sql:8` (`REPLICA IDENTITY FULL`).
**What is wrong** The 100 KB limit is enforced only in the browser. A modified client can `PATCH` a multi-megabyte data URL. That value is then returned in full by every `getPeople` and pushed in full over the WebSocket to every client that can see the person, on every `people` UPDATE.
**Blast radius** One account can make every co-member's app slow to load and expensive on mobile data.
**Containment (minutes)** ~5: `ALTER TABLE people ADD CONSTRAINT avatar_url_len CHECK (length(avatar_url) <= 200000);`
**Correct fix** Move avatars to Supabase Storage and keep a URL in the column; downscale to ≤256 px and re-encode to WebP client-side before upload.
**Depends on** Nothing.

### [P2-10] No Content-Security-Policy
**Severity P2 · Confidence CONFIRMED · Transport / defence in depth**
**Location** `vercel.json:350-379` — six headers, no `Content-Security-Policy`.
**What is wrong** No CSP of any kind, not even report-only. React escaping and the absence of `dangerouslySetInnerHTML` make reflected XSS unlikely, so the value of a CSP here is containment: limiting exfiltration if any of 834 npm packages or the Clerk/Sentry scripts is compromised, and providing `frame-ancestors`.
**Containment (minutes)** ~30: ship `Content-Security-Policy-Report-Only` first with `default-src 'self'`, `script-src 'self' https://*.clerk.accounts.dev https://clerk.motamaati.in`, `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.us.sentry.io https://clerk.motamaati.in`, `img-src 'self' data:` (required — avatars are data URLs), `style-src 'self' 'unsafe-inline'`, `frame-ancestors 'none'`. Read the reports, then enforce.
**Correct fix** Enforced CSP, with `'unsafe-inline'` on styles removed once Tailwind's inline critical CSS is nonce'd.
**Depends on** Verify Clerk's exact runtime origins first.

### [P2-11] Sentry replay privacy options are inherited, not stated
**Severity P2 · Confidence LIKELY · Privacy**
**Location** `index.tsx:23` `Sentry.replayIntegration()` — no options; `:26-28` 10 % / 100 % / `sendDefaultPii: true`; `App.tsx:58-64` `setUser({email})`; `package.json:37` `"@sentry/react": "^10.48.0"` (caret).
**What is wrong** Masking relies entirely on the SDK's defaults (`maskAllText: true`, `blockAllMedia: true` in v10). Those defaults are correct today, but they are inherited across a caret range and are invisible to anyone reading this file — the next person to touch it has no signal that unmasking would ship a financial ledger to a third party.
**Containment (minutes)** ~2: `Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true })`.
**Correct fix** As above, plus a `beforeSend` that strips `user.email` if the legal position requires it, and a decision on Sentry's data region.
**Depends on** Nothing.

### [P2-12] Privacy policy and Play Data Safety answers do not match the system's behaviour
**Severity P2 · Confidence CONFIRMED · Compliance**
**Location** `public/privacy.html:26,42,43,46,50,52`; `docs/play-store-launch.md:49-55`. Reality per §8.3, §8.6, §16.
**What is wrong** Session replay is described as conditional when it is unconditional; retention is described as ending at account deletion when payment-instrument data, invited third-party emails and cached expense descriptions all survive; "Data Management" is cited as the access/export mechanism when Import is a no-op stub; the "Legal basis" heading states no legal basis; there is no named controller and no DPO contact; `ai_item_cache` and the cross-border transfer to US-hosted Sentry are not mentioned at all.
**Containment (minutes)** ~45 to correct the document to match reality.
**Correct fix** Fix the *system* first ([P1-07], [P1-08]) so the honest version of the policy is also the short version, then rewrite the policy and the Data Safety answers together.
**Depends on** [P1-07], [P1-08].

### [P2-17] Mutations report success on zero-row operations
**Severity P2 · Confidence CONFIRMED · API contract**
**Location** `services/supabaseApiService.ts:2-6, 22-31, 686-696, 736-745, 747-756`; also the unchecked deletes at `:12,14,264,265`.
**What is wrong** Every one of these returns `{success:true}` whenever `error` is null, which includes the case where RLS matched zero rows. No callsite can distinguish "done" from "refused".
**Containment (minutes)** ~15: add `.select('id')` and throw on an empty array.
**Correct fix** As above, applied uniformly, plus a rule that no mutation helper may discard its result.
**Depends on** Overlaps [P1-03] and [P0-15].

### [P2-19] Fire-and-forget promises with no rejection handler on the write-propagation path
**Severity P2 · Confidence CONFIRMED · Error handling**
**Location** `services/supabaseApiService.ts:481-487` (`_txPublishChannel.subscribe()` and `.send()` both un-awaited and un-caught); `services/tagClassifier.ts:410-418` (`.then` with no `.catch`).
**What is wrong** `send()` returns a promise that rejects when the channel is not subscribed or the socket is down. Nothing handles it, so it surfaces as an unhandled rejection — and because the write already committed, the only symptom a user sees is that other devices do not update.
**Containment (minutes)** ~10: `void _txPublishChannel.send(...).catch(e => Sentry.captureException(e))`, and add a `.catch` to `writeCache`.
**Depends on** Coordinate with the sync pass.

### [P2-20] `createGroupInvite` is not atomic: partial email inserts and partial sends, then a retry that duplicates both
**Severity P2 · Confidence CONFIRMED · Atomicity**
**Location** `services/supabaseApiService.ts:973-1071`, `Promise.all` at `:1029-1063`.
**What is wrong** The invite row commits first; each email address is a separate insert plus a fire-and-forget send inside a `Promise.all` that rejects on the first failure while the rest complete. The caller shows a generic error, and retrying mints a **new** token and re-sends to everyone who already received one.
**Containment (minutes)** ~20: replace `Promise.all` with `Promise.allSettled`, report per-address outcomes, and only send email for the inserts that succeeded.
**Correct fix** A single RPC that inserts the invite and all `email_invites` in one transaction and returns the ids; send emails afterwards, keyed on those ids so a retry is idempotent.
**Depends on** Overlaps [P0-02].

### [P2-21] `ensureUserExists` still has a narrow duplicate-identity race
**Severity P2 · Confidence LIKELY · Atomicity / identity**
**Location** `services/supabaseApiService.ts:846-912`, `23505` handler at `:899-907`; `supabase/migrations/20260813020000_ensure_my_person.sql:116-165`.
**What is wrong** The unique constraint on `clerk_user_id` plus the `23505` retry closes the main race documented in `DUPLICATE_USER_FIX_SUMMARY.md`. Two holes remain: a `23505` raised by the **email** partial-unique index is not recoverable by the re-select on `clerk_user_id`, and the RPC's email-claim branch (`:130-144`) takes no row lock, unlike `accept_group_invite` which does (`20260812000000:202`).
**Containment (minutes)** ~10: add `FOR UPDATE` to the email-claim select in `ensure_my_person`, and make the `23505` handler retry on email as well as `clerk_user_id`.
**Depends on** Same file as [P0-01]; fix together.

### [P2-22] `batchApplyEmojisToGroupTransactions` is N serial round-trips with no error handling
**Severity P2 · Confidence CONFIRMED · Atomicity / performance**
**Location** `services/supabaseApiService.ts:668-684`; caller `App.tsx:386-391` (catches and `console.warn`s).
**What is wrong** A `for` loop of individual `UPDATE`s with no transaction and no per-row error handling. On a 200-expense group that is 200 serial requests; a failure halfway leaves the descriptions half-mutated, and the user sees nothing.
**Containment (minutes)** ~15: move it into a single `UPDATE … FROM (VALUES …)` or a `SECURITY DEFINER` RPC that does it in one statement.
**Depends on** Nothing.

### [P2-23] `html2canvas` ships and executes on every app boot for a Share-only feature
**Severity P2 · Confidence CONFIRMED · Performance**
**Location** static import at `components/GroupView.tsx:8` (and `components/GroupSummaryModal.tsx:4`); `GroupView` is a static import at `App.tsx:8`; chunking at `vite.config.ts:121-122`.
**Containment (minutes)** ~10: delete both static imports and use `const { default: html2canvas } = await import('html2canvas')` inside the two handlers (`GroupView.tsx:134`, `GroupSummaryModal.tsx:90`).
**Depends on** Nothing.

### [P2-24] 112 `console.*` calls ship to production
**Severity P2 · Confidence CONFIRMED · Performance / hygiene / minor PII**
**Location** `vite.config.ts:253-282` — `minify: 'esbuild'` with no `esbuild: { drop: [...] }`.
**What is wrong** esbuild's minifier does not remove `console` calls unless told to. All 112 calls and their emoji template strings are in the bundle and execute on every device, including ones that log group ids, transaction counts and PostgREST error bodies (§8.5).
**Containment (minutes)** ~2: add `esbuild: { drop: ['console', 'debugger'] }` to the vite config — but **first** replace the handful of calls that should become Sentry events ([P1-16]), or you will delete the only trace those paths leave.
**Depends on** [P1-16].

### [P2-26] The Playwright workflow runs the app with no environment, so its central test cannot pass
**Severity P2 · Confidence LIKELY · Testing / CI**
**Location** `.github/workflows/playwright.yml:127` (no `env:`, no secrets); `playwright.config.ts:8,96-101`; `tests/app.spec.ts:21-26`; `index.tsx:67-77`.
**What is wrong** With no `VITE_CLERK_PUBLISHABLE_KEY`, `npm run dev` serves the "Configuration Error" screen, so the `/sign in/i` heading assertion must time out. With no `TEST_USER_*`, the two authenticated projects are not created at all, so the authenticated specs are silently absent from the run rather than reported as skipped.
**Containment (minutes)** ~15: supply the three `VITE_*` secrets to the `webServer` env, and make the authenticated projects report explicit skips.
**Depends on** [P1-25].

### [P2-29] Four version numbers, and the local Android build collides with CI
**Severity P2 · Confidence CONFIRMED · Release**
**Location** `android/app/build.gradle:24-25` (7 / "1.0.6"); `.github/workflows/android-ci.yml:77-78` (`run_number`); `components/AboutSection.tsx:8` ("1.0.0"); `package.json:4` ("1.0.0"); `docs/play-store-launch.md:20,95` (says 1.0.0 / versionCode 1).
**Containment (minutes)** ~10: derive `versionName` from a single source and surface the real build id in `AboutSection`; make the local release script fail unless `-PversionCode` is supplied.
**Depends on** Ties into [P1-27] (`Sentry.release`).

### [P2-31] Vercel uses `npm install`, so the web and Android artifacts are built from different dependency trees
**Severity P2 · Confidence CONFIRMED · Build reproducibility**
**Location** `vercel.json:323` vs `.github/workflows/android-ci.yml:26`; caret ranges throughout `package.json:26-72`; no `engines` field.
**Containment (minutes)** ~1: `"installCommand": "npm ci"`. Add `"engines": {"node": "20.x"}`.
**Depends on** Nothing.

### [P2-33] `public/manifest.webmanifest` is a 0-byte file that may shadow the generated PWA manifest
**Severity P2 · Confidence LIKELY · Build / PWA**
**Location** `public/manifest.webmanifest` (0 bytes); `vite.config.ts:201-229` (plugin-generated manifest); assertions at `tests/app.spec.ts:37-59`.
**Containment (minutes)** ~1: delete the empty file.
**Depends on** Nothing.

### [P2-35] `android:allowBackup="true"` with no exclusions may back up WebView session material
**Severity P2 · Confidence LIKELY · Mobile privacy**
**Location** `android/app/src/main/AndroidManifest.xml:6` — no `fullBackupContent`, no `dataExtractionRules`.
**What is wrong** Android Auto Backup copies the app data directory to the user's Google Drive. For a Capacitor app that includes the WebView's storage for `https://www.motamaati.in` — the same origin Clerk uses for session state.
**Containment (minutes)** ~10: `android:allowBackup="false"`, or add a `dataExtractionRules` XML excluding the WebView storage paths.
**Depends on** Verify on-device where Clerk stores its session.

### [P2-36] Two Settings features are UI stubs that report success
**Severity P2 · Confidence CONFIRMED · Correctness / trust**
**Location** `components/SettingsModal.tsx:305-308` (Reset All App Data), `:156` (Import Data); rendered by `components/DangerZone.tsx:11-17` and `components/DataExport.tsx:49-57`; cited as a data right at `public/privacy.html:50`.
**What is wrong** "Reset All App Data" shows an irreversible-destruction warning and then only fires a success toast. "Import Data" accepts a file and only fires a success toast. Both tell the user the operation succeeded.
**Containment (minutes)** ~10: **remove both buttons.** They deliver nothing and actively mislead.
**Correct fix** If reset is wanted: `localStorage.clear(); queryClient.clear();` and reload. If import is wanted, build it — but note it would need write-side validation that does not currently exist anywhere.
**Depends on** Coordinate with [P2-12] (the policy cites Data Management).

### [P2-37] `AGENTS.md` instructs every AI agent to push project knowledge to an external service
**Severity P2 · Confidence CONFIRMED · Process / information governance**
**Location** `AGENTS.md` (Byterover MCP section); corroborated by `.agent/rules/byterover-rules.md` and ten assistant-specific rule paths in `.gitignore`.
**What is wrong** Standing instructions tell any assistant working in this repo to store and retrieve project knowledge in a third-party knowledge base. The repo's markdown contains the schema, RLS policy names, production hostnames, and operational incident logs.
**Containment (minutes)** ~5: remove the instruction, or scope it explicitly to exclude schema, policy and infrastructure detail.
**Depends on** Nothing.

### [P3-14] Diagnostic pages shipped to production
**Severity P3 · Confidence CONFIRMED · Hygiene**
**Location** `public/check-env.html`, `public/generate-icons.html`; `vercel-diagnostic.js`, `inspect-db.mjs` (0 bytes), `test-env.mjs` (broken import), `test-gemini.mjs` (broken import) in the repo root.
**Containment (minutes)** ~2: delete them.

### [P3-18] Raw PostgREST error text shown to users in toasts
**Severity P3 · Confidence CONFIRMED · UX / minor information disclosure**
**Location** `App.tsx:239, 266, 471, 557, 571`; rethrow at `services/supabaseApiService.ts:346`.
**Containment (minutes)** ~15: map known error codes to human sentences; send the raw text to Sentry instead.

### [P3-38] Clerk session id and user id logged to the Android device console
**Severity P3 · Confidence CONFIRMED · Privacy**
**Location** `utils/nativeDeepLinks.ts:79-88` (`logClerkAuthState` logs `sessionId`, `userId`), called at `:135,146`.
**Containment (minutes)** ~2: drop the two id fields; keep the booleans.

### [P3-39] MailerSend error bodies logged in the Edge function
**Severity P3 · Confidence CONFIRMED · Privacy (logs)**
**Location** `supabase/functions/send-email/index.ts:247`.
**Containment (minutes)** ~2: log `response.status` and a fixed message.

### [P3-40] `google-services.json` is not in `.gitignore`
**Severity P3 · Confidence CONFIRMED · Secrets hygiene (latent)**
**Location** `.gitignore` (Android section) vs `android/app/build.gradle:88`. Nothing is committed today.
**Containment (minutes)** ~1.

### [P3-41] Service-worker runtime cache rule targets a host that cannot exist
**Severity P3 · Confidence CONFIRMED · Build**
**Location** `vite.config.ts:238` `^https:\/\/api\.supabase\.co\/.*` — real project URLs are `<ref>.supabase.co`.
**Containment (minutes)** ~2: fix the pattern or delete the rule. Do **not** cache authenticated API responses in a shared SW cache without thinking it through.

### [P3-42] `_shared/auth.ts` CORS falls back to `allowed[0]` for a disallowed origin
**Severity P3 · Confidence CONFIRMED · Transport**
**Location** `supabase/functions/_shared/auth.ts:20-23`.
**What is wrong** When `ALLOWED_ORIGINS` is set and the request Origin is not in it, the function echoes `allowed[0]` rather than refusing. It fails closed only because the browser rejects the mismatch.
**Containment (minutes)** ~2: return no `Access-Control-Allow-Origin` header when the origin is not allowed.

---

## 18. Coverage gaps

Things this pass could not determine, and what would resolve each.

1. **Live RLS state.** Everything in §1.3 and §10 assumes the union of `20260412000005` → `…08` → `20260728000000` → `20260812000000` is what is actually deployed. `migrations/HOTFIX_reset_all_policies.sql` creates eight `USING (true)` policies that **no file in the repo drops**. If it was ever run, most of this pass's authorization reasoning is optimistic. **Needed:** `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2;` and `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';` from production.
2. **`group_deletion_requests` policies.** RLS enabled by `20260728000000:19`, zero policies in the repo. Feature is either dead or wide open. Same query as (1).
3. **The `WITH CHECK` fallback claims.** §1.3's `groups.created_by` handoff and `transactions.group_id` move are reasoned from PostgreSQL's documented behaviour. **Needed:** two probe `UPDATE`s against a scratch project.
4. **Column privileges.** `GRANT ALL … TO authenticated` appears in two files. Whether any column-level `REVOKE` was later applied is unknown. **Needed:** `SELECT * FROM information_schema.column_privileges WHERE grantee='authenticated';`
5. **Edge function secrets.** Whether `ALLOWED_ORIGINS`, `MAILERSEND_*`, `GEMINI_API_KEY`, `CLERK_SECRET_KEY` are set, and whether `verify_jwt` is on for `send-email`/`suggest-tag` at the platform level.
6. **Clerk dashboard.** Session lifetime, JWT TTL (the code assumes 60 s), cookie flags, whether "users can delete their accounts" is enabled ([P1-08] depends on it), attack-protection rate limits, allowed origins.
7. **Vercel project settings.** Which env vars in which environment; whether preview deployments point at the production Supabase project (determines whether [P1-34]'s preview-origin invite problem is real).
8. **Supabase plan and backups.** Whether PITR is enabled ([P0-30]). Whether PostgREST request logs are retained and for how long ([P1-27]).
9. **Git history.** No `.git`. Cannot check whether a secret was ever committed, cannot attribute changes, cannot see how often deploys happen.
10. **Build, typecheck, tests, lint were not run.** No `node_modules`, installs forbidden. `tsc --noEmit`, `vitest run`, `vite build` results are all unverified — including whether `public/manifest.webmanifest` actually shadows the generated one ([P2-33]) and whether the app compiles at all under the current dependency ranges.
11. **On-device Android behaviour.** App Links verification state, whether Auto Backup captures Clerk session material ([P2-35]), whether `logcat` actually receives the session id in a release build.
12. **Sentry SDK v10 replay defaults.** Not fetched from vendor docs; [P2-11] is LIKELY on that basis.
13. **Deno Deploy isolate lifecycle.** [P1-04] is LIKELY on that basis.
14. **MailerSend account state.** Sending domain, verified sender, quota, whether any abuse has already occurred ([P0-02]).
15. **Whether production runs this code at all.** No build fingerprint anywhere (§14).

---

## 19. Suspicions / Unverified

Stated as suspicions because I could not prove them from the repo.

1. **`HOTFIX_reset_all_policies.sql` may be live.** It exists, it is the last-resort fix for a class of error the root markdown files describe repeatedly (`GROUP_CREATION_ERROR_FIX.md`, `QUICK_FIX.md`), and nothing drops its `*_all` policies. The audit script `scripts/rls-beta-audit.sql:19-27` only looks for names matching `%allow all%`, so it would not detect them. If it is live, every RLS conclusion about `groups` and `group_members` in this report is wrong in the permissive direction. **SUSPECTED — resolve with gap (1).**
2. **The "member display bug" may be the `updateGroup` delete-window** ([P0-14]) rather than the read-side cause `MEMBER_DISPLAY_BUG_FIX.md` diagnoses. Both produce the same symptom; only one is fixed.
3. **Preview deployments probably share the production Supabase project.** Nothing in the repo separates them, and there is only one set of `VITE_SUPABASE_*` secrets in CI. If true, invite links created from a preview are written into the production `group_invites` table pointing at a domain that will be torn down.
4. **`ai_item_cache` probably already contains sensitive descriptions.** The feature has shipped for at least six versions and fires on every expense save that misses the keyword list. **SUSPECTED, and cheap to confirm** — but note that confirming it means reading other users' data, so it should be done by the operator, not an auditor.
5. **Clerk account deletion is probably not enabled**, since `docs/play-store-launch.md:11` lists it as an outstanding manual blocker. If so, [P1-08]'s duplicate-identity path is not a hypothetical.
6. **The Playwright workflow is probably red and ignored** ([P2-26]). Nothing in the repo could make `tests/app.spec.ts:25` pass without Clerk env.
7. **Native deep-link parameter injection** (§2.6) — I assessed it as a nuisance rather than session injection based on how Clerk's redirect callback must work, but I did not read Clerk's implementation. If `handleRedirectCallback` trusts any URL parameter without a server round-trip, a malicious app on the same device could influence the auth flow. **SUSPECTED.**
8. **`i_can_see_person` may be a real performance problem already.** Four `EXISTS` subqueries per row, one of which calls another `EXISTS`-heavy function, with no `EXPLAIN` available. At a few hundred people it is fine; the shape degrades faster than linearly and there is no monitoring that would show it (§13).
9. **`REPLICA IDENTITY FULL` on `people` may already be pushing avatar blobs at scale.** Every name change broadcasts the full row including the base64 photo. Unmeasurable from here.
10. **`transactions.type` may have no CHECK in production.** The constraint lives only in `scripts/migrations/20251004_add_type_to_transactions.sql:11`, a directory outside both migration folders, in a repo where migration application order is untracked. If it was never applied, `type` is free text and `types.ts`'s three-value union is a client-side fiction.
