# AGENTS.md — Kharch-Baant

Agent-oriented entry guide for this repository. For long-form architecture detail, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Byterover MCP

You are given two tools from the Byterover MCP server.

### 1. `byterover-store-knowledge`

You **MUST** always use this tool when:

- Learning new patterns, APIs, or architectural decisions from the codebase
- Encountering error solutions or debugging techniques
- Finding reusable code patterns or utility functions
- Completing any significant task or plan implementation

### 2. `byterover-retrieve-knowledge`

You **MUST** always use this tool when:

- Starting any new task or implementation to gather relevant context
- Before making architectural decisions to understand existing patterns
- When debugging issues to check for previous solutions
- Working with unfamiliar parts of the codebase

---

## Project overview

**Kharch-Baant** is a shared-expense tracker for friends, trips, and households.

| Aspect | Detail |
|---|---|
| Product | Groups, multi-mode expense splits, balances, settle-up, payment sources, invites, member claim-by-email, archive, AI category tags, share-as-image |
| Shape | Frontend-only SPA — **no custom backend service** |
| Backend | Supabase (Postgres + RLS + Realtime) |
| Auth | **Clerk** (permanent IdP). Supabase Auth is disabled (`persistSession: false`) |
| Mobile | Capacitor 7 → Android (`com.kharchbaant.app`) |
| Web deploy | Vite → Vercel; PWA via `vite-plugin-pwa` |

### Locked stack

| Layer | Tech |
|---|---|
| UI | React 19, TypeScript (not `strict`), Tailwind CSS 3 |
| Build | Vite 6, path alias `@/*` → repo root |
| Server state | TanStack Query v5 |
| Client/UI state | Zustand v5 (`selectedGroupId`, `theme` only) |
| Data | `@supabase/supabase-js` |
| Auth | `@clerk/clerk-react` + JWT template `supabase` |
| AI | `@google/genai` (Gemini tag suggestions) |
| Email | MailerSend (optional templates) |
| Observability | Sentry |
| Tests | Vitest + Testing Library; Playwright e2e |

Do not add major dependencies outside this list without updating `ARCHITECTURE.md` §2 first.

---

## Architecture at a glance

```
┌──────────────────────────────────────────────────────┐
│                  Client (React 19 SPA)               │
│                                                      │
│  Components ─► Hooks ─► services/queries.ts          │
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
│                (client + Clerk JWT fetch interceptor)│
│                                                      │
│  Zustand store  ◄── UI only (nav + theme)            │
│  ModalContext   ◄── useModals (modal open/close)     │
└──────────────────────────────┼───────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
       Supabase            Clerk              External
   (Postgres+RLS+       (Auth + JWT)         Gemini / MailerSend
    Realtime)                                 / Sentry
```

### Provider stack (`index.tsx`)

```
StrictMode
  └─ Sentry.ErrorBoundary
       └─ ClerkProvider
            └─ QueryClientProvider
                 └─ SupabaseAuthProvider
                      └─ ToastProvider
                           └─ AppWithAuth → App
```

### Navigation

**No router.** View switch is `appStore.selectedGroupId`:

- `null` → `HomeScreen`
- set → `GroupView` for that group

Invite deep-link is a special case (`components/invite/InvitePage.tsx`) via URL / localStorage.

### Identity model

| Concept | Source |
|---|---|
| Login identity | Clerk user id |
| Domain person row | Supabase `people.id` (UUID) — used in membership, balances, query keys |
| `Person.authUserId` | Clerk user id on claimed people |
| `Group.createdBy` | Clerk user id |
| RLS | Expects Clerk JWT in `Authorization` (template `supabase`) |

HTTP: every Supabase request gets the Clerk JWT via a custom `fetch` in `lib/supabase.ts`.  
Realtime: long-lived WS auth is pushed via `setRealtimeAuth` from `SupabaseAuthContext` (including a ~50s refresh so JWT expiry does not drop RLS context).

### Domain model (see `types.ts`)

