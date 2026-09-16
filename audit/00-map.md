# Pass 0 — Orientation Map

Audit date: 2026-09-07. Repo: `Kharch-Baant-main` (GitHub zip export, **no `.git` directory**, no `node_modules`).
Everything below is factual and cited. Judgement is deferred to Passes 1–3.

---

## 0.1 Stack detected

| Layer | What is actually in the repo | Evidence |
|---|---|---|
| Language | TypeScript 5.8 (`~5.8.2`), **non-strict** (`tsconfig.json` has no `strict`, `allowJs: true`) | `package.json:71`, `tsconfig.json` |
| Runtime target | Browser SPA (Vite 6, React 19.2) + Android WebView via Capacitor 7 | `package.json`, `capacitor.config.ts` |
| Node used by CI | Node 20 (Android workflow), `lts/*` (Playwright workflow); local machine has Node 24.12 / npm 11.6 | `.github/workflows/*.yml` |
| Package manager | npm (`package-lock.json` present, 834 packages resolved: 465 prod / 316 dev / 63 optional) | `npm audit --package-lock-only` |
| Monorepo | No. Flat single package; app source lives at **repo root** (`App.tsx`, `components/`, `services/` …), not under `src/`. `src/` contains only tests. | tree below |
| Client state | TanStack Query v5 (server state) + Zustand v5 (`selectedGroupId`, `theme` only, persisted to `localStorage['app-ui']`) | `lib/queryClient.ts`, `store/appStore.ts` |
| Server / DB | Supabase Postgres, accessed **directly from the browser** via PostgREST + RPC. There is no application server. | `lib/supabase.ts`, `services/supabaseApiService.ts` |
| Auth provider | **Clerk** (`@clerk/clerk-react` 5.x). Supabase Auth disabled (`persistSession:false`). Clerk session JWT is injected as `Authorization: Bearer` on every Supabase HTTP call and pushed into the Realtime socket. Supabase must be configured with Clerk as a third-party auth provider (dashboard setting, not in repo). | `lib/supabase.ts:33-71`, `contexts/SupabaseAuthContext.tsx` |
| Authorization | Postgres Row Level Security policies + `SECURITY DEFINER` helper functions keyed on `requesting_user_id()` = JWT `sub` | `supabase/migrations/2026*.sql` |
| Realtime | Supabase Realtime: `postgres_changes` on 5 tables (unfiltered `event:'*'`), plus a client-sent `broadcast` event `tx` on the `public:transactions` channel | `services/supabaseApiService.ts:389-487`, `services/queries.ts:48-217` |
| Edge / serverless | 3 Supabase Edge Functions (Deno): `send-email` (MailerSend), `suggest-tag` (Gemini), `native-bridge` (Clerk sign-in token for Android) | `supabase/functions/*/index.ts` |
| Background jobs | **None.** No cron, no pg_cron, no scheduled functions. `cleanup_expired_invites()` exists as a DB function but nothing calls it (`supabaseApiService.ts:1225` export is unused per knip). | grep |
| Webhooks | **None.** No Clerk webhook receiver; user rows are created lazily from the client on login (`ensure_my_person` RPC). | `contexts/SupabaseAuthContext.tsx:56-60` |
| File storage | **None.** Avatars are stored as base64 data URLs in `people.avatar_url TEXT` (upload UI in Settings). No Supabase Storage bucket. | `supabaseApiService.ts:1232-1243`, AGENTS.md "Avatars" |
| Notifications | `react-hot-toast` in-app only. Email via `send-email` Edge Function (only the group-invite path is actually called from the client). No push. | `services/emailService.ts`, `supabaseApiService.ts:1044-1058` |
| Error tracking | Sentry (`@sentry/react` 10.x) with **hardcoded DSN**, `sendDefaultPii: true`, session replay 10% / 100% on error, `Sentry.setUser({id,email,username})` | `index.tsx:19-30`, `App.tsx:58-64` |
| AI | Gemini via Edge Function only (client key removed in "Phase A"); keyword classifier + shared `ai_item_cache` table first | `services/tagClassifier.ts` |
| Styling | Tailwind 3 via PostCSS; design tokens in `index.css` | `tailwind.config.js` |
| PWA | `vite-plugin-pwa`, prompt-based update, SW runtime cache rule targets `https://api.supabase.co/*` (which never matches a real `<ref>.supabase.co` host — rule is inert) | `vite.config.ts:66-81` |
| Web hosting | Vercel (SPA rewrites + security headers, no CSP) — production domain `www.motamaati.in`, older `kharch-baant-psi.vercel.app` | `vercel.json`, `index.html:19`, `vercel-diagnostic.js:7` |
| Android | Capacitor 7, `com.kharchbaant.app`, `versionCode` default 7 / `versionName 1.0.6` locally; CI overrides with `github.run_number`; signed AAB uploaded to **Google Play internal track on every push to main** | `android/app/build.gradle:24-25`, `.github/workflows/android-ci.yml` |
| Tests | Vitest + Testing Library (unit), Playwright (e2e, chromium only). 3,437 test LOC. | `vitest.config.ts`, `playwright.config.ts` |
| Lint / format | **None committed** (no eslint/prettier config). | grep |

### Deployment status and real users — conclusion

**Conclusion: this is a live production system with a public domain, a store listing pipeline, and almost certainly real user data. Treat the database as production.** Confidence: LIKELY (cannot query the DB; every repo signal points the same way).

