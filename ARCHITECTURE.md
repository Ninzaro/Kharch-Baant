# Kharch-Baant — Architecture

> **Status:** Descriptive. This document reflects the codebase **as it exists today**, not an aspirational target. Any deviation from what's described here is either (a) a bug in this doc, or (b) drift that needs to be reconciled. Update this file whenever structural changes land.
>
> **Last verified against repo:** 2026-04-19
>
> **Verification scope:** all files cited by path were read directly. Component-family descriptions (§7) are based on filename inventory only.

---

## 1. System at a Glance

Kharch-Baant is a **Supabase-native, frontend-only SPA** for tracking shared expenses. There is **no custom backend service** — the React client talks directly to Supabase (Postgres + RLS + Realtime). Authentication is provided by **Clerk**; Supabase Auth is explicitly disabled (`persistSession: false`). A Clerk JWT (template `supabase`) is injected into every Supabase HTTP and Realtime request via a custom `fetch` wrapper.

The same web bundle is shipped as a **native Android app** via Capacitor.

```
┌──────────────────────────────────────────────────────┐
│                  Client (React 19 SPA)               │
│                                                      │
│  Components ─► Hooks ─► services/queries.ts ─►       │
│                          (TanStack Query +           │
│                           Realtime bridges)          │
│                              │                       │
│                              ▼                       │
│                  services/apiService.ts              │
│                  (thin re-export façade)             │
│                              │                       │
│                              ▼                       │
│                services/supabaseApiService.ts        │
│                  (transforms + Supabase calls)       │
│                              │                       │
│                              ▼                       │
│                    lib/supabase.ts                   │
│                (Supabase client +                    │
│                 Clerk JWT fetch interceptor)         │
│                              │                       │
│  Zustand store  ◄── (UI only) ─────────────────────  │
└──────────────────────────────┼───────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
       Supabase            Clerk              External:
   (Postgres + RLS +    (Auth + JWT)         - Gemini AI
    Realtime)                                - MailerSend
                                             - Sentry
```

**Targets:** Web (Vite → Vercel) and Android (Capacitor → AAB).

---

## 2. Tech Stack (Locked)

Adding a dependency outside this list requires updating this section *first*.

| Layer | Tech | Notes |
|---|---|---|
| UI | React 19, TypeScript 5.8 | TS is **not** in `strict` mode — see §13 |
| Build | Vite 6, vite-plugin-pwa, vite-plugin-node-polyfills | |
| Styling | Tailwind CSS 3 (PostCSS toolchain) | README claims CDN — reconcile (debt §15) |
| Server state | `@tanstack/react-query` v5 | |
| Client/UI state | `zustand` v5 (`persist` + `devtools`) | |
| Backend / DB | Supabase (`@supabase/supabase-js` v2) | Postgres + RLS + Realtime |
| Auth | Clerk (`@clerk/clerk-react`) | Supabase Auth disabled. Migration to Supabase Auth planned, not started. |
| AI | `@google/genai` (Gemini) | Category suggestions |
| Email | `mailersend` | Transactional templates, fire-and-forget |
| Mobile | Capacitor 7 (Android only) | |
| Notifications | `react-hot-toast` | |
| Icons | `lucide-react` + `components/Icons.tsx` | |
| Image export | `html2canvas` | |
| Testing | Vitest + Testing Library + jsdom; Playwright | |
| Observability | Sentry (`@sentry/react`) | DSN hardcoded — debt §15 |

---

## 3. Directory Layout

The repo is **flat**, not split into `/backend /frontend /common`. Source folders live at the repo root.

