# Bundle Splitting & Lazy Modal Loading — Design Spec

**Date:** 2026-05-01  
**Goal:** Reduce initial JS parse cost on mobile by splitting the 1,692 KB monolithic bundle into vendor chunks + lazy-loaded modal chunks, with intent-based preloading so modals feel instant.

---

## Background

Current state: all JS ships as a single `index-*.js` chunk (1,692 KB raw / 465 KB gzip). Everything — Clerk, Supabase, Sentry, Gemini, all 18 modals — is parsed on first load. On a mid-range Android device this adds ~1–2 s of JS parse time before the UI is interactive.

Root cause: `App.tsx` statically imports 19 components including 10+ modals that are never needed at startup.

---

## Approach: Option B

Two complementary changes:

1. **Vendor chunk splitting** — `vite.config.ts` `manualChunks` separates heavy third-party libs into long-lived cached chunks. Doesn't reduce first-visit parse cost but eliminates re-downloading vendors on every app deploy.

2. **Lazy modal loading** — all 18 modal components switch to `React.lazy()`. A lightweight `ModalShell` fallback (backdrop + spinner, ~20 lines) stays in the main bundle so the overlay appears instantly. Modal JS chunks download in the background.

3. **Intent-based preloading** — hover on trigger buttons fires `import()` to warm chunks before they're needed. Top 3 modals also preload via `requestIdleCallback` after mount.

---

## File Changes

| File | Action | What changes |
|---|---|---|
| `vite.config.ts` | Modify | Add `manualChunks` function to `rollupOptions.output` |
| `components/ModalShell.tsx` | Create | Suspense fallback: backdrop + centered spinner, no content |
| `utils/preload.ts` | Create | `preloadComponent(factory)` helper |
| `App.tsx` | Modify | 18 static modal imports → `React.lazy()`; wrap each in `<Suspense fallback={<ModalShell />}>`; add idle preload `useEffect` |
| Trigger components | Modify | Add `onPointerEnter={preloadComponent(...)}` to 5 primary trigger buttons |

---

## Section 1: Vendor Chunk Splitting

**File:** `vite.config.ts`

Add to `build.rollupOptions.output`:

```ts
manualChunks(id) {
  if (id.includes('node_modules/react') || id.includes('node_modules/react-dom'))
    return 'vendor-react';
  if (id.includes('@clerk/clerk-react'))
    return 'vendor-clerk';
  if (id.includes('@supabase/supabase-js'))
    return 'vendor-supabase';
  if (id.includes('@google/genai'))
    return 'vendor-gemini';
  if (id.includes('@sentry/react') || id.includes('@sentry/core'))
    return 'vendor-sentry';
  if (id.includes('html2canvas'))
    return 'vendor-html2canvas';
}
```

Each chunk is content-hashed. Browser caches indefinitely. Only the app chunk filename changes on new deploys.

---

## Section 2: ModalShell Component

**File:** `components/ModalShell.tsx` (new, ~20 lines)

Renders the modal overlay and a centered spinner. Stays in the main bundle. Used as the `<Suspense>` fallback for all lazy modals so the backdrop appears immediately while the JS chunk loads.

```tsx
const ModalShell: React.FC = () => (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-slate-800 rounded-xl p-8">
      <div className="animate-spin h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  </div>
);
```

---

## Section 3: Preload Helper

**File:** `utils/preload.ts` (new, 3 lines)

```ts
/** Fire-and-forget dynamic import to warm a lazy chunk before it's needed. */
export const preloadComponent = (factory: () => Promise<unknown>): void => {
  factory();
};
```

Used on `onPointerEnter` of trigger buttons. No `await`, no state change — just triggers browser fetch + cache.

---

## Section 4: Lazy Modal Loading in App.tsx

**18 modal imports** convert from static to `React.lazy()`:

```ts
// Before
import TransactionFormModal from './components/TransactionFormModal';

// After
const TransactionFormModal = React.lazy(
  () => import('./components/TransactionFormModal')
);
```

Full list of modals to lazy-load:
- `TransactionFormModal`
- `GroupFormModal`
- `SettleUpModal`
- `TransactionDetailModal`
- `PaymentSourceManageModal`
- `PaymentSourceFormModal`
- `SettingsModal`
- `AddActionModal`
- `ArchivePromptModal`
- `ConfirmDeleteModal`
- `BalanceBreakdownModal`
- `ArchivedGroupsModal`
- `GroupSummaryModal`
- `GroupBalancesModal`
- `DateFilterModal`
- `CalendarModal`
- `ShareModal`
- `MemberInviteModal`

Each modal in JSX is wrapped with `<Suspense>`:

```tsx
<Suspense fallback={<ModalShell />}>
  <TransactionFormModal ... />
</Suspense>
```

The `<Suspense>` boundary sits outside the `isOpen` check — the modal component itself handles its own open/closed rendering. This means the chunk is only fetched when the modal is first opened (or preloaded by intent).

**Idle preload `useEffect`** in `App.tsx` (inside `AppWithAuth`, runs once):

```ts
useEffect(() => {
  if (!('requestIdleCallback' in window)) return;
  const id = requestIdleCallback(() => {
    import('./components/TransactionFormModal');
    import('./components/GroupFormModal');
    import('./components/SettleUpModal');
  });
  return () => cancelIdleCallback(id);
}, []);
```

**What stays eagerly imported** (main bundle):
- `BaseModal`, `ModalShell` — fallback infrastructure
- `HomeScreen`, `GroupList`, `GroupView` — needed on first render
- `Avatar`, `RealtimeStatus`, `ApiStatusIndicator` — always visible
- `auth/UserMenu`, `icons/Icons` — always in header
- `InvitePage` — conditional on URL params but lightweight enough to keep eager; revisit if it grows

---

## Section 5: Intent-Based Preloading on Trigger Buttons

**File:** Wherever each trigger button lives (HomeScreen, GroupView header, TransactionList, etc.)

Add `onPointerEnter` with `preloadComponent`:

| Trigger location | Button | Preloads |
|---|---|---|
| HomeScreen / FAB | "Add Expense" | `TransactionFormModal` |
| GroupView header | "Settle Up" | `SettleUpModal` |
| HomeScreen / GroupList | "New Group" or edit group | `GroupFormModal` |
| TransactionList row | Tap/click row | `TransactionDetailModal` |
| App header | Settings gear icon | `SettingsModal` |

```tsx
import { preloadComponent } from '../utils/preload';
const preloadTransactionForm = () =>
  preloadComponent(() => import('./components/TransactionFormModal'));

<button onPointerEnter={preloadTransactionForm} onClick={...}>
  Add Expense
</button>
```

The factory reference is stable (module-level const) so `onPointerEnter` doesn't trigger re-renders.

---

## What Is NOT Changing

- Modal component internals — no refactoring of form logic, validation, or BaseModal usage inside each modal
- `ModalContext` / `useModals` — unchanged
- Any test files
- `GroupView`, `HomeScreen`, `GroupList` — remain eagerly loaded

---

## Success Criteria

- `npm run build` produces at least 7 chunks (app + vendor-react + vendor-clerk + vendor-supabase + vendor-gemini + vendor-sentry + vendor-html2canvas + modal chunks)
- Main app chunk drops below 600 KB raw (from 1,692 KB)
- No TypeScript errors introduced
- All 96 currently-passing tests still pass
- Opening any modal shows either instant content (preloaded) or the ModalShell spinner followed by content within ~300 ms on a local dev server