Evidence:
- Production domain hardcoded in 6 places (`www.motamaati.in`): `index.html:19,26`, `capacitor.config.ts:19`, `components/auth/clerkAppearance.ts:22`, `hooks/useNativeOAuth.ts:7`, `supabase/functions/native-bridge/index.ts:27-30`, `android/app/src/main/AndroidManifest.xml` (App Links with `autoVerify`).
- Clerk **production** instance with custom domains `clerk.motamaati.in` / `accounts.motamaati.in` (`public/native-sso.html:36`, `capacitor.config.ts:29-33`).
- Sentry production DSN `o4511203625795584.ingest.us.sentry.io/4511203644342272` (`index.tsx:20`), `enabled: import.meta.env.PROD`.
- Android CI publishes to Google Play **internal testing** on every push to `main` (`android-ci.yml:96-111`); `docs/play-store-launch.md` describes closed testing; `distribution/whatsnew/en-US.txt` exists.
- `.vercel-rebuild-trigger` dated 2025-10-19; `versionName 1.0.6` implies at least 6 shipped builds.
- Operational fix logs referencing real accounts: `DUPLICATE_USER_CLEANUP.sql`, `DUPLICATE_USER_FIX_SUMMARY.md`, `USER_ISOLATION_FIXES.md`, `CROSS_DEVICE_TESTING.md`, `MULTI_USER_EXPERIENCE.md`.
- Playwright config supports `PLAYWRIGHT_BASE_URL=https://www.motamaati.in` (`.env.test.example:7`) and authenticated specs run against a "dedicated Clerk user" that must already own groups (`tests/helpers/group.ts:10`).
- Seed data in `supabase-schema.sql:117-155` uses fixed UUIDs (`00000000-…-0001` "You", Alice, Bob…). `constants.ts:4` still exports `CURRENT_USER_ID = '00000000-0000-0000-0000-000000000001'` (unused). Whether seed rows exist in production is unknown.

### Where it deliberately differs from Splitwise

- **Placeholder people**: members can be added by name/email without an account (`people.is_claimed=false`, `source='manual'`) and later **claimed by email** on sign-up (`claim_person_by_email`, `ensure_my_person`). Splitwise requires an account per member.
- **Group creator as admin** with a **deletion-request workflow**: non-creators file `group_deletion_requests`; creator approves/rejects (`supabaseApiService.ts:220-324`).
- **Archive gate**: non-creators can archive only when the whole group is settled; creators can only delete (`supabaseApiService.ts:8-31`).
- **Payment sources** (card/UPI/cash) tracked per user, per transaction.
- **Multi-payer expenses** (`transactions.payers` JSONB) alongside a legacy `paid_by_id`.
- **AI category tagging** with a global shared cache table.
- **"Cute icons"** — a per-group flag that appends an emoji to expense descriptions (mutates the description text).
- **Share-as-image** summaries (`html2canvas`).
- No per-expense comments/activity feed, no receipts/attachments, no currency conversion, no recurring expenses, no friend graph outside groups.

---

## 0.2 Repo facts

| Metric | Value |
|---|---|
| Files (excl. `node_modules`, `android/`) | 258: 60 `.md`, 59 `.tsx`, 53 `.ts`, 43 `.sql`, 10 `.mjs`, 6 `.html`, 5 `.ps1`, 4 `.js` |
| App source LOC (ts/tsx, excl. tests/config/edge) | **13,373** |
| Edge function LOC (Deno) | 651 across 4 files |
| Test LOC | 3,437 (unit 3,185 + Playwright 252) |
| SQL LOC | 1,767 in `supabase/migrations/` (17 files) + 1,299 in `migrations/` (17 files) + 8 more SQL files at root / `scripts/` |
| Markdown | **46 files at repo root**, 10,338 lines total. AGENTS.md itself labels most as "often stale". |
| Direct dependencies | 23 prod + 21 dev (`package.json`) |
| Resolved packages | 834 |
| `npm audit` | 0 vulnerabilities (see §0.6) |
| `any` occurrences (app code) | 103 — clusters: `supabaseApiService.ts` 32, `hooks/useModals.ts` 30 (dead file), `queries.ts` 9 |
| `@ts-ignore` / `@ts-expect-error` | 0 |
| `eslint-disable` | 2 |
| `TODO/FIXME/HACK` | 0 in code (all "known issues" live in root markdown instead) |
| `console.*` calls in app code | 103 |
| `catch` blocks whose only action is `console.*` | 34 |
| Git history | **Unavailable** — not a git checkout. Commit frequency, message quality and authoring-style analysis cannot be done. `deploy-main.ps1` shows the workflow was `git add -A && git commit -m "chore: deploy latest changes" && git push origin main` (no branches, no PRs). Remote: `github.com/Ninzaro/Kharch-Baant`. |

### Largest source files

| File | LOC |
|---|---|
| `services/supabaseApiService.ts` | 1,308 |
| `App.tsx` | 1,050 |
| `components/TransactionFormModal.tsx` | 700 |
| `lib/database.types.ts` (generated) | 669 |
| `hooks/useModals.test.ts` (tests a dead hook) | 663 |
| `hooks/useModals.ts` (dead) | 567 |
| `components/GroupFormModal.tsx` | 543 |
| `migrations/20250126_migrate_to_supabase_auth.sql` (superseded) | 432 |
| `components/SettleUpModal.tsx` | 415 |
| `types.ts` | 367 |

### LOC by directory (ts/tsx/js/mjs/sql/html)

```
.                 2775 LOC  22 files   (App.tsx 1050, types.ts 367, scripts, SQL, configs)
components        6178 LOC  42 files
components/auth    543 LOC   8 files
components/invite  308 LOC   1 file
components/icons   133 LOC   1 file
contexts           189 LOC   2 files
hooks             1428 LOC   5 files   (663 of it is a test for a dead hook)
lib                786 LOC   3 files
services          2375 LOC  10 files
store               46 LOC   1 file
utils              631 LOC   5 files
src/test          ~3185 LOC 17 files
tests              252 LOC   4 files
scripts           1027 LOC   9 files
supabase/functions 651 LOC   4 files
supabase/migrations 1767 LOC 17 files
migrations        1299 LOC  17 files
public             376 LOC   5 html
```

### Evidence of multiple authoring generations (in lieu of git history)