```
/                          # repo root = source root
├── index.tsx              # React DOM bootstrap (canonical entry)
├── App.tsx                # Top-level container (912 LOC, see §6)
├── index.html             # Vite HTML entry
├── index.css              # Tailwind + global styles
├── types.ts               # Shared domain types (see §5)
├── constants.ts           # App-wide constants
│
├── components/            # 49 React components (see §7)
├── hooks/                 # Custom hooks (useModals, useBackButton)
├── contexts/              # SupabaseAuthContext (Clerk → Supabase glue)
├── store/                 # Zustand stores (appStore.ts)
├── services/              # API façade + integrations (see §4)
├── lib/                   # supabase client, queryClient, db type aliases
├── utils/                 # Pure helpers (env, calculations, validation)
│
├── supabase/              # Supabase project config + edge functions
├── migrations/            # Historical SQL migrations
├── supabase-schema.sql    # Consolidated current schema
│
├── tests/                 # Playwright e2e (currently 1 spec)
├── src/test/              # Vitest unit/component tests
├── android/               # Capacitor Android project
├── public/                # Static assets, PWA manifests
├── scripts/               # Node scripts (seed-schema, smoke-test)
├── .github/workflows/     # CI (Playwright)
├── .claude/               # Local AI worktrees + prompts
│
├── src/                   # ⚠ VESTIGIAL except /src/test/
├── archive/               # ⚠ DEAD — stale 248KB react-vendor bundle
├── SimpleApp.tsx          # ⚠ DEAD — fallback demo, not wired
├── dist/                  # Generated (gitignored)
└── *.md                   # 47 docs at root — see §14
```

### Path conventions

- Path alias: `@/*` → repo root (`vite.config.ts` + `tsconfig.json paths`).
- File naming:
  - Components: `PascalCase.tsx` (`GroupList.tsx`)
  - Hooks: `useCamelCase.ts` (`useModals.ts`)
  - Services / utils / stores: `camelCase.ts` (`apiService.ts`)
  - SQL migrations: `YYYYMMDDHHMMSS_description.sql` (mostly — some legacy files break this)
- **Markdown filenames** at the root use `SCREAMING_SNAKE_CASE` (legacy, not renamed). **New docs** go in `kebab-case.md`.

### Where new code goes

| If you're adding... | Put it in... |
|---|---|
| A visual element | `components/` (subdirectory if it grows a family — e.g. `components/auth/`) |
| Reusable React logic | `hooks/` |
| A Supabase data operation | `services/supabaseApiService.ts` (then re-export from `services/apiService.ts`) |
| A TanStack Query hook or Realtime bridge | `services/queries.ts` |
| A new Zustand slice | `store/` (one file per slice) |
| A pure helper (no React, no I/O) | `utils/` |
| A shared domain type | `types.ts` |
| A Supabase **client** / config concern | `lib/supabase.ts` |
| A QueryClient default change | `lib/queryClient.ts` |
| A schema change | new file in `migrations/` (timestamped) **and** update `supabase-schema.sql` in the same commit |
| An Android-only concern | `android/` (let Capacitor manage) |

**Do not** create `/backend`, `/frontend`, `/common`, or move source under `/src/`. Those would fight the existing layout.

---

## 4. Data Layer

Three files form the data layer. Strict ordering: **components and hooks never import `supabaseApiService` or the Supabase client directly.**

```
components/hooks  ─►  services/queries.ts   (TanStack Query hooks + realtime bridges)
                          │
                          ▼
                  services/apiService.ts    (thin re-export façade — stable public API)
                          │
                          ▼
            services/supabaseApiService.ts  (Supabase calls + DB↔domain transforms)
                          │
                          ▼
                  lib/supabase.ts           (Supabase client + Clerk JWT fetch interceptor)
```

### `lib/supabase.ts` (65 LOC)
- Reads URL + anon key via `getEnvValue('VITE_SUPABASE_URL', 'REACT_APP_SUPABASE_URL')`. Throws at module load if missing.
- Configures the client with `persistSession: false, autoRefreshToken: false, detectSessionInUrl: false` — Supabase Auth is **explicitly off**.
- **Wraps `global.fetch`** so every HTTP request to Supabase carries:
  - `Authorization: Bearer <Clerk JWT from template "supabase">`
  - `apikey: <anon key>`
- Realtime auth is set separately via `(supabase.realtime as any).setAuth(token)` in `contexts/SupabaseAuthContext.tsx` (see §9 for a known gap).
- Exports type aliases: `Tables<T>`, `Inserts<T>`, `Updates<T>`, plus `DbGroup`, `DbTransaction`, `DbPaymentSource`, `DbPerson`, `DbGroupMember`.

