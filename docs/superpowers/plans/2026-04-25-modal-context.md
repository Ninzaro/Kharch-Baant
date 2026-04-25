# Modal State Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 23 local `useState` calls in `App.tsx` with a single `useModals()` hook provided via `ModalContext`, eliminating the three-way modal-state bifurcation and removing prop-drilled modal callbacks from `GroupView`, `TransactionDetailModal`, `SettingsModal`, and `PaymentSourceManageModal`.

**Architecture:** `App.tsx` calls `useModals(callbacks...)` directly, destructures `{ modals, actions }`, and wraps its JSX in `<ModalContext.Provider value={{ modals, actions }}>`. Child components anywhere in the tree call `useModalContext()` to open/close modals without prop-drilling. All modal rendering stays in `App.tsx` because it's the only component with access to the data props modals need.

**Tech Stack:** React 19, TypeScript 5.8, Vitest 2.1.9 + Testing Library, Zustand 5

---

## File Map

| File | Change |
|---|---|
| `hooks/useModals.ts` | Add `settleUp.initialTransaction`, 3 group confirmation types, 9 actions |
| `hooks/useModals.test.ts` | Add tests for 3 new confirmation flows |
| `contexts/ModalContext.tsx` | **New** — context + provider + consumer hook |
| `store/appStore.ts` | Remove `ModalName`, `openModals`, `openModal`, `closeModal` |
| `App.tsx` | Replace 23 `useState` with `useModals`; wrap JSX in `ModalContext.Provider`; move misplaced handlers from `AppWithAuth` |
| `components/GroupView.tsx` | Remove 5 modal props; call `useModalContext()` |
| `components/TransactionDetailModal.tsx` | Remove `onEdit`, `onDelete` props; call `useModalContext()` |
| `components/SettingsModal.tsx` | Remove `onManagePaymentSources`; call `useModalContext()` |
| `components/PaymentSourceManageModal.tsx` | Remove `onAddNew`, `onRequestDelete`, `onArchive`; call `useModalContext()` |

---

## Task 1: Extend `useModals` — `settleUp.initialTransaction` + 3 group confirmations

**Files:**
- Modify: `hooks/useModals.ts`
- Modify: `hooks/useModals.test.ts`

### Why `settleUp.initialTransaction`?
`App.tsx` currently stores `editingTransaction` separately and passes it to `SettleUpModal` as `initialTransaction`. After this refactor that separate state goes away, so `settleUp` needs to carry it.

- [ ] **Step 1.1: Update `ModalState` in `hooks/useModals.ts`**

Find the `settleUp` entry in `interface ModalState` (around line 45) and add the `initialTransaction` field. Then add the three new confirmation modal types at the end of the interface, before the closing `}`.

Replace the existing `settleUp` block:
```typescript
  settleUp: {
    isOpen: boolean;
    defaultPayer?: string;
    defaultReceiver?: string;
    defaultAmount?: number;
  };
```
With:
```typescript
  settleUp: {
    isOpen: boolean;
    defaultPayer?: string;
    defaultReceiver?: string;
    defaultAmount?: number;
    initialTransaction?: Transaction;
  };
```

Then add after `deletePaymentSource` (before the closing `}`):
```typescript
  // Group action confirmations
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

- [ ] **Step 1.2: Update `ModalActions` interface**

Update `openSettleUp` signature (around line 114):
```typescript
  openSettleUp: (config?: {
    defaultPayer?: string;
    defaultReceiver?: string;
    defaultAmount?: number;
    initialTransaction?: Transaction;
  }) => void;
```

Add before `closeAll`:
```typescript
  // Group confirmation actions
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

- [ ] **Step 1.3: Update `initialState`**

Update `settleUp` in `initialState` (around line 157):
```typescript
  settleUp: { isOpen: false, defaultPayer: undefined, defaultReceiver: undefined, defaultAmount: undefined, initialTransaction: undefined },
```

Add after `deletePaymentSource`:
```typescript
  confirmDeleteGroup: { isOpen: false, group: null, isProcessing: false },
  confirmArchiveGroup: { isOpen: false, group: null, isProcessing: false },
  confirmLeaveGroup: { isOpen: false, group: null, pendingSaveData: null, isProcessing: false },
```

- [ ] **Step 1.4: Update `useModals` function signature**

Replace (around line 167):
```typescript
export function useModals(
  onDeleteTransaction?: (id: string) => Promise<void>,
  onDeletePaymentSource?: (id: string) => Promise<void>
) {
```
With:
```typescript
export function useModals(
  onDeleteTransaction?: (id: string) => Promise<void>,
  onDeletePaymentSource?: (id: string) => Promise<void>,
  onDeleteGroup?: (group: Group) => Promise<void>,
  onArchiveGroup?: (group: Group) => Promise<void>,
  onLeaveGroup?: (group: Group, saveData: Omit<Group, 'id'>) => Promise<void>,
) {
```

- [ ] **Step 1.5: Add the 9 new action implementations**

Add the following block after `cancelDeletePaymentSource` (before `closeAll`):

```typescript
  // ── Group confirmation actions ──────────────────────────────────────
  const requestConfirmDeleteGroup = useCallback((group: Group) => {
    if (!group || typeof group !== 'object' || !group.id) {
      console.warn('requestConfirmDeleteGroup: Invalid group', group);
      return;
    }
    setState(s => ({ ...s, confirmDeleteGroup: { isOpen: true, group, isProcessing: false } }));
  }, []);

  const confirmDeleteGroupAction = useCallback(async () => {
    const group = stateRef.current.confirmDeleteGroup.group;
    if (!group || !onDeleteGroup) return;
    setState(s => ({ ...s, confirmDeleteGroup: { ...s.confirmDeleteGroup, isProcessing: true } }));
    try {
      await onDeleteGroup(group);
      setState(s => ({ ...s, confirmDeleteGroup: initialState.confirmDeleteGroup }));
    } catch (error) {
      setState(s => ({ ...s, confirmDeleteGroup: { ...s.confirmDeleteGroup, isProcessing: false } }));
      throw error;
    }
  }, [onDeleteGroup]);

  const cancelConfirmDeleteGroup = useCallback(() => {
    setState(s => ({ ...s, confirmDeleteGroup: initialState.confirmDeleteGroup }));
  }, []);

  const requestConfirmArchiveGroup = useCallback((group: Group) => {
    if (!group || typeof group !== 'object' || !group.id) {
      console.warn('requestConfirmArchiveGroup: Invalid group', group);
      return;
    }
    setState(s => ({ ...s, confirmArchiveGroup: { isOpen: true, group, isProcessing: false } }));
  }, []);

  const confirmArchiveGroupAction = useCallback(async () => {
    const group = stateRef.current.confirmArchiveGroup.group;
    if (!group || !onArchiveGroup) return;
    setState(s => ({ ...s, confirmArchiveGroup: { ...s.confirmArchiveGroup, isProcessing: true } }));
    try {
      await onArchiveGroup(group);
      setState(s => ({ ...s, confirmArchiveGroup: initialState.confirmArchiveGroup }));
    } catch (error) {
      setState(s => ({ ...s, confirmArchiveGroup: { ...s.confirmArchiveGroup, isProcessing: false } }));
      throw error;
    }
  }, [onArchiveGroup]);

  const cancelConfirmArchiveGroup = useCallback(() => {
    setState(s => ({ ...s, confirmArchiveGroup: initialState.confirmArchiveGroup }));
  }, []);

  const requestConfirmLeaveGroup = useCallback((group: Group, saveData: Omit<Group, 'id'>) => {
    if (!group || typeof group !== 'object' || !group.id) {
      console.warn('requestConfirmLeaveGroup: Invalid group', group);
      return;
    }
    setState(s => ({ ...s, confirmLeaveGroup: { isOpen: true, group, pendingSaveData: saveData, isProcessing: false } }));
  }, []);

  const confirmLeaveGroupAction = useCallback(async () => {
    const { group, pendingSaveData } = stateRef.current.confirmLeaveGroup;
    if (!group || !pendingSaveData || !onLeaveGroup) return;
    setState(s => ({ ...s, confirmLeaveGroup: { ...s.confirmLeaveGroup, isProcessing: true } }));
    try {
      await onLeaveGroup(group, pendingSaveData);
      setState(s => ({ ...s, confirmLeaveGroup: initialState.confirmLeaveGroup }));
    } catch (error) {
      setState(s => ({ ...s, confirmLeaveGroup: { ...s.confirmLeaveGroup, isProcessing: false } }));
      throw error;
    }
  }, [onLeaveGroup]);

  const cancelConfirmLeaveGroup = useCallback(() => {
    setState(s => ({ ...s, confirmLeaveGroup: initialState.confirmLeaveGroup }));
  }, []);
```