- Two generations of tree dumps checked in as UTF-16 Windows `tree` output: `structure.txt`, `components.txt`. They list files that no longer exist (`DebugPanel.tsx`, `ApiStatusIndicator.tsx`, `ProtectedRoute.tsx`, `LoginForm.tsx`, `SignInForm.tsx`, `SignupForm.tsx`, `GroupList.test.tsx`, `HomeScreen.test.tsx`).
- `knip-report.json` (98 KB, UTF-16) is a committed dead-code report that references a `.claude/worktrees/quizzical-wescoff/` tree — parallel AI worktrees were in use.
- `.agent/rules/byterover-rules.md`, `.github/copilot-instructions.md`, `AGENTS.md` (Byterover MCP instructions), `docs/superpowers/` — at least four different assistant harnesses left configuration behind.
- Three auth eras coexist in SQL: Supabase Auth (`supabase-auth-setup.sql`, `migrations/20250126_migrate_to_supabase_auth.sql`), a Clerk cut-over (`supabase/migrations/CLERK_AUTH_MIGRATION.sql`), and the current Clerk-JWT RLS (`supabase/migrations/20260412*`).
- `SUPABASE_AUTH_MIGRATION_PLAN.md` (26 KB) plans a migration that AGENTS.md says is "stale; Clerk is permanent".
- `ARCHITECTURE.md` (35 KB, "last verified 2026-04-25") contradicts the code in at least 12 places (listed in §0.9).

---

## 0.3 Entry points

### 0.3.1 Client screens (no router — view is `appStore.selectedGroupId` + URL sniffing in `App.tsx`)

| Screen | Component | How reached |
|---|---|---|
| Loading / "Connecting to authentication" | `App.tsx:1003-1026` | Clerk not loaded |
| SSO finish | `components/auth/SsoFinish.tsx` | path `/sso-callback`, `native-sso`, `__clerk_status`, or pending native SSO flag (`App.tsx:928-937`) |
| Invite landing (pre-auth) | `components/invite/InvitePage.tsx` | path `/invite/<token>` while signed out; token also written to `localStorage['pendingInviteToken']` (`App.tsx:969-990`) |
| Welcome (native only) | `components/auth/WelcomeScreen.tsx` | signed out on Capacitor |
| Sign in / sign up | `components/auth/AuthScreen.tsx` (Clerk `<SignIn/>` + native Google button) | signed out |
| Home / dashboard | `components/HomeScreen.tsx` | signed in, `selectedGroupId == null` |
| Group view | `components/GroupView.tsx` (+ `GroupList` sidebar, `Dashboard`, `TransactionList`, `MemberBalances`, `FilterBar`, `GroupBalancesModal`, `GroupSummaryModal`, `ShareModal`, `DateFilterModal`) | `selectedGroupId` set |
| Modals owned by `App.tsx` | `TransactionFormModal`, `GroupFormModal` (+ `MemberInviteModal`, share sheet), `ConfirmDeleteModal`, `PaymentSourceFormModal`, `PaymentSourceManageModal`, `SettleUpModal`, `ArchivePromptModal`, `AddActionModal` (+ `GroupSelectionList`), `SettingsModal` (+ `AboutSection`, `AdminDeletionRequestsPanel`, `ArchivedGroupsModal`, `DangerZone`, `DataExport`, `ThemeToggle`), `TransactionDetailModal`, inline "Leave Group?" `BaseModal` | 15 independent `useState` flags in `App.tsx:110-128` |
| Static pages (served by Vercel rewrites) | `public/privacy.html`, `public/account-deletion.html`, `public/native-sso.html`, `public/check-env.html`, `public/generate-icons.html` | direct URL |
| Android deep links | `kharchbaant://*`, `kharchbaant://sso-callback`, `https://(www.)motamaati.in/sso-callback`, `https://(www.)motamaati.in/invite/*` | `AndroidManifest.xml` intent filters → `utils/nativeDeepLinks.ts` |

### 0.3.2 Server-side entry points (the browser talks to these directly)

**PostgREST table endpoints used by the client** (`services/supabaseApiService.ts`, `services/apiService.ts`, `services/tagClassifier.ts`, components that bypass the façade):

| Table | Client operations found | Where |
|---|---|---|
| `groups` | select, insert, update, delete | `supabaseApiService.ts:2-47,136-217,326-373` |
| `group_members` | select, insert, delete | `supabaseApiService.ts:12,56-59,198-205,264,349-366,502-505,766-787,977-982`; `apiService.ts:52-71` |
| `transactions` | select, insert, update, delete | `supabaseApiService.ts:14,265,490-696` |
| `payment_sources` | select, insert, update, delete | `supabaseApiService.ts:699-756` |
| `people` | select, insert (fallback path), update | `supabaseApiService.ts:577-608,803-806,861-911,1232-1291` |
| `group_invites` | select, insert, update | `supabaseApiService.ts:994-1006,1194-1220` |
| `email_invites` | insert | `supabaseApiService.ts:1030-1039` |
| `group_deletion_requests` | select, insert, update | `supabaseApiService.ts:225-323` (typed as `any`) |
| `ai_item_cache` | select, insert | `services/tagClassifier.ts:14-40` |

**RPC (Postgres functions callable via `/rest/v1/rpc/*`)** — declared in `lib/database.types.ts:462-538`:

| Function | Security | Called from client? |
|---|---|---|
| `ensure_my_person(p_name, p_email)` | DEFINER, authenticated only | yes — every login (`supabaseApiService.ts:848`) |
| `claim_person_by_email(p_email, p_clerk_id, p_name)` | DEFINER, authenticated only | fallback path only (`:872`) |
| `create_unclaimed_person(p_name, p_email, p_avatar_url)` | DEFINER, authenticated only | yes (`:821`) |
| `find_person_by_email(p_email)` | DEFINER, authenticated only | yes (`:835`) |
| `get_invite_preview(p_token)` | DEFINER, **anon + authenticated** | yes (`:1078`) |
| `accept_group_invite(p_token)` | DEFINER, authenticated only | yes (`:1147`) |
| `anonymize_my_account()` | DEFINER, authenticated only | yes (`:1295`) |
| `cleanup_expired_invites()` | (INVOKER, from `migrations/20251019_add_invite_system.sql:64`) | exported, **never called** |
| `generate_invite_token()` | INVOKER | never called (client generates tokens in JS `:930-938`) |
| `get_current_user_person_id()` | from Supabase-Auth era | never called |
| `debug_auth_check()` | listed in generated types; **no definition in any SQL file in the repo** | never called |
| RLS helpers `requesting_user_id()`, `i_am_member_of(uuid)`, `i_created_group(uuid)`, `i_can_see_person(uuid)` | DEFINER, granted to `authenticated` — callable via RPC by any signed-in user | not called by client, but exposed |

