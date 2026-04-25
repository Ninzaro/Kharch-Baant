import React, { useState, useCallback } from 'react';
import { Transaction, Group, PaymentSource } from '../types';

interface ModalState {
  // Transaction modals
  transactionForm: {
    isOpen: boolean;
    editing: Transaction | null;
  };
  transactionDetail: {
    isOpen: boolean;
    transaction: Transaction | null;
  };
  // Group modals
  groupForm: {
    isOpen: boolean;
    editing: Group | null;
  };
  shareModal: {
    isOpen: boolean;
    groupId: string | null;
  };
  memberInvite: {
    isOpen: boolean;
    groupId: string | null;
  };
  archivedGroups: {
    isOpen: boolean;
  };
  archivePrompt: {
    isOpen: boolean;
    groupId: string | null;
  };
  
  // Payment modals
  paymentSourceForm: {
    isOpen: boolean;
  };
  paymentSourceManage: {
    isOpen: boolean;
  };
  
  // Settlement & Balance
  settleUp: {
    isOpen: boolean;
    defaultPayer?: string;
    defaultReceiver?: string;
    defaultAmount?: number;
    initialTransaction?: Transaction;
  };
  balanceBreakdown: {
    isOpen: boolean;
    groupId: string | null;
    personId: string | null;
  };
  
  // Filters & Views
  calendar: {
    isOpen: boolean;
    selectedDate?: Date;
  };
  dateFilter: {
    isOpen: boolean;
    startDate?: Date;
    endDate?: Date;
  };
  
  // Utility modals
  addAction: {
    isOpen: boolean;
  };
  settings: {
    isOpen: boolean;
  };
  
  // Delete confirmations
  deleteTransaction: {
    isOpen: boolean;
    transaction: Transaction | null;
    isDeleting: boolean;
  };
  deletePaymentSource: {
    isOpen: boolean;
    paymentSource: PaymentSource | null;
    isDeleting: boolean;
  };

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
}

interface ModalActions {
  // Transaction actions
  openTransactionForm: (editing?: Transaction | null) => void;
  closeTransactionForm: () => void;
  openTransactionDetail: (transaction: Transaction) => void;
  closeTransactionDetail: () => void;
  
  // Group actions
  openGroupForm: (editing?: Group | null) => void;
  closeGroupForm: () => void;
  openShareModal: (groupId: string) => void;
  closeShareModal: () => void;
  openMemberInvite: (groupId: string) => void;
  closeMemberInvite: () => void;
  openArchivedGroups: () => void;
  closeArchivedGroups: () => void;
  openArchivePrompt: (groupId: string) => void;
  closeArchivePrompt: () => void;
  
  // Payment actions
  openPaymentSourceForm: () => void;
  closePaymentSourceForm: () => void;
  openPaymentSourceManage: () => void;
  closePaymentSourceManage: () => void;
  
  // Settlement & Balance actions
  openSettleUp: (config?: {
    defaultPayer?: string;
    defaultReceiver?: string;
    defaultAmount?: number;
    initialTransaction?: Transaction;
  }) => void;
  closeSettleUp: () => void;
  openBalanceBreakdown: (groupId: string, personId: string) => void;
  closeBalanceBreakdown: () => void;
  
  // Filter & View actions
  openCalendar: (selectedDate?: Date) => void;
  closeCalendar: () => void;
  openDateFilter: (startDate?: Date, endDate?: Date) => void;
  closeDateFilter: () => void;
  
  // Utility actions
  openAddAction: () => void;
  closeAddAction: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  
  // Delete confirmations
  requestDeleteTransaction: (transaction: Transaction) => void;
  confirmDeleteTransaction: () => Promise<void>;
  cancelDeleteTransaction: () => void;
  requestDeletePaymentSource: (paymentSource: PaymentSource) => void;
  confirmDeletePaymentSource: () => Promise<void>;
  cancelDeletePaymentSource: () => void;
  
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

  // Utility
  closeAll: () => void;
}

const initialState: ModalState = {
  transactionForm: { isOpen: false, editing: null },
  transactionDetail: { isOpen: false, transaction: null },
  groupForm: { isOpen: false, editing: null },
  shareModal: { isOpen: false, groupId: null },
  memberInvite: { isOpen: false, groupId: null },
  archivedGroups: { isOpen: false },
  archivePrompt: { isOpen: false, groupId: null },
  paymentSourceForm: { isOpen: false },
  paymentSourceManage: { isOpen: false },
  settleUp: { isOpen: false, defaultPayer: undefined, defaultReceiver: undefined, defaultAmount: undefined, initialTransaction: undefined },
  balanceBreakdown: { isOpen: false, groupId: null, personId: null },
  calendar: { isOpen: false, selectedDate: undefined },
  dateFilter: { isOpen: false, startDate: undefined, endDate: undefined },
  addAction: { isOpen: false },
  settings: { isOpen: false },
  deleteTransaction: { isOpen: false, transaction: null, isDeleting: false },
  deletePaymentSource: { isOpen: false, paymentSource: null, isDeleting: false },
  confirmDeleteGroup: { isOpen: false, group: null, isProcessing: false },
  confirmArchiveGroup: { isOpen: false, group: null, isProcessing: false },
  confirmLeaveGroup: { isOpen: false, group: null, pendingSaveData: null, isProcessing: false },
};