- [ ] **Step 1.6: Add 9 new entries to the `actions` object**

In the returned `actions` object (around line 401), add before `closeAll`:
```typescript
    requestConfirmDeleteGroup,
    confirmDeleteGroup: confirmDeleteGroupAction,
    cancelConfirmDeleteGroup,
    requestConfirmArchiveGroup,
    confirmArchiveGroup: confirmArchiveGroupAction,
    cancelConfirmArchiveGroup,
    requestConfirmLeaveGroup,
    confirmLeaveGroup: confirmLeaveGroupAction,
    cancelConfirmLeaveGroup,
```

- [ ] **Step 1.7: Write failing tests in `hooks/useModals.test.ts`**

Add at the end of the file (before the closing `}`):

```typescript
  describe('Group Confirmation Modals', () => {
    it('requestConfirmDeleteGroup opens modal with the group', () => {
      const { result } = renderHook(() => useModals());
      expect(result.current.modals.confirmDeleteGroup.isOpen).toBe(false);

      act(() => {
        result.current.actions.requestConfirmDeleteGroup(mockGroup);
      });

      expect(result.current.modals.confirmDeleteGroup.isOpen).toBe(true);
      expect(result.current.modals.confirmDeleteGroup.group).toEqual(mockGroup);
      expect(result.current.modals.confirmDeleteGroup.isProcessing).toBe(false);
    });

    it('cancelConfirmDeleteGroup resets state', () => {
      const { result } = renderHook(() => useModals());
      act(() => { result.current.actions.requestConfirmDeleteGroup(mockGroup); });
      act(() => { result.current.actions.cancelConfirmDeleteGroup(); });

      expect(result.current.modals.confirmDeleteGroup.isOpen).toBe(false);
      expect(result.current.modals.confirmDeleteGroup.group).toBeNull();
    });

    it('confirmDeleteGroup calls onDeleteGroup and resets state on success', async () => {
      const onDeleteGroup = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useModals(undefined, undefined, onDeleteGroup));

      act(() => { result.current.actions.requestConfirmDeleteGroup(mockGroup); });
      await act(async () => { await result.current.actions.confirmDeleteGroup(); });

      expect(onDeleteGroup).toHaveBeenCalledWith(mockGroup);
      expect(result.current.modals.confirmDeleteGroup.isOpen).toBe(false);
      expect(result.current.modals.confirmDeleteGroup.isProcessing).toBe(false);
    });

    it('requestConfirmArchiveGroup opens modal with the group', () => {
      const { result } = renderHook(() => useModals());
      act(() => { result.current.actions.requestConfirmArchiveGroup(mockGroup); });

      expect(result.current.modals.confirmArchiveGroup.isOpen).toBe(true);
      expect(result.current.modals.confirmArchiveGroup.group).toEqual(mockGroup);
    });

    it('requestConfirmLeaveGroup opens modal with group and saveData', () => {
      const saveData: Omit<Group, 'id'> = {
        name: 'Test Group',
        members: ['person-2'],
        currency: 'USD',
        groupType: 'other',
      };
      const { result } = renderHook(() => useModals());
      act(() => { result.current.actions.requestConfirmLeaveGroup(mockGroup, saveData); });

      expect(result.current.modals.confirmLeaveGroup.isOpen).toBe(true);
      expect(result.current.modals.confirmLeaveGroup.group).toEqual(mockGroup);
      expect(result.current.modals.confirmLeaveGroup.pendingSaveData).toEqual(saveData);
    });

    it('confirmLeaveGroup calls onLeaveGroup with group and saveData', async () => {
      const onLeaveGroup = vi.fn().mockResolvedValue(undefined);
      const saveData: Omit<Group, 'id'> = { name: 'Test Group', members: ['person-2'], currency: 'USD', groupType: 'other' };
      const { result } = renderHook(() =>
        useModals(undefined, undefined, undefined, undefined, onLeaveGroup)
      );

      act(() => { result.current.actions.requestConfirmLeaveGroup(mockGroup, saveData); });
      await act(async () => { await result.current.actions.confirmLeaveGroup(); });

      expect(onLeaveGroup).toHaveBeenCalledWith(mockGroup, saveData);
      expect(result.current.modals.confirmLeaveGroup.isOpen).toBe(false);
    });

    it('settleUp can carry an initialTransaction', () => {
      const { result } = renderHook(() => useModals());
      act(() => {
        result.current.actions.openSettleUp({ initialTransaction: mockTransaction });
      });

      expect(result.current.modals.settleUp.isOpen).toBe(true);
      expect(result.current.modals.settleUp.initialTransaction).toEqual(mockTransaction);
    });
  });
```

- [ ] **Step 1.8: Run tests — expect new ones to pass, existing ones to still pass**

```bash
cd "E:/VS Code/Repo/Kharch-Baant"
npx vitest run hooks/useModals.test.ts
```

Expected: all tests in this file pass (26 existing + 7 new = 33).

- [ ] **Step 1.9: Commit**

```bash
git add hooks/useModals.ts hooks/useModals.test.ts
git commit -m "feat(modals): add settleUp.initialTransaction + 3 group confirmation types"
```

---

## Task 2: Create `contexts/ModalContext.tsx`

**Files:**
- Create: `contexts/ModalContext.tsx`

- [ ] **Step 2.1: Write the file**