Core types: `Person`, `Group`, `Transaction`, `Split` / `SplitParticipant`, `Payer`, `PaymentSource`, `Tag`, `Currency`.

- DB rows are **snake_case**; app types are **camelCase**.
- Conversion happens **only** in `supabaseApiService.ts` (`transformDb*ToApp*`).
- Components never touch raw DB rows.

### Avatars

- Default `people.avatar_url` is **empty string** → `components/Avatar.tsx` draws **local initials** (stable color from person id).
- Real photos: user upload in **App Settings → Profile** (base64 data URL via `updateUserAvatar`).
- **Never** assign `i.pravatar.cc`, `ui-avatars.com`, or other stock face hosts. `Avatar` also treats those hosts as empty for legacy rows.
- Apply `supabase/migrations/20260726000000_clear_stock_avatar_urls.sql` on existing databases to clear stock URLs.

### Design system (required for all UI)

Tokens live in `index.css` (`:root` light + `.dark` on `<html>`). Tailwind maps them in `tailwind.config.js`.

| Use | Class / token |
|---|---|
| Page surface | `bg-background` `text-foreground` |
| Cards / panels | `bg-card` `text-card-foreground` |
| Muted chrome | `bg-muted` `text-muted-foreground` |
| Brand actions | `bg-primary` `text-primary-foreground` |
| Money in / positive | `text-success` / `bg-success` |
| Money out / danger | `text-destructive` / `bg-destructive` |
| Borders | `border-border` |
| Focus ring | `ring-ring` |
| Overlay | `bg-overlay/60` |
| Radius | `rounded-lg` / `rounded-xl` / `rounded-2xl` (from `--radius`) |
| Font | `font-sans` (default on `body`) |

**Do not** hardcode palette utilities (`bg-slate-*`, `text-indigo-*`, `bg-black/50`, raw `#hex`) or fonts in components. Add new colors as CSS variables first, then expose them in `tailwind.config.js`.

### Main tables (Supabase)

`people`, `groups`, `group_members`, `transactions`, `payment_sources`, `group_invites`, `email_invites`, `deletion_requests`.

Schema: `supabase-schema.sql`. Deltas: `supabase/migrations/` and historical `migrations/`.

---

## Directory tree

Source lives at the **repo root** (not under `/src` for app code). Generated and dependency trees are omitted.

```
Kharch-baant/
├── index.tsx                 # Bootstrap: providers, Sentry, Capacitor init
├── App.tsx                   # Composition root: queries, realtime, views, modals
├── index.html
├── index.css                 # Tailwind + global styles
├── types.ts                  # Shared domain types
├── constants.ts
├── capacitor.config.ts
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── vercel.json
├── supabase-schema.sql       # Consolidated schema
│
├── components/               # React UI
│   ├── auth/                 # SimpleAuth, UserMenu, UserProfile, AuthLayout
│   ├── invite/               # InvitePage
│   ├── icons/                # Icons.tsx
│   ├── BaseModal.tsx         # Accessible modal shell (portal, focus, Esc)
│   ├── ModalShell.tsx        # Suspense fallback for lazy modals
│   ├── HomeScreen.tsx
│   ├── GroupView.tsx
│   ├── GroupList.tsx
│   ├── Dashboard.tsx
│   ├── Transaction*.tsx
│   ├── *Modal.tsx            # Feature modals (many lazy-loaded from App)
│   └── …
│
├── hooks/
│   ├── useModals.ts          # All modal open/close state + actions
│   ├── useModals.test.ts
│   └── useBackButton.ts      # Android / browser back handling
│
├── contexts/
│   ├── SupabaseAuthContext.tsx   # Clerk → person sync + Realtime auth
│   └── ModalContext.tsx          # Provides useModals to the tree
│
├── store/
│   └── appStore.ts           # Zustand: selectedGroupId, theme (persisted)
│
├── services/
│   ├── apiService.ts         # Public façade (re-exports + a few helpers)
│   ├── supabaseApiService.ts # Supabase ops + transforms + subscriptions
│   ├── queries.ts            # TanStack Query hooks + realtime bridges
│   ├── geminiService.ts
│   ├── emailService.ts
│   ├── tagClassifier.ts
│   └── tagKeywords.ts
│
├── lib/
│   ├── supabase.ts           # Client, JWT fetch, setRealtimeAuth, Db* types
│   ├── queryClient.ts        # Shared QueryClient defaults
│   └── database.types.ts     # Generated / hand-maintained DB types
│
├── utils/
│   ├── calculations.ts       # Balances / splits (pure)
│   ├── env.ts                # getEnvValue multi-key lookup
│   ├── paymentSourceMetrics.ts
│   └── preload.ts            # Intent/idle modal chunk preload
│
├── supabase/
│   ├── functions/send-email/ # Edge function
│   └── migrations/           # Timestamped SQL migrations (canonical recent)
│
├── migrations/               # Older / hotfix SQL history
├── scripts/
│   ├── seed-schema.js
│   ├── smoke-test.mjs
│   ├── start-detached.mjs
│   └── migrations/
│
├── src/
│   └── test/                 # Vitest unit + component tests
│       ├── components/
│       ├── contexts/
│       ├── services/
│       ├── utils/
│       ├── setup.ts
│       └── …
│
├── tests/                    # Playwright e2e
│   ├── app.spec.ts
│   ├── auth.setup.ts
│   ├── authenticated.expense.spec.ts
│   └── authenticated.settle-up.spec.ts
│
├── android/                  # Capacitor Android project
├── public/                   # Static assets, PWA icons/manifest
├── docs/
│   └── superpowers/
│       ├── specs/            # Design documents
│       └── plans/            # Implementation plans
│
├── AGENTS.md                 # This file
├── ARCHITECTURE.md           # Long-form architecture (canonical)
├── README.md
└── *.md                      # Many root session/fix notes — often stale
```