**Edge Functions** (`POST <supabase-url>/functions/v1/<name>`):

| Function | Auth | Called from |
|---|---|---|
| `send-email` | own JWT verification via `_shared/auth.ts:requireAuthSub` (getClaims → getUser → optional HS256); per-isolate rate limit 20/min/user; CORS `*` unless `ALLOWED_ORIGINS` set | `services/emailService.ts:86` (only `group_invite` type is reachable from UI) |
| `suggest-tag` | same helper; 30/min/user | `services/geminiService.ts:34` |
| `native-bridge` | `verify_jwt=false` at platform level (`supabase/config.toml`); verifies Clerk session JWT with `@clerk/backend verifyToken`; 10/min/user; CORS allow-list defaults to motamaati.in | `services/nativeAuthBridge.ts` (Android Google sign-in) |

**Database triggers**: `update_*_updated_at` BEFORE UPDATE on `people`, `groups`, `payment_sources`, `transactions`, `group_invites` (`supabase-schema.sql:110-113`, `migrations/20251019_add_invite_system.sql:59`). A Supabase-Auth-era trigger `on_auth_user_created` was created in `supabase-auth-setup.sql:203` and dropped in `CLERK_AUTH_MIGRATION.sql:213`.

**Realtime channels** (client subscribes; server = Supabase Realtime):

| Channel topic | Listeners | Filter |
|---|---|---|
| `public:groups` | `postgres_changes` `*` on `groups` | none (RLS decides delivery) |
| `public:transactions` | `postgres_changes` `*` on `transactions` **and** `broadcast` event `tx`; the same topic is also used as a **publisher** by `_broadcastTxChange` | none |
| `public:payment_sources` | `postgres_changes` `*` | none |
| `public:people` | `postgres_changes` `*` | none |
| `public:group_members` | `postgres_changes` `*` | none |
| `heartbeat` | status only (`components/RealtimeStatus.tsx`) | — |

Scheduled jobs: none. Webhooks: none.

---

## 0.4 Data layer

### 0.4.1 Tables — as the client currently believes them to be (`lib/database.types.ts`, generated against PostgREST 13.0.5)

The generated types are the only artifact that reflects a real database rather than an intended one. Column sets below come from there; constraints come from the SQL files that (probably) created them.

**`people`**
| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | default `uuid_generate_v4()` |
| `name` | text | no | |
| `avatar_url` | text | **no** | empty string = initials; base64 data URL for uploads (unbounded size) |
| `email` | text | yes | partial unique index `people_email_unique WHERE email IS NOT NULL` (`supabase/migrations/20260405000000:35`) |
| `clerk_user_id` | text | yes | UNIQUE (`migrations/20250101_add_clerk_user_id_to_people.sql:7`); the identity column RLS actually uses |
| `user_id` | text | yes | duplicate of `clerk_user_id` (written by `ensure_my_person`/`claim_person_by_email`); typed `TEXT` per `CLERK_AUTH_MIGRATION.sql:56` |
| `auth_user_id` | text \| null in types; declared `UUID` in `migrations/20250126_migrate_to_supabase_auth.sql` | yes | Supabase-Auth-era; comment at `supabaseApiService.ts:884` says inserting a Clerk id here fails → it is uuid in prod |
| `is_claimed` | boolean | no | default false |
| `source` | text | no | default `'manual'`; free string — app writes `manual`/`self`/`deleted`; `types.ts:1` allows `phonebook`/`email_invite` too; no CHECK |
| `created_at`, `updated_at` | timestamptz | yes | trigger maintained |

Three identity columns (`clerk_user_id`, `user_id`, `auth_user_id`) for one identity.

**`groups`**
| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | |
| `name` | text | no | |
| `currency` | text | no | default `'USD'`; **free string, no CHECK**; UI default `'INR'` |
| `group_type` | text | no | CHECK in (`trip`,`family_trip`,`flat_sharing`,`expense_management`,`other`) (`supabase-schema.sql:21`) |
| `trip_start_date`, `trip_end_date` | date | yes | CHECK: trip types require both, non-trip types require both NULL (`supabase-schema.sql:24-27`) |
| `created_by` | text | yes | **No FK** (types show `Relationships: []`). App writes the creator's `people.id` UUID as text (`App.tsx:441`, `supabaseApiService.ts:178`); RLS accepts either a person UUID or a Clerk id (`20260412000005:38-57`). `migrations/20251116` tried to add it as `UUID REFERENCES people(id)` — that version evidently did not win. |
| `is_archived` | boolean | yes | index `idx_groups_is_archived` |
| `enable_cute_icons` | boolean | no | default true (`20260412000004:17`) |
| `created_at`, `updated_at` | timestamptz | yes | |

**`group_members`**
| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | |
| `group_id` | uuid FK→groups ON DELETE CASCADE | no | index |
| `person_id` | uuid FK→people ON DELETE CASCADE | no | index |
| `created_at` | timestamptz | yes | |
| — | | | UNIQUE(`group_id`,`person_id`). No role column: "admin" = `groups.created_by`. |

**`transactions`**
| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | |
| `group_id` | uuid FK→groups CASCADE | no | index |
| `description` | text | no | emoji appended by "cute icons" |
| `amount` | **numeric(12,2)** | no | CHECK `amount > 0`; read as JS `number` (`supabaseApiService.ts:95`) |
| `paid_by_id` | uuid FK→people (**no cascade**) | no | index |
| `payers` | jsonb | yes | `[{personId, amount}]`; no CHECK that sum = amount |
| `date` | date | no | index |
| `tag` | text | no | CHECK in 10 tags |
| `payment_source_id` | uuid FK→payment_sources | yes | app deletes payment sources while referenced → FK error surfaces as toast (`App.tsx:529`) |
| `comment` | text | yes | |
| `split_mode` | text | no | CHECK in (`equal`,`unequal`,`percentage`,`shares`) |
| `split_participants` | jsonb | no | `[{personId, value}]`; **no CHECK on sum, membership, or count** |
| `type` | text | default `'expense'` | added by `scripts/migrations/20251004_add_type_to_transactions.sql`; CHECK unknown; app writes `expense`/`settlement`; `types.ts:269` also allows `adjustment` |
| `created_at`, `updated_at` | timestamptz | yes | |
| — | | | **No `created_by`, no `updated_by`, no version/revision column, no audit table.** |