```typescript
import React, { createContext, useContext } from 'react';
import { useModals } from '../hooks/useModals';
import { Group } from '../types';

// The context value is the exact return type of useModals
type ModalContextValue = ReturnType<typeof useModals>;

const ModalContext = createContext<ModalContextValue | null>(null);

/**
 * ModalProvider — convenience wrapper for components that want to own
 * their own isolated modal state tree. App.tsx uses ModalContext.Provider
 * directly (after calling useModals() itself) because it needs to pass
 * async callbacks that close over App-level variables.
 */
interface ModalProviderProps {
  children: React.ReactNode;
  onDeleteTransaction?: (id: string) => Promise<void>;
  onDeletePaymentSource?: (id: string) => Promise<void>;
  onDeleteGroup?: (group: Group) => Promise<void>;
  onArchiveGroup?: (group: Group) => Promise<void>;
  onLeaveGroup?: (group: Group, saveData: Omit<Group, 'id'>) => Promise<void>;
}

export function ModalProvider({
  children,
  onDeleteTransaction,
  onDeletePaymentSource,
  onDeleteGroup,
  onArchiveGroup,
  onLeaveGroup,
}: ModalProviderProps) {
  const value = useModals(
    onDeleteTransaction,
    onDeletePaymentSource,
    onDeleteGroup,
    onArchiveGroup,
    onLeaveGroup,
  );
  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModalContext(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModalContext must be used inside ModalContext.Provider');
  return ctx;
}

export { ModalContext };
```

- [ ] **Step 2.2: Verify TypeScript compiles**

```bash
cd "E:/VS Code/Repo/Kharch-Baant"
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `contexts/ModalContext.tsx`.

- [ ] **Step 2.3: Commit**

```bash
git add contexts/ModalContext.tsx
git commit -m "feat(modals): add ModalContext + useModalContext hook"
```

---

## Task 3: Strip modal slice from `store/appStore.ts`

**Files:**
- Modify: `store/appStore.ts`

- [ ] **Step 3.1: Remove `ModalName` and modal state from appStore**

Replace the entire file with:

```typescript
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

interface UIState {
  selectedGroupId: string | null
  setSelectedGroupId: (id: string | null) => void

  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useAppStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        selectedGroupId: null,
        setSelectedGroupId: (id) => set({ selectedGroupId: id }),

        theme: 'system',
        setTheme: (theme) => set({ theme }),
      }),
      {
        name: 'app-ui',
        partialize: (s) => ({
          selectedGroupId: s.selectedGroupId,
          theme: s.theme,
        }),
        version: 2, // bump version to clear persisted openModals from localStorage
      }
    ),
    { name: 'app-ui' }
  )
)
```

Note: version bumped from 1 → 2 so stale `openModals` is cleared from any user's localStorage on next load.

- [ ] **Step 3.2: Check for any remaining imports of `ModalName` or `openModal`/`closeModal`**

```bash
cd "E:/VS Code/Repo/Kharch-Baant"
npx tsc --noEmit 2>&1 | grep -i "modal\|ModalName"
```

Fix any reported errors (should be none at this point since `App.tsx` hasn't been changed yet — they'll surface in Task 4).

- [ ] **Step 3.3: Commit**

```bash
git add store/appStore.ts
git commit -m "feat(modals): remove openModals slice from appStore; bump persist version"
```

---

## Task 4: Refactor `App.tsx`

**Files:**
- Modify: `App.tsx`

This is the largest change. Work section by section.

### 4a — Add imports, remove old useState block

- [ ] **Step 4a.1: Add ModalContext import and remove unused imports**

At the top of `App.tsx`, add:
```typescript
import { ModalContext } from './contexts/ModalContext';
import { useModals } from './hooks/useModals';
```

Remove from imports (no longer needed after this refactor):
- `BaseModal` (if present — it was used for the inline leave-group modal)

`BaseModal` is used inline in the leave-group confirmation JSX. Keep the import if it exists; we'll use it via the new `confirmLeaveGroup` modal state.

Check current imports: look for `BaseModal` import. If absent, add it:
```typescript
import BaseModal from './components/BaseModal';
```

- [ ] **Step 4a.2: Remove all 23 modal-related `useState` declarations**

Delete lines 86–104 and 116–119 in the current file — these are all the modal `useState` calls:

```typescript
// DELETE all of these:
const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
const [isConfirmArchiveModalOpen, setIsConfirmArchiveModalOpen] = useState(false);
const [isConfirmLeaveModalOpen, setIsConfirmLeaveModalOpen] = useState(false);
const [pendingGroupSaveData, setPendingGroupSaveData] = useState<Omit<Group, 'id'> | null>(null);
const [isAddActionModalOpen, setIsAddActionModalOpen] = useState(false);
const [isPaymentSourceModalOpen, setIsPaymentSourceModalOpen] = useState(false);
const [isPaymentSourceManageOpen, setIsPaymentSourceManageOpen] = useState(false);
const [isSettleUpOpen, setIsSettleUpOpen] = useState(false);
const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
const [editingGroup, setEditingGroup] = useState<Group | null>(null);
const [isProcessingGroupAction, setIsProcessingGroupAction] = useState(false);
const [isTransactionDetailOpen, setIsTransactionDetailOpen] = useState(false);
const [selectedTransactionForDetail, setSelectedTransactionForDetail] = useState<Transaction | null>(null);
const [defaultSettlePayer, setDefaultSettlePayer] = useState<string | undefined>(undefined);
const [defaultSettleReceiver, setDefaultSettleReceiver] = useState<string | undefined>(undefined);
const [defaultSettleAmount, setDefaultSettleAmount] = useState<number | undefined>(undefined);
// ...and further down:
const [pendingDeleteTransaction, setPendingDeleteTransaction] = useState<Transaction | null>(null);
const [isDeletingTransaction, setIsDeletingTransaction] = useState(false);
const [pendingDeletePaymentSource, setPendingDeletePaymentSource] = useState<PaymentSource | null>(null);
const [isDeletingPaymentSource, setIsDeletingPaymentSource] = useState(false);
```

### 4b — Add async callbacks and useModals call

- [ ] **Step 4b.1: Add the five async callbacks and `useModals` call**

After the Sentry `useEffect` (after the realtime bridges section, before `useBackButton`), insert:

```typescript
    // ── Modal async callbacks (closed over App-level state) ────────────────
    const handleDeleteTransactionCb = useCallback(async (id: string) => {
        const tx = transactions.find(t => t.id === id);
        if (!tx) return;
        await api.deleteTransaction(tx.id, tx.groupId);
        qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) =>
            prev.filter(t => t.id !== tx.id)
        );
    }, [transactions, currentUserId, qc]);

    const handleDeletePaymentSourceCb = useCallback(async (id: string) => {
        await api.deletePaymentSource(id);
        qc.setQueryData<PaymentSource[]>(qk.paymentSources(currentUserId), (prev = []) =>
            prev.filter(ps => ps.id !== id)
        );
        qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) =>
            prev.map(t => t.paymentSourceId === id ? { ...t, paymentSourceId: undefined } as Transaction : t)
        );
    }, [currentUserId, qc]);

    const handleDeleteGroupCb = useCallback(async (group: Group) => {
        const isAdmin = group.createdBy === currentUserId;
        if (isAdmin) {
            await deleteGroup(group.id, currentUserId, true, allSettled);
            qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) =>
                prev.filter(g => g.id !== group.id)
            );
            setSelectedGroupId(null);
        } else {
            const res = await requestGroupDeletion(group.id, currentUserId);
            toast.success(res.message || 'Deletion request sent to the group admin.');
        }
    }, [currentUserId, allSettled, qc, setSelectedGroupId]);

    const handleArchiveGroupCb = useCallback(async (group: Group) => {
        await archiveGroup(group.id, currentUserId, group.createdBy === currentUserId, userSettled, allSettled);
        qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) =>
            prev.map(g => g.id === group.id ? { ...g, isArchived: true } : g)
        );
    }, [currentUserId, userSettled, allSettled, qc]);

    const handleLeaveGroupCb = useCallback(async (group: Group, saveData: Omit<Group, 'id'>) => {
        await executeGroupSave(saveData, true);
    }, []);
    // NOTE: executeGroupSave is defined below — move it above this block or
    // use a ref pattern. See Step 4b.2.

    // ── Single modal state source ──────────────────────────────────────────
    const { modals, actions } = useModals(
        handleDeleteTransactionCb,
        handleDeletePaymentSourceCb,
        handleDeleteGroupCb,
        handleArchiveGroupCb,
        handleLeaveGroupCb,
    );