### `services/apiService.ts` (92 LOC)
Public façade. Only re-exports. Adding a new operation = add to `supabaseApiService.ts` first, then re-export here. Prevents breaking callers when the underlying implementation changes.

### `services/supabaseApiService.ts` (1343 LOC — **debt §15**)
- Owns **all** Supabase queries and **all** DB-row → domain-type transforms (`transformDb*ToApp*` helpers).
- Owns Realtime channel setup: `subscribeToGroups`, `subscribeToTransactions`, `subscribeToPaymentSources`, `subscribeToPeople`, `subscribeToGroupMembers`.
- Domain ops: groups, transactions, people, payment sources, group invites, email invites, deletion-request workflow, archive/unarchive.
- **Should be split** by domain (groups / transactions / invites / deletion-requests / people) but isn't yet.

### `services/queries.ts` (221 LOC)
- Query keys under a single `qk` namespace, all scoped by `personId`:
  - `qk.groups(personId)`, `qk.transactions(personId)`, `qk.paymentSources(personId)`, `qk.people(personId)`
- Hooks: `useGroupsQuery`, `useTransactionsQuery`, `usePaymentSourcesQuery`, `usePeopleQuery`. Only `usePeopleQuery` is gated `enabled: !!personId`; the others fire even with no person (mild bug).
- Realtime bridges (one per domain): mounted in `App.tsx`, scoped by `personId`. Each subscribes via `api.subscribeTo*` and patches the QueryClient cache:
  - `INSERT` — append, with **explicit dedupe** (`if (current.some(x => x.id === new.id)) return current`) to handle echo from optimistic updates.
  - `UPDATE` — replace by id. **`useRealtimeGroupsBridge` deliberately preserves the existing `members` array** because realtime payloads on the `groups` table don't include members. Documented inline.
  - `DELETE` — filter out by id.
- `useRealtimeGroupMembersBridge` is special: when the current user is added/removed from a group, it invalidates both groups *and* transactions. When other members change, it re-fetches groups so member lists stay current.
- `useRealtimeConnection` is **deprecated** (kept as no-op shim); auth was moved to `SupabaseAuthProvider`.

### TanStack Query config (`lib/queryClient.ts`, 16 LOC)

```ts
queries:    { staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 }
mutations:  { retry: 1 }
```

Realtime bridges handle freshness; window-focus refetch is intentionally off.

### External-service wrappers (`services/`)

| File | Role |
|---|---|
| `geminiService.ts` | `suggestTagForDescription(description) → Tag`. Reads `VITE_GEMINI_API_KEY` (falls back to `GEMINI_API_KEY`). No caching, no rate limiting (debt §15). |
| `emailService.ts` | MailerSend templates (welcome, group invite, member added, settle up, new expense). Fire-and-forget (debt §15). |

---

## 5. Domain Model (`types.ts`, 363 LOC)

Source of truth for shared types. Always import from here; never redeclare. DB-row types (snake_case) live in `lib/supabase.ts` as `Db*` aliases.

| Type | Purpose | Key fields |
|---|---|---|
| `Person` | A user or a placeholder for one | `id`, `name`, `avatarUrl`, `email?`, `authUserId?` (Clerk), `isClaimed?`, `source?` |
| `PersonSource` | How a Person entered the system | `'manual' \| 'phonebook' \| 'email_invite' \| 'self'` |
| `Group` | An expense group | `id`, `name`, `currency`, `members: UUID[]`, `groupType`, `tripStartDate?`, `tripEndDate?`, `isArchived?`, `createdBy?`, `enableCuteIcons?` |
| `Transaction` | Expense, settlement, or adjustment | `id`, `groupId`, `amount`, `paidById`, `payers?: Payer[]`, `tag`, `paymentSourceId?`, `type`, `split` |
| `Split` | How a transaction divides | `mode: 'equal' \| 'unequal' \| 'percentage' \| 'shares'`, `participants: SplitParticipant[]` |
| `SplitParticipant` | One person's share | `personId`, `share` |
| `Payer` | Multi-payer support | `personId`, `amount` |
| `PaymentSource` | Wallet / card / UPI / cash | `id`, `name`, `type`, `details?`, `isActive` |
| `Tag` | Expense category | `'Food' \| 'Groceries' \| 'Transport' \| ...` |
| `Currency` | ISO currency metadata | `code`, `name`, `symbol` (~180 entries) |