**Vestigial / generated (do not treat as app source of truth):**

- `src/` outside `src/test/` — vestigial
- `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `node_modules/`, `android/**/build/`

---

## What each major area does

| Path | Role | Agent notes |
|---|---|---|
| `App.tsx` | Loads auth person, mounts Query hooks + realtime bridges, switches Home/Group, owns modal JSX | Large; prefer extracting rather than growing further |
| `components/` | All visual UI | Subdir when a family hits ~6 files (`auth/`, `invite/` pattern) |
| `components/BaseModal.tsx` | Shared accessible modal chrome | New modals should compose this |
| `hooks/` | Reusable React logic without JSX ownership of app data | `useModals` is the modal state machine |
| `contexts/SupabaseAuthContext.tsx` | Bridges Clerk session → `Person` + Realtime JWT | Exposes `useAuth()` |
| `contexts/ModalContext.tsx` | Provides `{ modals, actions }` from `useModals` | Children call `useModalContext()` — no modal prop drilling |
| `store/appStore.ts` | UI-only: selected group + theme | Never store server entities or modal flags here |
| `services/apiService.ts` | Stable public API for data ops | Prefer importing from here in app code |
| `services/supabaseApiService.ts` | Implementation of all Supabase CRUD/subscribe + transforms | Only place for DB↔domain mapping |
| `services/queries.ts` | `use*Query` + `useRealtime*Bridge` + `qk` key factory | Server state entry for components |
| `lib/supabase.ts` | Client construction + Clerk token injection | Do not create a second client |
| `utils/` | Pure helpers (no React, no I/O except env reads) | Good home for balance math |
| `types.ts` | Shared domain types | Import from here; do not redeclare |
| `supabase/migrations/` | Forward schema changes | Also update `supabase-schema.sql` |
| `src/test/` | Unit/component tests | Mirror services/utils/contexts layout |
| `tests/` | Playwright | Auth specs need `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` |
| `android/` | Native shell; web assets from `dist/` | Use npm `android:*` scripts |
| `docs/superpowers/` | Specs + plans for multi-step features | Prefer writing new designs here |

---

## Hard rules for agents

1. **Data layer order**  
   `components` / `hooks` → `services/queries.ts` and/or `services/apiService.ts` → `supabaseApiService.ts` → `lib/supabase.ts`.  
   Do **not** import the Supabase client or `supabaseApiService` from presentational components (some historical exceptions exist in `App.tsx` — do not spread that pattern).

2. **Transforms**  
   Snake_case DB ↔ camelCase domain only inside `supabaseApiService.ts`.

3. **New data operations**  
   Implement in `supabaseApiService.ts` → re-export from `apiService.ts` → add/adjust TanStack Query hooks or cache updates in `queries.ts` as needed.

4. **Modals**  
   - Open/close via `useModalContext()` actions.  
   - Render/modal data wiring stays in `App.tsx` (it has the query data).  
   - Prefer `React.lazy` + `<Suspense fallback={<ModalShell />}>`.  
   - Build UI on `BaseModal`.  
   - Preload hot paths with `utils/preload.ts` (`onPointerEnter` / idle).

5. **Zustand**  
   UI navigation and theme only. Modal-open state must **not** go into the store (it was removed deliberately).

6. **Schema changes**  
   New timestamped file under `supabase/migrations/` **and** update `supabase-schema.sql` in the same change.  
   `npm run seed:schema` is destructive.

7. **Environment**  
   New env reads should use `utils/env.ts` `getEnvValue(...)` for multi-prefix fallbacks. Never commit secrets or device-local URLs. Capacitor live-reload uses `CAPACITOR_DEV_SERVER_URL` (unset in production).

8. **Repo layout**  
   Do not introduce `/backend`, `/frontend`, or move app source under `/src/`. Flat root layout is intentional.

9. **Auth**  
   Clerk is the permanent IdP. Do not re-enable Supabase Auth or implement dual-auth.

10. **Docs**  
    Structural changes → update `ARCHITECTURE.md` in the same PR. New design specs → `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`. Prefer kebab-case for new markdown filenames.

11. **Debt awareness**  
    Known debt is listed in `ARCHITECTURE.md` §15 (large `App.tsx` / `supabaseApiService.ts`, non-strict TS, hardcoded Sentry DSN, thin coverage, root markdown clutter). Fix nearby debt only when it serves the task; remove resolved items from §15 when you fix them.

---

## Coding style guidelines

These mix **what the codebase already does** with **what new code should do**. Tooling does not fully enforce them (no committed ESLint/Prettier; TS not strict).

### Naming

| Kind | Convention | Example |
|---|---|---|
| Components | `PascalCase.tsx` | `GroupList.tsx` |
| Hooks | `useCamelCase.ts` | `useModals.ts` |
| Services / utils / store | `camelCase.ts` | `apiService.ts` |
| Types / interfaces | `PascalCase` | `PaymentSource` |
| Constants | `SCREAMING_SNAKE_CASE` | in `constants.ts` |
| DB type aliases | `Db` prefix | `DbGroup` |
| SQL migrations | `YYYYMMDDHHMMSS_description.sql` | under `supabase/migrations/` |

### TypeScript

- `tsconfig.json` has **no** `"strict": true`. Still:
  - Type exported functions and component props.
  - Prefer domain types from `types.ts` over inline shapes.
  - Avoid introducing new `as any`; existing Clerk/Realtime casts are grandfathered.
- Prefer explicit `Promise<T>` return types on service functions.

### React / UI

- Function components; props interfaces colocated or exported from the component file.
- Tailwind utility classes for styling (dark glassmorphic aesthetic is the product look).
- User-visible failures: `react-hot-toast` and/or Sentry — no empty `catch`.
- Keep side effects in `useEffect` with correct deps; realtime bridges belong in `queries.ts`, mounted from `App`.

### Imports

- Cross-folder: prefer `@/...` alias (configured in `vite.config.ts` + `tsconfig.json`).
- Same folder / siblings: relative imports are fine.
- Data access: `import * as api from './services/apiService'` (or `@/services/apiService`).

### Size and structure

- Prefer functions under ~50 lines.
- Prefer splitting a component when the render tree becomes hard to scan (~200+ lines of JSX is a smell).
- `supabaseApiService.ts` is already very large — if you must extend it heavily, consider a domain split rather than another 200 lines of unrelated ops.

### Comments

- Short module headers / JSDoc on non-obvious exported service and util APIs.
- Inline comments only for non-obvious business rules (e.g. realtime preserving `members` on group UPDATE).

### Testing conventions

| Layer | Tool | Location |
|---|---|---|
| Unit / component | Vitest + Testing Library | `src/test/**`, or co-located `*.test.ts(x)` (e.g. `hooks/useModals.test.ts`) |
| E2E | Playwright | `tests/` |
| Smoke | Node script | `npm run test:smoke` |

- New logic in `services/`, `utils/`, `hooks/` should get tests.
- User-facing flows should eventually get Playwright coverage; authenticated specs self-skip without credentials.
- Do not commit `.only` or `.skip`.

### Git / PR hygiene (when committing)

- Prefer focused diffs; do not reformat unrelated files.
- Do not commit secrets, `.env.local`, or machine-specific Capacitor URLs.
- After structural changes, update `ARCHITECTURE.md` so it stays descriptive of reality.

---

## Common commands

```bash
npm install
npm run dev              # Vite :3000, host 0.0.0.0
npm run build            # → dist/
npm run test             # Vitest watch
npm run test:run         # Vitest once
npm run test:coverage
npm run test:smoke
npm run seed:schema      # DESTRUCTIVE full schema re-apply
npm run android:sync     # build web + cap sync
npm run android:run      # device run (JAVA_HOME jdk-21 on Windows scripts)
npm run android:build
npm run android:build:release
```

### Environment (minimum)

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_CLERK_PUBLISHABLE_KEY=
# Optional:
# Free AI expense categories (https://aistudio.google.com/apikey) — must be VITE_ prefixed
VITE_GEMINI_API_KEY=
# VITE_GEMINI_MODEL=gemini-2.0-flash
VITE_MAILERSEND_API_KEY=
CAPACITOR_DEV_SERVER_URL=   # live reload only; unset for production native
```

Also accepted in places: `REACT_APP_SUPABASE_*` fallbacks via `getEnvValue`.

---

## Where to put new work

| Adding… | Put it in… |
|---|---|
| UI element | `components/` (subdir if family grows) |
| Reusable React logic | `hooks/` |
| Supabase data operation | `supabaseApiService.ts` then re-export in `apiService.ts` |
| Query / realtime bridge | `services/queries.ts` |
| UI-only global state | `store/` (new slice file if needed) |
| Pure helper | `utils/` |
| Domain type | `types.ts` |
| Schema change | `supabase/migrations/` + `supabase-schema.sql` |
| Unit test | `src/test/...` or co-located `*.test.ts` |
| E2E test | `tests/` |
| Design / multi-step plan | `docs/superpowers/specs/` and `plans/` |

---

## Canonical vs stale documentation

**Trust first:**

- `ARCHITECTURE.md` — system as-of last verification
- `AGENTS.md` — this file (agent shortcuts + rules)
- `README.md`, `LOCAL_SETUP.md`, `SUPABASE_SETUP.md`, `ANDROID_SETUP.md`, `DEPLOYMENT_GUIDE.md`
- `docs/superpowers/specs/*` and `plans/*` for feature history

**Treat as historical unless verified in code:**

- Root `*_FIX.md`, `INVITE_*.md`, `USER_FLOW_*.md`, one-off analysis notes
- `SUPABASE_AUTH_MIGRATION_PLAN.md` — **stale**; Clerk is permanent
- Older checklists that predate modal context unification and lazy modal chunks

---

## Quick reality checks (as of this doc)

- Modal state: **`useModals` + `ModalContext`** (Zustand modal slice removed).
- Bundle: **vendor `manualChunks` + several lazy modals** in `App.tsx` (performance work partially landed).
- Member claim: migrations + `claim_person_by_email` RPC + related tests present.
- Mock/in-memory API mode: **removed**; Supabase-only façade remains.

When code and docs disagree, **code wins** — then fix the doc in the same change.