**`payment_sources`**
| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | |
| `name` | text | no | |
| `type` | text | no | CHECK in (`Credit Card`,`UPI`,`Cash`,`Other`) |
| `details` | jsonb | yes | card issuer/last4 or UPI id |
| `user_id` | text | yes | app writes person UUID (`supabaseApiService.ts:726`) |
| `created_by` | text | yes | **FK → `people.clerk_user_id`** (types `:331-337`); never written by the app |
| `is_active` | boolean | yes | default true; partial index |
| `created_at`, `updated_at` | timestamptz | yes | |

**`group_invites`**
| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | |
| `group_id` | uuid FK→groups | no | |
| `invite_token` | text | no | UNIQUE (per `migrations/20251019_add_invite_system.sql`), index |
| `invited_by` | uuid FK→people | no | |
| `expires_at` | timestamptz | no | default now()+30d |
| `max_uses` | int | yes | null = unlimited |
| `current_uses` | int | yes | |
| `is_active` | boolean | yes | |
| `created_at`, `updated_at` | timestamptz | yes | |

**`email_invites`**: `id`, `group_id` FK, `group_invite_id` FK, `email` (no unique), `invited_by` FK→people, `sent_at`, `mailersend_message_id`, `mailersend_status`, `status` (free text; app expects `pending|accepted|expired`), `accepted_at`, `accepted_by` FK→people, `created_at`.

**`group_deletion_requests`**: `id`, `group_id` FK→groups CASCADE **UNIQUE** (one request per group, ever — `migrations/20251116:18`), `requested_by` FK→people, `status` CHECK (`pending|approved|rejected`), `approved_by` FK→people, `approved_at`, `created_at`.

**`ai_item_cache`**: `normalized_name` text PK, `category` CHECK in tags, `source` CHECK (`keyword|gemini`), `created_at`. Global, shared across all users; any authenticated user may insert.

Tables present in SQL but **absent from the generated types** (so absent from the live DB or never applied): `user_profiles` (`supabase-auth-setup.sql:12`).

### 0.4.2 Indexes

Present (from SQL): `group_members(group_id)`, `group_members(person_id)`, `transactions(group_id)`, `transactions(paid_by_id)`, `transactions(date)`, `transactions(tag)`, `transactions(type)`, `groups(created_by)`, `groups(is_archived)`, `people(clerk_user_id)`, `people(email)` (+ partial unique), `people(auth_user_id)`, `payment_sources(user_id)`, `payment_sources(created_by)`, `payment_sources(is_active) WHERE true`, `group_invites(invite_token|group_id|expires_at|is_active)`, `email_invites(email|group_id|status|group_invite_id)`, `group_deletion_requests(group_id|status)`.

Missing for actual query patterns: none critical at current scale; `transactions.group_id IN (…)` + `ORDER BY date` is covered by two separate btree indexes only.

### 0.4.3 Migration state — does it match the schema in use?

**It cannot be determined from the repo, and the repo itself says so.** Facts:

- SQL lives in **four** places with **no ordering or applied-state tracking**: root (`supabase-schema.sql`, `supabase-auth-setup.sql`, `COMPLETE_RLS_FIX.sql`, `DATABASE_FIX_DISABLE_RLS.sql`, `DUPLICATE_USER_CLEANUP.sql`, `migration-add-columns.sql`), `migrations/` (17 files incl. 7 `HOTFIX_*`, `COMPLETE_DATABASE_MIGRATION.sql`), `scripts/migrations/` (2), `supabase/migrations/` (17, of which `CLERK_AUTH_MIGRATION.sql` is untimestamped).
- Every file in `supabase/migrations/2026*` carries the banner "NOTE: Apply manually via Supabase dashboard SQL editor." There is no `supabase db push` history, no `schema_migrations` reference, and `supabase/config.toml` contains only an edge-function flag.
- The same policy names are created and dropped across ≥6 files (e.g. `"Users can insert groups"` in 8 files). The final intended state is the union of `20260412000005` → `…06` → `…07` → `…08` → `20260728000000` → `20260812000000` → `20260813*`.
- `migrations/HOTFIX_reset_all_policies.sql` creates eight `USING (true)` policies (`groups_select_all`, `groups_insert_all`, `groups_update_all`, `groups_delete_all`, `group_members_select_all`, `group_members_insert_all`, `group_members_update_all`, `group_members_delete_all`). **No file in the repo drops them.** Phase A (`20260728000000:23-27`) only drops policies named `"Allow all operations"`, and the audit script `scripts/rls-beta-audit.sql:19-27` only looks for names matching `%allow all%`. If the hotfix was ever run on production, it is still in force. (This is Pass 1 material; noted here because it is a migration-state fact.)
- `group_deletion_requests` has RLS **enabled** by Phase A (`20260728000000:19`) and **zero policies anywhere in the repo** → either the feature is dead (all reads/writes denied) or RLS was never enabled on it (all reads/writes open). Both states are wrong; which one is live is unknown.
- `supabase-schema.sql` (the file README says to run first) creates `people` with only `name`/`avatar_url` and no `email`/`clerk_user_id`; a fresh install following README + the listed 4 migrations would still be missing `type`, `payers`, `is_active`, `group_invites`, `email_invites`, `group_deletion_requests`.
- `lib/database.types.ts` was regenerated after the Phase B RPCs existed (they are hand-annotated `:511-518`), so it is the best proxy for production as of roughly 2026-08.

---

## 0.5 Build, run, test commands — what exists and whether it passes