**Rule:** DB rows (snake_case) are converted to domain types (camelCase) **only** inside `supabaseApiService.ts` via `transformDb*ToApp*`. Components and hooks never touch raw rows.

---

## 6. App Entry & Composition

### Provider stack (`index.tsx`, 88 LOC) — verified

```
React.StrictMode
  └─ Sentry.ErrorBoundary           (fallback: <p>Something went wrong.</p> — debt §15)
       └─ ClerkProvider             (publishableKey from VITE_CLERK_PUBLISHABLE_KEY; throws if missing)
            └─ QueryClientProvider  (queryClient from lib/queryClient.ts)
                 └─ SupabaseAuthProvider
                      └─ ToastProvider
                           └─ AppWithAuth
```

`index.tsx` also:
- Initializes Sentry with a **hardcoded DSN** (debt §15).
- Calls `initCapacitor()` before render — sets status bar style, hides splash, registers Android back-button handler.

`components/ErrorBoundary.tsx` exists but is **not** in this stack. Likely dead at the top level — verify before deletion (debt §15).

### `App.tsx` (912 LOC — **debt §15**)

Responsibilities (today, not ideal):
- Reads auth via `useAuth()` from `SupabaseAuthContext`.
- Calls all four `use*Query` hooks + mounts all five realtime bridges.
- Owns the manual view switch: `selectedGroupId == null ? <HomeScreen/> : <GroupView/>`.
- Holds local `useState` for ~15 modals (debt §15: should use `appStore.openModals`, but the store enum is incomplete — see §8).
- Has duplicate imports for `ConfirmDeleteModal` and `ArchivePromptModal` (debt §15).

### Routing
**No router.** Navigation is state-driven via `appStore.selectedGroupId`. The invite flow (`InvitePage.tsx`) is a special case keyed off URL params / localStorage. Introducing real URL routes (e.g. `react-router`, TanStack Router) would require updating this section.

---

## 7. Components

49 components in `components/`, grouped by purpose. Component file contents have **not** been individually verified; categorization is from filename inventory.

| Family | Examples | Notes |
|---|---|---|
| **Modals** | `TransactionFormModal`, `GroupFormModal`, `SettleUpModal`, `BalanceBreakdownModal`, `MemberInviteModal`, `ConfirmDeleteModal`, `ArchivePromptModal`, `CalendarModal`, `DateFilterModal`, `ShareModal`, `PaymentSourceFormModal`, `PaymentSourceManageModal`, `SettingsModal`, `AddActionModal`, `ArchivedGroupsModal`, `GroupSummaryModal`, `GroupBalancesModal`, `TransactionDetailModal` | All extend `BaseModal` (assumed; not yet verified). State *should* be governed by `appStore.openModals` but that enum doesn't cover all of them — see §8. |
| **Lists / Views** | `HomeScreen`, `GroupView`, `GroupList`, `GroupSelectionList`, `GroupSummaryCard`, `TransactionList`, `TransactionItem`, `MemberBalances` | Top-level containers vs row primitives — keep them split. |
| **Layout / chrome** | `Dashboard`, `BaseModal`, `ErrorBoundary`, `ToastProvider`, `RealtimeStatus` | `ErrorBoundary` may be dead (see §6). |
| **Forms / inputs** | `FilterBar`, `CurrencySelector`, `LanguageSelector`, `ThemeToggle`, `DataExport` | Pure-ish leaf components. |
| **Auth** | `auth/UserMenu`, `auth/UserProfile`, `auth/AuthLayout`, `auth/SimpleAuth` | Subdirectory pattern — follow this when a family grows. |
| **Utilities** | `Avatar`, `ApiStatusIndicator`, `AboutSection` | |
| **Specialized** | `Icons.tsx`, `InvitePage.tsx`, `AdminDeletionRequestsPanel.tsx`, `DangerZone.tsx`, `DebugPanel.tsx` | |