```

- [ ] **Step 4b.2: Ensure `executeGroupSave` is defined before `handleLeaveGroupCb`**

`executeGroupSave` (currently around line 353) references `editingGroup` which after the refactor comes from `modals.groupForm.editing`. Move `executeGroupSave` above the callbacks block added in Step 4b.1, and update it to use `modals` state.

Replace all references to `editingGroup` inside `executeGroupSave` with `modals.groupForm.editing`. Replace all modal `setState` calls inside it with `actions.*` calls:

```typescript
    const executeGroupSave = useCallback(async (groupData: Omit<Group, 'id'>, removingSelf: boolean) => {
        const editingGroup = modals.groupForm.editing;
        if (!editingGroup) return;
        try {
            await api.updateGroup(editingGroup.id, groupData);

            const wasEnabled = editingGroup.enableCuteIcons ?? true;
            const nowEnabled = groupData.enableCuteIcons ?? true;
            if (nowEnabled && !wasEnabled) {
                try {
                    await api.batchApplyEmojisToGroupTransactions(editingGroup.id);
                    await qc.invalidateQueries({ queryKey: qk.transactions(currentUserId) });
                } catch (err) {
                    console.warn('Failed to batch apply emojis to existing transactions:', err);
                }
            }

            await qc.invalidateQueries({ queryKey: qk.groups(currentUserId) });

            if (removingSelf) {
                setSelectedGroupId(null);
                actions.closeGroupForm();
                actions.cancelConfirmLeaveGroup();
                toast.success(`You have left the group "${editingGroup.name}".`);
            } else {
                actions.closeGroupForm();
            }
        } catch (error) {
            console.error('Failed to save group', error);
            toast.error('Failed to save group updates.');
        }
    }, [modals.groupForm.editing, currentUserId, qc, setSelectedGroupId, actions]);
```

Because `executeGroupSave` now references `actions` from `useModals`, and `useModals` must be called before `executeGroupSave` uses `actions`, the order must be:

1. Define `handleDeleteTransactionCb`, `handleDeletePaymentSourceCb`, `handleDeleteGroupCb`, `handleArchiveGroupCb` (these don't need `executeGroupSave`)
2. Call `useModals(...)` → get `{ modals, actions }`
3. Define `executeGroupSave` using `modals` and `actions`
4. Define `handleLeaveGroupCb` using `executeGroupSave`

To handle this without circular refs, keep `handleLeaveGroupCb` as a `useCallback` that calls `executeGroupSave` via a ref:

```typescript
    const executeGroupSaveRef = React.useRef(executeGroupSave);
    React.useEffect(() => { executeGroupSaveRef.current = executeGroupSave; }, [executeGroupSave]);
```

Then in `handleLeaveGroupCb` (passed to `useModals`):

Since `useModals` accepts `onLeaveGroup` and calls it during `confirmLeaveGroup`, and `executeGroupSave` itself uses `modals.groupForm.editing` which may be stale — use the `stateRef` pattern already in `useModals`. The cleaner approach:

Pass `handleLeaveGroupCb` that calls a stable ref:

```typescript
    // Before calling useModals:
    const executeGroupSaveRef = React.useRef<((data: Omit<Group, 'id'>, removingSelf: boolean) => Promise<void>) | null>(null);

    const handleLeaveGroupCb = useCallback(async (_group: Group, saveData: Omit<Group, 'id'>) => {
        await executeGroupSaveRef.current?.(saveData, true);
    }, []);

    const { modals, actions } = useModals(
        handleDeleteTransactionCb,
        handleDeletePaymentSourceCb,
        handleDeleteGroupCb,
        handleArchiveGroupCb,
        handleLeaveGroupCb,
    );

    // After useModals, define executeGroupSave and keep ref in sync:
    const executeGroupSave = useCallback(async (groupData: Omit<Group, 'id'>, removingSelf: boolean) => {
        const editingGroup = modals.groupForm.editing;
        if (!editingGroup) return;
        // ... (full body as above)
    }, [modals.groupForm.editing, currentUserId, qc, setSelectedGroupId, actions]);

    React.useEffect(() => { executeGroupSaveRef.current = executeGroupSave; }, [executeGroupSave]);
```

### 4c — Update handlers

- [ ] **Step 4c.1: Replace all handler bodies**

Replace the body of each handler to use `actions.*` and `modals.*`:

```typescript
    const handleAddTransactionClick = () => {
        actions.openTransactionForm();
    };

    const handleEditTransactionClick = (transaction: Transaction) => {
        if (transaction.type === 'settlement') {
            actions.openSettleUp({ initialTransaction: transaction });
        } else {
            actions.openTransactionForm(transaction);
        }
    };

    const requestDeleteTransaction = (id: string) => {
        const tx = transactions.find(t => t.id === id) || null;
        if (tx) actions.requestDeleteTransaction(tx);
    };

    // handleConfirmDeleteTransaction → replaced by handleDeleteTransactionCb (passed to useModals)
    // Remove the old handleConfirmDeleteTransaction function entirely.

    const handleAddGroupClick = () => {
        actions.openGroupForm();
    };

    const handleEditGroupClick = () => {
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) actions.openGroupForm(selectedGroup);
    };

    const handleAddActionClick = () => {
        actions.openAddAction();
    };

    const handleSelectGroupForExpense = (groupId: string) => {
        setSelectedGroupId(groupId);
        actions.openTransactionForm();
    };

    const handleCreateGroupFromAddAction = () => {
        actions.openGroupForm();
    };

    const requestDeletePaymentSource = (id: string) => {
        const src = paymentSources.find(p => p.id === id) || null;
        if (src) actions.requestDeletePaymentSource(src);
    };

    // handleConfirmDeletePaymentSource → replaced by handleDeletePaymentSourceCb (passed to useModals)
    // Remove the old handleConfirmDeletePaymentSource function entirely.

    const handleViewTransactionDetail = (transaction: Transaction) => {
        actions.openTransactionDetail(transaction);
    };