export function useModals(
  onDeleteTransaction?: (id: string) => Promise<void>,
  onDeletePaymentSource?: (id: string) => Promise<void>,
  onDeleteGroup?: (group: Group) => Promise<void>,
  onArchiveGroup?: (group: Group) => Promise<void>,
  onLeaveGroup?: (group: Group, saveData: Omit<Group, 'id'>) => Promise<void>,
) {
  const [state, setState] = useState<ModalState>(initialState);
  const stateRef = React.useRef(state);
  // Always keep ref in sync
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);


  // Dynamic modal openers
  type ModalKey = keyof Omit<ModalState, 'deleteTransaction' | 'deletePaymentSource' | 'confirmDeleteGroup' | 'confirmArchiveGroup' | 'confirmLeaveGroup'>;
  const createAction = <K extends ModalKey>(key: K) =>
    useCallback((payload?: Partial<ModalState[K]>) => {
      // Input guards for each modal type. `undefined` always means "no payload
      // for this field" and must be accepted — wrappers pass `{ editing: undefined }`
      // when the caller invokes openTransactionForm() with no arg.
      if (key === 'transactionForm' && payload && 'editing' in payload && (payload as any).editing != null && typeof (payload as any).editing !== 'object') {
        console.warn('transactionForm: Invalid editing value', (payload as any).editing);
        return;
      }
      if (key === 'transactionDetail' && payload && 'transaction' in payload && (payload as any).transaction !== undefined && (!(payload as any).transaction || typeof (payload as any).transaction !== 'object' || !(payload as any).transaction.id)) {
        console.warn('transactionDetail: Invalid transaction', (payload as any).transaction);
        return;
      }
      if (key === 'groupForm' && payload && 'editing' in payload && (payload as any).editing != null && (typeof (payload as any).editing !== 'object' || !(payload as any).editing.id)) {
        console.warn('groupForm: Invalid editing value', (payload as any).editing);
        return;
      }
      if ((key === 'shareModal' || key === 'memberInvite' || key === 'archivePrompt') && payload && 'groupId' in payload && (!(payload as any).groupId || typeof (payload as any).groupId !== 'string')) {
        console.warn(key + ': Invalid groupId', (payload as any).groupId);
        return;
      }
      if (key === 'balanceBreakdown' && payload && ((typeof (payload as any).groupId !== 'string') || (typeof (payload as any).personId !== 'string'))) {
        console.warn('balanceBreakdown: Invalid groupId or personId', (payload as any).groupId, (payload as any).personId);
        return;
      }
      if (key === 'calendar' && payload && 'selectedDate' in payload && (payload as any).selectedDate && !((payload as any).selectedDate instanceof Date)) {
        console.warn('calendar: Invalid selectedDate', (payload as any).selectedDate);
        return;
      }
      if (key === 'dateFilter' && payload && (((payload as any).startDate && !((payload as any).startDate instanceof Date)) || ((payload as any).endDate && !((payload as any).endDate instanceof Date)))) {
        console.warn('dateFilter: Invalid startDate or endDate', (payload as any).startDate, (payload as any).endDate);
        return;
      }
      if (key === 'settleUp' && payload && typeof payload !== 'object') {
        console.warn('settleUp: Invalid config', payload);
        return;
      }
      // Strip `undefined` properties so the spread doesn't clobber `null`
      // defaults from `initialState[key]` (e.g. `editing: null` → `undefined`
      // when the wrapper passes `{ editing: undefined }` for no-arg calls).
      const cleanedPayload: any = {};
      if (payload) {
        for (const k of Object.keys(payload)) {
          const v = (payload as any)[k];
          if (v !== undefined) cleanedPayload[k] = v;
        }
      }
      setState(s => ({ ...s, [key]: { ...initialState[key], ...cleanedPayload, isOpen: true } }));
    }, []);
  // Restore close functions for each modal
  const closeTransactionForm = useCallback(() => {
    setState(s => ({ ...s, transactionForm: initialState.transactionForm }));
  }, []);
  const closeTransactionDetail = useCallback(() => {
    setState(s => ({ ...s, transactionDetail: initialState.transactionDetail }));
  }, []);
  const closeGroupForm = useCallback(() => {
    setState(s => ({ ...s, groupForm: initialState.groupForm }));
  }, []);
  const closeShareModal = useCallback(() => {
    setState(s => ({ ...s, shareModal: initialState.shareModal }));
  }, []);
  const closeMemberInvite = useCallback(() => {
    setState(s => ({ ...s, memberInvite: initialState.memberInvite }));
  }, []);
  const closeArchivedGroups = useCallback(() => {
    setState(s => ({ ...s, archivedGroups: initialState.archivedGroups }));
  }, []);
  const closeArchivePrompt = useCallback(() => {
    setState(s => ({ ...s, archivePrompt: initialState.archivePrompt }));
  }, []);
  const closePaymentSourceForm = useCallback(() => {
    setState(s => ({ ...s, paymentSourceForm: initialState.paymentSourceForm }));
  }, []);
  const closePaymentSourceManage = useCallback(() => {
    setState(s => ({ ...s, paymentSourceManage: initialState.paymentSourceManage }));
  }, []);
  const closeSettleUp = useCallback(() => {
    setState(s => ({ ...s, settleUp: initialState.settleUp }));
  }, []);
  const closeBalanceBreakdown = useCallback(() => {
    setState(s => ({ ...s, balanceBreakdown: initialState.balanceBreakdown }));
  }, []);
  const closeCalendar = useCallback(() => {
    setState(s => ({ ...s, calendar: initialState.calendar }));
  }, []);
  const closeDateFilter = useCallback(() => {
    setState(s => ({ ...s, dateFilter: initialState.dateFilter }));
  }, []);
  const closeAddAction = useCallback(() => {
    setState(s => ({ ...s, addAction: initialState.addAction }));
  }, []);

  const closeSettings = useCallback(() => {
    setState(s => ({ ...s, settings: initialState.settings }));
  }, []);

  // Modal openers
  const openTransactionForm = createAction('transactionForm');
  const openTransactionDetail = createAction('transactionDetail');
  const openGroupForm = createAction('groupForm');
  const openShareModal = createAction('shareModal');
  const openMemberInvite = createAction('memberInvite');
  const openArchivedGroups = createAction('archivedGroups');
  const openArchivePrompt = createAction('archivePrompt');
  const openPaymentSourceForm = createAction('paymentSourceForm');
  const openPaymentSourceManage = createAction('paymentSourceManage');
  const openSettleUp = createAction('settleUp');
  const openBalanceBreakdown = createAction('balanceBreakdown');
  const openCalendar = createAction('calendar');
  const openDateFilter = createAction('dateFilter');
  const openAddAction = createAction('addAction');
  const openSettings = createAction('settings');

  // Wrapper functions for legacy argument style
  const openTransactionFormWrapper = useCallback((editing?: Transaction | null) => openTransactionForm({ editing }), [openTransactionForm]);
  const openTransactionDetailWrapper = useCallback((transaction: Transaction) => openTransactionDetail({ transaction }), [openTransactionDetail]);
  const openGroupFormWrapper = useCallback((editing?: Group | null) => openGroupForm({ editing }), [openGroupForm]);
  const openShareModalWrapper = useCallback((groupId: string) => openShareModal({ groupId }), [openShareModal]);
  const openMemberInviteWrapper = useCallback((groupId: string) => openMemberInvite({ groupId }), [openMemberInvite]);
  const openArchivedGroupsWrapper = useCallback(() => openArchivedGroups(), [openArchivedGroups]);
  const openArchivePromptWrapper = useCallback((groupId: string) => openArchivePrompt({ groupId }), [openArchivePrompt]);
  const openPaymentSourceFormWrapper = useCallback(() => openPaymentSourceForm(), [openPaymentSourceForm]);
  const openPaymentSourceManageWrapper = useCallback(() => openPaymentSourceManage(), [openPaymentSourceManage]);
  const openSettleUpWrapper = useCallback((config?: { defaultPayer?: string; defaultReceiver?: string; defaultAmount?: number; initialTransaction?: Transaction }) => openSettleUp(config), [openSettleUp]);
  const openBalanceBreakdownWrapper = useCallback((groupId: string, personId: string) => openBalanceBreakdown({ groupId, personId }), [openBalanceBreakdown]);
  const openCalendarWrapper = useCallback((selectedDate?: Date) => openCalendar({ selectedDate }), [openCalendar]);
  const openDateFilterWrapper = useCallback((startDate?: Date, endDate?: Date) => openDateFilter({ startDate, endDate }), [openDateFilter]);
  const openAddActionWrapper = useCallback(() => openAddAction(), [openAddAction]);
  const openSettingsWrapper = useCallback(() => openSettings(), [openSettings]);

  // Delete confirmations (robust: always use latest state, propagate errors)
  const requestDeleteTransaction = useCallback((transaction: Transaction) => {
    if (!transaction || typeof transaction !== 'object' || !transaction.id) {
      console.warn('requestDeleteTransaction: Invalid transaction', transaction);
      return;
    }
    setState(s => ({
      ...s,
      deleteTransaction: { isOpen: true, transaction, isDeleting: false },
    }));
  }, []);

  const confirmDeleteTransaction = useCallback(async () => {
    const transaction = stateRef.current.deleteTransaction.transaction;
    if (!transaction || !onDeleteTransaction) return;
    setState(s => ({
      ...s,
      deleteTransaction: { ...s.deleteTransaction, isDeleting: true },
    }));
    try {
      await onDeleteTransaction(transaction.id);
      setState(s => ({
        ...s,
        deleteTransaction: { isOpen: false, transaction: null, isDeleting: false },
      }));
    } catch (error) {
      setState(s => ({
        ...s,
        deleteTransaction: { ...s.deleteTransaction, isDeleting: false },
      }));
      throw error;
    }
  }, [onDeleteTransaction]);

  const cancelDeleteTransaction = useCallback(() => {
    setState(s => ({
      ...s,
      deleteTransaction: initialState.deleteTransaction,
    }));
  }, []);

  const requestDeletePaymentSource = useCallback((paymentSource: PaymentSource) => {
    if (!paymentSource || typeof paymentSource !== 'object' || !paymentSource.id) {
      console.warn('requestDeletePaymentSource: Invalid paymentSource', paymentSource);
      return;
    }
    setState(s => ({
      ...s,
      deletePaymentSource: { isOpen: true, paymentSource, isDeleting: false },
    }));
  }, []);

  const confirmDeletePaymentSource = useCallback(async () => {
    const paymentSource = stateRef.current.deletePaymentSource.paymentSource;
    if (!paymentSource || !onDeletePaymentSource) return;
    setState(s => ({
      ...s,
      deletePaymentSource: { ...s.deletePaymentSource, isDeleting: true },
    }));
    try {
      await onDeletePaymentSource(paymentSource.id);
      setState(s => ({
        ...s,
        deletePaymentSource: { isOpen: false, paymentSource: null, isDeleting: false },
      }));
    } catch (error) {
      setState(s => ({
        ...s,
        deletePaymentSource: { ...s.deletePaymentSource, isDeleting: false },
      }));
      throw error;
    }
  }, [onDeletePaymentSource]);

  const cancelDeletePaymentSource = useCallback(() => {
    setState(s => ({
      ...s,
      deletePaymentSource: initialState.deletePaymentSource,
    }));
  }, []);

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
    if (!saveData || typeof saveData !== 'object') {
      console.warn('requestConfirmLeaveGroup: Invalid saveData', saveData);
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

  const closeAll = useCallback(() => {
    setState(initialState);
  }, []);

  const actions: ModalActions = {
    openTransactionForm: openTransactionFormWrapper,
    closeTransactionForm,
    openTransactionDetail: openTransactionDetailWrapper,
    closeTransactionDetail,
    openGroupForm: openGroupFormWrapper,
    closeGroupForm,
    openShareModal: openShareModalWrapper,
    closeShareModal,
    openMemberInvite: openMemberInviteWrapper,
    closeMemberInvite,
    openArchivedGroups: openArchivedGroupsWrapper,
    closeArchivedGroups,
    openArchivePrompt: openArchivePromptWrapper,
    closeArchivePrompt,
    openPaymentSourceForm: openPaymentSourceFormWrapper,
    closePaymentSourceForm,
    openPaymentSourceManage: openPaymentSourceManageWrapper,
    closePaymentSourceManage,
    openSettleUp: openSettleUpWrapper,
    closeSettleUp,
    openBalanceBreakdown: openBalanceBreakdownWrapper,
    closeBalanceBreakdown,
    openCalendar: openCalendarWrapper,
    closeCalendar,
    openDateFilter: openDateFilterWrapper,
    closeDateFilter,
    openAddAction: openAddActionWrapper,
    closeAddAction,
    openSettings: openSettingsWrapper,
    closeSettings,
    requestDeleteTransaction,
    confirmDeleteTransaction,
    cancelDeleteTransaction,
    requestDeletePaymentSource,
    confirmDeletePaymentSource,
    cancelDeletePaymentSource,
    requestConfirmDeleteGroup,
    confirmDeleteGroup: confirmDeleteGroupAction,
    cancelConfirmDeleteGroup,
    requestConfirmArchiveGroup,
    confirmArchiveGroup: confirmArchiveGroupAction,
    cancelConfirmArchiveGroup,
    requestConfirmLeaveGroup,
    confirmLeaveGroup: confirmLeaveGroupAction,
    cancelConfirmLeaveGroup,
    closeAll,
  };

  return {
    modals: state,
    actions,
  };
}