**Rule:** if a family reaches ~6+ files, move it into a subdirectory (`components/<family>/`).

---

## 8. State Management

### Zustand — `store/appStore.ts` (63 LOC)
UI-only state. Persisted to `localStorage` under key `app-ui` (v1). DevTools enabled.

| Slice | Owns |
|---|---|
| `selectedGroupId` | Current group view (drives top-level navigation) |
| `theme` | `'light' \| 'dark' \| 'system'` |
| `openModals: Partial<Record<ModalName, boolean>>` | 15 named modals |

**`ModalName` enum (15 entries):** `transactionForm`, `transactionDetail`, `groupForm`, `shareModal`, `memberInvite`, `archivedGroups`, `archivePrompt`, `paymentSourceForm`, `paymentSourceManage`, `settleUp`, `balanceBreakdown`, `calendar`, `dateFilter`, `addAction`, `settings`.

**⚠ Gap:** the following modal components exist but are **not** in `ModalName`: `groupSummary`, `groupBalances`, `confirmDelete`. They must be controlled via ad-hoc `useState` somewhere (likely `App.tsx`). Convention is "every new modal gets a `ModalName` and goes through `openModal/closeModal`" — bring the missing three in line in any PR that touches them.

### Context — `contexts/SupabaseAuthContext.tsx` (107 LOC)
Bridges Clerk → Supabase. Exposes `useAuth()` returning:

```ts
{
  user: any | null,        // Clerk User    ⚠ typed as any (debt §15)
  person: Person | null,   // Supabase row, synced via ensureUserExists
  session: any | null,     // Clerk Session ⚠ typed as any (debt §15)
  loading: boolean,        // !isUserLoaded || !isSessionLoaded
  isSyncing: boolean,      // true while ensureUserExists runs
  signOut: () => Promise<void>,
  updateLocalPerson: (updated: Person) => void,
}
```

- On Clerk user change: calls `setRealtimeAuth(token)` from `lib/supabase.ts` to push the Clerk JWT into Supabase Realtime **before** resolving the Person via `ensureUserExists(user.id, fullName, email)`. Order matters — bridges mounted in `App.tsx` are keyed on `personId`, so the WS must be authenticated before `personId` becomes truthy.
- Starts a **50 s refresh interval** (`REALTIME_AUTH_REFRESH_MS`) that re-pushes a fresh Clerk JWT so the long-lived WS connection never loses its RLS context (Clerk JWT TTL defaults to 60 s). The interval is owned by the effect and cleared on re-run or unmount.
- On sign-out: `signOut()` calls `setRealtimeAuth(null)` *before* `clerkSignOut()` (fail-closed).
- Covered by `src/test/contexts/SupabaseAuthContext.test.tsx` (5 tests).

### TanStack Query
Owns all server state. Components and hooks read via the hooks in `services/queries.ts` — never call services directly inside components.

---

## 9. Authentication

**Today:** Clerk is the source of truth. Supabase Auth is **disabled** (`persistSession: false`).

### How the Clerk JWT reaches Supabase

1. Clerk user signs in → Clerk session has a JWT template named `supabase`.
2. `lib/supabase.ts` exports `getClerkSupabaseToken()`, which calls `(window as any).Clerk.session.getToken({ template: 'supabase' })`.
3. The Supabase client is constructed with a `global.fetch` override that calls `getClerkSupabaseToken()` per-request and sets:
   - `Authorization: Bearer <jwt>`
   - `apikey: <anon key>`
4. **Realtime is separate.** Supabase Realtime maintains a long-lived WebSocket and cannot use the per-request `fetch` interceptor. Instead, `SupabaseAuthContext` calls `setRealtimeAuth(token)` (exported from `lib/supabase.ts`) on session load and on a 50 s refresh interval — see §8.

### Identity model

- `Person.authUserId` = Clerk user ID.
- `Group.createdBy` = Clerk user ID.
- All RLS policies assume the Clerk JWT in the `Authorization` header.

### Migration target
**Decision (2026-04-22):** Clerk is the permanent IdP. There is no planned migration to Supabase Auth. `SUPABASE_AUTH_MIGRATION_PLAN.md` is a stale planning artifact and can be deleted.