```

- [ ] **Step 4c.2: Update `handleSaveGroup` to use `modals` and `actions`**

Replace all references to `editingGroup` state with `modals.groupForm.editing`, and all `setIsGroupModalOpen`, `setIsConfirmLeaveModalOpen`, `setPendingGroupSaveData`, `setEditingGroup` calls with the corresponding `actions.*` calls:

```typescript
    const handleSaveGroup = async (groupData: Omit<Group, 'id'>) => {
        try {
            if (!currentUserId || currentUserId.trim() === '') {
                toast.error('User not properly loaded. Please refresh the page and try again.');
                return;
            }

            const editingGroup = modals.groupForm.editing;

            if (editingGroup) {
                const wasUserMember = editingGroup.members.includes(currentUserId);
                const isUserStillMember = groupData.members.includes(currentUserId);
                const removingSelf = wasUserMember && !isUserStillMember;

                if (removingSelf) {
                    actions.requestConfirmLeaveGroup(editingGroup, groupData);
                    return;
                }

                await executeGroupSave(groupData, false);
            } else {
                if (!currentUserId) {
                    toast.error('User data not loaded properly. Please refresh the page and try again.');
                    return;
                }

                const newGroup = await api.addGroup(groupData, currentUserId);

                qc.setQueryData<Group[]>(qk.groups(currentUserId), (prev = []) => {
                    if (prev.some(g => g.id === newGroup.id)) return prev;
                    return [...prev, newGroup];
                });

                actions.closeGroupForm();

                await new Promise(resolve => setTimeout(resolve, 0));

                const cachedGroups = qc.getQueryData<Group[]>(qk.groups(currentUserId)) || [];
                const groupExists = cachedGroups.some(g => g.id === newGroup.id);

                if (groupExists) {
                    setSelectedGroupId(newGroup.id);
                } else {
                    await qc.invalidateQueries({ queryKey: qk.groups(currentUserId) });
                    await qc.refetchQueries({ queryKey: qk.groups(currentUserId) });
                    setSelectedGroupId(newGroup.id);
                }
            }
        } catch (error) {
            console.error("Failed to save group", error);
            toast.error(`Error saving group: ${error?.message || error}`);
        }
    };
```

- [ ] **Step 4c.3: Update `handleSavePaymentSource`**

Replace `setIsPaymentSourceModalOpen(false)` with `actions.closePaymentSourceForm()`:

```typescript
    const handleSavePaymentSource = async (sourceData: Omit<PaymentSource, 'id'>) => {
        try {
            await api.addPaymentSource(sourceData, person?.id);
            actions.closePaymentSourceForm();
        } catch (error) {
            console.error("Failed to save payment source", error);
        }
    };
```

- [ ] **Step 4c.4: Update `handleArchivePaymentSource`**

No modal state change needed — keep as-is (it just updates cache).

- [ ] **Step 4c.5: Update `useBackButton`**

Replace the entire `useBackButton` call:

```typescript
    useBackButton(() => {
        if (modals.transactionDetail.isOpen) { actions.closeTransactionDetail(); return true; }
        if (modals.transactionForm.isOpen) { actions.closeTransactionForm(); return true; }
        if (modals.groupForm.isOpen) { actions.closeGroupForm(); return true; }
        if (modals.addAction.isOpen) { actions.closeAddAction(); return true; }
        if (modals.paymentSourceForm.isOpen) { actions.closePaymentSourceForm(); return true; }
        if (modals.paymentSourceManage.isOpen) { actions.closePaymentSourceManage(); return true; }
        if (modals.settleUp.isOpen) { actions.closeSettleUp(); return true; }
        if (modals.settings.isOpen) { actions.closeSettings(); return true; }
        if (modals.deleteTransaction.isOpen) { actions.cancelDeleteTransaction(); return true; }
        if (modals.deletePaymentSource.isOpen) { actions.cancelDeletePaymentSource(); return true; }

        if (selectedGroupId) {
            setSelectedGroupId(null);
            return true;
        }

        return false;
    });
```

- [ ] **Step 4c.6: Derive `isProcessingGroupAction`**

Add after the `useModals` call:
```typescript
    const isProcessingGroupAction = modals.confirmDeleteGroup.isProcessing || modals.confirmArchiveGroup.isProcessing;
```

### 4d — Update JSX

- [ ] **Step 4d.1: Wrap entire App return in `ModalContext.Provider`**

Replace the `return (` at line ~529 with:

```tsx
    return (
      <ModalContext.Provider value={{ modals, actions }}>
```

And add the matching closing tag before the final `);`:
```tsx
      </ModalContext.Provider>
    );
```

- [ ] **Step 4d.2: Update `GroupView` call site — remove 5 modal props**

Replace:
```tsx
<GroupView
  group={selectedGroup}
  transactions={groupTransactions}
  people={people}
  currentUserId={currentUserId}
  onAddExpense={() => { setEditingTransaction(null); setIsTransactionModalOpen(true); }}
  onSettleUp={() => { setEditingTransaction(null); setIsSettleUpOpen(true); }}
  onEditTransaction={handleEditTransactionClick}
  onDeleteTransaction={requestDeleteTransaction}
  onEditGroup={handleEditGroupClick}
  onGoHome={handleGoHome}
  onViewDetails={handleViewTransactionDetail}
/>
```
With:
```tsx
<GroupView
  group={selectedGroup}
  transactions={groupTransactions}
  people={people}
  currentUserId={currentUserId}
  onEditGroup={handleEditGroupClick}
  onGoHome={handleGoHome}
/>
```

- [ ] **Step 4d.3: Update the settings button to use `actions.openSettings()`**

Replace:
```tsx
onClick={() => setIsSettingsModalOpen(true)}
```
With:
```tsx
onClick={() => actions.openSettings()}
```

- [ ] **Step 4d.4: Update `HomeScreen` call site — `onAddGroup` handler**

Replace:
```tsx
onAddGroup={handleCreateGroupFromAddAction}
```
With:
```tsx
onAddGroup={() => actions.openGroupForm()}
```

- [ ] **Step 4d.5: Update `SettingsModal` — remove `onManagePaymentSources`**

Replace:
```tsx
<SettingsModal
  isOpen={isSettingsModalOpen}
  onClose={() => setIsSettingsModalOpen(false)}
  onManagePaymentSources={() => setIsPaymentSourceManageOpen(true)}
  currentUserId={currentUserId}
  currentUserPerson={person}
  theme={theme}
  onThemeChange={setTheme}
/>
```
With:
```tsx
<SettingsModal
  isOpen={modals.settings.isOpen}
  onClose={actions.closeSettings}
  currentUserId={currentUserId}
  currentUserPerson={person}
  theme={theme}
  onThemeChange={setTheme}
