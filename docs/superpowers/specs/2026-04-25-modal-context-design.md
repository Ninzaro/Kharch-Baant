# Modal State Unification — Design Spec

**Date:** 2026-04-25
**Status:** Approved
**Scope:** Eliminate the three-way bifurcation of modal state in Kharch-Baant and promote `useModals` to a React Context accessible throughout the component tree.

---

## Problem

Three parallel modal-state systems exist simultaneously, none of them unified:

| System | File | Actually used? |
|---|---|---|
| 15× `useState` | `App.tsx` lines 86–104 | ✅ Drives the UI |
| `useModals` hook | `hooks/useModals.ts` | ❌ Never imported anywhere |
| `openModals` in Zustand | `store/appStore.ts` | ❌ Never read in `App.tsx` |

Additional problems with the current state:
- `appStore.openModals` is persisted to `localStorage` — modal-open state must never survive a page reload.
- `ModalName` in the store duplicates the key names in `useModals`, creating a second source of truth.
- Three group-action confirmations (`confirmDeleteGroup`, `confirmArchiveGroup`, `confirmLeaveGroup`) exist only as ad-hoc `useState` in `App.tsx` with no counterpart in `useModals`.
- Modal callbacks are prop-drilled two levels deep into `GroupView`, `TransactionDetailModal`, `SettingsModal`, and `PaymentSourceManageModal`.

---

## Approach: Thin ModalContext wrapping useModals (Option A)

`useModals` is already a complete, tested implementation. The strategy is:

1. Extend `useModals` with the three missing group-action confirmation types.
2. Create a thin `ModalContext` that instantiates `useModals` once and provides `{ modals, actions }` to the tree.
3. Wire `App.tsx` to consume the context instead of its 15 local `useState` calls.
4. Let `GroupView`, `TransactionDetailModal`, `SettingsModal`, and `PaymentSourceManageModal` call `useModalContext()` directly, removing their modal-related props.
5. Strip `openModals`, `openModal`, `closeModal`, and `ModalName` from `appStore`.

---

## Architecture & Data Flow

```
ModalProvider  (inside AppWithAuth, after auth providers)
 └─ useModals(onDeleteTx, onDeletePs, onDeleteGroup, onArchiveGroup, onLeaveGroup)
      └─ { modals, actions }  ← ModalContext value

App.tsx
 └─ useModalContext()
     ├─ reads  modals.*  to conditionally render each modal
     └─ reads  actions.* in handlers (onAddExpense → actions.openTransactionForm, etc.)

GroupView, TransactionDetailModal, SettingsModal, PaymentSourceManageModal
 └─ useModalContext()  ← call actions directly, no prop-drilling
```

**Render location:** All modal JSX (`<TransactionFormModal>`, `<SettleUpModal>`, etc.) stays in `App.tsx`. Only `App.tsx` has the data props that modals need (`selectedGroup`, `groupMembers`, `paymentSources`). Leaf components use only `actions.*` — they never render modals themselves.

**Provider placement:** `ModalProvider` is rendered *inside* `App`'s JSX return (not wrapping it from outside), so the async callbacks it receives have access to `App`-level state (`currentUserId`, `qc`, `editingGroup`, etc.). It sits above the modal render block and below the data-loading guard.

---

## Section 1: `useModals` additions

### New `ModalState` entries

```typescript
confirmDeleteGroup: {
  isOpen: boolean;
  group: Group | null;
  isProcessing: boolean;
};
confirmArchiveGroup: {
  isOpen: boolean;
  group: Group | null;
  isProcessing: boolean;
};
confirmLeaveGroup: {
  isOpen: boolean;
  group: Group | null;
  pendingSaveData: Omit<Group, 'id'> | null;
  isProcessing: boolean;
};
```

### Extended `useModals` signature