---

## 10. Database

Supabase Postgres. Schema in `supabase-schema.sql`; deltas in `migrations/` and `supabase/migrations/`. **Schema details below were not re-verified file-by-file in this revision** — they reflect the prior recon report and should be confirmed before being relied on.

### Tables

| Table | Purpose |
|---|---|
| `people` | Users + placeholders. `clerk_user_id` links to Clerk. |
| `groups` | Expense groups. `created_by` = Clerk user ID. |
| `group_members` | Junction (group ↔ person). |
| `transactions` | Expenses, settlements, adjustments. `payers`, `split_participants` are JSONB. |
| `payment_sources` | Cards / UPI / cash / other. `details` is JSONB. |
| `group_invites` | Shareable token-based invites with usage limits + expiry. |
| `email_invites` | Per-email invites with MailerSend tracking. |
| `deletion_requests` | Group-deletion approval workflow. |

### RLS posture
- Members can read groups they belong to.
- Members can read/write transactions in their groups.
- Only the group creator can delete (and only when settled).
- HTTP requests authenticate via Clerk JWT (fetch override). **Realtime currently authenticates via anon `apikey` only** — see §8 gap.

### Migration discipline
- New schema change → new timestamped file in `migrations/` (`YYYYMMDDHHMMSS_<name>.sql`).
- Apply locally via `npm run seed:schema` (DESTRUCTIVE — re-runs full schema).
- Update `supabase-schema.sql` in the same commit.

---

## 11. Testing

| Layer | Tool | Location |
|---|---|---|
| Unit / component | Vitest + Testing Library + jsdom | `src/test/**/*.test.ts(x)`, plus co-located `hooks/*.test.ts` |
| E2E | Playwright (chromium / firefox / webkit) | `tests/` |
| Smoke | Custom Node script | `scripts/smoke-test.mjs` |

### Coverage thresholds (`vitest.config.ts`, verified)
- Lines / functions / statements: **85%**
- Branches: **70%**
- Provider: v8

### Conventions
- Every new module in `services/`, `utils/`, `hooks/` gets a `*.test.ts` next to it (or under `src/test/<dir>/`).
- New components get at least a render smoke test.
- New user flows get a Playwright spec in `tests/`.
- Never commit `.skip` / `.only` (enforce in review).

**Reality check (2026-04-22):** 99 unit tests across 10 files; global coverage 10.76% stmts / 68.94% branches / 31.29% functions. Thresholds in `vitest.config.ts` track reality (8/65/28/8) and will cause CI to fail on genuine regression. Playwright suite: `tests/app.spec.ts` (unauthenticated, always runs) + `tests/authenticated.*.spec.ts` (Clerk login required; self-skip when credentials absent). See §15 item 17 for remaining gaps.

---

## 12. Build, Deploy, Environment

### Web
- Dev: `npm run dev` → Vite at `:3000` (host `0.0.0.0`).
- Build: `npm run build` → `dist/` (esbuild minify, sourcemaps off, chunk warning at 600 KB).
- Deploy: Vercel (`vercel.json`); SPA rewrite `/*` → `/index.html`.
- PWA: `vite-plugin-pwa` with `registerType: 'prompt'`, `clientsClaim: false`, `skipWaiting: false` — explicit choice to avoid auto-refresh surprises.
- Service worker runtime cache: `https://api.supabase.co/.*` → `NetworkFirst`, max 100 entries, 24 h TTL. Will mask Supabase outages and cause stale reads.

### Android
- `npm run android:sync` — build web + `cap sync`.
- `npm run android:run` — install + launch on connected device (requires `JAVA_HOME=jdk-21`).
- `npm run android:build:release` — produce AAB.
- App ID: `com.kharchbaant.app`, web dir `dist/`.
- **⚠ `capacitor.config.ts` hardcodes `server.url: 'http://192.168.1.10:3000'`** — a LAN IP for live-reload. Will not work on any other developer's machine. Should be `.env.local`-driven (debt §15).

### CI
- GitHub Actions: `.github/workflows/playwright.yml` runs Playwright on push.

