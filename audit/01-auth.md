# Pass 1.1 — Authentication & Authorization

Audit date: 2026-09-07. Repo: `Kharch-Baant-main` (no `.git`, no `node_modules`, nothing executed against the live project).
Scope: how a caller proves who they are, and what the server does with that claim. Everything below cites a file and line range.

**One-sentence verdict.** There is no application server; the browser holds the anon key and a Clerk session JWT and talks straight to PostgREST/RPC/Realtime, so **Postgres RLS is the entire security boundary** — and that boundary has three holes that are exploitable today (identity-claim RPCs trust a client-supplied email, `find_person_by_email` is a global address-book oracle, and the `broadcast` channel is unauthenticated), plus a fourth (`HOTFIX_reset_all_policies.sql`) whose status cannot be determined from the repo and which, if live, removes the boundary entirely for `groups` and `group_members`.

Confidence legend: **CONFIRMED** = read the full code path end to end in this repo. **LIKELY** = strong evidence, one gap (usually "is this SQL file actually applied to production"). **SUSPECTED** = pattern-matched, needs a live check.

---

## 1. Authentication

### 1.1 Mechanism and token

| Property | Value | Evidence |
|---|---|---|
| Provider | Clerk (`@clerk/clerk-react` 5.x). Supabase Auth is off: `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false` | `lib/supabase.ts:45-50` |
| Token type | Clerk **session JWT** (not the old `template:'supabase'` HS256 token — that was abandoned when the project moved to JWKS) | `lib/supabase.ts:22-32` |
| How it reaches Postgres | Custom `global.fetch` fetches a fresh token per request and sets `Authorization: Bearer <jwt>` + `apikey: <anon>` | `lib/supabase.ts:55-65` |
| Second injection point | `accessToken` callback (used by supabase-js internals) | `lib/supabase.ts:51-54` |
| Realtime | Token pushed into the WS separately via `setRealtimeAuth` → `(supabase.realtime as any).setAuth(token)` | `lib/supabase.ts:85-90` |
| Server-side identity | `requesting_user_id()` = `current_setting('request.jwt.claims',true)::jsonb->>'sub'` → the Clerk user id | `supabase/migrations/20260412000006_fix_requesting_user_id.sql:17-22` |
| Assumed TTL | **60 s**, asserted in a comment, never verified against the Clerk dashboard | `contexts/SupabaseAuthContext.tsx:7-13` |

Supabase must have Clerk registered as a third-party auth provider for JWKS verification to work at all. That is a **dashboard setting, not in the repo** — unverifiable here (coverage gap CG-2).

### 1.2 Where tokens live on the client

What the app code touches directly:

- `window.Clerk.session.getToken()` — `lib/supabase.ts:34-43`. The token is never stored by app code; it is fetched per request and per 50 s refresh tick.
- Everything else about token storage (cookie name, `Secure`/`HttpOnly`/`SameSite` flags, localStorage fallback for the dev-browser handshake, refresh-token rotation) is **inside the Clerk SDK and unverifiable from this repo**. Say so plainly: the repo contains zero code that reads or writes a Clerk cookie.

App-managed client storage (all plaintext, all readable by any script on the origin):

| Key | Written at | Contents | Cleared at |
|---|---|---|---|
| `localStorage['pendingInviteToken']` | `App.tsx:975`, `components/invite/InvitePage.tsx:124` | a live, unexpired group invite token | `App.tsx:261` after use — **not on sign-out** |
| `localStorage['app-ui']` (Zustand persist) | `store/appStore.ts` | `selectedGroupId`, `theme` | never |
| in-memory SSO flags | `utils/nativeDeepLinks.ts:7-8` (`capturedSsoRawUrl`, `ssoConsumeStarted`) | the raw deep-link URL including Clerk callback params | on successful consume (`:149`) |

### 1.3 Refresh flow, and what happens when it fails

`getClerkSupabaseToken` (`lib/supabase.ts:33-43`):

```ts
const clerk = (window as any).Clerk;
if (!clerk?.session) return '';           // no session → empty string
try { const t = await clerk.session.getToken(); if (t) return t; }
catch (e) { console.warn(...); }          // throw → swallowed
return '';                                 // → empty string
```

`''` is falsy, so `lib/supabase.ts:59` skips the `Authorization` header entirely. The request then goes out with **only `apikey: <anon>`**. Trace what PostgREST does with that:

- The role resolves to `anon`, so `requesting_user_id()` returns NULL.
- Every policy compares something to NULL → NULL → not true → row filtered.
- **Reads** therefore return `200 []`, not `401`. `getGroups`/`getTransactions`/`getPeople` all treat an empty array as "you have no data" and render the empty state (`services/supabaseApiService.ts:154-165`, `:512-515`, `:777-779`). The user sees a silently empty app, not an auth error.
- **Writes** are rejected by the `WITH CHECK` clauses → `42501`, which surfaces as a red toast or (more often) a `console.error` only.
- Tables with `TO authenticated`-scoped policies (`people` SELECT, all `group_invites`/`email_invites` policies) are additionally denied by role.
- `get_invite_preview` is granted to `anon` (`20260812000000:161`), so an unauthenticated fetch still works there.

**Realtime refresh.** `setInterval(..., 50_000)` re-pushes the JWT (`contexts/SupabaseAuthContext.tsx:67-74`, constant at `:13`). The interval is owned by the effect keyed on `[user, isUserLoaded]` and cleared on unmount (`:92-95`).

Backgrounded-tab behaviour: browsers clamp `setInterval` in hidden tabs (Chrome clamps to ≥1 min after 5 min hidden, and freezes entirely in some conditions). A 50 s timer against a 60 s TTL has 10 s of slack, which a 60 s clamp erases. The WS would then carry an expired JWT until the tab is foregrounded. There is **no `visibilitychange` handler and no re-auth on WS reconnect** anywhere in the repo (`grep -n visibilitychange` → 0 hits). Consequence: silently missed realtime events after a tab has been backgrounded. Confidence: **SUSPECTED** — the clamping behaviour is browser-specific and Supabase's own socket may re-handshake; not verified.

### 1.4 Logout

`signOut()` — `contexts/SupabaseAuthContext.tsx:98-108`:

```ts
await setRealtimeAuth(null);   // WS drops to anon — fail-closed, good
await clerkSignOut();          // Clerk SDK — server-side revocation unverifiable
setPerson(null);
```

What is **not** cleared:

- **TanStack Query cache.** `queryClient.clear()` appears nowhere (`grep -rn "queryClient.clear\|qc.clear"` → 0 hits). Keys are `['groups', personId]` etc. (`services/queries.ts:8-13`), so after sign-out the queries go `enabled:false` (`:21,29,37,45`) and stop refetching, but **the cached rows stay in memory**. A second user signing in on the same tab gets different keys, so they do not *read* the first user's data — but the first user's group names, transaction amounts and people rows remain in the JS heap and in any Sentry session replay (§8) until a full page reload. `App.tsx:276` has a comment "Query caches will clear based on person context" — that is not what happens; nothing clears.
- **`localStorage['pendingInviteToken']`** — survives sign-out. Next user to sign in on that device auto-joins the previous user's pending invite (`App.tsx:258-262`).
- **`localStorage['app-ui']`** — `selectedGroupId` survives. `App.tsx:190-195` clears the in-memory selection when `person` goes null, but the persisted value is rewritten from the store, and the group id itself leaks the previous session's context.
- **Server-side session revocation** lives entirely in `clerkSignOut()` — **unverifiable from this repo**.

→ finding **A-18**.

### 1.5 Native Android flow

Chain: `clerk-android` (Credential Manager + Google) → native session JWT → Edge `native-bridge` → Clerk **sign-in token** ("ticket") → `clerk-react` `signIn.create({strategy:'ticket'})` → `setActive`.

- `services/nativeAuthBridge.ts:85-109` (`completeNativeGoogleSignIn`), `:49-79` (`exchangeNativeSessionForTicket`), `:25-47` (`consumeSignInTicket`).
- `supabase/functions/native-bridge/index.ts:100-141`.
- `supabase/config.toml` sets `verify_jwt = false` **only** for `native-bridge`, so the function is reachable by anyone with the URL; it does its own verification.

**Assessment — is this an account-takeover amplifier? Yes, in one specific way.**

`verifyToken(token, { secretKey, clockSkewInMs: 10_000 })` (`index.ts:104-107`) is called with **no `authorizedParties`** and no audience assertion. What it does check is inside `@clerk/backend` and not readable here, but the documented behaviour is: JWKS signature for the instance derived from `secretKey`, plus `exp`/`nbf`/`iat`. `azp` is validated **only** when `authorizedParties` is passed. The only other gate is `clerkUserIdFromVerified` requiring `sub` to start with `user_` (`:60-67`).

Therefore: **any valid, unexpired Clerk session JWT for this instance — from the web app, the Android app, or any other client of the same instance — can be exchanged for a 60-second one-time sign-in token that mints a *new full session* for that user.** That converts a 60-second bearer credential into a durable session. The same session JWT is already sprayed at three other destinations (`Authorization` header on every PostgREST call, `send-email`, `suggest-tag`), and Sentry runs with `sendDefaultPii:true` and 100 %-on-error session replay (`index.tsx:19-30`). Anywhere a token leaks — a proxy log, a replay, an XSS, a malicious npm dep — the bridge upgrades it. → finding **A-10**.

Rate limit: `rateLimit('native-bridge:'+userId, 10, 60_000)` (`index.ts:126`) — an in-memory `Map` in one Deno isolate (`_shared/auth.ts:44-59`). Edge Functions scale to many isolates and cold-start frequently, so this bounds nothing an attacker cares about. Note it is applied **after** `verifyToken` and after `createClerkClient`, so it does not protect against unauthenticated flooding at all.

CORS: `native-bridge` has its own allow-list defaulting to `https://www.motamaati.in` / `https://motamaati.in` and falls back to `CAPACITOR_ORIGIN` for unknown origins (`index.ts:33-50`) — i.e. it never reflects an arbitrary origin. This is *stricter* than the shared helper `corsHeadersFor` used by `send-email`/`suggest-tag`, which returns `Access-Control-Allow-Origin: *` when `ALLOWED_ORIGINS` is unset (`_shared/auth.ts:19-23`). Whether that env var is set in production is a coverage gap (CG-2). CORS is not a real defence here anyway — the bearer token, not a cookie, is the credential, so a non-browser client bypasses it entirely.

**The older Account-Portal path is still shipped.** `public/native-sso.html` is served by a Vercel rewrite (`vercel.json:6-14`) and referenced as `NATIVE_PORTAL_RETURN_URL` (`components/auth/clerkAppearance.ts:22`). What it does with `__clerk_created_session`:

1. `public/native-sso.html:126-133` reads `__clerk_created_session` / `created_session_id` / `session_id` from the query string. **If present, it skips Clerk entirely** and calls `showButton(sessionId)`.
2. `showButton` builds `intent://sso-callback?<the whole original query+hash>#Intent;scheme=kharchbaant;package=com.kharchbaant.app;...end` (`:64-70`) and **auto-navigates to it** (`:88`).

So `https://www.motamaati.in/native-sso.html?__clerk_created_session=<anything>` is a one-click gadget that launches the installed app with attacker-chosen query parameters. Those parameters land in `applyNativeAppUrl` (`utils/nativeDeepLinks.ts:168-207`) → `capturedSsoRawUrl` → `clerk.handleRedirectCallback(HANDLE_REDIRECT_PARAMS, spaNavigate)` (`:134-144`). **No origin, signature or shape validation is performed on any of these parameters by app code** — `isSsoCallbackUrl` is a substring test (`:25-32`).

Can a crafted link do anything? Setting an attacker's session requires Clerk to accept a session id the victim's client has no credentials for, which Clerk's client should refuse. Marking this **SUSPECTED**, not a finding: the exploitability lives inside `clerk-js`'s `handleRedirectCallback` and cannot be determined from this repo. What *is* confirmed is the missing validation and the fact that the page is a public, unauthenticated app-launcher.

**The same handler also accepts invite deep links unconditionally**: `historyPathForAppUrl` matches `invite/([^/?#]+)` on *any* incoming URL (`utils/nativeDeepLinks.ts:57-61`), and the `kharchbaant` scheme filter is `BROWSABLE` with no host restriction (`android/app/src/main/AndroidManifest.xml:29-34`), so **any installed app or any web page can fire `kharchbaant://invite/<attacker-token>`** and the app will navigate to `/invite/<token>`. → feeds finding **A-11**.

### 1.6 Password reset / email verification / magic links / OAuth

All Clerk-hosted. The repo contains **no** password handling, no verification-code handling, no reset flow — `grep -rn "password" components/ services/ --include=*.tsx --include=*.ts` returns only Clerk-appearance styling. State plainly: **these are unverifiable from this repo.**

What the repo does configure:

- `components/auth/clerkAppearance.ts:6-13` — CSS only (hides social buttons in the WebView).
- `components/auth/clerkAppearance.ts:16` — `NATIVE_SSO_REDIRECT = 'kharchbaant://sso-callback'`.
- `components/auth/clerkAppearance.ts:22` — `NATIVE_PORTAL_RETURN_URL = 'https://www.motamaati.in/native-sso.html'`.
- `capacitor.config.ts:24-29` — WebView `allowNavigation` allow-list: `*.clerk.accounts.dev`, `*.clerk.com`, `clerk.motamaati.in`, `accounts.motamaati.in`. Wildcards on `*.clerk.com` / `*.clerk.accounts.dev` are broad but are Clerk-owned hosts.
- `capacitor.config.ts:18` — WebView origin is `https://www.motamaati.in` (so the Clerk `pk_live` origin check passes inside the app).
- Android App Links with `autoVerify` for `/sso-callback` and `/invite` on both apex and `www` (`AndroidManifest.xml:49-57`).

Redirect handling the app performs itself: `SsoFinish` (`components/auth/SsoFinish.tsx`) and `utils/nativeDeepLinks.ts`. **Neither validates the origin of `__clerk_status` / `__clerk_created_session`** — `App.tsx:928-937` and `:978-985` treat the mere *substring* `__clerk_status` anywhere in `location.search` or `location.hash` as "we are in an SSO callback" and render `SsoFinish` instead of the app. That is a trivially triggerable UI-state confusion (any link `https://www.motamaati.in/#__clerk_status=x` renders the SSO screen), harmless on its own, noted for completeness.

### 1.7 User enumeration

**`find_person_by_email(p_email)` is a global address book.** `supabase/migrations/20260728000000_phase_a_rls_people_visibility.sql:103-117`:

```sql
CREATE OR REPLACE FUNCTION find_person_by_email(p_email text)
RETURNS SETOF people LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT * FROM people WHERE email IS NOT NULL
      AND lower(trim(email)) = lower(trim(p_email)) LIMIT 1; $$;
GRANT EXECUTE ON FUNCTION find_person_by_email(text) TO authenticated;
```

`RETURNS SETOF people` + `SELECT *` + `SECURITY DEFINER` = **the entire row**, bypassing the `i_can_see_person` SELECT policy. Fields that leak to any authenticated user, for any email they can guess:

`id`, `name`, `avatar_url` (a base64 data URL — the person's actual photo), `email`, **`clerk_user_id`** (the Clerk user id, which is also the RLS subject), `user_id` (same value), `auth_user_id`, `is_claimed`, `source`, `created_at`, `updated_at`.

Called from the UI on every keystroke-debounced email entry in the add-member dialog (`components/MemberInviteModal.tsx:39-49` → `services/supabaseApiService.ts:833-843`). The API is a plain `POST /rest/v1/rpc/find_person_by_email` with no rate limit. That gives: (a) "does this email have an account here" for arbitrary email lists, (b) real name + photo for each hit, (c) `is_claimed` which is exactly the flag an attacker needs to pick targets for **A-01**/**A-06**, (d) the `clerk_user_id`. The migration's own header calls this "invite UX without full-table SELECT" — it is a worse leak than the full-table SELECT it replaced for anyone who has an email list. → finding **A-03**.

**`get_invite_preview` for anon** — `20260812000000:77-161`. Anyone with a token (no auth at all) gets group name, currency, group_type, trip dates, `created_by`, `is_archived`, inviter `id`/`name`/`avatar_url`, and **every email address ever invited on that link** (`:120-124`, returned at `:156`). See §4/§6 and finding **A-09**.

**Edge `send-email` error messages** are generic (`'Failed to send email'`, `'Unauthorized'`, `'Rate limit exceeded'` — `index.ts:59,64,248`) and do not distinguish "recipient exists". MailerSend's own response body is logged server-side only (`:247`). No enumeration there.

### 1.8 Rate limiting and lockout

| Surface | Limit | Reality |
|---|---|---|
| Clerk sign-in / sign-up / reset | Clerk attack-protection settings | **Unverifiable from this repo** (dashboard). No repo config touches it. |
| Edge `send-email` | `rateLimit('email:'+sub, 20, 60_000)` — `send-email/index.ts:63` | in-isolate `Map` (`_shared/auth.ts:44-59`) |
| Edge `suggest-tag` | `rateLimit('tag:'+sub, 30, 60_000)` — `suggest-tag/index.ts:50` | same |
| Edge `native-bridge` | `rateLimit('native-bridge:'+userId, 10, 60_000)` — `native-bridge/index.ts:126` | same, and applied *after* the expensive verify |
| **PostgREST tables (all writes)** | **none** | — |
| **RPC (`find_person_by_email`, `create_unclaimed_person`, `ensure_my_person`, `claim_person_by_email`, `accept_group_invite`, …)** | **none** | — |
| Realtime broadcast send | none | — |

Why the Edge limit is not a limit: `rateBuckets` is a module-scope `Map` in one Deno isolate. Supabase Edge Functions run many isolates concurrently and recycle them on cold start; the comment at `_shared/auth.ts:44` ("best-effort; resets per cold start") concedes this. An attacker sending in parallel or spacing requests across cold starts is not bounded. There is no Redis, no `pg` counter, no Supabase rate-limit config in the repo.

The absence of any limit on PostgREST/RPC is itself a finding (**A-17**): `create_unclaimed_person` and the direct `people` INSERT policy (§7) let one authenticated user insert unbounded rows, and `find_person_by_email` lets them enumerate an unbounded email list, at HTTP speed.

---

## 2. Authorization matrix

Read this table with §7 in hand. Two global caveats:

1. **Postgres PERMISSIVE policies are OR'ed.** If `migrations/HOTFIX_reset_all_policies.sql` was ever applied and never manually reversed, `groups_*_all` and `group_members_*_all` (`USING (true)` / `WITH CHECK (true)`, `:21-62`) sit alongside the real policies and **any authenticated user passes**. No file in this repo drops them; Phase A only drops policies literally named `"Allow all operations"` (`20260728000000:23-27`); `scripts/rls-beta-audit.sql:19-27` only greps for `%allow all%` and so **would report PASS with the hotfix live**. The "if hotfix" column below reflects that. → finding **A-02**.
2. **PostgREST adds nothing.** The `.eq('person_id', personId)` style filters in `supabaseApiService.ts` are client-side query params. A modified client omits them. Only the policy text matters.

Abbreviations: `MEM` = `i_am_member_of(group_id)`, `CRE` = `i_created_group(group_id)`, `ME` = `clerk_user_id = requesting_user_id()`.

### 2.1 PostgREST table endpoints

| Endpoint/op | What it does | Who SHOULD be allowed | Check that actually exists | Where | VERDICT | If hotfix live |
|---|---|---|---|---|---|---|
| `groups` SELECT | list groups | members + creator | `created_by = sub OR MEM OR EXISTS(people id::text=created_by AND ME)` | `20260412000005:88-97` | ENFORCED | **ALL rows to any user** |
| `groups` INSERT | create group | anyone, `created_by` = self | `created_by = sub OR EXISTS(people id::text=created_by AND ME)` | `…005:100-108` | ENFORCED (client picks the value, but it must resolve to self) | **any `created_by`** |
| `groups` UPDATE | rename/archive/retype | creator | `USING (CRE)`; **no `WITH CHECK`** → USING reused | `…005:110-111` | ENFORCED-but-leaky (see A-15: `created_by` mutable) | **any user, any group** |
| `groups` DELETE | delete group | creator, settled | `USING (CRE)` — settlement is **not** checked in SQL | `…005:113-114` | ENFORCED for creator; `allSettled` is CLIENT-ONLY | **any user** |
| `group_members` SELECT | member list | members + creator | `CRE OR MEM` | `20260412000007:20-24` | ENFORCED | **ALL rows** |
| `group_members` INSERT | add a member | creator (arguably) | `WITH CHECK (CRE OR MEM)` — **any member may add any `person_id`** | `20260812000000:334-336` | MISSING (no consent, no membership check on the *added* person) → A-07 | **any user, any group** |
| `group_members` UPDATE | — | nobody | **no policy exists** | — | ENFORCED-by-absence (denied) | **allowed** (`group_members_update_all`) |
| `group_members` DELETE | remove a member | creator | `USING (CRE)` | `…005:134-135` | ENFORCED | **any user** |
| `transactions` SELECT | read expenses | group members | `CRE OR MEM` | `…005:143-144` | ENFORCED | ENFORCED (hotfix does not touch `transactions`) |
| `transactions` INSERT | add expense | group members | `WITH CHECK (CRE OR MEM)` | `…005:146-147` | ENFORCED for *group*; `paid_by_id` / participants unchecked → A-16 | same |
| `transactions` UPDATE | edit expense | ideally creator-of-row | `USING (CRE OR MEM)`, no `WITH CHECK` → reused on the new row | `…005:149-150` | ENFORCED at group level; **any member edits any row** → A-13 | same |
| `transactions` DELETE | delete expense | ideally creator-of-row | `USING (CRE OR MEM)` | `20260412000008:12-13` | same as UPDATE → A-13 | same |
| `payment_sources` SELECT | own cards | owner | `EXISTS(people id::text=user_id AND ME) OR user_id = sub` | `…005:164-168` | ENFORCED | same |
| `payment_sources` INSERT | add card | owner | same expr as `WITH CHECK` | `…005:170-174` | ENFORCED (client supplies `user_id`, must resolve to self) | same |
| `payment_sources` UPDATE | rename/archive | owner | same expr, no separate `WITH CHECK` | `…005:176-180` | ENFORCED | same |
| `payment_sources` DELETE | delete card | owner | same expr | `…005:182-186` | ENFORCED | same |
| `people` SELECT | read a person | self + co-members + creator's members + active inviters | `TO authenticated USING (i_can_see_person(id))` | `20260728000000:80-82`, fn `:30-72` | ENFORCED — **but bypassed by `find_person_by_email`** → A-03 | same |
| `people` INSERT | create person | self, or a placeholder | `ME OR (COALESCE(is_claimed,false)=false AND clerk_user_id IS NULL)` | `20260728000000:88-92` | MISSING bound — unlimited attacker-controlled placeholders → A-06 | same |
| `people` UPDATE | edit profile | self | `USING (ME)`, no `WITH CHECK` → reused | `20260728000000:94-96` | ENFORCED (see A-23 for the silent-no-op UX) | same |
| `people` DELETE | delete profile | self | `USING (ME)` | `20260728000000:98-100` | ENFORCED | same |
| `group_invites` SELECT | list invites | members | `TO authenticated USING (CRE OR MEM)` | `20260812000000:298-300` | ENFORCED — note this returns **live plaintext tokens** to every member | same |
| `group_invites` INSERT | create link | members | `WITH CHECK (CRE OR MEM)` | `:302-304` | ENFORCED | same |
| `group_invites` UPDATE | deactivate | members | `USING (CRE OR MEM)` | `:306-308` | ENFORCED — any member can deactivate the creator's link | same |
| `group_invites` DELETE | delete link | members | `USING (CRE OR MEM)` | `:310-312` | ENFORCED | same |
| `email_invites` SELECT | who was emailed | members | `USING (CRE OR MEM)` | `:314-316` | ENFORCED — **but anon reads the same emails via `get_invite_preview`** → A-09 | same |
| `email_invites` INSERT | record an email invite | members | `WITH CHECK (CRE OR MEM)` | `:318-320` | ENFORCED at group level; the **email address itself is arbitrary** → A-08 | same |
| `email_invites` UPDATE / DELETE | mark accepted / remove | members | `USING (CRE OR MEM)` | `:322-328` | ENFORCED | same |
| `group_deletion_requests` SELECT/INSERT/UPDATE/DELETE | the whole approval workflow | requester + creator | **RLS enabled at `20260728000000:19`; ZERO policies anywhere in the repo** | — | **INCONSISTENT** — either every op is denied (feature dead) or RLS was never actually enabled (table fully open to any authenticated user). Cannot tell from the repo. → A-05 | unchanged (hotfix doesn't touch it) |
| `ai_item_cache` SELECT | read shared tag cache | authenticated | `USING (auth.role() = 'authenticated')` | `supabase-schema.sql:91-94` | SUSPECTED — see below | unchanged |
| `ai_item_cache` INSERT | write shared tag cache | authenticated | `WITH CHECK (auth.role() = 'authenticated')` | `supabase-schema.sql:96-99` | SUSPECTED + poisoning surface → A-21 | unchanged |
| `ai_item_cache` UPDATE/DELETE | — | nobody | no policy | — | denied (rows immutable) | unchanged |

On `auth.role()`: the policy predates Clerk. Under Supabase third-party auth, the Postgres role is switched from the JWT's `role` claim, and `auth.role()` reads that claim back. Whether a Clerk session token carries `role: "authenticated"` depends on the Clerk↔Supabase integration configuration, which is a dashboard setting. If it does not, both policies evaluate false and the AI cache silently never hits (a performance/cost bug, not a security one — `services/tagClassifier.ts:14-27` swallows the error and returns `null`, falling through to a paid Gemini call every time). Marked **SUSPECTED**; the closing artifact is `SELECT auth.role();` executed with a real Clerk JWT.

### 2.2 RPC endpoints (`POST /rest/v1/rpc/<name>`)

| RPC | What it does | Who SHOULD | Check that exists | Where | VERDICT |
|---|---|---|---|---|---|
| `ensure_my_person(p_name, p_email)` | upsert my `people` row; **claims any unclaimed row whose email matches `p_email`** | self only, email from the IdP | `requesting_user_id()` non-empty; **`p_email` is trusted verbatim** | `20260813020000:16-18`, claim branch `:35-49` | **MISSING** → A-01 |
| `claim_person_by_email(p_email, p_clerk_id, p_name)` | claim an unclaimed row by email | self only | clerk id must equal JWT sub (`:29-34`) — **but `p_email` is unverified** | `20260812000000:12-53` | **MISSING** → A-01 |
| `create_unclaimed_person(name, email, avatar)` | insert a placeholder | any signed-in user | auth check + non-empty name | `20260813010000:17-23` | ENFORCED (weakly) — unbounded, see A-06/A-17 |
| `find_person_by_email(p_email)` | full `people` row for any email | co-members only | **auth only** — `SECURITY DEFINER`, `RETURNS SETOF people`, `SELECT *` | `20260728000000:103-117` | **MISSING** → A-03 |
| `get_invite_preview(p_token)` | invite landing payload | holder of the token | token knowledge only; **granted to `anon`** | `20260812000000:77-162` | ENFORCED-by-design, over-shares → A-09 |
| `accept_group_invite(p_token)` | join a group | token holder, bound to JWT | `requesting_user_id()` → `people` row → insert `group_members`; `FOR UPDATE` lock; uses/expiry checked | `20260812000000:168-273` | **ENFORCED** — this one is correct |
| `anonymize_my_account()` | wipe my identity fields | self | `requesting_user_id()` → own row | `20260813000000:15-39` | ENFORCED — **but it nulls `clerk_user_id`, which enables A-01's second step** |
| `cleanup_expired_invites()` | deactivate expired invites | a scheduler | **INVOKER, no auth check, default grants** | `migrations/20251019_add_invite_system.sql:64-86` | MISSING (impact is benign: it only expires already-expired rows). Never called by the app. |
| `generate_invite_token()` | random token | — | INVOKER, no auth check | `20251019:89-95` | MISSING (impact nil — returns entropy, reveals nothing). Never called; the client generates tokens itself. |
| `get_current_user_person_id()` | Supabase-Auth-era helper | — | **no definition in this repo** (only in `lib/database.types.ts:462-538`) | — | UNKNOWN → coverage gap |
| `debug_auth_check()` | unknown | — | **no definition in any SQL file in this repo**, yet present in the generated types | `lib/database.types.ts` | **UNKNOWN — flag.** A function named `debug_auth_check` exists in the live DB (the types were generated from it) and its body, security mode and grants are invisible here. → A-26 |
| `requesting_user_id()` | JWT sub | internal | `STABLE`, not `SECURITY DEFINER`; default grants → callable | `20260412000006:17-22` | Callable; returns only the caller's own sub. Harmless. |
| `i_am_member_of(uuid)` | membership oracle | internal | `SECURITY DEFINER`, `GRANT ... TO authenticated` | `20260412000003:69`, body `20260412000005:22-33` | **CLIENT-CALLABLE ORACLE** → A-27 |
| `i_created_group(uuid)` | creator oracle | internal | `SECURITY DEFINER`, granted | `20260412000003:70`, body `20260412000005:38-57` | same → A-27 |
| `i_can_see_person(uuid)` | visibility oracle | internal | `SECURITY DEFINER`, `GRANT ... TO authenticated` | `20260728000000:74` | same → A-27 |

**What a user learns by calling `i_am_member_of(<guessed uuid>)`:** nothing, in practice. All three helpers answer only about *the caller* ("am **I** a member of X?"), and a v4 UUID is not guessable at scale (2^122). They do give a cheap oracle for whether a *specific known* group id exists and whether the caller belongs to it — useful only to an attacker who already has group ids from another leak (e.g. the `broadcast` payload in A-04, which ships a `groupId` for every write system-wide). That composition is the reason A-27 is P2 rather than P3.

### 2.3 Edge Functions

| Endpoint | What it does | Who SHOULD | Check that exists | Where | VERDICT |
|---|---|---|---|---|---|
| `send-email` `welcome` | mail an arbitrary address, arbitrary `userName`/`appUrl` | nobody (dead in the UI) | any valid JWT + `isValidEmail` | `send-email/index.ts:57-60, 84-97` | **MISSING** → A-08 |
| `send-email` `group_invite` | mail an arbitrary address with arbitrary `inviterName`, `groupName`, `inviteUrl` | a member of the group being invited to | any valid JWT — **no group id is passed, so no membership check is possible** | `:99-120` | **MISSING** → A-08 |
| `send-email` `member_added` | arbitrary address + arbitrary `addedByName`/`groupName`/`groupUrl` | group members | any valid JWT | `:122-140` | MISSING → A-08 |
| `send-email` `settle_up` | **two** mails, arbitrary addresses, arbitrary amount/currency/names | the settling group's members | any valid JWT | `:142-195` | MISSING → A-08 (also 2 sends per request, doubling the effective rate) |
| `send-email` `new_expense` | **up to 25** recipients per call | group members | any valid JWT | `:197-226`, cap `:39,202` | MISSING → A-08 |
| `suggest-tag` | Gemini call, ≤200 chars | authenticated | `requireAuthSub` + 30/min/isolate | `suggest-tag/index.ts:44-52, 62-67` | ENFORCED-ish (cost exposure bounded only by the fake rate limit) |
| `native-bridge` | Clerk session JWT → sign-in ticket | the Android app | `verifyToken` (no `authorizedParties`), `sub` prefix check, 10/min/isolate | `native-bridge/index.ts:104-133` | **CLIENT-ONLY-equivalent** → A-10 |

`sendWelcomeEmail`, `sendMemberAddedEmail`, `sendSettleUpEmail`, `sendNewExpenseEmail` are exported but never called (`services/emailService.ts:115-136`; the call sites in `supabaseApiService.ts:567-621` are commented out). The **server handlers are live regardless** — dead client code does not close a server endpoint.

### 2.4 Realtime

| Channel / event | Publisher | Subscriber | Authorization that exists | Where | VERDICT |
|---|---|---|---|---|---|
| `public:groups` `postgres_changes *` | Postgres WAL | every signed-in client | RLS re-evaluated per subscriber per row for INSERT/UPDATE | `supabaseApiService.ts:389-401` | ENFORCED for INSERT/UPDATE; **DELETE is not RLS-filtered** (see below) → A-22 |
| `public:transactions` `postgres_changes *` | WAL | every client | same | `:404-418` | same → A-22 |
| `public:payment_sources` `postgres_changes *` | WAL | every client | same | `:433-447` | same → A-22 |
| `public:people` `postgres_changes *` | WAL | every client | same | `:450-464` | same → A-22 |
| `public:group_members` `postgres_changes *` | WAL | every client | same | `:467-475` | same → A-22 |
| `public:transactions` **`broadcast` event `tx`** | **the client itself** (`_broadcastTxChange`) | every client on the topic | **NONE** — the channel is created with `supabase.channel('public:transactions')`, i.e. `config.private` defaults to `false` | publisher `:479-487`, called at `:565,:658,:694`; subscriber `:422-426` → `queries.ts:107-109` | **MISSING** → A-04 |
| `heartbeat` | — | status only | none needed | `components/RealtimeStatus.tsx` | n/a (no data) |

Vendor confirmation (fetched 2026-09-07):

- <https://supabase.com/docs/guides/realtime/postgres-changes> — "Postgres Changes authorizes every event against each subscriber." and, critically: **"RLS policies are not applied to `DELETE` statements, because there is no way for Postgres to verify that a user has access to a deleted record."** Also: "By default, only `new` record changes are sent but if you want to receive the `old` record (previous values) whenever you `UPDATE` or `DELETE` a record, you can set the `replica identity` of your table to `full`."
- `migrations/enable_realtime.sql:5-9` sets `REPLICA IDENTITY FULL` on all five tables. So DELETE events carry the **full old row** — and per the quote above, those events are **not** RLS-filtered. A non-member subscribed to `public:transactions` receives the complete deleted transaction row (amount, description, `paid_by_id`, `split_participants`, `group_id`) for **every deletion system-wide**. → A-22.
- <https://supabase.com/docs/guides/realtime/authorization> — RLS on `realtime.messages` is only enforced when the client sets `config: { private: true }`; without it "anyone with access to the anon key could potentially subscribe and send broadcasts". No `private: true` appears anywhere in this repo (`grep -rn "private: true"` → 0 hits). → A-04.

### 2.5 App-level composite operations

| Operation | Underlying ops | Server-side check | Where | VERDICT |
|---|---|---|---|---|
| `deleteGroup(groupId, userId, isOwner, allSettled)` | `group_members` DELETE → `transactions` DELETE → `groups` DELETE | `isOwner`/`allSettled` are **JS `throw`s on client-computed booleans**; DB checks only `CRE` for `groups`, `CRE OR MEM` for `transactions`, `CRE` for `group_members` | `supabaseApiService.ts:8-19`; called `App.tsx:546` | CLIENT-ONLY for `allSettled`; ENFORCED for creator-ness → A-12 |
| `archiveGroup(groupId, userId, isOwner, userSettled, allSettled)` | `groups` UPDATE `is_archived` | all three booleans are client-side; DB checks `CRE` — **so a non-creator's archive is actually rejected by RLS**, while the JS says only a non-creator may archive (`:23`). The two rules contradict each other. | `:22-31`; called `App.tsx:567` | **INCONSISTENT** → A-12/A-14 |
| `unarchiveGroup(groupId)` | `groups` UPDATE | **no JS gate at all**; DB `CRE` | `:2-6`; called `ArchivedGroupsModal.tsx:51` | ENFORCED by RLS only; the button is shown to every member and fails silently for non-creators (`.update()` without `.single()` returns no error on 0 rows) |
| `updateGroup(groupId, data)` | `groups` UPDATE **`.select().single()`** → `group_members` DELETE (all) → `group_members` INSERT (new set) | `groups` UPDATE `CRE`; member ops `CRE` (delete) / `CRE OR MEM` (insert) | `:326-373` | See §5 for the step-by-step outcome. Not transactional → A-30 |
| `requestGroupDeletion(groupId, requestedBy)` | `group_deletion_requests` SELECT + INSERT | `requested_by` is **client-supplied**; table has no policies | `:220-242`; `App.tsx:552` | MISSING → A-05/A-12 |
| `approveGroupDeletion(requestId, approverId, allSettled)` | read request+group → `group_members`/`transactions`/`groups` DELETE → mark approved | **creator check is `group.created_by !== approverId` in JS** on data the client fetched (`:260`); `allSettled` in JS (`:261`). The DELETEs are then re-checked by RLS (`CRE`) | `:245-277` | CLIENT-ONLY for the workflow; the *destructive* step is still ENFORCED by `groups` DELETE `USING(CRE)` → A-12 |
| `rejectGroupDeletion(requestId)` | `group_deletion_requests` UPDATE | **none, anywhere** | `:317-324` | MISSING → A-05 |
| `getPendingDeletionRequests(userId)` | `group_deletion_requests` SELECT + embedded `groups`/`people` | **`.filter(req.groups?.created_by === userId)` in JS** (`:294`) | `:280-314` | CLIENT-ONLY → A-12 |
| `getArchivedGroups(userId)` | `groups` SELECT with `group_members!inner` | `.eq('group_members.person_id', userId)` is a client query param; RLS `groups` SELECT is the real gate | `:34-47` | ENFORCED by RLS (the JS filter is decoration) |
| `addPersonToGroup(groupId, {name,email})` | `find_person_by_email` RPC → **direct `group_members` INSERT with the returned `person.id`**, else `create_unclaimed_person` → INSERT | `WITH CHECK (CRE OR MEM)` — only checks *the caller's* membership, never the added person's consent | `apiService.ts:43-73` | **MISSING** → A-07 |
| `createGroupInvite(...)` | `group_members` SELECT (JS pre-check) → `group_invites` INSERT → N× `email_invites` INSERT → N× `send-email` | JS `if (!membership) throw` (`:984`); DB `CRE OR MEM` on both tables | `supabaseApiService.ts:973-1071` | ENFORCED for the group; the **email list is unbounded and arbitrary** → A-08 |
| `deactivateInvite(inviteId)` | `group_invites` UPDATE | `CRE OR MEM` — any member may kill any member's link | `:1209-1220` | ENFORCED (coarse) |
| `updateUserAvatar(personId, url)` | `people` UPDATE, **no `.single()`** | `USING (ME)` | `:1232-1243` | ENFORCED, but 0-row updates report success → A-23 |
| `updatePerson(personId, updates)` | `people` UPDATE `.select().single()` | `USING (ME)` | `:1246-1260` | ENFORCED; wrong id → PGRST116 error (accidental, see §3) |
| `mergePersonByEmail(email, clerkUserId)` | `people` SELECT unclaimed by email → `people` UPDATE set `clerk_user_id` | `people` UPDATE `USING (ME)` → **fails**, because the target row's `clerk_user_id` is NULL, not the caller's | `:1267-1291` | ENFORCED-by-accident. Dead code (no callers), but exported through `apiService.ts:35`. Its *intent* is exactly the A-01 exploit. |
| `batchApplyEmojisToGroupTransactions(groupId)` | `transactions` SELECT + N× UPDATE | `CRE OR MEM` per row | `:668-684` | ENFORCED; N sequential round-trips, any member may rewrite every description in the group |
| `anonymizeMyAccount()` | RPC | JWT sub | `:1294-1307` | ENFORCED |

---

## 3. IDOR sweep

Every id-accepting operation, and whether the *server* confirms the caller belongs to the resource.

| Operation (id param) | Server confirms caller↔resource? | Mechanism | Notes |
|---|---|---|---|
| `getGroups(personId)` | yes | RLS `groups` SELECT | the `personId` argument is a client filter only; omitting it returns everything RLS allows, which is the same set |
| `addTransaction(groupId, …)` | yes | `WITH CHECK (CRE OR MEM)` | but `paid_by_id` / participants unchecked — below |
| `updateTransaction(transactionId, …)` | **partially** | `USING (CRE OR MEM)` | see §3.1 |
| `deleteTransaction(transactionId)` | yes (group-level) | `USING (CRE OR MEM)` | any member deletes any row incl. settlements → A-13 |
| `deletePaymentSource(id)` / `archivePaymentSource(id)` | **yes** | `payment_sources` DELETE/UPDATE `USING (EXISTS(people id::text=user_id AND ME) OR user_id = sub)` (`20260412000005:176-186`) | scoped to owner. The UI passes only an id (`App.tsx:522`, `:510`) and the DB does the work. Non-owner → 0 rows, no error (neither call uses `.single()`), so the UI reports success — a cosmetic variant of A-23, not a data leak. |
| `updateUserAvatar(personId, …)` | yes | `people` UPDATE `USING (ME)` | 0 rows on someone else's id; **no `.single()`** → `error` is null → `{success:true}` → toast "Profile picture updated!" (`SettingsModal.tsx:85-87`). Enforcement is real; the *feedback* is a lie → A-23 |
| `updatePerson(personId, …)` | yes | same policy | uses `.select().single()`; 0 rows → PostgREST `PGRST116` → `throw`. **This is an accident, not a design**: the code contains no ownership check; it errors only because `single()` demands exactly one row. If a future edit drops `.single()` the call becomes a silent no-op like `updateUserAvatar`. |
| `requestGroupDeletion(groupId, requestedBy)` | **no** | `requested_by` is a client argument (`:237`); the table has **no policies** | if RLS is truly on → every insert denied → feature dead; if off → any authenticated user files a request naming *any* person as requester, for *any* group → A-05 |
| `approveGroupDeletion(requestId, approverId, …)` | **workflow: no; final deletion: yes** | creator check is `group.created_by !== approverId` in JS (`:260`) on client-fetched data | Nothing stops a non-creator calling the underlying table ops directly. They hit `groups` DELETE `USING(CRE)` and fail — but the two calls that run *first* are `group_members` DELETE (`CRE`-only, fails) and **`transactions` DELETE at `:265`, which is `CRE OR MEM` and succeeds**. So a plain member can wipe every transaction in a group they belong to with one PostgREST call. → A-13 |
| `rejectGroupDeletion(requestId)` | **no** | zero checks in JS or SQL (`:317-324`) | → A-05 |
| `getPendingDeletionRequests(userId)` | **no** | `.eq('status','pending')` server-side, creator match in JS (`:294`) | if the table is open, this returns *every* pending request in the system and the client discards the rows it doesn't want — the data still crossed the wire → A-05 |
| `getArchivedGroups(userId)` | yes | RLS `groups` SELECT | the `userId` filter is redundant with RLS |
| `acceptInvite({inviteToken})` | yes | RPC resolves the person from `requesting_user_id()` (`20260812000000:189-196`); the client's `personId` argument is **ignored** | correctly built |
| `validateInvite(token)` | n/a (the token *is* the credential) | `SECURITY DEFINER`, granted to anon | over-shares → A-09 |
| `createGroupInvite({groupId, invitedBy})` | yes, for the group | `group_invites` INSERT `WITH CHECK (CRE OR MEM)` | `invitedBy` is client-supplied and only FK-checked, so a member can attribute an invite to **any other `people.id`** — the landing page then shows that person's name and photo as the inviter. Impersonation-lite; folded into A-07. |

### 3.1 `updateTransaction` — can a member move a transaction to another group?

`services/supabaseApiService.ts:626-660` builds `updateData` from a fixed allow-list of fields. `group_id` is **not** in it, so the shipped client never sends it. But PostgREST accepts any column present in the PATCH body, so a modified client can send `{"group_id":"<other uuid>"}`. The answer is therefore entirely in the policy text:

```sql
CREATE POLICY "Users can update group transactions" ON transactions
  FOR UPDATE USING (i_created_group(group_id) OR i_am_member_of(group_id));
```
`supabase/migrations/20260412000005:149-150` — **there is no `WITH CHECK`.**

Postgres rule: for `UPDATE`, `USING` is applied to the existing row; when `WITH CHECK` is omitted, **the `USING` expression is reused as the `WITH CHECK`** and applied to the *new* row. Reasoning it through:

- Old row: `i_am_member_of(old.group_id)` must be true → the caller is a member of the source group. ✔
- New row: `i_am_member_of(new.group_id)` must **also** be true → the caller must also be a member of the destination group.

**Conclusion: a member cannot move a transaction into a group they do not belong to.** They *can* move it between two groups they both belong to, silently corrupting both groups' balances — invisible, because `transactions` has no `created_by`, no `updated_by` and no audit table (`audit/00-map.md` §0.4.1). That is Pass 1.4 material, not cross-tenant write.

Recorded so the reasoning is not repeated: the missing `WITH CHECK` is **not** exploitable for tenant escape on `transactions`, because the reused expression evaluates against the *new* row's own `group_id`. It **is** exploitable on `groups` (§5, A-15), because there the reused expression calls a `STABLE` function that re-queries the table and therefore still sees the *old* `created_by` in the statement snapshot.

### 3.2 `paid_by_id` and `split_participants[].personId` outside the group

**Not blocked.** Evidence:

- `paid_by_id` is `uuid FK → people(id)` (`00-map.md` §0.4.1). A foreign key checks *existence*, not membership.
- `split_participants` and `payers` are `jsonb` with **no CHECK constraint at all** ("no CHECK on sum, membership, or count", `00-map.md` §0.4.1).
- The `transactions` INSERT/UPDATE policies (`20260412000005:146-150`) reference only `group_id`. Neither `paid_by_id` nor the JSONB is mentioned anywhere in any policy.
- The only membership filtering is cosmetic: `App.tsx:592` computes `groupMembers = people.filter(p => selectedGroup.members.includes(p.id))` and passes it to the form (`:673`). That is a dropdown, not a check.
- `services/supabaseApiService.ts:541-556` inserts `paid_by_id` and `split_participants` verbatim.

So an authenticated member of group G can insert a transaction in G naming **any `people.id` in the entire database** as payer or participant. Effects: (a) that person's balance is polluted in a group they cannot see; (b) `getPeople` returns only co-members (`:803-806`), so the client renders `undefined` for the foreign ids; (c) it is a write-side existence oracle for `people` UUIDs. → **A-16**.

### 3.3 Realtime — can a non-member receive events for a group they don't belong to?

Split by event type, using the vendor quotes captured in §2.4.

- **INSERT / UPDATE via `postgres_changes`: no.** Supabase "authorizes every event against each subscriber", re-evaluating the table's SELECT policy against the row. A non-member fails `CRE OR MEM` and the event is dropped for them.
- **DELETE via `postgres_changes`: YES.** Documented: *"RLS policies are not applied to `DELETE` statements, because there is no way for Postgres to verify that a user has access to a deleted record."* All five tables have `REPLICA IDENTITY FULL` (`migrations/enable_realtime.sql:5-9`), so the old record is **complete**. Every signed-in client subscribes to unfiltered `event:'*'` on `transactions`, `groups`, `people`, `group_members`, `payment_sources` (`supabaseApiService.ts:389-475`). Therefore **every deletion anywhere in the system is broadcast, in full, to every online user.** The app's handlers only read `old.id` (`queries.ts:77,103,135,162`), but the payload is in the WS frame and trivially visible. Deleting a group cascades to its `group_members`, and `deleteGroup` explicitly deletes its `transactions` first (`:12-16`) — so one group deletion emits that group's entire financial history to every connected client. → **A-22**
- **`broadcast` on `public:transactions`: no authorization whatsoever.** The channel is created as `supabase.channel('public:transactions')` in both the publisher (`:483`) and the subscriber (`:410`); `config.private` is absent, so it defaults to `false`, and per the authorization doc RLS on `realtime.messages` is consulted only for private channels ("without the `private: true` configuration, RLS policies won't be enforced"). `grep -rn "private: true"` → 0 hits in the repo. Two consequences:
  1. **Read.** Anyone holding the anon key — which ships in every JS bundle and every APK, i.e. is *public* — can subscribe with **no user JWT at all** and receive `{groupId}` for **every expense created, edited or deleted system-wide** (`_broadcastTxChange` fires at `:565`, `:658`, `:694`). That is a live global activity feed: group UUIDs, write volume and timing. Composed with `i_am_member_of` (A-27) it also tells the attacker which of those groups they can reach.
  2. **Write.** The same anon client can `send({type:'broadcast', event:'tx', payload:{groupId:'x'}})`. Every subscribed client then runs `qc.invalidateQueries(qk.transactions(personId))` (`queries.ts:107-109`), and `getTransactions` is a two-round-trip **unpaginated** fetch of all transactions across all of that user's groups (`:490-535`). A send loop turns every online client into a refetch amplifier against the project's own PostgREST.
  → **A-04**

---

## 4. Group membership boundary

Assuming the intended (non-hotfix) policy set.

### Reads — can a non-member read…

| Data | Non-member? | Anon? | Evidence |
|---|---|---|---|
| a group's expenses | **no** | no | `transactions` SELECT `CRE OR MEM` (`…005:143-144`) |
| balances | **no** (they are derived client-side from expenses) | no | `utils/calculations.ts`; no server-side balance table, view or RPC exists |
| the member list | **no** | no | `group_members` SELECT `CRE OR MEM` (`…007:20-24`) |
| a `people` row | **no** via the table (`i_can_see_person`, `20260728000000:30-72`). **YES via `find_person_by_email`** for any email they can guess | no via the table (policy is `TO authenticated`); **but** `get_invite_preview` hands anon the inviter's `id`/`name`/`avatar_url` | A-03, A-09 |
| the group's invite links | **no** | no via the table | `20260812000000:298-300` |
| `email_invites` rows | **no** via the table | **YES via `get_invite_preview`** | A-09 |
| group name / currency / trip dates / creator id | **no** via the table | **YES via `get_invite_preview`** | A-09 |
| the `groupId` of every write in the system | — | **YES via the public `broadcast` channel** | A-04 |
| full deleted rows from any of the five tables | — | **YES for any signed-in user** (postgres_changes DELETE) | A-22 |

One clause deserves naming on its own. `i_can_see_person`'s fourth disjunct (`20260728000000:66-71`):

```sql
OR EXISTS (SELECT 1 FROM group_invites gi
           WHERE gi.invited_by = p_person_id
             AND COALESCE(gi.is_active,true) = true
             AND gi.expires_at > now())
```

It does not reference the caller at all. So **every person who has ever created a still-active invite link is visible to every authenticated user in the system**, full row, unconditionally. With `max_uses: null` and a 30-day window as the UI default (§6), that set is large and grows with every share. This is a design bug in the visibility helper, folded into A-03's fix.

### Writes — can a non-member write?

| Op | Non-member? | Why |
|---|---|---|
| insert a transaction into a group | no | `WITH CHECK (CRE OR MEM)` |
| edit / delete a transaction | no | `USING (CRE OR MEM)` |
| join a group | **only with a valid token**, via `accept_group_invite` (`20260812000000:236-237`) | correct |
| add themselves to `group_members` directly | no | `WITH CHECK (CRE OR MEM)` requires already being a member |
| add *someone else* to a group | n/a for a non-member — but see **A-07**: any member may add **any** `person_id` |
| create an invite for a group | no | `WITH CHECK (CRE OR MEM)` |
| write to `ai_item_cache` | yes, any authenticated user, globally shared, immutable once written | A-21 |
| write to `group_deletion_requests` | **unknown** — depends on whether RLS is genuinely enabled | A-05 |

### The invite-preview leak, in full

`get_invite_preview(p_token)` is granted to **`anon`** (`20260812000000:161`). One unauthenticated `POST /rest/v1/rpc/get_invite_preview` with a token returns (`:126-157`):

- `invite`: id, group_id, **the token itself**, invited_by, expires_at, max_uses, current_uses, is_active, timestamps
- `group`: id, **name**, currency, group_type, **trip_start_date**, **trip_end_date**, **created_by**, is_archived
- `inviter`: id, **name**, **avatar_url** (the person's real photo, as a base64 data URL)
- `email_invites`: **every email address ever invited on this link** (`:120-124`, emitted at `:156`)

The function comments *"email intentionally omitted from public preview"* at `:154` — about the **inviter's** email — three lines after shipping the complete list of **invitees'** emails. Invite links travel by WhatsApp, SMS and clipboard (`GroupFormModal.tsx:182-214`), so anyone who is forwarded one, or is in a group chat where one was pasted, gets the group's name and travel dates plus the email addresses of everyone invited. `InvitePage.tsx:79` renders those emails into the pre-auth page. → **A-09**

---

## 5. Role gaps

There is exactly one role in this system: `groups.created_by`. `group_members` has **no role column** (`00-map.md` §0.4.1: "No role column: 'admin' = `groups.created_by`").

| Question | Answer | Evidence |
|---|---|---|
| **Edit or delete an expense they didn't create?** | **Any member can, on any expense in the group, including settlements.** `transactions` has no `created_by` column at all, so "who created it" is not even recorded — the check is impossible to write without a schema change. | policies `20260412000005:149-150` and `20260412000008:12-13`; schema per `00-map.md` §0.4.1; the UI renders edit + delete on every row with no ownership test (`TransactionItem.tsx:136,143`; `TransactionList.tsx:37-40`) → **A-13** |
| **Remove a member?** | Creator only, `group_members` DELETE `USING (CRE)` (`…005:134-135`). But the app never issues a targeted delete — removal goes through `updateGroup`'s wipe-and-reinsert. | |
| **What happens when a NON-creator saves the group form?** | Step by step: (1) `updateGroup` issues `.from('groups').update(updateData).eq('id',groupId).select().single()` (`:337-342`). (2) `groups` UPDATE `USING (i_created_group(id))` matches **0 rows**; PostgREST returns an empty result and `.single()` turns that into **`PGRST116`**. (3) `if (groupError) throw new Error('Database error: …')` at `:344-347` — **the function throws before line 350**, so the `group_members` DELETE never runs. (4) `App.tsx:408-411` catches it and shows `toast.error('Failed to save group updates.')`. **Conclusion: membership is NOT destroyed, and a non-creator cannot change any group setting.** | `supabaseApiService.ts:326-373`; policy `…005:110-111` |
| — the same, **if the hotfix is live** | `groups_update_all USING(true) WITH CHECK(true)` makes step 2 succeed; `group_members_delete_all` / `group_members_insert_all` make `:350-369` succeed. **Any authenticated user then rewrites any group's entire membership in three calls.** | `migrations/HOTFIX_reset_all_policies.sql:31-62` → **A-02** |
| **Can a non-creator leave a group?** | **No.** `executeGroupSave(groupData, removingSelf=true)` (`App.tsx:377-412`) routes through the same `updateGroup` and fails at the `groups` UPDATE for exactly the reason above; the user gets "Failed to save group updates." The confirmation modal at `App.tsx:906` promises *"You will no longer have access to … or its transactions."* There is no other leave path in the codebase — every `group_members` delete is at `supabaseApiService.ts:12`, `:264` or `:350-353`, all creator-scoped or composite. **A non-creator is permanently stuck in every group they join**, and (via A-07) in every group anyone puts them in. → **A-14** |
| **Delete a group?** | Creator, `groups` DELETE `USING (CRE)`. The "all settled" precondition exists **only** in JS (`supabaseApiService.ts:10`) and as a disabled button (`GroupFormModal.tsx:253`). A creator with a modified client deletes an unsettled group and every balance in it. |
| **What does a member deleting all a group's transactions look like?** | One request: `DELETE /rest/v1/transactions?group_id=eq.<uuid>`, accepted by `USING (CRE OR MEM)`. No confirmation, no soft delete, no audit row, no backup, no restore path. The app already issues exactly this call at `:14` and `:265`. Every online client is then told, in full, via unfiltered DELETE events (A-22). → **A-13** |
| **Reverse a settlement?** | Any member can delete any `type:'settlement'` row — settlements are ordinary `transactions` rows (`SettleUpModal.tsx:166` → `addTransaction`) and nothing marks them immutable. |
| **Backdate?** | `date` is a plain `date` column with no CHECK and no server-clock comparison; the form is an unconstrained input. Any date, past or future. |
| **Change `created_by` (hand over / orphan the group)?** | `groups` UPDATE is `USING (i_created_group(id))` with **no `WITH CHECK`**, so the same expression is applied to the new row. `i_created_group` (`…005:38-57`) is `STABLE SECURITY DEFINER` and re-queries `groups`; a `STABLE` function sees the statement snapshot, i.e. the **old** `created_by`. The check therefore passes whatever the new value is. A creator can `PATCH /groups?id=eq.X {"created_by":"anything"}` — another user, a non-existent UUID, or `""`. **The group then has nobody satisfying `i_created_group`: it can never again be renamed, archived, unarchived or deleted, and its members can never be removed** (member INSERT still works; DELETE is creator-only). Confidence **LIKELY** — the snapshot reasoning is standard Postgres, but has not been executed. → **A-15** |
| **Archive / unarchive?** | Both are `groups` UPDATE → `USING (CRE)` → **creator only at the database**. But the UI shows "Archive Group" **only to non-creators** (`GroupFormModal.tsx:259-279`) and `archiveGroup` *throws* if you are the owner (`supabaseApiService.ts:23`). The two layers contradict: non-creators pass the JS gate and are rejected by RLS; creators are rejected by JS. **The archive feature is dead for everyone.** `unarchiveGroup` has **no JS gate at all** (`:2-6`) and no `.single()`, so for a non-creator it silently affects 0 rows while the client removes it from the list anyway (`ArchivedGroupsModal.tsx:51-52`) — the group reappears on reload. → **A-14** |

---

## 6. Invite & join flow

| Property | Finding | Evidence |
|---|---|---|
| **Token entropy** | `crypto.getRandomValues(new Uint8Array(24))` → base64url, `+`/`/` → `-`/`_`, `=` stripped → 32 chars, **192 bits**. Cryptographically fine. | `supabaseApiService.ts:930-938` |
| **Generated where** | **Client-side.** `generate_invite_token()` exists in SQL (`20251019:89-95`) and is never called. Not a weakness in itself, but it means token quality depends on the client, and a modified client picks its own token. `get_invite_preview` only rejects tokens shorter than 8 characters (`20260812000000:90`), and `accept_group_invite` likewise (`:185`). |
| **Storage** | **Plaintext** in `group_invites.invite_token`, returned by the SELECT policy to **every member of the group** (`20260812000000:298-300`). Acceptable — every member can mint their own link anyway (`:302-304`) — but it means one compromised member account yields every live link for that group. Also echoed verbatim to anon inside `get_invite_preview` (`:131`), which is redundant (you had to know it to ask) but pointless. |
| **Expiry** | 30 days, client-chosen (`expiresInDays = 30`, `supabaseApiService.ts:974`, `:990-991`); enforced server-side in both RPCs (`:104-107`, `:208-211`), which also self-deactivate the row on expiry. |
| **Single-use** | **No.** The UI hard-codes `maxUses: null` — the comment says "Unlimited uses" (`GroupFormModal.tsx:166`). `max_uses IS NULL` skips the cap in both RPCs (`:109`, `:213`). **Every link created through the app is an unlimited-use, 30-day bearer credential for group membership.** |
| **Does accept bind to the JWT?** | **Yes, correctly.** `accept_group_invite` resolves the person from `requesting_user_id()` (`20260812000000:189-196`) and ignores the client's `personId`. It takes `FOR UPDATE` on the invite row (`:202`), re-checks expiry and uses, inserts `(group_id, person_id)` itself (`:236-237`), and increments/deactivates atomically (`:239-247`). This is the one part of the auth surface that is properly built. |
| **Does the OLD path still exist?** | **Yes.** `apiService.addPersonToGroup` (`:43-73`) inserts into `group_members` with a **client-supplied `person_id`** — either the row returned by `find_person_by_email` (`:49-56`) or a freshly created placeholder (`:61-71`). The policy `"Members can insert group members" WITH CHECK (i_created_group(group_id) OR i_am_member_of(group_id))` (`20260812000000:334-336`) checks only **the caller's** membership. |
| **Assessment of that path** | **Any member of any group can add any `people.id` in the database to that group, without the added person's knowledge or consent.** For an *unclaimed* placeholder that is the intended feature. For a **claimed** row — a real signed-in user, located via `find_person_by_email` (A-03) — it means an attacker who knows a victim's email can, in two requests, place the victim inside a group the attacker controls. Consequences: the victim's group list gains an unknown group on their next realtime tick (`queries.ts:186-191` invalidates on their own INSERT event); the attacker now shares a group with the victim, so `i_can_see_person` (`20260728000000:47-55`) grants the attacker the victim's full `people` row *legitimately*; and the attacker can create expenses naming the victim as payer or participant, which land in the victim's real balances (`App.tsx:131-139`). The victim **cannot leave** (A-14). → **A-07** |
| **Can a removed user re-accept the same link?** | **Yes**, while the link is active — which by default is 30 days with unlimited uses. `accept_group_invite` has no concept of "was previously removed"; it checks only current membership (`:222-234`) and re-inserts. Removal (creator-only) is therefore not durable while any link lives, and `deactivateInvite` — the only way to kill a link — has **zero callers** (`supabaseApiService.ts:1209`), so there is no UI for it at all. → **A-29** |
| **Does accepting an invite for group X ever grant group Y?** | **No.** The insert is `VALUES (v_invite.group_id, v_person.id)` — the group comes from the invite row, never from the client (`20260812000000:236-237`). Clean. |
| **Email invites** | `createGroupInvite` inserts one `email_invites` row per address in a client-supplied array and fires `send-email` for each (`supabaseApiService.ts:1015-1064`). The array is unbounded and the addresses arbitrary; the only server checks are `email_invites` `WITH CHECK (CRE OR MEM)` (group scope) and `UNIQUE(group_id, email)` (`20251019:44`). The recipient never consented and there is no unsubscribe. **Rate limiting:** `send-email` is 20/min per user *per isolate* (`send-email/index.ts:63`); the `email_invites` INSERT has none; invite creation has none. Create a throwaway group, then loop `createGroupInvite({groupId, emails:[…]})` — mail leaves the app's verified MailerSend domain with attacker-controlled `inviterName`, `groupName` and **`inviteUrl`** (`send-email/index.ts:99-119`). → **A-08** |
| **Auto-accept on landing** | Two different behaviours. `InvitePage` (the signed-out path) auto-accepts **only** when the user's email matches a targeted `email_invites` entry (`InvitePage.tsx:108-121`) — deliberate and reasonable. But an **already-signed-in** user never reaches `InvitePage` (`App.tsx:1029` gates on `!user`); they hit `App.tsx:256-263`, which reads the token from the path **or from `localStorage`** and calls `handleInviteAcceptance` **unconditionally, with no confirmation UI**. A signed-in victim who merely opens a link — or opens the app after any page stored a `pendingInviteToken` — silently joins. On Android the same is reachable from any other installed app via `kharchbaant://invite/<token>` (`utils/nativeDeepLinks.ts:57-61`; `AndroidManifest.xml:29-34`). → **A-11** |

---

## 7. Database-level rules

Per the intended final state (`20260412000005` → `…06` → `…07` → `…08` → `20260728000000` → `20260812000000` → `20260813*`). **Whether production actually has that state is unknowable from the repo**: every file carries "Apply manually via Supabase dashboard SQL editor", there is no `schema_migrations` reference, and `supabase/config.toml` contains only an edge-function flag.

| Table | RLS enabled by | Policies (cmd → USING / WITH CHECK) |
|---|---|---|
| `people` | `20260728000000:12` | SELECT `TO authenticated USING (i_can_see_person(id))` · INSERT `WITH CHECK (clerk_user_id = requesting_user_id() OR (COALESCE(is_claimed,false)=false AND clerk_user_id IS NULL))` · UPDATE `USING (clerk_user_id = requesting_user_id())` · DELETE same (`:80-100`) |
| `groups` | `20260728000000:13` | SELECT `USING (created_by = sub OR i_am_member_of(id) OR EXISTS(people WHERE id::text=created_by AND clerk_user_id=sub))` · INSERT `WITH CHECK (created_by = sub OR EXISTS(…))` · UPDATE `USING (i_created_group(id))` · DELETE `USING (i_created_group(id))` (`…005:88-114`) |
| `group_members` | `20260728000000:14`, `20260812000000:281` | SELECT `USING (i_created_group(group_id) OR i_am_member_of(group_id))` (`…007:20-24`) · INSERT `TO authenticated WITH CHECK (i_created_group OR i_am_member_of)` (`20260812000000:334-336`) · DELETE `USING (i_created_group(group_id))` (`…005:134-135`) · **UPDATE: no policy anywhere → denied** |
| `transactions` | `20260728000000:15` | SELECT / INSERT / UPDATE `(i_created_group OR i_am_member_of)` (`…005:143-150`) · DELETE same (`…008:12-13`) |
| `payment_sources` | `20260728000000:16` | all four: `EXISTS(people WHERE id::text = payment_sources.user_id AND clerk_user_id = sub) OR payment_sources.user_id = sub` (`…005:164-186`) |
| `group_invites` | `20260728000000:17`, `20260812000000:279` | all four `TO authenticated`, `(i_created_group OR i_am_member_of)` (`:298-312`) |
| `email_invites` | `20260728000000:18`, `20260812000000:280` | all four `TO authenticated`, `(i_created_group OR i_am_member_of)` (`:314-328`) |
| `group_deletion_requests` | `20260728000000:19` | **ZERO POLICIES ANYWHERE IN THE REPO** → A-05 |
| `ai_item_cache` | `supabase-schema.sql:88`, re-asserted `20260728000000:20` | SELECT `USING (auth.role()='authenticated')` · INSERT `WITH CHECK (auth.role()='authenticated')` (`supabase-schema.sql:91-99`). No UPDATE/DELETE policy → rows immutable. |
| `user_profiles` | `supabase-auth-setup.sql:12` (Supabase-Auth era) | **Absent from `lib/database.types.ts`** → almost certainly never created in the live DB, or dropped by `CLERK_AUTH_MIGRATION.sql`. Nothing in the app references it. Nothing to report beyond its absence. |

### 7.1 Every rule that trusts a client-supplied column

| Column | Policy that trusts it | What a modified client can do |
|---|---|---|
| `groups.created_by` (INSERT) | `created_by = sub OR EXISTS(people WHERE id::text=created_by AND clerk_user_id=sub)` (`…005:100-108`) | Must resolve to self, so ownership cannot be forged at creation. But the column is **`TEXT` with no FK** (`00-map.md` §0.4.1) and deliberately accepts either a Clerk id or a person UUID — which is what makes A-15 possible on UPDATE. |
| `groups.created_by` (UPDATE) | **no distinct `WITH CHECK`** | set it to anything → orphan the group forever → **A-15** |
| `payment_sources.user_id` (INSERT) | `EXISTS(people WHERE id::text=user_id AND ME) OR user_id = sub` (`…005:170-174`) | Must resolve to self. Enforced. The app writes the person UUID (`supabaseApiService.ts:726`). |
| `people.clerk_user_id` / `is_claimed` (INSERT) | `ME OR (COALESCE(is_claimed,false)=false AND clerk_user_id IS NULL)` (`20260728000000:88-92`) | The second disjunct is an **unbounded placeholder factory**: any authenticated user can `POST /rest/v1/people` with `Prefer: return=minimal` (needed because `RETURNING` would fail the SELECT policy — the reason `create_unclaimed_person` exists at all, per `20260813010000:1-4`) and `{"name":"x","avatar_url":"","is_claimed":false}` in a loop. Storage is unbounded: `avatar_url` is `TEXT` holding base64 data URLs. Worse, they can set `email` to a **victim's address that has no account yet**; when the victim later signs up, `ensure_my_person` claims that very row (`20260813020000:35-49`) and the victim silently inherits whatever group memberships the attacker attached to it. → **A-06** |
| `group_members.person_id` (INSERT) | `WITH CHECK` names only `group_id` (`20260812000000:334-336`) | add anyone, without consent → **A-07** |
| `group_invites.invited_by` (INSERT) | not referenced by the policy | attribute an invite to any `people.id` (FK-checked only) → inviter impersonation on the public landing page |
| `email_invites.email` (INSERT) | not referenced | arbitrary recipients → **A-08** |
| `transactions.paid_by_id`, `.payers`, `.split_participants` | not referenced by any policy or CHECK | any person, in or out of the group → **A-16** |
| `group_deletion_requests.requested_by` | no policy at all | anything → **A-05** |
| RPC arg `p_email` in `ensure_my_person` / `claim_person_by_email` | never cross-checked against the JWT | claim any unclaimed identity → **A-01** |

### 7.2 Grants, and why they matter here

- `migrations/enable_realtime.sql:20-24` — `GRANT SELECT ON groups, transactions, payment_sources, people, group_members TO anon, authenticated;`
- `migrations/HOTFIX_reset_all_policies.sql:65-69` — `GRANT ALL ON groups, group_members, people, transactions, payment_sources TO authenticated;`

With RLS **on**, a grant alone leaks nothing — the policies still filter. The danger is the pairing. This repo also ships:

- `COMPLETE_RLS_FIX.sql:5-13` — disables RLS on **all seven** core tables, `group_invites` and `email_invites` included. **No danger banner.**
- `DATABASE_FIX_DISABLE_RLS.sql:11` — disables it on `people`. Has a banner (`:1-5`).
- `migrations/HOTFIX_disable_group_members_rls.sql` — as named.

If any of those was ever run and not reversed, `GRANT SELECT … TO anon` means **the anon key alone dumps the entire table** — no Clerk account needed. Neither file is referenced by any doc as "apply this", and `00-map.md` §0.6 classifies both as dead — but they are one copy-paste away from live, and the project's own history (seven `HOTFIX_*` files) shows that copy-paste is how this database is administered. → **A-24**

The tooling that is supposed to catch all of this is blind to it. `scripts/rls-beta-audit.sql:6-16` checks `rowsecurity` for **seven** tables, omitting `group_deletion_requests` and `ai_item_cache`; its policy check (`:19-27`) greps only `%allow all%`, which matches **none** of the eight `*_all` hotfix policy names; and its `people` check (`:28-41`) would correctly FAIL on a `USING (true)` policy but there is no equivalent check for `groups` or `group_members`.

---

## 8. Privileged key exposure

Grep of the whole working tree (`node_modules` is absent). **Git history is unavailable — there is no `.git` directory — so nothing can be said about secrets that were committed and later removed.** That is coverage gap CG-4 and it is not a small one for a repo whose deploy script was `git add -A && git commit -m "chore: deploy latest changes" && git push` (`00-map.md` §0.2).

| Pattern | Hits in the tree | Verdict |
|---|---|---|
| `service_role`, `SUPABASE_SERVICE_ROLE` | 6, **all documentation or warnings**: `.env.example:26`, `AGENTS.md:450`, `docs/security-phase-a.md:95`, `LOCAL_SETUP.md:47,128`, `SUPABASE_SETUP.md:23` | **No service-role key in the tree.** |
| `sk_live` / `sk_test` | 6, all placeholder text in deploy docs and function headers | clean |
| `eyJ…` (JWT-shaped, ≥10 chars) | **0** | clean — no anon key, no JWT literal committed |
| `mlsn.` | 7, all placeholders. `MAILERSEND_QUICK_START.md:21` still documents a `VITE_MAILERSEND_API_KEY` pattern that Phase A removed — stale, not a leak. | clean |
| `AIza` | 3, all placeholders in deploy docs | clean |
| `pk_live` / `pk_test` | ~20, all placeholders/docs, plus the literal `'pk_live_test'` in `src/test/services/nativeAuthBridge.test.ts:26,119` | clean, and publishable keys are public by design |
| Sentry DSN | **hardcoded**, `index.tsx:20` | Not a secret (a DSN is write-only ingest and ships in every browser bundle). Flagged for two other reasons — see below. → **A-20** |
| `.env` files | only `.env.example`, `.env.test.example`. `.gitignore` covers `.env` and `.env.test`. | clean |
| `android/keystore.properties` | **absent** — only `keystore.properties.example`. `.gitignore` covers `android/keystore.properties`, `*.jks`, `*.keystore`, `*.apk`, `*.aab`. | clean |
| `google-services.json` | **absent** (`android/app/build.gradle:87-94` tolerates its absence) | clean |
| `android/local.properties` | **absent**, gitignored | clean |
| Google Play service-account JSON | **absent**; injected at CI time as `secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (`.github/workflows/android-ci.yml:102`) | clean |
| `android/app/build.gradle:26-27` | `resValue "string","clerk_publishable_key", System.getenv("VITE_CLERK_PUBLISHABLE_KEY")` | **Fine.** Publishable keys are public; baking it into `strings.xml` is the documented pattern for `clerk-android`. |
| CI secrets list | `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (`android-ci.yml:30-48`); `KEYSTORE_FILE` base64-decoded to `android/app/release-key.jks` (`:70`); `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` (`:80-82`); `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (`:102`) | Correctly externalised. Note that the release signing key and the Play publishing identity are both reachable by anyone who can merge a change to `.github/workflows/` — a supply-chain concern for a later pass, not an auth finding. |

**Is there any client-bypass capability in the repo? No.** No service-role key, no admin JWT, no privileged endpoint. The complete client capability is:

> the **public anon key** (present in every JS bundle and every APK) **+** a **valid Clerk session JWT**

Everything an attacker can do is therefore exactly what RLS permits for `authenticated`. That is why every hole in §2 and §7 is directly reachable with `curl`, and why **the correctness of the policy set is the entire security posture**. There is no second line of defence anywhere in this system — no application server to re-check, no WAF rule, no per-endpoint authorization layer.

Two consequences worth stating explicitly:

1. `vercel.json:32-60` sets HSTS, `nosniff`, frame-deny, referrer and permissions-policy but **no Content-Security-Policy** (acknowledged and rationalised at `ARCHITECTURE.md:503`). Given that a single XSS yields a Clerk session JWT, which A-10 upgrades into a durable session, the missing CSP is load-bearing here in a way it would not be behind an application server. → **A-25**
2. `index.tsx:19-30` runs Sentry with `sendDefaultPii: true`, `replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`, plus `Sentry.setUser({id, email, username})` (`App.tsx:58-64`). Session Replay records the DOM and network metadata of authenticated sessions. Combined with the never-cleared query cache (§1.4), a replay captured after an error contains other people's names, group names and expense amounts, stored in a third-party system, keyed to an identified user. `Authorization` headers are redacted by Sentry's defaults, but `sendDefaultPii: true` explicitly opts into sending more. Nothing in the repo configures `beforeSend`, `maskAllText` or `blockAllMedia`. → **A-20**

---

## 9. Client-only gating inventory

Every UI affordance that hides or disables an action while the underlying endpoint stays open.

| UI element | Client gate | The endpoint's real check | Where | Gap |
|---|---|---|---|---|
| "Delete Group" | `disabled={!allSettled \|\| isProcessingGroupAction}`; rendered only when `group.createdBy === currentUserId` | `groups` DELETE `USING (i_created_group(id))` — **settlement is not checked in SQL** | `GroupFormModal.tsx:249-258`; policy `…005:113-114` | a creator deletes an unsettled group with one HTTP DELETE |
| `deleteGroup()` JS guards | `if (!isOwner) throw`, `if (!allSettled) throw` — on **client-computed booleans** derived from the cached transaction list (`App.tsx:138-139`) | as above | `supabaseApiService.ts:8-10`; call site `App.tsx:546` | both bypassed by calling PostgREST directly |
| "Request Delete (ask admin)" | shown only to non-creators, `disabled={!allSettled}` | `group_deletion_requests` INSERT — **no policy exists** | `GroupFormModal.tsx:259-269`; `supabaseApiService.ts:220-242` | A-05 |
| "Archive Group" | shown only to non-creators, `disabled={!userSettled \|\| !allSettled}` | `groups` UPDATE `USING (CRE)` → **rejects exactly the users the UI offers it to** | `GroupFormModal.tsx:270-279`; `supabaseApiService.ts:22-31` | A-14 — feature dead in both directions |
| "Unarchive" | **no gate whatsoever** | `groups` UPDATE `USING (CRE)`; the call has no `.single()`, so 0 rows ≠ error | `ArchivedGroupsModal.tsx:45-61`; `supabaseApiService.ts:2-6` | silent failure for non-creators; the row vanishes locally and returns on reload |
| "Remove member" (× on a chip) | `if (personId === currentUserId) return;` — blocks removing **yourself** only | no targeted remove endpoint exists; membership changes ride `updateGroup`'s wipe-and-reinsert, gated by `groups` UPDATE `USING (CRE)` | `GroupFormModal.tsx:115-118` | non-creators' saves fail wholesale (A-14); with the hotfix they succeed wholesale (A-02) |
| Deletion-request approve / reject | list is filtered by `req.groups?.created_by === userId` **in JavaScript** | approve: `groups` DELETE `USING(CRE)` catches a non-creator — but the `transactions` DELETE at `:265` runs **first** and is `CRE OR MEM`, so it succeeds. reject: **no check at all** | `AdminDeletionRequestsPanel.tsx:37,63,79`; `supabaseApiService.ts:280-324` | A-05, A-12, A-13 |
| Transaction edit / delete buttons | **none** — rendered on every row for every member | `USING (CRE OR MEM)` — the UI and the DB agree | `TransactionItem.tsx:136,143`; `TransactionDetailModal.tsx:161-172` | not a *gap*; it is the **role gap** A-13 — no per-row ownership exists at either layer, and `transactions` has no `created_by` to build one on |
| Payment-source delete | `usageCounts` is displayed but **never used to disable** the button; `App.tsx:521` comments "For now we allow deletion even if referenced" | `payment_sources` DELETE scoped to owner (correct); the FK from `transactions.payment_source_id` then rejects it and the user sees a generic toast (`App.tsx:529`) | `PaymentSourceManageModal.tsx:93,118`; `App.tsx:517-533` | correctly authorised; poor UX only |
| Avatar upload | `if (file.size > 100 * 1024)` — **client-only**; no server limit, no MIME check | `people` UPDATE `USING (ME)`; `avatar_url` is unbounded `TEXT`, no Supabase Storage, no size CHECK | `SettingsModal.tsx:74-77`, `:85`; `supabaseApiService.ts:1232-1243` | an owner can store an arbitrarily large base64 blob in their own row, which is then shipped to every co-member on every `getPeople` and every realtime `people` event |
| "Export Data" | requires `currentUserPerson` | server-side it is just `getGroups` + `getTransactions` under RLS | `SettingsModal.tsx:121-155`; `DataExport.tsx:12-18` | **exports exactly what RLS allows** — every group the user belongs to, every transaction in them, plus their own id/name/email — to an unencrypted JSON file. Correctly scoped; the toast even says "keep this file private". Not a gap; recorded because it was asked. |
| "Import Data" | `toast.success('Importing from …')` — **a no-op stub** | none | `SettingsModal.tsx:156` | dead UI that claims to have done something |
| "Reset All App Data" | `toast.success('App data reset!')` — **a no-op stub** | none | `SettingsModal.tsx:305-308`; `DangerZone.tsx:11-17` | dead destructive-looking UI |
| "Delete Account" | confirm modal → `anonymize_my_account()` → `clerkUser.delete()` with the failure **swallowed** (`:171-173`) | RPC scoped to the JWT sub — correct | `SettingsModal.tsx:160-181` | the Clerk deletion can silently fail (it needs a dashboard setting), leaving a live Clerk account whose `people` row is anonymised — and whose `clerk_user_id` is now `NULL`, which is precisely step 1 of the A-01 exploit |
| Add-member "already in group" | `existingPeople.some(p => p.id === matchedPerson.id)` in JS | `UNIQUE(group_id, person_id)` on `group_members` | `MemberInviteModal.tsx:60-64` | backed by a constraint — fine |
| `createGroupInvite` membership pre-check | `.select('id').eq(...).single(); if (!membership) throw` | `group_invites` INSERT `WITH CHECK (CRE OR MEM)` | `supabaseApiService.ts:977-986` | backed by RLS — fine |

---

## 10. Findings

Severity: **P0** = exploitable now with real consequence (auth bypass, cross-tenant read/write, money corruption, secret exposure). **P1** = will bite under normal use. **P2** = real debt with cost. **P3** = hygiene.

Base URL below is written `$SB = https://<ref>.supabase.co`, `$ANON` = the public anon key, `$JWT` = a Clerk session JWT for the attacker's own account (obtainable from devtools on any signed-in session of the app).

---

### [P0-A-01] Identity-claim RPCs trust a client-supplied email, so any user can claim any unclaimed person
Severity: P0 · Confidence: LIKELY · Area: RPC / identity
Location: `supabase/migrations/20260812000000_phase_b_claim_invites_security.sql:12-53` (`claim_person_by_email`), `supabase/migrations/20260813020000_ensure_my_person.sql:34-49` (`ensure_my_person` claim branch), `supabase/migrations/20260813000000_anonymize_my_account.sql:28-39` (`anonymize_my_account` nulls `clerk_user_id`), call sites `services/supabaseApiService.ts:846-882`
What is wrong: Both RPCs take the identity-defining email as a plain argument and never compare it to anything in the JWT. Phase B hardened `claim_person_by_email` so the *Clerk id* must equal `requesting_user_id()` (`:29-34`) but left `p_email` completely unverified, then does `UPDATE people SET clerk_user_id = <caller>, is_claimed = TRUE WHERE email = lower(trim(p_email)) AND is_claimed = FALSE`. `ensure_my_person` does the same at `:35-49`. `requesting_user_id()` reads only `sub`; **no email claim is ever consulted**, so an authenticated caller can take over any unclaimed `people` row whose email they know, inheriting all of that row's `group_members` rows and appearing to co-members as that person.
How to reproduce:
1. Find a target. `curl -s $SB/rest/v1/rpc/find_person_by_email -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"p_email":"victim@example.com"}'` — the response includes `is_claimed`. Any row with `is_claimed:false` is a target (A-03 makes this step trivial for a whole email list).
2. Free the attacker's own `clerk_user_id` (needed because `people.clerk_user_id` is `UNIQUE`, `migrations/20250101_add_clerk_user_id_to_people.sql:7`): `curl -s $SB/rest/v1/rpc/anonymize_my_account -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -d '{}'`.
3. Claim: `curl -s $SB/rest/v1/rpc/claim_person_by_email -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"p_email":"victim@example.com","p_clerk_id":null,"p_name":"Whatever"}'` — returns the claimed row.
   (Equivalent one-shot on a brand-new Clerk account that has not yet run `ensure_my_person`: skip step 2.)
4. Reload the app. The attacker is now inside every group the placeholder belonged to, with full read/write on their expenses.
Blast radius: Every unclaimed `people` row — which is every person ever added by name/email who has not yet signed up, i.e. the majority of rows in a placeholder-first product. Cross-tenant read **and** write of financial data. **Silent**: no email, no notification, no audit row; the victim signs up later and gets a fresh row, never learning their placeholder was hijacked.
Why it exists: The claim design predates the JWT-based hardening; Phase B fixed the Clerk-id half of the argument list and missed that the email is the actual identity assertion.
Containment (minutes): `REVOKE EXECUTE ON FUNCTION claim_person_by_email(TEXT,TEXT,TEXT) FROM authenticated;` — the app only calls it on a fallback path that fires when `ensure_my_person` fails (`supabaseApiService.ts:870-882`). Then patch `ensure_my_person` to ignore `p_email` for the claim branch (keep it for the insert branch) — one `IF` removed.
Correct fix: Take the email from the token, not the argument. Configure Clerk to include a verified `email` claim in the Supabase session token, and inside both functions use `current_setting('request.jwt.claims',true)::jsonb->>'email'` for the `WHERE email = …` match, ignoring `p_email` entirely (keep the parameter for wire compatibility, reject on mismatch as `:29-34` already does for the clerk id). Design decision to make explicitly: *claiming a placeholder by email is an account-linking operation and must require a proof of email control* — either a verified-email claim in the JWT, or an emailed confirmation link.
Proof of fix: With a JWT whose `email` claim is `attacker@x.com`, `claim_person_by_email('victim@example.com', …)` must raise `42501` and leave `people.clerk_user_id` for the victim row `NULL`. Assert both.
Depends on / conflicts with: A-03 (makes target discovery free), A-06 (lets the attacker *create* the placeholder to be claimed), A-07 (lets the attacker place the claimed row in their own group first).

---

### [P0-A-02] `HOTFIX_reset_all_policies.sql` creates eight `USING(true)` policies that nothing in the repo drops
Severity: P0 · Confidence: LIKELY · Area: RLS
Location: `migrations/HOTFIX_reset_all_policies.sql:21-62` (the eight policies), `:65-69` (the grants); non-removal: `supabase/migrations/20260728000000_phase_a_rls_people_visibility.sql:23-27`; blind detector: `scripts/rls-beta-audit.sql:19-27`
What is wrong: The file creates `groups_select_all`, `groups_insert_all`, `groups_update_all`, `groups_delete_all`, `group_members_select_all`, `group_members_insert_all`, `group_members_update_all`, `group_members_delete_all`, all `TO authenticated USING (true)` / `WITH CHECK (true)`. Postgres PERMISSIVE policies are **OR'ed**, so if these exist alongside the Clerk policies, any authenticated user passes every check on `groups` and `group_members`. No file in the repo drops them: Phase A drops only policies literally named `"Allow all operations"` (`:23-27`), and `20260412000003:23-35`'s catch-all `DROP` loop predates the hotfix in filename order but there is no applied-state tracking, so ordering proves nothing. Whether the hotfix is live in production **cannot be determined from the repo** — hence LIKELY, not CONFIRMED.
How to reproduce (this is also the verification query):
```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND policyname LIKE '%\_all'
ORDER BY tablename, policyname;
```
Any row returned ⇒ the boundary on that table is gone. Behavioural check with a second account: `curl "$SB/rest/v1/groups?select=id,name" -H "apikey: $ANON" -H "Authorization: Bearer $JWT_of_user_with_zero_groups"` — a non-empty array proves `groups_select_all` is live.
Blast radius: **Total.** Every group, every member list, every group rename/delete, and — because `group_members` INSERT becomes unconditional — read access to every group's transactions by simply adding yourself. Silent.
Why it exists: A production outage was fixed by disabling authorization ("NUCLEAR OPTION … we can add security back", `:1-4`) and the follow-up hardening was written against a different set of policy names.
Containment (minutes): `DROP POLICY IF EXISTS groups_select_all ON groups;` × 8 for the exact names above. Zero functional impact if they were never applied.
Correct fix: Ship the drops as a real migration, and adopt an applied-state mechanism (Supabase CLI migrations, or at minimum a `schema_migrations` table the dashboard scripts write to) so "which SQL is live" stops being unknowable. Then make `scripts/rls-beta-audit.sql` assert the **exact expected policy set** per table rather than grepping for one legacy name.
Proof of fix: `pg_policies` for `groups` and `group_members` contains exactly the four/three expected Clerk policies and nothing else; the audit script's own query returns zero rows for `qual = 'true'` on those tables.
Depends on / conflicts with: A-05 (same root cause: unknown applied state), A-14 (its outcome flips entirely depending on this), A-24.

---

### [P0-A-03] `find_person_by_email` returns the full `people` row for any email to any authenticated user
Severity: P0 · Confidence: CONFIRMED · Area: RPC / data exposure
Location: `supabase/migrations/20260728000000_phase_a_rls_people_visibility.sql:103-117`, grant at `:117`, re-granted `20260812000000:59-70`; client `services/supabaseApiService.ts:833-843`; UI `components/MemberInviteModal.tsx:39-49`
What is wrong: `RETURNS SETOF people … SECURITY DEFINER … SELECT * FROM people WHERE lower(trim(email)) = lower(trim(p_email)) LIMIT 1`. `SECURITY DEFINER` bypasses the `i_can_see_person` SELECT policy and `SELECT *` returns every column: `id`, `name`, `avatar_url` (the person's real photo as a base64 data URL), `email`, **`clerk_user_id`** (the RLS subject itself), `user_id`, `auth_user_id`, **`is_claimed`**, `source`, timestamps. There is no rate limit on RPC (§1.8), so it is a bulk oracle: feed it an email list and get back which addresses have accounts here, each with a real name, a photo, and the flag that tells you whether the row is claimable via A-01.
How to reproduce:
```bash
for e in $(cat emails.txt); do
  curl -s "$SB/rest/v1/rpc/find_person_by_email" \
    -H "apikey: $ANON" -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' -d "{\"p_email\":\"$e\"}"
done
```
Blast radius: Every user in the system, for any attacker with one account and an email list. Leaks PII (name, photo, email confirmation) and the internal identity keys. Silent — the RPC logs nothing the user sees.
Why it exists: It was introduced as the *fix* for an open `people` SELECT ("email lookup for invite … no full table dump", `:102`). It replaced a broad leak with a targeted one that is strictly more useful to an attacker who has a list of addresses.
Containment (minutes): Change `SELECT *` to `SELECT id, name, avatar_url, is_claimed` — better, `SELECT id, name` — and add `RETURNS TABLE(...)` instead of `SETOF people`. That alone removes `clerk_user_id` and `email` echo-back.
Correct fix: The UI needs one bit ("does this email already have a person?") plus a display name to confirm the match. Return `jsonb_build_object('found', bool, 'id', …, 'name', …)` and nothing else; drop `is_claimed` from the response (it is the attacker's targeting signal and the UI at `MemberInviteModal.tsx:139` only uses it to style a badge). Add a per-caller lookup budget — a `people_lookup_log` table with a `COUNT(*) WHERE requester = requesting_user_id() AND created_at > now() - interval '1 hour'` guard inside the function is ~8 lines and is the only rate limit that can exist in this architecture. Separately, fix `i_can_see_person`'s unbounded "active inviter" disjunct (`:66-71`), which leaks the same rows a different way (§4).
Proof of fix: A response for an email belonging to a user you share no group with contains no `email`, no `clerk_user_id`, no `avatar_url`; and the 51st lookup in an hour returns an error.
Depends on / conflicts with: A-01 (this is its reconnaissance step), A-07 (this supplies the `person_id` to add).

---

### [P0-A-04] The `tx` broadcast rides a public (non-private) Realtime channel — anyone with the anon key can read and write it
Severity: P0 · Confidence: LIKELY · Area: Realtime
Location: `services/supabaseApiService.ts:479-487` (publisher), `:404-430` (subscriber, broadcast listener at `:422-426`), `services/queries.ts:107-109` (the handler), channel names `:410` / `:483`
What is wrong: Both ends call `supabase.channel('public:transactions')` with no `config`, so `private` defaults to `false`. Supabase's authorization docs state that RLS on `realtime.messages` is only enforced for private channels; without `private: true` the topic is open to anyone holding the anon key, which is public by construction. `_broadcastTxChange(groupId)` fires on every transaction insert (`:565`), update (`:658`) and delete (`:694`), publishing `{groupId}`. `grep -rn "private: true"` over the repo returns nothing.
How to reproduce (read):
```js
const sb = createClient(SUPABASE_URL, ANON_KEY)   // no user JWT at all
sb.channel('public:transactions')
  .on('broadcast', { event: 'tx' }, p => console.log(p.payload))  // {groupId} for every write, system-wide
  .subscribe()
```
(write): the same client, `ch.send({type:'broadcast', event:'tx', payload:{groupId:'x'}})` in a loop. Every online client runs `qc.invalidateQueries(qk.transactions(personId))`, and `getTransactions` is a two-round-trip **unpaginated** fetch of every transaction in every group that user belongs to (`:490-535`).
Blast radius: Read — a live, global, unauthenticated activity feed: every group UUID in the product, write volume, and timing. Combined with A-27 the attacker can then test which of those groups they can reach. Write — an unauthenticated DoS amplifier that turns every connected client into a load generator against the project's own PostgREST, at whatever rate the attacker chooses.
Why it exists: The broadcast was added to work around `postgres_changes` RLS filtering ("bypasses postgres_changes RLS filtering", comment at `:564`) — i.e. it was deliberately built as the channel that *does not* apply authorization, and nobody set `private: true` afterwards.
Containment (minutes): Add `{ config: { private: true } }` to both `supabase.channel('public:transactions')` calls and create an RLS policy on `realtime.messages` restricting the topic to authenticated users. If the immediate concern is only the write amplifier, the smaller change is to make the broadcast handler in `queries.ts:107-109` ignore payloads whose `groupId` is not in the client's current group list — that removes the amplification without touching the transport.
Correct fix: Private channel **per group** (`group:<uuid>`) with a `realtime.messages` policy of `i_am_member_of(<topic uuid>)`, so the topic itself carries the authorization. That also fixes the read leak, which the per-client filter does not. Design decision: decide whether the broadcast is still needed at all now that `postgres_changes` INSERT/UPDATE is RLS-filtered correctly — it exists only to paper over the DELETE case, which A-22 shows is filtered in the *wrong direction*.
Proof of fix: An anon client subscribing to the topic receives `CHANNEL_ERROR`; a member's client still sees its own group's events; a non-member's client sees nothing for that group.
Depends on / conflicts with: A-22 (same subsystem, opposite failure), A-27.

---

### [P1-A-05] `group_deletion_requests` has RLS enabled and zero policies; the whole approval workflow is enforced in JavaScript
Severity: P1 · Confidence: CONFIRMED (repo state) / LIKELY (live impact) · Area: RLS / workflow
Location: `supabase/migrations/20260728000000_phase_a_rls_people_visibility.sql:19` (enables RLS), table DDL `migrations/20251116_group_admin_and_deletion_requests.sql:8-19`, client `services/supabaseApiService.ts:220-324`, UI `components/AdminDeletionRequestsPanel.tsx:37,63,79`
What is wrong: RLS is turned on and **no policy is created for this table in any SQL file in the repo**. Postgres then denies every operation. Either (a) that is the live state and the entire deletion-request feature is dead — `requestGroupDeletion` throws, the admin panel always shows "No pending deletion requests" — or (b) the `ALTER TABLE` was never applied and the table is fully open to any authenticated user. Both are wrong and the repo cannot say which is live. Independently of that: `requestGroupDeletion` takes `requestedBy` as a client argument (`:237`); `approveGroupDeletion`'s creator check is `group.created_by !== approverId` in JS on client-fetched data (`:260`); `rejectGroupDeletion` has **no check at all** (`:317-324`); `getPendingDeletionRequests` fetches *all* pending rows and filters by creator in JS (`:294`).
How to reproduce: `SELECT relrowsecurity FROM pg_class WHERE relname='group_deletion_requests';` and `SELECT count(*) FROM pg_policies WHERE tablename='group_deletion_requests';`. If security is on and the count is 0, the feature is dead. If security is off, then as any authenticated user: `curl "$SB/rest/v1/group_deletion_requests?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $JWT"` returns every request in the system, and `PATCH …?id=eq.<uuid>` with `{"status":"rejected"}` succeeds against any group.
Blast radius: If open — read of every group's deletion state plus the ability to forge and to reject requests for groups you have nothing to do with. If closed — a shipped, advertised feature that silently never works, and the "Request Delete (ask admin)" button reports success (`App.tsx:553`) while nothing is stored.
Why it exists: The table was added in `migrations/` (the old, unmaintained directory) with no policies; Phase A's blanket `ALTER TABLE IF EXISTS … ENABLE ROW LEVEL SECURITY` swept it in without anyone writing policies for it.
Containment (minutes): Determine which state is live (the query above), then either write the four policies or drop the UI. Nothing in between is safe.
Correct fix: Three policies — SELECT `USING (i_created_group(group_id) OR requested_by IN (SELECT id FROM people WHERE clerk_user_id = requesting_user_id()))`; INSERT `WITH CHECK (i_am_member_of(group_id) AND requested_by = (SELECT id FROM people WHERE clerk_user_id = requesting_user_id()))` (this also removes the client-supplied `requested_by`); UPDATE `USING (i_created_group(group_id))` for approve/reject. Then delete the JS creator check at `:260` and the JS filter at `:294`, which will no longer be doing anything.
Proof of fix: A non-creator's `PATCH` to a request for someone else's group returns 0 rows; `getPendingDeletionRequests` returns only rows the caller can act on **before** the JS filter runs (compare the raw response length to the filtered length — they must be equal).
Depends on / conflicts with: A-02 (same root cause: unknown applied state), A-12, A-13.

---

### [P1-A-06] `people` INSERT lets any user create unlimited placeholders with attacker-chosen emails
Severity: P1 · Confidence: CONFIRMED (policy) / LIKELY (the pre-registration hijack) · Area: RLS
Location: `supabase/migrations/20260728000000_phase_a_rls_people_visibility.sql:88-92`, claim path `supabase/migrations/20260813020000_ensure_my_person.sql:35-49`, RPC front door `supabase/migrations/20260813010000_create_unclaimed_person.sql`
What is wrong: `WITH CHECK (clerk_user_id = requesting_user_id() OR (COALESCE(is_claimed,false)=false AND clerk_user_id IS NULL))` — the second disjunct places **no bound at all** on how many rows a caller creates, what names or emails they carry, or how large `avatar_url` (unbounded `TEXT`) is. Two harms. (1) Storage/enumeration abuse: an unbounded write primitive with no rate limit anywhere (§1.8). (2) **Pre-registration identity seeding**: create a placeholder with a victim's email who has no account yet, add it to your group (A-07), and wait. When the victim signs up, `ensure_my_person` claims that exact row by email (`20260813020000:44`) — the victim's real account is bound to a `people` row the attacker prepared and pre-placed, and they land inside the attacker's group with their real name and email now visible to the attacker.
How to reproduce: `curl -X POST "$SB/rest/v1/people" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"name":"x","avatar_url":"","is_claimed":false,"email":"victim@example.com"}'` — repeat in a loop for the volume case. (`Prefer: return=minimal` is required because `RETURNING` fails the `people` SELECT policy — that is exactly why `create_unclaimed_person` exists, per its own header comment.) Then `POST /rest/v1/group_members {"group_id":"<attacker group>","person_id":"<new id>"}`. Then have the victim sign up.
Blast radius: Every email address that does not yet have an account — i.e. every prospective user. Silent to the victim, who has no way to see that their row was pre-created.
Why it exists: Placeholder people are a core product feature and the policy was written to permit them, with no thought given to who may create one or how many.
Containment (minutes): Revoke direct `INSERT` on `people` from `authenticated` and force all creation through `create_unclaimed_person` (the app already uses only that path — `supabaseApiService.ts:817-831`); that at least gives one chokepoint to add a counter to.
Correct fix: Drop the second disjunct from the policy entirely (self-insert only), and put the placeholder path exclusively in `create_unclaimed_person` with (a) a per-caller creation budget, (b) a rule that a placeholder with an `email` may only be created by a caller who is simultaneously adding it to a group they belong to, and (c) a length cap on `avatar_url`. Then close the claim side: `ensure_my_person` must only claim a placeholder when the JWT's verified email matches (see A-01) — with that fix, seeding a placeholder for `victim@example.com` still works but claiming it becomes proof-of-control, which is the intended behaviour.
Proof of fix: A direct `POST /rest/v1/people` with `is_claimed:false` returns `42501`; the 21st `create_unclaimed_person` call in an hour is rejected; a seeded placeholder is still claimed correctly by the genuine owner on sign-up.
Depends on / conflicts with: A-01 (shares the claim-side root cause), A-07 (the seeding step), A-17.

---

### [P1-A-07] Any group member can add any person in the database to that group, without consent
Severity: P1 · Confidence: CONFIRMED · Area: RLS / membership
Location: `supabase/migrations/20260812000000_phase_b_claim_invites_security.sql:334-336` (the policy), `services/apiService.ts:43-73` (`addPersonToGroup`), UI `components/MemberInviteModal.tsx:69-83`
What is wrong: `CREATE POLICY "Members can insert group members" … WITH CHECK (i_created_group(group_id) OR i_am_member_of(group_id))` constrains only **the caller's** relationship to the group. `person_id` is entirely unconstrained: any UUID in `people`, claimed or not. `addPersonToGroup` supplies it directly from `find_person_by_email`'s result (`:49-56`). Combined with A-03, an attacker who knows a victim's email needs two HTTP calls to put a real, signed-in user inside a group the attacker controls. The victim is not notified, and (per A-14) **cannot leave**.
How to reproduce:
```bash
PID=$(curl -s "$SB/rest/v1/rpc/find_person_by_email" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" \
      -H 'Content-Type: application/json' -d '{"p_email":"victim@example.com"}' | jq -r '.[0].id')
curl -X POST "$SB/rest/v1/group_members" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" \
     -H 'Content-Type: application/json' -H 'Prefer: return=minimal' \
     -d "{\"group_id\":\"<attacker group>\",\"person_id\":\"$PID\"}"
```
Blast radius: Any user whose email is known. Consequences compound: the attacker now legitimately passes `i_can_see_person` for the victim (`20260728000000:47-55`) and reads their full row; the attacker can create expenses naming the victim as payer or participant (A-16) which appear in the victim's real balance calculations (`App.tsx:131-139`); the victim's group list gains an unknown group; and the group is unremovable from the victim's side.
Why it exists: Phase B relaxed the policy from creator-only (`…005:131-132`) to member-or-creator so that ordinary members could add people, and the relaxation was applied to the wrong half of the relationship.
Containment (minutes): Revert the policy's `WITH CHECK` to also require that the added person is not a claimed account: `AND EXISTS (SELECT 1 FROM people p WHERE p.id = person_id AND COALESCE(p.is_claimed,false) = false)`. Claimed users then join only through `accept_group_invite`, which is already correct. Placeholder-adding, the actual feature, keeps working.
Correct fix: The containment *is* the correct fix for the direct-add path, plus: make leaving a group possible (A-14) so consent has an exit, and consider an "invited, pending acceptance" state for claimed users rather than immediate membership.
Proof of fix: Inserting a `group_members` row whose `person_id` belongs to a claimed account returns `42501`; adding a placeholder still succeeds; joining via an invite link still succeeds.
Depends on / conflicts with: A-03 (discovery), A-06 (the placeholder variant), A-14 (no exit), A-16.

---

### [P1-A-08] `send-email` is an authenticated open relay from the app's verified sending domain
Severity: P1 · Confidence: CONFIRMED · Area: Edge Function
Location: `supabase/functions/send-email/index.ts:57-65` (the only gate), `:84-97` welcome, `:99-120` group_invite, `:122-140` member_added, `:142-195` settle_up, `:197-226` new_expense; rate limit `supabase/functions/_shared/auth.ts:44-59`; unauthenticated caller path via `services/emailService.ts:80-109`
What is wrong: The only authorization is `requireAuthSub` — *any* valid Clerk JWT. No handler receives a `group_id`, a transaction id, or anything else that could be checked against the caller's memberships, so **no authorization decision is possible in this function as written**. Every recipient address and every display string (`inviterName`, `groupName`, **`inviteUrl`**, `addedByName`, `groupUrl`, `payerName`, amounts) comes straight from the request body. `new_expense` accepts 25 recipients per call (`:39`, `:202`); `settle_up` sends two messages per call (`:177-185`). Content is HTML-escaped (`:30-37`) so markup injection is blocked, but the *link target* is attacker-chosen and the message arrives from the product's own authenticated domain — which is precisely what makes it a good phishing carrier.
How to reproduce:
```bash
curl -X POST "$SB/functions/v1/send-email" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"type":"group_invite","data":{"inviteeEmail":"target@example.com","inviterName":"Accounts Team","groupName":"Payment Verification Required","inviteUrl":"https://evil.example/","expiresInDays":1}}'
```
Blast radius: Anyone with an email address. Damage is to the sending domain's reputation (MailerSend suspension, SPF/DKIM domain blacklisting) and to recipients who trust the sender. The four handlers other than `group_invite` are not reachable from the UI at all (`services/emailService.ts:115-136` are exported but uncalled) — **dead client code does not close a live server endpoint**.
Why it exists: The function was designed as a thin MailerSend proxy for a trusted caller; when the caller became "the browser", the trust assumption was not revisited.
Containment (minutes): Delete the `welcome`, `member_added`, `settle_up` and `new_expense` cases (`:84-97`, `:122-140`, `:142-195`, `:197-226`) — nothing calls them. That removes four of five abuse paths in a ~110-line deletion.
Correct fix: For the one surviving type, take a `groupInviteId` instead of free-form content: the function then reads `group_invites` + `groups` + `people` + `email_invites` **server-side** with a service-role client, verifies the caller's `sub` maps to a member of that group, and composes the message from database values only. The client supplies an id, never a recipient or a URL. Add a real rate limit (a Postgres counter table, since the in-isolate `Map` is not one) and set `ALLOWED_ORIGINS`.
Proof of fix: A request with a `type` other than `group_invite` returns 400; a `group_invite` request for a `groupInviteId` the caller is not a member of returns 403; the sent message's link is the canonical `/invite/<token>` URL regardless of what the client sent.
Depends on / conflicts with: A-17 (the fake rate limit), A-29.

---

### [P1-A-09] `get_invite_preview` hands anonymous callers the group profile and every invited email address
Severity: P1 · Confidence: CONFIRMED · Area: RPC / data exposure
Location: `supabase/migrations/20260812000000_phase_b_claim_invites_security.sql:120-124` (email aggregation), `:126-157` (the return object), `:161` (`GRANT … TO anon`); client `services/supabaseApiService.ts:1077-1138`; render `components/invite/InvitePage.tsx:79`
What is wrong: One unauthenticated POST with a token returns group `name`, `currency`, `group_type`, `trip_start_date`, `trip_end_date`, `created_by`, the inviter's `id`/`name`/`avatar_url` (their actual photo, as a base64 data URL), and — via the `email_invites` aggregation at `:120-124` — **every email address ever invited on that link**. The function's own comment at `:154` says "email intentionally omitted from public preview", referring to the inviter's address, three lines after emitting the invitees'.
How to reproduce: `curl -s "$SB/rest/v1/rpc/get_invite_preview" -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"p_token":"<any token>"}'` — no `Authorization` header. Tokens are shared over WhatsApp/SMS/clipboard (`components/GroupFormModal.tsx:182-214`), so any recipient, forwarder, or member of a chat where one was pasted has one.
Blast radius: Per token: the social graph and travel dates of one group, plus the email addresses of everyone invited to it. Those addresses then feed A-03 and A-01.
Why it exists: The preview needed to work pre-authentication, and the `email_invites` list was added for the auto-join email-match check on the landing page (`InvitePage.tsx:108-121`) — a client-side decision that required shipping the whole list to the client.
Containment (minutes): Delete `email_invites` from the response (`:120-124`, `:156`) and replace the landing-page check with a server-side one: add a boolean `'email_matches_invite'` computed inside the function from the *caller's* JWT email when present, `false` for anon. Also drop `trip_start_date`, `trip_end_date` and `created_by`, which the landing page does not display.
Correct fix: The containment, plus reduce the preview to what the page actually renders: group `name`, inviter `name`, `expires_at`, `current_uses`/`max_uses`, and the match boolean. Everything else is gratuitous.
Proof of fix: An anon `get_invite_preview` response contains no `email_invites` key and no date fields; the signed-out invite page still renders correctly; the email-match auto-join still works for a targeted invitee and still does not fire for a non-targeted one.
Depends on / conflicts with: A-03, A-29.

---

### [P1-A-10] `native-bridge` converts any valid Clerk session JWT into a durable session, with no `azp`/audience check
Severity: P1 · Confidence: LIKELY · Area: Edge Function / authentication
Location: `supabase/functions/native-bridge/index.ts:104-107` (`verifyToken` without `authorizedParties`), `:115-133` (ticket minting), `:126` (rate limit placement), `supabase/config.toml` (`verify_jwt = false`), client `services/nativeAuthBridge.ts:49-79`
What is wrong: The function accepts a bearer token, calls `verifyToken(token, { secretKey, clockSkewInMs: 10_000 })` with **no `authorizedParties`**, checks only that `sub` starts with `user_` (`:60-67`), and then mints a Clerk **sign-in token** for that user — a one-time credential that creates a *new, full session*. There is no check that the presented token came from the Android app rather than from the web app, no `azp` validation, and no binding to a device. Since the same session JWT is also sent to PostgREST on every request and to two other Edge Functions, any place a token is observed becomes a session-minting oracle: a 60-second bearer credential is upgraded to a durable login. `verifyToken`'s exact internal checks live inside `@clerk/backend` and are not readable here — hence LIKELY.
How to reproduce: From a signed-in web session, copy the `Authorization` bearer value out of any Supabase request in devtools, then `curl -X POST "$SB/functions/v1/native-bridge" -H "Authorization: Bearer <that token>" -H "apikey: $ANON"`. A `{"ticket": "..."}` response is the finding. Redeem with `signIn.create({strategy:'ticket', ticket})` (`services/nativeAuthBridge.ts:34-42`) from any client to obtain a session for that user.
Blast radius: Every user of the product. Turns any token disclosure — a proxy log, a Sentry replay (A-20), an XSS in the absence of CSP (A-25), a malicious dependency — into full account takeover that survives the original token's 60-second life.
Why it exists: `verify_jwt=false` was required because the platform's own JWT check rejects Clerk tokens and CORS preflights (documented at `supabase/config.toml:1-3`), so the function does its own verification — and the verification written was "is this a valid token for this Clerk instance", not "is this the Android app's token".
Containment (minutes): Pass `authorizedParties: ['https://www.motamaati.in', 'https://motamaati.in']` (or whatever the native client's `azp` actually is — check a real native token first) to `verifyToken` at `:104-107`. One argument.
Correct fix: The containment, plus require a second factor the web client cannot produce — the simplest is a shared secret header set as an Edge secret and compiled into the Android build, checked before `verifyToken`; better is to have `clerk-android` complete the session itself and drop the bridge. Also move the `rateLimit` call **above** `verifyToken` so unauthenticated flooding is bounded, and replace the in-isolate `Map` with a durable counter (A-17).
Proof of fix: A token minted by the web client returns 401; a token from the native client returns a ticket; the ticket is single-use and expires in 60 s (already true, `:26`, `:132`).
Depends on / conflicts with: A-17, A-20, A-25.

---

### [P1-A-11] A signed-in user auto-joins any group from a link, with no confirmation, reachable from any other Android app
Severity: P1 · Confidence: CONFIRMED · Area: invite flow / deep links
Location: `App.tsx:256-263` (unconditional accept), `:203-242` (`handleInviteAcceptance`), `:969-990` (token → `localStorage`), `:1029` (`InvitePage` gated on `!user`), `utils/nativeDeepLinks.ts:57-61` (`invite/…` extracted from any URL), `android/app/src/main/AndroidManifest.xml:29-34` (unrestricted `kharchbaant` scheme)
What is wrong: `InvitePage` has a careful gate — auto-join only when the signed-in user's email matches a targeted `email_invites` row (`InvitePage.tsx:108-121`). But a signed-in user never reaches `InvitePage`, because `App.tsx:1029` renders it only when `!user`. They hit the effect at `App.tsx:246-278`, which reads the token from `window.location.pathname` **or from `localStorage['pendingInviteToken']`** and calls `handleInviteAcceptance` immediately. No confirmation dialog, no preview, no "join?" button. On Android, `historyPathForAppUrl` extracts `invite/([^/?#]+)` from *any* incoming URL (`nativeDeepLinks.ts:57-61`) and the `kharchbaant` scheme filter has no host restriction and is `BROWSABLE`, so **any installed app, or any web page the user taps, can fire `kharchbaant://invite/<token>`** and the app joins on next foreground.
How to reproduce: (web) send a signed-in user `https://www.motamaati.in/invite/<attacker token>`; on load they are a member and see a success toast. (android) from any other app, `startActivity(new Intent(ACTION_VIEW, Uri.parse("kharchbaant://invite/<token>")))`. (persistence) any page that runs `localStorage.setItem('pendingInviteToken', t)` on the origin causes a join at the user's next app open — including after a different user signs in on the same device (§1.4).
Blast radius: Any signed-in user who taps a link. They join an attacker's group, at which point the attacker sees their `people` row via `i_can_see_person` and can attribute expenses to them (A-16). They **cannot leave** (A-14). Nearly silent — one toast that reads as a normal success.
Why it exists: The pre-auth path was hardened (email match) and the post-auth path — which is the older code — was never revisited.
Containment (minutes): In `App.tsx:260-263`, replace the unconditional call with a state flag that renders a confirmation modal showing the group name from `validateInvite` (already fetched at `:205`) and requires a click. ~15 lines.
Correct fix: One invite-landing component for both auth states, with an explicit Join button always, and no `localStorage` fallback (the token belongs in the URL only, and must be cleared on sign-out — see A-18). Separately, restrict the `kharchbaant` intent filter to `android:host="sso-callback"` only and drop the catch-all scheme filter at `AndroidManifest.xml:29-34`, so other apps cannot inject invite paths.
Proof of fix: Opening `/invite/<token>` while signed in shows a confirmation and does **not** create a `group_members` row until the button is pressed; `kharchbaant://invite/x` from another app no longer routes anywhere.
Depends on / conflicts with: A-14, A-18, A-29.

---

### [P1-A-12] Authorization arguments are computed on the client and passed into the functions that enforce them
Severity: P1 · Confidence: CONFIRMED · Area: application logic
Location: `services/supabaseApiService.ts:8-10` (`deleteGroup(…, isOwner, allSettled)`), `:22-25` (`archiveGroup(…, isOwner, userSettled, allSettled)`), `:260-261` (`approveGroupDeletion` creator + settled checks in JS), `:294` (`getPendingDeletionRequests` creator filter in JS), `:237` (`requestGroupDeletion` client-supplied `requestedBy`); the booleans are derived at `App.tsx:131-139` and passed at `:546`, `:567`
What is wrong: `deleteGroup` and `archiveGroup` receive `isOwner`, `userSettled` and `allSettled` as *parameters* and `throw` on them. Those values are computed in the browser from the cached transaction list (`App.tsx:138-139`) — they are inputs to the check, not evidence. The database enforces only creator-ness (`groups` UPDATE/DELETE `USING (i_created_group(id))`); **settlement is not a concept the database knows about**. Same shape in `approveGroupDeletion` (creator compared in JS against client-fetched data) and `getPendingDeletionRequests` (creator filtered in JS after the rows have already crossed the wire).
How to reproduce: Call the endpoints directly, skipping the JS entirely. As the creator of an unsettled group: `curl -X DELETE "$SB/rest/v1/groups?id=eq.<uuid>" -H "apikey: $ANON" -H "Authorization: Bearer $JWT"` — succeeds despite outstanding balances. Or, in devtools, `await import('./services/supabaseApiService').then(m => m.deleteGroup(id, me, true, true))`.
Blast radius: Loss of the settlement guard on group deletion (money-relevant: deleting an unsettled group destroys the record of who owes whom, with no audit trail and no restore path); plus, for the deletion-request workflow, whatever A-05's live state permits.
Why it exists: The guards were written in the layer that had the data — the client already computes balances for rendering (`utils/calculations.ts`), and the database has no balance representation at all.
Containment (minutes): None that is honest. The check cannot move to the database without a server-side notion of balance. What *can* be done now is to delete the misleading parameters so the code stops claiming to enforce something it does not: `deleteGroup(groupId)` and `archiveGroup(groupId)`, with the UI's `disabled` state as the only (clearly labelled) client-side hint.
Correct fix: Give the database the concept. A `group_balances(group_id, person_id, balance)` materialisation maintained by a trigger on `transactions`, plus a `BEFORE DELETE` trigger on `groups` that raises when any `abs(balance) >= 0.01`. That also fixes the "which balance does the client believe" ambiguity across four components that each recompute independently (`00-map.md` §0.8). Design decision: whether settlement is a *hard* constraint (trigger) or an advisory one (UI only, honestly labelled) — pick one and stop pretending.
Proof of fix: `DELETE /rest/v1/groups?id=eq.<unsettled group>` as the creator returns an error mentioning outstanding balances; the same call on a settled group succeeds.
Depends on / conflicts with: A-05, A-13, A-14.

---

### [P1-A-13] Any group member can edit or delete any expense or settlement, and the schema cannot express a better rule
Severity: P1 · Confidence: CONFIRMED · Area: RLS / role model
Location: `supabase/migrations/20260412000005_use_clerk_user_id_in_rls.sql:149-150` (UPDATE), `supabase/migrations/20260412000008_allow_members_to_delete_transactions.sql:12-13` (DELETE); UI `components/TransactionItem.tsx:136,143`, `components/TransactionDetailModal.tsx:161-172`; the mass-delete call shape at `services/supabaseApiService.ts:14`, `:265`
What is wrong: Both policies are group-scoped (`i_created_group OR i_am_member_of`) with no per-row ownership term — because `transactions` has **no `created_by`, no `updated_by`, no version column and no audit table** (`00-map.md` §0.4.1). So any member can rewrite any amount, change any payer, alter any split, delete any settlement, or wipe a group's entire history with a single `DELETE /rest/v1/transactions?group_id=eq.<uuid>`. Nothing records that it happened; the other members see balances change with no explanation. `20260412000008`'s stated reason for widening DELETE was a UI bug ("non-creator members see an apparent delete … so the transaction reappears"), i.e. a display problem was fixed by widening authorization.
How to reproduce: As any member, `curl -X DELETE "$SB/rest/v1/transactions?group_id=eq.<uuid>" -H "apikey: $ANON" -H "Authorization: Bearer $JWT"`. Or reverse a settlement someone else recorded: `DELETE …?id=eq.<settlement uuid>`. Or silently change what you owe: `PATCH …?id=eq.<uuid>` with `{"amount": 1}`.
Blast radius: Every group. Money-relevant and **silent** — no audit trail exists at any layer, so after the fact there is no way to determine who changed what, or to restore.
Why it exists: The role model has exactly one role (`groups.created_by`) and the transaction table has no authorship column, so "creator of this row" is not expressible.
Containment (minutes): Narrow DELETE back to `i_created_group(group_id)` (revert `20260412000008`) — that at least confines destruction to one accountable person per group. It reintroduces the UI bug that migration was working around, so pair it with hiding the delete button for non-creators.
Correct fix: `ALTER TABLE transactions ADD COLUMN created_by uuid REFERENCES people(id);` backfilled to `paid_by_id`, set server-side from `requesting_user_id()` via a `BEFORE INSERT` trigger (never from the client). Then UPDATE/DELETE `USING (created_by = my_person_id() OR i_created_group(group_id))`. Add an append-only `transaction_audit` table written by a trigger — without it, none of the money findings in this pass are investigable after the fact. Design decision: whether editing another member's expense is a product feature (Splitwise allows it, with an activity feed); if it is, then the **activity feed is the mitigation** and it must ship with the permission.
Proof of fix: A member other than the row's `created_by` and other than the group creator gets 0 rows on `PATCH`/`DELETE`; every accepted change appends an audit row naming the actor.
Depends on / conflicts with: A-12, A-05 (`approveGroupDeletion`'s transaction wipe rides this policy), A-16.

---

### [P1-A-14] A non-creator can never leave a group, and archive is dead in both directions
Severity: P1 · Confidence: CONFIRMED · Area: authorization / product
Location: `services/supabaseApiService.ts:337-347` (the throw), `:22-31` (`archiveGroup`'s inverted gate), `:2-6` (`unarchiveGroup`, ungated), `App.tsx:377-412` (`executeGroupSave`), `:906` (the promise the modal makes), policy `20260412000005:110-111`
What is wrong: The only "leave" path is `updateGroup` with the user removed from `groupData.members`. `updateGroup` first does `.from('groups').update(...).eq('id',groupId).select().single()`. For a non-creator the `groups` UPDATE policy `USING (i_created_group(id))` matches 0 rows, `.single()` raises `PGRST116`, and `:344-347` throws **before** the member-deletion at `:350`. The user sees "Failed to save group updates." (`App.tsx:410`) after a modal that promised "You will no longer have access to …". There is no other `group_members` delete in the codebase that a non-creator can reach. Meanwhile `archiveGroup` throws for owners (`:23`) while the database allows only owners, and the UI shows the button only to non-creators (`GroupFormModal.tsx:259-279`) — three layers, mutually exclusive, feature dead. `unarchiveGroup` has no gate and no `.single()`, so a non-creator's click affects 0 rows, no error is raised, and the client removes the row from the list anyway (`ArchivedGroupsModal.tsx:51-52`).
How to reproduce: As a non-creator member, open Group Settings, remove yourself, Save. Observe the error toast and that you are still a member after reload. Then open Settings → View Archived Groups → Unarchive on any group you did not create: the entry disappears and returns on reload.
Blast radius: Every non-creator in every group. Combined with A-07 and A-11 (both of which put people into groups without consent), users can be permanently attached to groups they never agreed to join and cannot exit. That is also a GDPR/Play-policy problem, not only a UX one.
Why it exists: "Leave" was implemented as a special case of "edit the group", and the edit permission is creator-only.
Containment (minutes): Add a `group_members` DELETE policy for self-removal:
```sql
CREATE POLICY "Members can remove themselves" ON group_members FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM people p WHERE p.id = group_members.person_id
               AND p.clerk_user_id = requesting_user_id()));
```
and give the client a `leaveGroup(groupId, personId)` that issues that single delete instead of routing through `updateGroup`.
Correct fix: The containment, plus decide the archive semantics: today `is_archived` is a **group-wide** flag being used as if it were per-user ("Groups you have archived", `ArchivedGroupsModal.tsx:31`). Either make it per-user (`group_members.archived_at`, which any member may set on their own row) or make it creator-only and remove the non-creator UI. Also add `.select().single()` to `unarchiveGroup` so silent 0-row updates stop reporting success.
Proof of fix: A non-creator's "Leave Group" removes their `group_members` row and the group disappears permanently; archive/unarchive either works for the user shown the button or the button is not shown.
Depends on / conflicts with: A-02 (with the hotfix live, `updateGroup` succeeds and destroys the whole membership instead), A-07, A-11, A-23.

---

### [P2-A-15] `groups` UPDATE has no `WITH CHECK`, so a creator can set `created_by` to anyone — or to nobody
Severity: P2 · Confidence: LIKELY · Area: RLS
Location: `supabase/migrations/20260412000005_use_clerk_user_id_in_rls.sql:110-111`, helper `:38-57`; column typed `TEXT` with no FK (`00-map.md` §0.4.1)
What is wrong: `FOR UPDATE USING (i_created_group(id))` with no `WITH CHECK`. Postgres reuses `USING` as the `WITH CHECK`, and `i_created_group` is `STABLE SECURITY DEFINER` and *re-queries* `groups`, so within the statement's snapshot it still reads the **old** `created_by` and passes regardless of the new value. `created_by` is `TEXT` with no foreign key and deliberately accepts either a Clerk id or a person UUID, so any string is valid. Setting it to a value no one matches makes the group permanently unmanageable: no rename, no archive, no unarchive, no delete, and no member removal, for anybody, ever.
How to reproduce: As a group creator, `curl -X PATCH "$SB/rest/v1/groups?id=eq.<uuid>" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"created_by":"00000000-0000-0000-0000-000000000000"}'`. Then attempt any UPDATE or DELETE on that group from any account — all return 0 rows.
Blast radius: One group per action, self-inflicted or inflicted by a compromised creator account. Not cross-tenant, but irreversible without direct database access. Also enables a quiet ownership transfer with no notification to the recipient.
Why it exists: `WITH CHECK` was omitted on all four `groups` policies; on SELECT/INSERT/DELETE that is harmless, and nobody reasoned about the UPDATE case.
Containment (minutes): Add an explicit check that pins the column:
```sql
DROP POLICY "Users can update their groups" ON groups;
CREATE POLICY "Users can update their groups" ON groups FOR UPDATE
  USING (i_created_group(id)) WITH CHECK (i_created_group(id));
```
Note this alone does **not** fix it, for the snapshot reason above — the reliable form is a `BEFORE UPDATE` trigger raising when `NEW.created_by IS DISTINCT FROM OLD.created_by` (transfer then becomes an explicit RPC).
Correct fix: The trigger, plus give `created_by` referential integrity — make it `uuid REFERENCES people(id)` (the attempt at `migrations/20251116:5` evidently lost) and normalise the "Clerk id or person UUID" ambiguity that `i_created_group` exists to paper over. That ambiguity is itself a latent bug factory: `20260412000004:35` compares against `people.user_id` while `20260412000005:53` compares against `people.clerk_user_id`, and which one is live is unknown.
Proof of fix: A `PATCH` changing `created_by` is rejected; a rename by the creator still succeeds; a dedicated `transfer_group_ownership(group_id, new_owner)` RPC works and is creator-gated.
Depends on / conflicts with: A-02, A-14.

---

### [P2-A-16] `paid_by_id` and split participants are never checked against group membership
Severity: P2 · Confidence: CONFIRMED · Area: RLS / data integrity
Location: policies `supabase/migrations/20260412000005:146-150` (reference only `group_id`), insert `services/supabaseApiService.ts:541-556`, update `:626-660`; schema has no CHECK on `split_participants`/`payers` (`00-map.md` §0.4.1); the only filtering is cosmetic at `App.tsx:592`, `:673`
What is wrong: No policy, constraint or trigger relates `paid_by_id`, `payers[].personId` or `split_participants[].personId` to `group_members`. A member of group G can insert or update a transaction in G naming **any** `people.id` in the database. The foreign key on `paid_by_id` checks existence only; the JSONB columns have no constraint at all.
How to reproduce: `curl -X POST "$SB/rest/v1/transactions" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"group_id":"<my group>","description":"x","amount":100,"paid_by_id":"<any person uuid>","date":"2026-01-01","tag":"Other","split_mode":"equal","split_participants":[{"personId":"<any person uuid>","value":1}]}'`.
Blast radius: Balance corruption in a group the named person cannot see; a write-side existence oracle for `people` UUIDs; and, combined with A-07, the ability to attribute expenses to a real user who was force-added. Client symptom: `getPeople` returns only co-members (`:803-806`), so foreign ids render as `undefined` in the member list (`TransactionItem.tsx:24`).
Why it exists: Membership was treated as a UI concern — the form's dropdown is populated from `groupMembers` — and nobody wrote the server-side equivalent.
Containment (minutes): A `BEFORE INSERT OR UPDATE` trigger on `transactions` that raises unless `paid_by_id` and every `personId` in `split_participants`/`payers` is present in `group_members` for `NEW.group_id`. ~15 lines of plpgsql, and it also catches the group-move case from §3.1.
Correct fix: The trigger, plus the CHECK constraints that Pass 1.4 will want anyway (participants non-empty, `payers` sum equals `amount`, split values non-negative). These belong together in one migration.
Proof of fix: Inserting a transaction whose `paid_by_id` is not in the group returns an error naming the offending person; a legitimate insert still succeeds.
Depends on / conflicts with: A-07, A-13.

---

### [P2-A-17] No rate limit exists on any write path; the Edge Function limits are per-isolate and do not bound anything
Severity: P2 · Confidence: CONFIRMED · Area: abuse / availability
Location: `supabase/functions/_shared/auth.ts:44-59` (the in-memory `Map`), applied at `send-email/index.ts:63`, `suggest-tag/index.ts:50`, `native-bridge/index.ts:126`; absence: no limit on any PostgREST table or RPC anywhere in the repo
What is wrong: `rateBuckets` is a module-scope `Map` in one Deno isolate; the comment at `:44` concedes "best-effort; resets per cold start". Supabase Edge Functions run many isolates and recycle them frequently, so parallel or cold-start-spaced requests are unbounded. Meanwhile the surfaces that actually matter have **no limit at all**: `POST /rest/v1/people` (unbounded row creation, A-06), `rpc/find_person_by_email` (unbounded enumeration, A-03), `rpc/create_unclaimed_person`, `POST /rest/v1/email_invites` (A-08), `POST /rest/v1/transactions`, and the Realtime broadcast send (A-04). Because there is no application server, there is nowhere in this architecture that a conventional rate limiter could sit.
How to reproduce: Loop any of the above at HTTP speed with one valid JWT; observe no 429. For the Edge case, fire 200 concurrent `send-email` requests and count how many exceed 20.
Blast radius: Cost (Gemini calls, MailerSend quota, Postgres storage), enumeration speed, and the amplification in A-04. No user-visible symptom until a bill or a suspension arrives.
Why it exists: The limits were written for the Edge Functions because that is where a `Map` was easy; the direct-to-Postgres surfaces have no code to put a limit in.
Containment (minutes): Set a Supabase project-level API rate limit if the plan offers one (dashboard, outside the repo). For the Edge Functions, the honest containment is to stop describing the `Map` as a rate limit in comments and docs.
Correct fix: Move counting into Postgres, where every path already goes: a `request_budget(subject text, bucket text, window_start timestamptz, count int)` table with a `SECURITY DEFINER` `consume_budget(bucket, max, window)` helper, called at the top of every sensitive `SECURITY DEFINER` RPC (`find_person_by_email`, `create_unclaimed_person`, `ensure_my_person`, `accept_group_invite`) and from the Edge Functions in place of `rateLimit`. Design decision: which operations get budgets and what the numbers are — that is a product call, not an engineering one.
Proof of fix: The 51st `find_person_by_email` in an hour from one subject returns an error, verified across two different Edge isolates / two browser tabs.
Depends on / conflicts with: A-03, A-06, A-08, A-04, A-10.

---

### [P2-A-18] Sign-out clears almost nothing: the query cache, the invite token and the selected group all survive
Severity: P2 · Confidence: CONFIRMED · Area: session lifecycle
Location: `contexts/SupabaseAuthContext.tsx:98-108` (`signOut`), `App.tsx:274-277` (the comment that is wrong), `:190-195`, `:258-262`, `:975`; `store/appStore.ts` (persisted to `localStorage['app-ui']`); `grep -rn "queryClient.clear\|qc.clear"` → 0 hits
What is wrong: `signOut` drops Realtime auth, calls Clerk, and sets `person` to null. It never calls `queryClient.clear()` or `removeQueries`. Because keys are `['groups', personId]` etc. (`services/queries.ts:8-13`), the queries go `enabled:false` and stop refetching — so a *second* user does not read the first user's cache — but the first user's group names, transaction amounts and people rows **remain in the JS heap** until a full page reload, and are visible in devtools and in any Sentry session replay (A-20). `localStorage['pendingInviteToken']` also survives, so the next person to sign in on that device silently joins the previous user's pending invite (`App.tsx:258-262`, and see A-11). `localStorage['app-ui']` keeps `selectedGroupId`. `App.tsx:276`'s comment "Query caches will clear based on person context" describes behaviour that does not exist.
How to reproduce: Sign in as A, open a group, sign out. In devtools, inspect the QueryClient cache — A's data is still there. Sign in as B; check `localStorage.pendingInviteToken` if A had a pending invite; observe B auto-joining A's group.
Blast radius: Shared and kiosk devices, and the Android app where the WebView is long-lived. Data exposure between users of one device, plus an unintended group join.
Why it exists: Person-scoped query keys were assumed to be sufficient isolation, which is true for *reads* and false for *residency*.
Containment (minutes): Three lines in `signOut`:
```ts
queryClient.clear();
localStorage.removeItem('pendingInviteToken');
useAppStore.getState().setSelectedGroupId(null);
```
(`SupabaseAuthContext` needs the `useQueryClient` hook, which means the provider must sit inside `QueryClientProvider` — verify the order in `index.tsx` before wiring it.)
Correct fix: The containment, plus a `window.location.replace('/')` after sign-out so the heap is genuinely discarded — the only reliable way to drop in-memory data in a SPA.
Proof of fix: After sign-out, `queryClient.getQueryCache().getAll()` is empty and `localStorage` contains no `pendingInviteToken`; signing in as a second user on the same tab shows no trace of the first.
Depends on / conflicts with: A-11, A-20.

---

### [P2-A-19] A missing or failed Clerk token degrades to an anonymous request that renders as "you have no data"
Severity: P2 · Confidence: CONFIRMED · Area: authentication / failure mode
Location: `lib/supabase.ts:33-43` (returns `''` on both the no-session and the throw path), `:57-63` (header omitted when falsy); consumers `services/supabaseApiService.ts:154-165`, `:507-515`, `:771-779`
What is wrong: `getClerkSupabaseToken` returns `''` when `window.Clerk.session` is absent and also when `getToken()` throws (the `catch` only `console.warn`s). `''` is falsy, so no `Authorization` header is set and the request goes out with the anon key alone. PostgREST then evaluates policies with `requesting_user_id()` NULL: reads return `200 []`, not `401`. The service layer treats an empty array as "no data" — `getTransactions` even logs "No group memberships found" and returns `[]` at `:512-515`, and `getPeople` returns `[]` at `:777-779`. **The user sees an empty app rather than an authentication error**, and there is no retry, no Sentry capture, and no UI state for "we could not authenticate you".
How to reproduce: In devtools on a signed-in session, `delete window.Clerk.session` then trigger a refetch — the UI empties with no error. Or throttle so `getToken()` times out.
Blast radius: Every user, whenever a token fetch transiently fails. Presents as data loss, which for an expense app is the most alarming possible failure mode. It is also the likely explanation behind several of the repo's operational-fix documents (`USER_ISOLATION_FIXES.md`, `MEMBER_DISPLAY_BUG_FIX.md`).
Why it exists: `getClerkSupabaseToken` was written to be non-throwing so callers would not need error handling — which pushed the failure into an indistinguishable success.
Containment (minutes): Throw instead of returning `''` when there is a session but `getToken()` failed, and let the existing error paths surface it. Keep `''` only for the genuinely-signed-out case, which the app already handles separately (`App.tsx:1033`).
Correct fix: The containment, plus distinguish the two states at the query layer: an auth failure should set an error state that renders "Reconnecting…" and retries, never an empty list. Capture it to Sentry (currently nothing is — `App.tsx:359-361` and 34 other `catch` blocks `console.error` only, per `00-map.md` §0.2).
Proof of fix: With `getToken` stubbed to throw, the app shows an auth-error state and a retry, and no query resolves to `[]`.
Depends on / conflicts with: A-28.

---

### [P2-A-20] Sentry runs with `sendDefaultPii`, identified users, and 100 %-on-error session replay
Severity: P2 · Confidence: LIKELY · Area: data exposure / third party
Location: `index.tsx:19-30` (DSN, `sendDefaultPii: true`, `replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`), `App.tsx:58-64` (`Sentry.setUser({id, email, username})`)
What is wrong: Session Replay records the DOM and network metadata of authenticated sessions and ships them to a third party, keyed to an identified user with their email attached. There is no `beforeSend`, no `maskAllText`, no `blockAllMedia` and no `denyUrls` anywhere in the repo. Combined with the never-cleared query cache (A-18), a replay captured after any error contains other people's names, group names and expense amounts. `sendDefaultPii: true` is an explicit opt-in to sending *more* than the default redaction set. Sentry's defaults do scrub `Authorization` headers, so this is LIKELY rather than CONFIRMED for token exposure — but the financial and personal data in the DOM is not in doubt.
How to reproduce: Trigger any error in a production build with data loaded, then open the replay in Sentry and read the group and member names off the recording.
Blast radius: Every user who hits an error (100 % sampled) plus 10 % of all sessions. A second copy of the product's personal and financial data lives in a system with a different access-control model and a different retention policy than the one this audit covers.
Why it exists: Defaults chosen for debuggability during a beta, never revisited for a production release with real users and a Play Store listing.
Containment (minutes): `sendDefaultPii: false`, `replaysSessionSampleRate: 0`, and `Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })`. Four edits in `index.tsx:19-30`.
Correct fix: The containment, plus `Sentry.setUser({ id })` only — drop `email` and `username` (`App.tsx:60`) — and a `beforeSend` that strips request bodies. Then decide, deliberately, whether replay is worth keeping at all for a financial app; if it is, document it in the privacy policy (`public/privacy.html`) which should be checked for whether it currently discloses this.
Proof of fix: A replay of an authenticated session shows masked text throughout and the event's user object contains no email.
Depends on / conflicts with: A-18, A-10 (replays are one of the places a token could be observed).

---

### [P2-A-21] `ai_item_cache` is a globally shared, user-writable table guarded by an `auth.role()` check that may not evaluate under Clerk
Severity: P2 · Confidence: SUSPECTED (the `auth.role()` behaviour) / CONFIRMED (the shared-write design) · Area: RLS
Location: `supabase-schema.sql:88-99`, RLS re-asserted `supabase/migrations/20260728000000:20`; client `services/tagClassifier.ts:14-40`
What is wrong: Two issues. (1) The policies use `auth.role() = 'authenticated'`, written for the Supabase-Auth era. Under Supabase third-party auth the Postgres role comes from the JWT's `role` claim; whether a Clerk session token carries `role: "authenticated"` depends on a dashboard-side integration setting that is not in this repo. If it does not, both policies are false, every read misses and every write fails — `tagClassifier.ts:14-27` swallows the error and returns `null`, falling through to a **paid Gemini call on every classification**, forever, with no visible symptom other than the bill. (2) Independently of that, the table is global and any authenticated user may insert. Entries are keyed by `normalized_name` (the lowercased expense description) and are immutable once written (no UPDATE/DELETE policy). One user can pre-poison arbitrary keys with wrong categories that every other user then receives (`:16-21` returns the cached `category` before Gemini is consulted).
How to reproduce: (1) `SELECT auth.role();` with a real Clerk JWT — if it is not `'authenticated'`, the cache is dead. (2) `curl -X POST "$SB/rest/v1/ai_item_cache" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -d '{"normalized_name":"uber","category":"Health","source":"gemini"}'`; every user typing "uber" then gets `Health`.
Blast radius: (1) unbounded Gemini spend, silent. (2) low-severity global data poisoning — it mislabels categories, it does not move money.
Why it exists: The table predates Clerk and was never revisited; the "shared cache" design was a cost optimisation with no thought about who writes to it.
Containment (minutes): Replace `auth.role() = 'authenticated'` with `requesting_user_id() IS NOT NULL` in both policies — one expression each, and it is correct under Clerk regardless of the `role` claim.
Correct fix: The containment, plus stop letting clients write the cache directly: fold the write into the `suggest-tag` Edge Function (which already has the Gemini result and a service-role-capable environment) so `ai_item_cache` becomes read-only to `authenticated`. That removes the poisoning vector entirely and is a net code deletion in `tagClassifier.ts:29-40`.
Proof of fix: `SELECT` from the cache with a Clerk JWT returns rows; a direct client `INSERT` returns `42501`; the tag still gets cached after a Gemini call.
Depends on / conflicts with: —

---

### [P2-A-22] Realtime DELETE events are not RLS-filtered, and `REPLICA IDENTITY FULL` makes them carry the whole row
Severity: P2 · Confidence: LIKELY · Area: Realtime
Location: `migrations/enable_realtime.sql:5-9` (`REPLICA IDENTITY FULL` on all five tables), subscriptions `services/supabaseApiService.ts:389-475` (all `event: '*'`, no filter), handlers `services/queries.ts:77,103,135,162`
What is wrong: Supabase documents that "RLS policies are not applied to `DELETE` statements, because there is no way for Postgres to verify that a user has access to a deleted record." Every client subscribes to unfiltered `event:'*'` on `transactions`, `groups`, `people`, `group_members` and `payment_sources`, and every one of those tables has `REPLICA IDENTITY FULL`, so the `old` payload is the **complete row**. Therefore every deletion anywhere in the system is broadcast in full to every online user. The app's own handlers read only `old.id`, but the payload is in the WebSocket frame. `deleteGroup` deletes a group's `transactions` before the group itself (`:12-16`), so one group deletion emits that group's entire financial history — descriptions, amounts, payers, splits — to every connected client.
How to reproduce: Open two browsers signed in as unrelated users with no shared groups. In devtools on client B, log the raw payload: `supabase.channel('x').on('postgres_changes',{event:'DELETE',schema:'public',table:'transactions'}, p => console.log(p.old)).subscribe()`. Delete a transaction as user A. B receives A's full row.
Blast radius: Every online user receives the deleted rows of every other user. Silent, and invisible in the UI, which is why it would never be noticed in normal use.
Why it exists: `REPLICA IDENTITY FULL` was set to make DELETE events usable at all (the handlers need `old.id`); the RLS consequence is a documented Supabase behaviour that was not accounted for.
Containment (minutes): Subscribe to `INSERT` and `UPDATE` only, and handle deletions through the existing broadcast/invalidate path — the `tx` broadcast already exists for exactly this reason (`:564`). That is a two-line change per subscription and removes the leak entirely for `transactions`.
Correct fix: The containment for all five subscriptions, and reconsider `REPLICA IDENTITY FULL`: with DELETE events no longer consumed, `DEFAULT` (primary key only) suffices and the leak becomes structurally impossible. Note this interacts with A-04 — fixing that one by moving to private per-group channels also fixes this one, and is the better single change.
Proof of fix: A non-member's client receives no `DELETE` payload at all for another group's transactions; deletions still disappear from the deleter's and co-members' UIs.
Depends on / conflicts with: A-04 (one fix can address both).

---

### [P2-A-23] Updates that affect zero rows report success, so RLS denials look like they worked
Severity: P2 · Confidence: CONFIRMED · Area: error handling
Location: `services/supabaseApiService.ts:1232-1243` (`updateUserAvatar`, no `.single()`), `:2-6` (`unarchiveGroup`), `:736-745` (`deletePaymentSource`), `:747-756` (`archivePaymentSource`); UI consequence `components/SettingsModal.tsx:85-87`, `components/ArchivedGroupsModal.tsx:51-52`
What is wrong: PostgREST returns `204`/`200` with an empty body when an UPDATE or DELETE matches zero rows — an RLS denial is indistinguishable from a no-op. These four functions check only `error`, which is null, and return `{success:true}`. `SettingsModal.tsx:87` then shows "Profile picture updated!" for a `personId` the caller does not own, and `ArchivedGroupsModal.tsx:52` removes a group from the list that was never unarchived. The enforcement itself is real (the policies deny correctly); what is wrong is that **the client cannot tell an authorized success from a denied write**, which makes every RLS bug in this system invisible during testing. `updatePerson` (`:1246-1260`) accidentally avoids this because `.select().single()` raises `PGRST116` on 0 rows — an accident, not a pattern.
How to reproduce: In devtools, `await import('./services/supabaseApiService').then(m => m.updateUserAvatar('<someone else\'s person uuid>','data:image/png;base64,AAA'))` → resolves `{success:true}`, and the toast fires. Query the row: unchanged.
Blast radius: No data is exposed or corrupted. The cost is diagnostic: it is the reason findings like A-14's dead archive feature can ship and stay shipped.
Why it exists: The success shape `{success:true}` was written before RLS was doing real work, when a null `error` genuinely meant success.
Containment (minutes): Add `{ count: 'exact' }` to each call and assert `count === 1` — four edits. E.g. `const { error, count } = await supabase.from('people').update({...}).eq('id', personId).select('id', { count: 'exact', head: true }); if (error) throw error; if (!count) throw new Error('Not permitted');`
Correct fix: The containment as a house rule — every mutating call in this codebase must assert an affected-row count, because in an RLS-only architecture a 0-row write is the *normal* shape of an authorization failure. Worth a lint rule or a thin `mutate()` wrapper, since there are ~20 such call sites.
Proof of fix: `updateUserAvatar` with someone else's id rejects; with your own id it succeeds; `unarchiveGroup` as a non-creator shows an error instead of optimistically removing the row.
Depends on / conflicts with: A-14 (this is why that feature's failure is invisible).

---

### [P2-A-24] Destructive RLS-disabling SQL sits in the working tree alongside `GRANT … TO anon`
Severity: P2 · Confidence: CONFIRMED (presence) / SUSPECTED (whether ever applied) · Area: operations
Location: `COMPLETE_RLS_FIX.sql:5-13` (disables RLS on all seven core tables incl. `group_invites`/`email_invites`, **no danger banner**), `DATABASE_FIX_DISABLE_RLS.sql:11` (banner present, `:1-5`), `migrations/HOTFIX_disable_group_members_rls.sql`, paired with `migrations/enable_realtime.sql:20-24` (`GRANT SELECT … TO anon, authenticated`) and `migrations/HOTFIX_reset_all_policies.sql:65-69` (`GRANT ALL … TO authenticated`)
What is wrong: With RLS on, the grants are harmless. With RLS off, `GRANT SELECT ON groups, transactions, payment_sources, people, group_members TO anon` means **the public anon key alone dumps every table** — no account needed. Three files in the tree do exactly that disabling, one of them without any warning, and the project's own history (seven `HOTFIX_*` files, "Apply manually via Supabase dashboard SQL editor" on every migration) shows that pasting a file into the SQL editor is how this database is administered. The audit script that should catch a live RLS-off state checks only seven tables (`scripts/rls-beta-audit.sql:6-16`), omitting `group_deletion_requests` and `ai_item_cache`.
How to reproduce (verification): `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY 1;` — any `false` on a data table is an active full-database leak. Behaviourally: `curl "$SB/rest/v1/people?select=*" -H "apikey: $ANON"` with **no** `Authorization` header; any rows returned is the proof.
Blast radius: Total, if ever applied. Every user's email, name and photo; every group; every transaction; every live invite token — to anyone with the public anon key, which is in the JS bundle.
Why it exists: Emergency debugging artefacts were committed and never deleted; `00-map.md` §0.6 already classifies them as dead SQL.
Containment (minutes): Delete `COMPLETE_RLS_FIX.sql`, `DATABASE_FIX_DISABLE_RLS.sql` and `migrations/HOTFIX_disable_group_members_rls.sql` from the tree. They have no callers and no documented purpose. (Note this pass is read-only; the deletion is a recommendation, not an action taken.)
Correct fix: The deletion, plus revoke the anon grants (`REVOKE SELECT ON … FROM anon;` — Realtime does not need them; `postgres_changes` authorization runs through RLS, not through table grants), plus extend `scripts/rls-beta-audit.sql` to cover all nine tables and to fail on any `rowsecurity = false` and any policy whose `qual` is `true`.
Proof of fix: An unauthenticated `curl` against every table returns `[]` or an error; `pg_tables` shows `rowsecurity = true` for all nine; the audit script fails loudly if either regresses.
Depends on / conflicts with: A-02 (same operational root cause), A-05.

---

### [P3-A-25] No Content-Security-Policy, in an architecture where one XSS yields a durable session
Severity: P3 · Confidence: CONFIRMED · Area: web hardening
Location: `vercel.json:32-60` (HSTS, nosniff, frame-deny, referrer, permissions-policy, COOP — no CSP); rationale at `ARCHITECTURE.md:503`; Sentry DSN hardcoded at `index.tsx:20`
What is wrong: Every other standard header is set; CSP is deliberately omitted because "Clerk Frontend API host changes between `pk_test`/`pk_live`, and OAuth/Turnstile/CDN hosts were not fully verified". That reasoning is honest but the risk it accepts is larger here than in a typical app: script execution on the origin yields a Clerk session JWT, which A-10 upgrades into a durable session, and there is no server-side authorization layer that would notice. Separately, the Sentry DSN is hardcoded (`index.tsx:20`) — not a secret, but it does let anyone flood the ingest quota.
How to reproduce: `curl -I https://www.motamaati.in/` — no `Content-Security-Policy` header.
Blast radius: Amplifies any future XSS. Nothing is exploitable today from this finding alone.
Why it exists: Documented as deferred pending an origin inventory.
Containment (minutes): Ship a `Content-Security-Policy-Report-Only` header with the hosts currently known (`*.clerk.accounts.dev`, `*.clerk.com`, `clerk.motamaati.in`, `accounts.motamaati.in`, `*.supabase.co`, `*.ingest.us.sentry.io`, `'self'`) and read the violation reports for a week — that produces the origin inventory the note says is missing, at zero risk.
Correct fix: Promote the report-only policy to enforcing once clean, with `script-src 'self'` plus the Clerk hosts and no `unsafe-inline` (Vite's production build does not need it), and `connect-src` limited to Supabase, Clerk and Sentry.
Proof of fix: The header is present and enforcing; the app, Clerk sign-in, Google OAuth and Sentry all function; violation reports are empty.
Depends on / conflicts with: A-10, A-20.

---

### [P2-A-26] `debug_auth_check()` exists in the live database with no definition anywhere in the repo
Severity: P2 · Confidence: SUSPECTED · Area: RPC / unknown surface
Location: `lib/database.types.ts` (generated RPC list; `00-map.md` §0.3.2 records it as "listed in generated types; no definition in any SQL file in the repo"); no match for `debug_auth_check` in `**/*.sql`
What is wrong: `lib/database.types.ts` is generated from a live PostgREST instance, so a function with this name **exists in production**. Its body, its `SECURITY DEFINER`/`INVOKER` mode, and its grants are invisible from this repo. A function named `debug_auth_check` in a system whose entire boundary is RLS is exactly the kind of thing that returns claims, session state, or policy-evaluation results to whoever calls it. It is also never called by the app, so removing it costs nothing — if it is what the name suggests.
How to reproduce (this is the verification, not an exploit): `SELECT p.proname, p.prosecdef, pg_get_functiondef(p.oid), array_agg(a.privilege_type) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace LEFT JOIN information_schema.routine_privileges a ON a.routine_name=p.proname WHERE n.nspname='public' AND p.proname='debug_auth_check' GROUP BY 1,2,3;` Then, if it is granted to `authenticated` or `anon`, call it: `curl -s "$SB/rest/v1/rpc/debug_auth_check" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -d '{}'`.
Blast radius: Unknown — that is the finding. Same question applies to `get_current_user_person_id()`, also present in the generated types with no repo definition.
Why it exists: A debugging aid added through the dashboard during the Clerk cut-over and never committed or removed. This is the direct consequence of administering the database by pasting into the SQL editor.
Containment (minutes): Run the query above; if it is a debug helper, `DROP FUNCTION debug_auth_check();`.
Correct fix: Reconcile the whole live function set against the repo — `SELECT proname, prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'` — and commit or drop every function that has no source in `supabase/migrations/`. Then adopt migration tooling so this cannot recur (see A-02).
Proof of fix: The live function list is a subset of what the repo defines; `debug_auth_check` either has a committed definition and a justified grant, or does not exist.
Depends on / conflicts with: A-02, A-24.

---

### [P2-A-27] RLS helper functions are granted to `authenticated` and callable directly as RPCs
Severity: P2 · Confidence: CONFIRMED · Area: RPC surface
Location: `supabase/migrations/20260412000003:69-70` (`GRANT EXECUTE … i_am_member_of`, `i_created_group`), `supabase/migrations/20260728000000:74` (`i_can_see_person`); `requesting_user_id()` at `20260412000006:17-22` relies on default grants
What is wrong: All three helpers are `SECURITY DEFINER` and granted to `authenticated`, so they are reachable at `POST /rest/v1/rpc/i_am_member_of` with a `{"p_group_id": "<uuid>"}` body. The grants exist because the policies call them — but a policy calls them as the *table owner*, not as `authenticated`, so **the grants are not actually required for RLS to work**; they were added defensively. Each function answers only about the caller ("am I a member of X?"), and a v4 UUID is not guessable, so in isolation this is low value. It becomes useful in composition: A-04's public broadcast channel supplies a stream of real `groupId` values system-wide, and these RPCs then tell the attacker which of them they can reach — including groups they were force-added to (A-07, A-11) and do not yet know about.
How to reproduce: `curl -s "$SB/rest/v1/rpc/i_am_member_of" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"p_group_id":"<uuid harvested from the broadcast channel>"}'` → `true`/`false`.
Blast radius: An existence-and-reachability oracle over group UUIDs. Not a data leak on its own.
Why it exists: Copy-paste of the `GRANT EXECUTE … TO authenticated` idiom onto every helper, without checking whether the grant was needed.
Containment (minutes): `REVOKE EXECUTE ON FUNCTION i_am_member_of(uuid) FROM authenticated, anon, PUBLIC;` and likewise for `i_created_group(uuid)` and `i_can_see_person(uuid)`. **Test in staging first** — if any policy or RPC turns out to depend on the caller's own privilege for these, RLS breaks everywhere at once. This is the highest-blast-radius "small" change in this document; do not ship it casually.
Correct fix: The revoke, having first confirmed via `EXPLAIN` / a staging apply that every policy still evaluates. Long-term, keep helper functions out of the API schema entirely (define them in a non-exposed schema and reference them qualified), which removes the question.
Proof of fix: A direct RPC call returns `42501`; every policy still enforces correctly (run the full behavioural matrix from §2 against staging).
Depends on / conflicts with: A-04 (the composition), A-07, A-11.

---

### [P3-A-28] The 50 s Realtime JWT refresh has 10 s of margin against a 60 s TTL and is clamped when the tab is backgrounded
Severity: P3 · Confidence: SUSPECTED · Area: session lifecycle
Location: `contexts/SupabaseAuthContext.tsx:13` (`REALTIME_AUTH_REFRESH_MS = 50_000`), `:67-74` (the interval), `:7-12` (the comment asserting the 60 s TTL); no `visibilitychange` handler anywhere (`grep -rn visibilitychange` → 0 hits)
What is wrong: The refresh cadence is hard-coded against an assumed 60 s Clerk TTL that this audit cannot verify (dashboard setting, CG-3). Browsers clamp `setInterval` in hidden tabs — Chrome to ≥1 minute after a few minutes hidden, and it may freeze the timer entirely under memory pressure or in a frozen/bfcache state. A 60 s clamp erases the 10 s margin, so a backgrounded tab's WebSocket can carry an expired JWT. Nothing re-pushes the token on `visibilitychange`, on WS reconnect, or on `SUBSCRIBED` — so the socket stays authenticated-as-nobody until the effect re-runs (which happens only when `user` changes). Symptom: realtime events silently stop arriving after a tab has been in the background, and the user sees stale data with no indication.
How to reproduce: Sign in, background the tab for 10 minutes, then make a change from another device and foreground the tab. Whether the change appears without a reload is the test.
Blast radius: Stale data, not a security boundary failure (an expired JWT means fewer events, never more). Listed because the 10 s margin is the kind of assumption that should be written down and tested rather than assumed.
Why it exists: The interval was tuned to a TTL taken from Clerk's default, with no allowance for timer throttling.
Containment (minutes): Drop the interval to 30 s and add a `visibilitychange` listener that calls `setRealtimeAuth()` when the document becomes visible — about six lines in the same effect.
Correct fix: Stop polling: re-push the token from the channel's `subscribe((status) => …)` callback on `SUBSCRIBED`/`CHANNEL_ERROR`, and on `visibilitychange`. Confirm the actual TTL in the Clerk dashboard and put the real number in the comment at `:7-12`.
Proof of fix: After 10 minutes backgrounded, foregrounding the tab delivers a change made elsewhere within a second, with no reload.
Depends on / conflicts with: A-19.

---

### [P2-A-29] Every invite link the UI creates is an unlimited-use, 30-day bearer credential that nothing can revoke
Severity: P2 · Confidence: CONFIRMED · Area: invite flow
Location: `components/GroupFormModal.tsx:166` (`maxUses: null`, comment "Unlimited uses"), `services/supabaseApiService.ts:974` (`expiresInDays = 30`), `supabase/migrations/20260812000000:109`, `:213` (the `max_uses IS NULL` bypass), `services/supabaseApiService.ts:1209-1220` (`deactivateInvite`, **zero callers**)
What is wrong: The only invite-creation path in the UI hard-codes `maxUses: null`, and both RPCs skip the cap when it is NULL. So every link is good for unlimited joins for 30 days. There is no UI anywhere to revoke one: `deactivateInvite` exists and is exported, but `grep -rn "deactivateInvite" --include=*.tsx` returns nothing (`00-map.md` §0.6 lists it as a dead export). Consequences: a link forwarded once is a standing invitation to whoever holds it; a user removed by the creator can rejoin immediately with the same link (`accept_group_invite` has no notion of prior removal — it checks only current membership at `:222-234`); and the token, being plaintext in `group_invites`, is readable by every member (`:298-300`) forever.
How to reproduce: Create an invite, join with account B, have the creator remove B (`DELETE /rest/v1/group_members?group_id=eq.X&person_id=eq.B`), then have B re-POST `accept_group_invite` with the same token — B is a member again.
Blast radius: Every group that has ever shared a link. Removal is not durable, which makes the creator-only member-removal power (§5) largely theatrical.
Why it exists: `maxUses` is a supported column and a supported RPC argument; the UI simply never surfaced it, and the revoke function was written but never wired up.
Containment (minutes): Change `maxUses: null` to a finite default at `GroupFormModal.tsx:166` (the invite is shared to a specific person in the common flow, so `1`–`5` is right), and expose `deactivateInvite` on a "Revoke link" button — the function already exists and the RLS policy already permits it (`20260812000000:306-308`).
Correct fix: The containment, plus make removal durable: when a `group_members` row is deleted, record it (a `group_removals` table, or a `removed_at` tombstone) and have `accept_group_invite` refuse a person who was removed from that group unless re-invited explicitly. Also shorten the default expiry — 30 days for a link that grants access to financial history is generous.
Proof of fix: A link with `max_uses: 1` is rejected on the second accept; a removed member's re-accept is rejected; the Revoke button makes the link fail immediately.
Depends on / conflicts with: A-09, A-11, A-14.

---

### [P2-A-30] `updateGroup` rewrites membership as delete-all-then-reinsert, with no transaction
Severity: P2 · Confidence: CONFIRMED · Area: data integrity
Location: `services/supabaseApiService.ts:349-369`
What is wrong: Saving the group form issues three separate HTTP requests: update the group row, `DELETE FROM group_members WHERE group_id = …` (**all rows**), then `INSERT` the new member set. There is no transaction — PostgREST cannot span requests — so any failure between the delete and the insert (network drop, tab close, a single bad `person_id` failing the insert) leaves the group with **zero members**. Recovery is impossible from the client: with no members, `i_am_member_of` is false for everyone, and only the creator can insert members back (via the same form, which will itself work only for them). It also generates a `group_members` DELETE and INSERT storm on the Realtime channel for every save (and, per A-22, broadcasts each deleted row to every online user).
How to reproduce: As the creator, open Group Settings, add a member whose `person_id` you make invalid (devtools), and Save. The delete at `:350-353` succeeds; the insert at `:359-366` fails; the group is now empty.
Blast radius: One group per occurrence, but the group becomes unusable and self-service recovery is limited to the creator. Silent until someone notices the member list is empty.
Why it exists: Set-reconciliation was implemented as the simplest thing that produces the right final state, on the assumption that all three calls succeed.
Containment (minutes): Compute the diff on the client and issue only the actual adds and removes — `DELETE …&person_id=in.(<removed>)` and `INSERT` for the added — so a failure leaves a partially-correct membership instead of an empty one. ~10 lines, and it also removes the realtime storm.
Correct fix: A single `SECURITY DEFINER` RPC `set_group_members(p_group_id uuid, p_person_ids uuid[])` that does the diff inside one transaction, checks `i_created_group(p_group_id)` itself, and rejects an empty array. That collapses three round-trips into one, makes it atomic, and gives one place to enforce the "a group must always have at least one member" invariant that does not exist anywhere today.
Proof of fix: Forcing the insert to fail leaves the previous membership intact; saving with no changes issues no `group_members` writes at all.
Depends on / conflicts with: A-02 (with the hotfix live, this becomes the mechanism by which any user destroys any group's membership), A-14, A-22.

---

## 11. Coverage gaps

Each gap names the single artifact that would close it.

| # | Gap | Closing artifact |
|---|---|---|
| CG-1 | **The live policy set is unknown.** Everything in §2 and §7 is the repo's *intended* state. A-02, A-05, A-21 and A-24 all hinge on this. | `SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename, cmd, policyname;` **and** `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename;` run against production. |
| CG-2 | **Supabase dashboard configuration**: Clerk third-party auth provider settings (and whether the token carries `role`), Realtime publication membership, whether `verify_jwt` is on for `send-email`/`suggest-tag`, and whether `ALLOWED_ORIGINS` is set. Affects A-21, and the CORS assessment in §1.5. | A screenshot or API dump of the project's Auth → Third-party providers, Database → Replication, and Edge Functions → Secrets pages. |
| CG-3 | **Clerk dashboard configuration**: actual session-token TTL (the code assumes 60 s — §1.3, A-28), allowed origins/redirect URLs, whether user self-deletion is enabled (`SettingsModal.tsx:168-173` depends on it), attack-protection/rate-limit settings (§1.8), cookie attributes. | Clerk dashboard export, or a decoded live session JWT showing `exp - iat` and the `azp`/`aud` claims (the latter is also what A-10's fix needs). |
| CG-4 | **Git history is unavailable** — there is no `.git` directory. Nothing can be said about secrets committed and later removed, or about when any of these policies were introduced. | The upstream repo (`github.com/Ninzaro/Kharch-Baant`) cloned with full history, then `git log -p --all -S 'eyJ' -S 'service_role' -S 'mlsn.'`. |
| CG-5 | **`@clerk/backend`'s `verifyToken` internals** — exactly which claims it validates without `authorizedParties`. A-10's severity depends on this. | The pinned `@clerk/backend@2.16.0` source, or an empirical test: present a web-origin session JWT to `native-bridge` and see whether a ticket comes back. |
| CG-6 | **Clerk's `handleRedirectCallback` behaviour** on attacker-supplied `__clerk_created_session` — whether the `native-sso.html` gadget (§1.5) is exploitable or merely ugly. | `clerk-js@5` source for `handleRedirectCallback`, or an empirical test on a device with the app installed. |
| CG-7 | **`debug_auth_check()` and `get_current_user_person_id()`** — present in the generated types, absent from the repo. | `SELECT proname, prosecdef, pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace;` — this also reconciles the whole function set (A-26). |
| CG-8 | **Whether `supabase-schema.sql`'s seed rows exist in production** (`00-map.md` §0.1 notes fixed UUIDs `00000000-…-0001` "You", Alice, Bob). If they do, they are unclaimed `people` rows with known UUIDs — direct A-07 and A-01 targets with no discovery step needed. | `SELECT id, name, email, is_claimed FROM people WHERE id::text LIKE '00000000-%';` |
| CG-9 | **Nothing was executed.** No build, no typecheck, no unit tests, no Playwright, no smoke test, no query against the live database. Every "how to reproduce" in §10 is derived from source, not observed. | A staging Supabase project seeded from the intended migration set, plus two test accounts, against which the §10 reproductions can actually be run. |
| CG-10 | **Vercel project settings** — which env vars are set per environment, and whether preview deployments point at the *production* Supabase project (if they do, every preview URL is another origin holding a live anon key). | Vercel project → Environment Variables, filtered by environment. |

## 12. Suspicions / Unverified

Listed here rather than as findings because I cannot point at code that proves them.

1. **`native-sso.html` + `__clerk_created_session` may be more than a UI gadget.** §1.5 establishes that the page is a public, unauthenticated launcher that forwards arbitrary query parameters into `clerk.handleRedirectCallback` with no validation by app code. Whether a crafted `__clerk_created_session` can influence the victim's Clerk client depends entirely on `clerk-js` internals (CG-6). If it can, this is P0. Today it is a suspicion.
2. **`auth.role()` may be permanently false under Clerk**, making `ai_item_cache` dead and every expense classification a paid Gemini call (A-21, part 1). Marked SUSPECTED there; the closing artifact is one `SELECT auth.role();`.
3. **The `20260412000004` / `20260412000005` `i_created_group` divergence.** `20260412000004:35` compares `people.user_id = requesting_user_id()`; `20260412000005:53` compares `people.clerk_user_id = requesting_user_id()`. `CREATE OR REPLACE` means whichever ran last wins, and the repo cannot say which that was. Both columns are written by `ensure_my_person` (`20260813020000:64-65`), so both probably work today — but `anonymize_my_account` nulls both (`20260813000000:33-35`) and nothing else keeps them in sync. A single divergence between the two columns silently changes who owns every group. Closing artifact: `pg_get_functiondef` for `i_created_group` (part of CG-7).
4. **Backgrounded-tab timer clamping** (A-28) is browser-specific and may not bite in practice if supabase-js re-handshakes on reconnect. Marked SUSPECTED.
5. **Whether the anon `GRANT SELECT` statements in `enable_realtime.sql:20-24` were ever applied.** They are only dangerous in combination with RLS being off (A-24), but they are also unnecessary — Realtime authorization runs through RLS, not table grants — so their presence suggests someone was debugging a permission error by widening grants. Worth checking `information_schema.role_table_grants` for `grantee='anon'`.
6. **Preview deployments may share the production database** (CG-10). If so, every Vercel preview URL is an additional origin with a live anon key and a Clerk instance mismatch, which would explain some of the `origin_invalid` workarounds in `capacitor.config.ts:16-17`.
7. **`transactions.type` has an unknown CHECK constraint.** `00-map.md` §0.4.1 records "CHECK unknown"; the app writes `expense`/`settlement` and `types.ts:269` also allows `adjustment`. If the constraint is absent, `type` is a free string and the settlement/expense distinction — which drives the settle-up UI and the balance math — is not enforced anywhere. Pass 1.4 material, noted here because it is an authorization-adjacent trust-the-client issue.
8. **No webhook receiver exists for Clerk user deletion.** `00-map.md` §0.3.2 confirms zero webhooks. So a user deleted in the Clerk dashboard keeps a live `people` row, keeps their group memberships, and keeps appearing in balances — and their `clerk_user_id` remains set, so nobody else can ever claim that row. Not exploitable; a lifecycle gap that will produce support tickets.