| Command | Exists | Result in this audit |
|---|---|---|
| `npm install` | — | **Not run** (rule: no package installation). Consequently none of the commands below can execute: there is no `node_modules`. |
| `npm run build` (`vite build`) | yes | **Not runnable** here. |
| `npx tsc --noEmit` | no script; tsconfig has `noEmit` | **Not runnable** without deps. Expectation: non-strict config will pass; `App.tsx:239,266,557,571` reference `error.message` on `unknown` catch bindings, which only compiles because `strict` is off. |
| `npm run test:run` (`vitest run`) | yes | **Not runnable**. Uses jsdom + mocked Supabase client (`src/test/setup.ts:15-28`) — no real DB, so it *would* be safe to run once deps exist. |
| `npm run test:e2e` (`playwright test`) | yes | **Not run and must not be run casually**: authenticated specs log into a real Clerk account and open a real group in whichever Supabase project `.env.local` points at (`tests/helpers/group.ts`). The unauthenticated project only reads pages. |
| `npm run test:smoke` | yes | **Not run**: performs `SELECT` on `groups`/`people` against the configured project with the anon key (`scripts/smoke-test.mjs:37-43`). Read-only, but targets a real project. |
| `node scripts/smoke-edge-functions.mjs` | yes | **Not run**: calls deployed edge functions; would attempt to send email if a JWT were provided. |
| `npm run seed:schema` | yes | **DESTRUCTIVE** (`psql -f supabase-schema.sql` re-creates tables) — never run. |
| `npm audit --package-lock-only` | — | **Run.** Output: |

```
vulns: {"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
deps:  {"prod":465,"dev":316,"optional":63,"peer":0,"peerOptional":0,"total":834}
```

Coverage-gap entry: build, typecheck, unit tests and lint results are unverified in this audit. What the repo says about them: `vitest.config.ts:53-58` records measured coverage of **10.76% statements / 68.94% branches / 31.29% functions** (2026-04-22) and sets thresholds just below that; `ARCHITECTURE.md:396` says "99 unit tests across 10 files" (now 17 files, ~150 `it()`s by grep).

Broken utility scripts (would fail immediately): `test-env.mjs` imports `./utils/envValidation.js` which does not exist; `test-gemini.mjs` imports a `.ts` file from `.mjs` and reads a client Gemini key that was removed; `inspect-db.mjs` is a 0-byte file; `vercel-diagnostic.js` is a browser-console paste script, not a Node script.

---

## 0.6 First-pass unreachable-code estimate

Method: import graph over `components/ hooks/ contexts/ services/ utils/ lib/ store/` (static `import` and `import()`), cross-checked with a string grep for dynamic/string references, and with the committed `knip-report.json`.

**Files with zero importers (genuinely orphaned — no dynamic import or string reference found in app code):**

| File | LOC | Note |
|---|---|---|
| `contexts/ModalContext.tsx` | 51 | AGENTS.md and ARCHITECTURE.md §6/§8 describe this as the live modal system. `App.tsx` never imports it; it uses 15 `useState` flags instead. |
| `hooks/useModals.ts` | 567 | only importer is the dead `ModalContext` |
| `hooks/useModals.test.ts` | 663 | 40 tests exercising the dead hook |
| `components/auth/UserProfile.tsx` | 178 | imports live services; nothing renders it |
| `components/auth/SimpleAuth.tsx` | 58 | |
| `components/auth/AuthLayout.tsx` | 41 | references `LoginForm`/`SignupForm` which no longer exist |
| `components/CurrencySelector.tsx` | 24 | |
| `components/LanguageSelector.tsx` | 24 | |
| `services/nativeGoogleAuth.ts` | 236 | superseded native-auth generation; has a test |
| `src/test/services/nativeGoogleAuth.test.ts` | 62 | |
| `utils/paymentSourceMetrics.ts` | 39 | `App.tsx:145-166` re-implements the same computation inline |
| `src/test/utils/paymentSourceMetrics.test.ts` | 284 | |
| root scripts `test-env.mjs`, `test-gemini.mjs`, `vercel-diagnostic.js`, `inspect-db.mjs` | 169 | broken/empty |
| one-off codemods `scripts/cleanup-duplicate-tokens.mjs`, `migrate-design-tokens.mjs`, `spotcheck-theme.mjs` | 561 | rewrite source files in place; not referenced by any npm script |
| `constants.ts` | 4 | `CURRENT_USER_ID` unused (knip) |

Subtotal orphaned TS/JS: **≈2,960 LOC** (≈1,350 in app code, ≈1,010 in tests of dead code, ≈600 in scripts) — about **10% of app source** plus **29% of test LOC** testing code that cannot run in the app.

**Dead exports inside live files** (knip + grep): `supabaseApiService.ts` `getGroupInvites`, `deactivateInvite`, `cleanupExpiredInvites`, `mergePersonByEmail`; `apiService.ts` re-exports `updatePerson`, `mergePersonByEmail`, `ensureUserExists`; `emailService.ts` `sendWelcomeEmail`, `sendMemberAddedEmail`, `sendSettleUpEmail`, `sendNewExpenseEmail` (server handlers for these four email types are live and reachable by anyone with a JWT — Pass 2 material); `Icons.tsx` `SortAscIcon`, `SortDescIcon`; `supabaseApiService.ts:567-621` a 55-line email block whose only effect is three extra DB reads (the sends are commented out).

**Dead SQL** (never referenced by any doc as "apply this"): root `COMPLETE_RLS_FIX.sql` (24, disables RLS on 7 tables), `DATABASE_FIX_DISABLE_RLS.sql` (22), `DUPLICATE_USER_CLEANUP.sql` (48), `migration-add-columns.sql` (62), `supabase-auth-setup.sql` (220), `supabase/migrations/CLERK_AUTH_MIGRATION.sql` (214), all of `migrations/` (1,299) — **≈1,890 SQL lines** that are historical, several of them destructive if re-run.

**Dead dependencies** (declared, no import found): `@capacitor/keyboard`, `madge`, `@testing-library/user-event` (knip); `terser` (build uses `minify:'esbuild'`); `playwright` listed under `dependencies` (only `@playwright/test` is needed, and as a dev dep); `dotenv` only used by Node scripts; `workbox-window` not imported directly. `@capgo/capacitor-social-login` — import status to be verified in Pass 1.3.