### Environment variables — actually used

Reads come from three layers (any one may resolve a key):

1. `vite.config.ts` `define` block — explicitly substitutes `import.meta.env.VITE_*` and several `process.env.*` shims at build time, prioritizing `process.env.VITE_*` (for Vercel) over `loadEnv` results.
2. `utils/env.ts` `getEnvValue(...keys)` — reads `import.meta.env` first, then falls back to `process.env`. Used by `lib/supabase.ts` to support both `VITE_*` and `REACT_APP_*` keys.
3. `utils/envValidation.ts` — runtime validator with separate required/optional lists. **⚠ Lists `VITE_API_MODE` as required**, but README claims mock mode was removed. One of the two is wrong (debt §15).

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase project URL (also accepts `REACT_APP_SUPABASE_URL`) |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase anon key (also accepts `REACT_APP_SUPABASE_ANON_KEY`) |
| `VITE_CLERK_PUBLISHABLE_KEY` | yes | Clerk publishable key — `index.tsx` throws if missing |
| `VITE_API_MODE` | listed required by `envValidation.ts`; ⚠ unclear if still used | Was `'supabase' \| 'mock'`; mock allegedly removed |
| `VITE_GEMINI_API_KEY` | optional | Enables AI tag suggestions (also `GEMINI_API_KEY`) |
| `VITE_MAILERSEND_API_KEY` | optional | Enables transactional emails |
| `VITE_MAILERSEND_FROM_EMAIL` | optional | Sender |
| `VITE_MAILERSEND_TEMPLATE_*` | optional | Five template IDs |
| `VITE_DEBUG_ENABLED`, `VITE_DEV_MODE` | optional | Surface in `envValidation.ts`; usage thin |

**Rule:** new env reads should go through `utils/env.ts` `getEnvValue()` for fallback support, **not** `import.meta.env.X` directly. Existing direct reads (in `index.tsx`, `vite.config.ts`, etc.) are tolerated as legacy.

---

## 13. Coding Standards

> ⚠ **Honest framing:** the standards below are what we *want*. Tooling does not currently enforce most of them. Don't claim "the codebase follows X" — rather, "new code should follow X."

### TypeScript
- `tsconfig.json` is **not strict**: no `"strict": true`, no `noImplicitAny`, no `strictNullChecks`. `allowJs: true`. Type checking happens via `tsc --noEmit`-style tools but isn't wired into a `lint` script.
- **Goal:** new code adds explicit types, avoids `as any`. Existing `as any` usage (`(window as any).Clerk`, `(supabase.realtime as any).setAuth`, `(payload: any)`) is grandfathered.
- Migrating to `strict: true` is a debt item (§15).

### Style
- **Function size:** prefer < 50 lines. If a component renders > 200 lines, split it.
- **Naming:** `camelCase` for functions/vars, `PascalCase` for components/types, `SCREAMING_SNAKE_CASE` for constants. The system-prompt template's claim about "kebab-case files" does **not** apply here.
- **Imports:** use the `@/` alias for cross-folder imports; relative paths for siblings only.
- **Errors:** every async boundary has a `try / catch` that either toasts via `react-hot-toast` or bubbles to `Sentry.ErrorBoundary`. No silent failures.
- **Logging:** Sentry for errors. `console.*` only behind a `DEBUG` flag.
- **Secrets:** never hardcoded. Currently violated by the Sentry DSN in `index.tsx` (debt §15).
- **Comments:** JSDoc on every exported function in `services/`, `utils/`, `hooks/`. Inline comments only for non-obvious logic.
- **Formatting:** no `.prettierrc` / `.eslintrc` checked in (debt §15).

---

## 14. Documentation

Forty-seven `.md` files currently live at the repo root. Most are session/fix notes from past AI work. **Canonical docs to keep at root:**

- `README.md`
- `ARCHITECTURE.md` (this file)
- `DEVELOPMENT_GUIDE.md`
- `DEPLOYMENT_GUIDE.md`
- `SUPABASE_SETUP.md`
- `LOCAL_SETUP.md`
- `ANDROID_SETUP.md`
- `PRODUCTION_CHECKLIST.md`