/>
```

- [ ] **Step 4d.6: Update `TransactionFormModal`**

Replace:
```tsx
{isTransactionModalOpen && selectedGroup && (
  <TransactionFormModal
    isOpen={isTransactionModalOpen}
    onClose={() => { setIsTransactionModalOpen(false); setEditingTransaction(null); }}
    onSave={handleSaveTransaction}
    transaction={editingTransaction}
    ...
  />
)}
```
With:
```tsx
{modals.transactionForm.isOpen && selectedGroup && (
  <TransactionFormModal
    isOpen={modals.transactionForm.isOpen}
    onClose={actions.closeTransactionForm}
    onSave={handleSaveTransaction}
    transaction={modals.transactionForm.editing}
    ...
  />
)}
```

Also update `handleSaveTransaction` — replace:
```typescript
setIsTransactionModalOpen(false);
setEditingTransaction(null);
```
With:
```typescript
actions.closeTransactionForm();
```

- [ ] **Step 4d.7: Update `GroupFormModal`**

Replace the `isGroupModalOpen` condition and props:
```tsx
{modals.groupForm.isOpen && (
  <GroupFormModal
    isOpen={modals.groupForm.isOpen}
    onClose={actions.closeGroupForm}
    onSave={handleSaveGroup}
    group={modals.groupForm.editing}
    ...
    isProcessingGroupAction={isProcessingGroupAction}
    onDeleteGroup={() => {
      const g = modals.groupForm.editing;
      if (g) actions.requestConfirmDeleteGroup(g);
    }}
    onArchiveGroup={() => {
      const g = modals.groupForm.editing;
      if (g) actions.requestConfirmArchiveGroup(g);
    }}
    onOpenPaymentSources={() => {
      actions.closeGroupForm();
      actions.openPaymentSourceManage();
    }}
  />
)}
```

- [ ] **Step 4d.8: Update `PaymentSourceFormModal`**

```tsx
{modals.paymentSourceForm.isOpen && (
  <PaymentSourceFormModal
    isOpen={modals.paymentSourceForm.isOpen}
    onClose={actions.closePaymentSourceForm}
    onSave={handleSavePaymentSource}
  />
)}
```

- [ ] **Step 4d.9: Update `ConfirmDeleteModal` for transactions**

```tsx
{modals.deleteTransaction.isOpen && (
  <ConfirmDeleteModal
    open={modals.deleteTransaction.isOpen}
    entityType="transaction"
    entityName={modals.deleteTransaction.transaction?.description ?? ''}
    impactDescription="Balances will recalculate after deletion. This cannot be undone."
    loading={modals.deleteTransaction.isDeleting}
    onCancel={actions.cancelDeleteTransaction}
    onConfirm={actions.confirmDeleteTransaction}
  />
)}
```

- [ ] **Step 4d.10: Update `ConfirmDeleteModal` for payment sources**

```tsx
{modals.deletePaymentSource.isOpen && (
  <ConfirmDeleteModal
    open={modals.deletePaymentSource.isOpen}
    entityType="paymentSource"
    entityName={modals.deletePaymentSource.paymentSource?.name ?? ''}
    impactDescription={`This source is referenced in ${paymentSourceUsageCounts[modals.deletePaymentSource.paymentSource?.id ?? ''] || 0} transaction(s). ${paymentSourceLastUsed[modals.deletePaymentSource.paymentSource?.id ?? ''] ? `Last used on ${paymentSourceLastUsed[modals.deletePaymentSource.paymentSource?.id ?? '']}. ` : ''}After deletion those transactions will display no payment source. This cannot be undone.`}
    loading={modals.deletePaymentSource.isDeleting}
    onCancel={actions.cancelDeletePaymentSource}
    onConfirm={actions.confirmDeletePaymentSource}
  />
)}
```

- [ ] **Step 4d.11: Update `PaymentSourceManageModal`**

```tsx
{modals.paymentSourceManage.isOpen && (
  <PaymentSourceManageModal
    isOpen={modals.paymentSourceManage.isOpen}
    onClose={actions.closePaymentSourceManage}
    paymentSources={paymentSources}
    usageCounts={paymentSourceUsageCounts}
    lastUsedMap={paymentSourceLastUsed}
    onAddNew={() => {
      actions.closePaymentSourceManage();
      actions.openPaymentSourceForm();
    }}
    onRequestDelete={requestDeletePaymentSource}
    onArchive={handleArchivePaymentSource}
  />
)}
```

Wait — `PaymentSourceManageModal` is one of the components losing its props in Task 8. Keep these props here for now; they get removed from the component interface in Task 8 (the component will call `useModalContext()` itself). Until Task 8 is done, pass the props as-is.

- [ ] **Step 4d.12: Update `SettleUpModal`**

```tsx
{modals.settleUp.isOpen && selectedGroup && (
  <SettleUpModal
    open={modals.settleUp.isOpen}
    onClose={() => {
      actions.closeSettleUp();
    }}
    groupId={selectedGroup.id}
    members={groupMembers}
    paymentSources={paymentSources}
    transactions={groupTransactions}
    currency={selectedGroup.currency}
    defaultPayerId={modals.settleUp.defaultPayer}
    defaultReceiverId={modals.settleUp.defaultReceiver}
    defaultAmount={modals.settleUp.defaultAmount}
    initialTransaction={modals.settleUp.initialTransaction}
    onSubmit={async (tx) => {
      const initialTx = modals.settleUp.initialTransaction;
      if (initialTx) {
        const updated = await api.updateTransaction(initialTx.id, tx);
        qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) =>
          prev.map(t => t.id === initialTx.id ? updated : t)
        );
        return updated;
      } else {
        const created = await api.addTransaction(selectedGroup.id, tx);
        qc.setQueryData<Transaction[]>(qk.transactions(currentUserId), (prev = []) =>
          prev.some(t => t.id === created.id) ? prev : [created, ...prev]
        );
        return created;
      }
    }}
    onCreated={(_tx: Transaction) => {
      actions.closeSettleUp();
    }}
  />
)}
```

- [ ] **Step 4d.13: Update `TransactionDetailModal`**

```tsx
{modals.transactionDetail.isOpen && modals.transactionDetail.transaction && (
  <TransactionDetailModal
    transaction={modals.transactionDetail.transaction}
    onClose={actions.closeTransactionDetail}
    groupMembers={groupMembers}
    paymentSources={paymentSources}
    onEdit={(transaction) => {
      actions.openTransactionForm(transaction);
      actions.closeTransactionDetail();
    }}
    onDelete={(transaction) => {
      actions.requestDeleteTransaction(transaction);
      actions.closeTransactionDetail();
    }}
  />
)}
```

Note: `onEdit` and `onDelete` will be removed from `TransactionDetailModal`'s props interface in Task 6. Keep them here until then.

- [ ] **Step 4d.14: Update `AddActionModal`**

```tsx
<AddActionModal
  open={modals.addAction.isOpen}
  onClose={actions.closeAddAction}
  groups={activeGroups}
  people={people}
  onCreateGroup={() => actions.openGroupForm()}
  onSelectGroupForExpense={handleSelectGroupForExpense}
  currentGroupId={selectedGroupId}
/>
```

- [ ] **Step 4d.15: Update group confirmation modals**

Replace the three old `isConfirmDeleteModalOpen`, `isConfirmArchiveModalOpen`, `isConfirmLeaveModalOpen` blocks:

```tsx
{/* Confirm Delete Group */}
{modals.confirmDeleteGroup.isOpen && modals.confirmDeleteGroup.group && (
  <ConfirmDeleteModal
    open={modals.confirmDeleteGroup.isOpen}
    entityType="group"
    entityName={modals.confirmDeleteGroup.group.name}
    loading={modals.confirmDeleteGroup.isProcessing}
    onConfirm={actions.confirmDeleteGroup}
    onCancel={actions.cancelConfirmDeleteGroup}
  />
)}

{/* Confirm Archive Group */}
{modals.confirmArchiveGroup.isOpen && modals.confirmArchiveGroup.group && (
  <ArchivePromptModal
    isOpen={modals.confirmArchiveGroup.isOpen}
    onClose={actions.cancelConfirmArchiveGroup}
    onArchive={actions.confirmArchiveGroup}
  />
)}