**Reachable only via string/dynamic reference (not dead):** the 10 lazy modals in `App.tsx:22-31` (dynamic `import()`), `utils/preload.ts` factories, `public/*.html` (Vercel rewrites), `native-sso.html` (Clerk redirect target), Android `ClerkNativeAuthPlugin` (registered by name from `services/clerkNativeAuth.ts`).

**Documentation debt**: 46 root markdown files; AGENTS.md classifies ~35 of them as "treat as historical".

---

## 0.7 Request lifecycle — WRITE: creating an expense

Files touched, in order. Line refs are to this repo.

1. **UI** `components/GroupView.tsx` → `onAddExpense` prop → `App.tsx:611` sets `isTransactionModalOpen`.
2. **Form** `components/TransactionFormModal.tsx:283-364` `handleSubmit`:
   - Client-side validation only: `isSplitValid` (`:182-206`, epsilon 0.01 on unequal sum / percentage sum), `isPayerValid` (`:208-220`), amount `> 0`, non-empty description.
   - Optional network call for tag: `services/tagClassifier.ts:classifyDescription` → keyword → session cache → **`ai_item_cache` SELECT** → **Edge `suggest-tag`** → **`ai_item_cache` INSERT** (fire-and-forget).
   - Builds `participants` (`equal` → `value:1` per person; `shares` → `value||1`; `unequal`/`percentage` → raw typed numbers, `parseFloat`), `payers` (multi-payer, primary = largest), appends emoji to description if `enableCuteIcons`.
   - Calls `onSave(tx)` with `amount: Number(amount)` — a JS double.
3. **Composition root** `App.tsx:347-362` `handleSaveTransaction`: for create, `await api.addTransaction(selectedGroupId, transactionData)` then closes the modal. **No optimistic update, no cache write, no toast on failure** (`catch` → `console.error` only, `:359-361`). The comment says "realtime bridge will update cache".
4. **Façade** `services/apiService.ts:22` → `supabaseApiService.addTransaction`.
5. **Service** `services/supabaseApiService.ts:537-624`:
   - `supabase.from('transactions').insert({...}).select().single()` — one PostgREST `POST /rest/v1/transactions?select=*` with `Prefer: return=representation`. No client-generated id, no idempotency key.
   - **Transport** `lib/supabase.ts:55-65`: custom `fetch` attaches `Authorization: Bearer <Clerk session JWT>` (obtained from `window.Clerk.session.getToken()`, `:33-43`) and `apikey: <anon>`.
   - **Server-side validation**: Postgres column types and CHECKs only (`amount > 0`, `tag` enum, `split_mode` enum, FKs). Nothing validates `split_participants`, `payers`, `type`, or that `paid_by_id`/participants are group members.
   - **Authorization**: RLS policy `"Users can insert group transactions"` `WITH CHECK (i_created_group(group_id) OR i_am_member_of(group_id))` (`supabase/migrations/20260412000005:146-147`), evaluated through `requesting_user_id()` = JWT `sub` (`…06:17-22`). Any group member may insert; `paid_by_id` may be any `people.id` in the database.
   - **Response** → `transformDbTransactionToAppTransaction` (`:78-108`), `amount: Number(...)`.
   - **Broadcast** `_broadcastTxChange(groupId)` (`:481-487`, `:565`): lazily creates a channel with topic `public:transactions` and `send({type:'broadcast', event:'tx', payload:{groupId}})`.
   - **Email block** `:568-621`: if Supabase URL is set, performs 2–3 extra reads (`groups`, `people`, participants) and then does nothing (sends are commented out).
6. **Propagation to the writing device (A)**: nothing synchronous. Device A's transaction list updates only when Supabase Realtime delivers the `postgres_changes` INSERT for `transactions` to channel `public:transactions` (`services/queries.ts:88-116`) → `qc.setQueryData(qk.transactions(personId))` prepends the row (dedupe by id). If the socket is down or the JWT on the socket has expired, A's own expense does not appear until reload. (Contrast: the settle-up path `App.tsx:794-799` writes the cache immediately.)
7. **Propagation to other devices (B)**: (a) `postgres_changes` INSERT, delivered only if B's socket JWT passes RLS for that row; (b) the `broadcast` `tx` event → `qc.invalidateQueries(qk.transactions(personId))` → full refetch of **all** of B's transactions across **all** groups (`queries.ts:107-109`; `getTransactions` `:490-535` = 2 round trips, unbounded).
8. **Sentry**: nothing is captured on failure at step 3 (console only).

## 0.8 Request lifecycle — READ: loading a group's balances

1. **Bootstrap** `index.tsx` → `ClerkProvider` → `contexts/SupabaseAuthContext.tsx:37-97`: waits for Clerk, pushes JWT into Realtime (`setRealtimeAuth`), calls `ensure_my_person` RPC (`supabaseApiService.ts:846-858`) to obtain `person.id`, then starts a 50 s JWT refresh interval.
2. **Queries mount** `App.tsx:52-55` with `person.id` as the key for all four lists:
   - `useGroupsQuery` → `getGroups(personId)` (`supabaseApiService.ts:136-166`): `GET /groups?select=*,group_members!inner(person_id)&group_members.person_id=eq.<me>` **then one extra `GET /group_members` per group** (`transformDbGroupToAppGroup` `:54-75`) — N+1.
   - `useTransactionsQuery` → `getTransactions(personId)` (`:490-535`): `GET /group_members?person_id=eq.<me>` then `GET /transactions?group_id=in.(…)&order=date.desc` — **all transactions of all groups, no pagination**, on every load and every invalidation.
   - `usePeopleQuery` → `getPeople(personId)` (`:759-815`): 3 sequential queries.
   - `usePaymentSourcesQuery`.
   - All four pass through the same JWT-injecting fetch; RLS (`i_am_member_of` etc.) is the only server-side filter. The `personId` filters in these queries are client-supplied and redundant with RLS — a client can omit them and receive everything RLS allows.