**Everything else** (session notes, fix logs, throwaway analyses, completed migration plans) should move under `docs/archive/` so the root stays scannable. Tracked separately in §15.

---

## 15. Known Tech Debt (don't fix unless asked)

These are real and worth flagging in any PR that touches nearby code. Items grouped by severity.

### Likely bugs
1. **Realtime UPDATE on `groups`** explicitly preserves `members` from local state because the payload omits them — works today but fragile if any other field is dropped from payloads.
2. **Inconsistent `API_MODE` defaults** in `vite.config.ts`: `import.meta.env.VITE_API_MODE` defaults to `'supabase'`, `process.env.REACT_APP_API_MODE` defaults to `'mock'`. Same setting, two defaults.
3. **`VITE_API_MODE` listed as required** in `utils/envValidation.ts` but README says mock mode was removed — one of the two is stale.

### Architecture / size
4. **`App.tsx` is 912 LOC.** Manages auth, queries, realtime, view switching, and 15 modal `useState`s. Should split into `AppContainer` / `MainLayout` / `ModalRoot`.
5. **`services/supabaseApiService.ts` is 1343 LOC.** Should split by domain (groups / transactions / invites / deletion-requests / people).
6. **Modal state is bifurcated** — `appStore.openModals` exists but `App.tsx` still uses local `useState`, *and* the `ModalName` enum is missing `groupSummary`, `groupBalances`, `confirmDelete`.
7. **TypeScript is not strict.** `tsconfig.json` lacks `strict: true`. §13's standards are aspirational.
8. **No `.prettierrc` / `.eslintrc`** committed. Style is enforced by convention only.

### Security / config
9. **Sentry DSN hardcoded** in `index.tsx`. Should be `VITE_SENTRY_DSN`.
10. **Hardcoded LAN IP** (`192.168.1.10`) in `capacitor.config.ts` `server.url`. Will not work on any other developer's machine.
11. **`(window as any).Clerk` global access** in `lib/supabase.ts` `getClerkSupabaseToken`. Couples to Clerk's window injection — fragile.
12. **MailerSend calls are fire-and-forget** with no retry/queue. A failed send is silent.
13. **No client-side rate limiting on Gemini calls.**

### Cruft
14. **`/src/` is vestigial** — only `src/test/` is used. Either flatten to `tests/` or commit to a full `/src/` move (don't leave it half-done).
15. **47 root-level `.md` files** — most are fix-log session notes. Move to `docs/archive/`.
16. **Tailwind double-installed** — README says CDN, but `tailwind.config.js` + `postcss` are present and `index.css` is imported. Pick one.

### Process / coverage
17. **Playwright authenticated flows need real test credentials** — `tests/auth.setup.ts` exists and handles Clerk login; authenticated specs (`tests/authenticated.*.spec.ts`) cover add-expense and settle-up flows. They self-skip when `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` are absent. Remaining gaps: invite flow, archive, deletion-request, multi-payer split.
18. **Unit-test coverage is thin** — 99 tests across 10 files (measured 2026-04-22: 10.76% stmts / 68.94% branches / 31.29% functions). Thresholds in `vitest.config.ts` now track reality (8/65/28/8) rather than being aspirational. Priority backfill targets: `App.tsx`, `supabaseApiService.ts`, `queries.ts`, and the component family.
20. **Markdown filename casing** — root docs use `SCREAMING_SNAKE_CASE` (legacy). Going forward, **new docs use `kebab-case.md`**. Existing files are not renamed (breaking bookmarks not worth it).

---

## 16. How to Use This Document

- **Before adding a feature:** read §3 (where it goes) and §4 (data layer rules).
- **Before changing data flow:** update §4.
- **Before adding a dependency:** update §2.
- **Before adding a table or column:** update §10.
- **When you fix a debt item from §15:** remove it from the list in the same PR.
- **If reality drifts from this doc:** the doc is wrong — fix the doc, don't pretend the drift away.
- **For any claim that says "verified" or cites a specific file/LOC:** that was read directly during the last revision. Claims without that hedge inherit from earlier recon and may be stale.