```typescript
export function useModals(
  onDeleteTransaction?: (id: string) => Promise<void>,
  onDeletePaymentSource?: (id: string) => Promise<void>,
  onDeleteGroup?: (group: Group) => Promise<void>,
  onArchiveGroup?: (group: Group) => Promise<void>,
  onLeaveGroup?: (group: Group, saveData: Omit<Group, 'id'>) => Promise<void>,
)
```

The three new confirmation flows follow the identical pattern as `deleteTransaction` and `deletePaymentSource`:
- `requestConfirmDeleteGroup(group)` — opens modal, stores group
- `confirmDeleteGroup()` — sets `isProcessing: true`, calls `onDeleteGroup`, clears on success/failure
- `cancelConfirmDeleteGroup()` — resets to `initialState`
- Same trio for archive and leave

### New `ModalActions` entries

```typescript
requestConfirmDeleteGroup: (group: Group) => void;
confirmDeleteGroup: () => Promise<void>;
cancelConfirmDeleteGroup: () => void;
requestConfirmArchiveGroup: (group: Group) => void;
confirmArchiveGroup: () => Promise<void>;
cancelConfirmArchiveGroup: () => void;
requestConfirmLeaveGroup: (group: Group, saveData: Omit<Group, 'id'>) => void;
confirmLeaveGroup: () => Promise<void>;
cancelConfirmLeaveGroup: () => void;
```

---

## Section 2: `contexts/ModalContext.tsx`

New file, ~40 lines:

```typescript
import { createContext, useContext } from 'react';
import { useModals } from '../hooks/useModals';
import { Group } from '../types';

type ModalContextValue = ReturnType<typeof useModals>;
const ModalContext = createContext<ModalContextValue | null>(null);

interface ModalProviderProps {
  children: React.ReactNode;
  onDeleteTransaction: (id: string) => Promise<void>;
  onDeletePaymentSource: (id: string) => Promise<void>;
  onDeleteGroup: (group: Group) => Promise<void>;
  onArchiveGroup: (group: Group) => Promise<void>;
  onLeaveGroup: (group: Group, saveData: Omit<Group, 'id'>) => Promise<void>;
}

export function ModalProvider({ children, ...callbacks }: ModalProviderProps) {
  const value = useModals(
    callbacks.onDeleteTransaction,
    callbacks.onDeletePaymentSource,
    callbacks.onDeleteGroup,
    callbacks.onArchiveGroup,
    callbacks.onLeaveGroup,
  );
  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModalContext(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModalContext must be used inside ModalProvider');
  return ctx;
}
```

---

## Section 3: `store/appStore.ts` cleanup

Delete entirely:
- `ModalName` type export
- `openModals: Partial<Record<ModalName, boolean>>` field
- `openModal: (name: ModalName) => void` action
- `closeModal: (name: ModalName) => void` action
- `openModals` entry in `partialize`

The store retains only: `selectedGroupId` + `setSelectedGroupId`, `theme` + `setTheme`.

---

## Section 4: `App.tsx` changes

**Remove:**
- `useState` for: `isTransactionModalOpen`, `isGroupModalOpen`, `isConfirmDeleteModalOpen`, `isConfirmArchiveModalOpen`, `isConfirmLeaveModalOpen`, `pendingGroupSaveData`, `isAddActionModalOpen`, `isPaymentSourceModalOpen`, `isPaymentSourceManageOpen`, `isSettleUpOpen`, `isSettingsModalOpen`, `editingTransaction`, `editingGroup`, `isProcessingGroupAction`, `isTransactionDetailOpen`, `selectedTransactionForDetail`, `defaultSettlePayer`, `defaultSettleReceiver`, `defaultSettleAmount`
- `pendingDeleteTransaction`, `isDeletingTransaction`, `pendingDeletePaymentSource`, `isDeletingPaymentSource`

**Add:**
```typescript
const { modals, actions } = useModalContext();
```

**Handlers** (`handleAddTransactionClick`, `handleEditTransactionClick`, `requestDeleteTransaction`, etc.) become thin wrappers calling `actions.*`. The actual async logic (`handleConfirmDeleteTransaction`, `handleConfirmDeleteGroup`, etc.) moves into the callbacks passed to `ModalProvider` in `AppWithAuth`.