3. **Cache** TanStack Query, keys `['groups', personId]`, `['transactions', personId]`, `['people', personId]`, `['paymentSources', personId]`; `staleTime` 30 s, `refetchOnWindowFocus: false` (`lib/queryClient.ts`). Nothing is persisted to disk; a reload refetches everything.
4. **Balance computation — entirely client-side, on every render**:
   - `App.tsx:131-135`: `groupTransactions = transactions.filter(groupId)` → `calculateGroupBalances` (`utils/calculations.ts:4-23`) → `Map<personId, number>` where positive = owed. Per transaction: credit payer(s) by `amount`/`payers[].amount`, debit each participant by `calculateShares` (`:30-71`) — **unrounded float division** for `equal`/`percentage`/`shares`; raw values for `unequal`.
   - `allSettled` = every balance `|b| < 0.01`; `userSettled` likewise (`App.tsx:138-139`) — these two client booleans are then **passed as arguments** into `deleteGroup`/`archiveGroup` (`:546,:567`).
   - `GroupView.tsx` / `MemberBalances.tsx` / `Dashboard.tsx` recompute independently from the same props (`Dashboard` also runs `simplifyGroupDebts`); `HomeScreen.tsx`/`BalanceBreakdownModal.tsx` use `getUserFacingDebts` (`calculations.ts:224-286`) which goes balances → greedy transfers → per-person lines, rounding only at the end.
   - `SettleUpModal.tsx:96-129` recomputes balances again for its preview.
5. **Server involvement in balances: none.** There is no balance table, no view, no RPC. Zero-sum is never checked anywhere (Pass 1.4).
6. **Freshness**: subsequent changes arrive via the five realtime bridges (`queries.ts`) patching the cache in place; no `updated_at`/version comparison; DELETE events use `old.id` (REPLICA IDENTITY FULL is set in `migrations/enable_realtime.sql:5-9`).

---

## 0.9 ARCHITECTURE.md / AGENTS.md vs code — drift found while mapping

Recorded here because both files are the "canonical" onboarding for the next assistant, and each contradiction is a place where a future one-line prompt will produce a fix in the wrong place.

| Claim | Reality |
|---|---|
| ARCH §6, §8, §15.6; AGENTS "Quick reality checks": modal state is `useModals()` + `ModalContext`, "resolved 2026-04-25" | `App.tsx:110-128` uses 15 `useState` flags; `ModalContext`/`useModals` have zero importers. ARCH §15.4 simultaneously says "15 modal `useState`s". |
| ARCH §4: `lib/supabase.ts` reads env via `getEnvValue` and "throws at module load if missing" | Direct `import.meta.env` reads; missing creds → `console.error` and a client pointed at `''` (`lib/supabase.ts:5-20`). |
| ARCH §6: `Sentry.ErrorBoundary` at top; `components/ErrorBoundary.tsx` "likely dead" | `index.tsx:17,84` uses the custom `ErrorBoundary`; it is live. |
| ARCH §9/§10, AGENTS "Identity model": `Group.createdBy` = Clerk user id | App writes `person.id` (people UUID) (`App.tsx:441` → `supabaseApiService.ts:178`); RLS tolerates both. |
| ARCH §10: table `deletion_requests` | Table is `group_deletion_requests`. |
| ARCH §10: "Realtime currently authenticates via anon apikey only" | Contradicted by ARCH §8 and by `setRealtimeAuth` in code. |
| ARCH §11: coverage thresholds 85/70 | `vitest.config.ts` thresholds are 8/65/28/8. ARCH §11 later contradicts itself. |
| ARCH §12: `utils/envValidation.ts` exists and lists `VITE_API_MODE` as required | File does not exist (`test-env.mjs` imports it and is broken). |
| ARCH §3: `archive/` dir, `SimpleApp.tsx`, `DebugPanel.tsx`, `ApiStatusIndicator.tsx` | None exist. |
| ARCH §4: `useRealtimeConnection` "deprecated no-op shim" in `queries.ts` | Not present. |
| ARCH §4: only `usePeopleQuery` is gated on `personId` | All four are gated (`queries.ts:20,28,36,44`). |
| ARCH §5: `SplitParticipant.share` | Field is `value` (`types.ts:261`). |
| ARCH §11/§12: Playwright runs chromium/firefox/webkit; CI is only Playwright | Chromium only; `android-ci.yml` also builds, signs, and uploads to Google Play. |
| README: "Tailwind via CDN", `VITE_GEMINI_API_KEY` in `.env.local`, seed script is optional | Tailwind via PostCSS; client Gemini key removed; seed script is destructive. |
| AGENTS "Locked stack": Clerk JWT template `supabase` | `lib/supabase.ts:22-31` says the template is no longer used (third-party auth). |

---

## 0.10 Coverage gaps opened in Pass 0 (carried forward)

1. **Production database state is unknowable from the repo.** Which SQL files were applied, in what order, and whether `HOTFIX_reset_all_policies.sql` or `COMPLETE_RLS_FIX.sql` were ever run. Needed: `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public'` and `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'` from production.
2. **Supabase dashboard settings**: Clerk third-party auth provider config, realtime publication membership, whether `verify_jwt` is on for `send-email`/`suggest-tag`, edge-function secrets (`ALLOWED_ORIGINS`, `MAILERSEND_*`, `GEMINI_API_KEY`, `CLERK_SECRET_KEY`), and whether the service-role key has ever been used outside the dashboard.
3. **Clerk dashboard settings**: session lifetime, JWT TTL (code assumes 60 s), allowed origins/redirects, whether "users can delete their accounts" is on, attack protection / rate limits, cookie attributes.
4. **Git history**: no `.git`. Cannot do blame, commit cadence, or find secrets in history.
5. **Build/typecheck/tests**: not run (no `node_modules`, install forbidden).
6. **Vercel project settings**: which env vars are set in which environment; whether `pk_live` is used; whether preview deployments point at the production Supabase project.
7. **Android release artifacts**: whether `keystore.properties` / `release-key.jks` exist outside the repo; Play Console track state.
8. **Third-party SDK internals**: Clerk cookie flags and refresh behaviour; supabase-js `channel()` dedupe semantics for the shared `public:transactions` topic; Supabase Realtime RLS behaviour for DELETE events. Pass 1.2 will consult vendor docs where possible.