{/* Confirm Leave Group */}
{modals.confirmLeaveGroup.isOpen && modals.confirmLeaveGroup.group && modals.confirmLeaveGroup.pendingSaveData && (
  <BaseModal
    open={modals.confirmLeaveGroup.isOpen}
    onClose={actions.cancelConfirmLeaveGroup}
    title="Leave Group?"
    size="sm"
    description={<span className="text-slate-300 text-sm">You are removing yourself from this group.</span>}
    footer={
      <div className="flex gap-2">
        <button
          onClick={actions.cancelConfirmLeaveGroup}
          className="px-4 py-2 bg-white/10 text-white rounded-md hover:bg-white/20"
        >
          Cancel
        </button>
        <button
          onClick={actions.confirmLeaveGroup}
          disabled={modals.confirmLeaveGroup.isProcessing}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-md disabled:opacity-50"
        >
          {modals.confirmLeaveGroup.isProcessing ? 'Leaving...' : 'Leave Group'}
        </button>
      </div>
    }
  >
    <p className="text-sm text-slate-300">
      You will no longer have access to "{modals.confirmLeaveGroup.group.name}" or its transactions.
      This action cannot be undone unless someone invites you back.
    </p>
  </BaseModal>
)}
```

- [ ] **Step 4d.16: Remove `handleConfirmDeleteGroup` and `handleConfirmArchiveGroup` from `AppWithAuth`**

These two functions (around lines 862–898 in the original) are now the `handleDeleteGroupCb` and `handleArchiveGroupCb` callbacks defined inside `App`. Delete them from `AppWithAuth`.

- [ ] **Step 4d.17: Verify TypeScript compiles**

```bash
cd "E:/VS Code/Repo/Kharch-Baant"
npx tsc --noEmit 2>&1 | head -50
```

Fix any type errors before continuing.

- [ ] **Step 4d.18: Run all tests**

```bash
npx vitest run
```

Expected: 99 tests pass (no regressions from pure App.tsx changes — the component tests don't test App directly).

- [ ] **Step 4d.19: Commit**

```bash
git add App.tsx contexts/ModalContext.tsx
git commit -m "feat(modals): wire App.tsx to useModals + ModalContext.Provider; remove 23 local useState"
```

---

## Task 5: Update `GroupView.tsx`

**Files:**
- Modify: `components/GroupView.tsx`

Remove 5 modal props; call `useModalContext()` directly.

- [ ] **Step 5.1: Add import**

Add at the top:
```typescript
import { useModalContext } from '../contexts/ModalContext';
```

- [ ] **Step 5.2: Update `GroupViewProps` interface**

Remove from the interface:
```typescript
  onAddExpense: () => void;
  onSettleUp: () => void;
  onEditTransaction: (transaction: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onViewDetails: (transaction: Transaction) => void;
```

- [ ] **Step 5.3: Remove the 5 props from the destructured parameters**

Remove `onAddExpense`, `onSettleUp`, `onEditTransaction`, `onDeleteTransaction`, `onViewDetails` from the destructuring at the top of the component function.

- [ ] **Step 5.4: Call `useModalContext` and wire up local handlers**

Add inside the component body (after the early return guard `if (!group)`):

```typescript
  const { actions } = useModalContext();

  const handleEditTransaction = (transaction: Transaction) => {
    if (transaction.type === 'settlement') {
      actions.openSettleUp({ initialTransaction: transaction });
    } else {
      actions.openTransactionForm(transaction);
    }
  };

  const handleDeleteTransaction = (id: string) => {
    const tx = transactions.find(t => t.id === id);
    if (tx) actions.requestDeleteTransaction(tx);
  };
```

- [ ] **Step 5.5: Replace prop references in JSX with local handlers and `actions`**

| Old | New |
|---|---|
| `onClick={onAddExpense}` | `onClick={() => actions.openTransactionForm()}` |
| `onClick={onSettleUp}` | `onClick={() => actions.openSettleUp()}` |
| `onEdit={onEditTransaction}` (TransactionList) | `onEdit={handleEditTransaction}` |
| `onDelete={onDeleteTransaction}` (TransactionList) | `onDelete={handleDeleteTransaction}` |
| `onViewDetails={onViewDetails}` (TransactionList) | `onViewDetails={(tx) => actions.openTransactionDetail(tx)}` |

- [ ] **Step 5.6: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "GroupView"
```

Expected: no errors.

- [ ] **Step 5.7: Run tests**

```bash
npx vitest run
```

Expected: 99 pass.

- [ ] **Step 5.8: Commit**

```bash
git add components/GroupView.tsx
git commit -m "feat(modals): GroupView calls useModalContext; remove 5 prop-drilled callbacks"
```

---

## Task 6: Update `TransactionDetailModal.tsx`

**Files:**
- Modify: `components/TransactionDetailModal.tsx`

Remove `onEdit?` and `onDelete?` props; call `useModalContext()` directly.

- [ ] **Step 6.1: Add import**

```typescript
import { useModalContext } from '../contexts/ModalContext';
```

- [ ] **Step 6.2: Update `TransactionDetailModalProps`**

Remove:
```typescript
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
```

- [ ] **Step 6.3: Remove props from destructuring**

Remove `onEdit` and `onDelete` from the destructured parameters.

- [ ] **Step 6.4: Replace prop usages with context calls**

In the component body, add:
```typescript
  const { actions } = useModalContext();
```

Replace the footer buttons:

```tsx
{/* Delete button */}
<button
  onClick={() => {
    actions.requestDeleteTransaction(transaction);
    actions.closeTransactionDetail();
  }}
  className="px-4 py-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
>
  Delete
</button>
{/* Edit button */}
<button
  onClick={() => {
    actions.openTransactionForm(transaction);
    actions.closeTransactionDetail();
  }}
  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
>
  Edit
</button>
```

Remove the `{onDelete && (...)}` and `{onEdit && (...)}` conditional wrappers — the buttons are always visible now.

- [ ] **Step 6.5: Update `App.tsx` call site — remove `onEdit` and `onDelete` props**

In `App.tsx`, update the `TransactionDetailModal` render (from Step 4d.13) to remove the now-unnecessary `onEdit` and `onDelete` props:

```tsx
{modals.transactionDetail.isOpen && modals.transactionDetail.transaction && (
  <TransactionDetailModal
    transaction={modals.transactionDetail.transaction}
    onClose={actions.closeTransactionDetail}
    groupMembers={groupMembers}
    paymentSources={paymentSources}
  />
)}
```

- [ ] **Step 6.6: TypeScript check and tests**

```bash
npx tsc --noEmit 2>&1 | grep "TransactionDetail"
npx vitest run
```

Expected: no errors, 99 tests pass.

- [ ] **Step 6.7: Commit**

```bash
git add components/TransactionDetailModal.tsx App.tsx
git commit -m "feat(modals): TransactionDetailModal calls useModalContext; remove onEdit/onDelete props"
```

---

## Task 7: Update `SettingsModal.tsx`

**Files:**
- Modify: `components/SettingsModal.tsx`

Remove `onManagePaymentSources` prop; call `useModalContext()` directly.

- [ ] **Step 7.1: Add import**

```typescript
import { useModalContext } from '../contexts/ModalContext';
```

- [ ] **Step 7.2: Update `SettingsModalProps`**

Remove:
```typescript
  onManagePaymentSources: () => void;
```

- [ ] **Step 7.3: Remove from destructuring and add context call**

Remove `onManagePaymentSources` from the destructured parameters. Add inside the component body:

```typescript
  const { actions } = useModalContext();
```

- [ ] **Step 7.4: Replace `onManagePaymentSources()` call**

Find the call site inside `SettingsModal` (likely in a button's onClick) and replace:
```typescript
onManagePaymentSources()
```
With:
```typescript
actions.openPaymentSourceManage()
```

- [ ] **Step 7.5: Update `App.tsx` call site**

The `SettingsModal` render in `App.tsx` (Step 4d.5) already has `onManagePaymentSources` removed. Verify it matches:
```tsx
<SettingsModal
  isOpen={modals.settings.isOpen}
  onClose={actions.closeSettings}
  currentUserId={currentUserId}
  currentUserPerson={person}
  theme={theme}
  onThemeChange={setTheme}
/>
```

- [ ] **Step 7.6: TypeScript check and tests**

```bash
npx tsc --noEmit 2>&1 | grep "SettingsModal"
npx vitest run
```

Expected: no errors, 99 tests pass.

- [ ] **Step 7.7: Commit**

```bash
git add components/SettingsModal.tsx App.tsx
git commit -m "feat(modals): SettingsModal calls useModalContext; remove onManagePaymentSources prop"
```

---

## Task 8: Update `PaymentSourceManageModal.tsx`

**Files:**
- Modify: `components/PaymentSourceManageModal.tsx`

Remove `onAddNew`, `onRequestDelete`, `onArchive` props; call `useModalContext()` directly. Note: `onArchive` triggers a data operation (no modal involved) — it stays as a prop since it's not a modal action.

Re-examine: `onArchive` calls `handleArchivePaymentSource` in App which just calls `api.archivePaymentSource` and updates cache. It has nothing to do with modals. So `onArchive` **stays as a prop**. Only `onAddNew` and `onRequestDelete` are replaced by context.

- [ ] **Step 8.1: Add import**

```typescript
import { useModalContext } from '../contexts/ModalContext';
```

- [ ] **Step 8.2: Update `PaymentSourceManageModalProps`**

Remove:
```typescript
  onAddNew: () => void;
  onRequestDelete: (id: string) => void;
```

Keep `onArchive: (id: string) => void` — it's a data operation, not a modal trigger.

- [ ] **Step 8.3: Remove props from destructuring and add context call**

Remove `onAddNew` and `onRequestDelete` from the destructured parameters. Add inside the component body:

```typescript
  const { actions } = useModalContext();
```

- [ ] **Step 8.4: Replace `onAddNew` and `onRequestDelete` call sites**

Find all usages of `onAddNew` and `onRequestDelete` inside the component and replace:

```typescript
// onAddNew() → 
actions.closePaymentSourceManage();
actions.openPaymentSourceForm();

// onRequestDelete(id) →
const src = paymentSources.find(ps => ps.id === id);
if (src) actions.requestDeletePaymentSource(src);
```

- [ ] **Step 8.5: Update `App.tsx` call site — remove `onAddNew` and `onRequestDelete`**

Update the `PaymentSourceManageModal` render in `App.tsx`:

```tsx
{modals.paymentSourceManage.isOpen && (
  <PaymentSourceManageModal
    isOpen={modals.paymentSourceManage.isOpen}
    onClose={actions.closePaymentSourceManage}
    paymentSources={paymentSources}
    usageCounts={paymentSourceUsageCounts}
    lastUsedMap={paymentSourceLastUsed}
    onArchive={handleArchivePaymentSource}
  />
)}
```

- [ ] **Step 8.6: TypeScript check and tests**

```bash
npx tsc --noEmit 2>&1 | grep "PaymentSource"
npx vitest run
```

Expected: no errors, 99 tests pass.

- [ ] **Step 8.7: Commit**

```bash
git add components/PaymentSourceManageModal.tsx App.tsx
git commit -m "feat(modals): PaymentSourceManageModal calls useModalContext; remove onAddNew/onRequestDelete props"
```

---

## Task 9: Final verification

- [ ] **Step 9.1: Full TypeScript check — zero errors**

```bash
cd "E:/VS Code/Repo/Kharch-Baant"
npx tsc --noEmit
```

Expected output: nothing (zero errors).

- [ ] **Step 9.2: Full test suite**

```bash
npx vitest run --coverage
```

Expected: 106+ tests pass (99 existing + 7 new from Task 1), all coverage thresholds met.

- [ ] **Step 9.3: Grep for dead state patterns — must be empty**

```bash
grep -rn "openModals\|closeModal\|ModalName" --include="*.ts" --include="*.tsx" .
```

Expected: no matches (these were all in `appStore.ts` which was cleaned in Task 3).

```bash
grep -n "isTransactionModalOpen\|isGroupModalOpen\|isSettleUpOpen\|editingTransaction\|editingGroup\|isProcessingGroupAction\|isSettingsModalOpen\|isAddActionModalOpen\|isPaymentSourceModalOpen\|isPaymentSourceManageOpen\|isTransactionDetailOpen\|selectedTransactionForDetail\|defaultSettlePayer\|pendingDeleteTransaction\|isDeletingTransaction" App.tsx
```

Expected: no matches.

- [ ] **Step 9.4: Verify no modal props in updated component interfaces**

```bash
grep -n "onAddExpense\|onSettleUp\|onEditTransaction\|onDeleteTransaction\|onViewDetails" components/GroupView.tsx
grep -n "onEdit\|onDelete" components/TransactionDetailModal.tsx
grep -n "onManagePaymentSources" components/SettingsModal.tsx
grep -n "onAddNew\|onRequestDelete" components/PaymentSourceManageModal.tsx
```

Expected: no matches in the `Props` interface or destructuring (only `onArchive` may appear in `PaymentSourceManageModal`).

- [ ] **Step 9.5: Update `ARCHITECTURE.md` §15 — mark item #6 resolved**

Find item #6 in `ARCHITECTURE.md`:
```
6. **Modal state is bifurcated** ...
```

Remove the item entirely. Renumber the remaining items if needed (or leave a gap — the doc uses explicit numbers so just delete the line).

Also update the `Last verified against repo` date to `2026-04-25`.

- [ ] **Step 9.6: Final commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: resolve §15 #6 (modal bifurcation); update architecture doc"
```

- [ ] **Step 9.7: Push**

```bash
git push
```

---

## Success Criteria

1. `npx tsc --noEmit` — zero errors
2. `npx vitest run` — 106+ tests pass, zero failures
3. `appStore.ts` exports no `ModalName`, `openModals`, `openModal`, or `closeModal`
4. `App.tsx` has zero `useState` calls for modal open/close state
5. `GroupView`, `TransactionDetailModal`, `SettingsModal`, `PaymentSourceManageModal` props interfaces contain no modal-open callbacks (except `onArchive` in PaymentSourceManageModal which is a data op)
6. Any component in the tree can call `useModalContext()` without a provider error