**Modal JSX** reads `modals.transactionForm.isOpen`, `modals.transactionForm.editing`, etc. instead of local `useState`.

**`useBackButton`** hook reads from `modals.*` instead of local booleans.

---

## Section 5: Prop-drilling eliminated

### Props removed from component interfaces

| Component | Props removed |
|---|---|
| `GroupView` | `onAddExpense`, `onSettleUp`, `onEditTransaction`, `onDeleteTransaction`, `onViewDetails` |
| `TransactionDetailModal` | `onEdit`, `onDelete` |
| `SettingsModal` | `onManagePaymentSources` |
| `PaymentSourceManageModal` | `onAddNew`, `onRequestDelete`, `onArchive` |

### Props that stay (navigation / data — not modal concerns)

`GroupView`: `onGoHome`, `onEditGroup`, `group`, `transactions`, `people`, `currentUserId`
`GroupList`: `onSelectGroup`, `onGoHome`, `groups`, `people`, `selectedGroupId`
`SettingsModal`: `isOpen`, `onClose`, `currentUserId`, `currentUserPerson`, `theme`, `onThemeChange`

---

## Section 6: `AppWithAuth` restructuring & provider placement

`handleConfirmDeleteGroup` and `handleConfirmArchiveGroup` are currently misplaced inside `AppWithAuth` (they reference `App`-level state). After this change they move into `App`.

`ModalProvider` is rendered **inside `App`'s JSX return** — not wrapping `<App>` from outside — so the callbacks have full access to `App`-level variables (`currentUserId`, `qc`, `editingGroup`, etc.):

```tsx
// Inside App's return:
return (
  <ModalProvider
    onDeleteTransaction={handleDeleteTransaction}
    onDeletePaymentSource={handleDeletePaymentSource}
    onDeleteGroup={handleDeleteGroup}
    onArchiveGroup={handleArchiveGroup}
    onLeaveGroup={handleLeaveGroup}
  >
    {/* existing JSX: GroupView, modals, etc. */}
  </ModalProvider>
);
```

This means `App` both provides and consumes the context. The five async handlers are defined inside `App` (not `AppWithAuth`) and closed over `App`-level state.

---

## What does NOT change

- `useModals` internal state shape and all existing 17 modal types — additive only
- All modal component files (`TransactionFormModal`, `SettleUpModal`, etc.) — unchanged
- `SupabaseAuthContext`, `queryClient`, TanStack Query bridges — unchanged
- Zustand `selectedGroupId` and `theme` — unchanged
- Test files for `useModals` — may need minor updates for the new callbacks

---

## Files changed

| File | Change |
|---|---|
| `hooks/useModals.ts` | Add 3 confirmation types + 9 actions |
| `contexts/ModalContext.tsx` | **New file** |
| `store/appStore.ts` | Remove modal slice |
| `App.tsx` | Replace 15+ useState with useModalContext(); remove prop-drilled callbacks |
| `components/GroupView.tsx` | Remove 5 modal props; call useModalContext() |
| `components/TransactionDetailModal.tsx` | Remove 2 modal props; call useModalContext() |
| `components/SettingsModal.tsx` | Remove 1 modal prop; call useModalContext() |
| `components/PaymentSourceManageModal.tsx` | Remove 3 modal props; call useModalContext() |
| `hooks/useModals.test.ts` | Update for new callbacks |

---

## Success criteria

1. `npx vitest run` — all 99 tests pass
2. No TypeScript errors (`npx tsc --noEmit`)
3. `appStore.ts` exports no modal-related symbols
4. `App.tsx` has zero `useState` calls for modal open/close state
5. `GroupView`, `TransactionDetailModal`, `SettingsModal`, `PaymentSourceManageModal` props interfaces contain no modal-open callbacks
6. Opening any modal from a leaf component works correctly in-browser
